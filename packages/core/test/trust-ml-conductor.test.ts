import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { planJobs } from "../src/conductor";
import { buildDataset, decide, FEATURE_NAMES, predictFlaky, trainFlakyModel } from "../src/ml/flaky";
import { generateCiHistory, parseCsv, toCsv } from "../src/seed/ci-history";
import { applyTrust, EMPTY_TRUST, type TrustState } from "../src/trust";

describe("trust ledger", () => {
  it("promotes after N consecutive approved passes", () => {
    let s: TrustState = EMPTY_TRUST;
    const changes: string[] = [];
    for (let i = 0; i < 3; i++) {
      const t = applyTrust(s, "approved", 3);
      s = t.state;
      if (t.change) changes.push(`${t.change.kind} ${t.change.from}->${t.change.to}`);
    }
    expect(s.level).toBe(1);
    expect(changes).toEqual(["promoted 0->1"]);
    expect(s.consecutivePasses).toBe(0);
  });

  it("demotes one level on gate failure or rejection, and resets the streak", () => {
    const l2: TrustState = { ...EMPTY_TRUST, level: 2, consecutivePasses: 2 };
    const g = applyTrust(l2, "gate_failed");
    expect(g.state.level).toBe(1);
    expect(g.state.consecutivePasses).toBe(0);
    expect(g.change).toEqual({ kind: "demoted", from: 2, to: 1 });
    const r = applyTrust(g.state, "rejected");
    expect(r.state.level).toBe(0);
    expect(r.state.rejections).toBe(1);
    expect(applyTrust(r.state, "rejected").change).toBeNull(); // never below L0
  });

  it("never exceeds L2", () => {
    let s: TrustState = { ...EMPTY_TRUST, level: 2 };
    for (let i = 0; i < 5; i++) s = applyTrust(s, "approved", 1).state;
    expect(s.level).toBe(2);
  });
});

describe("flaky classifier (logistic regression)", () => {
  const csv = toCsv(generateCiHistory());

  it("parses the CI history and builds a labelled dataset without leakage", () => {
    const rows = parseCsv(csv);
    expect(rows.length).toBe(300);
    const { X, y } = buildDataset(rows);
    expect(X.length).toBeGreaterThan(50);
    expect(X[0]!.length).toBe(FEATURE_NAMES.length);
    expect(new Set(y)).toEqual(new Set([0, 1]));
  });

  it("trains and reports held-out precision and recall", () => {
    const t = trainFlakyModel(csv);
    expect(t.metrics.support.test).toBeGreaterThan(10);
    expect(t.metrics.precision).toBeGreaterThan(0.8);
    expect(t.metrics.recall).toBeGreaterThan(0.8);
  });

  it("predicts flaky for a timeout that passes on re-run, real bug for a deterministic failure", () => {
    const { model } = trainFlakyModel(csv);
    const flaky = predictFlaky(model, { historicalFailureRate: 0.2, rerunPassed: true, filesChanged: 2, testFileTouched: false, hour: 14 });
    const real = predictFlaky(model, { historicalFailureRate: 0.02, rerunPassed: false, filesChanged: 1, testFileTouched: false, hour: 14 });
    expect(flaky.decision).toBe("flaky");
    expect(flaky.probability).toBeGreaterThanOrEqual(0.7);
    expect(real.decision).toBe("real_bug");
    expect(real.probability).toBeLessThanOrEqual(0.3);
  });

  it("uses the 0.3 / 0.7 thresholds", () => {
    expect(decide(0.7)).toBe("flaky");
    expect(decide(0.3)).toBe("real_bug");
    expect(decide(0.5)).toBe("uncertain");
  });

  it("the seeded demo_target CSV template matches the generator", () => {
    const seeded = path.join(import.meta.dirname, "../../../demo_target/ci_history.csv");
    try {
      expect(readFileSync(seeded, "utf8")).toBe(csv);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  });
});

describe("conductor planning", () => {
  it("creates one job per red goal, no duplicates, cap at 3", () => {
    const p = planJobs({ candidates: ["no-critical-vulns", "main-build-green", "setup-docs-work"], openJobGoals: ["main-build-green"], killSwitch: false, maxOpen: 3 });
    expect(p.create).toEqual(["no-critical-vulns", "setup-docs-work"]);
    expect(p.skipped[0]?.reason).toMatch(/already open/);
    const capped = planJobs({ candidates: ["no-critical-vulns"], openJobGoals: ["a", "b", "c"], killSwitch: false, maxOpen: 3 });
    expect(capped.create).toEqual([]);
    expect(capped.skipped[0]?.reason).toMatch(/cap/);
  });

  it("kill switch: no new jobs start", () => {
    const p = planJobs({ candidates: ["no-critical-vulns", "setup-docs-work"], openJobGoals: [], killSwitch: true, maxOpen: 3 });
    expect(p.create).toEqual([]);
    expect(p.skipped.every((s) => s.reason === "Kill switch is on")).toBe(true);
  });
});
