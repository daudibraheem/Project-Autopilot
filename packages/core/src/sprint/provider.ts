import { prisma } from "@autopilot/db";
import { createJiraHttp, jiraConfigFromEnv } from "./jira-http";
import { JiraCloudProvider } from "./jira-provider";
import { MockSprintProvider, type MockSprintOptions } from "./mock-provider";
import { syncSprint } from "./sync";
import type { SprintProvider } from "./types";

export function sprintProviderName(): "mock" | "jira" {
  return (process.env.SPRINT_PROVIDER ?? "mock").split("#")[0]!.trim() === "jira" ? "jira" : "mock";
}

/** SPRINT_PROVIDER selects mock (default) or jira. */
export function getSprintProvider(mockOpts: MockSprintOptions = {}): SprintProvider {
  if (sprintProviderName() === "jira") {
    const { config, missing } = jiraConfigFromEnv();
    if (!config) throw new Error(`SPRINT_PROVIDER=jira but missing: ${missing.join(", ")}`);
    return new JiraCloudProvider(config, createJiraHttp(config));
  }
  return new MockSprintProvider(mockOpts);
}

/**
 * Job IDs for the two mock agent-work items: the newest real merged Autopilot jobs if they exist,
 * otherwise minimal seeded job rows (source "seed-sprint") so the links always work.
 */
export async function agentJobIdsForMock(): Promise<{ securityFix: string; docsFix: string }> {
  const find = (jobType: string) =>
    prisma.job.findFirst({ where: { jobType, status: { in: ["merged", "approved"] } }, orderBy: { finishedAt: "desc" }, select: { id: true } });
  const ensure = async (jobType: string, goalId: string, id: string, explanation: string) => {
    const real = await find(jobType);
    if (real) return real.id;
    await prisma.job.upsert({
      where: { id },
      create: {
        id,
        goalId,
        jobType,
        status: "merged",
        branch: `autopilot/${id}`,
        source: "seed-sprint",
        explanation,
        workerModel: "claude-haiku-5-5",
        verifierModel: "claude-sonnet-5-5",
        provider: "mock",
        finishedAt: new Date(Date.now() - 2 * 86400_000),
      },
      update: {},
    });
    return id;
  };
  return {
    securityFix: await ensure("dependency-security-fix", "no-critical-vulns", "j-seed-g1", "Seeded for the sprint demo: tinydate bumped to 2.0.0 and the renamed call site fixed."),
    docsFix: await ensure("setup-docs-fix", "setup-docs-work", "j-seed-g3", "Seeded for the sprint demo: README setup step points at scripts/bootstrap.js."),
  };
}

/** Sync from the configured provider (mock links agent items to real/seeded jobs). */
export async function syncConfiguredSprint() {
  const provider = sprintProviderName() === "mock" ? getSprintProvider({ agentJobIds: await agentJobIdsForMock() }) : getSprintProvider();
  return syncSprint(provider);
}
