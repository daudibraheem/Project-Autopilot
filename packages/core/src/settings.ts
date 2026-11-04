import { prisma } from "@autopilot/db";
import { audit } from "./audit";

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row ? (row.value as T) : fallback;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await prisma.setting.upsert({
    where: { key },
    create: { key, value: value as object },
    update: { value: value as object },
  });
}

export async function isKillSwitchOn(): Promise<boolean> {
  return (await getSetting<boolean>("killSwitch", false)) === true;
}

/** Flip the kill switch. When on: no new jobs start; running jobs stop after their current step. */
export async function setKillSwitch(on: boolean, actor: "human" | "system" = "human", via = "dashboard"): Promise<void> {
  await setSetting("killSwitch", on);
  await audit({
    actor,
    action: on ? "killswitch.on" : "killswitch.off",
    target: "settings/killSwitch",
    severity: on ? "warn" : "info",
    details: { via },
  });
}
