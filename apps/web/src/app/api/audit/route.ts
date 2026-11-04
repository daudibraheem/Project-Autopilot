import { auditData } from "@autopilot/core/queries";
import { handle } from "@/lib/api";

export const dynamic = "force-dynamic";
export const GET = (req: Request) =>
  handle(async () => {
    const u = new URL(req.url);
    return auditData({
      actor: u.searchParams.get("actor") || undefined,
      action: u.searchParams.get("action") || undefined,
      deniedOnly: u.searchParams.get("denied") === "1",
    });
  });
