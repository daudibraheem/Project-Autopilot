/**
 * Regression checks (§12 J): re-running saved checks and flagging regressed goals.
 * (saveRegressionCheck is exercised end-to-end in the live demo; it needs a job+contract relation
 * the in-memory fake doesn't model, so here we drive runRegressionChecks with explicit statuses.)
 */
import { describe, expect, it, vi } from "vitest";
import { memoryDb } from "./memory-db";

const db = memoryDb();
vi.mock("@autopilot/db", () => ({ prisma: db }));

const { runRegressionChecks, regressedGoals } = await import("../src/regression");

describe("regression checks (§12 J)", () => {
  it("fails a check when its goal is no longer green, and flags the goal", async () => {
    await db.regressionCheck.create({ data: { goalId: "no-critical-vulns", jobType: "dependency-security-fix", jobId: "j1", criteria: ["bumped"], active: true, lastStatus: "pass" } });

    // goal green → check passes, goal not flagged
    await runRegressionChecks(new Map([["no-critical-vulns", "green"]]));
    expect([...(await regressedGoals(["no-critical-vulns"]))]).toEqual([]);

    // goal red → regression detected, goal flagged, audited
    const res = await runRegressionChecks(new Map([["no-critical-vulns", "red"]]));
    expect(res).toEqual([{ goalId: "no-critical-vulns", passed: false }]);
    expect([...(await regressedGoals(["no-critical-vulns"]))]).toEqual(["no-critical-vulns"]);
    expect(db.auditEvent.rows.some((a) => a.action === "regression.detected" && a.target === "no-critical-vulns")).toBe(true);

    // back to green → flag clears
    await runRegressionChecks(new Map([["no-critical-vulns", "green"]]));
    expect([...(await regressedGoals(["no-critical-vulns"]))]).toEqual([]);
  });
});
