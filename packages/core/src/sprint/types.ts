/** Provider-facing sprint types. Providers return REAL people; sync.ts pseudonymises before storing. */

export interface SprintInfo {
  id: string;
  name: string;
  goal: string;
  start: Date;
  end: Date;
  state: "active" | "closed";
}

export interface PersonRef {
  externalId: string;
  displayName: string;
}

export interface PullRequestInfo {
  url: string;
  state: "open" | "merged" | "declined";
  openedAt: string | null;
  firstReviewAt: string | null;
}

export type StatusCategory = "todo" | "in_progress" | "done";

export interface ProviderWorkItem {
  key: string;
  title: string;
  description: string;
  type: string;
  status: string;
  statusCategory: StatusCategory;
  storyPoints: number | null;
  labels: string[];
  assignee: PersonRef | null;
  createdAt: Date;
  statusChangedAt: Date;
  lastActivityAt: Date;
  pullRequests: PullRequestInfo[];
  linkedCommitShas: string[];
  linkedGoalId?: string | null;
  isAgentWork?: boolean;
  autopilotJobId?: string | null;
  addedAfterSprintStart: boolean;
}

export type EventKind = "status_change" | "comment" | "assignment" | "created" | "sprint_added";

export interface ProviderEvent {
  id: string;
  itemKey: string;
  kind: EventKind;
  at: Date;
  actor: PersonRef | null;
  fromValue: string | null;
  toValue: string | null;
  body: string | null;
}

export interface SprintProvider {
  readonly name: "mock" | "jira";
  getActiveSprint(): Promise<SprintInfo | null>;
  /** Previous (most recently closed) sprint, for comparison only. */
  getPreviousSprint(): Promise<SprintInfo | null>;
  getWorkItems(sprintId: string): Promise<ProviderWorkItem[]>;
  getEvents(itemKey: string): Promise<ProviderEvent[]>;
}

/** PR URLs mentioned in free text (fallback when no development links are available). */
export function parsePrUrls(text: string): string[] {
  const re = /https?:\/\/(?:github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+|gitlab\.com\/[\w./-]+\/-\/merge_requests\/\d+|bitbucket\.org\/[\w.-]+\/[\w.-]+\/pull-requests\/\d+)/g;
  return [...new Set(text.match(re) ?? [])];
}
