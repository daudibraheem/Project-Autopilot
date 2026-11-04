import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { runInDir, trimOutput } from "../sandbox";
import { withSourceDir } from "./materialize";
import type { StandingGoal } from "./types";

export const SETUP_START = "<!-- autopilot:setup -->";
export const SETUP_END = "<!-- /autopilot:setup -->";

/** Commands inside the fenced block between the autopilot:setup markers. */
export function extractSetupCommands(readme: string): string[] | null {
  const a = readme.indexOf(SETUP_START);
  const b = readme.indexOf(SETUP_END);
  if (a < 0 || b < a) return null;
  const block = readme.slice(a + SETUP_START.length, b);
  const fence = /```[a-z]*\n([\s\S]*?)```/.exec(block);
  if (!fence) return null;
  return fence[1]!
    .split("\n")
    .map((l) => l.trim().replace(/^\$\s*/, ""))
    .filter((l) => l && !l.startsWith("#"));
}

export interface SetupStepResult {
  command: string;
  exitCode: number;
  output: string;
  durationMs: number;
}

export const g3SetupDocsWork: StandingGoal = {
  id: "setup-docs-work",
  label: "G3 · Setup docs work",
  description: "Runs the README setup block in a fresh sandbox. Red if any step fails.",
  async check(source) {
    return withSourceDir(source, async (dir) => {
      const readmePath = path.join(dir, "README.md");
      if (!existsSync(readmePath)) {
        return { goalId: "setup-docs-work", status: "red", summary: "README.md is missing", evidence: {} };
      }
      const commands = extractSetupCommands(readFileSync(readmePath, "utf8"));
      if (!commands?.length) {
        return { goalId: "setup-docs-work", status: "amber", summary: "No autopilot:setup block found in README.md", evidence: {} };
      }
      const steps: SetupStepResult[] = [];
      let failed: SetupStepResult | null = null;
      // Steps share one fresh sandbox dir, like a new joiner's checkout.
      for (const command of commands) {
        const r = await runInDir(dir, command, { timeoutMs: 60_000 });
        const step = { command, exitCode: r.exitCode, output: trimOutput(`${r.stdout}${r.stderr}`.trim(), 800), durationMs: r.durationMs };
        steps.push(step);
        if (r.exitCode !== 0) {
          failed = step;
          break;
        }
      }
      return {
        goalId: "setup-docs-work",
        status: failed ? "red" : "green",
        summary: failed
          ? `Step ${steps.length}/${commands.length} fails: \`${failed.command}\` (exit ${failed.exitCode})`
          : `All ${commands.length} setup steps succeed`,
        evidence: { commands, steps, failedStep: failed ? steps.length : null },
      };
    });
  },
};
