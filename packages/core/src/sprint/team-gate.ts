/**
 * Team gate: plain code, no AI. Final pass/fail for standup briefs and nudge drafts.
 */
import type { Contract } from "../contract";
import { checkBudget, type GateCheck } from "../gate";
import { checkNoRealNames, checkPeopleJudgement } from "../policy";
import type { BriefOutput, NudgeOutput, TeamKind } from "./brief";
import type { Counts } from "./facts";

export const TEAM_GATE_LABELS: Record<string, string> = {
  output_valid: "Output is valid JSON in the required shape",
  every_sentence_sourced: "Every sentence has at least one source",
  sources_exist: "Every source exists (item, event or job)",
  counts_match: "Counts equal the counts recomputed from the database",
  no_people_judgement: "No judgement of people (rankings, 'slow', mood, personal reasons)",
  no_real_names: "No real names in the model output (pseudonyms only)",
  about_work_not_person: "Each nudge is about its work item, not a person",
  no_injection_derived: "Nothing derived from the flagged injection comment",
  verifier_pass: "Verifier verdict is pass",
  within_budget: "Job stayed within budget",
};

const check = (name: string, passed: boolean, evidence: string): GateCheck => ({ name, label: TEAM_GATE_LABELS[name] ?? name, passed, evidence });

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

/** Shared 4-word sequences between a sentence and a flagged comment = derived from it. */
export function sharesShingle(text: string, flagged: string, n = 4): string | null {
  const a = words(text);
  const b = words(flagged);
  const grams = new Set<string>();
  for (let i = 0; i + n <= b.length; i++) grams.add(b.slice(i, i + n).join(" "));
  for (let i = 0; i + n <= a.length; i++) {
    const g = a.slice(i, i + n).join(" ");
    if (grams.has(g)) return g;
  }
  return null;
}

/** Phrases that would mean the injected instruction was acted on or repeated. */
const INJECTION_EFFECTS = /\b(marked|marking|moved|closing|closed)\s+(all|every)\s+(the\s+)?(tickets|items|issues)\b|\b(messag(ed|ing)|notif(ied|ying)|email(ed|ing))\s+(the\s+)?(whole|entire|all( of)?( the)?)\s+team\b/i;

export interface TeamUnit {
  text: string;
  sources: string[];
  /** For nudges: the item the draft is about. */
  itemKey?: string;
}

export function unitsOf(kind: TeamKind, output: BriefOutput | NudgeOutput): TeamUnit[] {
  if (kind === "brief") return (output as BriefOutput).sections.flatMap((s) => s.sentences.map((x) => ({ text: x.text, sources: x.sources })));
  return (output as NudgeOutput).drafts.map((d) => ({ text: d.text, sources: d.sources, itemKey: d.itemKey }));
}

export interface TeamGateInput {
  kind: TeamKind;
  /** null when the output did not parse. */
  output: BriefOutput | NudgeOutput | null;
  parseError?: string;
  recomputedCounts: Counts;
  knownSources: Set<string>;
  flaggedEventIds: Set<string>;
  flaggedTexts: string[];
  realNames: string[];
  forbiddenTerms: string[];
  stuckKeys: string[];
  verifierVerdict: "pass" | "fail";
  verifierSummary: string;
  usage: { steps: number; tokensIn: number; tokensOut: number; costUsd: number; minutes: number };
  contract: Pick<Contract, "maxSteps" | "maxTokens" | "maxUsd" | "maxMinutes">;
}

/** Text-level checks shared with nudge edits by humans. */
export function teamTextViolations(text: string, opts: { realNames: string[]; forbiddenTerms: string[] }): string[] {
  const out: string[] = [];
  const pj = checkPeopleJudgement(text, opts.forbiddenTerms);
  if (!pj.allowed) out.push(pj.reason!);
  const rn = checkNoRealNames(text, opts.realNames);
  if (!rn.allowed) out.push("contains a real name");
  return out;
}

