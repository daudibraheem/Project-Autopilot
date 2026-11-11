/**
 * JiraCloudProvider (read-only). Jira Software (Agile) API for board + sprints, REST v3 for issues.
 * Least data: only the configured project's issues in the active sprint, plus previous-sprint metadata/items.
 * Development links (PRs) come from the dev-status API when available, else PR URLs parsed from text.
 */
import type { JiraConfig, JiraHttp } from "./jira-http";
import { JiraHttpError } from "./jira-http";
import { type EventKind, parsePrUrls, type PersonRef, type ProviderEvent, type ProviderWorkItem, type PullRequestInfo, type SprintInfo, type SprintProvider, type StatusCategory } from "./types";

interface JiraSprint {
  id: number;
  name: string;
  state: string;
  goal?: string;
  startDate?: string;
  endDate?: string;
  completeDate?: string;
}
interface JiraUser {
  accountId: string;
  displayName: string;
}
interface AdfNode {
  type?: string;
  text?: string;
  attrs?: { url?: string; href?: string };
  marks?: { type: string; attrs?: { href?: string } }[];
  content?: AdfNode[];
}
interface JiraIssue {
  id: string;
  key: string;
  fields: Record<string, unknown> & {
    summary: string;
    issuetype?: { name: string };
    status: { name: string; statusCategory?: { key: string } };
    assignee?: JiraUser | null;
    labels?: string[];
    created: string;
    updated?: string;
    description?: AdfNode | string | null;
    comment?: { comments: { id: string; author?: JiraUser; body?: AdfNode | string; created: string }[] };
  };
  changelog?: { histories: { id: string; author?: JiraUser; created: string; items: { field: string; fromString: string | null; toString: string | null }[] }[] };
}

/** Atlassian Document Format → plain text (links kept as URLs). */
export function adfToText(node: AdfNode | string | null | undefined): string {
  if (!node) return "";
  if (typeof node === "string") return node;
  const parts: string[] = [];
  const walk = (n: AdfNode) => {
    if (n.text) {
      parts.push(n.text);
      const href = n.marks?.find((m) => m.type === "link")?.attrs?.href;
      if (href && href !== n.text) parts.push(` (${href})`);
    }
    if (n.attrs?.url) parts.push(n.attrs.url);
    n.content?.forEach(walk);
    if (n.type === "paragraph" || n.type === "listItem" || n.type === "heading") parts.push("\n");
  };
  walk(node);
  return parts.join("").replace(/\n{3,}/g, "\n\n").trim();
}

export function mapStatusCategory(key: string | undefined): StatusCategory {
  return key === "done" ? "done" : key === "indeterminate" ? "in_progress" : "todo";
}

const person = (u: JiraUser | null | undefined): PersonRef | null => (u ? { externalId: u.accountId, displayName: u.displayName } : null);

function toSprint(s: JiraSprint): SprintInfo {
  return {
    id: `jira-${s.id}`,
    name: s.name,
    goal: s.goal ?? "",
    start: new Date(s.startDate ?? Date.now()),
    end: new Date(s.endDate ?? s.completeDate ?? Date.now()),
    state: s.state === "active" ? "active" : "closed",
  };
}

export class JiraCloudProvider implements SprintProvider {
  readonly name = "jira" as const;
  private events = new Map<string, ProviderEvent[]>();
  private devStatusAvailable = true;
  private activeCache: JiraSprint | null = null;

  constructor(
    private cfg: JiraConfig,
    private http: JiraHttp,
  ) {}

  private async paged<T>(path: string, query: Record<string, string | number | undefined>, key: "values" | "issues"): Promise<T[]> {
    const out: T[] = [];
    let startAt = 0;
    for (let page = 0; page < 50; page++) {
      const r = await this.http.get<{ values?: T[]; issues?: T[]; isLast?: boolean; total?: number; maxResults?: number }>(path, { ...query, startAt, maxResults: 50 });
      const batch = r[key] ?? [];
      out.push(...batch);
      startAt += batch.length;
      const done = r.isLast ?? (r.total !== undefined ? startAt >= r.total : batch.length === 0);
      if (done || batch.length === 0) break;
    }
    return out;
  }

  async getActiveSprint(): Promise<SprintInfo | null> {
    const sprints = await this.paged<JiraSprint>(`/rest/agile/1.0/board/${this.cfg.boardId}/sprint`, { state: "active" }, "values");
    this.activeCache = sprints[0] ?? null;
    return this.activeCache ? toSprint(this.activeCache) : null;
  }

  async getPreviousSprint(): Promise<SprintInfo | null> {
    const closed = await this.paged<JiraSprint>(`/rest/agile/1.0/board/${this.cfg.boardId}/sprint`, { state: "closed" }, "values");
    const last = closed.sort((a, b) => new Date(b.completeDate ?? b.endDate ?? 0).getTime() - new Date(a.completeDate ?? a.endDate ?? 0).getTime())[0];
    return last ? toSprint(last) : null;
  }

