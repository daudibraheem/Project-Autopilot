import { afterEach, describe, expect, it, vi } from "vitest";
import { OllamaProvider } from "../src/llm/ollama";
import type { CompleteRequest } from "../src/llm/types";
import { TransientLlmError } from "../src/llm/types";

const req: CompleteRequest = {
  system: "sys",
  messages: [
    { role: "user", content: "hi" },
    { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "read_file", input: { path: "a" } }] },
    { role: "tool", toolCallId: "c1", name: "read_file", content: "file body" },
  ],
  model: "llama3.1:8b",
  maxTokens: 500,
  temperature: 0,
  purpose: "worker",
  tools: [{ name: "read_file", description: "read", inputSchema: { type: "object", properties: { path: { type: "string" } } } }],
};

afterEach(() => vi.restoreAllMocks());

describe("OllamaProvider (§12 K)", () => {
  it("maps our request to /api/chat and parses the response (tool calls, usage)", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ message: { role: "assistant", content: "done", tool_calls: [{ function: { name: "write_file", arguments: { path: "b", content: "x" } } }] }, prompt_eval_count: 12, eval_count: 7, done_reason: "stop" }),
    }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const r = await new OllamaProvider("http://localhost:11434/").complete(req);
    // request shape
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:11434/api/chat");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("llama3.1:8b");
    expect(body.stream).toBe(false);
    expect(body.options.temperature).toBe(0);
    expect(body.options.num_predict).toBe(500);
    expect(body.tools[0].function.name).toBe("read_file");
    expect(body.messages[0]).toEqual({ role: "system", content: "sys" });
    expect(body.messages[2].tool_calls[0].function).toEqual({ name: "read_file", arguments: { path: "a" } });
    // response mapping
    expect(r.text).toBe("done");
    expect(r.toolCalls).toEqual([{ id: "ollama_0_write_file", name: "write_file", input: { path: "b", content: "x" } }]);
    expect(r.stopReason).toBe("tool_use");
    expect(r.usage).toEqual({ inputTokens: 12, outputTokens: 7 });
  });

  it("treats 5xx as a transient error (retryable)", async () => {
    vi.stubGlobal("fetch", (async () => ({ ok: false, status: 503, text: async () => "down" })) as unknown as typeof fetch);
    await expect(new OllamaProvider().complete(req)).rejects.toBeInstanceOf(TransientLlmError);
  });
});
