import { audit } from "@autopilot/core/audit";
import { enqueueCheckGoals } from "@autopilot/core/queue";
import { handle } from "@/lib/api";

export const dynamic = "force-dynamic";
export const POST = () =>
  handle(async () => {
    const id = await enqueueCheckGoals("Check goals now (dashboard)", false);
    await audit({ actor: "human", action: "goals.check_requested", target: "all goals", details: { via: "dashboard", queueJob: id } });
    return { queued: true, id };
  });
