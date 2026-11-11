import { standupPageData } from "@autopilot/core/sprint/queries";
import { handle } from "@/lib/api";

export const dynamic = "force-dynamic";
export const GET = () => handle(standupPageData);
