/**
 * Team jobs (standup-brief, nudge-draft) on the SAME engine as code jobs:
 * conductor contract → worker loop (budgets, kill switch, checkpoints) → verifier (different model)
 * → plain-code team gate → approvals → trust ledger + lessons. No git, no files, no sending.
 */
import { prisma } from "@autopilot/db";
import { audit } from "../audit";
import { type Contract, GOAL_LABEL, type GoalId } from "../contract";
import { runAgentLoop } from "../agents/worker";
import { runTeamVerifier, type VerifierReport } from "../agents/verifier";
import { runGoalChecks } from "../goals/index";
import { addUsage, contractFromRow, finish, lessonFor, loadJob, StepRecorder, TERMINAL_STATUSES } from "../job-steps";
import { complete } from "../llm/gateway";
import { routeModels } from "../llm/router";
import type { CompleteRequest } from "../llm/types";
import { checkNoRealNames } from "../policy";
import { getTrust, recordTrust } from "../trust";
import { isKillSwitchOn } from "../settings";
import { BriefOutput, briefToText, NudgeOutput, parseJsonOutput, type TeamKind, teamSystemPrompt, teamTaskMessage } from "./brief";
import { localDate, sprintSettings } from "./data";
import { buildFacts, knownSources, recomputeCounts } from "./facts";
import { allRealNames } from "./pseudonym";
import { sprintProviderName, syncConfiguredSprint } from "./provider";
import { runTeamGate, TEAM_GATE_LABELS } from "./team-gate";

export class RealNameLeak extends Error {
  constructor(public found: number) {
    super(`Blocked: a request to the model contained ${found} real-name match(es). Sprint data must be pseudonymised before the model.`);
    this.name = "RealNameLeak";
  }
}

/** Gateway guard (AGENTS.md rule 9): refuse to send any request containing a real name. */
export function realNameGuard(realNames: string[], jobId: string | null) {
  return async (req: CompleteRequest) => {
    const r = checkNoRealNames(JSON.stringify({ system: req.system, messages: req.messages }), realNames);
    if (!r.allowed) {
      await audit({ actor: "policy", action: "policy.denied", target: "model request", severity: "denied", jobId, details: { rule: r.rule, reason: r.reason } });
      throw new RealNameLeak(r.found?.length ?? 1);
    }
  };
}

const kindOf = (jobType: string): TeamKind => (jobType === "nudge-draft" ? "nudge" : "brief");

