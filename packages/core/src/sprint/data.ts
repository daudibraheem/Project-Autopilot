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

/** Ref used for a seeded, self-contained "blocked build" snapshot (so the Scrum demo is order-independent). */
export const SPRINT_BUILD_REF = "sprint-build";

/**
 * Goals a sprint item can be "blocked by build" on: the live main-build check (ref "main") when red,
 * plus any seeded red build snapshot (ref "sprint-build") planted by seed-sprint. The snapshot lets
 * blocked_by_build work in any demo order, even after the code demo has fixed G2 on main.
 */
export async function redGoalIds(): Promise<Set<string>> {
  const out = new Set<string>();
  for (const goalId of ["no-critical-vulns", "main-build-green", "setup-docs-work"]) {
    const c = await prisma.goalCheck.findFirst({ where: { goalId, ref: "main" }, orderBy: { createdAt: "desc" }, select: { status: true } });
    if (c?.status === "red") out.add(goalId);
  }
  const seeded = await prisma.goalCheck.findMany({ where: { ref: SPRINT_BUILD_REF, status: "red" }, select: { goalId: true } });
  for (const s of seeded) out.add(s.goalId);
  return out;
}

/** Deterministic throughput (story points completed) of 6 past sprints, for the forecast.
 * Realistic ~68/sprint band; with the seeded sprint this yields a ~amber start that a scope add drops. */
export const PAST_THROUGHPUT = [68, 72, 70, 74, 66, 71];
const DAY_MS = 86400_000;

/** Seed 6 closed past sprints (throughput only) so the Monte Carlo forecast has history. Mock demo only. */
export async function seedPastSprints(activeStart: Date): Promise<void> {
  await prisma.sprint.deleteMany({ where: { provider: "mock", state: "closed", throughput: { not: null } } });
  for (let i = 0; i < PAST_THROUGHPUT.length; i++) {
    const end = new Date(activeStart.getTime() - (i * 14 + 2) * DAY_MS);
    const start = new Date(end.getTime() - 13 * DAY_MS);
    await prisma.sprint.create({
      data: { id: `past-sprint-${i + 1}`, name: `Payments Sprint ${12 - i}`, goal: "", start, end, state: "closed", provider: "mock", throughput: PAST_THROUGHPUT[i] },
    });
  }
}

/** Plant a self-contained red build snapshot for the sprint's blocked item (mock demo only). */
export async function seedBlockedBuild(goalId = "main-build-green"): Promise<void> {
  await prisma.goalCheck.deleteMany({ where: { ref: SPRINT_BUILD_REF } });
  await prisma.goalCheck.create({
    data: {
      goalId,
      ref: SPRINT_BUILD_REF,
      status: "red",
      summary: "Seeded blocked build: the linked Autopilot build for this sprint is red (demo; independent of the live main build so the Scrum demo works in any order)",
      evidence: {},
      durationMs: 0,
    },
  });
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
