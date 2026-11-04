/**
 * Improvement loop: after every job, a short lesson goes to the Lesson table AND memory/lessons.md.
 * Lessons are loaded (keyword match on jobType) into the next job's context.
 */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "@autopilot/db";
import { z } from "zod";
import { getConfig } from "./config";
import { complete } from "./llm/gateway";
import type { LlmResponse } from "./llm/types";

export const LessonOutput = z.object({
  lesson: z.string().min(1),
  next_time: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

const cap = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export interface LessonInput {
  jobId: string;
  jobType: string;
  goalId: string;
  result: "pass" | "fail";
  evidence: string;
  failedGateChecks?: string[];
  verifierConcerns?: string[];
  highlights?: string[];
}

export function formatLessonMarkdown(l: { createdAt: Date; jobType: string; goalId: string; result: string; confidence: number; evidence: string; lesson: string; nextTime: string }): string {
  return [
    `# ${l.createdAt.toISOString().slice(0, 10)} · ${l.jobType} · ${l.goalId}`,
    `result: ${l.result}   confidence: ${Math.round(l.confidence * 100)}%`,
    `evidence: ${l.evidence}`,
    `lesson: ${l.lesson}`,
    `next time: ${l.nextTime}`,
    "",
  ].join("\n");
}

export async function writeLesson(input: LessonInput, onCall?: (r: LlmResponse) => Promise<void>) {
  const cfg = getConfig();
  const model = cfg.provider === "openai" ? cfg.openaiWorkerModel : cfg.workerModel;
  let out: z.infer<typeof LessonOutput>;
  try {
    const r = await complete({
      system: "Write one short lesson from an Autopilot job outcome. Reply with JSON only: {\"lesson\": string (≤160 chars), \"next_time\": string (≤160 chars), \"confidence\": number 0..1}.",
      messages: [{ role: "user", content: `<outcome>\n${JSON.stringify(input)}\n</outcome>` }],
      model,
      maxTokens: 400,
      purpose: "lesson",
    });
    await onCall?.(r);
    const json = /\{[\s\S]*\}/.exec(r.text)?.[0] ?? "{}";
    out = LessonOutput.parse(JSON.parse(json));
  } catch {
    out = {
      lesson: input.result === "pass" ? `${input.jobType} passed the gate.` : `${input.jobType} failed: ${(input.failedGateChecks ?? []).join(", ") || "see evidence"}.`,
      next_time: "Review the gate checklist before finishing.",
      confidence: 0.5,
    };
  }
  const lesson = cap(out.lesson.trim().replace(/\s+/g, " "), 200);
  const nextTime = cap(out.next_time.trim().replace(/\s+/g, " "), 200);
  const hash = createHash("sha1").update(`${input.jobType}|${input.result}|${lesson.toLowerCase()}`).digest("hex");
  const existing = await prisma.lesson.findUnique({ where: { hash } });
  if (existing) return { lesson: existing, duplicate: true };
  const row = await prisma.lesson.create({
    data: {
      jobId: input.jobId,
      jobType: input.jobType,
      goalId: input.goalId,
      result: input.result,
      confidence: out.confidence,
      evidence: cap(input.evidence.replace(/\s+/g, " "), 240),
      lesson,
      nextTime,
      hash,
    },
  });
  const file = cfg.lessonsFile;
  mkdirSync(path.dirname(file), { recursive: true });
  if (!existsSync(file)) writeFileSync(file, "# Autopilot lessons\n\n");
  appendFileSync(file, `${formatLessonMarkdown(row)}\n`);
  return { lesson: row, duplicate: false };
}

/** Relevant lessons for a job type (keyword match on jobType), newest first. */
export async function loadLessons(jobType: string, limit = 5): Promise<string[]> {
  const rows = await prisma.lesson.findMany({ where: { jobType }, orderBy: { createdAt: "desc" }, take: limit });
  return rows.map((r) => `[${r.result}] ${r.lesson} Next time: ${r.nextTime}`);
}

export async function searchLessons(query: string, limit = 5): Promise<string[]> {
  const words = query.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
  const rows = await prisma.lesson.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
  return rows
    .map((r) => ({ r, score: words.filter((w) => `${r.jobType} ${r.lesson} ${r.nextTime}`.toLowerCase().includes(w)).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => `[${x.r.jobType} · ${x.r.result}] ${x.r.lesson} Next time: ${x.r.nextTime}`);
}
