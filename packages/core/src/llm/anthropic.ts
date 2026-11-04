import Anthropic from "@anthropic-ai/sdk";
import type { CompleteRequest, LlmProvider, ProviderResponse, StopReason, ToolCall } from "./types";
import { TransientLlmError } from "./types";

type Block = Anthropic.ContentBlockParam;

/** Provider-neutral messages → Anthropic MessageParams (assistant turns replay their raw blocks, incl. thinking). */
function toAnthropicMessages(req: CompleteRequest): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (const m of req.messages) {
    if (m.role === "user") out.push({ role: "user", content: m.content });
    else if (m.role === "assistant") {
      if (Array.isArray(m.providerRaw)) out.push({ role: "assistant", content: m.providerRaw as Block[] });
      else {
        const blocks: Block[] = [];
        if (m.content) blocks.push({ type: "text", text: m.content });
        for (const c of m.toolCalls ?? []) blocks.push({ type: "tool_use", id: c.id, name: c.name, input: c.input });
        out.push({ role: "assistant", content: blocks.length ? blocks : [{ type: "text", text: "(no content)" }] });
      }
    } else {
      const block: Anthropic.ToolResultBlockParam = {
        type: "tool_result",
        tool_use_id: m.toolCallId,
        content: m.content,
        ...(m.isError ? { is_error: true } : {}),
      };
      const last = out.at(-1);
      // All tool results for one assistant turn go back in a single user message.
      if (last?.role === "user" && Array.isArray(last.content) && last.content.every((b) => (b as Block).type === "tool_result")) {
        (last.content as Block[]).push(block);
      } else out.push({ role: "user", content: [block] });
    }
  }
  return out;
}

function mapStop(s: string | null | undefined): StopReason {
  if (s === "end_turn" || s === "tool_use" || s === "max_tokens" || s === "refusal") return s;
  return "other";
}

export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic" as const;
  private client: Anthropic;

  constructor(apiKey = process.env.ANTHROPIC_API_KEY) {
    // Retries are handled by the gateway (with backoff + optional mock fallback).
    this.client = new Anthropic({ apiKey: apiKey || undefined, maxRetries: 0, timeout: 120_000 });
  }

  async complete(req: CompleteRequest): Promise<ProviderResponse> {
    let res: Anthropic.Message;
    try {
      res = await this.client.messages.create({
        model: req.model,
        max_tokens: req.maxTokens,
        ...(req.system ? { system: req.system } : {}),
        messages: toAnthropicMessages(req),
        ...(req.tools?.length
          ? {
              tools: req.tools.map((t) => ({
                name: t.name,
                description: t.description,
                input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
              })),
              tool_choice: { type: "auto" as const },
            }
          : {}),
      });
    } catch (e) {
      if (
        e instanceof Anthropic.RateLimitError ||
        e instanceof Anthropic.InternalServerError ||
        e instanceof Anthropic.APIConnectionError ||
        (e instanceof Anthropic.APIError && (e.status ?? 0) >= 500)
      ) {
        throw new TransientLlmError(`anthropic: ${(e as Error).message}`);
      }
      throw e;
    }
    if (res.stop_reason === "refusal") throw new Error("anthropic: the model declined this request (stop_reason=refusal)");
    const toolCalls: ToolCall[] = [];
    let text = "";
    for (const b of res.content) {
      if (b.type === "text") text += b.text;
      else if (b.type === "tool_use") toolCalls.push({ id: b.id, name: b.name, input: (b.input ?? {}) as Record<string, unknown> });
    }
    return {
      text,
      toolCalls,
      stopReason: mapStop(res.stop_reason),
      usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens },
      model: res.model,
      providerRaw: res.content,
    };
  }
}
