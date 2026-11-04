import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** In-memory stand-in for the Prisma client (only what the code under test touches). */
export function fakePrisma() {
  const audit: { actor: string; action: string; target: string; severity: string; jobId: string | null; details: Record<string, unknown> }[] = [];
  const prisma = {
    auditEvent: {
      create: async ({ data }: { data: (typeof audit)[number] }) => {
        audit.push(data);
        return data;
      },
    },
    lesson: { findMany: async () => [] },
  };
  return { prisma, audit };
}

export function tmp(prefix = "ap-test-"): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}
