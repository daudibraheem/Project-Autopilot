/**
 * Sandbox runner. Default: Docker `node:22-slim`, --network none, CPU/memory/pids/time limits,
 * on a throwaway COPY of the workspace. Fallback: local temp-dir runner (clearly marked UNSAFE).
 */
import { execFile, spawn } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { getConfig } from "./config";

const execFileP = promisify(execFile);

export interface SandboxStatus {
  mode: "docker" | "local";
  unsafe: boolean;
  reason: string;
}

export interface SandboxResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  mode: "docker" | "local";
}

export interface SandboxOptions {
  env?: Record<string, string>;
  timeoutMs?: number;
  network?: boolean;
}

/** The command the harness uses to run the target's test suite (TAP output for parsing). */
export const TEST_COMMAND =
  "npm install --offline --no-audit --no-fund --no-package-lock --loglevel=error && node --test --test-reporter=tap";
export const INSTALL_COMMAND = "npm install --offline --no-audit --no-fund --no-package-lock --loglevel=error";

/** FLAKY_SEED values: CI run 1 (first run), its auto-retry, and the worker's confirmation re-run. See DECISIONS #9. */
export const FLAKY_SEEDS = { first: "1", retry: "2", rerun: "4" } as const;

let cached: { at: number; status: SandboxStatus } | null = null;

export async function sandboxStatus(force = false): Promise<SandboxStatus> {
  const cfg = getConfig();
  if (!force && cached && Date.now() - cached.at < 60_000) return cached.status;
  let status: SandboxStatus;
  if (cfg.sandbox === "local") {
    status = { mode: "local", unsafe: true, reason: "AUTOPILOT_SANDBOX=local" };
  } else {
    try {
      await execFileP("docker", ["image", "inspect", cfg.sandboxImage], { timeout: 10_000 });
      status = { mode: "docker", unsafe: false, reason: `docker ${cfg.sandboxImage}, --network none` };
    } catch (e) {
      const why = String((e as Error).message).includes("No such image")
        ? `image ${cfg.sandboxImage} not present (run: docker pull ${cfg.sandboxImage})`
        : "docker not available";
      if (cfg.sandbox === "docker") throw new Error(`AUTOPILOT_SANDBOX=docker but ${why}`);
      status = { mode: "local", unsafe: true, reason: why };
    }
  }
  if (status.unsafe && !cached?.status.unsafe) {
    console.warn(`\n⚠️  Unsafe: no container. Sandbox commands run directly on this machine (${status.reason}).\n`);
  }
  cached = { at: Date.now(), status };
  return status;
}

/** Copy a directory (minus .git and node_modules) to a fresh temp dir. */
export function copyToTemp(src: string, prefix = "ap-sbx-"): string {
  const tmp = mkdtempSync(path.join(os.tmpdir(), prefix));
  cpSync(src, tmp, {
    recursive: true,
    filter: (s) => {
      const rel = path.relative(src, s);
      const top = rel.split(path.sep)[0];
      return top !== ".git" && top !== "node_modules" && !rel.split(path.sep).includes("node_modules");
    },
  });
  return tmp;
}

/** Export a git ref's tracked files into a fresh temp dir (used for "fresh sandbox" runs). */
export async function exportRef(repo: string, ref: string): Promise<string> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "ap-ref-"));
  await new Promise<void>((resolve, reject) => {
    const archive = spawn("git", ["-C", repo, "archive", "--format=tar", ref]);
    const tar = spawn("tar", ["-x", "-C", tmp]);
    archive.stdout.pipe(tar.stdin);
    let err = "";
    archive.stderr.on("data", (d) => {
      err += d;
    });
    tar.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`git archive ${ref} failed: ${err}`))));
    archive.on("error", reject);
  });
  return tmp;
}

const MAX_OUT = 200_000;

function runProcess(cmd: string, args: string[], opts: { cwd?: string; env?: Record<string, string | undefined>; timeoutMs: number; onTimeout?: () => void }) {
  return new Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }>((resolve) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env as NodeJS.ProcessEnv | undefined });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.on("data", (d) => {
      if (stdout.length < MAX_OUT) stdout += d;
    });
    child.stderr.on("data", (d) => {
      if (stderr.length < MAX_OUT) stderr += d;
    });
    const timer = setTimeout(() => {
      timedOut = true;
      opts.onTimeout?.();
      child.kill("SIGKILL");
    }, opts.timeoutMs);
    child.on("error", (e) => {
      stderr += String(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: timedOut ? 124 : (code ?? 1), stdout, stderr, timedOut });
    });
  });
}

