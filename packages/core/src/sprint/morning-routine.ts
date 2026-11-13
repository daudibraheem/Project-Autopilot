/**
 * "Run morning routine": the full scrum flow as one action, with named stages for a live pipeline visual.
 * Stages: Check goals → Find stuck work → Draft brief → Verifier check → Safety gate → Waiting for you.
 * The brief and nudge jobs run inline (mock mode) through the real worker → verifier → gate pipeline;
 * the watchable per-stage delays are added by the UI, not here.
 */
import { prisma } from "@autopilot/db";
import { createJob, OPEN_STATUSES } from "../conductor";
import { runGoalChecks, TEAM_GOAL_IDS } from "../goals/index";
import { runJob } from "../pipeline";
import { isKillSwitchOn } from "../settings";
import { currentStuck } from "./data";
import { forecastSprint } from "./forecast";

export const MORNING_ROUTINE_STAGES = [
  { key: "check_goals", label: "Check goals", caption: "Running the standing team-health checks — all plain code." },
  { key: "find_stuck", label: "Find stuck work", caption: "Scanning the board for no activity, reviews waiting, or work blocked by a failing build." },
  { key: "draft_brief", label: "Draft brief", caption: "An AI worker words the facts into a standup brief. It only writes; every number comes from code." },
  { key: "verifier_check", label: "Verifier check", caption: "A different AI checks every claim against the data — no blame, no invented blockers." },
  { key: "safety_gate", label: "Safety gate", caption: "Plain code re-checks sources, counts, people-safety and the verifier verdict." },
  { key: "waiting", label: "Waiting for you", caption: "Nothing is sent. The brief and nudges wait for your approval." },
] as const;

export type MorningStageKey = (typeof MORNING_ROUTINE_STAGES)[number]["key"];

export interface MorningRoutineResult {
  stages: { key: MorningStageKey; status: "done" | "failed"; detail: string }[];
  briefJobId: string | null;
  nudgeJobId: string | null;
  stuckCount: number;
  briefStatus: string | null;
  nudgeCount: number;
  forecastPct: number | null;
}

export async function runMorningRoutine(): Promise<MorningRoutineResult> {
  if (await isKillSwitchOn()) throw new Error("Kill switch is on: the morning routine is paused");
  const stages: MorningRoutineResult["stages"] = [];

  await runGoalChecks(TEAM_GOAL_IDS, "morning-routine");
  stages.push({ key: "check_goals", status: "done", detail: "Team goals checked" });

  const { stuck } = await currentStuck();
  stages.push({ key: "find_stuck", status: "done", detail: `${stuck.length} stuck item(s) found` });

  // Brief job: worker → verifier → gate (runs inline so it works without the worker process).
  const openBrief = await prisma.job.findFirst({ where: { jobType: "standup-brief", status: { in: OPEN_STATUSES } }, orderBy: { createdAt: "desc" } });
  const briefJobId = openBrief?.id ?? (await createJob("standup-brief-ready", "dashboard", { enqueue: false }));
  if (!openBrief) await runJob(briefJobId);
  const briefJob = await prisma.job.findUnique({ where: { id: briefJobId } });
  const briefOk = briefJob?.status === "awaiting_approval" || briefJob?.status === "published";
  stages.push({ key: "draft_brief", status: "done", detail: "Brief drafted from the facts" });
  stages.push({ key: "verifier_check", status: briefOk ? "done" : "failed", detail: briefOk ? "A different AI verified every claim" : "Verifier blocked the brief" });
  stages.push({ key: "safety_gate", status: briefOk ? "done" : "failed", detail: briefOk ? "Gate: sources, counts and people-safety all green" : "Gate failed" });

  const openNudge = await prisma.job.findFirst({ where: { jobType: "nudge-draft", status: { in: OPEN_STATUSES } }, orderBy: { createdAt: "desc" } });
  const nudgeJobId = openNudge?.id ?? (await createJob("no-stuck-work", "dashboard", { enqueue: false }));
  if (!openNudge) await runJob(nudgeJobId);
  const nudgeCount = await prisma.nudgeDraft.count({ where: { jobId: nudgeJobId } });
  stages.push({ key: "waiting", status: "done", detail: `Brief and ${nudgeCount} nudge(s) ready for your approval` });

  const { forecast } = await forecastSprint();
  const brief = await prisma.standupBrief.findFirst({ where: { jobId: briefJobId }, orderBy: { createdAt: "desc" } });
  return { stages, briefJobId, nudgeJobId, stuckCount: stuck.length, briefStatus: brief?.status ?? null, nudgeCount, forecastPct: forecast ? Math.round(forecast.probability * 100) : null };
}
