/**
 * Worker tools over MCP (§12 A): the in-process client ↔ server round-trip, the tool-poisoning
 * self-scan, and policy still enforced server-side.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fakePrisma, tmp } from "./helpers";

const fake = fakePrisma();
vi.mock("@autopilot/db", () => ({ prisma: fake.prisma }));

const { buildContract } = await import("../src/contract");
const { connectWorkerTools, POISONED_TOOL, scanToolForPoisoning } = await import("../src/agents/tools-mcp");

function ctxFor() {
  const ws = tmp("mcp-ws-");
  mkdirSync(path.join(ws, "src"), { recursive: true });
  writeFileSync(path.join(ws, "package.json"), '{"name":"x","dependencies":{}}');
  writeFileSync(path.join(ws, "src", "a.js"), "module.exports = { a };\n");
  return { jobId: "j-mcp", ws, contract: buildContract("j-mcp", "no-critical-vulns"), baselineFailures: new Set<string>(), demoMode: true, searchLessons: async () => [], searchKnowledge: async () => [], addEvidence: () => {} };
}

describe("tool-poisoning scan (§12 A)", () => {
  it("flags hidden instructions, URLs and over-long descriptions", () => {
    expect(scanToolForPoisoning(POISONED_TOOL.name, POISONED_TOOL.description).length).toBeGreaterThanOrEqual(3);
    expect(scanToolForPoisoning("read_file", "Read a text file from the workspace.")).toEqual([]);
    expect(scanToolForPoisoning("x", "a".repeat(2000))).toContain("description is unusually long (2000 chars)");
  });
});

describe("worker tools over MCP (§12 A)", () => {
  it("serves tools over an in-process client and refuses the poisoned one", async () => {
    const mcp = await connectWorkerTools(ctxFor(), { includePoisoned: true });
    try {
      expect(mcp.tools.map((t) => t.name)).toContain("read_file");
      expect(mcp.tools.map((t) => t.name)).not.toContain(POISONED_TOOL.name);
      expect(mcp.refused.map((r) => r.tool)).toContain(POISONED_TOOL.name);
      // the refusal was audited
      expect(fake.audit.some((a) => a.action === "mcp.tool_poisoning_detected" && a.target === POISONED_TOOL.name)).toBe(true);
    } finally {
      await mcp.close();
    }
  });

  it("routes a read through MCP and preserves ToolOutcome", async () => {
    const mcp = await connectWorkerTools(ctxFor());
    try {
      const ok = await mcp.exec({ name: "read_file", input: { path: "package.json" } });
      expect(ok.isError).toBe(false);
      expect(ok.content).toContain("untrusted_data");
      // repo_map structured content survives the round-trip
      const map = await mcp.exec({ name: "repo_map", input: { symbol: "a" } });
      expect(map.repoMap).toBeTruthy();
      expect(map.repoMap!.files.length).toBeGreaterThan(0);
    } finally {
      await mcp.close();
    }
  });

  it("still enforces policy server-side (write outside allowedPaths is denied)", async () => {
    const mcp = await connectWorkerTools(ctxFor());
    try {
      const denied = await mcp.exec({ name: "write_file", input: { path: "../escape.js", content: "x" } });
      expect(denied.isError).toBe(true);
      expect(denied.denied).toBeTruthy();
    } finally {
      await mcp.close();
    }
  });
});
