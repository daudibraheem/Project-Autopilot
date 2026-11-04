import { rejectJob } from "@autopilot/core/approvals";
import { body, handle } from "@/lib/api";

export const dynamic = "force-dynamic";
export const POST = (req: Request, ctx: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    const { id } = await ctx.params;
    const { reason } = await body<{ reason?: string }>(req);
    return rejectJob(id, reason ?? "");
  });
