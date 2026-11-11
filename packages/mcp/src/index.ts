#!/usr/bin/env tsx
/**
 * Autopilot sprint MCP server (stdio). Read-only tools: get_sprint, list_work_items, get_item_events.
 * Example client config:
 *   { "mcpServers": { "autopilot-sprint": { "command": "pnpm", "args": ["--dir", "/path/to/project-autopilot", "mcp"] } } }
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createSprintMcpServer } from "@autopilot/core/sprint/mcp";

const server = createSprintMcpServer();
await server.connect(new StdioServerTransport());
console.error("[autopilot-mcp] sprint server ready on stdio (read-only)");
