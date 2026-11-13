/** Read models for the dashboard (used by apps/web route handlers). */
import { prisma } from "@autopilot/db";
import { getConfig, githubMode } from "./config";
import { OPEN_STATUSES } from "./conductor";
import { GOAL_LABEL, isTeamJobType, JOB_TYPES, TEAM_GOAL_IDS } from "./contract";
import { aliasMapForUi } from "./sprint/pseudonym";
import { teamJobExtras } from "./sprint/queries";
import { TEAM_GATE_LABELS } from "./sprint/team-gate";
import { GATE_LABELS } from "./gate";
import { goalOverview } from "./goals/index";
import { routeModels } from "./llm/router";
import { loadFlakyModel, MODEL_NAME } from "./ml/flaky";
import { sandboxStatus } from "./sandbox";
import { isKillSwitchOn } from "./settings";
import { getTrust, LEVEL_LABEL } from "./trust";
import { getSetting } from "./settings";

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function systemInfo() {
  const cfg = getConfig();
  let route: { workerModel: string; verifierModel: string } | null = null;
  let routeError: string | null = null;
  try {
    route = routeModels("easy", cfg);
  } catch (e) {
    routeError = (e as Error).message;
  }
  const sprint = await prisma.sprint.findFirst({ where: { state: "active" }, orderBy: { start: "desc" }, select: { name: true, start: true, end: true } });
  return {
    provider: cfg.provider,
    workerModel: route?.workerModel ?? cfg.workerModel,
    hardWorkerModel: cfg.hardWorkerModel,
    verifierModel: route?.verifierModel ?? cfg.verifierModel,
    routeError,
    sandbox: await sandboxStatus(),
    githubMode: githubMode(cfg),
    killSwitch: await isKillSwitchOn(),
    pendingApprovals: await prisma.job.count({ where: { status: "awaiting_approval" } }),
    sprint: sprint ? { name: sprint.name, start: sprint.start, end: sprint.end } : null,
  };
}

export async function overviewData() {
  const [goals, teamGoals, openJobs, todayCost, info] = await Promise.all([
    goalOverview(),
    goalOverview(TEAM_GOAL_IDS),
    prisma.job.findMany({ where: { status: { in: OPEN_STATUSES } }, select: { id: true, goalId: true, status: true } }),
    prisma.jobStep.aggregate({ where: { createdAt: { gte: startOfToday() } }, _sum: { costUsd: true } }),
    systemInfo(),
  ]);
  const lastCheck = await prisma.goalCheck.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  return {
    goals,
    teamGoals,
    openJobs,
    openJobCount: openJobs.length,
    todayCostUsd: todayCost._sum.costUsd ?? 0,
    lastCheckAt: lastCheck?.createdAt ?? null,
    ...info,
  };
}

export async function jobsList() {
  const jobs = await prisma.job.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
  return jobs.map((j) => ({
    id: j.id,
    goalId: j.goalId,
    goalLabel: GOAL_LABEL[j.goalId as keyof typeof GOAL_LABEL] ?? j.goalId,
    jobType: j.jobType,
    status: j.status,
    attempt: j.attempt,
    costUsd: j.costUsd,
    tokens: j.tokensIn + j.tokensOut,
    steps: j.stepsUsed,
    source: j.source,
    degraded: j.degraded,
    createdAt: j.createdAt,
    finishedAt: j.finishedAt,
    workerModel: j.workerModel,
  }));
}

