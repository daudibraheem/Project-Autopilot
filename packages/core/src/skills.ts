/**
 * Skills: skills/<name>/SKILL.md, one per job type. The context builder loads ONLY the skill
 * that matches the job type (skillForJobType), and the loaded skill is recorded on the trace.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./config";

export interface LoadedSkill {
  name: string;
  version: string;
  jobType: string;
  body: string;
}

/** Job type → skill name. Team job types have no skill. */
export const SKILL_FOR_JOB_TYPE: Record<string, string> = {
  "dependency-security-fix": "dependency-upgrade",
  "ci-failure-triage": "flaky-test-quarantine",
  "setup-docs-fix": "docs-fix",
};

const cache = new Map<string, LoadedSkill>();

export function loadSkill(name: string): LoadedSkill | null {
  const hit = cache.get(name);
  if (hit) return hit;
  let raw: string;
  try {
    raw = readFileSync(path.join(REPO_ROOT, "skills", name, "SKILL.md"), "utf8");
  } catch {
    return null;
  }
  const header = /^<!--([\s\S]*?)-->/.exec(raw);
  const h = header?.[1] ?? "";
  const skill: LoadedSkill = {
    name,
    version: /version:\s*([\w.]+)/i.exec(h)?.[1] ?? "0",
    jobType: /jobType:\s*([\w-]+)/i.exec(h)?.[1] ?? "",
    body: raw.slice(header ? header[0]!.length : 0).trim(),
  };
  cache.set(name, skill);
  return skill;
}

/** The single skill that matches this job type, or null. */
export function skillForJobType(jobType: string): LoadedSkill | null {
  const name = SKILL_FOR_JOB_TYPE[jobType];
  return name ? loadSkill(name) : null;
}

export function skillStamp(skill: LoadedSkill | null): string | null {
  return skill ? `${skill.name}@${skill.version}` : null;
}
