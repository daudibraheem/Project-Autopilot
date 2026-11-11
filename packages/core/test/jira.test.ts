/** Read-only Jira client + provider mapping, using recorded JSON fixtures (never live Jira). */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fakePrisma } from "./helpers";

const fake = fakePrisma();
vi.mock("@autopilot/db", () => ({ prisma: fake.prisma }));

const { createJiraHttp, jiraConfigFromEnv } = await import("../src/sprint/jira-http");
const { JiraCloudProvider, adfToText, mapStatusCategory } = await import("../src/sprint/jira-provider");
const { jiraCheck } = await import("../src/sprint/jira-check");
const { PolicyViolation } = await import("../src/git");

const fx = (name: string) => JSON.parse(readFileSync(path.join(import.meta.dirname, "fixtures/jira", name), "utf8"));
const cfg = { baseUrl: "https://example.atlassian.net", email: "bot@example.com", apiToken: "test-token", projectKey: "TEST", boardId: "12", storyPointsField: "customfield_10016" };

type Call = { url: string; method: string; auth: string };
type Route = [RegExp, number | (() => { status: number; body: unknown; headers?: Record<string, string> }), unknown?];

function fakeFetch(routes: Route[]) {
  const calls: Call[] = [];
  const fn = async (url: string, init: { method: string; headers: Record<string, string> }) => {
    calls.push({ url, method: init.method, auth: init.headers.Authorization ?? "" });
    for (const [re, status, body] of routes) {
      if (!re.test(url)) continue;
      const r = typeof status === "function" ? status() : { status, body, headers: {} as Record<string, string> };
      return {
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        headers: { get: (n: string) => r.headers?.[n.toLowerCase()] ?? null },
        json: async () => r.body,
        text: async () => JSON.stringify(r.body ?? ""),
      };
    }
    return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}), text: async () => "not found" };
  };
  return { fn, calls };
}

describe("read-only Jira HTTP wrapper", () => {
  it("rejects every non-GET method, writes an audit event and never calls fetch", async () => {
    const { fn, calls } = fakeFetch([[/.*/, 200, {}]]);
    const http = createJiraHttp(cfg, fn);
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
      await expect(http.request(method, "/rest/api/3/issue/TEST-1/transitions")).rejects.toBeInstanceOf(PolicyViolation);
    }
    expect(calls).toHaveLength(0);
    expect(fake.audit.filter((a) => a.action === "policy.denied" && a.details.rule === "read-only-integration")).toHaveLength(4);
  });

  it("uses GET with basic auth and backs off on 429", async () => {
    let n = 0;
    const { fn, calls } = fakeFetch([[/sprint/, () => (++n < 3 ? { status: 429, body: {}, headers: { "retry-after": "0" } } : { status: 200, body: { ok: true } })]]);
    const http = createJiraHttp(cfg, fn, { baseDelayMs: 1 });
    expect(await http.get("/rest/agile/1.0/board/12/sprint", { state: "active" })).toEqual({ ok: true });
    expect(calls).toHaveLength(3);
    expect(calls.every((c) => c.method === "GET")).toBe(true);
    expect(calls[0]!.auth).toBe(`Basic ${Buffer.from("bot@example.com:test-token").toString("base64")}`);
  });
});

