/**
 * blocked_by_build is order-independent: seed-sprint plants a self-contained red build snapshot
 * (ref "sprint-build"), so an item stays blocked even when the live main build is green.
 */
import { describe, expect, it, vi } from "vitest";
import { memoryDb } from "./memory-db";

const db = memoryDb();
vi.mock("@autopilot/db", () => ({ prisma: db }));

const { redGoalIds, seedBlockedBuild, SPRINT_BUILD_REF } = await import("../src/sprint/data");

describe("self-contained blocked-by-build (§ Scrum order-independence)", () => {
  it("counts a goal red from the live main check OR the seeded snapshot", async () => {
    // nothing planted → empty
    expect([...(await redGoalIds())]).toEqual([]);

    // a seeded red snapshot makes main-build-green count as red (even with no live main check)
    await seedBlockedBuild();
    expect([...(await redGoalIds())]).toContain("main-build-green");

    // a green live main check does NOT clear the seeded snapshot (demo stays order-independent)
    await db.goalCheck.create({ data: { goalId: "main-build-green", ref: "main", status: "green", summary: "ok", evidence: {}, createdAt: new Date() } });
    expect([...(await redGoalIds())]).toContain("main-build-green");

    // seeding is idempotent: one snapshot row, re-planted
    await seedBlockedBuild();
    expect(db.goalCheck.rows.filter((r) => r.ref === SPRINT_BUILD_REF)).toHaveLength(1);

    // a live red check on another goal is still honoured
    await db.goalCheck.create({ data: { goalId: "no-critical-vulns", ref: "main", status: "red", summary: "vuln", evidence: {}, createdAt: new Date() } });
    expect([...(await redGoalIds())].sort()).toEqual(["main-build-green", "no-critical-vulns"]);
  });
});
