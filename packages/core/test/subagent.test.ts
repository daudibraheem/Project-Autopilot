import { describe, expect, it } from "vitest";
import { MAX_FINDINGS, runResearchSubAgent } from "../src/agents/subagent";

const logs = (n: number, failed: number, rerun: number) =>
  Array.from({ length: n }, (_, i) => `run ${1000 + i} @ 2026-10-01T00:00:00Z commit abc${i} failed=${i < failed ? 1 : 0} rerun_passed=${i < rerun ? 1 : 0} files_changed=3 test_touched=0 label=?`);

describe("research sub-agent (§12 D)", () => {
  it("summarises CI logs into at most 5 findings in its own context (mock)", async () => {
    const { findings, response } = await runResearchSubAgent({ test: { file: "test/fx.test.js", name: "converts EUR" }, logs: logs(20, 6, 6), model: "claude-haiku-5-5" });
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.length).toBeLessThanOrEqual(MAX_FINDINGS);
    expect(findings[0]!.summary).toMatch(/Failed in 6 of 20/);
    // all 6 failures passed on re-run → flaky signal
    expect(findings.some((f) => /flaky signal/i.test(f.summary))).toBe(true);
    // its own usage is reported (traced separately)
    expect(response.usage.inputTokens).toBeGreaterThan(0);
  });

  it("reads deterministic failures as a real-bug signal", async () => {
    const { findings } = await runResearchSubAgent({ test: { file: "test/invoice.test.js", name: "rounds" }, logs: logs(10, 4, 0), model: "claude-haiku-5-5" });
    expect(findings.some((f) => /real-bug signal|deterministic/i.test(f.summary))).toBe(true);
  });
});
