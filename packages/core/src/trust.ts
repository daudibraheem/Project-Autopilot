/**
 * Trust ledger, per jobType.
 *   L0 propose only (default) · L1 may push branches / open draft PRs without asking · L2 may auto-merge
 *   (only if autoMergeAllowed for the type, default false, never for high-risk paths).
 * Promotion after N consecutive approved passes; demotion on any gate failure or rejection.
 */
import { prisma } from "@autopilot/db";
import { audit } from "./audit";
import { getSetting } from "./settings";

export interface TrustState {
  level: number;
  consecutivePasses: number;
  totalRuns: number;
  approvals: number;
  rejections: number;
  gateFailures: number;
}

export type TrustInput = "run" | "approved" | "rejected" | "gate_failed";

export interface TrustTransition {
  state: TrustState;
  change: { kind: "promoted" | "demoted"; from: number; to: number } | null;
}

export const MAX_LEVEL = 2;
export const DEFAULT_PROMOTE_AFTER = 3;

export const EMPTY_TRUST: TrustState = { level: 0, consecutivePasses: 0, totalRuns: 0, approvals: 0, rejections: 0, gateFailures: 0 };

/** Pure state transition (unit-tested). */
export function applyTrust(prev: TrustState, input: TrustInput, promoteAfter = DEFAULT_PROMOTE_AFTER): TrustTransition {
  const s = { ...prev };
  switch (input) {
    case "run":
      s.totalRuns++;
      return { state: s, change: null };
    case "approved": {
      s.approvals++;
      s.consecutivePasses++;
      if (s.consecutivePasses >= promoteAfter && s.level < MAX_LEVEL) {
        const from = s.level;
        s.level++;
        s.consecutivePasses = 0;
        return { state: s, change: { kind: "promoted", from, to: s.level } };
      }
      return { state: s, change: null };
    }
    case "rejected":
    case "gate_failed": {
      if (input === "rejected") s.rejections++;
      else s.gateFailures++;
      s.consecutivePasses = 0;
      const from = s.level;
      s.level = Math.max(0, s.level - 1);
      return { state: s, change: from !== s.level ? { kind: "demoted", from, to: s.level } : null };
    }
  }
}

export async function getTrust(jobType: string) {
  const row = await prisma.trustRecord.findUnique({ where: { jobType } });
  const autoMerge = await getSetting<Record<string, boolean>>("trust.autoMergeAllowed", {});
  return {
    jobType,
    ...(row ?? EMPTY_TRUST),
    autoMergeAllowed: Boolean(autoMerge[jobType] ?? row?.autoMergeAllowed ?? false),
    lastFailureAt: row?.lastFailureAt ?? null,
    lastFailureReason: row?.lastFailureReason ?? null,
  };
}

/** Record a trust input; writes TrustRecord + TrustEvent history (never overwritten). */
export async function recordTrust(jobType: string, input: TrustInput, jobId: string | null, reason: string): Promise<TrustTransition> {
  const promoteAfter = await getSetting<number>("trust.promoteAfter", DEFAULT_PROMOTE_AFTER);
  const row = await prisma.trustRecord.findUnique({ where: { jobType } });
  const prev: TrustState = row ?? EMPTY_TRUST;
  const t = applyTrust(prev, input, promoteAfter);
  const failed = input === "rejected" || input === "gate_failed";
  await prisma.trustRecord.upsert({
    where: { jobType },
    create: { jobType, ...t.state, ...(failed ? { lastFailureAt: new Date(), lastFailureReason: reason } : {}) },
    update: { ...t.state, ...(failed ? { lastFailureAt: new Date(), lastFailureReason: reason } : {}) },
  });
  if (input !== "run") {
    await prisma.trustEvent.create({ data: { jobType, jobId, kind: input, fromLevel: prev.level, toLevel: prev.level, reason } });
  }
  if (t.change) {
    await prisma.trustEvent.create({
      data: {
        jobType,
        jobId,
        kind: t.change.kind,
        fromLevel: t.change.from,
        toLevel: t.change.to,
        reason:
          t.change.kind === "promoted"
            ? `${promoteAfter} consecutive approved passes`
            : `${input === "rejected" ? "Human rejection" : "Gate failure"}: ${reason}`,
      },
    });
    await audit({
      actor: "system",
      action: `trust.${t.change.kind}`,
      target: jobType,
      severity: t.change.kind === "demoted" ? "warn" : "info",
      jobId,
      details: { from: t.change.from, to: t.change.to, reason },
    });
  }
  return t;
}

export const LEVEL_LABEL: Record<number, string> = {
  0: "L0 · Propose only",
  1: "L1 · Branch + draft PR",
  2: "L2 · Auto-merge (if allowed)",
};
