/**
 * Conductor: turns red goals into contracts + jobs.
 * Rules: no duplicate open job per goal · respect the kill switch · cap open jobs at 3 · enqueue into pg-boss.
 */
import { prisma } from "@autopilot/db";
import { audit } from "./audit";
import { isDemoTarget, MAX_OPEN_JOBS } from "./config";
import { buildContract, GOAL_IDS, GOAL_JOB_TYPE, type GoalId } from "./contract";
import { newJobId } from "./ids";
import { enqueueRunJob } from "./queue";
import { getSetting, isKillSwitchOn } from "./settings";
import { getTrust } from "./trust";
import { branchFor } from "./git";

export const OPEN_STATUSES = ["queued", "running", "verifying", "gating", "awaiting_approval", "changes_requested"];

export interface PlanInput {
  candidates: GoalId[];
  openJobGoals: string[];
  killSwitch: boolean;
  maxOpen: number;
}

export interface Plan {
  create: GoalId[];
  skipped: { goalId: GoalId; reason: string }[];
}

/** Pure planning step (unit-tested). */
export function planJobs(input: PlanInput): Plan {
  const plan: Plan = { create: [], skipped: [] };
  let open = input.openJobGoals.length;
  for (const goalId of input.candidates) {
    if (input.killSwitch) plan.skipped.push({ goalId, reason: "Kill switch is on" });
    else if (input.openJobGoals.includes(goalId)) plan.skipped.push({ goalId, reason: "A job for this goal is already open" });
    else if (open >= input.maxOpen) plan.skipped.push({ goalId, reason: `Open job cap reached (${input.maxOpen})` });
    else {
      plan.create.push(goalId);
      open++;
    }
  }
  return plan;
}

export class KillSwitchError extends Error {
  constructor() {
    super("Kill switch is on: no new jobs can start");
    this.name = "KillSwitchError";
  }
}

async function openJobGoals(): Promise<string[]> {
  const jobs = await prisma.job.findMany({ where: { status: { in: OPEN_STATUSES } }, select: { goalId: true } });
  return jobs.map((j) => j.goalId);
}

async function createJob(goalId: GoalId, source: string): Promise<string> {
  const jobId = newJobId();
  const contract = buildContract(jobId, goalId, { realMode: !isDemoTarget() });
  const trust = await getTrust(contract.jobType);
  await prisma.job.create({
    data: {
      id: jobId,
      goalId,
      jobType: contract.jobType,
      status: "queued",
      branch: branchFor(jobId),
      trustLevelAtStart: trust.level,
      source,
      contract: {
        create: {
          goalId,
          jobType: contract.jobType,
          difficulty: contract.difficulty,
          allowedPaths: contract.allowedPaths,
          forbiddenPaths: contract.forbiddenPaths,
          maxSteps: contract.maxSteps,
          maxTokens: contract.maxTokens,
          maxUsd: contract.maxUsd,
          maxMinutes: contract.maxMinutes,
          doneCriteria: contract.doneCriteria as object,
          riskLevel: contract.riskLevel,
          allowRegistry: contract.allowRegistry,
        },
      },
    },
  });
  await audit({
    actor: "conductor",
    action: "job.created",
    target: jobId,
    jobId,
    details: { goalId, jobType: contract.jobType, difficulty: contract.difficulty, allowedPaths: contract.allowedPaths, source },
  });
  await enqueueRunJob(jobId);
  return jobId;
}

/** After goal checks: create jobs for red goals. */
export async function conduct(redGoals: GoalId[], source = "goal-check"): Promise<Plan & { jobIds: string[] }> {
  const plan = planJobs({
    candidates: redGoals,
    openJobGoals: await openJobGoals(),
    killSwitch: await isKillSwitchOn(),
    maxOpen: await getSetting<number>("conductor.maxOpenJobs", MAX_OPEN_JOBS),
  });
  const jobIds: string[] = [];
  for (const g of plan.create) jobIds.push(await createJob(g, source));
  for (const s of plan.skipped) {
    await audit({ actor: "conductor", action: "job.skipped", target: s.goalId, severity: "warn", details: { reason: s.reason } });
  }
  return { ...plan, jobIds };
}

/** "Run job" button / `pnpm cli run <goal>`: start a job for one goal. Throws on kill switch / duplicates / cap. */
export async function startJobForGoal(goalId: GoalId, source = "manual"): Promise<string> {
  if (!GOAL_IDS.includes(goalId)) throw new Error(`Unknown goal ${goalId}`);
  if (await isKillSwitchOn()) {
    await audit({ actor: "conductor", action: "job.refused", target: goalId, severity: "denied", details: { reason: "Kill switch is on" } });
    throw new KillSwitchError();
  }
  const latest = await prisma.goalCheck.findFirst({ where: { goalId, ref: "main" }, orderBy: { createdAt: "desc" } });
  if (latest && latest.status === "green") throw new Error(`${goalId} is green; nothing to fix`);
  const plan = await conduct([goalId], source);
  if (plan.jobIds[0]) return plan.jobIds[0];
  throw new Error(plan.skipped[0]?.reason ?? "Job not created");
}

export { GOAL_JOB_TYPE };
