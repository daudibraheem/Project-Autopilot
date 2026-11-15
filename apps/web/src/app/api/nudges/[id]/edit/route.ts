import { editNudge } from "@autopilot/core/approvals";
import { body, handle } from "@/lib/api";

export const dynamic = "force-dynamic";
export const POST = (req: Request, ctx: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    const { id } = await ctx.params;
    const b = await body<{ text?: string; reason?: string }>(req);
    return editNudge(id, b.text ?? "");
  });