export async function runTeamJob(jobId: string): Promise<void> {
  const job = await loadJob(jobId);
  if (!job?.contract) return;
  if (TERMINAL_STATUSES.includes(job.status) || job.status === "awaiting_approval") return;
  const contract: Contract = contractFromRow(job.contract, jobId);
  const kind = kindOf(job.jobType);
  const rec = new StepRecorder(jobId, job.attempt);
  await rec.init();

  if ((job.status === "queued" || job.status === "changes_requested") && (await isKillSwitchOn())) {
    await rec.note("system", "Kill switch is on: job refused to start", "error");
    await finish(jobId, "killed", "Kill switch is on: job refused to start");
    return;
  }
  let route: ReturnType<typeof routeModels>;
  try {
    route = routeModels(contract.difficulty);
  } catch (e) {
    await finish(jobId, "failed", (e as Error).message);
    return;
  }
  const scripted = job.source === "demo-bad-brief";
  const startedAt = job.startedAt ?? new Date();
  await prisma.job.update({
    where: { id: jobId },
    data: { status: "running", startedAt, workerModel: route.workerModel, verifierModel: route.verifierModel, provider: route.provider },
  });
  await audit({ actor: "worker", action: "job.started", target: jobId, jobId, details: { kind, attempt: job.attempt, workerModel: route.workerModel, verifierModel: route.verifierModel } });

  try {
    if (sprintProviderName() === "jira") {
      const s = await syncConfiguredSprint();
      await rec.note("system", `Synced from Jira (read-only GET): ${s.items} items, ${s.events} events, ${s.flagged.length} flagged`);
    }
    // FACTS FIRST (plain code)
    const facts = await buildFacts();
    if (!facts) {
      await finish(jobId, "failed", "No active sprint synced (run pnpm cli seed-sprint or sync-sprint)");
      return;
    }
    const settings = await sprintSettings();
    await rec.note(
      "system",
      `${scripted ? "Scripted bad brief · " : ""}Facts built in code for ${facts.sprint.name} (day ${facts.sprint.day}/${facts.sprint.days}): done ${facts.counts.done} · in progress ${facts.counts.inProgress} · stuck ${facts.counts.stuck} · added mid-sprint ${facts.counts.addedMidSprint} · ${facts.recentComments.filter((c) => c.flagged).length} flagged comment(s) marked untrusted. People are pseudonymised; real names never leave the database.`,
    );
    if (kind === "nudge" && facts.stuck.length === 0) {
      await finish(jobId, "failed", "Nothing is stuck: no nudges to draft");
      return;
    }

    const realNames = await allRealNames();
    const guard = realNameGuard(realNames, jobId);

    // WORKER: the existing bounded loop (no tools: the model only words the facts)
    const result = await runAgentLoop(
      {
        system: teamSystemPrompt(kind),
        tools: [],
        model: route.workerModel,
        script: scripted ? "bad-brief" : undefined,
        budget: contract,
        initialMessages: [{ role: "user", content: teamTaskMessage(kind, facts, job.feedback) }],
        maxTokensPerCall: 4000,
      },
      {
        llm: async (req) => {
          const r = await complete(req, { ...(scripted ? { provider: "mock" as const } : {}), beforeSend: guard });
          await addUsage(jobId, r);
          return r;
        },
        exec: async () => ({ content: "No tools are available for this job.", isError: true }),
        record: (s) => rec.record("worker", s),
        shouldStop: async () => ((await isKillSwitchOn()) ? "Kill switch is on" : null),
      },
    );
    await prisma.job.update({ where: { id: jobId }, data: { stepsUsed: result.usage.steps } });
    if (result.status !== "done") {
      const status = result.status === "error" ? "failed" : result.status;
      await finish(jobId, status, result.reason);
      if (status === "budget_exceeded") await recordTrust(job.jobType, "gate_failed", jobId, `budget exceeded: ${result.reason}`);
      await lessonFor(jobId, rec, "fail", `${status}: ${result.reason}`, [status]);
      return;
    }

    const parsed = kind === "brief" ? parseJsonOutput(BriefOutput, result.explanation) : parseJsonOutput(NudgeOutput, result.explanation);
    const output = parsed.ok ? (parsed.value as BriefOutput | NudgeOutput) : null;
    const today = localDate();
    let briefId: string | null = null;
    if (kind === "brief") {
      const b = await prisma.standupBrief.create({
        data: { sprintId: facts.sprint.id, date: today, jobId, status: "pending", content: (output ?? { invalid: result.explanation.slice(0, 2000) }) as object, facts: facts as unknown as object },
      });
      briefId = b.id;
    } else if (output) {
      await prisma.nudgeDraft.deleteMany({ where: { jobId } });
      for (const d of (output as NudgeOutput).drafts) {
        await prisma.nudgeDraft.create({ data: { jobId, itemKey: d.itemKey, reasonCode: d.reasonCode, text: d.text, sources: d.sources, status: "pending" } });
      }
    }
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: "verifying",
        explanation: output ? (kind === "brief" ? briefToText(output as BriefOutput) : (output as NudgeOutput).drafts.map((d) => `${d.itemKey}: ${d.text}`).join("\n")) : result.explanation.slice(0, 2000),
        analysis: { kind, facts, output, briefId } as unknown as object,
        evidence: [
          { step: 1, kind: "facts", note: `counts ${JSON.stringify(facts.counts)}` },
          ...facts.recentComments.filter((c) => c.flagged).map((c, i) => ({ step: 2 + i, kind: "injection_flag", target: `${c.key}/${c.eventId}`, note: c.body })),
        ] as object,
      },
    });

    // VERIFIER (different model; sees facts + output only)
    let report: VerifierReport;
    if (output) {
      const v = await runTeamVerifier(
        { kind, facts, output },
        { verifierModel: route.verifierModel, workerModel: route.workerModel },
        {
          beforeSend: guard,
          onCall: async (r) => {
            await addUsage(jobId, r);
            await rec.llm("verifier", r, `Review ${kind} against the facts. Worker reasoning withheld.`);
          },
        },
      );
      report = v.report;
    } else {
      report = { verdict: "fail", checks: [{ name: "output_valid", passed: false, reason: parsed.ok ? "" : parsed.error }], concerns: ["Output did not parse"] };
    }
    await prisma.verifierReport.create({
      data: { jobId, attempt: job.attempt, model: route.verifierModel, provider: route.provider, verdict: report.verdict, checks: report.checks, concerns: report.concerns },
    });
    await audit({ actor: "verifier", action: `verifier.${report.verdict}`, target: jobId, jobId, severity: report.verdict === "pass" ? "info" : "warn", details: { concerns: report.concerns } });
    await prisma.job.update({ where: { id: jobId }, data: { status: "gating" } });

    // GATE (plain code)
    const j = (await loadJob(jobId))!;
    const sources = await knownSources();
    const checks = runTeamGate({
      kind,
      output,
      parseError: parsed.ok ? undefined : parsed.error,
      recomputedCounts: await recomputeCounts(),
      knownSources: sources.all,
      flaggedEventIds: sources.flagged,
      flaggedTexts: facts.recentComments.filter((c) => c.flagged).map((c) => c.body),
      realNames,
      forbiddenTerms: settings.forbiddenTerms,
      stuckKeys: facts.stuck.map((s) => s.key),
      verifierVerdict: report.verdict,
      verifierSummary: `${report.verdict} (${route.verifierModel})${report.concerns.length ? ` · ${report.concerns.join(" | ")}` : ""}`,
      usage: { steps: j.stepsUsed, tokensIn: j.tokensIn, tokensOut: j.tokensOut, costUsd: j.costUsd, minutes: (Date.now() - startedAt.getTime()) / 60_000 },
      contract,
    });
    await prisma.gateResult.deleteMany({ where: { jobId, attempt: j.attempt } });
    await prisma.gateResult.createMany({ data: checks.map((c) => ({ jobId, attempt: j.attempt, name: c.name, passed: c.passed, evidence: c.evidence })) });
    const passed = checks.every((c) => c.passed);
    await rec.note("gate", checks.map((c) => `${c.passed ? "✓" : "✗"} ${TEAM_GATE_LABELS[c.name] ?? c.label}: ${c.evidence}`).join("\n"), passed ? "ok" : "error");
    await audit({ actor: "gate", action: passed ? "gate.passed" : "gate.failed", target: jobId, jobId, severity: passed ? "info" : "warn", details: { failed: checks.filter((c) => !c.passed).map((c) => c.name) } });
    await recordTrust(j.jobType, "run", jobId, "job ran");

    if (!passed) {
      if (briefId) await prisma.standupBrief.update({ where: { id: briefId }, data: { status: "blocked" } });
      await prisma.nudgeDraft.updateMany({ where: { jobId }, data: { status: "blocked" } });
      const failed = checks.filter((c) => !c.passed);
      await finish(jobId, "gate_failed", `Gate failed: ${failed.map((c) => c.name).join(", ")}`);
      await recordTrust(j.jobType, "gate_failed", jobId, failed.map((c) => c.name).join(", "));
      await lessonFor(jobId, rec, "fail", failed.map((c) => `${c.name}: ${c.evidence}`).join("; "), failed.map((c) => c.name), report.concerns);
      return;
    }

    if (briefId) await prisma.standupBrief.update({ where: { id: briefId }, data: { status: "awaiting_approval" } });
    await prisma.nudgeDraft.updateMany({ where: { jobId }, data: { status: "awaiting_approval" } });
    await prisma.job.update({ where: { id: jobId }, data: { status: "awaiting_approval" } });
    await audit({ actor: "gate", action: "job.awaiting_approval", target: jobId, jobId, details: { goal: j.goalId, kind } });

    // L1+ (earned) briefs auto-publish to the dashboard only. Nudges never: hard L0 cap.
    const trust = await getTrust(j.jobType);
    if (kind === "brief" && trust.level >= 1 && briefId) {
      await publishBrief(jobId, "system", `auto-published at trust ${trust.level === 1 ? "L1" : "L2"} (dashboard only)`);
    }
    await rec.note("system", `Waiting for a human in Approvals (${GOAL_LABEL[j.goalId as GoalId]}). Nothing is sent anywhere automatically.`);
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    await rec.note("system", `Job failed: ${msg}`, "error").catch(() => {});
    const current = await prisma.job.findUnique({ where: { id: jobId } });
    if (current && !TERMINAL_STATUSES.includes(current.status) && current.status !== "awaiting_approval") await finish(jobId, "failed", msg);
  }
}

