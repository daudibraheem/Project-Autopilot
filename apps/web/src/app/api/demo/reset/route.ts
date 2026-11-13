import { resetScrumDemo } from "@autopilot/core/sprint/demo";
import { handle } from "@/lib/api";

export const dynamic = "force-dynamic";
export const POST = () => handle(async () => {
  const r = await resetScrumDemo();
  return { ok: true, sprint: r.sprint?.name ?? null, items: r.items };
});
