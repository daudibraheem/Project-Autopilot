/** Shared job plumbing: step recording (checkpoints/traces), usage, status, contract loading, lessons. */
import { prisma } from "@autopilot/db";
import type { StepRecord } from "./agents/worker";
import { audit } from "./audit";
import { Contract } from "./contract";
import { writeLesson } from "./lessons";
import type { LlmResponse } from "./llm/types";
import { promptStamp } from "./prompts";

export const TERMINAL_STATUSES = ["merged", "approved", "published", "rejected", "gate_failed", "failed", "budget_exceeded", "killed"];

// ---------------- step recording ----------------

export class StepRecorder {
  private index = 0;
  constructor(
    private jobId: string,
    private attempt: number,
  ) {}
  async init() {
    const last = await prisma.jobStep.findFirst({ where: { jobId: this.jobId }, orderBy: { index: "desc" } });
    this.index = (last?.index ?? 0) + 1;
  }
  async record(phase: string, s: StepRecord) {
    await prisma.jobStep.create({
      data: {
        jobId: this.jobId,
        attempt: this.attempt,
        index: this.index++,
        phase,
        kind: s.kind,
        tool: s.tool ?? null,
        status: s.status,
        inputSummary: s.inputSummary ?? null,
        outputSummary: s.outputSummary ?? null,
        model: s.model ?? null,
        provider: s.provider ?? null,
        promptVersion: s.promptVersion ?? null,
        tokensIn: s.tokensIn ?? 0,
        tokensOut: s.tokensOut ?? 0,
        costUsd: s.costUsd ?? 0,
        durationMs: s.durationMs ?? 0,
        checkpoint: s.checkpoint ? (JSON.parse(JSON.stringify(s.checkpoint)) as object) : undefined,
      },
    });
  }
  async llm(phase: string, r: LlmResponse, inputSummary: string, promptVersion?: string) {
    await this.record(phase, {
      kind: "llm",
      status: "ok",
      model: r.model,
      provider: r.provider + (r.degraded ? " (degraded)" : ""),
      promptVersion,
      tokensIn: r.usage.inputTokens,
      tokensOut: r.usage.outputTokens,
      costUsd: r.costUsd,
      durationMs: r.latencyMs,
      inputSummary,
      outputSummary: r.text.slice(0, 1500),
    });
  }
  note(phase: string, text: string, status: StepRecord["status"] = "ok", durationMs = 0) {
    return this.record(phase, { kind: "note", status, outputSummary: text, durationMs });
  }
}

export async function addUsage(jobId: string, r: { usage: { inputTokens: number; outputTokens: number }; costUsd: number; degraded?: boolean }) {
  await prisma.job.update({
    where: { id: jobId },
    data: {
      tokensIn: { increment: r.usage.inputTokens },
      tokensOut: { increment: r.usage.outputTokens },
      costUsd: { increment: r.costUsd },
      ...(r.degraded ? { degraded: true } : {}),
    },
  });
}

export async function finish(jobId: string, status: string, error?: string) {
  await prisma.job.update({ where: { id: jobId }, data: { status, finishedAt: new Date(), ...(error ? { error } : {}) } });
  await audit({ actor: "system", action: `job.${status}`, target: jobId, jobId, severity: status === "merged" || status === "awaiting_approval" ? "info" : "warn", details: error ? { error } : {} });
}

export function contractFromRow(row: NonNullable<Awaited<ReturnType<typeof loadJob>>>["contract"], jobId: string): Contract {
  return Contract.parse({
    jobId,
    goalId: row!.goalId,
    jobType: row!.jobType,
    difficulty: row!.difficulty,
    allowedPaths: row!.allowedPaths,
    forbiddenPaths: row!.forbiddenPaths,
    maxSteps: row!.maxSteps,
    maxTokens: row!.maxTokens,
    maxUsd: row!.maxUsd,
    maxMinutes: row!.maxMinutes,
    doneCriteria: row!.doneCriteria,
    riskLevel: row!.riskLevel,
    allowRegistry: row!.allowRegistry,
  });
}

export function loadJob(jobId: string) {
  return prisma.job.findUnique({ where: { id: jobId }, include: { contract: true } });
}

/** Write the lesson for a finished job (LLM call, mock in mock mode). */
export async function lessonFor(
  jobId: string,
  rec: StepRecorder | null,
  result: "pass" | "fail",
  evidence: string,
  failedGateChecks: string[] = [],
  verifierConcerns: string[] = [],
  highlights?: string[],
) {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) return;
  const r = new StepRecorder(jobId, job.attempt);
  if (!rec) await r.init();
  const recorder = rec ?? r;
  const out = await writeLesson(
    { jobId, jobType: job.jobType, goalId: job.goalId, result, evidence, failedGateChecks, verifierConcerns, highlights: highlights ?? [job.explanation?.slice(0, 200) ?? ""] },
    async (resp) => {
      await addUsage(jobId, resp);
      await recorder.llm("lesson", resp, "Summarise the outcome into one lesson", promptStamp("lesson-writer"));
    },
  );
  await recorder.note("lesson", out.duplicate ? `Lesson already known: ${out.lesson.lesson}` : `Lesson saved: ${out.lesson.lesson} · next time: ${out.lesson.nextTime}`);
}

