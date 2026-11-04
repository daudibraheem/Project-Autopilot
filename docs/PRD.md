# Project Autopilot: Product Requirements

## 1. Problem: background rot

Every software project slowly decays in the background while the team ships features:

- **Security alerts get ignored.** A critical advisory sits open for weeks because upgrading "might break something".
- **Broken builds have no owner.** A flaky test turns `main` red a few times a week. People re-run CI and move on.
- **Setup docs stop working.** The README says `node scripts/init.js`, but that file was renamed months ago. Every new joiner loses half a day.

None of this is hard. It just never wins against feature work. Project Autopilot is a small "AI operating system" that keeps one project healthy by watching **standing goals**. It sends a sandboxed AI worker to fix what's broken, has a different AI verify the work, lets plain code make the pass/fail call and asks a human before anything is merged.

## 2. User

- **Developers** on one project. They want rot fixed without having to context-switch.
- **The tech lead** of that project. They decide what Autopilot may touch and approve merges, and they want to know what it costs.

## 3. Primary metric

**Hours per week each goal spends "broken" (red).** This is computed from stored goal-check results: the time between a red check and the next non-red check, summed per week.

Secondary metrics:
- AI cost per job and per day (USD).
- Gate pass rate per job type.
- Human approval rate per job type, which feeds the trust score.

## 4. Cost of a wrong answer

**A bad change merged into `main`.** Every design choice protects against this:

- The AI never writes to `main`.
- A different model verifies the work.
- Plain code makes the final call.
- A human approves every merge at trust level 0–1.

A false "all clear" on a goal check is the second-worst outcome. That's why goal checks are plain code, not AI.

## 5. Human approval

- **Every merge at trust level 0–1 needs a human approval.**
- Level 2 (auto-merge) exists in the trust model, but `autoMergeAllowed` is `false` for every job type by default. It never applies to high-risk paths (`.github/**`, CI YAML, `AGENTS.md`, `CLAUDE.md`, `prompts/**`, `**/mcp*.json`, `infra/**`, `package.json` scripts).
- Humans can **approve**, **reject** (a reason is required) or **request changes** (the worker gets one more attempt with the feedback).

## 6. Scope

### In scope
- One target repository: a seeded demo repo by default, or any local Node repo via `TARGET_REPO_PATH`.
- Three standing goals: `no-critical-vulns`, `main-build-green` and `setup-docs-work`.
- A worker agent with a bounded loop, policy-checked tools and a Docker sandbox.
- A verifier agent on a different model.
- A plain-code gate.
- An approval queue.
- A trust ledger, a lessons file and an audit log.
- A small ML classifier (logistic regression) that separates flaky tests from real failures.
- A dashboard with seven pages, plus a CLI.
- Mock LLM mode that runs the whole demo with no API key and no internet.
- Optional GitHub mode: push `autopilot/*` branches and open **draft** PRs.

### Out of scope
- Multi-repo or organisation-wide operation.
- Production scale: HA workers, sharding, multi-tenant auth.
- Months of real historical data. The CI history is synthetic.
- Auto-merge in the default configuration.
- Languages other than Node.js for the target project.
- User accounts and RBAC. The dashboard is single-user and runs on localhost.

## 7. User stories and acceptance criteria

**US1: See project health at a glance.** *As a tech lead, I want to see which standing goals are broken, why, and for how long.*
- The Overview shows one panel per goal with its status (green/amber/red), the latest evidence and hours broken this week.
- "Check goals now" re-runs all checks, and the panels update within a few seconds.

**US2: Fix a security advisory safely.** *As a developer, I want vulnerable dependencies upgraded, including any code the upgrade breaks.*
- The G1 job bumps `tinydate` to a fixed version and fixes the renamed call site. Tests pass.
- The diff only touches paths in the contract's `allowedPaths`.
- The job appears in Approvals with its contract, diff, evidence, verifier report and gate checklist.

**US3: Tell flaky failures from real failures.** *As a developer, I want a red `main` triaged without re-running CI five times.*
- A classifier predicts p(flaky) for the failing test.
- p ≥ 0.7: the job re-runs once. If the re-run passes, it proposes quarantining the test with a reason.
- p ≤ 0.3: the job identifies the cause commit and the failing test, and proposes a fix.
- 0.3 < p < 0.7: an LLM analyses the logs.

**US4: Keep setup docs working.** *As a new joiner, I want the README setup steps to actually work.*
- The G3 job finds the failing setup step and proposes a README fix.
- Instructions inside the README (including prompt injection) are treated as data. Any attempt to act on them is blocked by policy and recorded in the audit log.

**US5: Stay in control.** *As a tech lead, I want to approve, reject or request changes, and stop everything instantly.*
- Approve merges `autopilot/<jobId>` into `main` (local mode) or marks the draft PR ready (GitHub mode).
- Reject requires a reason and demotes trust.
- Request changes sends feedback to the worker for exactly one more attempt.
- The kill switch (dashboard toggle or `pnpm cli kill`) stops new jobs. Running jobs stop after their current step.

**US6: Earn trust gradually.** *As a tech lead, I want Autopilot to earn autonomy per job type.*
- After N consecutive approved passes (default 3), a job type is promoted one level. Any gate failure or rejection demotes it one level.
- The full history is visible on the Trust page.

**US7: Know what it costs and what it learned.**
- Every model call records model ID, tokens, estimated USD and latency.
- The Overview shows today's AI cost. Job detail shows cost per job.
- After every job, a lesson is written to the database and to `memory/lessons.md`. Lessons are loaded into the next job of the same type.

## 8. Demo success criteria

1. `pnpm demo` starts from a clean state with no API key and no internet. Only Docker, Node and pnpm are needed.
2. The Overview shows G1, G2 and G3 red.
3. G1: the worker bumps, sees tests fail, fixes the call site and sees tests pass. The verifier passes and the gate is all green. After approval, G1 turns green.
4. G2: the classifier says flaky, the re-run passes and a quarantine is proposed. After `pnpm cli seed --real-bug`, the classifier says real bug and a fix is proposed.
5. G3: the README is fixed. The injection line is ignored, and the audit log shows the blocked attempt to write to `main`.
6. `pnpm cli demo-bad-worker`: the policy, the verifier and the gate all block an out-of-scope edit.
7. The Trust page shows a promotion after repeated passes. Lessons and per-job cost are visible.
8. With the kill switch on, new jobs refuse to start.
