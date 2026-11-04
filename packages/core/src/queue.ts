/** pg-boss wrapper. Web enqueues; apps/worker consumes. */
import PgBoss from "pg-boss";

export const QUEUES = {
  runJob: "autopilot-run-job",
  checkGoals: "autopilot-check-goals",
  dailyCheck: "autopilot-daily-check",
} as const;

export interface RunJobPayload {
  jobId: string;
}
export interface CheckGoalsPayload {
  reason: string;
  conduct?: boolean;
}

const g = globalThis as unknown as { __autopilotBoss?: Promise<PgBoss> };

/** Shared, lazily-started pg-boss instance. `consumer` enables maintenance + cron supervision. */
export function getBoss(opts: { consumer?: boolean } = {}): Promise<PgBoss> {
  if (!g.__autopilotBoss) {
    g.__autopilotBoss = (async () => {
      const url = process.env.DATABASE_URL;
      if (!url) throw new Error("DATABASE_URL is not set");
      const boss = new PgBoss({
        connectionString: url,
        supervise: Boolean(opts.consumer),
        schedule: Boolean(opts.consumer),
      });
      boss.on("error", (e) => console.error("[pg-boss]", e.message));
      await boss.start();
      for (const name of Object.values(QUEUES)) {
        await boss.createQueue(name).catch(() => {});
      }
      return boss;
    })();
  }
  return g.__autopilotBoss;
}

export async function enqueueRunJob(jobId: string): Promise<string | null> {
  const boss = await getBoss();
  return boss.send(QUEUES.runJob, { jobId } satisfies RunJobPayload, { retryLimit: 1, retryDelay: 5, expireInSeconds: 30 * 60 });
}

export async function enqueueCheckGoals(reason: string, conduct = true): Promise<string | null> {
  const boss = await getBoss();
  return boss.send(QUEUES.checkGoals, { reason, conduct } satisfies CheckGoalsPayload, { retryLimit: 0 });
}

export async function stopBoss(): Promise<void> {
  if (g.__autopilotBoss) {
    const b = await g.__autopilotBoss;
    await b.stop({ graceful: true, wait: true }).catch(() => {});
    g.__autopilotBoss = undefined;
  }
}
