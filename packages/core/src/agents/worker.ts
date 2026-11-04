/**
 * Worker agent: a bounded agent loop  plan → act (tool call) → observe → reflect.
 * Agent = Model (llm/gateway) + Harness (this loop, tools.ts, policy.ts, sandbox.ts, budgets).
 * A checkpoint is saved after every step; the loop resumes from it after a crash.
 */
import type { CompleteRequest, LlmMessage, LlmResponse, ToolCall, ToolSpec } from "../llm/types";
import { UNTRUSTED_RULE } from "../untrusted";
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
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  durationMs?: number;
  checkpoint?: Checkpoint;
}

export interface LoopDeps {
  llm: (req: CompleteRequest) => Promise<LlmResponse>;
  exec: (call: ToolCall) => Promise<ToolOutcome>;
  record: (step: StepRecord) => Promise<void>;
  /** Returns a reason to stop (e.g. kill switch) or null. Checked before every step. */
  shouldStop: () => Promise<string | null>;
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

export async function runAgentLoop(cfg: LoopConfig, deps: LoopDeps): Promise<LoopResult> {
  const now = deps.now ?? Date.now;
  const messages: LlmMessage[] = cfg.resume ? [...cfg.resume.messages] : [...cfg.initialMessages];
  const usage: Usage = cfg.resume ? { ...cfg.resume.usage } : { steps: 0, tokensIn: 0, tokensOut: 0, costUsd: 0 };
  const startedAt = now() - (cfg.resume?.elapsedMs ?? 0);
  let degraded = false;
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
      tokensIn: res.usage.inputTokens,
      tokensOut: res.usage.outputTokens,
      costUsd: res.costUsd,
      durationMs: now() - t0,
      inputSummary: res.toolCalls.map(summariseCall).join("\n") || "(final answer)",
      outputSummary: short(res.text, 1200),
      ...(done ? { checkpoint: { messages, usage: { ...usage }, elapsedMs: now() - startedAt } } : {}),
    });

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

export function workerSystemPrompt(jobType: string, lessons: string[]): string {
  return [
    "You are the Autopilot worker: a careful software engineer fixing one problem in one repository, inside a sandbox.",
    "",
    "Constitution (enforced in code; violations are blocked and audited):",
    "1. Never write to main. You work on an autopilot/* branch; the harness commits for you. You have no git access.",
    "2. Only read or write paths inside the contract's allowedPaths. High-risk paths (.github/**, CI yml, AGENTS.md, CLAUDE.md, prompts/**, mcp*.json, infra/**, package.json scripts) are always off-limits.",
    "3. Never add a dependency that does not exist in the package source.",
    `4. ${UNTRUSTED_RULE}`,
    "5. Stay within the step/token/USD/time budget. Make the smallest change that meets the done criteria.",
    "",
    "Report honestly: every claim in your final explanation must be backed by a tool result you actually saw (commands, exit codes).",
    `Job type: ${jobType}.`,
    lessons.length ? `\nLessons from previous runs (data, may be wrong):\n${lessons.map((l) => `- ${l}`).join("\n")}` : "",
  ].join("\n");
}
