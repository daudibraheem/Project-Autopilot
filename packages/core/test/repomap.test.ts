import { describe, expect, it } from "vitest";
import { buildRepoMap, findCallSites, parseModule } from "../src/repomap";

const FILES = [
  { path: "src/due.js", content: "'use strict';\nconst { parse, addDays, format } = require('tinydate');\nfunction dueDate(issued, termsDays = 30) {\n  return format(addDays(parse(issued), termsDays));\n}\nmodule.exports = { dueDate };\n" },
  { path: "src/cli.js", content: "const { dueDate } = require('./due');\nconsole.log(dueDate('2026-01-15'));\n" },
  { path: "test/due.test.js", content: "const { dueDate } = require('../src/due');\n// parseline comment should be skipped\ndueDate('2026-01-15');\n" },
];

describe("codebase map (§12 F)", () => {
  it("extracts exports and imports per file", () => {
    const due = parseModule("src/due.js", FILES[0]!.content);
    expect(due.exports).toEqual(["dueDate"]);
    expect(due.imports.map((i) => i.module)).toEqual(["tinydate"]);
    expect(due.imports[0]!.symbols).toEqual(["parse", "addDays", "format"]);
  });

  it("finds every call site of a symbol (not the import line)", () => {
    const sites = findCallSites(FILES, "parse");
    expect(sites).toHaveLength(1); // only the real call in due.js, not the require destructuring
    expect(sites[0]!.path).toBe("src/due.js");
    expect(sites[0]!.line).toBe(4);
  });

  it("does not confuse parse with parseDate", () => {
    const files = [{ path: "src/x.js", content: "const { parseDate } = require('tinydate');\nreturn parseDate(x);\n" }];
    expect(findCallSites(files, "parse")).toHaveLength(0);
    expect(findCallSites(files, "parseDate")).toHaveLength(1);
  });

  it("builds edges for relative imports that resolve to known files", () => {
    const map = buildRepoMap(FILES, { symbol: "dueDate" });
    expect(map.edges).toContainEqual({ from: "src/cli.js", to: "src/due.js" });
    expect(map.edges).toContainEqual({ from: "test/due.test.js", to: "src/due.js" });
    // tinydate is external → no edge
    expect(map.edges.some((e) => e.to === "tinydate")).toBe(false);
    expect(map.callSites.length).toBeGreaterThan(0);
  });
});
