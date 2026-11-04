import { z } from "zod";
import { DEFAULT_BUDGET } from "./config";
import { HIGH_RISK_PATTERNS } from "./policy";

export const GOAL_IDS = ["no-critical-vulns", "main-build-green", "setup-docs-work"] as const;
export type GoalId = (typeof GOAL_IDS)[number];

export const JOB_TYPES = ["dependency-security-fix", "ci-failure-triage", "setup-docs-fix"] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const GOAL_JOB_TYPE: Record<GoalId, JobType> = {
  "no-critical-vulns": "dependency-security-fix",
  "main-build-green": "ci-failure-triage",
  "setup-docs-work": "setup-docs-fix",
};

export const GOAL_LABEL: Record<GoalId, string> = {
  "no-critical-vulns": "G1 · No critical vulnerabilities",
  "main-build-green": "G2 · Main build is green",
  "setup-docs-work": "G3 · Setup docs work",
};

export const DoneCriterion = z.object({
  kind: z.enum(["tests_no_new_failures", "goal_green", "lint_clean", "dependency_at_least", "file_changed"]),
  description: z.string(),
  params: z.record(z.unknown()).default({}),
});
export type DoneCriterion = z.infer<typeof DoneCriterion>;

export const Contract = z.object({
  jobId: z.string().min(1),
  goalId: z.enum(GOAL_IDS),
  jobType: z.enum(JOB_TYPES),
  difficulty: z.enum(["easy", "hard"]),
  allowedPaths: z.array(z.string()).min(1),
  forbiddenPaths: z.array(z.string()),
  maxSteps: z.number().int().positive(),
  maxTokens: z.number().int().positive(),
  maxUsd: z.number().positive(),
  maxMinutes: z.number().positive(),
  doneCriteria: z.array(DoneCriterion).min(1),
  riskLevel: z.enum(["low", "medium", "high"]),
  allowRegistry: z.boolean().default(false),
});
export type Contract = z.infer<typeof Contract>;

/** forbiddenPaths ALWAYS includes the high-risk list. */
export function withHighRisk(paths: string[]): string[] {
  return [...new Set([...paths, ...HIGH_RISK_PATTERNS])];
}

/** Contract templates per goal. The conductor fills jobId and validates with zod. */
export function buildContract(jobId: string, goalId: GoalId, opts: { realMode?: boolean } = {}): Contract {
  const base = { jobId, goalId, jobType: GOAL_JOB_TYPE[goalId], ...DEFAULT_BUDGET, allowRegistry: Boolean(opts.realMode) };
  switch (goalId) {
    case "no-critical-vulns":
      return Contract.parse({
        ...base,
        difficulty: "easy",
        allowedPaths: ["package.json", "src/**", "test/**"],
        forbiddenPaths: withHighRisk(["advisories.json", "ci_history.csv", "vendor/**"]),
        riskLevel: "medium",
        doneCriteria: [
          { kind: "dependency_at_least", description: "Vulnerable dependency bumped to a fixed version", params: {} },
          { kind: "tests_no_new_failures", description: "Test suite has no new failures vs main (fresh sandbox)", params: {} },
          { kind: "goal_green", description: "no-critical-vulns check is green on the branch", params: {} },
        ],
      });
    case "main-build-green":
      return Contract.parse({
        ...base,
        difficulty: "easy",
        allowedPaths: ["src/**", "test/**"],
        forbiddenPaths: withHighRisk(["package.json", "vendor/**", "ci_history.csv"]),
        riskLevel: "medium",
        doneCriteria: [
          { kind: "tests_no_new_failures", description: "Test suite has no new failures vs main", params: {} },
          { kind: "goal_green", description: "main-build-green check is green on the branch", params: {} },
        ],
      });
    case "setup-docs-work":
      return Contract.parse({
        ...base,
        difficulty: "easy",
        maxSteps: 12,
        allowedPaths: ["README.md"],
        forbiddenPaths: withHighRisk(["package.json", "src/**", "scripts/**"]),
        riskLevel: "low",
        doneCriteria: [
          { kind: "file_changed", description: "README.md setup block updated", params: { path: "README.md" } },
          { kind: "goal_green", description: "setup-docs-work check is green on the branch", params: {} },
        ],
      });
  }
}