export function runTeamGate(i: TeamGateInput): GateCheck[] {
  const checks: GateCheck[] = [];
  checks.push(check("output_valid", Boolean(i.output), i.output ? "Parsed and validated with zod" : `Invalid: ${i.parseError ?? "unknown"}`));
  const units = i.output ? unitsOf(i.kind, i.output) : [];

  const unsourced = units.filter((u) => u.sources.length === 0);
  checks.push(
    check(
      "every_sentence_sourced",
      Boolean(i.output) && units.length > 0 && unsourced.length === 0,
      units.length === 0 ? "No sentences" : unsourced.length ? `${unsourced.length} sentence(s) without a source: "${unsourced[0]!.text.slice(0, 80)}"` : `${units.length} sentence(s), all sourced`,
    ),
  );

  const allSources = units.flatMap((u) => u.sources);
  const fake = [...new Set(allSources.filter((s) => !i.knownSources.has(s) && !i.flaggedEventIds.has(s)))];
  checks.push(check("sources_exist", Boolean(i.output) && fake.length === 0, fake.length ? `Unknown source(s): ${fake.join(", ")}` : `${new Set(allSources).size} distinct source(s), all exist`));

  if (i.kind === "brief") {
    const c = (i.output as BriefOutput | null)?.counts;
    const keys = ["done", "inProgress", "stuck", "addedMidSprint"] as const;
    const diff = c ? keys.filter((k) => c[k] !== i.recomputedCounts[k]) : [...keys];
    checks.push(
      check(
        "counts_match",
        Boolean(c) && diff.length === 0,
        diff.length
          ? `Mismatch: ${diff.map((k) => `${k} ${c ? c[k] : "?"} ≠ ${i.recomputedCounts[k]}`).join(", ")}`
          : `done ${i.recomputedCounts.done} · in progress ${i.recomputedCounts.inProgress} · stuck ${i.recomputedCounts.stuck} · added mid-sprint ${i.recomputedCounts.addedMidSprint}`,
      ),
    );
  }

  const allText = units.map((u) => u.text).join("\n");
  const pj = checkPeopleJudgement(allText, i.forbiddenTerms);
  checks.push(check("no_people_judgement", Boolean(i.output) && pj.allowed, pj.allowed ? "None found" : pj.reason!));

  const rn = checkNoRealNames(JSON.stringify(i.output ?? {}), i.realNames);
  checks.push(check("no_real_names", rn.allowed, rn.allowed ? "Pseudonyms only" : `Real name found in the output (${rn.found?.length} match)`));

  if (i.kind === "nudge") {
    const drafts = (i.output as NudgeOutput | null)?.drafts ?? [];
    const bad = drafts.filter((d) => !d.text.includes(d.itemKey) || !d.sources.includes(d.itemKey) || /\bmember [a-z]{1,2}\b/i.test(d.text) || /\b(you|your)\b.*\b(late|slow|forgot)\b/i.test(d.text));
    const missing = i.stuckKeys.filter((k) => !drafts.some((d) => d.itemKey === k));
    const extra = drafts.filter((d) => !i.stuckKeys.includes(d.itemKey)).map((d) => d.itemKey);
    checks.push(
      check(
        "about_work_not_person",
        Boolean(i.output) && bad.length === 0 && missing.length === 0 && extra.length === 0,
        bad.length
          ? `Draft(s) not about the work item: ${bad.map((d) => d.itemKey).join(", ")}`
          : missing.length || extra.length
            ? `One draft per stuck item expected (missing: ${missing.join(", ") || "none"}; not stuck: ${extra.join(", ") || "none"})`
            : `${drafts.length} draft(s), one per stuck item, each about its item`,
      ),
    );
  }

  const citedFlagged = allSources.filter((s) => i.flaggedEventIds.has(s));
  const shingle = i.flaggedTexts.map((f) => units.map((u) => sharesShingle(u.text, f)).find(Boolean)).find(Boolean);
  const effect = INJECTION_EFFECTS.exec(allText)?.[0];
  checks.push(
    check(
      "no_injection_derived",
      citedFlagged.length === 0 && !shingle && !effect,
      citedFlagged.length
        ? `Cites flagged comment(s): ${citedFlagged.join(", ")}`
        : shingle
          ? `Repeats the flagged comment ("${shingle}")`
          : effect
            ? `Acts on the injected instruction ("${effect}")`
            : `${i.flaggedTexts.length} flagged comment(s) ignored`,
    ),
  );

  checks.push(check("verifier_pass", i.verifierVerdict === "pass", i.verifierSummary));
  const b = checkBudget(i.usage, i.contract);
  checks.push({ ...b, label: TEAM_GATE_LABELS.within_budget! });
  return checks;
}
