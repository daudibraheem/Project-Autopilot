import { jobDetail } from "@autopilot/core/queries";
import { handle } from "@/lib/api";

export const dynamic = "force-dynamic";
export const GET = (_req: Request, ctx: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    const { id } = await ctx.params;
    const d = await jobDetail(id);
    if (!d) throw new Error(`Job ${id} not found`);
    return d;
  });
