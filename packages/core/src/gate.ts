/**
 * Gate: plain code only, no AI. Final pass/fail before a human sees the change.
 */
import { simpleGit } from "simple-git";
import type { Contract, GoalId } from "./contract";
import { checkGoal } from "./goals/index";
import { checkDependencies, checkPackageJsonScripts, isHighRisk, pathViolations } from "./policy";
import { exportRef, FLAKY_SEEDS, parseTap, runInDir, TEST_COMMAND, testKey, trimOutput } from "./sandbox";
import { existsInVendor, existsOnNpm } from "./sources";
import { rmSync } from "node:fs";

export interface GateCheck {
  name: string;
  label: string;
  passed: boolean;
  evidence: string;
}

export const GATE_LABELS: Record<string, string> = {
  tests_fresh_sandbox: "Tests pass in a fresh sandbox (no new failures vs main)",
  lint_clean: "Linter clean on changed files",
  paths_in_scope: "All changed paths inside allowedPaths, none forbidden",
  no_high_risk_paths: "No high-risk paths changed",
  no_secrets: "No secrets in the diff",
  dependencies_exist: "Every dependency exists in the package source",
  goal_green_on_branch: "Goal check is green on the branch",
  verifier_pass: "Verifier verdict is pass",
  within_budget: "Job stayed within budget",
};

const SECRET_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "AWS access key", re: /AKIA[0-9A-Z]{16}/ },
  { name: "GitHub token", re: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|github_pat_[A-Za-z0-9_]{40,}/ },
  { name: "Anthropic key", re: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: "OpenAI-style key", re: /\bsk-(proj-)?[A-Za-z0-9]{32,}/ },
  { name: "Slack token", re: /xox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: "Private key", re: /-----BEGIN ([A-Z]+ )?PRIVATE KEY-----/ },
  { name: "Generic secret assignment", re: /(api[_-]?key|secret|token|passw(or)?d)\s*[:=]\s*['"][^'"\s]{12,}['"]/i },
];

/** Secrets in ADDED lines of a unified diff. */
export function scanSecrets(diff: string): { name: string; line: string }[] {
  const hits: { name: string; line: string }[] = [];
  for (const line of diff.split("\n")) {
    if (!line.startsWith("+") || line.startsWith("+++")) continue;
    for (const p of SECRET_PATTERNS) {
      if (p.re.test(line)) {
        hits.push({ name: p.name, line: `${line.slice(0, 20)}…[redacted]` });
        break;
      }
    }
  }
  return hits;
}

export function checkBudget(usage: { steps: number; tokensIn: number; tokensOut: number; costUsd: number; minutes: number }, c: Pick<Contract, "maxSteps" | "maxTokens" | "maxUsd" | "maxMinutes">): GateCheck {
  const over: string[] = [];
  if (usage.steps > c.maxSteps) over.push(`steps ${usage.steps}/${c.maxSteps}`);
  if (usage.tokensIn + usage.tokensOut > c.maxTokens) over.push(`tokens ${usage.tokensIn + usage.tokensOut}/${c.maxTokens}`);
  if (usage.costUsd > c.maxUsd) over.push(`USD ${usage.costUsd.toFixed(4)}/${c.maxUsd}`);
  if (usage.minutes > c.maxMinutes) over.push(`minutes ${usage.minutes.toFixed(1)}/${c.maxMinutes}`);
  return {
    name: "within_budget",
    label: GATE_LABELS.within_budget!,
    passed: over.length === 0,
    evidence: over.length
      ? `Over budget: ${over.join(", ")}`
      : `steps ${usage.steps}/${c.maxSteps} · tokens ${usage.tokensIn + usage.tokensOut}/${c.maxTokens} · $${usage.costUsd.toFixed(4)}/$${c.maxUsd} · ${usage.minutes.toFixed(1)}/${c.maxMinutes} min`,
  };
}

export function checkPaths(contract: Pick<Contract, "allowedPaths" | "forbiddenPaths">, changed: string[]): GateCheck[] {
  const v = pathViolations(contract, changed);
  const hr = changed.filter(isHighRisk);
  return [
    {
      name: "paths_in_scope",
      label: GATE_LABELS.paths_in_scope!,
      passed: changed.length > 0 && v.length === 0,
      evidence: changed.length === 0 ? "No changes in the diff" : v.length ? v.map((x) => `${x.path}: ${x.reason}`).join("; ") : `Changed: ${changed.join(", ")}`,
    },
    {
      name: "no_high_risk_paths",
      label: GATE_LABELS.no_high_risk_paths!,
      passed: hr.length === 0,
      evidence: hr.length ? `High-risk paths changed: ${hr.join(", ")}` : "None",
    },
  ];
}

async function showAt(repo: string, ref: string, file: string): Promise<string | null> {
  try {
    return await simpleGit(repo).show([`${ref}:${file}`]);
  } catch {
    return null;
  }
}

export interface GateInput {
  goalId: GoalId;
  contract: Contract;
  repo: string;
  branch: string;
  diff: string;
  changedFiles: string[];
  baselineFailures: Set<string>;
  verifierVerdict: "pass" | "fail";
  verifierSummary: string;
  usage: { steps: number; tokensIn: number; tokensOut: number; costUsd: number; minutes: number };
  demoMode: boolean;
}

