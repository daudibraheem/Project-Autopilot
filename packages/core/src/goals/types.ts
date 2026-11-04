import type { GoalId } from "../contract";

export type GoalStatus = "green" | "amber" | "red";

/** Where to check: main of the target repo (fresh export), or a workspace dir (branch under review). */
export type GoalSource = { kind: "ref"; repo: string; ref: string } | { kind: "dir"; dir: string; label: string };

export interface GoalCheckResult {
  goalId: GoalId;
  status: GoalStatus;
  summary: string;
  evidence: Record<string, unknown>;
  durationMs: number;
  ref: string;
}

export interface StandingGoal {
  id: GoalId;
  label: string;
  description: string;
  /** Plain code only. No LLM. */
  check(source: GoalSource): Promise<Omit<GoalCheckResult, "durationMs" | "ref">>;
}
