/** Team-health standing goals (Scrum Mode). Plain code only, no LLM. */
import { prisma } from "@autopilot/db";
import { REASON_LABEL } from "../sprint/stuck";
import { currentStuck, localDate, sprintSettings, standupAt, activeSprint } from "../sprint/data";
import { forecastSprint, forecastStatus } from "../sprint/forecast";
import type { StandingGoal } from "./types";

export const s1StandupBriefReady: StandingGoal = {
  id: "standup-brief-ready",
  label: "S1 · Standup brief ready",
  description: "Red if no published brief exists for today by the standup time. Amber in the 60 minutes before.",
  async check() {
    const sprint = await activeSprint();
    if (!sprint) return { goalId: "standup-brief-ready", status: "amber", summary: "No active sprint synced", evidence: {} };
    const { standupTime } = await sprintSettings();
    const now = new Date();
    const today = localDate(now);
    const published = await prisma.standupBrief.findFirst({ where: { date: today, status: "published" }, orderBy: { publishedAt: "desc" } });
    const due = standupAt(standupTime, now);
    const pending = await prisma.standupBrief.findFirst({ where: { date: today, status: "awaiting_approval" } });
    const evidence = { date: today, standupTime, publishedBriefId: published?.id ?? null, awaitingApprovalBriefId: pending?.id ?? null, sprint: sprint.name };
    if (published) return { goalId: "standup-brief-ready", status: "green", summary: `Today's brief published at ${published.publishedAt?.toTimeString().slice(0, 5)}`, evidence };
    if (now >= due) {
      return {
        goalId: "standup-brief-ready",
        status: "red",
        summary: `No published brief for ${today}; standup was due at ${standupTime}${pending ? " (a brief is waiting for approval)" : ""}`,
        evidence,
      };
    }
    if (due.getTime() - now.getTime() <= 60 * 60_000) {
      return { goalId: "standup-brief-ready", status: "amber", summary: `Standup at ${standupTime}; no brief published yet`, evidence };
    }
    return { goalId: "standup-brief-ready", status: "green", summary: `Next brief due at ${standupTime}`, evidence };
  },
};

export const s2NoStuckWork: StandingGoal = {
  id: "no-stuck-work",
  label: "S2 · No stuck work",
  description: "Red if any sprint item is stuck past the threshold (no activity, review waiting, blocked by build, labelled blocked).",
  async check() {
    const { sprint, stuck, settings } = await currentStuck();
    if (!sprint) return { goalId: "no-stuck-work", status: "amber", summary: "No active sprint synced", evidence: {} };
    const evidence = {
      sprint: sprint.name,
      thresholdDays: settings.stuckThresholdDays,
      normalWaitingStatuses: settings.normalWaitingStatuses,
      stuck: stuck.map((s) => ({ key: s.key, title: s.title, status: s.status, reasons: s.reasons })),
    };
    if (stuck.length === 0) return { goalId: "no-stuck-work", status: "green", summary: "No stuck items", evidence };
    return {
      goalId: "no-stuck-work",
      status: "red",
      summary: `${stuck.length} stuck: ${stuck.map((s) => `${s.key} (${s.reasons.map((r) => REASON_LABEL[r.code].toLowerCase()).join(", ")})`).join("; ")}`,
      evidence,
    };
  },
};

export const s3SprintOnTrack: StandingGoal = {
  id: "sprint-on-track",
  label: "S3 · Sprint forecast",
  description: "Monte Carlo forecast of finishing the sprint's work. Green ≥ 70%, amber 40–70%, red below 40%. Check-only: never spawns a job.",
  async check() {
    const { sprint, forecast } = await forecastSprint();
    if (!sprint || !forecast) return { goalId: "sprint-on-track", status: "amber", summary: "No active sprint synced", evidence: {} };
    const pct = Math.round(forecast.probability * 100);
    return {
      goalId: "sprint-on-track",
      status: forecastStatus(forecast.probability),
      summary: `${pct}% chance of hitting the sprint goal (${forecast.remainingPoints} of ${forecast.totalPoints} pts left, ${forecast.daysRemaining} day(s) to go)`,
      evidence: {
        probability: forecast.probability,
        remainingPoints: forecast.remainingPoints,
        completedPoints: forecast.completedPoints,
        totalPoints: forecast.totalPoints,
        daysRemaining: forecast.daysRemaining,
        finalP10: forecast.finalP10,
        finalP50: forecast.finalP50,
        finalP90: forecast.finalP90,
        pastThroughput: forecast.pastThroughput,
        why: forecast.why,
      },
    };
  },
};
