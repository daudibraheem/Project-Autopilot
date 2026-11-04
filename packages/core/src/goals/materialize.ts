import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { copyToTemp, exportRef } from "../sandbox";
import type { GoalSource } from "./types";

/** Materialise a goal source into a throwaway dir, run fn, clean up. */
export async function withSourceDir<T>(source: GoalSource, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = source.kind === "ref" ? await exportRef(source.repo, source.ref) : copyToTemp(source.dir);
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function sourceLabel(source: GoalSource): string {
  return source.kind === "ref" ? source.ref : source.label;
}

export function tempDir(prefix = "ap-"): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}
