/**
 * Context builder: assembles exactly what the worker model sees, in a fixed order, and counts
 * tokens per section ("what the model saw"). One task per session: every job starts from a fresh
 * context; nothing from a previous job's transcript is carried over except its lessons.
 *
 * Order (BUILD_PROMPT §C): 1 goal+contract · 2 AGENTS.md · 3 skill · 4 lessons · 5 knowledge · 6 tool results.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { UntrustedAttachment, WorkerTask } from "../agents/task";
import { REPO_ROOT } from "../config";
import { citation, type KnowledgeHit } from "../knowledge";
import { estimateTokens } from "../llm/pricing";
import type { LoadedSkill } from "../skills";
import { wrapUntrusted } from "../untrusted";

export interface ContextSection {
  name: string;
  label: string;
  chars: number;
  tokens: number;
}

export interface BuiltContext {
  userMessage: string;
  sections: ContextSection[];
  totalTokens: number;
}

export interface ContextInputs {
  system: string;
  task: WorkerTask;
  attachments: UntrustedAttachment[];
  skill?: LoadedSkill | null;
  lessons?: string[];
  knowledge?: KnowledgeHit[];
  includeAgentsMd?: boolean;
}

let agentsMdCache: string | null = null;
function agentsMd(): string {
  if (agentsMdCache === null) {
    try {
      agentsMdCache = readFileSync(path.join(REPO_ROOT, "AGENTS.md"), "utf8");
    } catch {
      agentsMdCache = "";
    }
  }
  return agentsMdCache;
}

const HEADER = "Here is your job. The <task> block is from the Autopilot harness (trusted).";
const INSTRUCTION =
  "Work step by step with the tools. When the done criteria are met (or you cannot make progress), stop calling tools and reply with a short explanation: what you changed, which commands you ran and their results, and any concerns.";

export function buildWorkerContext(inp: ContextInputs): BuiltContext {
  const blocks: { name: string; label: string; text: string }[] = [];
  blocks.push({ name: "goal_contract", label: "Goal & contract", text: `<task>\n${JSON.stringify(inp.task, null, 2)}\n</task>` });
  const md = agentsMd();
  if (inp.includeAgentsMd !== false && md) blocks.push({ name: "agents_md", label: "AGENTS.md (constitution)", text: `<agents_md>\n${md}\n</agents_md>` });
  if (inp.skill) blocks.push({ name: "skill", label: `Skill: ${inp.skill.name}`, text: `<skill name="${inp.skill.name}" version="${inp.skill.version}">\n${inp.skill.body}\n</skill>` });
  if (inp.lessons?.length) blocks.push({ name: "lessons", label: "Recalled lessons", text: `<lessons>\n${inp.lessons.map((l) => `- ${l}`).join("\n")}\n</lessons>` });
  if (inp.knowledge?.length) {
    blocks.push({ name: "knowledge", label: "Retrieved knowledge", text: wrapUntrusted("knowledge", inp.knowledge.map((h) => `[${citation(h)}] ${h.title}\n${h.snippet}`).join("\n---\n")) });
  }
  for (const a of inp.attachments) blocks.push({ name: "tool_results", label: "Retrieved evidence", text: wrapUntrusted(a.source, a.text) });

  const userMessage = [HEADER, ...blocks.map((b) => b.text), INSTRUCTION].join("\n\n");

  // Aggregate the breakdown by section name, in a fixed display order.
  const order = ["system_prompt", "goal_contract", "agents_md", "skill", "lessons", "knowledge", "tool_results", "instructions"];
  const labels: Record<string, string> = {
    system_prompt: "System prompt",
    goal_contract: "Goal & contract",
    agents_md: "AGENTS.md",
    skill: "Skill",
    lessons: "Lessons",
    knowledge: "Knowledge",
    tool_results: "Tool results / evidence",
    instructions: "Instructions",
  };
  const acc = new Map<string, { chars: number; tokens: number }>();
  const add = (name: string, text: string) => {
    const cur = acc.get(name) ?? { chars: 0, tokens: 0 };
    acc.set(name, { chars: cur.chars + text.length, tokens: cur.tokens + estimateTokens(text) });
  };
  add("system_prompt", inp.system);
  add("instructions", `${HEADER}\n\n${INSTRUCTION}`);
  for (const b of blocks) add(b.name, b.text);

  const sections: ContextSection[] = order
    .filter((n) => acc.has(n))
    .map((n) => ({ name: n, label: labels[n]!, chars: acc.get(n)!.chars, tokens: acc.get(n)!.tokens }));
  return { userMessage, sections, totalTokens: sections.reduce((n, s) => n + s.tokens, 0) };
}