/** Publish a brief to the dashboard (approval at L0, or auto at L1+). Never posts to Slack/Teams. */
export async function publishBrief(jobId: string, actor: "human" | "system", note?: string) {
  const job = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
  const brief = await prisma.standupBrief.findFirst({ where: { jobId }, orderBy: { createdAt: "desc" } });
  if (!brief) throw new Error(`No brief for job ${jobId}`);
  await prisma.standupBrief.update({ where: { id: brief.id }, data: { status: "published", publishedAt: new Date(), publishedBy: actor } });
  await prisma.approvalDecision.create({ data: { jobId, attempt: job.attempt, decision: "approve", reason: note ?? null, actor } });
  await prisma.job.update({ where: { id: jobId }, data: { status: "published", finishedAt: new Date() } });
  await audit({ actor, action: actor === "system" ? "brief.auto_published" : "brief.published", target: brief.id, jobId, details: { destination: "dashboard only", note } });
  const t = await recordTrust(job.jobType, "approved", jobId, note ?? "approved by human");
  const facts = brief.facts as { normalWaiting?: { status: string }[] };
  const statuses = [...new Set((facts.normalWaiting ?? []).map((n) => n.status))];
  await lessonFor(jobId, null, "pass", `brief published by ${actor}`, [], [], statuses.length ? [`normal waiting statuses: ${statuses.join(", ")}`] : undefined);
  await runGoalChecks(["standup-brief-ready"], `brief ${brief.id} published`);
  return { status: "published", trustChange: t.change };
}
