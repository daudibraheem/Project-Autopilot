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

export async function runEvals(): Promise<boolean> {
  const cfg = getConfig();
  const route = routeModels("easy", cfg);
  const dir = writePromptfooFiles();
  console.log(`Verifier evals · provider=${cfg.provider} · verifier=${route.verifierModel} · ${EVAL_CASES.length} cases`);
  console.log(`(promptfoo files written to ${path.relative(REPO_ROOT, dir)})\n`);
  let passed = 0;
  for (const c of EVAL_CASES) {
    const { report } = await runVerifier(c.input, { verifierModel: route.verifierModel, workerModel: route.workerModel });
    const verdictOk = report.verdict === c.expected;
    const checkOk = !c.mustFail || report.checks.some((k) => k.name === c.mustFail && !k.passed);
    const ok = verdictOk && checkOk;
    if (ok) passed++;
    console.log(`${ok ? "✓" : "✗"} ${c.id.padEnd(38)} expected ${c.expected.padEnd(4)} got ${report.verdict}${c.mustFail ? ` · ${c.mustFail} ${checkOk ? "failed as expected" : "DID NOT FAIL"}` : ""}`);
    if (!ok) for (const k of report.checks) console.log(`    ${k.passed ? "✓" : "✗"} ${k.name}: ${k.reason}`);
  }
  console.log(`\n${passed}/${EVAL_CASES.length} code-verifier cases passed`);

  console.log(`\nTeam verifier evals (Scrum Mode) · ${TEAM_EVAL_CASES.length} cases`);
  let teamPassed = 0;
  for (const c of TEAM_EVAL_CASES) {
    const { report } = await runTeamVerifier({ kind: c.kind, facts: EVAL_FACTS, output: c.output }, { verifierModel: route.verifierModel, workerModel: route.workerModel });
    const verdictOk = report.verdict === c.expected;
    const checkOk = !c.mustFail || report.checks.some((k) => k.name === c.mustFail && !k.passed);
    const ok = verdictOk && checkOk;
    if (ok) teamPassed++;
    console.log(`${ok ? "✓" : "✗"} ${c.id.padEnd(38)} expected ${c.expected.padEnd(4)} got ${report.verdict}${c.mustFail ? ` · ${c.mustFail} ${checkOk ? "failed as expected" : "DID NOT FAIL"}` : ""}`);
    if (!ok) for (const k of report.checks) console.log(`    ${k.passed ? "✓" : "✗"} ${k.name}: ${k.reason}`);
  }
  console.log(`\n${teamPassed}/${TEAM_EVAL_CASES.length} team-verifier cases passed`);
  return passed === EVAL_CASES.length && teamPassed === TEAM_EVAL_CASES.length;
}
