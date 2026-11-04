import { FLAKY_SEEDS, parseTap, runInDir, TEST_COMMAND, type TestFailure, testKey, trimOutput } from "../sandbox";
import { withSourceDir } from "./materialize";
import type { StandingGoal } from "./types";

export interface G2Failure extends TestFailure {
  rerunPassed: boolean;
}

/** Run the suite once (CI run seed). On failure, auto-retry once (like CI) to record rerun evidence. */
export async function runSuiteWithRetry(dir: string) {
  const first = await runInDir(dir, TEST_COMMAND, { env: { FLAKY_SEED: FLAKY_SEEDS.first } });
  const firstSummary = parseTap(first.stdout, first.stderr, first.exitCode);
  if (firstSummary.passed) return { first, firstSummary, retry: null, retrySummary: null, failures: [] as G2Failure[] };
  const retry = await runInDir(dir, TEST_COMMAND, { env: { FLAKY_SEED: FLAKY_SEEDS.retry } });
  const retrySummary = parseTap(retry.stdout, retry.stderr, retry.exitCode);
  const stillFailing = new Set(retrySummary.failures.map(testKey));
  const failures = firstSummary.failures.map((f) => ({ ...f, rerunPassed: !stillFailing.has(testKey(f)) && !retrySummary.setupError }));
  return { first, firstSummary, retry, retrySummary, failures };
}

export const g2MainBuildGreen: StandingGoal = {
  id: "main-build-green",
  label: "G2 · Main build is green",
  description: "Runs the test suite in the sandbox. Red on any failure.",
  async check(source) {
    return withSourceDir(source, async (dir) => {
      const r = await runSuiteWithRetry(dir);
      const s = r.firstSummary;
      const status = s.passed ? "green" : "red";
      const summary = s.passed
        ? `${s.pass}/${s.total} tests pass${s.skipped ? ` (${s.skipped} skipped)` : ""}`
        : s.setupError
          ? "Test suite could not start"
          : `${s.fail} failing: ${r.failures.map((f) => `${f.file} › ${f.name}${f.rerunPassed ? " (passed on re-run)" : ""}`).join("; ")}`;
      return {
        goalId: "main-build-green",
        status,
        summary,
        evidence: {
          command: TEST_COMMAND,
          sandbox: r.first.mode,
          run: { flakySeed: FLAKY_SEEDS.first, exitCode: r.first.exitCode, durationMs: r.first.durationMs, ...s },
          retry: r.retrySummary
            ? { flakySeed: FLAKY_SEEDS.retry, exitCode: r.retry!.exitCode, passed: r.retrySummary.passed, failures: r.retrySummary.failures }
            : null,
          failures: r.failures,
          output: trimOutput(s.passed ? "" : `${r.first.stdout}\n${r.first.stderr}`, 2500),
        },
      };
    });
  },
};
