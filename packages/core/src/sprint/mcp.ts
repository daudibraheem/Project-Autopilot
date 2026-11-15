/**
 * Read-only MCP server for sprint data: get_sprint, list_work_items, get_item_events.
 * Returns pseudonymised data only. Flagged (injection-like) comment bodies are withheld.
 * Used over stdio by `pnpm mcp` (packages/mcp) and in-process by Ask Autopilot.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { prisma } from "@autopilot/db";
import { z } from "zod";
import { audit } from "../audit";
import { currentStuck, localDate } from "./data";

export async function toolGetSprint() {
  const { sprint, stuck, items, settings } = await currentStuck();
  if (!sprint) return { sprint: null, note: "No active sprint synced." };
  return {
    sprint: { id: sprint.id, name: sprint.name, goal: sprint.goal, start: localDate(sprint.start), end: localDate(sprint.end), provider: sprint.provider },
    counts: {
      total: items.length,
      done: items.filter((i) => i.statusCategory === "done").length,
      inProgress: items.filter((i) => i.statusCategory === "in_progress").length,
      todo: items.filter((i) => i.statusCategory === "todo").length,
      stuck: stuck.length,
      addedMidSprint: items.filter((i) => i.addedAfterSprintStart).length,
      agentWork: items.filter((i) => i.isAgentWork).length,
    },
    settings: { normalWaitingStatuses: settings.normalWaitingStatuses, stuckThresholdDays: settings.stuckThresholdDays },
  };
}

export async function toolListWorkItems(args: { status?: string; stuckOnly?: boolean }) {
  const { sprint, stuck, items } = await currentStuck();
  if (!sprint) return [];
  const byKey = new Map(stuck.map((s) => [s.key, s.reasons]));
  return items
    .filter((i) => !args.status || i.status.toLowerCase() === args.status.toLowerCase())
    .filter((i) => !args.stuckOnly || byKey.has(i.key))
    .map((i) => ({
      key: i.key,
      title: i.title,
      type: i.type,
      status: i.status,
      statusCategory: i.statusCategory,
      assigneeRef: i.assigneeRef,
      storyPoints: i.storyPoints,
      labels: i.labels,
      lastActivityAt: i.lastActivityAt.toISOString(),
      isAgentWork: i.isAgentWork,
      autopilotJobId: i.autopilotJobId,
      addedAfterSprintStart: i.addedAfterSprintStart,
      linkedPrUrls: i.linkedPrUrls,
      stuckReasons: byKey.get(i.key) ?? [],
    }));
}

export async function toolGetItemEvents(args: { itemKey: string }) {
  const events = await prisma.workItemEvent.findMany({ where: { itemKey: args.itemKey }, orderBy: { at: "asc" } });
  return events.map((e) => ({
    id: e.id,
    kind: e.kind,
    at: e.at.toISOString(),
    actorRef: e.actorRef,
    from: e.fromValue,
    to: e.toValue,
    body: e.flagged ? "[withheld: flagged as possible injected instructions]" : e.body,
    flagged: e.flagged,
  }));
}

const text = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 1) }] });

export function createSprintMcpServer(): McpServer {
  const server = new McpServer({ name: "autopilot-sprint", version: "0.1.0" });
  const ro = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
  server.registerTool(
    "get_sprint",
    { title: "Get sprint", description: "The active sprint: name, goal, dates and counts (read-only, pseudonymised).", inputSchema: {}, annotations: ro },
    async () => {
      await audit({ actor: "system", action: "mcp.get_sprint", target: "sprint", details: {} });
      return text(await toolGetSprint());
    },
  );
  server.registerTool(
    "list_work_items",
    {
      title: "List work items",
      description: "Work items in the active sprint with status, pseudonymised assignee and stuck reason codes. Optional filters: status, stuckOnly.",
      inputSchema: { status: z.string().optional(), stuckOnly: z.boolean().optional() },
      annotations: ro,
    },
    async (args) => {
      await audit({ actor: "system", action: "mcp.list_work_items", target: "sprint", details: args });
      return text(await toolListWorkItems(args));
    },
  );
  server.registerTool(
    "get_item_events",
    {
      title: "Get item events",
      description: "Status changes, comments and assignment changes for one work item (flagged comment bodies are withheld).",
      inputSchema: { itemKey: z.string().regex(/^[A-Z][A-Z0-9]+-\d+$/) },
      annotations: ro,
    },
    async (args) => {
      await audit({ actor: "system", action: "mcp.get_item_events", target: args.itemKey, details: {} });
      return text(await toolGetItemEvents(args));
    },
  );
  return server;
}
