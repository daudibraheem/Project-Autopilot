import { z } from "zod";
import { DEFAULT_BUDGET } from "./config";
import { HIGH_RISK_PATTERNS } from "./policy";

/** Code-health goals (G1–G3). */
export const GOAL_IDS = ["no-critical-vulns", "main-build-green", "setup-docs-work"] as const;
/** Team-health goals (Scrum Mode, S1–S2). */
export const TEAM_GOAL_IDS = ["standup-brief-ready", "no-stuck-work"] as const;
export const ALL_GOAL_IDS = [...GOAL_IDS, ...TEAM_GOAL_IDS] as const;
export type GoalId = (typeof ALL_GOAL_IDS)[number];
export type TeamGoalId = (typeof TEAM_GOAL_IDS)[number];
export const isTeamGoal = (g: string): g is TeamGoalId => (TEAM_GOAL_IDS as readonly string[]).includes(g);

export const JOB_TYPES = ["dependency-security-fix", "ci-failure-triage", "setup-docs-fix", "standup-brief", "nudge-draft"] as const;
export const TEAM_JOB_TYPES = ["standup-brief", "nudge-draft"] as const;
export const isTeamJobType = (t: string) => (TEAM_JOB_TYPES as readonly string[]).includes(t);
export type JobType = (typeof JOB_TYPES)[number];

export const GOAL_JOB_TYPE: Record<GoalId, JobType> = {
  "no-critical-vulns": "dependency-security-fix",
  "main-build-green": "ci-failure-triage",
  "setup-docs-work": "setup-docs-fix",
  "standup-brief-ready": "standup-brief",
  "no-stuck-work": "nudge-draft",
};

export const GOAL_LABEL: Record<GoalId, string> = {
  "no-critical-vulns": "G1 · No critical vulnerabilities",
  "main-build-green": "G2 · Main build is green",
  "setup-docs-work": "G3 · Setup docs work",
  "standup-brief-ready": "S1 · Standup brief ready",
  "no-stuck-work": "S2 · No stuck work",
};

export const DoneCriterion = z.object({
  kind: z.enum([
    "tests_no_new_failures",
    "goal_green",
    "lint_clean",
    "dependency_at_least",
    "file_changed",
    "every_sentence_sourced",
    "counts_match",
    "work_not_people",
    "human_sends",
  ]),
  description: z.string(),
  params: z.record(z.unknown()).default({}),
});
export type DoneCriterion = z.infer<typeof DoneCriterion>;

export const Contract = z.object({
  jobId: z.string().min(1),
  goalId: z.enum(ALL_GOAL_IDS),
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
    case "standup-brief-ready":
      return Contract.parse({
        ...base,
        allowRegistry: false,
        difficulty: "easy",
        maxSteps: 4,
        maxTokens: 40_000,
        maxUsd: 0.2,
        maxMinutes: 5,
        // Team jobs read pseudonymised sprint data only; they have no file or git tools.
        allowedPaths: ["sprint-data:read-only"],
        forbiddenPaths: withHighRisk(["**/*"]),
        riskLevel: "low",
        doneCriteria: [
          { kind: "every_sentence_sourced", description: "Every sentence cites at least one existing item, event or job", params: {} },
          { kind: "counts_match", description: "Counts equal the counts recomputed from the database", params: {} },
          { kind: "work_not_people", description: "No judgement of people, no real names, nothing from flagged comments", params: {} },
        ],
      });
    case "no-stuck-work":
      return Contract.parse({
        ...base,
        allowRegistry: false,
        difficulty: "easy",
        maxSteps: 4,
        maxTokens: 40_000,
        maxUsd: 0.2,
        maxMinutes: 5,
        allowedPaths: ["sprint-data:read-only"],
        forbiddenPaths: withHighRisk(["**/*"]),
        riskLevel: "medium",
        doneCriteria: [
          { kind: "every_sentence_sourced", description: "One draft per stuck item, each citing that item", params: {} },
          { kind: "work_not_people", description: "Drafts are about the work item, never the person", params: {} },
          { kind: "human_sends", description: "Drafts only: a human copies and sends; trust is capped at L0", params: {} },
        ],
      });
  }
}
