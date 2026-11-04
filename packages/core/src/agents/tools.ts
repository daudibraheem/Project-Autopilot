/**
 * Worker tools. Every call is checked by policy.ts BEFORE it runs; denials go to the audit log.
 * All file/tool content returned to the model is wrapped as <untrusted_data>.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { auditDenial, audit } from "../audit";
import type { Contract } from "../contract";
import type { ToolCall, ToolSpec } from "../llm/types";
import { checkCommand, checkDependencies, checkPathAccess, checkPackageJsonScripts, normalizeRepoPath } from "../policy";
import { FLAKY_SEEDS, parseTap, runInSandbox, TEST_COMMAND, testKey, trimOutput } from "../sandbox";
import { existsInVendor, existsOnNpm } from "../sources";
import { detectInjection, wrapUntrusted } from "../untrusted";
import { RESULT_PREFIX } from "./task";

export const TOOL_SPECS: ToolSpec[] = [
  {
    name: "read_file",
    description: "Read a text file from the job workspace. Only paths inside the contract's allowedPaths.",
    inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false },
  },
  {
    name: "list_files",
    description: "List files in a workspace directory ('.' for the root).",
    inputSchema: { type: "object", properties: { dir: { type: "string" } }, required: ["dir"], additionalProperties: false },
  },
  {
    name: "write_file",
    description: "Write the FULL new content of a file. Only inside allowedPaths; never high-risk paths.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
      additionalProperties: false,
    },
  },
  {
    name: "run_tests",
    description: "Run the project's test suite in the sandbox. Reports new failures vs main and pre-existing failures.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "run_command",
    description: "Run an allow-listed command in the sandbox: npm install --offline, npm test, node --test, npm run lint.",
    inputSchema: { type: "object", properties: { cmd: { type: "string" } }, required: ["cmd"], additionalProperties: false },
  },
  {
    name: "search_lessons",
    description: "Search lessons learned from previous Autopilot jobs.",
    inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false },
  },
];

export interface EvidenceItem {
  step: number;
  kind: "tests" | "command" | "policy_denial" | "injection_flag" | "write" | "classifier" | "rerun" | "git";
  tool?: string;
  command?: string;
  target?: string;
  exitCode?: number;
  newFailures?: number;
  preExistingFailures?: number;
  afterLastWrite?: boolean;
  rule?: string;
  output?: string;
  note?: string;
}

export interface ToolContext {
  jobId: string;
  ws: string;
  contract: Contract;
  baselineFailures: Set<string>;
  demoMode: boolean;
  searchLessons: (query: string) => Promise<string[]>;
  /** Called for every evidence item (commands run, denials, flags). */
  addEvidence: (e: Omit<EvidenceItem, "step">) => void;
}

export interface ToolOutcome {
  content: string;
  isError: boolean;
  denied?: { rule: string; reason: string; target: string };
  wrote?: string;
}

const MAX_READ = 60_000;

