/**
 * Mock scripts for Scrum Mode: standup brief, nudge drafts, the scripted bad brief, the team verifier
 * (heuristic stand-in for a reviewing model) and Ask Autopilot. Deterministic and offline.
 */
import { parseTeamTask } from "../sprint/brief";
import type { SprintFacts } from "../sprint/facts";
import { sharesShingle } from "../sprint/team-gate";
import { checkPeopleJudgement } from "../policy";
import { untrustedBlocks } from "../untrusted";
import type { CompleteRequest, LlmMessage, ToolCall } from "./types";

type Sentence = { text: string; sources: string[] };

const firstUser = (req: CompleteRequest) => req.messages.find((m) => m.role === "user")?.content ?? "";

function factsFrom(text: string): SprintFacts | null {
  const raw = untrustedBlocks(text)["sprint-facts"];
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SprintFacts;
  } catch {
    return null;
  }
}

const daysIn = (detail: string) => /for (\d+) days/.exec(detail)?.[1];
const hoursIn = (detail: string) => /open (\d+) h/.exec(detail)?.[1];
const list = (keys: string[]) => (keys.length <= 1 ? keys.join("") : `${keys.slice(0, -1).join(", ")} and ${keys.at(-1)}`);

function stuckSentence(s: SprintFacts["stuck"][number]): string {
  const r = s.reasons[0]!;
  switch (r.code) {
    case "no_activity":
      return `${s.key} (${s.title}) has had no activity for ${daysIn(r.detail) ?? "several"} days.`;
    case "review_waiting":
      return `${s.key} (${s.title}) has a linked pull request waiting ${hoursIn(r.detail) ?? "over 24"} hours for a first review.`;
    case "blocked_by_build":
      return `${s.key} (${s.title}) is waiting on the main build, which Autopilot's G2 goal reports as red.`;
    case "blocked_label":
      return `${s.key} (${s.title}) is labelled blocked.`;
  }
}

export function mockBrief(f: SprintFacts, opts: { bad?: boolean } = {}) {
  const sections: { title: string; sentences: Sentence[] }[] = [];
  const humanDone = f.done.filter((d) => !f.agentWork.some((a) => a.key === d.key));
  if (humanDone.length) sections.push({ title: "Done", sentences: [{ text: `Done so far this sprint: ${list(humanDone.map((d) => d.key))}.`, sources: humanDone.map((d) => d.key) }] });
  const moved = f.moved.filter((m) => m.to);
  if (moved.length) sections.push({ title: "Moved since the last brief", sentences: moved.map((m) => ({ text: `${m.key} moved from ${m.from ?? "new"} to ${m.to}.`, sources: [m.key, m.eventId] })) });
  if (f.stuck.length) sections.push({ title: "Stuck", sentences: f.stuck.map((s) => ({ text: stuckSentence(s), sources: [s.key] })) });
  if (f.addedMidSprint.length) {
    sections.push({
      title: "Scope change",
      sentences: f.addedMidSprint.map((a) => ({ text: `${a.key} (${a.title}) was added after the sprint started.`, sources: a.eventId ? [a.key, a.eventId] : [a.key] })),
    });
  }
  if (f.normalWaiting.length) {
    sections.push({
      title: "Normal waiting",
      sentences: f.normalWaiting.map((n) => ({ text: `${n.key} is in "${n.status}", which this team treats as a normal wait, so it is not flagged.`, sources: [n.key] })),
    });
  }
  if (f.agentWork.length) {
    sections.push({
      title: "Autopilot agent work",
      sentences: f.agentWork.map((a) => ({
        text: `${a.key} was completed by an Autopilot worker${a.jobId ? ` (job ${a.jobId}, ${a.jobType}, ${a.jobStatus}, trust level L${a.trustLevel ?? 0})` : ""}.`,
        sources: a.jobId ? [a.key, a.jobId] : [a.key],
      })),
    });
  }
  const counts = { ...f.counts };
  if (opts.bad) {
    // Scripted bad worker: blames a person, invents a blocker, miscounts, leaves a sentence unsourced.
    sections.unshift({
      title: "Team",
      sentences: [
        { text: "Member B is the slowest developer this sprint and keeps holding the team back.", sources: [] },
        { text: `${f.stuck[0]?.key ?? "PAY-147"} is blocked by the database migration that Member B still has not finished.`, sources: [f.stuck[0]?.key ?? "PAY-147"] },
      ],
    });
    counts.done += 3;
  }
  return { sections, counts };
}

