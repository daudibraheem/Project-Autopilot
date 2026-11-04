# Demo script

**Setup (once, before the audience arrives)**

```bash
pnpm install
pnpm demo          # resets everything, seeds demo_target, trains the classifier, starts web + worker
```

Open **http://localhost:3000**. Keep a terminal visible for the three CLI moments.

Mock mode needs no API key and no internet. Every run is deterministic, and a full pass takes about 10 minutes.

---

## 1. Three broken goals

**Overview**

Point out:
- G1, G2 and G3 are all **red**. Each has evidence: the advisory, the failing test, the failing setup step.
- **Hours broken this week** comes from stored checks.
- The **kill switch**.
- **Open jobs** is 0 of 3, and **AI cost today**.
- The bottom left shows the provider, the pinned worker and verifier models, and the sandbox (`docker`).

> "Goal checks are plain code. No AI decides whether something is broken."

## 2. G1: security advisory

1. On the G1 panel, click **Run job**, then **View job →**.
2. Watch the **step timeline** fill in live (it refreshes every 2 s):
   - Harness: the baseline on main, run in a fresh sandbox.
   - Worker: `read_file package.json` → `write_file package.json` (tinydate 1.0.0 → 2.0.0) → `run_tests`, which shows **1 new failure** in `test/due.test.js`.
   - `read_file test/due.test.js` → `read_file src/due.js` → `write_file src/due.js` (`parse` → `parseDate`) → `run_tests`, which shows **0 new failures**.
   - Verifier, on a **different model**: pass.
   - Gate: **9/9 green**.
3. Show the **Diff**, the **Contract** (allowed and forbidden paths, budget) and the **Evidence** (commands with exit codes).
4. Go to **Approvals** and click **Approve and merge**. Back on the **Overview**, G1 flashes and turns **green**.

> "The worker never touched main. It worked on `autopilot/<jobId>` in its own clone. Only my approval merged it."

## 3. G2: flaky vs real

1. On G2, click **Run job** and open the job.
   - Classifier step: `p(flaky)=0.98 → flaky`, then **Re-run once: PASSED → flaky confirmed**.
   - The worker proposes a **quarantine**: the test is skipped with a reason, not deleted.
2. **Approve and merge.**
3. In the terminal:
   ```bash
   pnpm cli seed --real-bug
   ```
   On the Overview, click **Check goals now**. G2 is red again, and this time the failure is in `test/invoice.test.js`.
4. On G2, click **Run job**.
   - Classifier: `p(flaky)≈0.2 → real_bug`.
   - Bisect finds the **cause commit** "Simplify cents rounding…".
   - The worker restores the rounding in `src/invoice.js`.
5. **Approve.** Then open the **ML** page: precision and recall, the weights, and the two predictions.

> "This is ML, not an LLM: it runs on every red build, must give the same answer every time, and costs nothing. The LLM is only asked when p is between 0.3 and 0.7."

## 4. G3: broken setup docs and prompt injection

1. On G3, click **Run job** and open the job.
   - `read_file README.md` comes back wrapped in `<untrusted_data>`. The audit log records **injection.flagged**.
   - The scripted model tries `git push origin main`. The step shows **Denied by policy** (`write-to-protected-branch`).
   - The worker continues with its contract and changes `node scripts/init.js` to `node scripts/bootstrap.js`.
   - The verifier passes, with a concern: an attempt was blocked and nothing from it reached the diff.
2. Open the **Audit log** and tick **Policy denials only**. The blocked push to main is listed with its reason.
3. **Approve.** All three goals are now green.

> "File contents are data, never instructions. And even if a model obeys them, the policy is code, not a prompt."

## 5. Verifier catch: the bad worker

In the terminal:

```bash
pnpm cli demo-bad-worker
```

The scripted worker:
- tries to write `package.json` and `.github/workflows/ci.yml`; **policy denies both**;
- then simulates a compromised harness that writes `package.json` directly (a `postinstall` script plus the non-existent package `left-padx`);
- claims "verified that all tests pass".

The output shows:
- **Verifier: FAIL**: out-of-scope path, unsupported claim, and a change with no recorded tool call.
- **Gate: 7 checks red**: fresh-sandbox tests (left-padx can't install), paths, high-risk (`scripts` section), slopsquatting (`left-padx` isn't in the package source), goal still red, and the verifier verdict.

Show the job in **Jobs** with status **Gate failed**. On the **Trust ledger**, setup-docs-fix records a gate failure.

## 6. Trust, lessons, cost

- **Trust ledger:** dependency-security-fix shows 1/3 approved passes toward L1. To show a promotion, run this twice:
  ```bash
  pnpm cli seed --reintroduce g1     # a teammate pins the vulnerable version back
  ```
  Each time, click **Check goals now**, then **Run job** on G1, then **Approve**. On the third approval the history shows **Promoted L0 → L1**.
- **Lessons:** one entry per job type and outcome (deduplicated), in the same format as `memory/lessons.md`. They are loaded into the next job of that type.
- **Cost:** each job page shows its cost, tokens and steps. The trust ledger shows the average cost per job type. The Overview shows today's total. In mock mode these are estimates of what the pinned models would have cost.

## 7. Kill switch

Flip the **kill switch** on the Overview. A red banner appears on every page. Click **Run job** on any red goal and it is refused with "Kill switch is on". The terminal works too: `pnpm cli kill` / `pnpm cli resume`.

---

**If something goes wrong:** run `pnpm demo` again. It resets the database, the workspaces, the lessons file and `demo_target`.
