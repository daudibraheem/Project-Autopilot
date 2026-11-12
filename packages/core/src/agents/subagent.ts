/**
 * Research sub-agent (used by G2): reads up to 40 past CI logs for one failing test in its OWN,
 * separate context and returns at most 5 findings to the worker. Its tokens and cost are traced
 * separately (phase "subagent") and shown as nested steps in the job timeline.
 */
import { z } from "zod";
import { complete } from "../llm/gateway";
import type { LlmResponse } from "../llm/types";
import { loadPrompt, promptStamp } from "../prompts";
import { wrapUntrusted } from "../untrusted";

export interface ResearchFinding {
  summary: string;
  evidence: string;
}

const ResearchOutput = z.object({ findings: z.array(z.object({ summary: z.string(), evidence: z.string() })) });

export const SUBAGENT_PROMPT_STAMP = promptStamp("sub-agent");
export const MAX_CI_LOGS = 40;
export const MAX_FINDINGS = 5;

export interface ResearchInput {
  test: { file: string; name: string };
  logs: string[];
  model: string;
}

export async function runResearchSubAgent(input: ResearchInput, onCall?: (r: LlmResponse) => Promise<void>): Promise<{ findings: ResearchFinding[]; response: LlmResponse }> {
  const logs = input.logs.slice(-MAX_CI_LOGS);
  const message = [`Failing test: ${input.test.file} › ${input.test.name}. Here are up to ${MAX_CI_LOGS} past CI runs for it.`, wrapUntrusted("ci-logs", logs.join("\n"))].join("\n\n");
  const r = await complete({
    system: loadPrompt("sub-agent").body,
    messages: [{ role: "user", content: message }],
    model: input.model,
    maxTokens: 800,
    purpose: "analysis",
    script: "research-subagent",
  });
  await onCall?.(r);
  let findings: ResearchFinding[] = [];
  try {
    const json = /\{[\s\S]*\}/.exec(r.text)?.[0] ?? "{}";
    findings = ResearchOutput.parse(JSON.parse(json)).findings.slice(0, MAX_FINDINGS);
  } catch {
    findings = [];
  }
  return { findings, response: r };
}