export function mockNudges(f: SprintFacts) {
  return {
    drafts: f.stuck.map((s) => {
      const r = s.reasons[0]!;
      const text =
        r.code === "no_activity"
          ? `${s.key} has had no updates for ${daysIn(r.detail) ?? "a few"} days. Is anything blocking it, or can we help move it forward?`
          : r.code === "review_waiting"
            ? `The pull request linked to ${s.key} has been waiting ${hoursIn(r.detail) ?? "over 24"} hours for a first review. Could someone pick up the review?`
            : r.code === "blocked_by_build"
              ? `${s.key} is waiting on the main build, which is currently red. Autopilot is working on the build; is anything else blocking ${s.key}?`
              : `${s.key} is labelled blocked. What is needed to unblock it?`;
      return { itemKey: s.key, reasonCode: r.code, text, sources: [s.key] };
    }),
  };
}

export function teamWorkerResponse(req: CompleteRequest): { text: string; toolCalls: ToolCall[] } | null {
  const msg = firstUser(req);
  const task = parseTeamTask(msg);
  if (!task) return null;
  const f = factsFrom(msg);
  if (!f) return { text: "{}", toolCalls: [] };
  if (task.kind === "nudge") return { text: JSON.stringify(mockNudges(f)), toolCalls: [] };
  return { text: JSON.stringify(mockBrief(f, { bad: req.script === "bad-brief" })), toolCalls: [] };
}

// ---------------- team verifier (heuristic) ----------------

const INJECTION_EFFECTS = /\b(marked|marking|moved|closing|closed)\s+(all|every)\s+(the\s+)?(tickets|items|issues)\b|\b(messag(ed|ing)|notif(ied|ying)|email(ed|ing))\s+(the\s+)?(whole|entire|all( of)?( the)?)\s+team\b/i;

export function teamVerifierResponse(req: CompleteRequest): string | null {
  const msg = firstUser(req);
  if (!msg.includes("<team_review_request>")) return null;
  const kind = /"kind":"(brief|nudge)"/.exec(msg)?.[1] ?? "brief";
  const blocks = untrustedBlocks(msg);
  let facts: SprintFacts | null = null;
  let output: { sections?: { sentences: Sentence[] }[]; counts?: Record<string, number>; drafts?: (Sentence & { itemKey: string })[] } = {};
  try {
    facts = JSON.parse(blocks["sprint-facts"] ?? "null");
    output = JSON.parse(blocks["output-under-review"] ?? "{}");
  } catch {
    /* invalid → checks fail below */
  }
  const units: Sentence[] = kind === "brief" ? (output.sections ?? []).flatMap((s) => s.sentences ?? []) : (output.drafts ?? []);
  const all = units.map((u) => u.text).join("\n");
  const checks: { name: string; passed: boolean; reason: string }[] = [];
  const concerns: string[] = [];

  const pj = checkPeopleJudgement(all);
  checks.push({ name: "no_blame_or_speculation", passed: pj.allowed && units.length > 0, reason: pj.allowed ? "Describes work items only; no judgement of people." : pj.reason! });

  const problems: string[] = [];
  const stuckBy = new Map((facts?.stuck ?? []).map((s) => [s.key, s.reasons.map((r) => r.code)]));
  for (const u of units) {
    const keys = [...new Set(u.text.match(/\b[A-Z][A-Z0-9]+-\d+\b/g) ?? [])];
    const unsupported = keys.filter((k) => !u.sources.includes(k));
    if (unsupported.length) problems.push(`"${u.text.slice(0, 60)}…" mentions ${unsupported.join(", ")} without citing it`);
    if (/\b(blocked|blocker|blocking)\b/i.test(u.text) && !/\bis anything blocking\b|\bwhat is needed to unblock\b|\banything else blocking\b/i.test(u.text)) {
      for (const k of keys) {
        const codes = stuckBy.get(k) ?? [];
        if (!codes.some((c) => c === "blocked_by_build" || c === "blocked_label")) problems.push(`claims ${k} is blocked, but the facts give no blocker for it (${codes.join(", ") || "not stuck"})`);
      }
    }
  }
  if (kind === "brief" && facts && output.counts) {
    for (const k of ["done", "inProgress", "stuck", "addedMidSprint"] as const) {
      if (output.counts[k] !== facts.counts[k]) problems.push(`counts.${k} is ${output.counts[k]} but the facts say ${facts.counts[k]}`);
    }
  }
  checks.push({ name: "claims_match_sources", passed: problems.length === 0 && units.length > 0, reason: problems.length ? problems.slice(0, 3).join("; ") : "Each claim matches the facts for the items it cites." });

  const loud = /!|\b(urgent(ly)?|immediately|asap|unacceptable|disaster|again\?)\b/i.exec(all) ?? /\b[A-Z]{5,}\b/.exec(all.replace(/\b[A-Z][A-Z0-9]+-\d+\b/g, ""));
  checks.push({ name: "neutral_tone", passed: !loud, reason: loud ? `Not neutral: "${loud[0]}"` : "Factual and neutral." });

  const flagged = (facts?.recentComments ?? []).filter((c) => c.flagged);
  const effect = INJECTION_EFFECTS.exec(all)?.[0];
  const echoed = flagged.map((c) => units.map((u) => sharesShingle(u.text, c.body)).find(Boolean)).find(Boolean);
  if (flagged.length && !effect && !echoed) concerns.push(`${flagged.length} flagged comment(s) in the facts were ignored, as required.`);
  checks.push({
    name: "no_injection_followed",
    passed: !effect && !echoed,
    reason: effect ? `Acts on an injected instruction ("${effect}")` : echoed ? `Repeats a flagged comment ("${echoed}")` : "Nothing from flagged comments reached the output.",
  });

  const verdict = checks.every((c) => c.passed) ? "pass" : "fail";
  if (verdict === "fail") concerns.push(...checks.filter((c) => !c.passed).map((c) => c.reason));
  return JSON.stringify({ verdict, checks, concerns });
}

