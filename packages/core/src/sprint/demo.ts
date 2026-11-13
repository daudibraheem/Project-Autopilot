/**
 * Scrum demo seeding and the presenter "Reset demo" / "Add mid-sprint item" actions (mock only).
 * One source of truth for the starting state so seed-sprint, the reset endpoint and the demo all match.
 */
import { prisma } from "@autopilot/db";
import { runGoalChecks, TEAM_GOAL_IDS } from "../goals/index";
import { activeSprint, seedBlockedBuild, seedPastSprints } from "./data";
import { forecastSprint } from "./forecast";
import { MockSprintProvider } from "./mock-provider";
import { agentJobIdsForMock } from "./provider";
import { clearSprintData, syncSprint } from "./sync";

/** Seed the exact Scrum starting state: mock sprint + blocked-build snapshot + 6 past sprints + team goal checks. */
export async function seedScrumDemo() {
  await clearSprintData({ aliases: true });
  const r = await syncSprint(new MockSprintProvider({ agentJobIds: await agentJobIdsForMock() }));
  await seedBlockedBuild();
  if (r.sprint) await seedPastSprints(r.sprint.start);
  await runGoalChecks(TEAM_GOAL_IDS, "seed-sprint");
  return r;
}

/** Presenter "Reset demo": drop team jobs/briefs/nudges from earlier runs, then re-seed the starting state. */
export async function resetScrumDemo() {
  await prisma.job.deleteMany({ where: { jobType: { in: ["standup-brief", "nudge-draft"] } } });
  return seedScrumDemo();
}

/** Add one mid-sprint item (scope change) and recompute the forecast. Returns the new item + forecast. */
export async function addMidSprintItem(points = 3): Promise<{ key: string; title: string; points: number; forecastPct: number | null }> {
  const sprint = await activeSprint();
  if (!sprint) throw new Error("No active sprint to add an item to");
  const before = (await forecastSprint()).forecast;
  const items = await prisma.workItem.findMany({ where: { sprintId: sprint.id }, select: { key: true } });
  const nums = items.map((i) => Number(/-(\d+)$/.exec(i.key)?.[1] ?? "0"));
  const key = `PAY-${Math.max(198, ...nums) + 1}`;
  const alias = await prisma.personAlias.findFirst({ orderBy: { pseudonym: "asc" }, select: { pseudonym: true } });
  const title = "Expedited: VAT line on partial refunds";
  const now = new Date();
  await prisma.workItem.create({
    data: {
      key,
      sprintId: sprint.id,
      title,
      type: "Story",
      status: "To Do",
      statusCategory: "todo",
      storyPoints: points,
      labels: ["expedited"],
      assigneeRef: alias?.pseudonym ?? "Member A",
      createdAt: now,
      statusChangedAt: now,
      lastActivityAt: now,
      addedAfterSprintStart: true,
    },
  });
  await prisma.workItemEvent.create({ data: { id: `${key}-added`, itemKey: key, kind: "sprint_added", at: now, toValue: sprint.name, body: "Added mid-sprint by a stakeholder." } });
  // Recompute the forecast goal so the Overview and S3 reflect the new scope.
  await runGoalChecks(["sprint-on-track"], "scope-change");
  const after = (await forecastSprint()).forecast;
  const beforePct = before ? Math.round(before.probability * 100) : null;
  const afterPct = after ? Math.round(after.probability * 100) : null;
  return { key, title, points, forecastPct: afterPct, ...(beforePct !== null && afterPct !== null ? { droppedBy: beforePct - afterPct } : {}) } as { key: string; title: string; points: number; forecastPct: number | null; droppedBy?: number };
}
