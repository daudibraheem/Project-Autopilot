/**
 * Prompts as versioned files (prompts/*.md).
 * Each file begins with an HTML-comment header carrying a version; the version is recorded
 * on every trace (JobStep.promptVersion) so you can tell which prompt produced a result.
 * prompts/** is a high-risk path in the constitution (policy.ts HIGH_RISK_PATTERNS):
 * agents can never read or write it through the tool layer.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./config";
import { UNTRUSTED_RULE } from "./untrusted";

export type PromptName = "worker" | "verifier" | "team-verifier" | "lesson-writer" | "assistant" | "sub-agent";

export interface LoadedPrompt {
  name: PromptName;
  version: string;
  body: string;
}

const cache = new Map<PromptName, LoadedPrompt>();

export function loadPrompt(name: PromptName): LoadedPrompt {
  const hit = cache.get(name);
  if (hit) return hit;
  const raw = readFileSync(path.join(REPO_ROOT, "prompts", `${name}.md`), "utf8");
  const header = /^<!--([\s\S]*?)-->/.exec(raw);
  const version = header ? (/version:\s*([\w.]+)/i.exec(header[1]!)?.[1] ?? "0") : "0";
  const body = raw.slice(header ? header[0]!.length : 0).trim();
  const p: LoadedPrompt = { name, version, body };
  cache.set(name, p);
  return p;
}

/** "worker@1" — the stamp recorded on a trace. */
export function promptStamp(name: PromptName): string {
  return `${name}@${loadPrompt(name).version}`;
}

/** Load a prompt body with {{PLACEHOLDER}} substitution. {{UNTRUSTED_RULE}} is always available. */
export function renderPrompt(name: PromptName, vars: Record<string, string> = {}): string {
  const all: Record<string, string> = { UNTRUSTED_RULE, ...vars };
  return loadPrompt(name).body.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => all[k] ?? "");
}
