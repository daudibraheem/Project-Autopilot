import { MORNING_ROUTINE_STAGES } from "@autopilot/core/sprint/morning-routine";
import { handle } from "@/lib/api";

export const GET = () => handle(async () => ({ stages: MORNING_ROUTINE_STAGES }));
