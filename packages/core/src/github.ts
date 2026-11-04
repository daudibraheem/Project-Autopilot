/**
 * Optional GitHub mode (GITHUB_TOKEN + GITHUB_REPO): push autopilot/* branches, open DRAFT PRs,
 * mark ready for review on approval. Never merges. Token needs contents + pull-requests write only.
 */
import { Octokit } from "@octokit/rest";
import { simpleGit } from "simple-git";
import { getConfig } from "./config";
import { cleanGitEnv, PolicyViolation } from "./git";
import { checkGitRef } from "./policy";

function client() {
  const cfg = getConfig();
  const [owner, repo] = cfg.githubRepo.split("/");
  if (!cfg.githubToken || !owner || !repo) throw new Error("GitHub mode needs GITHUB_TOKEN and GITHUB_REPO=owner/repo");
  return { octokit: new Octokit({ auth: cfg.githubToken }), owner, repo, token: cfg.githubToken };
}

export async function pushBranchToGitHub(ws: string, branch: string): Promise<void> {
  const d = checkGitRef(branch);
  if (!d.allowed) throw new PolicyViolation(d.rule!, d.reason!);
  const { owner, repo, token } = client();
  const url = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
  await simpleGit(ws).env(cleanGitEnv()).push(url, `${branch}:refs/heads/${branch}`, ["--force"]);
}

export async function openDraftPr(branch: string, title: string, body: string): Promise<{ url: string; number: number }> {
  const { octokit, owner, repo } = client();
  const existing = await octokit.pulls.list({ owner, repo, head: `${owner}:${branch}`, state: "open" });
  if (existing.data[0]) return { url: existing.data[0].html_url, number: existing.data[0].number };
  const pr = await octokit.pulls.create({ owner, repo, head: branch, base: "main", title, body, draft: true });
  return { url: pr.data.html_url, number: pr.data.number };
}

/** Approval in GitHub mode: draft → ready for review. Merging stays with humans on GitHub. */
export async function markPrReady(prNumber: number): Promise<void> {
  const { octokit, owner, repo } = client();
  const pr = await octokit.pulls.get({ owner, repo, pull_number: prNumber });
  if (!pr.data.draft) return;
  await octokit.graphql(`mutation($id: ID!) { markPullRequestReadyForReview(input: { pullRequestId: $id }) { pullRequest { url } } }`, {
    id: pr.data.node_id,
  });
}
