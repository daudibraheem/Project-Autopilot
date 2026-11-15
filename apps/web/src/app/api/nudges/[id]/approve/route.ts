import { approveNudge } from "@autopilot/core/approvals";
import { handle } from "@/lib/api";

export const dynamic = "force-dynamic";
/** Marks the draft ready to send. Nothing is sent: Autopilot has no messaging capability. */
export const POST = (_req: Request, ctx: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    const { id } = await ctx.params;
    return approveNudge(id);
  });
