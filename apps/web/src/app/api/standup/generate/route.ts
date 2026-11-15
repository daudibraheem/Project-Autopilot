import { startJobForGoal } from "@autopilot/core/conductor";
import { handle } from "@/lib/api";

export const dynamic = "force-dynamic";
// "Generate brief now": allowed even when S1 is green (a fresh brief on demand). Kill switch, dedupe and cap still apply.
export const POST = () => handle(async () => ({ jobId: await startJobForGoal("standup-brief-ready", "dashboard", { allowGreen: true }) }));
