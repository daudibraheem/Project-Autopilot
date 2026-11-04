import { approveJob } from "@autopilot/core/approvals";
import { body, handle } from "@/lib/api";

export const dynamic = "force-dynamic";
export const POST = (req: Request, ctx: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    const { id } = await ctx.params;
    const { note } = await body<{ note?: string }>(req);
    return approveJob(id, "human", note || undefined);
  });
