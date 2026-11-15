/**
 * Read-only Jira HTTP wrapper (AGENTS.md rule 11). Only GET is possible; anything else throws and is audited.
 * Basic auth (email + API token), rate-limit backoff (429/503 + Retry-After).
 */
import { audit } from "../audit";
import { PolicyViolation } from "../git";
import { checkHttpMethod } from "../policy";

export interface JiraConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
  projectKey: string;
  boardId: string;
  storyPointsField: string;
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

export interface JiraHttp {
  request<T>(method: string, path: string, query?: Record<string, string | number | undefined>): Promise<T>;
  get<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class JiraHttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "JiraHttpError";
  }
}

export function jiraConfigFromEnv(env = process.env): { config: JiraConfig | null; missing: string[] } {
  const need = ["JIRA_BASE_URL", "JIRA_EMAIL", "JIRA_API_TOKEN", "JIRA_PROJECT_KEY", "JIRA_BOARD_ID"];
  const val = (k: string) => (env[k] ?? "").split("#")[0]!.trim();
  const missing = need.filter((k) => !val(k));
  if (missing.length) return { config: null, missing };
  return {
    config: {
      baseUrl: val("JIRA_BASE_URL").replace(/\/+$/, ""),
      email: val("JIRA_EMAIL"),
      apiToken: val("JIRA_API_TOKEN"),
      projectKey: val("JIRA_PROJECT_KEY"),
      boardId: val("JIRA_BOARD_ID"),
      storyPointsField: val("JIRA_STORY_POINTS_FIELD") || "customfield_10016",
    },
    missing: [],
  };
}

export function createJiraHttp(cfg: JiraConfig, fetchImpl: FetchLike = fetch as unknown as FetchLike, opts: { maxAttempts?: number; baseDelayMs?: number } = {}): JiraHttp {
  const auth = `Basic ${Buffer.from(`${cfg.email}:${cfg.apiToken}`).toString("base64")}`;
  const maxAttempts = opts.maxAttempts ?? 5;
  const baseDelay = opts.baseDelayMs ?? 1000;

  async function request<T>(method: string, path: string, query: Record<string, string | number | undefined> = {}): Promise<T> {
    const decision = checkHttpMethod(method);
    if (!decision.allowed) {
      await audit({ actor: "policy", action: "policy.denied", target: `${method.toUpperCase()} ${path}`, severity: "denied", details: { rule: decision.rule, reason: decision.reason, integration: "jira" } });
      throw new PolicyViolation(decision.rule!, decision.reason!);
    }
    const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString();
    const url = `${cfg.baseUrl}${path}${qs ? `?${qs}` : ""}`;
    for (let attempt = 1; ; attempt++) {
      const res = await fetchImpl(url, { method: "GET", headers: { Authorization: auth, Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
      if (res.ok) return (await res.json()) as T;
      if ((res.status === 429 || res.status === 503) && attempt < maxAttempts) {
        const retryAfter = Number(res.headers.get("retry-after"));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : baseDelay * 2 ** (attempt - 1));
        continue;
      }
      const body = (await res.text().catch(() => "")).slice(0, 300);
      throw new JiraHttpError(res.status, `Jira ${res.status} for GET ${path}: ${body}`);
    }
  }

  return { request, get: (path, query) => request("GET", path, query) };
}
