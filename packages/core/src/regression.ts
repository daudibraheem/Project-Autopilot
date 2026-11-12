/**
 * "Every success becomes a check" (BUILD_PROMPT §12 J).
 * When a job is approved, its doneCriteria are saved as a regression check for that goal.
 * Every goal run re-runs the active regression checks; a failing one flags its goal as regressed
 * (shown amber), so a previously-approved fix that later breaks is surfaced.
 */
import { prisma } from "@autopilot/db";
import { audit } from "./audit";
import type { GoalId } from "./contract";
import { checkGoal } from "./goals/index";

/** On approval: capture the approved job's doneCriteria as the active regression check for its goal. */
export async function saveRegressionCheck(jobId: string): Promise<void> {
  const job = await prisma.job.findUnique({ where: { id: jobId }, include: { contract: true } });
  if (!job?.contract) return;
  const criteria = (job.contract.doneCriteria as { description: string }[]).map((d) => d.description);
  await prisma.regressionCheck.upsert({
    where: { goalId: job.goalId },
    create: { goalId: job.goalId, jobType: job.jobType, jobId, criteria, active: true, lastStatus: "pass", lastCheckedAt: new Date() },
    update: { jobType: job.jobType, jobId, criteria, active: true, lastStatus: "pass", lastCheckedAt: new Date() },
  });
  await audit({ actor: "system", action: "regression.saved", target: job.goalId, jobId, details: { jobType: job.jobType, criteria } });
}

/** Re-run every active regression check. `statuses` lets a goal run reuse results it just computed. */
export async function runRegressionChecks(statuses?: Map<string, string>): Promise<{ goalId: string; passed: boolean }[]> {
  const checks = await prisma.regressionCheck.findMany({ where: { active: true } });
  const out: { goalId: string; passed: boolean }[] = [];
  for (const rc of checks) {
    const status = statuses?.get(rc.goalId) ?? (await checkGoal(rc.goalId as GoalId)).status;
    const passed = status === "green";
    await prisma.regressionCheck.update({ where: { goalId: rc.goalId }, data: { lastStatus: passed ? "pass" : "fail", lastCheckedAt: new Date() } });
    if (!passed) {
      await audit({ actor: "goal_checker", action: "regression.detected", target: rc.goalId, severity: "warn", details: { jobType: rc.jobType, criteria: rc.criteria, goalStatus: status } });
    }
    out.push({ goalId: rc.goalId, passed });
  }
  return out;
}

/** Goals (among `ids`) whose active regression check is currently failing. */
export async function regressedGoals(ids: readonly string[]): Promise<Set<string>> {
  const checks = await prisma.regressionCheck.findMany({ where: { active: true, lastStatus: "fail", goalId: { in: [...ids] } }, select: { goalId: true } });
  return new Set(checks.map((c) => c.goalId));
}