export async function runGate(input: GateInput): Promise<GateCheck[]> {
  const checks: GateCheck[] = [];
  const { repo, branch } = input;

  // 1. Tests in a FRESH sandbox (tracked files of the branch only)
  const fresh = await exportRef(repo, branch);
  try {
    const r = await runInDir(fresh, TEST_COMMAND, { env: { FLAKY_SEED: FLAKY_SEEDS.first }, timeoutMs: 180_000 });
    const s = parseTap(r.stdout, r.stderr, r.exitCode);
    const newF = s.failures.filter((f) => !input.baselineFailures.has(testKey(f)));
    const pre = s.failures.length - newF.length;
    checks.push({
      name: "tests_fresh_sandbox",
      label: GATE_LABELS.tests_fresh_sandbox!,
      passed: !s.setupError && newF.length === 0,
      evidence: s.setupError
        ? `Suite did not start: ${trimOutput(s.setupError, 400)}`
        : `${s.pass}/${s.total} pass, ${s.skipped} skipped, ${newF.length} new failure(s)${pre ? `, ${pre} pre-existing (also fail on main)` : ""} · ${r.mode} sandbox${
            newF.length ? ` · NEW: ${newF.map((f) => `${f.file} › ${f.name}`).join("; ")}` : ""
          }`,
    });

    // 2. Lint on changed files
    const lintable = input.changedFiles.filter((f) => /\.(c|m)?js$|\.json$/.test(f));
    if (lintable.length === 0) {
      checks.push({ name: "lint_clean", label: GATE_LABELS.lint_clean!, passed: true, evidence: "No lintable files changed" });
    } else {
      const pkg = await showAt(repo, branch, "package.json");
      const hasLint = Boolean(pkg && JSON.parse(pkg).scripts?.lint === "node scripts/lint.js");
      const quoted = lintable.map((f) => `'${f.replace(/'/g, "")}'`).join(" ");
      const cmd = hasLint ? `node scripts/lint.js ${quoted}` : lintable.map((f) => (f.endsWith(".json") ? `node -e "JSON.parse(require('fs').readFileSync('${f}','utf8'))"` : `node --check '${f}'`)).join(" && ");
      const lr = await runInDir(fresh, cmd, { timeoutMs: 60_000 });
      checks.push({
        name: "lint_clean",
        label: GATE_LABELS.lint_clean!,
        passed: lr.exitCode === 0,
        evidence: `${hasLint ? "npm lint script" : "built-in syntax check"} on ${lintable.join(", ")}: ${trimOutput(`${lr.stdout}${lr.stderr}`.trim(), 300) || `exit ${lr.exitCode}`}`,
      });
    }
  } finally {
    rmSync(fresh, { recursive: true, force: true });
  }

  // 3–4. Paths
  checks.push(...checkPaths(input.contract, input.changedFiles));
  const pkgBefore = (await showAt(repo, "main", "package.json")) ?? "{}";
  const pkgAfter = (await showAt(repo, branch, "package.json")) ?? "{}";
  const scripts = checkPackageJsonScripts(pkgBefore, pkgAfter);
  if (!scripts.allowed) {
    const hr = checks.find((c) => c.name === "no_high_risk_paths")!;
    hr.passed = false;
    hr.evidence = `${hr.evidence === "None" ? "" : `${hr.evidence}; `}package.json scripts section changed`;
  }

  // 5. Secrets
  const secrets = scanSecrets(input.diff);
  checks.push({
    name: "no_secrets",
    label: GATE_LABELS.no_secrets!,
    passed: secrets.length === 0,
    evidence: secrets.length ? secrets.map((s) => `${s.name}: ${s.line}`).join("; ") : "No key/token patterns in added lines",
  });

  // 6. Package existence (slopsquatting)
  const fresh2 = await exportRef(repo, branch);
  try {
    const deps = await checkDependencies(pkgBefore, pkgAfter, async (name, spec) => (input.demoMode ? existsInVendor(fresh2, name, spec) : existsOnNpm(name, spec)));
    checks.push({
      name: "dependencies_exist",
      label: GATE_LABELS.dependencies_exist!,
      passed: deps.allowed,
      evidence: deps.allowed ? `All dependencies resolve in the ${input.demoMode ? "vendor dir" : "npm registry"}` : deps.reason!,
    });
  } finally {
    rmSync(fresh2, { recursive: true, force: true });
  }

  // 7. Goal check on the branch
  const goal = await checkGoal(input.goalId, { kind: "ref", repo, ref: branch });
  checks.push({ name: "goal_green_on_branch", label: GATE_LABELS.goal_green_on_branch!, passed: goal.status === "green", evidence: `${goal.status}: ${goal.summary}` });

  // 8. Verifier verdict
  checks.push({ name: "verifier_pass", label: GATE_LABELS.verifier_pass!, passed: input.verifierVerdict === "pass", evidence: input.verifierSummary });

  // 9. Budget
  checks.push(checkBudget(input.usage, input.contract));
  return checks;
}
