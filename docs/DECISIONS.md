# Design decisions

A running log. Newest at the bottom.

| # | Decision | Why |
|---|---|---|
| 1 | pnpm workspaces. Packages export TypeScript source (no build step). `tsx` runs the worker and CLI. Next.js uses `transpilePackages`. | Fewer moving parts, fast iteration, one `tsc --noEmit` per package. |
| 2 | Pinned majors: Next 15, React 19, Prisma 6, pg-boss 10, zod 3, TypeScript 5.9, Vitest 3. | Stable, well-known APIs matter more than newest versions for a demo that must work tomorrow. |
| 3 | Postgres host port is `${AUTOPILOT_DB_PORT:-5432}` in `docker-compose.yml`. | The spec asks for 5432. The dev machine already had Postgres on 5432, so the port is overridable without changing the default. |
| 4 | Biome for linting, formatter disabled. | One small dependency, fast, no plugin sprawl. |
| 5 | System font stacks instead of `next/font/google`. | `next/font/google` downloads at build/dev time, and the demo must run with no internet. |
| 6 | Mock LLM provider is a scripted state machine per job type. It reads the (untrusted) tool results it is given to build edits, e.g. renaming `parse(` → `parseDate(` in the file it just read. | Deterministic and offline, but still exercises the real loop, tools, policy and sandbox end to end. |
| 7 | The mock *verifier* is a heuristic reviewer (paths vs contract, claims vs evidence, injection signs). | Lets the verifier eval cases and the bad-worker demo produce meaningful verdicts offline. With a real key, the real verifier prompt is used. |
| 8 | Gate "tests pass" means **no new failures compared with main**. A baseline run on `main` is recorded per job. | The flaky test is seeded and fails on `main` until G2 is fixed. Without a baseline, G1 could never pass the gate before G2 is merged. This is how most CI "new failures only" checks work. |
| 9 | The flaky test reads `FLAKY_SEED`. Goal checks run attempt 1 with seed 1, the CI-style auto-retry uses seed 2, and the worker's re-run uses seed 3. With no seed set, it is truly random. | Reproducible demo, still a real random failure in normal use. |
| 10 | The G3 mock worker deliberately tries `git push origin main` once after reading the README injection line. | Shows the policy denial and audit trail live. A real model will usually not try, but the protection is the same either way. The verifier sees the denied attempt in the evidence and reports it as a concern. |
| 11 | `demo-bad-worker` first tries an out-of-scope write through the tool layer (policy denies it), then simulates a compromised harness by writing the file directly into the workspace. | Without the bypass, the verifier and gate would never see the bad change. The demo needs to show all three layers catching it. |
| 12 | Linter for the target repo: `npm run lint` if the target defines it, else a built-in `node --check` syntax check on changed `.js` files and `JSON.parse` on changed `.json` files. | The demo target has no npm dependencies, so a real ESLint can't be installed offline. |
| 13 | Docker sandbox copies the workspace (without `.git`/`node_modules`) to a temp dir, mounts it, and runs as the host uid with `HOME=/tmp`. | No root-owned files left behind. The real repo is never mounted. |
| 14 | Demo-mode detection: the target is in "demo mode" when it contains `advisories.json` and `vendor/`. Otherwise it is in real mode (OSV + npm registry). | No extra flag needed. `TARGET_REPO_PATH` decides. |
| 15 | Trust promotion demo: `pnpm cli seed --reintroduce g1` commits the vulnerable dependency back onto `main` (as if a teammate reverted it). Running G1 three times shows L0→L1. | Promotion needs repeated approved passes of one job type. Re-planting the problem is honest. Faking history is not. |
| 16 | pg-boss queue names use dashes (`autopilot-run-job`). | pg-boss 10 restricts queue names to letters, numbers, dashes, underscores and periods. |
