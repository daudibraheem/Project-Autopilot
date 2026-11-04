import { prisma } from "@autopilot/db";

export type AuditActor =
  | "goal_checker"
  | "conductor"
  | "worker"
  | "verifier"
  | "gate"
  | "human"
  | "policy"
  | "system";

export interface AuditInput {
  actor: AuditActor;
  action: string;
  target: string;
  severity?: "info" | "warn" | "denied";
  jobId?: string | null;
  details?: Record<string, unknown>;
}

/** Append-only audit log. Never throws: auditing must not break the pipeline. */
export async function audit(e: AuditInput): Promise<void> {
  try {
    await prisma.auditEvent.create({
      data: {
        actor: e.actor,
        action: e.action,
        target: e.target.slice(0, 500),
        severity: e.severity ?? "info",
        jobId: e.jobId ?? null,
        details: JSON.parse(JSON.stringify(e.details ?? {})),
      },
    });
  } catch (err) {
    console.error("[audit] failed to write audit event", e.action, err);
  }
}

/** Convenience for policy denials. */
export function auditDenial(jobId: string | null, target: string, rule: string, reason: string, details: Record<string, unknown> = {}) {
  return audit({ actor: "policy", action: "policy.denied", target, severity: "denied", jobId, details: { rule, reason, ...details } });
}
