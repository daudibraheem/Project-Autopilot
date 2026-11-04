import { existsSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

// Load the monorepo root .env (does not override variables already set).
(() => {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
      const envFile = path.join(dir, ".env");
      if (existsSync(envFile)) {
        try {
          process.loadEnvFile(envFile);
        } catch {
          /* ignore */
        }
      }
      return;
    }
    dir = path.dirname(dir);
  }
})();

export * from "@prisma/client";

const globalForPrisma = globalThis as unknown as { __autopilotPrisma?: PrismaClient };

/** Single shared Prisma client (survives Next.js hot reloads). */
export const prisma: PrismaClient =
  globalForPrisma.__autopilotPrisma ?? new PrismaClient({ log: ["warn", "error"] });

if (process.env.NODE_ENV !== "production") globalForPrisma.__autopilotPrisma = prisma;