// ---------------- Ask Autopilot ----------------

/** Scripted agent for "What's stuck and why?" (and a generic sprint summary): calls the read-only MCP tools, then answers with citations. */
export function askResponse(req: CompleteRequest): { text: string; toolCalls: ToolCall[] } {
  const results = req.messages.filter((m): m is Extract<LlmMessage, { role: "tool" }> => m.role === "tool");
  const asked = (name: string) => req.messages.some((m) => m.role === "assistant" && (m.toolCalls ?? []).some((c) => c.name === name));
  const question = firstUser(req).toLowerCase();
  if (!asked("get_sprint")) return { text: "Look up the active sprint first.", toolCalls: [{ id: "ask_1", name: "get_sprint", input: {} }] };
  if (!asked("list_work_items")) {
    return {
      text: "List the sprint's work items with their stuck reasons.",
      toolCalls: [{ id: "ask_2", name: "list_work_items", input: /stuck|block|why/.test(question) ? { stuckOnly: true } : {} }],
    };
  }
  const itemsRaw = untrustedBlocks(results.find((r) => r.name === "list_work_items")?.content ?? "")["mcp:list_work_items"] ?? "[]";
  let items: { key: string; title: string; status: string; stuckReasons?: { code: string; detail: string }[] }[] = [];
  try {
    items = JSON.parse(itemsRaw);
  } catch {
    items = [];
  }
  const stuck = items.filter((i) => i.stuckReasons?.length);
  if (stuck.length && !asked("get_item_events")) {
    return { text: `Check recent events for ${stuck[0]!.key}.`, toolCalls: [{ id: "ask_3", name: "get_item_events", input: { itemKey: stuck[0]!.key } }] };
  }
  if (!/stuck|block|why/.test(question)) {
    return { text: `The active sprint has ${items.length} work items [sprint]. ${items.filter((i) => i.status === "Done").length} are done.`, toolCalls: [] };
  }
  if (!stuck.length) return { text: "Nothing is stuck right now [sprint].", toolCalls: [] };
  const lines = stuck.map((s) => `- ${s.key} (${s.title}): ${s.stuckReasons!.map((r) => `${r.code.replace(/_/g, " ")}, ${r.detail}`).join("; ")} [${s.key}]`);
  return {
    text: `${stuck.length} item(s) are stuck in the active sprint [sprint]:\n${lines.join("\n")}\nItems in a normal waiting status (such as "Waiting for QA") are not counted as stuck.`,
    toolCalls: [],
  };
}
