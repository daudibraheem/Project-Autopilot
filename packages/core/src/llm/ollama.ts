/**
 * OllamaProvider: a local, open-weight model via Ollama's native /api/chat (no SDK, no network beyond localhost).
 * Shows the closed-vs-open hosting trade-off. Enabled with AUTOPILOT_LLM_PROVIDER=ollama.
 * (Stretch goal: implemented to the Ollama API but not exercised here — there is no Ollama server in this env,
 * so it is covered by a request/response mapping test, like the real Jira path.)
 */
import type { CompleteRequest, LlmProvider, ProviderResponse, StopReason, ToolCall } from "./types";
import { TransientLlmError } from "./types";

interface OllamaMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[];
}

interface OllamaResponse {
  message?: OllamaMessage;
  prompt_eval_count?: number;
  eval_count?: number;
  done_reason?: string;
}

export class OllamaProvider implements LlmProvider {
  readonly name = "ollama" as const;
  private baseUrl: string;

  constructor(baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async complete(req: CompleteRequest): Promise<ProviderResponse> {
    const messages: OllamaMessage[] = [];
    if (req.system) messages.push({ role: "system", content: req.system });
    for (const m of req.messages) {
      if (m.role === "user") messages.push({ role: "user", content: m.content });
      else if (m.role === "assistant") {
        messages.push({ role: "assistant", content: m.content || "", ...(m.toolCalls?.length ? { tool_calls: m.toolCalls.map((c) => ({ function: { name: c.name, arguments: c.input } })) } : {}) });
      } else messages.push({ role: "tool", content: m.content });
    }
    const body = {
      model: req.model,
      messages,
      stream: false,
      options: { num_predict: req.maxTokens, ...(req.temperature !== undefined ? { temperature: req.temperature } : {}) },
      ...(req.tools?.length ? { tools: req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } })) } : {}),
    };

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    } catch (e) {
      throw new TransientLlmError(`ollama: ${(e as Error).message}`);
    }
    if (res.status === 429 || res.status >= 500) throw new TransientLlmError(`ollama: HTTP ${res.status}`);
    if (!res.ok) throw new Error(`ollama: HTTP ${res.status} ${await res.text().catch(() => "")}`);
    const data = (await res.json()) as OllamaResponse;

    const toolCalls: ToolCall[] = (data.message?.tool_calls ?? []).map((c, i) => ({ id: `ollama_${i}_${c.function.name}`, name: c.function.name, input: c.function.arguments ?? {} }));
    const stopReason: StopReason = toolCalls.length ? "tool_use" : data.done_reason === "length" ? "max_tokens" : "end_turn";
    return {
      text: data.message?.content ?? "",
      toolCalls,
      stopReason,
      usage: { inputTokens: data.prompt_eval_count ?? 0, outputTokens: data.eval_count ?? 0 },
      model: req.model,
    };
  }
}
