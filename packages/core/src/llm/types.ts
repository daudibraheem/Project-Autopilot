export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export type LlmMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[]; providerRaw?: unknown }
  | { role: "tool"; toolCallId: string; name: string; content: string; isError?: boolean };

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export type LlmPurpose = "worker" | "verifier" | "lesson" | "analysis";

export interface CompleteRequest {
  system?: string;
  messages: LlmMessage[];
  tools?: ToolSpec[];
  model: string;
  maxTokens: number;
  purpose: LlmPurpose;
  /** Scenario key for the mock provider (job type or a scripted demo like "bad-worker"). */
  script?: string;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export type StopReason = "end_turn" | "tool_use" | "max_tokens" | "refusal" | "other";

export interface ProviderResponse {
  text: string;
  toolCalls: ToolCall[];
  stopReason: StopReason;
  usage: Usage;
  model: string;
  providerRaw?: unknown;
}

export interface LlmResponse extends ProviderResponse {
  provider: string;
  costUsd: number;
  latencyMs: number;
  degraded: boolean;
  attempts: number;
}

export interface LlmProvider {
  readonly name: "mock" | "anthropic" | "openai";
  complete(req: CompleteRequest): Promise<ProviderResponse>;
}

/** Errors worth retrying (rate limits, 5xx, network). */
export class TransientLlmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransientLlmError";
  }
}

export class LlmConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmConfigError";
  }
}
