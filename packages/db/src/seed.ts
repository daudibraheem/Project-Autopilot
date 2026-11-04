import { prisma } from "./index";

/** Initial settings rows. Safe to run repeatedly. */
export const DEFAULT_SETTINGS: Record<string, unknown> = {
  killSwitch: false,
  "trust.promoteAfter": 3,
  "trust.autoMergeAllowed": {},
  "conductor.maxOpenJobs": 3,
};

export async function seedSettings(): Promise<void> {
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await prisma.setting.upsert({
      where: { key },
      create: { key, value: value as object },
      update: {},
    });
  }
}

const isMain = process.argv[1]?.endsWith("seed.ts");
if (isMain) {
  seedSettings()
    .then(() => console.log("settings seeded"))
    .finally(() => prisma.$disconnect());
}
