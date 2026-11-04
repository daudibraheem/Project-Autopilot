import { PrismaClient } from "@prisma/client";

export * from "@prisma/client";

const globalForPrisma = globalThis as unknown as { __autopilotPrisma?: PrismaClient };

/** Single shared Prisma client (survives Next.js hot reloads). */
export const prisma: PrismaClient =
  globalForPrisma.__autopilotPrisma ?? new PrismaClient({ log: ["warn", "error"] });

if (process.env.NODE_ENV !== "production") globalForPrisma.__autopilotPrisma = prisma;
