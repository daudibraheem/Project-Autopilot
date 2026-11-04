// Client-side shapes of the API responses (dates arrive as ISO strings).

export interface SystemInfo {
  provider: string;
  workerModel: string;
  hardWorkerModel: string;
  verifierModel: string;
  routeError: string | null;
  sandbox: { mode: string; unsafe: boolean; reason: string };
  githubMode: boolean;
  killSwitch: boolean;
  pendingApprovals: number;
}

export interface GoalView {
  goalId: string;
  label: string;
  description: string;
  latest: { status: string; summary: string; evidence: Record<string, unknown>; createdAt: string } | null;
  previousStatus: string | null;
  hoursBrokenWeek: number;
  history: { status: string; createdAt: string }[];
}

export interface Overview extends SystemInfo {
  goals: GoalView[];
  openJobs: { id: string; goalId: string; status: string }[];
  openJobCount: number;
  todayCostUsd: number;
  lastCheckAt: string | null;
}

export interface JobRow {
  id: string;
  goalId: string;
  goalLabel: string;
  jobType: string;
  status: string;
  attempt: number;
  costUsd: number;
  tokens: number;
  steps: number;
  source: string;
  degraded: boolean;
  createdAt: string;
  finishedAt: string | null;
  workerModel: string | null;
}

export interface Step {
  id: string;
  index: number;
  attempt: number;
  phase: string;
  kind: string;
  tool: string | null;
  status: string;
  inputSummary: string | null;
  outputSummary: string | null;
  model: string | null;
  provider: string | null;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  durationMs: number;
  hasCheckpoint: boolean;
  createdAt: string;
}

export interface Evidence {
  step: number;
  kind: string;
  tool?: string;
  command?: string;
  target?: string;
  exitCode?: number;
  newFailures?: number;
  preExistingFailures?: number;
  afterLastWrite?: boolean;
  rule?: string;
  output?: string;
  note?: string;
}

export interface AuditRow {
  id: string;
  createdAt: string;
  actor: string;
  action: string;
  target: string;
  severity: string;
  jobId: string | null;
  details: Record<string, unknown>;
}

export interface JobDetail {
  id: string;
  goalId: string;
  goalLabel: string;
  jobType: string;
  status: string;
  attempt: number;
  branch: string;
  degraded: boolean;
  workerModel: string | null;
  verifierModel: string | null;
  provider: string | null;
  trustLevelAtStart: number;
  diff: string | null;
  explanation: string | null;
  evidence: Evidence[] | null;
  feedback: string | null;
  error: string | null;
  stepsUsed: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  prUrl: string | null;
  mergedSha: string | null;
  source: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  contract: {
    difficulty: string;
    allowedPaths: string[];
    forbiddenPaths: string[];
    maxSteps: number;
    maxTokens: number;
    maxUsd: number;
    maxMinutes: number;
    doneCriteria: { kind: string; description: string }[];
    riskLevel: string;
    allowRegistry: boolean;
  } | null;
  steps: Step[];
  verifierReports: {
    id: string;
    attempt: number;
    model: string;
    provider: string;
    verdict: string;
    checks: { name: string; passed: boolean; reason: string }[];
    concerns: string[];
    createdAt: string;
  }[];
  gateResults: { id: string; name: string; label: string; passed: boolean; evidence: string }[];
  approvals: { id: string; decision: string; reason: string | null; actor: string; createdAt: string; attempt: number }[];
  audit: AuditRow[];
  trust: { level: number; label: string; consecutivePasses: number };
}
