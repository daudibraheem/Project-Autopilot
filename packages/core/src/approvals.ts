/**
 * Human approval queue. Approve (merge locally / mark draft PR ready on GitHub), Reject (reason required),
 * Request changes (feedback → one more worker attempt).
 */
import { existsSync } from "node:fs";
import { prisma } from "@autopilot/db";
import { audit } from "./audit";
import { getConfig, githubMode } from "./config";
import { GOAL_LABEL, type GoalId } from "./contract";
import { mergeApprovedBranch, workspacePath } from "./git";
import { markPrReady, openDraftPr, pushBranchToGitHub } from "./github";
import { runGoalChecks } from "./goals/index";
import { isHighRisk } from "./policy";
import { enqueueRunJob } from "./queue";
import { getTrust, recordTrust } from "./trust";

export const MAX_ATTEMPTS = 2;

export class ApprovalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApprovalError";
  }
}

async function pendingJob(jobId: string) {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) throw new ApprovalError(`Job ${jobId} not found`);
  if (job.status !== "awaiting_approval") throw new ApprovalError(`Job ${jobId} is ${job.status}, not awaiting approval`);
  return job;
}

async function lesson(jobId: string, result: "pass" | "fail", evidence: string) {
  const { lessonFor } = await import("./pipeline");
  await lessonFor(jobId, null, result, evidence).catch((e) => console.error("[lesson]", e));
}

export async function publishDraftPr(jobId: string): Promise<string> {
  const job = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
  if (job.prUrl) return job.prUrl;
  const ws = workspacePath(jobId);
  if (!existsSync(ws)) throw new Error("workspace missing");
  await pushBranchToGitHub(ws, job.branch);
  const pr = await openDraftPr(
    job.branch,
    `[Autopilot] ${GOAL_LABEL[job.goalId as GoalId]} (${jobId})`,
    `Opened by Project Autopilot as a **draft**.\n\n${job.explanation ?? ""}\n\nGate: all checks passed. Verifier: pass.`,
  );
  await prisma.job.update({ where: { id: jobId }, data: { prUrl: pr.url } });
  await audit({ actor: "system", action: "github.draft_pr_opened", target: pr.url, jobId, details: { number: pr.number } });
  return pr.url;
}

async function afterMerge(jobId: string, reason: string) {
  // Re-check goals so the dashboard shows the goal turning green.
  await runGoalChecks(undefined, reason).catch((e) => console.error("[approvals] goal re-check failed", e));
}

export async function approveJob(jobId: string, actor: "human" | "system" = "human", note?: string) {
  const job = await pendingJob(jobId);
  await prisma.approvalDecision.create({ data: { jobId, attempt: job.attempt, decision: "approve", reason: note ?? null, actor } });
  await audit({ actor, action: "approval.approved", target: jobId, jobId, details: { mode: githubMode() ? "github" : "local", note } });
  let status: string;
  if (githubMode()) {
    await publishDraftPr(jobId);
    const pr = (await prisma.job.findUniqueOrThrow({ where: { id: jobId } })).prUrl!;
    await markPrReady(Number(pr.split("/").pop()));
    await audit({ actor, action: "github.pr_ready_for_review", target: pr, jobId, details: { note: "Never auto-merged" } });
    status = "approved";
    await prisma.job.update({ where: { id: jobId }, data: { status, finishedAt: new Date() } });
  } else {
    const sha = await mergeApprovedBranch(getConfig().targetRepoPath, job.branch, `Merge ${job.branch}: ${GOAL_LABEL[job.goalId as GoalId]} (approved by ${actor})`);
    status = "merged";
    await prisma.job.update({ where: { id: jobId }, data: { status, mergedSha: sha, finishedAt: new Date() } });
    await audit({ actor, action: "git.merged", target: `${job.branch} → main`, jobId, details: { sha } });
  }
  const t = await recordTrust(job.jobType, "approved", jobId, note ?? "approved by human");
  await lesson(jobId, "pass", `gate all green; approved by ${actor}${note ? `: ${note}` : ""}`);
  if (status === "merged") await afterMerge(jobId, `after merge of ${jobId}`);
  return { status, trustChange: t.change };
}

export async function rejectJob(jobId: string, reason: string) {
  if (!reason?.trim()) throw new ApprovalError("A reason is required to reject");
  const job = await pendingJob(jobId);
  await prisma.approvalDecision.create({ data: { jobId, attempt: job.attempt, decision: "reject", reason, actor: "human" } });
  await prisma.job.update({ where: { id: jobId }, data: { status: "rejected", finishedAt: new Date(), error: `Rejected: ${reason}` } });
  await audit({ actor: "human", action: "approval.rejected", target: jobId, jobId, severity: "warn", details: { reason } });
  const t = await recordTrust(job.jobType, "rejected", jobId, reason);
  await lesson(jobId, "fail", `rejected by human: ${reason}`);
  return { status: "rejected", trustChange: t.change };
}

export async function requestChanges(jobId: string, feedback: string) {
  if (!feedback?.trim()) throw new ApprovalError("Feedback is required");
  const job = await pendingJob(jobId);
  if (job.attempt >= MAX_ATTEMPTS) throw new ApprovalError(`Job already had ${MAX_ATTEMPTS} attempts; approve or reject it`);
  await prisma.approvalDecision.create({ data: { jobId, attempt: job.attempt, decision: "request_changes", reason: feedback, actor: "human" } });
  await prisma.job.update({
    where: { id: jobId },
    data: { status: "changes_requested", feedback, attempt: job.attempt + 1, finishedAt: null },
  });
  await audit({ actor: "human", action: "approval.changes_requested", target: jobId, jobId, details: { feedback } });
  await enqueueRunJob(jobId);
  return { status: "changes_requested" };
}

/** L2 auto-merge: only if the type allows it (default false) and no high-risk path changed. */
export async function autoMergeIfAllowed(jobId: string, changedFiles: string[]): Promise<boolean> {
  const job = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
  const trust = await getTrust(job.jobType);
  if (trust.level < 2 || !trust.autoMergeAllowed) return false;
  if (changedFiles.some(isHighRisk)) {
    await audit({ actor: "system", action: "automerge.skipped", target: jobId, jobId, details: { reason: "high-risk path changed" } });
    return false;
  }
  if (githubMode()) return false; // never auto-merge on GitHub
  await audit({ actor: "system", action: "automerge.l2", target: jobId, jobId, details: { level: trust.level } });
  await approveJob(jobId, "system", "L2 auto-merge (autoMergeAllowed)");
  return true;
}
