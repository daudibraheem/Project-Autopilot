import { prisma } from "@autopilot/db";
import { audit } from "../audit";
import { getConfig } from "../config";
import type { GoalId } from "../contract";
import { GOAL_IDS } from "../contract";
import { g1NoCriticalVulns } from "./g1-no-critical-vulns";
import { g2MainBuildGreen } from "./g2-main-build-green";
import { g3SetupDocsWork } from "./g3-setup-docs-work";
import { hoursBroken, weekWindowStart } from "./hours";
import { sourceLabel } from "./materialize";
import type { GoalCheckResult, GoalSource, StandingGoal } from "./types";

export * from "./types";
export { hoursBroken, weekWindowStart } from "./hours";
export { extractSetupCommands } from "./g3-setup-docs-work";

export const GOALS: Record<GoalId, StandingGoal> = {
  "no-critical-vulns": g1NoCriticalVulns,
  "main-build-green": g2MainBuildGreen,
  "setup-docs-work": g3SetupDocsWork,
};

export function mainSource(): GoalSource {
  return { kind: "ref", repo: getConfig().targetRepoPath, ref: "main" };
}

/** Run one goal check (plain code). Never throws: an erroring check is red with the error as evidence. */
export async function checkGoal(goalId: GoalId, source: GoalSource = mainSource()): Promise<GoalCheckResult> {
  const started = Date.now();
  try {
    const r = await GOALS[goalId].check(source);
    return { ...r, durationMs: Date.now() - started, ref: sourceLabel(source) };
  } catch (e) {
    return {
      goalId,
      status: "red",
      summary: `Check errored: ${(e as Error).message}`,
      evidence: { error: String((e as Error).stack ?? e) },
      durationMs: Date.now() - started,
      ref: sourceLabel(source),
    };
  }
}

/** Check goals on main, store results, audit. */
export async function runGoalChecks(goalIds: readonly GoalId[] = GOAL_IDS, reason = "manual"): Promise<GoalCheckResult[]> {
  const results = await Promise.all(goalIds.map((g) => checkGoal(g)));
  for (const r of results) {
    await prisma.goalCheck.create({
      data: { goalId: r.goalId, status: r.status, summary: r.summary, evidence: r.evidence as object, ref: r.ref, durationMs: r.durationMs },
    });
    await audit({
      actor: "goal_checker",
      action: "goal.checked",
      target: r.goalId,
      severity: r.status === "red" ? "warn" : "info",
      details: { status: r.status, summary: r.summary, reason, durationMs: r.durationMs },
    });
  }
  return results;
}

export interface GoalOverview {
  goalId: GoalId;
  label: string;
  description: string;
  latest: { status: string; summary: string; evidence: unknown; createdAt: Date } | null;
  previousStatus: string | null;
  hoursBrokenWeek: number;
  history: { status: string; createdAt: Date }[];
}

export async function goalOverview(): Promise<GoalOverview[]> {
  const since = weekWindowStart();
  const out: GoalOverview[] = [];
  for (const id of GOAL_IDS) {
    const checks = await prisma.goalCheck.findMany({
      where: { goalId: id, ref: "main" },
      orderBy: { createdAt: "asc" },
      select: { status: true, summary: true, evidence: true, createdAt: true },
    });
    // include the last check before the window so a goal that was already red counts from window start
    const inWindow = checks.filter((c, i) => c.createdAt >= since || checks[i + 1]?.createdAt! >= since);
    const latest = checks.at(-1) ?? null;
    out.push({
      goalId: id,
      label: GOALS[id].label,
      description: GOALS[id].description,
      latest,
      previousStatus: checks.at(-2)?.status ?? null,
      hoursBrokenWeek: hoursBroken(inWindow, since),
      history: checks.slice(-30).map((c) => ({ status: c.status, createdAt: c.createdAt })),
    });
  }
  return out;
}
