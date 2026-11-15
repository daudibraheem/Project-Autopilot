/**
 * The agent-journey modes (BUILD_PROMPT §12 G): the same engine, triggered three ways.
 *   Assistant — a human asks a question (Ask Autopilot).
 *   Coworker  — a human delegates a task (Run job / Generate brief / Draft nudges).
 *   Ambient   — a schedule or an event triggers it (daily cron, a goal going red).
 */
export type AgentMode = "Assistant" | "Coworker" | "Ambient";

export const MODE_HINT: Record<AgentMode, string> = {
  Assistant: "a human asks a question",
  Coworker: "a human delegates (Run job)",
  Ambient: "a schedule or an event triggers it",
};

/** Map a job's source to the mode that started it. */
export function jobMode(source: string): Exclude<AgentMode, "Assistant"> {
  return /cron|goal-check|daily|schedule|event|ambient/i.test(source) ? "Ambient" : "Coworker";
}
