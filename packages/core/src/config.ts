import { existsSync } from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

/** Walk up from cwd to the monorepo root (the folder holding pnpm-workspace.yaml). */
export function findRepoRoot(start = process.cwd()): string {
  let dir = path.resolve(start);
  for (;;) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(start);
    dir = parent;
  }
}

export const REPO_ROOT = findRepoRoot();
dotenv.config({ path: path.join(REPO_ROOT, ".env"), quiet: true } as dotenv.DotenvConfigOptions);

export type LlmProviderName = "mock" | "anthropic" | "openai";
export type SandboxMode = "docker" | "local" | "auto";

function env(name: string, fallback = ""): string {
  const v = process.env[name];
  return v === undefined || v.trim() === "" ? fallback : v.split("#")[0]!.trim();
}

export interface AutopilotConfig {
  provider: LlmProviderName;
  workerModel: string;
  hardWorkerModel: string;
  verifierModel: string;
  openaiWorkerModel: string;
  openaiVerifierModel: string;
  allowMockFallback: boolean;
  targetRepoPath: string;
  workspacesDir: string;
  lessonsFile: string;
  githubToken: string;
  githubRepo: string;
  sandbox: SandboxMode;
  sandboxImage: string;
}

/** Read config fresh each time so tests / CLI flags can change env between calls. */
export function getConfig(): AutopilotConfig {
  const provider = env("AUTOPILOT_LLM_PROVIDER", "mock") as LlmProviderName;
  const target = env("TARGET_REPO_PATH", "./demo_target");
  return {
    provider: ["mock", "anthropic", "openai"].includes(provider) ? provider : "mock",
    workerModel: env("WORKER_MODEL", "claude-haiku-5-5"),
    hardWorkerModel: env("HARD_WORKER_MODEL", "claude-sonnet-5-5"),
    verifierModel: env("VERIFIER_MODEL", "claude-sonnet-5-5"),
    openaiWorkerModel: env("OPENAI_WORKER_MODEL", "gpt-5-mini"),
    openaiVerifierModel: env("OPENAI_VERIFIER_MODEL", "gpt-5"),
    allowMockFallback: env("AUTOPILOT_ALLOW_MOCK_FALLBACK", "false") === "true",
    targetRepoPath: path.resolve(REPO_ROOT, target),
    workspacesDir: path.resolve(REPO_ROOT, env("AUTOPILOT_WORKSPACES_DIR", ".autopilot/workspaces")),
    lessonsFile: path.resolve(REPO_ROOT, env("AUTOPILOT_LESSONS_FILE", "memory/lessons.md")),
    githubToken: env("GITHUB_TOKEN"),
    githubRepo: env("GITHUB_REPO"),
    sandbox: (env("AUTOPILOT_SANDBOX", "auto") as SandboxMode) || "auto",
    sandboxImage: env("AUTOPILOT_SANDBOX_IMAGE", "node:22-slim"),
  };
}

export function githubMode(cfg = getConfig()): boolean {
  return Boolean(cfg.githubToken && cfg.githubRepo);
}

/** Demo mode = target contains local advisories + vendor dir (see DECISIONS #14). */
export function isDemoTarget(targetPath = getConfig().targetRepoPath): boolean {
  return existsSync(path.join(targetPath, "advisories.json")) && existsSync(path.join(targetPath, "vendor"));
}

/** Default per-job budgets. */
export const DEFAULT_BUDGET = {
  maxSteps: 16,
  maxTokens: 120_000,
  maxUsd: 0.5,
  maxMinutes: 10,
} as const;

export const MAX_OPEN_JOBS = 3;
