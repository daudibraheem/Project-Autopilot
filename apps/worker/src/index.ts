/**
 * apps/worker: long-running scheduler + job runner (pg-boss consumer).
 *   - daily goal check (cron 07:00)
 *   - "Check goals now" → autopilot-check-goals
 *   - "Run job"         → autopilot-run-job
 */
import { checkGoalsAndConduct } from "@autopilot/core/checks";
import { sandboxStatus } from "@autopilot/core/sandbox";
import { runJob } from "@autopilot/core/pipeline";
import { type CheckGoalsPayload, getBoss, QUEUES, type RunJobPayload, stopBoss } from "@autopilot/core/queue";
import { getConfig } from "@autopilot/core/config";
import { audit } from "@autopilot/core/audit";

async function main() {
  const cfg = getConfig();
  const sbx = await sandboxStatus(true);
  console.log(`[worker] provider=${cfg.provider} worker=${cfg.workerModel} verifier=${cfg.verifierModel} target=${cfg.targetRepoPath}`);
  console.log(`[worker] sandbox: ${sbx.mode}${sbx.unsafe ? " ⚠️  UNSAFE: no container" : ""} (${sbx.reason})`);
  if (sbx.unsafe) {
    await audit({ actor: "system", action: "sandbox.unsafe", target: "sandbox", severity: "warn", details: { ...sbx } });
  }

  const boss = await getBoss({ consumer: true });
  await boss.schedule(QUEUES.dailyCheck, "0 7 * * *", { reason: "daily cron" });

  await boss.work<CheckGoalsPayload>(QUEUES.dailyCheck, { pollingIntervalSeconds: 5 }, async () => {
    await checkGoalsAndConduct("daily cron");
  });

  await boss.work<CheckGoalsPayload>(QUEUES.checkGoals, { pollingIntervalSeconds: 1 }, async ([job]) => {
    const data = job!.data;
    console.log(`[worker] checking goals (${data.reason})`);
    const r = await checkGoalsAndConduct(data.reason, data.conduct ?? false);
    console.log(`[worker] goals: ${r.results.map((x) => `${x.goalId}=${x.status}`).join(" ")}`);
  });

  await boss.work<RunJobPayload>(QUEUES.runJob, { pollingIntervalSeconds: 1 }, async ([job]) => {
    console.log(`[worker] running job ${job!.data.jobId}`);
    await runJob(job!.data.jobId);
    console.log(`[worker] job ${job!.data.jobId} finished`);
  });

  console.log("[worker] ready");
  const shutdown = async () => {
    console.log("[worker] shutting down");
    await stopBoss();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  console.error("[worker] fatal", e);
  process.exit(1);
});
