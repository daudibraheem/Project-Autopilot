import { describe, expect, it } from "vitest";
import type { WorkerTask } from "../src/agents/task";
import { runAgentLoop } from "../src/agents/worker";
import { buildWorkerContext } from "../src/context/builder";
import type { CompleteRequest, LlmResponse } from "../src/llm/types";
import { loadSkill } from "../src/skills";

const task: WorkerTask = {
  jobId: "j1",
  goalId: "no-critical-vulns",
  jobType: "dependency-security-fix",
  attempt: 1,
  goalSummary: "G1 · No critical vulnerabilities: tinydate 1.0.0",
  contract: { allowedPaths: ["package.json", "src/**"], forbiddenPaths: [], doneCriteria: ["bump"], maxSteps: 16 },
  repoFiles: ["package.json", "src/due.js"],
  baselineFailures: [],
  lessons: ["[pass] bump then fix call sites"],
};

describe("context builder (§12 C)", () => {
  it("assembles the ordered sections and counts tokens per section", () => {
    const built = buildWorkerContext({
      system: "SYSTEM PROMPT",
      task,
      attachments: [{ source: "goal-evidence", text: "advisory: tinydate" }],
      skill: loadSkill("dependency-upgrade"),
      lessons: task.lessons,
      knowledge: [{ path: "docs/runbooks/dependency-upgrades.md", title: "Runbook", lineStart: 1, lineEnd: 4, snippet: "bump it", rank: 0.5 }],
    });
    // fixed display order, only present sections
    expect(built.sections.map((s) => s.name)).toEqual(["system_prompt", "goal_contract", "agents_md", "skill", "lessons", "knowledge", "tool_results", "instructions"]);
    for (const s of built.sections) expect(s.tokens).toBeGreaterThan(0);
    expect(built.totalTokens).toBe(built.sections.reduce((n, s) => n + s.tokens, 0));
    // the user message still carries the parseable <task> block plus the new context sections
    expect(built.userMessage).toContain("<task>");
    expect(built.userMessage).toContain("<agents_md>");
    expect(built.userMessage).toContain("<skill");
    expect(built.userMessage).toContain("docs/runbooks/dependency-upgrades.md");
  });

  it("omits sections that are absent (no skill, no knowledge)", () => {
    const built = buildWorkerContext({ system: "s", task, attachments: [] });
    const names = built.sections.map((s) => s.name);
    expect(names).toContain("goal_contract");
    expect(names).not.toContain("skill");
    expect(names).not.toContain("knowledge");
  });
});

describe("context compaction (§12 C)", () => {
  it("summarises older tool results once the transcript passes the window, and logs it", async () => {
    let calls = 0;
    const model = async (req: CompleteRequest): Promise<LlmResponse> => {
      calls++;
      return {
        text: `step ${calls}`,
        toolCalls: calls < 3 ? [{ id: `c${calls}`, name: "read_file", input: { path: "x" } }] : [],
        stopReason: calls < 3 ? "tool_use" : "end_turn",
        usage: { inputTokens: 10, outputTokens: 10 },
        model: req.model,
        provider: "fake",
        costUsd: 0,
        latencyMs: 1,
        degraded: false,
        attempts: 1,
      temperature: 0,
      };
    };
    const bigToolResult = "X".repeat(400);
    const compactions: { summarised: number }[] = [];
    const r = await runAgentLoop(
      {
        system: "s",
        tools: [],
        model: "claude-haiku-5-5",
        initialMessages: [{ role: "user", content: "Y".repeat(400) }],
        budget: { maxSteps: 10, maxTokens: 1e9, maxUsd: 100, maxMinutes: 10 },
        modelWindow: 100,
        compactAtFraction: 0.5,
        compactKeepRecent: 0,
      },
      {
        llm: model,
        exec: async () => ({ content: bigToolResult, isError: false }),
        record: async () => {},
        shouldStop: async () => null,
        onCompaction: async (info) => void compactions.push(info),
      },
    );
    expect(r.status).toBe("done");
    expect(compactions.length).toBeGreaterThan(0);
    expect(compactions[0]!.summarised).toBeGreaterThan(0);
    // a compacted tool message keeps its role but has shrunken content
    const compacted = r.messages.filter((m) => m.role === "tool" && m.content.startsWith("[compacted tool result:"));
    expect(compacted.length).toBeGreaterThan(0);
  });
});
