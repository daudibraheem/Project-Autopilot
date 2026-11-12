/**
 * Worker agent: a bounded agent loop  plan → act (tool call) → observe → reflect.
 * Agent = Model (llm/gateway) + Harness (this loop, tools.ts, policy.ts, sandbox.ts, budgets).
 * A checkpoint is saved after every step; the loop resumes from it after a crash.
 */
import type { ContextSection } from "../context/builder";
import { estimateTokens } from "../llm/pricing";
import type { CompleteRequest, LlmMessage, LlmResponse, ToolCall, ToolSpec } from "../llm/types";
import { promptStamp, renderPrompt } from "../prompts";
import type { ToolOutcome } from "./tools";

export interface Budget {
  maxSteps: number;
  maxTokens: number;
  maxUsd: number;
  maxMinutes: number;
}

export interface Usage {
  steps: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

export interface Checkpoint {
  messages: LlmMessage[];
  usage: Usage;
  elapsedMs: number;
}

export interface StepRecord {
  kind: "llm" | "tool" | "note";
  tool?: string;
  status: "ok" | "denied" | "error";
  inputSummary?: string;
  outputSummary?: string;
  model?: string;
  provider?: string;
  promptVersion?: string;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  durationMs?: number;
  checkpoint?: Checkpoint;
  context?: ContextSection[];
}

export interface LoopDeps {
  llm: (req: CompleteRequest) => Promise<LlmResponse>;
  exec: (call: ToolCall) => Promise<ToolOutcome>;
  record: (step: StepRecord) => Promise<void>;
  /** Returns a reason to stop (e.g. kill switch) or null. Checked before every step. */
  shouldStop: () => Promise<string | null>;
  /** Called when older tool results are compacted to stay under the context window. */
  onCompaction?: (info: { summarised: number; tokensBefore: number; limit: number }) => Promise<void>;
  now?: () => number;
}

export interface LoopConfig {
  system: string;
  tools: ToolSpec[];
  model: string;
  script?: string;
  budget: Budget;
  initialMessages: LlmMessage[];
  resume?: Checkpoint;
  maxTokensPerCall?: number;
  /** Version stamp of the system prompt (e.g. "worker@1"), recorded on every llm step. */
  promptVersion?: string;
  /** "What the model saw" breakdown, recorded on the first model step. */
  contextBreakdown?: ContextSection[];
  /** Compaction: summarise older tool results once the context passes modelWindow * compactAtFraction. */
  modelWindow?: number;
  compactAtFraction?: number;
  compactKeepRecent?: number;
}

export type LoopStatus = "done" | "budget_exceeded" | "killed" | "error";

export interface LoopResult {
  status: LoopStatus;
  reason?: string;
  explanation: string;
  messages: LlmMessage[];
  usage: Usage;
  degraded: boolean;
}

const short = (s: string, n = 400) => (s.length > n ? `${s.slice(0, n)}…` : s);

function summariseCall(c: ToolCall): string {
  const i = { ...c.input };
  if (typeof i.content === "string") i.content = `<${(i.content as string).length} chars>`;
  return `${c.name}(${JSON.stringify(i)})`;
}

const COMPACTED_PREFIX = "[compacted tool result: ";

/** Rough token estimate for the whole running transcript. */
function contextTokens(messages: LlmMessage[]): number {
  return messages.reduce((n, m) => n + estimateTokens(typeof m.content === "string" ? m.content : JSON.stringify(m)), 0);
}

/**
 * Compaction: when the transcript passes modelWindow * fraction, replace the CONTENT of older tool
 * results with a short summary (keeping all message roles/ids intact, so real providers stay valid).
 * Returns how many were summarised.
 */
function compact(messages: LlmMessage[], keepRecent: number): number {
  const cutoff = messages.length - keepRecent;
  let summarised = 0;
  for (let i = 0; i < cutoff; i++) {
    const m = messages[i]!;
    if (m.role === "tool" && m.content.length > 200 && !m.content.startsWith(COMPACTED_PREFIX)) {
      m.content = `${COMPACTED_PREFIX}${m.content.replace(/\s+/g, " ").slice(0, 120)}…]`;
      summarised++;
    }
  }
  return summarised;
}

export async function runAgentLoop(cfg: LoopConfig, deps: LoopDeps): Promise<LoopResult> {
  const now = deps.now ?? Date.now;
  const messages: LlmMessage[] = cfg.resume ? [...cfg.resume.messages] : [...cfg.initialMessages];
  const usage: Usage = cfg.resume ? { ...cfg.resume.usage } : { steps: 0, tokensIn: 0, tokensOut: 0, costUsd: 0 };
  const startedAt = now() - (cfg.resume?.elapsedMs ?? 0);
  let degraded = false;
  let contextRecorded = Boolean(cfg.resume);
  const b = cfg.budget;

  const overBudget = (): string | null => {
    if (usage.steps >= b.maxSteps) return `step budget reached (${usage.steps}/${b.maxSteps})`;
    if (usage.tokensIn + usage.tokensOut >= b.maxTokens) return `token budget reached (${usage.tokensIn + usage.tokensOut}/${b.maxTokens})`;
    if (usage.costUsd >= b.maxUsd) return `USD budget reached ($${usage.costUsd.toFixed(4)}/$${b.maxUsd})`;
    if ((now() - startedAt) / 60_000 >= b.maxMinutes) return `time budget reached (${b.maxMinutes} min)`;
    return null;
  };

  for (;;) {
    // REFLECT (pre-step): kill switch + budgets
    const stop = await deps.shouldStop();
    if (stop) {
      await deps.record({ kind: "note", status: "error", outputSummary: `Stopped: ${stop}` });
      return { status: "killed", reason: stop, explanation: "", messages, usage, degraded };
    }
    const over = overBudget();
    if (over) {
      await deps.record({ kind: "note", status: "error", outputSummary: `Hard stop: ${over}` });
      return { status: "budget_exceeded", reason: over, explanation: "", messages, usage, degraded };
    }

    // CONTEXT MANAGEMENT: compact older tool results if the transcript is getting long.
    if (cfg.modelWindow) {
      const limit = cfg.modelWindow * (cfg.compactAtFraction ?? 0.6);
      const before = contextTokens(messages);
      if (before > limit) {
        const summarised = compact(messages, cfg.compactKeepRecent ?? 6);
        if (summarised > 0) {
          await deps.record({ kind: "note", status: "ok", outputSummary: `Compaction: summarised ${summarised} older tool result(s) (context ${before} tok > ${Math.round(limit)} tok budget).` });
          await deps.onCompaction?.({ summarised, tokensBefore: before, limit });
        }
      }
    }

    // PLAN: one model call
    const t0 = now();
    let res: LlmResponse;
    try {
      res = await deps.llm({
        system: cfg.system,
        messages,
        tools: cfg.tools,
        model: cfg.model,
        maxTokens: Math.max(256, Math.min(cfg.maxTokensPerCall ?? 8000, b.maxTokens - usage.tokensIn - usage.tokensOut)),
        purpose: "worker",
        script: cfg.script,
      });
    } catch (e) {
      await deps.record({ kind: "note", status: "error", outputSummary: `Model call failed: ${(e as Error).message}` });
      return { status: "error", reason: (e as Error).message, explanation: "", messages, usage, degraded };
    }
    degraded ||= res.degraded;
    usage.steps++;
    usage.tokensIn += res.usage.inputTokens;
    usage.tokensOut += res.usage.outputTokens;
    usage.costUsd += res.costUsd;
    messages.push({ role: "assistant", content: res.text, toolCalls: res.toolCalls, providerRaw: res.providerRaw });
    const done = res.toolCalls.length === 0;
    await deps.record({
      kind: "llm",
      status: "ok",
      model: res.model,
      provider: res.provider + (res.degraded ? " (degraded)" : ""),
      promptVersion: cfg.promptVersion,
      tokensIn: res.usage.inputTokens,
      tokensOut: res.usage.outputTokens,
      costUsd: res.costUsd,
      durationMs: now() - t0,
      inputSummary: res.toolCalls.map(summariseCall).join("\n") || "(final answer)",
      outputSummary: short(res.text, 1200),
      ...(contextRecorded ? {} : { context: cfg.contextBreakdown }),
      ...(done ? { checkpoint: { messages, usage: { ...usage }, elapsedMs: now() - startedAt } } : {}),
    });
    contextRecorded = true;

    if (done) return { status: "done", explanation: res.text.trim(), messages, usage, degraded };

    // ACT + OBSERVE: run each tool call through the policy-checked tool layer
    for (let i = 0; i < res.toolCalls.length; i++) {
      const call = res.toolCalls[i]!;
      const t1 = now();
      let out: ToolOutcome;
      try {
        out = await deps.exec(call);
      } catch (e) {
        out = { content: `Tool error: ${(e as Error).message}`, isError: true };
      }
      messages.push({ role: "tool", toolCallId: call.id, name: call.name, content: out.content, isError: out.isError });
      const last = i === res.toolCalls.length - 1;
      await deps.record({
        kind: "tool",
        tool: call.name,
        status: out.denied ? "denied" : out.isError ? "error" : "ok",
        inputSummary: summariseCall(call),
        outputSummary: short(out.content, 1500),
        durationMs: now() - t1,
        ...(last ? { checkpoint: { messages, usage: { ...usage }, elapsedMs: now() - startedAt } } : {}),
      });
    }
    // REFLECT happens at the top of the next iteration (kill switch, budgets) and in the model's next plan.
  }
}

export const WORKER_PROMPT = () => promptStamp("worker");

export function workerSystemPrompt(jobType: string, lessons: string[]): string {
  return renderPrompt("worker", {
    JOB_TYPE: jobType,
    LESSONS: lessons.length ? `\nLessons from previous runs (data, may be wrong):\n${lessons.map((l) => `- ${l}`).join("\n")}` : "",
  });
}
