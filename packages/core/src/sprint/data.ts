/** DB read helpers for Scrum Mode (pseudonymised data only). */
import { prisma } from "@autopilot/db";
import { getSetting } from "../settings";
import { detectStuck, type StuckInputItem, type StuckItem } from "./stuck";
import type { PullRequestInfo } from "./types";

export interface SprintSettings {
  normalWaitingStatuses: string[];
  stuckThresholdDays: number;
  standupTime: string;
  forbiddenTerms: string[];
}

export async function sprintSettings(): Promise<SprintSettings> {
  return {
    normalWaitingStatuses: await getSetting<string[]>("sprint.normalWaitingStatuses", ["Waiting for QA"]),
    stuckThresholdDays: await getSetting<number>("sprint.stuckThresholdDays", 2),
    standupTime: await getSetting<string>("sprint.standupTime", "09:30"),
    forbiddenTerms: await getSetting<string[]>("team.forbiddenTerms", []),
  };
}

export function activeSprint() {
  return prisma.sprint.findFirst({ where: { state: "active" }, orderBy: { start: "desc" } });
}

export function previousSprint(activeStart: Date) {
  return prisma.sprint.findFirst({ where: { state: "closed", start: { lt: activeStart } }, orderBy: { start: "desc" } });
}

export function sprintItems(sprintId: string) {
  return prisma.workItem.findMany({ where: { sprintId }, orderBy: { key: "asc" } });
}

/** Code goals whose latest check on main is red. */
export async function redGoalIds(): Promise<Set<string>> {
  const out = new Set<string>();
  for (const goalId of ["no-critical-vulns", "main-build-green", "setup-docs-work"]) {
    const c = await prisma.goalCheck.findFirst({ where: { goalId, ref: "main" }, orderBy: { createdAt: "desc" }, select: { status: true } });
    if (c?.status === "red") out.add(goalId);
  }
  return out;
}

type ItemRow = Awaited<ReturnType<typeof sprintItems>>[number];

export function toStuckInput(i: ItemRow): StuckInputItem {
  return {
    key: i.key,
    title: i.title,
    status: i.status,
    statusCategory: i.statusCategory,
    labels: i.labels,
    lastActivityAt: i.lastActivityAt,
    pullRequests: (i.pullRequests as unknown as PullRequestInfo[]) ?? [],
    linkedGoalId: i.linkedGoalId,
    assigneeRef: i.assigneeRef,
  };
}

export async function currentStuck(now = new Date()): Promise<{ sprint: Awaited<ReturnType<typeof activeSprint>>; stuck: StuckItem[]; settings: SprintSettings; items: ItemRow[] }> {
  const sprint = await activeSprint();
  const settings = await sprintSettings();
  if (!sprint) return { sprint, stuck: [], settings, items: [] };
  const items = await sprintItems(sprint.id);
  const stuck = detectStuck(items.map(toStuckInput), {
    now,
    thresholdDays: settings.stuckThresholdDays,
    normalWaitingStatuses: settings.normalWaitingStatuses,
    redGoals: await redGoalIds(),
  });
  return { sprint, stuck, settings, items };
}

/** Local calendar date YYYY-MM-DD. */
export function localDate(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Today's standup time as a Date (local). */
export function standupAt(time: string, now = new Date()): Date {
  const [h, m] = time.split(":").map((x) => Number(x));
  const d = new Date(now);
  d.setHours(Number.isFinite(h) ? h! : 9, Number.isFinite(m) ? m! : 30, 0, 0);
  return d;
}
