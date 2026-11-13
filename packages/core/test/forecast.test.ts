import { describe, expect, it } from "vitest";
import { forecastStatus, runForecast } from "../src/sprint/forecast";

// ~2.2 pts/day from history; ~5 days left → ~11 pts achievable, so these remainders land in a meaningful range.
const base = { completedPoints: 20, totalPoints: 40, daysElapsed: 5, daysRemaining: 5, sprintLengthDays: 10, pastThroughput: [23, 19, 27, 21, 25, 18] };

describe("sprint forecast — Monte Carlo (§3.2)", () => {
  it("is deterministic for a fixed seed", () => {
    const a = runForecast({ ...base, remainingPoints: 11, runs: 10_000, seed: 42 });
    const b = runForecast({ ...base, remainingPoints: 11, runs: 10_000, seed: 42 });
    expect(a.probability).toBe(b.probability);
    expect(a.finalP50).toBe(b.finalP50);
    expect(a.probability).toBeGreaterThan(0);
    expect(a.probability).toBeLessThan(1);
  });

  it("different seeds give close (but not necessarily identical) probabilities", () => {
    const a = runForecast({ ...base, remainingPoints: 11, runs: 10_000, seed: 1 });
    const b = runForecast({ ...base, remainingPoints: 11, runs: 10_000, seed: 2 });
    expect(Math.abs(a.probability - b.probability)).toBeLessThan(0.1);
  });

  it("zero remaining work = 100%", () => {
    const r = runForecast({ ...base, remainingPoints: 0, completedPoints: 40 });
    expect(r.probability).toBe(1);
    expect(r.why).toMatch(/complete/i);
  });

  it("no days remaining with work left = 0%", () => {
    const r = runForecast({ ...base, remainingPoints: 10, daysRemaining: 0 });
    expect(r.probability).toBe(0);
  });

  it("more remaining work lowers the probability (scope change drops the forecast)", () => {
    const before = runForecast({ ...base, remainingPoints: 9, runs: 10_000, seed: 42 });
    const after = runForecast({ ...base, remainingPoints: 14, runs: 10_000, seed: 42 });
    expect(after.probability).toBeLessThan(before.probability);
    expect(before.probability).toBeGreaterThan(0);
    expect(after.probability).toBeLessThan(1);
  });

  it("produces a burn-up with target, actual-so-far and a forecast band", () => {
    const r = runForecast({ ...base, remainingPoints: 11, runs: 2000, seed: 42 });
    expect(r.burnup.length).toBe(base.sprintLengthDays + 1);
    expect(r.burnup[0]!.actual).toBe(0);
    expect(r.burnup.at(-1)!.target).toBe(40);
    expect(r.burnup.some((b) => b.actual === null)).toBe(true); // future days have no actual
  });
});

describe("S3 thresholds (§3.2)", () => {
  it("green ≥ 70%, amber 40–70%, red < 40%", () => {
    expect(forecastStatus(0.7)).toBe("green");
    expect(forecastStatus(0.9)).toBe("green");
    expect(forecastStatus(0.55)).toBe("amber");
    expect(forecastStatus(0.4)).toBe("amber");
    expect(forecastStatus(0.39)).toBe("red");
    expect(forecastStatus(0)).toBe("red");
  });
});