async function deny(ctx: ToolContext, tool: string, target: string, rule: string, reason: string): Promise<ToolOutcome> {
  await auditDenial(ctx.jobId, target, rule, reason, { tool });
  ctx.addEvidence({ kind: "policy_denial", tool, target, rule, note: reason });
  return { content: `DENIED by policy (${rule}): ${reason}`, isError: true, denied: { rule, reason, target } };
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export async function executeTool(ctx: ToolContext, call: ToolCall): Promise<ToolOutcome> {
  const input = call.input ?? {};
  switch (call.name) {
    case "read_file": {
      const p = str(input.path);
      const d = checkPathAccess(ctx.contract, p, "read");
      if (!d.allowed) return deny(ctx, "read_file", p, d.rule!, d.reason!);
      const abs = path.join(ctx.ws, normalizeRepoPath(p)!);
      if (!existsSync(abs) || !statSync(abs).isFile()) return { content: `No such file: ${p}`, isError: true };
      let text = readFileSync(abs, "utf8");
      if (text.length > MAX_READ) text = `${text.slice(0, MAX_READ)}\n…[truncated]`;
      const hits = detectInjection(text);
      if (hits.length) {
        await audit({
          actor: "policy",
          action: "injection.flagged",
          target: p,
          severity: "warn",
          jobId: ctx.jobId,
          details: { hits, note: "Content treated as untrusted data; instructions inside it are not followed." },
        });
        ctx.addEvidence({ kind: "injection_flag", tool: "read_file", target: p, note: hits.map((h) => h.line).join(" | ") });
      }
      return { content: wrapUntrusted(`file:${normalizeRepoPath(p)}`, text), isError: false };
    }

    case "list_files": {
      const dir = str(input.dir) || ".";
      const d = checkPathAccess(ctx.contract, dir, "list");
      if (!d.allowed) return deny(ctx, "list_files", dir, d.rule!, d.reason!);
      const abs = path.join(ctx.ws, normalizeRepoPath(dir)!);
      if (!existsSync(abs) || !statSync(abs).isDirectory()) return { content: `No such directory: ${dir}`, isError: true };
      const entries = readdirSync(abs, { withFileTypes: true })
        .filter((e) => e.name !== ".git" && e.name !== "node_modules")
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
      return { content: wrapUntrusted(`dir:${dir}`, entries.join("\n")), isError: false };
    }

    case "write_file": {
      const p = str(input.path);
      const content = str(input.content);
      const d = checkPathAccess(ctx.contract, p, "write");
      if (!d.allowed) return deny(ctx, "write_file", p, d.rule!, d.reason!);
      const rel = normalizeRepoPath(p)!;
      const abs = path.join(ctx.ws, rel);
      if (path.basename(rel) === "package.json") {
        const before = existsSync(abs) ? readFileSync(abs, "utf8") : "{}";
        const s = checkPackageJsonScripts(before, content);
        if (!s.allowed) return deny(ctx, "write_file", p, s.rule!, s.reason!);
        const deps = await checkDependencies(before, content, async (name, spec) =>
          ctx.demoMode ? existsInVendor(ctx.ws, name, spec) : existsOnNpm(name, spec),
        );
        if (!deps.allowed) return deny(ctx, "write_file", p, deps.rule!, deps.reason!);
      }
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, content);
      ctx.addEvidence({ kind: "write", tool: "write_file", target: rel, note: `${content.length} bytes` });
      await audit({ actor: "worker", action: "file.written", target: rel, jobId: ctx.jobId, details: { bytes: content.length } });
      return { content: `ok: wrote ${content.length} bytes to ${rel}`, isError: false, wrote: rel };
    }

    case "run_tests": {
      const r = await runInSandbox(ctx.ws, TEST_COMMAND, { env: { FLAKY_SEED: FLAKY_SEEDS.first }, timeoutMs: 120_000 });
      const s = parseTap(r.stdout, r.stderr, r.exitCode);
      const newFailures = s.failures.filter((f) => !ctx.baselineFailures.has(testKey(f)));
      const pre = s.failures.filter((f) => ctx.baselineFailures.has(testKey(f)));
      const result = {
        passed: s.passed,
        exitCode: r.exitCode,
        total: s.total,
        pass: s.pass,
        skipped: s.skipped,
        newFailures: s.setupError ? [{ file: "", name: "suite did not start", message: s.setupError.slice(0, 300) }] : newFailures,
        preExistingFailures: pre.map((f) => ({ file: f.file, name: f.name })),
        sandbox: r.mode,
      };
      ctx.addEvidence({
        kind: "tests",
        tool: "run_tests",
        command: TEST_COMMAND,
        exitCode: r.exitCode,
        newFailures: result.newFailures.length,
        preExistingFailures: pre.length,
        output: trimOutput(`${s.pass}/${s.total} pass, ${s.fail} fail, ${s.skipped} skipped. ${result.newFailures.map((f) => `NEW: ${f.file} › ${f.name}: ${f.message}`).join(" ")}`, 600),
      });
      return {
        content: `${RESULT_PREFIX}${JSON.stringify(result)}\n${wrapUntrusted("run_tests output", trimOutput(`${r.stdout}\n${r.stderr}`, 3000))}`,
        isError: false,
      };
    }

    case "run_command": {
      const cmd = str(input.cmd);
      const d = checkCommand(cmd, { allowRegistry: ctx.contract.allowRegistry });
      if (!d.allowed) {
        ctx.addEvidence({ kind: "command", tool: "run_command", command: cmd, exitCode: -1, note: `denied: ${d.reason}` });
        return deny(ctx, "run_command", cmd, d.rule!, d.reason!);
      }
      const r = await runInSandbox(ctx.ws, cmd, { timeoutMs: 120_000, network: ctx.contract.allowRegistry && /^npm install$/.test(cmd.trim()) });
      ctx.addEvidence({ kind: "command", tool: "run_command", command: cmd, exitCode: r.exitCode, output: trimOutput(`${r.stdout}${r.stderr}`, 500) });
      return { content: `exit ${r.exitCode}\n${wrapUntrusted(`command:${cmd}`, trimOutput(`${r.stdout}\n${r.stderr}`, 3000))}`, isError: r.exitCode !== 0 };
    }

    case "search_lessons": {
      const hits = await ctx.searchLessons(str(input.query));
      return { content: wrapUntrusted("lessons", hits.length ? hits.join("\n---\n") : "No matching lessons."), isError: false };
    }

    default:
      return { content: `Unknown tool: ${call.name}`, isError: true };
  }
}

/** Mark which test-run evidence items came after the last write (for the verifier's claim check). */
export function annotateEvidence(evidence: EvidenceItem[]): EvidenceItem[] {
  const lastWrite = evidence.map((e) => e.kind).lastIndexOf("write");
  return evidence.map((e, i) => (e.kind === "tests" ? { ...e, afterLastWrite: i > lastWrite } : e));
}
