/** "Hours broken": time between a red check and the next non-red check, within a window. */
export interface CheckPoint {
  status: string;
  createdAt: Date;
}

export function hoursBroken(checksAsc: CheckPoint[], windowStart: Date, now = new Date()): number {
  let ms = 0;
  for (let i = 0; i < checksAsc.length; i++) {
    const c = checksAsc[i]!;
    if (c.status !== "red") continue;
    const start = Math.max(c.createdAt.getTime(), windowStart.getTime());
    const end = (checksAsc[i + 1]?.createdAt ?? now).getTime();
    if (end > start) ms += end - start;
  }
  return ms / 3600_000;
}

/** Start of the current week window (rolling 7 days). */
export function weekWindowStart(now = new Date()): Date {
  return new Date(now.getTime() - 7 * 86400_000);
}
