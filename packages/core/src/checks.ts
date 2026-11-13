import { conduct } from "./conductor";
import type { GoalId } from "./contract";
import { isCheckOnlyGoal } from "./contract";
import { runGoalChecks } from "./goals/index";

/** Standing-goal loop: check all goals on main, then let the conductor open jobs for red ones. */
export async function checkGoalsAndConduct(reason: string, doConduct = true) {
  const results = await runGoalChecks(undefined, reason);
  // Check-only goals (e.g. the forecast) are shown but never spawn a fixing job.
  const red = results.filter((r) => r.status === "red" && !isCheckOnlyGoal(r.goalId)).map((r) => r.goalId as GoalId);
  const plan = doConduct && red.length ? await conduct(red, reason) : null;
  return { results, plan };
}