  private async pullRequests(issue: JiraIssue, text: string): Promise<PullRequestInfo[]> {
    if (this.devStatusAvailable) {
      try {
        const r = await this.http.get<{ detail?: { pullRequests?: { url: string; status: string; lastUpdate?: string; reviewers?: { approved?: boolean }[] }[] }[] }>(
          "/rest/dev-status/latest/issue/detail",
          { issueId: issue.id, applicationType: "GitHub", dataType: "pullrequest" },
        );
        const prs = (r.detail ?? []).flatMap((d) => d.pullRequests ?? []);
        if (prs.length) {
          return prs.map((p) => ({
            url: p.url,
            state: p.status === "MERGED" ? "merged" : p.status === "DECLINED" ? "declined" : "open",
            // dev-status has no "opened" time; lastUpdate is the closest signal (DECISIONS #S9)
            openedAt: p.lastUpdate ?? null,
            firstReviewAt: (p.reviewers ?? []).length ? (p.lastUpdate ?? null) : null,
          }));
        }
      } catch (e) {
        if (e instanceof JiraHttpError && [400, 401, 403, 404].includes(e.status)) this.devStatusAvailable = false;
        else throw e;
      }
    }
    return parsePrUrls(text).map((url) => ({ url, state: "open", openedAt: null, firstReviewAt: null }));
  }

  /** Map one Jira issue (exported for fixture tests). */
  async mapIssue(issue: JiraIssue, sprint: SprintInfo): Promise<{ item: ProviderWorkItem; events: ProviderEvent[] }> {
    const f = issue.fields;
    const description = adfToText(f.description ?? null);
    const comments = f.comment?.comments ?? [];
    const events: ProviderEvent[] = [
      { id: `${issue.key}-created`, itemKey: issue.key, kind: "created", at: new Date(f.created), actor: null, fromValue: null, toValue: null, body: null },
    ];
    let addedAfterStart = new Date(f.created) > sprint.start;
    let statusChangedAt = new Date(f.created);
    for (const h of issue.changelog?.histories ?? []) {
      for (const it of h.items) {
        let kind: EventKind | null = null;
        if (it.field === "status") {
          kind = "status_change";
          statusChangedAt = new Date(Math.max(statusChangedAt.getTime(), new Date(h.created).getTime()));
        } else if (it.field === "assignee") kind = "assignment";
        else if (it.field === "Sprint" && (it.toString ?? "").includes(sprint.name)) {
          kind = "sprint_added";
          if (new Date(h.created) > sprint.start) addedAfterStart = true;
        }
        if (kind) {
          events.push({
            id: `${issue.key}-h${h.id}-${it.field}`,
            itemKey: issue.key,
            kind,
            at: new Date(h.created),
            actor: person(h.author),
            fromValue: kind === "assignment" ? null : it.fromString,
            toValue: kind === "assignment" ? null : it.toString,
            body: null,
          });
        }
      }
    }
    for (const c of comments) {
      events.push({ id: `${issue.key}-c${c.id}`, itemKey: issue.key, kind: "comment", at: new Date(c.created), actor: person(c.author), fromValue: null, toValue: null, body: adfToText(c.body ?? null) });
    }
    events.sort((a, b) => a.at.getTime() - b.at.getTime());
    const lastActivityAt = events.reduce((m, e) => (e.at > m ? e.at : m), new Date(f.created));
    const allText = [description, ...comments.map((c) => adfToText(c.body ?? null))].join("\n");
    const sp = f[this.cfg.storyPointsField];
    const item: ProviderWorkItem = {
      key: issue.key,
      title: f.summary,
      description,
      type: f.issuetype?.name ?? "Issue",
      status: f.status.name,
      statusCategory: mapStatusCategory(f.status.statusCategory?.key),
      storyPoints: typeof sp === "number" ? sp : null,
      labels: f.labels ?? [],
      assignee: person(f.assignee),
      createdAt: new Date(f.created),
      statusChangedAt,
      lastActivityAt,
      pullRequests: await this.pullRequests(issue, allText),
      linkedCommitShas: [],
      linkedGoalId: null,
      isAgentWork: (f.labels ?? []).includes("autopilot"),
      autopilotJobId: /autopilot\/(j-[a-z0-9]+)/.exec(allText)?.[1] ?? null,
      addedAfterSprintStart: addedAfterStart,
    };
    return { item, events };
  }

  async getWorkItems(sprintId: string): Promise<ProviderWorkItem[]> {
    const numericId = sprintId.replace(/^jira-/, "");
    const sprint =
      this.activeCache && String(this.activeCache.id) === numericId
        ? toSprint(this.activeCache)
        : toSprint(await this.http.get<JiraSprint>(`/rest/agile/1.0/sprint/${numericId}`));
    const fields = ["summary", "issuetype", "status", "assignee", "labels", "created", "updated", "description", "comment", this.cfg.storyPointsField].join(",");
    const issues = await this.paged<JiraIssue>(
      `/rest/agile/1.0/sprint/${numericId}/issue`,
      { jql: `project = "${this.cfg.projectKey.replace(/"/g, "")}"`, fields, expand: "changelog" },
      "issues",
    );
    const out: ProviderWorkItem[] = [];
    for (const issue of issues) {
      const { item, events } = await this.mapIssue(issue, sprint);
      this.events.set(issue.key, events);
      out.push(item);
    }
    return out;
  }

  async getEvents(itemKey: string): Promise<ProviderEvent[]> {
    return this.events.get(itemKey) ?? [];
  }
}
