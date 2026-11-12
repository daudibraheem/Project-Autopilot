/**
 * Verifier agent. MUST use VERIFIER_MODEL (≠ worker model).
 * Sees: contract, diff, evidence, worker explanation. NOT the worker's private reasoning or messages.
 * Output: strict JSON, validated with zod.
 */
import { z } from "zod";
import type { Contract } from "../contract";
import { complete, type GatewayOptions } from "../llm/gateway";
import type { LlmResponse } from "../llm/types";
import { LlmConfigError } from "../llm/types";
import { loadPrompt, promptStamp } from "../prompts";
import { wrapUntrusted } from "../untrusted";
import type { EvidenceItem } from "./tools";

export const VerifierCheck = z.object({ name: z.string().min(1), passed: z.boolean(), reason: z.string() });
export const VerifierReport = z.object({
  verdict: z.enum(["pass", "fail"]),
  checks: z.array(VerifierCheck).min(1),
  concerns: z.array(z.string()),
});
export type VerifierReport = z.infer<typeof VerifierReport>;

export const VERIFIER_SYSTEM_PROMPT = loadPrompt("verifier").body;
export const VERIFIER_PROMPT_STAMP = promptStamp("verifier");

export interface VerifierInput {
  contract: Pick<Contract, "allowedPaths" | "forbiddenPaths" | "jobType"> & { doneCriteria: { description: string }[] | string[] };
  diff: string;
  changedFiles: string[];
  toolWrites: string[];
  deniedActions: { tool: string; target: string; rule: string }[];
  evidence: EvidenceItem[];
  explanation: string;
}

export function buildVerifierMessage(input: VerifierInput): string {
  const request = {
    contract: {
      jobType: input.contract.jobType,
      allowedPaths: input.contract.allowedPaths,
      forbiddenPaths: input.contract.forbiddenPaths,
      doneCriteria: input.contract.doneCriteria.map((d) => (typeof d === "string" ? d : d.description)),
    },
    changedFiles: input.changedFiles,
    toolWrites: input.toolWrites,
    deniedActions: input.deniedActions,
  };
  return [
    "Review this change. The <review_request> block is from the harness (trusted).",
    `<review_request>\n${JSON.stringify(request, null, 2)}\n</review_request>`,
    wrapUntrusted("diff", input.diff.slice(0, 40_000) || "(empty diff)"),
    wrapUntrusted("evidence", JSON.stringify(input.evidence, null, 1).slice(0, 20_000)),
    wrapUntrusted("worker-explanation", input.explanation || "(none)"),
  ].join("\n\n");
}

export function parseVerifierOutput(text: string): VerifierReport | null {
  const json = /\{[\s\S]*\}/.exec(text)?.[0];
  if (!json) return null;
  try {
    const r = VerifierReport.parse(JSON.parse(json));
    // Never trust a "pass" verdict that contradicts its own checks.
    if (r.verdict === "pass" && r.checks.some((c) => !c.passed)) return { ...r, verdict: "fail" };
    return r;
  } catch {
    return null;
  }
}

export async function runVerifier(
  input: VerifierInput,
  models: { verifierModel: string; workerModel: string },
  opts: GatewayOptions & { onCall?: (r: LlmResponse) => Promise<void> } = {},
): Promise<{ report: VerifierReport; responses: LlmResponse[] }> {
  if (models.verifierModel === models.workerModel) {
    throw new LlmConfigError("Verifier model must differ from the worker model (never let AI grade its own homework)");
  }
  return review(VERIFIER_SYSTEM_PROMPT, buildVerifierMessage(input), models, opts);
}

/** Shared review core: one strict-JSON verifier call, retried once on invalid output. */
async function review(
  system: string,
  message: string,
  models: { verifierModel: string; workerModel: string },
  opts: GatewayOptions & { onCall?: (r: LlmResponse) => Promise<void> },
): Promise<{ report: VerifierReport; responses: LlmResponse[] }> {
  if (models.verifierModel === models.workerModel) {
    throw new LlmConfigError("Verifier model must differ from the worker model (never let AI grade its own homework)");
  }
  const responses: LlmResponse[] = [];
  const messages = [{ role: "user" as const, content: message }];
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await complete({ system, messages, model: models.verifierModel, maxTokens: 2000, purpose: "verifier" }, opts);
    responses.push(r);
    await opts.onCall?.(r);
    const report = parseVerifierOutput(r.text);
    if (report) return { report, responses };
  }
  return {
    report: {
      verdict: "fail",
      checks: [{ name: "verifier_output_valid", passed: false, reason: "Verifier did not return valid JSON twice" }],
      concerns: ["Verifier output invalid"],
    },
    responses,
  };
}

// ---------------------------------------------------------------------------
// Team mode (Scrum Mode): standup briefs and nudge drafts
// ---------------------------------------------------------------------------

export const TEAM_VERIFIER_SYSTEM_PROMPT = loadPrompt("team-verifier").body;
export const TEAM_VERIFIER_PROMPT_STAMP = promptStamp("team-verifier");

export interface TeamVerifierInput {
  kind: "brief" | "nudge";
  facts: unknown;
  output: unknown;
}

export function buildTeamVerifierMessage(input: TeamVerifierInput): string {
  return [
    "Review this output. The <team_review_request> block is from the harness (trusted).",
    `<team_review_request>\n${JSON.stringify({ kind: input.kind })}\n</team_review_request>`,
    wrapUntrusted("sprint-facts", JSON.stringify(input.facts, null, 1).slice(0, 30_000)),
    wrapUntrusted("output-under-review", JSON.stringify(input.output, null, 1).slice(0, 20_000)),
  ].join("\n\n");
}

export function runTeamVerifier(
  input: TeamVerifierInput,
  models: { verifierModel: string; workerModel: string },
  opts: GatewayOptions & { onCall?: (r: LlmResponse) => Promise<void> } = {},
): Promise<{ report: VerifierReport; responses: LlmResponse[] }> {
  return review(TEAM_VERIFIER_SYSTEM_PROMPT, buildTeamVerifierMessage(input), models, opts);
}