/** Run `command` (sh -c) against a COPY of `srcDir`. The copy is deleted afterwards. */
export async function runInSandbox(srcDir: string, command: string, opts: SandboxOptions = {}): Promise<SandboxResult> {
  const work = copyToTemp(srcDir);
  try {
    return await runInDir(work, command, opts);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Fresh sandbox at a git ref (tracked files only). */
export async function runAtRef(repo: string, ref: string, command: string, opts: SandboxOptions = {}): Promise<SandboxResult> {
  const work = await exportRef(repo, ref);
  try {
    return await runInDir(work, command, opts);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Run inside an already-isolated temp dir that the caller owns. */
export async function runInDir(work: string, command: string, opts: SandboxOptions = {}): Promise<SandboxResult> {
  const status = await sandboxStatus();
  const cfg = getConfig();
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const started = Date.now();
  const env = { CI: "1", NO_COLOR: "1", ...(opts.env ?? {}) };
  let r: { code: number; stdout: string; stderr: string; timedOut: boolean };
  if (status.mode === "docker") {
    const name = `autopilot-sbx-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
    const uid = typeof process.getuid === "function" ? `${process.getuid()}:${process.getgid?.()}` : "1000:1000";
    const args = [
      "run",
      "--rm",
      "--name",
      name,
      ...(opts.network ? [] : ["--network", "none"]),
      "--cpus",
      "1",
      "--memory",
      "512m",
      "--pids-limit",
      "256",
      "--security-opt",
      "no-new-privileges",
      "--user",
      uid,
      "-e",
      "HOME=/tmp",
      "-e",
      "npm_config_cache=/tmp/.npm",
      "-e",
      "npm_config_update_notifier=false",
      ...Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]),
      "-v",
      `${work}:/work`,
      "-w",
      "/work",
      cfg.sandboxImage,
      "sh",
      "-c",
      command,
    ];
    r = await runProcess("docker", args, {
      timeoutMs,
      onTimeout: () => {
        spawn("docker", ["kill", name]).on("error", () => {});
      },
    });
  } else {
    r = await runProcess("sh", ["-c", command], {
      cwd: work,
      timeoutMs,
      env: {
        PATH: process.env.PATH,
        HOME: work,
        npm_config_cache: path.join(work, ".npm-cache"),
        npm_config_update_notifier: "false",
        ...env,
      },
    });
  }
  return {
    command,
    exitCode: r.code,
    stdout: r.stdout.split(work).join("/work"),
    stderr: r.stderr.split(work).join("/work"),
    durationMs: Date.now() - started,
    timedOut: r.timedOut,
    mode: status.mode,
  };
}

// ---------- TAP parsing ----------

export interface TestFailure {
  file: string;
  name: string;
  message: string;
}

export interface TestRunSummary {
  passed: boolean;
  total: number;
  pass: number;
  fail: number;
  skipped: number;
  failures: TestFailure[];
  setupError?: string;
}

/** Parse node:test TAP output into a summary. */
export function parseTap(stdout: string, stderr = "", exitCode = 0): TestRunSummary {
  const lines = stdout.split(/\r?\n/);
  const failures: TestFailure[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)not ok \d+ - (.+?)(?:\s+#.*)?$/.exec(lines[i]!);
    if (!m) continue;
    let file = "";
    let message = "";
    for (let j = i + 1; j < Math.min(lines.length, i + 40); j++) {
      const l = lines[j]!;
      if (/^\s*(not )?ok \d+ - /.test(l)) break;
      const loc = /location: '(.+?):\d+:\d+'/.exec(l);
      if (loc && !file) file = loc[1]!.replace(/^\/work\//, "").replace(/^.*?\/(test\/)/, "$1");
      const err = /^\s*error: [|>]?-?\s*'?(.*?)'?$/.exec(l);
      if (err && !message) message = err[1] || (lines[j + 1] ?? "").trim();
    }
    const name = m[2]!.trim();
    // A failing *file* is reported with its path as the name; skip parents whose child already failed.
    if (!file && /\.test\.js$/.test(name)) file = name.replace(/^\/work\//, "");
    if (failures.some((f) => f.name === name && f.file === file)) continue;
    failures.push({ file, name, message: message.slice(0, 300) });
  }
  const num = (k: string) => {
    const m = new RegExp(`^# ${k} (\\d+)`, "m").exec(stdout);
    return m ? Number(m[1]) : 0;
  };
  const total = num("tests");
  const fail = num("fail");
  const summary: TestRunSummary = {
    passed: exitCode === 0 && fail === 0,
    total,
    pass: num("pass"),
    fail,
    skipped: num("skipped"),
    failures: failures.filter((f) => !(f.file === "" && failures.length > 1)),
  };
  if (exitCode !== 0 && total === 0) {
    summary.setupError = (stderr || stdout).trim().split("\n").slice(-8).join("\n");
    summary.passed = false;
  }
  return summary;
}

export function testKey(f: TestFailure): string {
  return `${f.file}::${f.name}`;
}

export function trimOutput(s: string, max = 1500): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max / 3)}\n…[${s.length - max} chars trimmed]…\n${s.slice(-((2 * max) / 3))}`;
}
