import { afterEach, describe, expect, it } from "vitest";
import { getConfig } from "../src/config";
import { complete, setProvider } from "../src/llm/gateway";
import { estimateUsd } from "../src/llm/pricing";
import { routeModels } from "../src/llm/router";
import { type LlmProvider, LlmConfigError, TransientLlmError } from "../src/llm/types";

describe("budget router", () => {
  it("routes easy jobs to WORKER_MODEL and hard jobs to HARD_WORKER_MODEL", () => {
    const cfg = { ...getConfig(), provider: "anthropic" as const, workerModel: "claude-haiku-5-5", hardWorkerModel: "claude-sonnet-5-5", verifierModel: "claude-opus-5-5" };
    expect(routeModels("easy", cfg).workerModel).toBe("claude-haiku-5-5");
    expect(routeModels("hard", cfg).workerModel).toBe("claude-sonnet-5-5");
    expect(routeModels("easy", cfg).verifierModel).toBe("claude-opus-5-5");
  });

  it("verifier model must differ from worker model (throws a config error)", () => {
    const cfg = { ...getConfig(), provider: "anthropic" as const, workerModel: "claude-haiku-5-5", hardWorkerModel: "claude-sonnet-5-5", verifierModel: "claude-sonnet-5-5" };
    expect(() => routeModels("hard", cfg)).toThrow(LlmConfigError);
    expect(() => routeModels("easy", { ...cfg, workerModel: "claude-sonnet-5-5" })).toThrow(/must differ/);
    expect(routeModels("easy", cfg).workerModel).not.toBe(routeModels("easy", cfg).verifierModel);
  });
});

describe("gateway", () => {
  afterEach(() => {
    setProvider("anthropic", null);
    delete process.env.AUTOPILOT_ALLOW_MOCK_FALLBACK;
    process.env.AUTOPILOT_LLM_PROVIDER = "mock";
  });

  it("computes cost from the price table", () => {
    expect(estimateUsd("claude-haiku-5-5", 1_000_000, 1_000_000)).toBeCloseTo(0.6);
  });

  it("retries transient errors with backoff, then succeeds", async () => {
    let calls = 0;
    const flaky: LlmProvider = {
      name: "anthropic",
      async complete(req) {
        calls++;
        if (calls < 3) throw new TransientLlmError("overloaded");
        return { text: "ok", toolCalls: [], stopReason: "end_turn", usage: { inputTokens: 10, outputTokens: 5 }, model: req.model };
      },
    };
    setProvider("anthropic", flaky);
    const r = await complete({ messages: [{ role: "user", content: "hi" }], model: "claude-haiku-5-5", maxTokens: 10, purpose: "lesson" }, { provider: "anthropic", baseDelayMs: 1 });
    expect(r.text).toBe("ok");
    expect(r.attempts).toBe(3);
    expect(r.degraded).toBe(false);
  });

  it("falls back to mock (degraded) only when allowed", async () => {
    const down: LlmProvider = {
      name: "anthropic",
      async complete() {
        throw new TransientLlmError("down");
      },
    };
    setProvider("anthropic", down);
    const req = { messages: [{ role: "user" as const, content: "<outcome>\n{}\n</outcome>" }], model: "claude-haiku-5-5", maxTokens: 10, purpose: "lesson" as const };
    await expect(complete(req, { provider: "anthropic", baseDelayMs: 1 })).rejects.toThrow(/down/);
    process.env.AUTOPILOT_ALLOW_MOCK_FALLBACK = "true";
    const r = await complete(req, { provider: "anthropic", baseDelayMs: 1 });
    expect(r.degraded).toBe(true);
    expect(r.provider).toBe("mock");
  });
});