export async function jobDetail(id: string) {
  const job = await prisma.job.findUnique({
    where: { id },
    include: {
      contract: true,
      steps: { orderBy: { index: "asc" } },
      verifierReports: { orderBy: { createdAt: "desc" } },
      gateResults: { orderBy: { createdAt: "asc" } },
      approvals: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!job) return null;
  const audit = await prisma.auditEvent.findMany({ where: { jobId: id }, orderBy: { createdAt: "asc" } });
  const trust = await getTrust(job.jobType);
  const steps = job.steps.map(({ checkpoint, ...s }) => ({ ...s, hasCheckpoint: checkpoint !== null }));
  return {
    ...job,
    steps,
    goalLabel: GOAL_LABEL[job.goalId as keyof typeof GOAL_LABEL] ?? job.goalId,
    gateResults: job.gateResults.filter((g) => g.attempt === job.attempt).map((g) => ({ ...g, label: GATE_LABELS[g.name] ?? TEAM_GATE_LABELS[g.name] ?? g.name })),
    audit,
    team: isTeamJobType(job.jobType) ? { ...(await teamJobExtras(job.id)), people: await aliasMapForUi() } : null,
    trust: { ...trust, label: LEVEL_LABEL[trust.level] },
  };
}

export async function approvalsQueue() {
  const jobs = await prisma.job.findMany({ where: { status: "awaiting_approval" }, orderBy: { createdAt: "asc" }, select: { id: true } });
  const details = await Promise.all(jobs.map((j) => jobDetail(j.id)));
  const recent = await prisma.approvalDecision.findMany({ orderBy: { createdAt: "desc" }, take: 10, include: { job: { select: { goalId: true, jobType: true } } } });
  return { pending: details.filter(Boolean), recent };
}

const JOB_TYPE_LABEL: Record<string, string> = {
  "dependency-security-fix": "Dependency security",
  "ci-failure-triage": "Flaky / build triage",
  "setup-docs-fix": "Setup-docs fix",
  "standup-brief": "Standup brief",
  "nudge-draft": "Nudge drafts",
};

const PASS_STATUSES = ["merged", "approved", "published"];

/** "Your AI teammates": per job type, trust, run stats, recent results and cost. */
export async function agentsData() {
  const agents = await Promise.all(
    JOB_TYPES.map(async (t) => {
      const trust = await getTrust(t);
      const jobs = await prisma.job.findMany({ where: { jobType: t }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, status: true, costUsd: true } });
      const decided = trust.approvals + trust.rejections + trust.gateFailures;
      return {
        jobType: t,
        label: JOB_TYPE_LABEL[t] ?? t,
        team: isTeamJobType(t) ? "team" : "code",
        trust: { level: trust.level, label: LEVEL_LABEL[trust.level], cap: trust.cap, autoMergeAllowed: trust.autoMergeAllowed },
        runs: trust.totalRuns,
        approvals: trust.approvals,
        rejections: trust.rejections,
        gateFailures: trust.gateFailures,
        approvalRate: decided ? trust.approvals / decided : null,
        costSprint: jobs.reduce((n, j) => n + j.costUsd, 0),
        last5: jobs.slice(0, 5).map((j) => ({ id: j.id, ok: PASS_STATUSES.includes(j.status), status: j.status })),
        cappedForever: trust.cap === 0,
      };
    }),
  );
  return { agents, levels: LEVEL_LABEL };
}

export async function trustData() {
  const promoteAfter = await getSetting<number>("trust.promoteAfter", 3);
  const records = await Promise.all(JOB_TYPES.map(async (t) => ({ ...(await getTrust(t)), label: LEVEL_LABEL[(await getTrust(t)).level] })));
  const events = await prisma.trustEvent.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
  const costs = await prisma.job.groupBy({ by: ["jobType"], _avg: { costUsd: true }, _sum: { costUsd: true }, _count: true });
  return { promoteAfter, records, events, costs, levels: LEVEL_LABEL };
}

export async function lessonsData() {
  return prisma.lesson.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
}

export async function auditData(filter: { actor?: string; action?: string; deniedOnly?: boolean }) {
  const events = await prisma.auditEvent.findMany({
    where: {
      ...(filter.actor ? { actor: filter.actor } : {}),
      ...(filter.action ? { action: { contains: filter.action } } : {}),
      ...(filter.deniedOnly ? { severity: "denied" } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  const actions = await prisma.auditEvent.findMany({ distinct: ["action"], select: { action: true }, orderBy: { action: "asc" } });
  return { events, actions: actions.map((a) => a.action) };
}

export async function mlData() {
  const models = await prisma.mlModel.findMany({ where: { name: MODEL_NAME }, orderBy: { version: "desc" }, take: 10 });
  const active = await loadFlakyModel();
  const predictions = await prisma.mlPrediction.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
  return { models, activeVersion: active?.version ?? null, predictions };
}
