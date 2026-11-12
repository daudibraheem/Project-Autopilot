/**
 * Verifier eval runner.
 *   - Mock mode (default, CI): runs every case through the real verifier code path with the mock provider.
 *   - Real mode: AUTOPILOT_LLM_PROVIDER=anthropic|openai with a key runs the same cases against the real model.
 * Also (re)generates evals/generated/* so `pnpm eval:promptfoo` uses the exact same prompt and messages.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildTeamVerifierMessage, buildVerifierMessage, runTeamVerifier, runVerifier, TEAM_VERIFIER_SYSTEM_PROMPT, VERIFIER_SYSTEM_PROMPT } from "@autopilot/core/agents/verifier";
import { getConfig, REPO_ROOT } from "@autopilot/core/config";
import { routeModels } from "@autopilot/core/llm/router";
import { EVAL_CASES } from "./eval-cases";
import { EVAL_FACTS, TEAM_EVAL_CASES } from "./eval-team-cases";

export function writePromptfooFiles(): string {
  const dir = path.join(REPO_ROOT, "evals", "generated");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, "verifier-prompt.json"),
    `${JSON.stringify([{ role: "system", content: VERIFIER_SYSTEM_PROMPT }, { role: "user", content: "{{message}}" }], null, 2)}\n`,
  );
  const tests = EVAL_CASES.map((c) => ({
    description: `${c.id}: ${c.description}`,
    vars: { message: buildVerifierMessage(c.input) },
    assert: [
      { type: "is-json" },
      { type: "javascript", value: `JSON.parse(output.match(/\\{[\\s\\S]*\\}/)[0]).verdict === ${JSON.stringify(c.expected)}` },
      ...(c.mustFail
        ? [{ type: "javascript", value: `JSON.parse(output.match(/\\{[\\s\\S]*\\}/)[0]).checks.some((k) => k.name === ${JSON.stringify(c.mustFail)} && k.passed === false)` }]
        : []),
    ],
  }));
  writeFileSync(path.join(dir, "verifier-tests.json"), `${JSON.stringify(tests, null, 2)}\n`);

  // Scrum Mode: team verifier prompt + cases
  writeFileSync(
    path.join(dir, "team-verifier-prompt.json"),
    `${JSON.stringify([{ role: "system", content: TEAM_VERIFIER_SYSTEM_PROMPT }, { role: "user", content: "{{message}}" }], null, 2)}\n`,
  );
  const teamTests = TEAM_EVAL_CASES.map((c) => ({
    description: `${c.id}: ${c.description}`,
    vars: { message: buildTeamVerifierMessage({ kind: c.kind, facts: EVAL_FACTS, output: c.output }) },
    assert: [
      { type: "is-json" },
      { type: "javascript", value: `JSON.parse(output.match(/\\{[\\s\\S]*\\}/)[0]).verdict === ${JSON.stringify(c.expected)}` },
      ...(c.mustFail
        ? [{ type: "javascript", value: `JSON.parse(output.match(/\\{[\\s\\S]*\\}/)[0]).checks.some((k) => k.name === ${JSON.stringify(c.mustFail)} && k.passed === false)` }]
        : []),
    ],
  }));
  writeFileSync(path.join(dir, "team-verifier-tests.json"), `${JSON.stringify(teamTests, null, 2)}\n`);
  return dir;
}

interface EvalCaseStat {
  id: string;
  passes: number;
  runs: number;
  majorityVerdict: string;
  consistency: number; // fraction of runs agreeing on the majority verdict
  passed: boolean; // passed on a majority of runs
}

/** Run one eval case `runs` times; report pass rate and a consistency score (verdict agreement). */
async function evalCase(id: string, runs: number, expected: string, mustFail: string | undefined, run: () => Promise<{ verdict: string; checks: { name: string; passed: boolean; reason: string }[] }>): Promise<EvalCaseStat> {
  const verdicts: string[] = [];
  let passes = 0;
  let lastChecks: { name: string; passed: boolean; reason: string }[] = [];
  for (let i = 0; i < runs; i++) {
    const report = await run();
    lastChecks = report.checks;
    const ok = report.verdict === expected && (!mustFail || report.checks.some((k) => k.name === mustFail && !k.passed));
    if (ok) passes++;
    verdicts.push(report.verdict);
  }
  const counts: Record<string, number> = {};
  for (const v of verdicts) counts[v] = (counts[v] ?? 0) + 1;
  const [majorityVerdict, majorityCount] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
  const passed = passes >= Math.ceil(runs / 2);
  if (!passed) for (const k of lastChecks) console.log(`    ${k.passed ? "✓" : "✗"} ${k.name}: ${k.reason}`);
  return { id, passes, runs, majorityVerdict, consistency: majorityCount / runs, passed };
}

function printStats(title: string, stats: EvalCaseStat[]): boolean {
  console.log(`\n${title}`);
  for (const s of stats) {
    console.log(`${s.passed ? "✓" : "✗"} ${s.id.padEnd(38)} pass ${s.passes}/${s.runs} · consistency ${Math.round(s.consistency * 100)}% (majority ${s.majorityVerdict})`);
  }
  const passedCount = stats.filter((s) => s.passed).length;
  const meanConsistency = stats.length ? stats.reduce((n, s) => n + s.consistency, 0) / stats.length : 1;
  console.log(`${passedCount}/${stats.length} cases passed · mean consistency ${Math.round(meanConsistency * 100)}%`);
  return passedCount === stats.length;
}

export async function runEvals(): Promise<boolean> {
  const cfg = getConfig();
  const route = routeModels("easy", cfg);
  const dir = writePromptfooFiles();
  const runs = cfg.evalRuns;
  console.log(`Verifier evals · provider=${cfg.provider} · verifier=${route.verifierModel} · temperature=${cfg.temperature} · ${runs} run(s)/case`);
  console.log(`(promptfoo files written to ${path.relative(REPO_ROOT, dir)})`);

  const codeStats: EvalCaseStat[] = [];
  for (const c of EVAL_CASES) {
    codeStats.push(await evalCase(c.id, runs, c.expected, c.mustFail, async () => (await runVerifier(c.input, { verifierModel: route.verifierModel, workerModel: route.workerModel })).report));
  }
  const codeOk = printStats(`Code verifier (${EVAL_CASES.length} cases):`, codeStats);

  const teamStats: EvalCaseStat[] = [];
  for (const c of TEAM_EVAL_CASES) {
    teamStats.push(await evalCase(c.id, runs, c.expected, c.mustFail, async () => (await runTeamVerifier({ kind: c.kind, facts: EVAL_FACTS, output: c.output }, { verifierModel: route.verifierModel, workerModel: route.workerModel })).report));
  }
  const teamOk = printStats(`Team verifier (Scrum Mode) (${TEAM_EVAL_CASES.length} cases):`, teamStats);
  return codeOk && teamOk;
}
