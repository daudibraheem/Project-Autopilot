/**
 * Stuck-work detection: plain code, no LLM.
 * Reason codes: no_activity · review_waiting · blocked_by_build · blocked_label.
 * Items in a normal waiting status (e.g. "Waiting for QA") are never stuck.
 */
import type { PullRequestInfo } from "./types";

export type StuckReasonCode = "no_activity" | "review_waiting" | "blocked_by_build" | "blocked_label";

export interface StuckInputItem {
  key: string;
  title: string;
  status: string;
  statusCategory: string;
  labels: string[];
  lastActivityAt: Date;
  pullRequests: PullRequestInfo[];
  linkedGoalId?: string | null;
  assigneeRef?: string | null;
}

export interface StuckReason {
  code: StuckReasonCode;
  detail: string;
}

export interface StuckItem {
  key: string;
  title: string;
  status: string;
  assigneeRef: string | null;
  reasons: StuckReason[];
}

export interface StuckOptions {
  now: Date;
  thresholdDays: number;
  normalWaitingStatuses: string[];
  /** Autopilot goals that are currently red (e.g. "main-build-green"). */
  redGoals: Set<string>;
  reviewWaitHours?: number;
}

const DAY = 86400_000;
const HOUR = 3600_000;

export function isNormalWaiting(status: string, normal: string[]): boolean {
  return normal.some((s) => s.trim().toLowerCase() === status.trim().toLowerCase());
}

export function stuckReasons(it: StuckInputItem, o: StuckOptions): StuckReason[] {
  if (it.statusCategory === "done") return [];
  if (isNormalWaiting(it.status, o.normalWaitingStatuses)) return [];
  const reasons: StuckReason[] = [];
  const idleDays = (o.now.getTime() - it.lastActivityAt.getTime()) / DAY;
  if (it.statusCategory === "in_progress" && idleDays > o.thresholdDays) {
    reasons.push({ code: "no_activity", detail: `no activity for ${Math.floor(idleDays)} days (threshold ${o.thresholdDays})` });
  }
  const waitH = o.reviewWaitHours ?? 24;
  for (const pr of it.pullRequests) {
    if (pr.state !== "open" || pr.firstReviewAt || !pr.openedAt) continue;
    const hours = (o.now.getTime() - new Date(pr.openedAt).getTime()) / HOUR;
    if (hours > waitH) reasons.push({ code: "review_waiting", detail: `linked PR ${pr.url} open ${Math.floor(hours)} h with no review` });
  }
  if (it.linkedGoalId && o.redGoals.has(it.linkedGoalId)) {
    reasons.push({ code: "blocked_by_build", detail: `linked to Autopilot goal ${it.linkedGoalId}, which is red` });
  }
  if (it.labels.some((l) => /^blocked$/i.test(l))) reasons.push({ code: "blocked_label", detail: "labelled blocked" });
  return reasons;
}

export function detectStuck(items: StuckInputItem[], o: StuckOptions): StuckItem[] {
  return items
    .map((it) => ({ key: it.key, title: it.title, status: it.status, assigneeRef: it.assigneeRef ?? null, reasons: stuckReasons(it, o) }))
    .filter((s) => s.reasons.length > 0);
}

export const REASON_LABEL: Record<StuckReasonCode, string> = {
  no_activity: "No activity",
  review_waiting: "Review waiting",
  blocked_by_build: "Blocked by build",
  blocked_label: "Labelled blocked",
};
