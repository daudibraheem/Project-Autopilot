/**
 * Ask Autopilot: sprint questions answered by the worker model using the read-only MCP tools
 * (in-process MCP client ↔ server). Answers must cite sources; citations are checked in plain code.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { prisma } from "@autopilot/db";
import { runAgentLoop } from "../agents/worker";
import { audit } from "../audit";
import { complete } from "../llm/gateway";
import { routeModels } from "../llm/router";
import type { ToolSpec } from "../llm/types";
import { checkPeopleJudgement } from "../policy";
import { loadPrompt, promptStamp } from "../prompts";
import { isKillSwitchOn } from "../settings";
import { wrapUntrusted } from "../untrusted";
import { createSprintMcpServer } from "./mcp";
import { allRealNames } from "./pseudonym";
import { realNameGuard } from "./team-pipeline";

export const ASK_SYSTEM_PROMPT = loadPrompt("assistant").body;
export const ASK_PROMPT_STAMP = promptStamp("assistant");

export interface AskResult {
  answer: string;
  citations: { id: string; kind: "item" | "event" | "sprint" | "job" | "unknown"; exists: boolean }[];
  checks: { name: string; passed: boolean; detail: string }[];
  costUsd: number;
  steps: number;
  model: string;
  toolCalls: string[];
}

async function connectMcp() {
  const server = createSprintMcpServer();
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "ask-autopilot", version: "0.1.0" });
  await client.connect(clientT);
  return { client, close: async () => Promise.all([client.close(), server.close()]) };
}

export async function askAutopilot(question: string): Promise<AskResult> {
  const q = question.trim().slice(0, 500);
  if (!q) throw new Error("Question is required");
  if (await isKillSwitchOn()) throw new Error("Kill switch is on: Ask Autopilot is paused");
  const route = routeModels("easy");
  const { client, close } = await connectMcp();
  const toolCalls: string[] = [];
  try {
    const listed = await client.listTools();
    const tools: ToolSpec[] = listed.tools.map((t) => ({ name: t.name, description: t.description ?? "", inputSchema: t.inputSchema as Record<string, unknown> }));
    const guard = realNameGuard(await allRealNames(), null);
    const result = await runAgentLoop(
      {
        system: ASK_SYSTEM_PROMPT,
        tools,
        model: route.workerModel,
        script: "ask",
        budget: { maxSteps: 6, maxTokens: 40_000, maxUsd: 0.2, maxMinutes: 3 },
        initialMessages: [{ role: "user", content: q }],
        maxTokensPerCall: 2000,
      },
      {
        llm: (req) => complete(req, { beforeSend: guard }),
        exec: async (call) => {
          toolCalls.push(`${call.name}(${JSON.stringify(call.input)})`);
          if (!tools.some((t) => t.name === call.name)) return { content: `Unknown tool ${call.name}`, isError: true };
          const r = await client.callTool({ name: call.name, arguments: call.input });
          const body = (r.content as { type: string; text?: string }[]).map((c) => c.text ?? "").join("\n");
          return { content: wrapUntrusted(`mcp:${call.name}`, body), isError: Boolean(r.isError) };
        },
        record: async () => {},
        shouldStop: async () => ((await isKillSwitchOn()) ? "Kill switch is on" : null),
      },
    );
    const answer = result.status === "done" ? result.explanation : `I could not finish (${result.reason ?? result.status}).`;

    // Plain-code citation + people checks
    const ids = [...new Set([...answer.matchAll(/\[([^\]]+)\]/g)].flatMap((m) => m[1]!.split(/,\s*/)))];
    const keys = new Set((await prisma.workItem.findMany({ select: { key: true } })).map((i) => i.key));
    const events = new Set((await prisma.workItemEvent.findMany({ where: { flagged: false }, select: { id: true } })).map((e) => e.id));
    const jobs = new Set((await prisma.job.findMany({ select: { id: true } })).map((j) => j.id));
    const citations = ids.map((id) => {
      const kind = id === "sprint" ? "sprint" : keys.has(id) ? "item" : events.has(id) ? "event" : jobs.has(id) ? "job" : "unknown";
      return { id, kind: kind as AskResult["citations"][number]["kind"], exists: kind !== "unknown" };
    });
    const mentioned = [...new Set(answer.match(/\b[A-Z][A-Z0-9]+-\d+\b/g) ?? [])].filter((k) => keys.has(k));
    const uncited = mentioned.filter((k) => !ids.includes(k));
    const pj = checkPeopleJudgement(answer);
    const checks = [
      { name: "cites_sources", passed: citations.length > 0, detail: `${citations.length} citation(s)` },
      { name: "citations_exist", passed: citations.every((c) => c.exists), detail: citations.filter((c) => !c.exists).map((c) => c.id).join(", ") || "all exist" },
      { name: "items_cited", passed: uncited.length === 0, detail: uncited.length ? `mentioned without citation: ${uncited.join(", ")}` : "every item mentioned is cited" },
      { name: "work_not_people", passed: pj.allowed, detail: pj.allowed ? "no judgement of people" : pj.reason! },
    ];
    await audit({
      actor: "worker",
      action: "ask.answered",
      target: q.slice(0, 120),
      details: { model: route.workerModel, toolCalls, costUsd: result.usage.costUsd, checks: checks.filter((c) => !c.passed).map((c) => c.name) },
    });
    return { answer, citations, checks, costUsd: result.usage.costUsd, steps: result.usage.steps, model: route.workerModel, toolCalls };
  } finally {
    await close();
  }
}
