/**
 * Facts first: plain code builds everything the brief/nudges may say. The model only words it.
 * All data here is already pseudonymised (sync.ts). Flagged comments are marked and can never be sources.
 */
import { prisma } from "@autopilot/db";
import { getTrust } from "../trust";
import { currentStuck, localDate, previousSprint } from "./data";
import type { StuckReasonCode } from "./stuck";

export interface SprintFacts {
  sprint: { id: string; name: string; goal: string; start: string; end: string; day: number; days: number };
  generatedAt: string;
  since: string;
  moved: { key: string; title: string; from: string | null; to: string | null; eventId: string }[];
  done: { key: string; title: string; points: number | null }[];
  inProgress: { key: string; title: string; status: string }[];
  stuck: { key: string; title: string; status: string; reasons: { code: StuckReasonCode; detail: string }[] }[];
  addedMidSprint: { key: string; title: string; eventId: string | null }[];
  agentWork: { key: string; title: string; jobId: string | null; jobType: string | null; jobStatus: string | null; trustLevel: number | null }[];
  normalWaiting: { key: string; title: string; status: string }[];
  recentComments: { eventId: string; key: string; body: string; flagged: boolean }[];
  previousSprint: { name: string; done: number; points: number } | null;
  counts: Counts;
}

export interface Counts {
  done: number;
  inProgress: number;
  stuck: number;
  addedMidSprint: number;
}

const DAY = 86400_000;

/** Recompute counts straight from the database (the gate uses this, never the model's numbers). */
export async function recomputeCounts(now = new Date()): Promise<Counts> {
  const { sprint, stuck, items } = await currentStuck(now);
  if (!sprint) return { done: 0, inProgress: 0, stuck: 0, addedMidSprint: 0 };
  return {
    done: items.filter((i) => i.statusCategory === "done").length,
    inProgress: items.filter((i) => i.statusCategory === "in_progress").length,
    stuck: stuck.length,
    addedMidSprint: items.filter((i) => i.addedAfterSprintStart).length,
  };
}

export async function buildFacts(now = new Date()): Promise<SprintFacts | null> {
  const { sprint, stuck, settings, items } = await currentStuck(now);
  if (!sprint) return null;
  const lastBrief = await prisma.standupBrief.findFirst({ where: { sprintId: sprint.id, status: "published", date: { lt: localDate(now) } }, orderBy: { publishedAt: "desc" } });
  const since = lastBrief?.publishedAt ?? new Date(now.getTime() - DAY);
  const keys = items.map((i) => i.key);
  const events = await prisma.workItemEvent.findMany({ where: { itemKey: { in: keys } }, orderBy: { at: "asc" } });
  const byKey = new Map(items.map((i) => [i.key, i]));
  const isNormal = (s: string) => settings.normalWaitingStatuses.some((n) => n.toLowerCase() === s.toLowerCase());

  const agentWork = [];
  for (const i of items.filter((x) => x.isAgentWork)) {
    const job = i.autopilotJobId ? await prisma.job.findUnique({ where: { id: i.autopilotJobId }, select: { id: true, jobType: true, status: true } }) : null;
    const trust = job ? await getTrust(job.jobType) : null;
    agentWork.push({ key: i.key, title: i.title, jobId: job?.id ?? null, jobType: job?.jobType ?? null, jobStatus: job?.status ?? null, trustLevel: trust?.level ?? null });
  }

  const prev = await previousSprint(sprint.start);
  let previous: SprintFacts["previousSprint"] = null;
  if (prev) {
    const prevItems = await prisma.workItem.findMany({ where: { sprintId: prev.id, statusCategory: "done" } });
    previous = { name: prev.name, done: prevItems.length, points: prevItems.reduce((s, i) => s + (i.storyPoints ?? 0), 0) };
  }

  const done = items.filter((i) => i.statusCategory === "done");
  const days = Math.max(1, Math.round((sprint.end.getTime() - sprint.start.getTime()) / DAY));
  return {
    sprint: {
      id: sprint.id,
      name: sprint.name,
      goal: sprint.goal,
      start: localDate(sprint.start),
      end: localDate(sprint.end),
      day: Math.min(days, Math.max(1, Math.ceil((now.getTime() - sprint.start.getTime()) / DAY))),
      days,
    },
    generatedAt: now.toISOString(),
    since: since.toISOString(),
    moved: events
      .filter((e) => e.kind === "status_change" && e.at > since)
      .map((e) => ({ key: e.itemKey, title: byKey.get(e.itemKey)?.title ?? "", from: e.fromValue, to: e.toValue, eventId: e.id })),
    done: done.map((i) => ({ key: i.key, title: i.title, points: i.storyPoints })),
    inProgress: items.filter((i) => i.statusCategory === "in_progress").map((i) => ({ key: i.key, title: i.title, status: i.status })),
    stuck: stuck.map((s) => ({ key: s.key, title: s.title, status: s.status, reasons: s.reasons })),
    addedMidSprint: items
      .filter((i) => i.addedAfterSprintStart)
      .map((i) => ({ key: i.key, title: i.title, eventId: events.find((e) => e.itemKey === i.key && e.kind === "sprint_added")?.id ?? null })),
    agentWork,
    normalWaiting: items.filter((i) => i.statusCategory !== "done" && isNormal(i.status)).map((i) => ({ key: i.key, title: i.title, status: i.status })),
    recentComments: events
      .filter((e) => e.kind === "comment" && e.body && e.at.getTime() > now.getTime() - 2 * DAY)
      .map((e) => ({ eventId: e.id, key: e.itemKey, body: e.body!, flagged: e.flagged })),
    previousSprint: previous,
    counts: {
      done: done.length,
      inProgress: items.filter((i) => i.statusCategory === "in_progress").length,
      stuck: stuck.length,
      addedMidSprint: items.filter((i) => i.addedAfterSprintStart).length,
    },
  };
}

/** Every id a sentence may cite: item keys (active + previous sprint), event ids, job ids. Flagged events excluded. */
export async function knownSources(): Promise<{ all: Set<string>; flagged: Set<string> }> {
  const items = await prisma.workItem.findMany({ select: { key: true } });
  const events = await prisma.workItemEvent.findMany({ select: { id: true, flagged: true } });
  const jobs = await prisma.job.findMany({ select: { id: true } });
  return {
    all: new Set([...items.map((i) => i.key), ...events.filter((e) => !e.flagged).map((e) => e.id), ...jobs.map((j) => j.id)]),
    flagged: new Set(events.filter((e) => e.flagged).map((e) => e.id)),
  };
}
