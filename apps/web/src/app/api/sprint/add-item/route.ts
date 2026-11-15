import { addMidSprintItem } from "@autopilot/core/sprint/demo";
import { body, handle } from "@/lib/api";

export const dynamic = "force-dynamic";
export const POST = (req: Request) => handle(async () => addMidSprintItem((await body<{ points?: number }>(req)).points ?? 3));
