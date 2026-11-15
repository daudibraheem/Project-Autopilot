#!/usr/bin/env tsx
/**
 * Autopilot worker-tools MCP server (stdio). Exposes the READ-ONLY worker tools
 * (read_file, list_files, repo_map, search_knowledge, search_lessons) over the target repo,
 * with a tool-poisoning self-scan at startup. Mutating tools (write_file, run_command, run_tests)
 * are only ever offered in-process to a job under a contract, never from this standalone server.
 *
 * Example client config:
 *   { "mcpServers": { "autopilot-tools": { "command": "pnpm", "args": ["--dir", "/path/to/project-autopilot", "mcp-tools"] } } }
 * Set AUTOPILOT_MCP_POISONED_TOOL=true to see the self-scan refuse a deliberately poisoned tool.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { audit } from "@autopilot/core/audit";
import { TOOL_SPECS } from "@autopilot/core/agents/tools";
import { createToolsMcpServer, POISONED_TOOL, READ_ONLY_TOOLS, scanToolForPoisoning } from "@autopilot/core/agents/tools-mcp";
import { getConfig, isDemoTarget } from "@autopilot/core/config";
import { buildContract, withHighRisk } from "@autopilot/core/contract";
import { searchKnowledge } from "@autopilot/core/knowledge";
import { searchLessons } from "@autopilot/core/lessons";

const cfg = getConfig();

// A read-only inspection context over the target repo. Secrets and high-risk paths are forbidden.
const base = buildContract("mcp-tools-inspect", "setup-docs-work");
const contract = { ...base, allowedPaths: ["**/*"], forbiddenPaths: withHighRisk([".env", "**/.env", "**/.env.*", "node_modules/**", "vendor/**"]) };
const ctx = {
  jobId: "mcp-tools-inspect",
  ws: cfg.targetRepoPath,
  contract,
  baselineFailures: new Set<string>(),
  demoMode: isDemoTarget(cfg.targetRepoPath),
  searchLessons: (q: string) => searchLessons(q),
  searchKnowledge: (q: string) => searchKnowledge(q),
  addEvidence: () => {},
};

// Tool-poisoning self-scan at startup.
const candidates = [...TOOL_SPECS.filter((s) => READ_ONLY_TOOLS.includes(s.name)).map((s) => ({ name: s.name, description: s.description })), ...(cfg.mcpPoisonedTool ? [POISONED_TOOL] : [])];
const safe: string[] = [];
for (const c of candidates) {
  const reasons = scanToolForPoisoning(c.name, c.description);
  if (reasons.length) {
    console.error(`[autopilot-mcp-tools] REFUSED tool "${c.name}" (tool-poisoning self-scan): ${reasons.join("; ")}`);
    await audit({ actor: "policy", action: "mcp.tool_poisoning_detected", target: c.name, severity: "denied", details: { reasons, source: "mcp-tools startup self-scan" } });
  } else {
    safe.push(c.name);
  }
}

const server = createToolsMcpServer(ctx, { names: safe.filter((n) => n !== POISONED_TOOL.name) });
await server.connect(new StdioServerTransport());
console.error(`[autopilot-mcp-tools] read-only server ready on stdio. Tools: ${safe.filter((n) => n !== POISONED_TOOL.name).join(", ")}`);
