import { forecastSprint } from "@autopilot/core/sprint/forecast";
import { handle } from "@/lib/api";

export const dynamic = "force-dynamic";
export const GET = () =>
  handle(async () => {
    const { sprint, forecast } = await forecastSprint();
    return { sprint: sprint ? { name: sprint.name, start: sprint.start, end: sprint.end } : null, forecast };
  });
