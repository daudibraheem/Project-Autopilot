import { runMorningRoutine } from "@autopilot/core/sprint/morning-routine";
import { handle } from "@/lib/api";

export const dynamic = "force-dynamic";
export const POST = () => handle(runMorningRoutine);
