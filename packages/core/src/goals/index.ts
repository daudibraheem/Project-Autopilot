import { prisma } from "@autopilot/db";
import { audit } from "../audit";
import { getConfig } from "../config";
import type { GoalId } from "../contract";
import { GOAL_IDS, isTeamGoal, TEAM_GOAL_IDS } from "../contract";
import { s1StandupBriefReady, s2NoStuckWork } from "./team";
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
  "standup-brief-ready": s1StandupBriefReady,
  "no-stuck-work": s2NoStuckWork,
};

export { TEAM_GOAL_IDS };
export const ALL_CHECKED_GOALS = [...GOAL_IDS, ...TEAM_GOAL_IDS] as const;

export function mainSource(): GoalSource {
  return { kind: "ref", repo: getConfig().targetRepoPath, ref: "main" };
}

/** Run one goal check (plain code). Never throws: an erroring check is red with the error as evidence. */
export async function checkGoal(goalId: GoalId, source: GoalSource = mainSource()): Promise<GoalCheckResult> {
  const started = Date.now();
  try {
    const r = await GOALS[goalId].check(source);
    return { ...r, durationMs: Date.now() - started, ref: isTeamGoal(goalId) ? "sprint" : sourceLabel(source) };
  } catch (e) {
    return {
      goalId,
      status: "red",
      summary: `Check errored: ${(e as Error).message}`,
      evidence: { error: String((e as Error).stack ?? e) },
      durationMs: Date.now() - started,
      ref: isTeamGoal(goalId) ? "sprint" : sourceLabel(source),
    };
  }
}

/** Check goals on main, store results, audit. */
export async function runGoalChecks(goalIds: readonly GoalId[] = ALL_CHECKED_GOALS, reason = "manual"): Promise<GoalCheckResult[]> {
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
  // Every success becomes a check: re-run saved regression checks against the statuses just computed.
  const { runRegressionChecks } = await import("../regression");
  await runRegressionChecks(new Map(results.map((r) => [r.goalId, r.status])));
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
  regressed: boolean;
}

export async function goalOverview(ids: readonly GoalId[] = GOAL_IDS): Promise<GoalOverview[]> {
  const since = weekWindowStart();
  const { regressedGoals } = await import("../regression");
  const regressed = await regressedGoals(ids);
  const out: GoalOverview[] = [];
  for (const id of ids) {
    const checks = await prisma.goalCheck.findMany({
      where: { goalId: id, ref: isTeamGoal(id) ? "sprint" : "main" },
      orderBy: { createdAt: "asc" },
      select: { status: true, summary: true, evidence: true, createdAt: true },
    });
    // include the last check before the window so a goal that was already red counts from window start
    const inWindow = checks.filter((c, i) => c.createdAt >= since || (checks[i + 1]?.createdAt ?? new Date(0)) >= since);
    let latest = checks.at(-1) ?? null;
    const isRegressed = regressed.has(id);
    // A regression downgrades a green goal to amber (it never masks a red goal).
    if (latest && isRegressed && latest.status === "green") {
      latest = { ...latest, status: "amber", summary: `${latest.summary} · regression: a previously-approved fix no longer passes its goal check` };
    }
    out.push({
      goalId: id,
      label: GOALS[id].label,
      description: GOALS[id].description,
      latest,
      previousStatus: checks.at(-2)?.status ?? null,
      hoursBrokenWeek: hoursBroken(inWindow, since),
      history: checks.slice(-30).map((c) => ({ status: c.status, createdAt: c.createdAt })),
      regressed: isRegressed,
    });
  }
  return out;
}