describe("JiraCloudProvider mapping (fixtures)", () => {
  function provider() {
    const { fn, calls } = fakeFetch([
      [/board\/12\/sprint\?.*state=active/, 200, fx("board-sprints-active.json")],
      [/board\/12\/sprint\?.*state=closed/, 200, fx("board-sprints-closed.json")],
      [/sprint\/37\/issue\?.*startAt=0/, 200, fx("sprint-37-issues-page1.json")],
      [/sprint\/37\/issue\?.*startAt=2/, 200, fx("sprint-37-issues-page2.json")],
      [/dev-status.*issueId=10101/, 200, fx("dev-status-10101.json")],
    ]);
    return { p: new JiraCloudProvider(cfg, createJiraHttp(cfg, fn)), calls };
  }

  it("maps the active and previous sprint (least data: only these two)", async () => {
    const { p } = provider();
    expect(await p.getActiveSprint()).toMatchObject({ id: "jira-37", name: "TEST Sprint 5", goal: "Close the refunds epic", state: "active" });
    expect((await p.getPreviousSprint())?.name).toBe("TEST Sprint 4");
  });

  it("maps issues across pages: status category, points, people, events, scope change, PR links", async () => {
    const { p, calls } = provider();
    await p.getActiveSprint();
    const items = await p.getWorkItems("jira-37");
    expect(items.map((i) => i.key)).toEqual(["TEST-11", "TEST-12", "TEST-13"]);
    const [a, b, c] = items;
    expect(a).toMatchObject({ statusCategory: "in_progress", storyPoints: 5, type: "Story", labels: ["refunds"], addedAfterSprintStart: false });
    expect(a!.assignee).toEqual({ externalId: "acc-1", displayName: "Jamie Rivera" });
    expect(a!.description).toContain("Implements POST /refunds");
    expect(a!.pullRequests).toEqual([{ url: "https://github.com/acme/payments/pull/41", state: "open", openedAt: "2026-11-05T12:00:00.000+0000", firstReviewAt: null }]);
    expect(a!.lastActivityAt.toISOString()).toBe("2026-11-04T08:00:00.000Z");
    const ev = await p.getEvents("TEST-11");
    expect(ev.map((e) => e.kind)).toEqual(["created", "status_change", "comment"]);
    expect(ev[1]).toMatchObject({ fromValue: "To Do", toValue: "In Progress" });
    expect(ev[2]!.body).toBe("Waiting on the schema review.");
    // dev-status 404 → falls back to PR URLs parsed from the description
    expect(b!.pullRequests.map((x) => x.url)).toEqual(["https://github.com/acme/payments/pull/77"]);
    expect(b).toMatchObject({ statusCategory: "in_progress", assignee: null, labels: ["blocked"], addedAfterSprintStart: true });
    expect(c).toMatchObject({ statusCategory: "done", storyPoints: 1 });
    // Least data: project-scoped JQL; every call is a GET
    expect(calls.filter((x) => /sprint\/37\/issue/.test(x.url)).every((x) => new URL(x.url).searchParams.get("jql") === 'project = "TEST"')).toBe(true);
    expect(calls.every((x) => x.method === "GET")).toBe(true);
  });

  it("helpers: ADF to text and status categories", () => {
    expect(
      adfToText({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "see " }, { type: "text", text: "PR", marks: [{ type: "link", attrs: { href: "https://x/pull/1" } }] }] }] }),
    ).toBe("see PR (https://x/pull/1)");
    expect([mapStatusCategory("new"), mapStatusCategory("indeterminate"), mapStatusCategory("done")]).toEqual(["todo", "in_progress", "done"]);
  });
});

describe("jira-check", () => {
  it("fails with a clear message when not configured", async () => {
    const r = await jiraCheck({});
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Missing: JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY, JIRA_BOARD_ID/);
    expect(jiraConfigFromEnv({}).missing).toHaveLength(5);
  });

  it("does one read-only lookup and prints the sprint name and item count", async () => {
    const { fn, calls } = fakeFetch([
      [/board\/12\/sprint/, 200, fx("board-sprints-active.json")],
      [/sprint\/37\/issue/, 200, { total: 3, issues: [] }],
    ]);
    const env = { JIRA_BASE_URL: "https://example.atlassian.net", JIRA_EMAIL: "bot@example.com", JIRA_API_TOKEN: "t", JIRA_PROJECT_KEY: "TEST", JIRA_BOARD_ID: "12" };
    expect(await jiraCheck(env, fn)).toEqual({ ok: true, message: 'Connected (read-only GET). Active sprint: "TEST Sprint 5" · 3 item(s) in project TEST.' });
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });
});
