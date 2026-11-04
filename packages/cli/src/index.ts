#!/usr/bin/env tsx
import { readFileSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { getConfig } from "@autopilot/core/config";
import { approveJob, rejectJob, requestChanges } from "@autopilot/core/approvals";
import { checkGoalsAndConduct } from "@autopilot/core/checks";
import { createJob, startJobForGoal } from "@autopilot/core/conductor";
import { GOAL_IDS, type GoalId } from "@autopilot/core/contract";
import { saveFlakyModel, trainFlakyModel } from "@autopilot/core/ml/flaky";
import { runJob } from "@autopilot/core/pipeline";
import { stopBoss } from "@autopilot/core/queue";
import { addRealBug, reintroduceG1, seedDemoTarget } from "@autopilot/core/seed/index";
import { setKillSwitch } from "@autopilot/core/settings";
import { prisma } from "@autopilot/db";
import { runEvals } from "./eval";

const GOAL_ALIASES: Record<string, GoalId> = { g1: "no-critical-vulns", g2: "main-build-green", g3: "setup-docs-work" };
const toGoal = (g: string): GoalId => {
  const id = GOAL_ALIASES[g.toLowerCase()] ?? (g as GoalId);
  if (!GOAL_IDS.includes(id)) throw new Error(`Unknown goal "${g}" (use g1, g2, g3)`);
  return id;
};

async function printJob(jobId: string) {
  const job = await prisma.job.findUniqueOrThrow({
    where: { id: jobId },
    include: { gateResults: { orderBy: { createdAt: "asc" } }, verifierReports: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  console.log(`\nJob ${job.id} · ${job.jobType} · status: ${job.status}`);
  console.log(`cost $${job.costUsd.toFixed(4)} · tokens ${job.tokensIn + job.tokensOut} · steps ${job.stepsUsed}`);
  if (job.explanation) console.log(`\nWorker: ${job.explanation}`);
  const v = job.verifierReports[0];
  if (v) {
    console.log(`\nVerifier (${v.model}): ${v.verdict.toUpperCase()}`);
    for (const c of v.checks as { name: string; passed: boolean; reason: string }[]) console.log(`  ${c.passed ? "✓" : "✗"} ${c.name}: ${c.reason}`);
  }
  if (job.gateResults.length) {
    console.log("\nGate:");
    for (const g of job.gateResults) console.log(`  ${g.passed ? "✓" : "✗"} ${g.name}: ${g.evidence}`);
  }
  const denials = await prisma.auditEvent.findMany({ where: { jobId, severity: "denied" }, orderBy: { createdAt: "asc" } });
  if (denials.length) {
    console.log("\nPolicy denials (audit log):");
    for (const d of denials) console.log(`  ⛔ ${d.target}: ${(d.details as { reason?: string }).reason}`);
  }
}

const program = new Command().name("autopilot").description("Project Autopilot CLI");

program
  .command("seed")
  .description("Create demo_target with the three planted problems")
  .option("--real-bug", "add a commit with a genuine bug (classifier should say: real)")
  .option("--reintroduce <goal>", "re-plant a fixed problem on main (g1)")
  .action(async (opts: { realBug?: boolean; reintroduce?: string }) => {
    const dir = getConfig().targetRepoPath;
    if (opts.realBug) console.log(await addRealBug(dir));
    else if (opts.reintroduce) {
      if (opts.reintroduce.toLowerCase() !== "g1") throw new Error("only --reintroduce g1 is supported");
      console.log(await reintroduceG1(dir));
    } else {
      await seedDemoTarget(dir, { force: true });
      console.log(`Seeded ${dir}`);
    }
  });

program
  .command("check")
  .description("Run all standing-goal checks on main now (plain code)")
  .option("--conduct", "also let the conductor open jobs for red goals")
  .action(async (opts: { conduct?: boolean }) => {
    const r = await checkGoalsAndConduct("cli", Boolean(opts.conduct));
    for (const g of r.results) console.log(`${g.status.padEnd(5)} ${g.goalId.padEnd(18)} ${g.summary}`);
    if (r.plan) console.log("jobs:", r.plan.jobIds.join(", ") || "none", r.plan.skipped);
  });

program
  .command("run <goal>")
  .description("Start a job for a goal (g1|g2|g3). Enqueued for apps/worker unless --inline.")
  .option("--inline", "run the job in this process instead of the worker")
  .action(async (goal: string, opts: { inline?: boolean }) => {
    const id = toGoal(goal);
    const jobId = opts.inline ? await inlineJob(id) : await startJobForGoal(id, "cli");
    console.log(`Created job ${jobId}${opts.inline ? "" : " (enqueued; apps/worker will run it)"}`);
    if (opts.inline) {
      await runJob(jobId);
      await printJob(jobId);
    }
  });

/** Same checks as startJobForGoal, but without enqueueing (the CLI runs it). */
async function inlineJob(goalId: GoalId): Promise<string> {
  const { isKillSwitchOn } = await import("@autopilot/core/settings");
  if (await isKillSwitchOn()) throw new Error("Kill switch is on: no new jobs can start");
  return createJob(goalId, "cli-inline", { enqueue: false });
}

program
  .command("approve <jobId>")
  .description("Approve and merge a job (human decision)")
  .action(async (jobId: string) => console.log(await approveJob(jobId, "human", "approved via CLI")));

program
  .command("reject <jobId> <reason...>")
  .description("Reject a job (reason required)")
  .action(async (jobId: string, reason: string[]) => console.log(await rejectJob(jobId, reason.join(" "))));

program
  .command("request-changes <jobId> <feedback...>")
  .description("Send feedback to the worker for one more attempt")
  .action(async (jobId: string, feedback: string[]) => console.log(await requestChanges(jobId, feedback.join(" "))));

program
  .command("train")
  .description("Retrain the flaky-test classifier on ci_history.csv; prints held-out precision/recall")
  .action(async () => {
    const csvPath = path.join(getConfig().targetRepoPath, "ci_history.csv");
    const t = trainFlakyModel(readFileSync(csvPath, "utf8"));
    const row = await saveFlakyModel(t);
    const m = t.metrics;
    console.log(`flaky-classifier v${row.version} trained on ${m.support.train} labelled failures, tested on ${m.support.test} (held out)`);
    console.log(`precision ${(m.precision * 100).toFixed(1)}%  recall ${(m.recall * 100).toFixed(1)}%  accuracy ${(m.accuracy * 100).toFixed(1)}%  f1 ${m.f1.toFixed(3)}`);
    console.log(`weights: ${t.featureNames.map((f, i) => `${f}=${t.model.weights[i]!.toFixed(2)}`).join(", ")}`);
  });

program
  .command("kill")
  .description("Turn the kill switch ON: no new jobs start; running jobs stop after their current step")
  .action(async () => {
    await setKillSwitch(true, "human", "cli");
    console.log("Kill switch ON");
  });

program
  .command("resume")
  .description("Turn the kill switch OFF")
  .action(async () => {
    await setKillSwitch(false, "human", "cli");
    console.log("Kill switch OFF");
  });

program
  .command("demo-bad-worker")
  .description("Run a scripted worker that edits outside allowedPaths; shows policy, verifier and gate blocking it")
  .action(async () => {
    const jobId = await createJob("setup-docs-work", "demo-bad-worker", { enqueue: false });
    console.log(`Running scripted bad worker as job ${jobId} …`);
    await runJob(jobId);
    await printJob(jobId);
  });

program
  .command("eval")
  .description("Run the verifier eval cases (mock provider unless AUTOPILOT_LLM_PROVIDER is set)")
  .action(async () => {
    const ok = await runEvals();
    if (!ok) process.exitCode = 1;
  });

program
  .parseAsync(process.argv)
  .then(async () => {
    await stopBoss();
    await prisma.$disconnect();
    process.exit(process.exitCode ?? 0);
  })
  .catch(async (e) => {
    console.error(e instanceof Error ? e.message : e);
    await stopBoss().catch(() => {});
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  });
