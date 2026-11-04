import { overviewData } from "@autopilot/core/queries";
import { handle } from "@/lib/api";

export const dynamic = "force-dynamic";
export const GET = () => handle(overviewData);
