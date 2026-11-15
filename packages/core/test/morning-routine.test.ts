import { describe, expect, it } from "vitest";
import { MORNING_ROUTINE_STAGES } from "../src/sprint/morning-routine";

describe("morning routine pipeline (§3.1)", () => {
  it("has the stages in the spec order", () => {
    expect(MORNING_ROUTINE_STAGES.map((s) => s.key)).toEqual(["check_goals", "find_stuck", "draft_brief", "verifier_check", "safety_gate", "waiting"]);
  });

  it("every stage has a label and a plain-words caption", () => {
    for (const s of MORNING_ROUTINE_STAGES) {
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.caption.length).toBeGreaterThan(10);
    }
  });
});
