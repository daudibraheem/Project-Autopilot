import { isKillSwitchOn, setKillSwitch } from "@autopilot/core/settings";
import { body, handle } from "@/lib/api";

export const dynamic = "force-dynamic";
export const GET = () => handle(async () => ({ on: await isKillSwitchOn() }));
export const POST = (req: Request) =>
  handle(async () => {
    const { on } = await body<{ on?: boolean }>(req);
    await setKillSwitch(Boolean(on), "human", "dashboard");
    return { on: Boolean(on) };
  });
