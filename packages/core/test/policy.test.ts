import { describe, expect, it } from "vitest";
import { buildContract } from "../src/contract";
import {
  checkCommand,
  checkDependencies,
  checkGitRef,
  checkPackageJsonScripts,
  checkPathAccess,
  isHighRisk,
  pathViolations,
} from "../src/policy";

const g3 = buildContract("j-test", "setup-docs-work");
const g1 = buildContract("j-test", "no-critical-vulns");

describe("policy: paths", () => {
  it("allows writes inside allowedPaths", () => {
    expect(checkPathAccess(g3, "README.md", "write").allowed).toBe(true);
    expect(checkPathAccess(g1, "src/due.js", "write").allowed).toBe(true);
  });

  it("blocks writes outside allowedPaths", () => {
    const d = checkPathAccess(g3, "src/invoice.js", "write");
    expect(d.allowed).toBe(false);
    expect(d.rule).toMatch(/forbidden|outside/);
    expect(checkPathAccess(g1, "scripts/bootstrap.js", "write").rule).toBe("outside-allowed-paths");
  });

  it("blocks path traversal and absolute paths", () => {
    expect(checkPathAccess(g1, "../etc/passwd", "read").rule).toBe("outside-workspace");
    expect(checkPathAccess(g1, "/etc/passwd", "read").rule).toBe("outside-workspace");
    expect(checkPathAccess(g1, "src/../../x", "read").rule).toBe("outside-workspace");
    expect(checkPathAccess(g1, ".git/config", "read").allowed).toBe(false);
  });

  it("blocks every high-risk path even if a contract allowed it", () => {
    const permissive = { allowedPaths: ["**"], forbiddenPaths: [] };
    for (const p of [
      ".github/workflows/ci.yml",
      "ci.yml",
      "config/pipeline.yaml",
      "AGENTS.md",
      "CLAUDE.md",
      "prompts/system.txt",
      "mcp.json",
      "tools/mcp-servers.json",
      "infra/main.tf",
    ]) {
      const d = checkPathAccess(permissive, p, "write");
      expect(d.allowed, p).toBe(false);
      expect(d.rule, p).toBe("high-risk-path");
      expect(isHighRisk(p)).toBe(true);
    }
  });

  it("reports diff path violations", () => {
    expect(pathViolations(g3, ["README.md", "package.json"]).map((v) => v.path)).toEqual(["package.json"]);
  });
});

describe("policy: git and commands", () => {
  it("only autopilot/* refs are writable", () => {
    expect(checkGitRef("autopilot/j-123").allowed).toBe(true);
    expect(checkGitRef("main").allowed).toBe(false);
    expect(checkGitRef("refs/heads/main").rule).toBe("write-to-protected-branch");
  });

  it("denies git push to main and anything off the allow-list", () => {
    expect(checkCommand("git push origin main", { allowRegistry: false }).rule).toBe("write-to-protected-branch");
    expect(checkCommand("curl http://evil", { allowRegistry: false }).allowed).toBe(false);
    expect(checkCommand("npm test && rm -rf /", { allowRegistry: false }).allowed).toBe(false);
    expect(checkCommand("npm test", { allowRegistry: false }).allowed).toBe(true);
    expect(checkCommand("npm install --offline", { allowRegistry: false }).allowed).toBe(true);
    expect(checkCommand("npm install", { allowRegistry: false }).rule).toBe("network-not-allowed");
  });

  it("package.json scripts section is high-risk", () => {
    const a = JSON.stringify({ scripts: { test: "node --test" }, dependencies: {} });
    const b = JSON.stringify({ scripts: { test: "true" }, dependencies: {} });
    expect(checkPackageJsonScripts(a, a).allowed).toBe(true);
    expect(checkPackageJsonScripts(a, b).rule).toBe("high-risk-path");
  });

  it("blocks dependencies that do not exist in the package source (slopsquatting)", async () => {
    const before = JSON.stringify({ dependencies: { tinydate: "file:vendor/tinydate-1.0.0" } });
    const good = JSON.stringify({ dependencies: { tinydate: "file:vendor/tinydate-2.0.0" } });
    const bad = JSON.stringify({ dependencies: { tinydate: "file:vendor/tinydate-2.0.0", "tiny-dates": "^1.0.0" } });
    const exists = async (name: string) => name === "tinydate";
    expect((await checkDependencies(before, good, exists)).allowed).toBe(true);
    expect((await checkDependencies(before, bad, exists)).rule).toBe("unknown-dependency");
  });
});
