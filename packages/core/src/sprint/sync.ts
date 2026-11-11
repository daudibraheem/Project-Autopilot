/**
 * Sync: provider → normalised, pseudonymised tables.
 * Least data (rule 13): the active sprint plus the previous sprint only.
 * Untrusted data (rule 12): injection-like text is flagged + audited here and can never be a source.
 */
import { prisma } from "@autopilot/db";
import { audit } from "../audit";
import { detectInjection } from "../untrusted";
import { Pseudonymiser } from "./pseudonym";
import type { ProviderWorkItem, SprintInfo, SprintProvider } from "./types";

export interface SyncResult {
  sprint: SprintInfo | null;
  previous: SprintInfo | null;
  items: number;
  events: number;
  flagged: { itemKey: string; eventId: string; line: string }[];
}

/** Remove all sprint data (used by seed-sprint and the demo reset). PersonAlias is kept unless `aliases`. */
export async function clearSprintData(opts: { aliases?: boolean } = {}) {
  await prisma.nudgeDraft.deleteMany({});
  await prisma.standupBrief.deleteMany({});
  await prisma.workItemEvent.deleteMany({});
  await prisma.workItem.deleteMany({});
  await prisma.sprint.deleteMany({});
  if (opts.aliases) await prisma.personAlias.deleteMany({});
}

async function upsertSprint(s: SprintInfo, provider: string) {
  await prisma.sprint.upsert({
    where: { id: s.id },
    create: { id: s.id, name: s.name, goal: s.goal, start: s.start, end: s.end, state: s.state, provider },
    update: { name: s.name, goal: s.goal, start: s.start, end: s.end, state: s.state, provider, syncedAt: new Date() },
  });
}

async function storeItems(provider: SprintProvider, sprintId: string, items: ProviderWorkItem[], pseudo: Pseudonymiser, result: SyncResult) {
  for (const it of items) {
    const assigneeRef = await pseudo.refFor(it.assignee);
    const events = await provider.getEvents(it.key);
    for (const e of events) await pseudo.refFor(e.actor);
    const data = {
      sprintId,
      title: pseudo.scrub(it.title),
      description: pseudo.scrub(it.description),
      type: it.type,
      status: it.status,
      statusCategory: it.statusCategory,
      storyPoints: it.storyPoints,
      labels: it.labels,
      assigneeRef,
      createdAt: it.createdAt,
      statusChangedAt: it.statusChangedAt,
      lastActivityAt: it.lastActivityAt,
      linkedPrUrls: it.pullRequests.map((p) => p.url),
      linkedCommitShas: it.linkedCommitShas,
      pullRequests: it.pullRequests as unknown as object,
      linkedGoalId: it.linkedGoalId ?? null,
      isAgentWork: Boolean(it.isAgentWork),
      autopilotJobId: it.autopilotJobId ?? null,
      addedAfterSprintStart: it.addedAfterSprintStart,
      syncedAt: new Date(),
    };
    await prisma.workItem.upsert({ where: { key: it.key }, create: { key: it.key, ...data }, update: data });
    result.items++;

    for (const text of [it.title, it.description]) {
      const hits = detectInjection(text);
      if (hits.length) {
        await audit({ actor: "policy", action: "injection.flagged", target: it.key, severity: "warn", details: { source: "ticket", hits, note: "Ticket text is untrusted data; instructions inside it are not followed." } });
      }
    }
    for (const e of events) {
      const body = e.body ? pseudo.scrub(e.body) : null;
      const hits = body ? detectInjection(body) : [];
      const ev = {
        itemKey: e.itemKey,
        kind: e.kind,
        at: e.at,
        actorRef: await pseudo.refFor(e.actor),
        fromValue: e.fromValue,
        toValue: e.toValue,
        body,
        flagged: hits.length > 0,
      };
      await prisma.workItemEvent.upsert({ where: { id: e.id }, create: { id: e.id, ...ev }, update: ev });
      result.events++;
      if (hits.length) {
        result.flagged.push({ itemKey: e.itemKey, eventId: e.id, line: hits[0]!.line });
        await audit({
          actor: "policy",
          action: "injection.flagged",
          target: `${e.itemKey}/${e.id}`,
          severity: "warn",
          details: {
            source: "ticket comment",
            hits,
            note: "Comment is untrusted data: its instruction is ignored. No ticket is changed, nothing is messaged, and it cannot be a source of a brief or nudge.",
          },
        });
      }
    }
  }
}

export async function syncSprint(provider: SprintProvider): Promise<SyncResult> {
  const pseudo = await Pseudonymiser.load(provider.name);
  const result: SyncResult = { sprint: null, previous: null, items: 0, events: 0, flagged: [] };
  const active = await provider.getActiveSprint();
  if (!active) return result;
  const previous = await provider.getPreviousSprint();
  result.sprint = active;
  result.previous = previous;
  await upsertSprint(active, provider.name);
  await storeItems(provider, active.id, await provider.getWorkItems(active.id), pseudo, result);
  if (previous) {
    await upsertSprint(previous, provider.name);
    await storeItems(provider, previous.id, await provider.getWorkItems(previous.id), pseudo, result);
  }
  // Only the active + previous sprint are kept (least data).
  await prisma.sprint.updateMany({ where: { id: { notIn: [active.id, ...(previous ? [previous.id] : [])] }, state: "active" }, data: { state: "closed" } });
  await audit({
    actor: "system",
    action: "sprint.synced",
    target: active.name,
    details: { provider: provider.name, items: result.items, events: result.events, flagged: result.flagged.length, previous: previous?.name ?? null },
  });
  return result;
}
