import OpenAI from "openai";
import type { CompleteRequest, LlmProvider, ProviderResponse, StopReason, ToolCall } from "./types";
import { TransientLlmError } from "./types";

export class OpenAIProvider implements LlmProvider {
  readonly name = "openai" as const;
  private client: OpenAI;

  constructor(apiKey = process.env.OPENAI_API_KEY) {
    this.client = new OpenAI({ apiKey: apiKey || "missing", maxRetries: 0, timeout: 120_000 });
  }

  async complete(req: CompleteRequest): Promise<ProviderResponse> {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    if (req.system) messages.push({ role: "system", content: req.system });
    for (const m of req.messages) {
      if (m.role === "user") messages.push({ role: "user", content: m.content });
      else if (m.role === "assistant") {
        messages.push({
          role: "assistant",
          content: m.content || null,
          ...(m.toolCalls?.length
            ? {
                tool_calls: m.toolCalls.map((c) => ({
                  id: c.id,
                  type: "function" as const,
                  function: { name: c.name, arguments: JSON.stringify(c.input) },
                })),
              }
            : {}),
        });
      } else messages.push({ role: "tool", tool_call_id: m.toolCallId, content: m.content });
    }
    let res: OpenAI.Chat.ChatCompletion;
    try {
      res = await this.client.chat.completions.create({
        model: req.model,
        messages,
        max_completion_tokens: req.maxTokens,
        ...(req.tools?.length
          ? {
              tools: req.tools.map((t) => ({
                type: "function" as const,
                function: { name: t.name, description: t.description, parameters: t.inputSchema },
              })),
            }
          : {}),
      });
    } catch (e) {
      if (e instanceof OpenAI.RateLimitError || e instanceof OpenAI.APIConnectionError || (e instanceof OpenAI.APIError && (e.status ?? 0) >= 500)) {
        throw new TransientLlmError(`openai: ${(e as Error).message}`);
      }
      throw e;
    }
    const choice = res.choices[0];
    const toolCalls: ToolCall[] = [];
    for (const c of choice?.message.tool_calls ?? []) {
      if (c.type !== "function") continue;
      let input: Record<string, unknown> = {};
      try {
        input = JSON.parse(c.function.arguments || "{}");
      } catch {
        input = { _invalid_json: c.function.arguments };
      }
      toolCalls.push({ id: c.id, name: c.function.name, input });
    }
    const fr = choice?.finish_reason;
    const stopReason: StopReason = fr === "tool_calls" ? "tool_use" : fr === "stop" ? "end_turn" : fr === "length" ? "max_tokens" : "other";
    return {
      text: choice?.message.content ?? "",
      toolCalls,
      stopReason,
      usage: { inputTokens: res.usage?.prompt_tokens ?? 0, outputTokens: res.usage?.completion_tokens ?? 0 },
      model: res.model,
    };
  }
}
