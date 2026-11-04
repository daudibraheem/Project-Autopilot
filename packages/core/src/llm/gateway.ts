/**
 * Model gateway: one complete() for every model call.
 * Retries transient errors with backoff; on repeated failure falls back to the mock provider only if
 * AUTOPILOT_ALLOW_MOCK_FALLBACK=true (response marked degraded). Computes cost + latency for every call.
 */
import { getConfig, type LlmProviderName } from "../config";
import { AnthropicProvider } from "./anthropic";
import { MockProvider } from "./mock";
import { OpenAIProvider } from "./openai";
import { estimateUsd } from "./pricing";
import { type CompleteRequest, type LlmProvider, type LlmResponse, TransientLlmError } from "./types";

const providers = new Map<LlmProviderName, LlmProvider>();

export function getProvider(name: LlmProviderName = getConfig().provider): LlmProvider {
  let p = providers.get(name);
  if (!p) {
    p = name === "anthropic" ? new AnthropicProvider() : name === "openai" ? new OpenAIProvider() : new MockProvider();
    providers.set(name, p);
  }
  return p;
}

/** Test hook: replace a provider (e.g. a flaky fake). */
export function setProvider(name: LlmProviderName, p: LlmProvider | null) {
  if (p) providers.set(name, p);
  else providers.delete(name);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface GatewayOptions {
  provider?: LlmProviderName;
  maxAttempts?: number;
  baseDelayMs?: number;
}

export async function complete(req: CompleteRequest, opts: GatewayOptions = {}): Promise<LlmResponse> {
  const cfg = getConfig();
  const providerName = opts.provider ?? cfg.provider;
  const provider = getProvider(providerName);
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseDelay = opts.baseDelayMs ?? 800;
  const started = Date.now();
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const r = await provider.complete(req);
      return {
        ...r,
        model: req.model, // pinned model ID from config, recorded on every trace
        provider: provider.name,
        costUsd: estimateUsd(req.model, r.usage.inputTokens, r.usage.outputTokens),
        latencyMs: Date.now() - started,
        degraded: false,
        attempts: attempt,
      };
    } catch (e) {
      lastErr = e;
      if (!(e instanceof TransientLlmError) || attempt === maxAttempts) break;
      await sleep(baseDelay * 2 ** (attempt - 1) + Math.floor(Math.random() * 200));
    }
  }
  if (cfg.allowMockFallback && providerName !== "mock") {
    console.warn(`[llm] ${providerName} failed (${(lastErr as Error)?.message}); falling back to mock (degraded)`);
    const r = await getProvider("mock").complete(req);
    return {
      ...r,
      model: req.model,
      provider: "mock",
      costUsd: 0,
      latencyMs: Date.now() - started,
      degraded: true,
      attempts: maxAttempts,
    };
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
