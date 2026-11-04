import { describe, expect, it } from "vitest";
import { runAgentLoop, type StepRecord } from "../src/agents/worker";
import type { CompleteRequest, LlmResponse } from "../src/llm/types";

/** A model that never stops calling tools. */
function endlessModel(costPerCall = 0.001, tokens = 100) {
  let n = 0;
  return async (req: CompleteRequest): Promise<LlmResponse> => {
    n++;
    return {
      text: `step ${n}`,
      toolCalls: [{ id: `c${n}`, name: "list_files", input: { dir: "." } }],
      stopReason: "tool_use",
      usage: { inputTokens: tokens, outputTokens: tokens },
      model: req.model,
      provider: "fake",
      costUsd: costPerCall,
      latencyMs: 1,
      degraded: false,
      attempts: 1,
    };
  };
}

const base = {
  system: "s",
  tools: [],
  model: "claude-haiku-5-5",
  initialMessages: [{ role: "user" as const, content: "go" }],
};

describe("agent loop budgets (hard stop)", () => {
  it("stops at the step budget with budget_exceeded and checkpoints every step", async () => {
    const steps: StepRecord[] = [];
    const r = await runAgentLoop(
      { ...base, budget: { maxSteps: 3, maxTokens: 1e9, maxUsd: 100, maxMinutes: 10 } },
      { llm: endlessModel(), exec: async () => ({ content: "ok", isError: false }), record: async (s) => void steps.push(s), shouldStop: async () => null },
    );
    expect(r.status).toBe("budget_exceeded");
    expect(r.reason).toMatch(/step budget/);
    expect(r.usage.steps).toBe(3);
    expect(steps.filter((s) => s.checkpoint).length).toBe(3);
  });

  it("stops at the USD budget", async () => {
    const r = await runAgentLoop(
      { ...base, budget: { maxSteps: 100, maxTokens: 1e9, maxUsd: 0.0025, maxMinutes: 10 } },
      { llm: endlessModel(0.001), exec: async () => ({ content: "ok", isError: false }), record: async () => {}, shouldStop: async () => null },
    );
    expect(r.status).toBe("budget_exceeded");
    expect(r.reason).toMatch(/USD/);
    expect(r.usage.costUsd).toBeLessThan(0.004);
  });

  it("stops at the token and time budgets", async () => {
    const tok = await runAgentLoop(
      { ...base, budget: { maxSteps: 100, maxTokens: 500, maxUsd: 100, maxMinutes: 10 } },
      { llm: endlessModel(0, 100), exec: async () => ({ content: "ok", isError: false }), record: async () => {}, shouldStop: async () => null },
    );
    expect(tok.reason).toMatch(/token/);
    let t = 0;
    const time = await runAgentLoop(
      { ...base, budget: { maxSteps: 100, maxTokens: 1e9, maxUsd: 100, maxMinutes: 1 } },
      { llm: endlessModel(), exec: async () => ({ content: "ok", isError: false }), record: async () => {}, shouldStop: async () => null, now: () => (t += 20_000) },
    );
    expect(time.status).toBe("budget_exceeded");
    expect(time.reason).toMatch(/time/);
  });

  it("kill switch stops a running job after its current step", async () => {
    let killed = false;
    let execs = 0;
    const r = await runAgentLoop(
      { ...base, budget: { maxSteps: 100, maxTokens: 1e9, maxUsd: 100, maxMinutes: 10 } },
      {
        llm: endlessModel(),
        exec: async () => {
          execs++;
          if (execs === 2) killed = true; // flipped while step 2 runs
          return { content: "ok", isError: false };
        },
        record: async () => {},
        shouldStop: async () => (killed ? "Kill switch is on" : null),
      },
    );
    expect(r.status).toBe("killed");
    expect(r.usage.steps).toBe(2); // step 2 finished; no step 3
  });

  it("resumes from a checkpoint", async () => {
    let last: StepRecord | undefined;
    await runAgentLoop(
      { ...base, budget: { maxSteps: 2, maxTokens: 1e9, maxUsd: 100, maxMinutes: 10 } },
      { llm: endlessModel(), exec: async () => ({ content: "ok", isError: false }), record: async (s) => void (s.checkpoint && (last = s)), shouldStop: async () => null },
    );
    const resumed = await runAgentLoop(
      { ...base, budget: { maxSteps: 4, maxTokens: 1e9, maxUsd: 100, maxMinutes: 10 }, resume: last!.checkpoint },
      { llm: endlessModel(), exec: async () => ({ content: "ok", isError: false }), record: async () => {}, shouldStop: async () => null },
    );
    expect(resumed.usage.steps).toBe(4);
  });
});
