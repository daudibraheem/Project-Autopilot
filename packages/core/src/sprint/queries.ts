/** Read models for the Scrum Mode pages. `people` (pseudonym → real name) is for UI rendering only. */
import { prisma } from "@autopilot/db";
import { getTrust, LEVEL_LABEL } from "../trust";
import { currentStuck, localDate, redGoalIds } from "./data";
import { recomputeCounts } from "./facts";
import { aliasMapForUi } from "./pseudonym";

export async function sprintPageData() {
  const { sprint, stuck, items, settings } = await currentStuck();
  const people = await aliasMapForUi();
  if (!sprint) return { sprint: null, items: [], people, settings, redGoals: [] as string[] };
  const stuckBy = new Map(stuck.map((s) => [s.key, s.reasons]));
  const jobIds = items.map((i) => i.autopilotJobId).filter((x): x is string => Boolean(x));
  const jobs = await prisma.job.findMany({ where: { id: { in: jobIds } }, select: { id: true, jobType: true, status: true } });
  const trust: Record<string, { level: number; label: string }> = {};
  for (const j of jobs) if (!trust[j.jobType]) trust[j.jobType] = { level: (await getTrust(j.jobType)).level, label: LEVEL_LABEL[(await getTrust(j.jobType)).level]! };
  const events = await prisma.workItemEvent.findMany({ where: { itemKey: { in: items.map((i) => i.key) } }, orderBy: { at: "asc" } });
  const isNormal = (s: string) => settings.normalWaitingStatuses.some((n) => n.toLowerCase() === s.toLowerCase());
  return {
    sprint: { ...sprint },
    settings,
    people,
    redGoals: [...(await redGoalIds())],
    items: items.map((i) => {
      const job = jobs.find((j) => j.id === i.autopilotJobId);
      return {
        ...i,
        stuckReasons: stuckBy.get(i.key) ?? [],
        normalWaiting: i.statusCategory !== "done" && isNormal(i.status),
        job: job ? { ...job, trust: trust[job.jobType] } : null,
        events: events.filter((e) => e.itemKey === i.key).map((e) => ({ ...e, body: e.body })),
      };
    }),
  };
}

export async function standupPageData() {
  const today = localDate();
  const briefs = await prisma.standupBrief.findMany({ orderBy: { createdAt: "desc" }, take: 30 });
  const todays = briefs.find((b) => b.date === today && b.status === "published") ?? briefs.find((b) => b.date === today && b.status === "awaiting_approval") ?? null;
  const openJob = await prisma.job.findFirst({
    where: { jobType: "standup-brief", status: { in: ["queued", "running", "verifying", "gating", "changes_requested"] } },
    select: { id: true, status: true },
  });
  return {
    today,
    brief: todays,
    history: briefs.map((b) => ({ id: b.id, date: b.date, status: b.status, jobId: b.jobId, publishedAt: b.publishedAt, publishedBy: b.publishedBy, createdAt: b.createdAt })),
    counts: await recomputeCounts(),
    openJob,
    people: await aliasMapForUi(),
  };
}

export async function briefById(id: string) {
  return { brief: await prisma.standupBrief.findUnique({ where: { id } }), people: await aliasMapForUi() };
}

/** Team-job extras for job detail / approvals. */
export async function teamJobExtras(jobId: string) {
  const brief = await prisma.standupBrief.findFirst({ where: { jobId }, orderBy: { createdAt: "desc" } });
  const nudges = await prisma.nudgeDraft.findMany({ where: { jobId }, orderBy: { itemKey: "asc" } });
  return { brief, nudges };
}
