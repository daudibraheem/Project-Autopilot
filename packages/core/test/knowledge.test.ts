import { describe, expect, it } from "vitest";
import { citation, knowledgeCitationsIn, splitIntoPassages, toOrTsQuery } from "../src/knowledge";

const DOC = `# Runbook: dependency upgrades

Intro line about advisories.

## Before you start
- Confirm the fixed version exists.

## Procedure
1. Bump the dependency.
2. Run the tests.
`;

describe("knowledge base (§12 B)", () => {
  it("splits a markdown doc into passages by ## section with line ranges", () => {
    const p = splitIntoPassages("docs/runbooks/dependency-upgrades.md", DOC);
    expect(p.length).toBe(3); // intro + 2 sections
    expect(p[0]!.title).toBe("Runbook: dependency upgrades");
    expect(p[1]!.title).toBe("Runbook: dependency upgrades — Before you start");
    expect(p[2]!.title).toBe("Runbook: dependency upgrades — Procedure");
    // 1-indexed, contiguous, non-overlapping
    expect(p[0]!.lineStart).toBe(1);
    expect(p[1]!.lineStart).toBeGreaterThan(p[0]!.lineEnd);
    for (const x of p) expect(x.content.length).toBeGreaterThan(0);
  });

  it("formats a citation as path:start-end", () => {
    expect(citation({ path: "docs/runbooks/x.md", lineStart: 5, lineEnd: 10 })).toBe("docs/runbooks/x.md:5-10");
  });

  it("extracts runbook citations from an explanation (with or without line range)", () => {
    const text = "Followed the upgrade runbook [docs/runbooks/dependency-upgrades.md:1-10]. Also see docs/runbooks/flaky-tests.md.";
    expect(knowledgeCitationsIn(text)).toEqual(["docs/runbooks/dependency-upgrades.md", "docs/runbooks/flaky-tests.md"]);
  });

  it("finds no citations when none are present", () => {
    expect(knowledgeCitationsIn("Bumped a dependency and fixed a call site.")).toEqual([]);
  });

  it("builds a sanitised OR tsquery from a natural query (drops short words, dedupes)", () => {
    expect(toOrTsQuery("flaky test re-run a quarantine")).toBe("flaky | test | run | quarantine");
    expect(toOrTsQuery("  ")).toBe("");
  });
});
