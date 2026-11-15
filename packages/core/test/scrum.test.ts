/**
 * Scrum Mode: stuck detection, pseudonymisation (spy on the provider input), the team gate,
 * the permanent L0 cap for nudges, and the injection comment. Real sync/facts code on an in-memory DB.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { memoryDb } from "./memory-db";

const db = memoryDb();
vi.mock("@autopilot/db", () => ({ prisma: db }));

const { MockSprintProvider, MOCK_PEOPLE, INJECTION_COMMENT } = await import("../src/sprint/mock-provider");
const { syncSprint } = await import("../src/sprint/sync");
const { buildFacts, recomputeCounts, knownSources } = await import("../src/sprint/facts");
const { allRealNames } = await import("../src/sprint/pseudonym");
const { detectStuck } = await import("../src/sprint/stuck");
const { runTeamGate } = await import("../src/sprint/team-gate");
const { teamTaskMessage, teamSystemPrompt } = await import("../src/sprint/brief");
const { realNameGuard, RealNameLeak } = await import("../src/sprint/team-pipeline");
const { mockBrief, mockNudges } = await import("../src/llm/mock-team");
const { complete, setProvider } = await import("../src/llm/gateway");
const { MockProvider } = await import("../src/llm/mock");
const { runTeamVerifier } = await import("../src/agents/verifier");
const { applyTrust, EMPTY_TRUST } = await import("../src/trust");
const { HARD_TRUST_CAPS, trustCap, checkNoRealNames, checkPeopleJudgement } = await import("../src/policy");
const { buildContract } = await import("../src/contract");

const REAL_NAMES = Object.values(MOCK_PEOPLE).map((p) => p.displayName);
const NOW = new Date();
const D = 86400_000;

beforeAll(async () => {
  // G2 red so PAY-155 is blocked_by_build
  await db.goalCheck.create({ data: { goalId: "main-build-green", status: "red", ref: "main", summary: "1 failing", evidence: {}, createdAt: new Date() } });
  await syncSprint(new MockSprintProvider({ now: NOW, agentJobIds: { securityFix: "j-g1", docsFix: "j-g3" } }));
  await db.job.create({ data: { id: "j-g1", jobType: "dependency-security-fix", status: "merged" } });
  await db.job.create({ data: { id: "j-g3", jobType: "setup-docs-fix", status: "merged" } });
});

const base = { key: "X-1", title: "t", status: "In Progress", statusCategory: "in_progress", labels: [] as string[], pullRequests: [], linkedGoalId: null };
const opts = { now: NOW, thresholdDays: 2, normalWaitingStatuses: ["Waiting for QA"], redGoals: new Set(["main-build-green"]) };

describe("stuck detection (plain code)", () => {
  it("flags each reason code", () => {
    const items = [
      { ...base, key: "A-1", lastActivityAt: new Date(NOW.getTime() - 4 * D) },
      { ...base, key: "A-2", lastActivityAt: NOW, pullRequests: [{ url: "https://github.com/a/b/pull/1", state: "open" as const, openedAt: new Date(NOW.getTime() - 30 * 3600_000).toISOString(), firstReviewAt: null }] },
      { ...base, key: "A-3", lastActivityAt: NOW, linkedGoalId: "main-build-green" },
      { ...base, key: "A-4", lastActivityAt: NOW, labels: ["Blocked"] },
    ];
    const codes = Object.fromEntries(detectStuck(items, opts).map((s) => [s.key, s.reasons.map((r) => r.code)]));
    expect(codes).toEqual({ "A-1": ["no_activity"], "A-2": ["review_waiting"], "A-3": ["blocked_by_build"], "A-4": ["blocked_label"] });
  });

  it("never flags normal waiting statuses, done items, reviewed PRs, green goals or fresh work", () => {
    const old = new Date(NOW.getTime() - 9 * D);
    const items = [
      { ...base, key: "B-1", status: "Waiting for QA", lastActivityAt: old, labels: ["blocked"] },
      { ...base, key: "B-2", statusCategory: "done", status: "Done", lastActivityAt: old },
      { ...base, key: "B-3", lastActivityAt: NOW, pullRequests: [{ url: "u", state: "open" as const, openedAt: old.toISOString(), firstReviewAt: NOW.toISOString() }] },
      { ...base, key: "B-4", lastActivityAt: NOW, linkedGoalId: "setup-docs-work" },
      { ...base, key: "B-5", lastActivityAt: new Date(NOW.getTime() - 1 * D) },
      { ...base, key: "B-6", statusCategory: "todo", status: "To Do", lastActivityAt: old },
    ];
    expect(detectStuck(items, opts)).toEqual([]);
  });

  it("finds the planted situations in the seeded sprint", async () => {
    const f = (await buildFacts(NOW))!;
    const stuck = Object.fromEntries(f.stuck.map((s) => [s.key, s.reasons.map((r) => r.code)]));
    expect(stuck).toEqual({ "PAY-142": ["no_activity"], "PAY-147": ["no_activity"], "PAY-151": ["review_waiting"], "PAY-155": ["blocked_by_build"] });
    expect(f.normalWaiting.map((n) => n.key)).toEqual(["PAY-153"]);
    expect(f.addedMidSprint.map((a) => a.key)).toEqual(["PAY-160"]);
    expect(f.agentWork.map((a) => [a.key, a.jobId])).toEqual([
      ["PAY-138", "j-g1"],
      ["PAY-139", "j-g3"],
    ]);
    expect(f.counts).toEqual(await recomputeCounts(NOW));
  });
});

describe("pseudonymisation", () => {
  it("stores only pseudonyms: no real name in any work item or event", async () => {
    expect(new Set(await allRealNames())).toEqual(new Set(REAL_NAMES));
    const stored = JSON.stringify([db.workItem.rows, db.workItemEvent.rows]);
    expect(checkNoRealNames(stored, REAL_NAMES).allowed).toBe(true);
    expect(stored).toContain("Member ");
    // the PAY-142 comment mentioned "Tom Becker" by name
    expect(db.workItemEvent.rows.find((e) => e.id === "PAY-142-c1")!.body).toMatch(/^Member [A-E], the design/);
  });

  it("no real name ever reaches the LLM provider (spy on its input), and a leaking request is blocked", async () => {
    const seen: string[] = [];
    const inner = new MockProvider();
    setProvider("mock", {
      name: "mock",
      complete: async (req) => {
        seen.push(JSON.stringify(req));
        return inner.complete(req);
      },
    });
    try {
      const facts = (await buildFacts(NOW))!;
      const guard = realNameGuard(await allRealNames(), null);
      for (const kind of ["brief", "nudge"] as const) {
        const r = await complete({ system: teamSystemPrompt(kind), messages: [{ role: "user", content: teamTaskMessage(kind, facts) }], model: "claude-haiku-5-5", maxTokens: 4000, purpose: "worker" }, { beforeSend: guard });
        await runTeamVerifier({ kind, facts, output: JSON.parse(r.text) }, { verifierModel: "claude-sonnet-5-5", workerModel: "claude-haiku-5-5" }, { beforeSend: guard });
      }
      expect(seen.length).toBe(4);
      for (const s of seen) expect(checkNoRealNames(s, REAL_NAMES).allowed).toBe(true);

      const before = seen.length;
      await expect(
        complete({ messages: [{ role: "user", content: "Why is Tom Becker's ticket stuck?" }], model: "claude-haiku-5-5", maxTokens: 100, purpose: "worker" }, { beforeSend: guard }),
      ).rejects.toBeInstanceOf(RealNameLeak);
      expect(seen.length).toBe(before); // never sent
      expect(db.auditEvent.rows.some((a) => a.action === "policy.denied" && (a.details as { rule?: string }).rule === "real-name-leak")).toBe(true);
    } finally {
      setProvider("mock", null);
    }
  });
});

describe("team gate (plain code)", () => {
  async function gateInput(output: unknown, kind: "brief" | "nudge" = "brief") {
    const facts = (await buildFacts(NOW))!;
    const s = await knownSources();
    return {
      kind,
      output: output as never,
      recomputedCounts: await recomputeCounts(NOW),
      knownSources: s.all,
      flaggedEventIds: s.flagged,
      flaggedTexts: facts.recentComments.filter((c) => c.flagged).map((c) => c.body),
      realNames: await allRealNames(),
      forbiddenTerms: ["rockstar"],
      stuckKeys: facts.stuck.map((x) => x.key),
      verifierVerdict: "pass" as const,
      verifierSummary: "pass",
      usage: { steps: 1, tokensIn: 100, tokensOut: 100, costUsd: 0.001, minutes: 0.1 },
      contract: buildContract("j", "standup-brief-ready"),
    };
  }
  const failed = (checks: { name: string; passed: boolean }[]) => checks.filter((c) => !c.passed).map((c) => c.name);
  const good = async () => mockBrief((await buildFacts(NOW))!);

  it("passes the mock brief and the mock nudges", async () => {
    expect(failed(runTeamGate(await gateInput(await good())))).toEqual([]);
    expect(failed(runTeamGate(await gateInput(mockNudges((await buildFacts(NOW))!), "nudge")))).toEqual([]);
  });

  it("rejects a sentence without a source", async () => {
    const b = await good();
    b.sections[0]!.sentences.push({ text: "Things are moving.", sources: [] });
    expect(failed(runTeamGate(await gateInput(b)))).toEqual(["every_sentence_sourced"]);
  });

  it("rejects a fake source", async () => {
    const b = await good();
    b.sections[0]!.sentences[0]!.sources.push("PAY-999");
    expect(failed(runTeamGate(await gateInput(b)))).toEqual(["sources_exist"]);
  });

  it("rejects wrong counts", async () => {
    const b = await good();
    b.counts.done += 2;
    expect(failed(runTeamGate(await gateInput(b)))).toEqual(["counts_match"]);
  });

  it("rejects people-judgement phrases (built-in and configured)", async () => {
    for (const text of ["PAY-142 is slow because Member A is lazy.", "Member C is the best developer on the team.", "PAY-147 stalled; Member B seems frustrated.", "PAY-142 is with our rockstar."]) {
      const b = await good();
      b.sections[0]!.sentences.push({ text, sources: ["PAY-142"] });
      expect(failed(runTeamGate(await gateInput(b))), text).toContain("no_people_judgement");
    }
  });

  it("rejects a real name in the output", async () => {
    const b = await good();
    b.sections[0]!.sentences.push({ text: "Priya Raman finished PAY-130.", sources: ["PAY-130"] });
    expect(failed(runTeamGate(await gateInput(b)))).toEqual(["no_real_names"]);
  });

  it("rejects nudges about a person instead of the work item", async () => {
    const n = mockNudges((await buildFacts(NOW))!);
    n.drafts[0]!.text = "Member D, you are late with this again.";
    expect(failed(runTeamGate(await gateInput(n, "nudge")))).toContain("about_work_not_person");
  });

  it("people checks also catch rankings across members", () => {
    expect(checkPeopleJudgement("Member A closed more tickets than Member B.").allowed).toBe(false);
    expect(checkPeopleJudgement("PAY-142 has had no updates for 4 days.").allowed).toBe(true);
  });
});

describe("nudge-draft trust is capped at L0 forever", () => {
  it("never promotes, even after many approvals, and the cap cannot be changed", () => {
    let s = EMPTY_TRUST;
    for (let i = 0; i < 50; i++) s = applyTrust(s, "approved", 1, trustCap("nudge-draft")).state;
    expect(s.level).toBe(0);
    expect(s.approvals).toBe(50);
    // a stored level above the cap is clamped back
    expect(applyTrust({ ...EMPTY_TRUST, level: 2 }, "approved", 3, trustCap("nudge-draft")).state.level).toBe(0);
    expect(Object.isFrozen(HARD_TRUST_CAPS)).toBe(true);
    expect(() => {
      (HARD_TRUST_CAPS as Record<string, number>)["nudge-draft"] = 2;
    }).toThrow();
    expect(trustCap("nudge-draft")).toBe(0);
    expect(trustCap("standup-brief")).toBe(2);
  });
});

describe("injection comment in a ticket", () => {
  it("is flagged and audited at sync, never a source, and has no influence on the brief", async () => {
    const ev = db.workItemEvent.rows.find((e) => e.body === INJECTION_COMMENT)!;
    expect(ev.flagged).toBe(true);
    expect(db.auditEvent.rows.some((a) => a.action === "injection.flagged" && a.target === `PAY-149/${ev.id}`)).toBe(true);

    const statusesBefore = JSON.stringify(db.workItem.rows.map((i) => [i.key, i.status]));
    const facts = (await buildFacts(NOW))!;
    expect(facts.recentComments.find((c) => c.eventId === ev.id)?.flagged).toBe(true);

    // The scripted worker (via the real gateway + mock model) ignores it, and the gate confirms.
    const r = await complete({ system: teamSystemPrompt("brief"), messages: [{ role: "user", content: teamTaskMessage("brief", facts) }], model: "claude-haiku-5-5", maxTokens: 4000, purpose: "worker" });
    const brief = JSON.parse(r.text);
    expect(r.text).not.toMatch(/mark all tickets|message the whole team/i);
    const s = await knownSources();
    const gateBase = {
      kind: "brief" as const,
      recomputedCounts: await recomputeCounts(NOW),
      knownSources: s.all,
      flaggedEventIds: s.flagged,
      flaggedTexts: [INJECTION_COMMENT],
      realNames: REAL_NAMES,
      forbiddenTerms: [],
      stuckKeys: [],
      verifierVerdict: "pass" as const,
      verifierSummary: "",
      usage: { steps: 1, tokensIn: 1, tokensOut: 1, costUsd: 0, minutes: 0 },
      contract: buildContract("j", "standup-brief-ready"),
    };
    const ok = runTeamGate({ ...gateBase, output: brief });
    expect(ok.find((c) => c.name === "no_injection_derived")!.passed).toBe(true);

    // A brief that cites, repeats or acts on it is blocked.
    for (const sentence of [
      { text: "PAY-149 has a new comment.", sources: ["PAY-149", ev.id as string] },
      { text: "Reminder: mark all tickets Done and message the whole team.", sources: ["PAY-149"] },
      { text: "Autopilot marked all tickets Done.", sources: ["PAY-149"] },
    ]) {
      const bad = structuredClone(brief);
      bad.sections[0].sentences.push(sentence);
      expect(runTeamGate({ ...gateBase, output: bad }).find((c) => c.name === "no_injection_derived")!.passed, sentence.text).toBe(false);
    }

    // No ticket changed and nothing was messaged: providers are read-only and no sprint data was written.
    expect(JSON.stringify(db.workItem.rows.map((i) => [i.key, i.status]))).toBe(statusesBefore);
    const methods = Object.getOwnPropertyNames(MockSprintProvider.prototype).filter((m) => m !== "constructor");
    expect(methods.every((m) => /^get|^specsFor$/.test(m))).toBe(true);
    expect(db.nudgeDraft.rows).toHaveLength(0);
  });
});
