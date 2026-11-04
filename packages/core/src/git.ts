/**
 * Git helpers. Agents only ever work in a separate workspace clone on autopilot/<jobId>.
 * Every AI-initiated write goes through assertAutopilotBranch(); only approvals.ts merges to main.
 */
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { simpleGit } from "simple-git";
import { getConfig } from "./config";
import { checkGitRef } from "./policy";

export class PolicyViolation extends Error {
  constructor(
    public rule: string,
    message: string,
  ) {
    super(message);
    this.name = "PolicyViolation";
  }
}

export const branchFor = (jobId: string) => `autopilot/${jobId}`;

export function workspacePath(jobId: string): string {
  return path.join(getConfig().workspacesDir, jobId);
}

function git(dir: string) {
  return simpleGit(dir).env(cleanGitEnv({
    GIT_AUTHOR_NAME: "Project Autopilot",
    GIT_AUTHOR_EMAIL: "autopilot@localhost",
    GIT_COMMITTER_NAME: "Project Autopilot",
    GIT_COMMITTER_EMAIL: "autopilot@localhost",
  }));
}

export async function assertAutopilotBranch(dir: string): Promise<string> {
  const branch = (await git(dir).revparse(["--abbrev-ref", "HEAD"])).trim();
  const d = checkGitRef(branch);
  if (!d.allowed) throw new PolicyViolation(d.rule!, d.reason!);
  return branch;
}

/** Fresh clone of the target in .autopilot/workspaces/<jobId>, on branch autopilot/<jobId>. */
export async function prepareWorkspace(jobId: string, opts: { reuseBranch?: boolean } = {}): Promise<string> {
  const cfg = getConfig();
  const ws = workspacePath(jobId);
  const branch = branchFor(jobId);
  rmSync(ws, { recursive: true, force: true });
  mkdirSync(path.dirname(ws), { recursive: true });
  await simpleGit().clone(cfg.targetRepoPath, ws, ["--quiet", "--no-hardlinks"]);
  const g = git(ws);
  await g.addConfig("commit.gpgsign", "false");
  const remoteBranches = await g.branch(["-r"]);
  if (opts.reuseBranch && remoteBranches.all.includes(`origin/${branch}`)) {
    await g.checkout(["-b", branch, `origin/${branch}`]);
  } else {
    await g.checkout(["-b", branch, "origin/main"]);
  }
  await assertAutopilotBranch(ws);
  return ws;
}

/** Diff of the workspace (including new files) against main. */
export async function workspaceDiff(ws: string): Promise<{ diff: string; files: string[] }> {
  const g = git(ws);
  await g.add(["-A", "--", ".", ":(exclude)node_modules"]);
  const diff = await g.diff(["--cached", "origin/main"]);
  const names = await g.diff(["--cached", "--name-only", "origin/main"]);
  return { diff, files: names.split("\n").map((s) => s.trim()).filter(Boolean) };
}

export async function commitWorkspace(ws: string, message: string): Promise<string | null> {
  await assertAutopilotBranch(ws);
  const g = git(ws);
  await g.add(["-A"]);
  const status = await g.status();
  if (status.staged.length === 0 && status.files.length === 0) return null;
  const r = await g.commit(message);
  return r.commit || null;
}

/** Push autopilot/* to the target repo (local "origin"). Never main. */
export async function pushBranch(ws: string): Promise<string> {
  const branch = await assertAutopilotBranch(ws);
  await git(ws).push("origin", `${branch}:${branch}`, ["--force"]);
  return branch;
}

export async function refExists(repo: string, ref: string): Promise<boolean> {
  try {
    await simpleGit(repo).revparse(["--verify", "--quiet", ref]);
    return true;
  } catch {
    return false;
  }
}

/** HUMAN-ONLY: merge an approved autopilot branch into main of the target repo. Called from approvals.ts. */
export async function mergeApprovedBranch(repo: string, branch: string, message: string): Promise<string> {
  if (!checkGitRef(branch).allowed) throw new PolicyViolation("bad-branch", `Refusing to merge non-autopilot branch ${branch}`);
  const g = simpleGit(repo).env(cleanGitEnv({
    GIT_COMMITTER_NAME: "Autopilot (approved by human)",
    GIT_COMMITTER_EMAIL: "autopilot@localhost",
    GIT_AUTHOR_NAME: "Autopilot (approved by human)",
    GIT_AUTHOR_EMAIL: "autopilot@localhost",
  }));
  const current = (await g.revparse(["--abbrev-ref", "HEAD"])).trim();
  if (current !== "main") await g.checkout("main");
  await g.merge(["--no-ff", "-m", message, branch]);
  return (await g.revparse(["HEAD"])).trim();
}

export async function headSha(repo: string, ref = "HEAD"): Promise<string> {
  return (await simpleGit(repo).revparse([ref])).trim();
}

export interface CommitInfo {
  sha: string;
  message: string;
  date: string;
  files: string[];
}

export async function recentCommits(repo: string, ref = "main", n = 5): Promise<CommitInfo[]> {
  const out = await simpleGit(repo).raw(["log", ref, `-n${n}`, "--name-only", "--format=@@%H|%s|%cI"]);
  const commits: CommitInfo[] = [];
  for (const block of out.split("@@").filter((b) => b.trim())) {
    const [head, ...rest] = block.trim().split("\n");
    const [sha, message, date] = head!.split("|");
    commits.push({ sha: sha!, message: message!, date: date!, files: rest.map((s) => s.trim()).filter(Boolean) });
  }
  return commits;
}

export async function showCommit(repo: string, sha: string): Promise<string> {
  return simpleGit(repo).show([sha, "--format=%H %s", "--unified=1"]);
}

export function targetExists(): boolean {
  return existsSync(path.join(getConfig().targetRepoPath, ".git"));
}

/** process.env without inherited GIT_* variables (IDE-set GIT_EDITOR/GIT_ASKPASS trip simple-git's safety plugin). */
export function cleanGitEnv(extra: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith("GIT_")) out[k] = v;
  return { ...out, ...extra };
}
