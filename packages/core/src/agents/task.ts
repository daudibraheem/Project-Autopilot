/** The worker's task brief. Only harness-computed (trusted) fields go in <task>; anything verbatim from files/logs is wrapped as untrusted. */
import { wrapUntrusted } from "../untrusted";

export interface TestRef {
  file: string;
  name: string;
}

export interface WorkerTask {
  jobId: string;
  goalId: string;
  jobType: string;
  attempt: number;
  goalSummary: string;
  contract: { allowedPaths: string[]; forbiddenPaths: string[]; doneCriteria: string[]; maxSteps: number };
  repoFiles: string[];
  baselineFailures: string[];
  advisory?: {
    package: string;
    installed: string;
    fixedIn: string | null;
    spec: string;
    availableVersions: string[];
    exportsChange?: { removed: string[]; added: string[] };
  };
  triage?: {
    decision: "flaky" | "real_bug" | "uncertain";
    probability: number;
    test: TestRef;
    rerunPassed: boolean;
    causeCommit?: { sha: string; message: string; files: string[] };
    quarantineReason?: string;
  };
  feedback?: string;
  lessons: string[];
}

export interface UntrustedAttachment {
  source: string;
  text: string;
}

export function renderTask(task: WorkerTask, attachments: UntrustedAttachment[]): string {
  const parts = [
    "Here is your job. The <task> block is from the Autopilot harness (trusted).",
    `<task>\n${JSON.stringify(task, null, 2)}\n</task>`,
    ...attachments.map((a) => wrapUntrusted(a.source, a.text)),
    "Work step by step with the tools. When the done criteria are met (or you cannot make progress), stop calling tools and reply with a short explanation: what you changed, which commands you ran and their results, and any concerns.",
  ];
  return parts.join("\n\n");
}

export function parseTask(text: string): WorkerTask | null {
  const m = /<task>\n([\s\S]*?)\n<\/task>/.exec(text);
  if (!m) return null;
  try {
    return JSON.parse(m[1]!) as WorkerTask;
  } catch {
    return null;
  }
}

/** Harness-computed summary line on run_tests results (parsed by the mock). */
export const RESULT_PREFIX = "RESULT ";
