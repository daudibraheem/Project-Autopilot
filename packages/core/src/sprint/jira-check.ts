/** `pnpm cli jira-check`: validate env vars, one read-only call, print sprint name + item count. */
import { createJiraHttp, type FetchLike, jiraConfigFromEnv } from "./jira-http";

export async function jiraCheck(env = process.env, fetchImpl?: FetchLike): Promise<{ ok: boolean; message: string }> {
  const { config, missing } = jiraConfigFromEnv(env);
  if (!config) {
    return {
      ok: false,
      message: `Jira is not configured. Missing: ${missing.join(", ")}.\nSet them in .env (use a TEST project and an API token for a bot account with access to that one project). Mock mode keeps working without Jira.`,
    };
  }
  if (!/^https:\/\/[\w.-]+$/.test(config.baseUrl)) return { ok: false, message: `JIRA_BASE_URL must look like https://yourteam.atlassian.net (got ${config.baseUrl})` };
  const http = createJiraHttp(config, fetchImpl, { maxAttempts: 2 });
  try {
    const sprints = await http.get<{ values?: { id: number; name: string }[] }>(`/rest/agile/1.0/board/${config.boardId}/sprint`, { state: "active", maxResults: 1 });
    const sprint = sprints.values?.[0];
    if (!sprint) return { ok: true, message: `Connected to ${config.baseUrl} (board ${config.boardId}), read-only. No active sprint right now.` };
    const issues = await http.get<{ total?: number }>(`/rest/agile/1.0/sprint/${sprint.id}/issue`, {
      jql: `project = "${config.projectKey.replace(/"/g, "")}"`,
      fields: "summary",
      maxResults: 0,
    });
    return { ok: true, message: `Connected (read-only GET). Active sprint: "${sprint.name}" · ${issues.total ?? 0} item(s) in project ${config.projectKey}.` };
  } catch (e) {
    const msg = (e as Error).message;
    const hint = /401|403/.test(msg)
      ? " Check JIRA_EMAIL / JIRA_API_TOKEN and that the account can browse the project."
      : /404/.test(msg)
        ? " Check JIRA_BOARD_ID (it must be a Jira Software board)."
        : "";
    return { ok: false, message: `Jira check failed: ${msg}.${hint}` };
  }
}
