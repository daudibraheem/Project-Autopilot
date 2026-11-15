import { describe, expect, it } from "vitest";
import { loadPrompt, promptStamp, renderPrompt } from "../src/prompts";
import { skillForJobType, skillStamp, SKILL_FOR_JOB_TYPE } from "../src/skills";

describe("prompts as versioned files (§12 H)", () => {
  it("loads each prompt with a version and non-empty body", () => {
    for (const name of ["worker", "verifier", "team-verifier", "lesson-writer", "assistant", "sub-agent"] as const) {
      const p = loadPrompt(name);
      expect(p.version).toMatch(/^\d/);
      expect(p.body.length).toBeGreaterThan(20);
      expect(p.body).not.toMatch(/^<!--/); // header stripped
    }
  });

  it("substitutes placeholders including the untrusted rule", () => {
    const body = renderPrompt("worker", { JOB_TYPE: "dependency-security-fix", LESSONS: "" });
    expect(body).toContain("dependency-security-fix");
    expect(body).toContain("untrusted_data"); // UNTRUSTED_RULE injected
    expect(body).not.toContain("{{"); // no leftover placeholders
  });

  it("stamps a name@version", () => {
    expect(promptStamp("verifier")).toMatch(/^verifier@\d/);
  });
});

describe("skills, one per job type (§12 E)", () => {
  it("loads the matching skill for each code job type and none for team jobs", () => {
    expect(skillForJobType("dependency-security-fix")?.name).toBe("dependency-upgrade");
    expect(skillForJobType("ci-failure-triage")?.name).toBe("flaky-test-quarantine");
    expect(skillForJobType("setup-docs-fix")?.name).toBe("docs-fix");
    expect(skillForJobType("standup-brief")).toBeNull();
    expect(skillForJobType("nudge-draft")).toBeNull();
  });

  it("skill bodies have steps and an output template", () => {
    for (const name of Object.values(SKILL_FOR_JOB_TYPE)) {
      const s = skillForJobType(Object.entries(SKILL_FOR_JOB_TYPE).find(([, v]) => v === name)![0])!;
      expect(s.body).toMatch(/## Steps/);
      expect(s.body).toMatch(/Output template/i);
      expect(skillStamp(s)).toBe(`${name}@${s.version}`);
    }
  });
});
