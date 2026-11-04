import { startJobForGoal } from "@autopilot/core/conductor";
import type { GoalId } from "@autopilot/core/contract";
import { handle } from "@/lib/api";

export const dynamic = "force-dynamic";
export const POST = (_req: Request, ctx: { params: Promise<{ goalId: string }> }) =>
  handle(async () => {
    const { goalId } = await ctx.params;
    const jobId = await startJobForGoal(goalId as GoalId, "dashboard");
    return { jobId };
  });
