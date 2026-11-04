# Presentation outline: Project Autopilot

About 25 minutes: 10 slides plus a live demo (about 10 minutes).

---

## 1. The problem: background rot

- Three things every team has right now:
  - a critical advisory open for 3 weeks;
  - a flaky test everyone re-runs;
  - a README setup step that broke when a script was renamed.
- None of it is hard. It just never beats feature work.
- **Metric:** hours per week each goal spends "broken".

## 2. Five framing questions

| Question | Our answer |
|---|---|
| Who is the user? | Developers and the tech lead of one project |
| What does success look like? | Fewer hours per week with a red goal |
| What does a wrong answer cost? | A bad change merged into main |
| Where must a human decide? | Every merge at trust level 0–1 |
| What is out of scope? | Multi-repo, production scale, months of real data |

## 3. Architecture

- One pipeline:
  - goal check (code);
  - conductor (contract + budget);
  - worker (AI in a sandbox);
  - verifier (a different AI);
  - gate (code);
  - human;
  - merge;
  - trust and lessons.
- Show the Mermaid diagram from `docs/ARCHITECTURE.md`.
- **Agent = Model + Harness.** The model is swappable (mock, Anthropic, OpenAI). The harness (loop, tools, policy, sandbox, budgets) is where the safety lives.

## 4. The 8 building blocks (and where they live)

| Block | Where |
|---|---|
| Constitution | `AGENTS.md`, enforced in `policy.ts` |
| Contracts | Zod: allowed/forbidden paths, budgets, done criteria |
| Workers | Bounded plan → act → observe → reflect loop |
| Verifiers | A different model, plus the plain-code gate |
| Trust ledger | L0 → L2 per job type, promotion and demotion |
| Standing goals | G1–G3, pg-boss cron |
| Budget router | Cheap model for easy work; cost logged per call |
| Improvement loops | Lessons, trust, classifier retraining |

## 5. Safety: defence in depth

- **Never let AI grade its own homework:** a different model verifies, code decides, a human merges.
- The **policy is code**, not a prompt:
  - outside-path writes are blocked;
  - high-risk paths are blocked;
  - `main` is blocked;
  - unknown dependencies are blocked (slopsquatting).
- **Untrusted data:** file contents and logs are wrapped and flagged. The README injection line is blocked and audited.
- **Sandbox:** Docker with `--network none`, CPU/memory/time limits.
- **Kill switch** and **budgets** are hard stops.
- **Audit log** of every action and denial.

## 6. ML where ML fits

- Is a failing test flaky or real? Logistic regression in TypeScript, trained on 300 CI runs.
- **Features:**
  - historical failure rate;
  - re-run result;
  - files changed;
  - whether the test file was touched;
  - time of day.
- **Why not an LLM:** high volume, needs consistent answers, costs $0.
- The LLM is only used in the uncertain band (0.3–0.7).
- Precision and recall are measured on a held-out split.

## 7. Evals and tests

- **Vitest:**
  - policy;
  - each gate failure type;
  - trust promotion and demotion;
  - the classifier;
  - budget hard-stop;
  - kill switch;
  - injection never reaches main;
  - verifier model ≠ worker model.
- **Verifier evals:** 10 cases, including 3 planted bad outputs: out-of-scope edit, unsupported claim, followed injection.
  - Mock runner in CI (`pnpm eval`).
  - promptfoo against real models (`pnpm eval:promptfoo`).

## 8. Live demo

Follow `docs/DEMO_SCRIPT.md`:
1. G1 bump plus call-site fix, then approve: green.
2. G2 flaky quarantine; then a real bug with its cause commit.
3. G3 README fix; the injected push is blocked and audited.
4. Bad worker caught by policy, verifier and gate.
5. Trust promotion, lessons, cost.
6. Kill switch.

## 9. Limitations (honest)

- Mock mode is scripted. It proves the harness, not model quality. Run the evals with real keys to measure the model.
- Synthetic CI history, a single repo, a single worker process. No auth on the dashboard (localhost only).
- The local sandbox fallback is unsafe by design and clearly labelled.
- G3 can only fix docs. The worker cannot run arbitrary setup commands (allow-list only).
- Trust is per job type, not per path or per risk level.

## 10. Next steps

- Real CI integration (GitHub Actions run history) to replace the synthetic CSV.
- More goals: dependency freshness, type-check debt, dead feature flags.
- Per-path trust and a richer risk model.
- A real model behind the verifier, and evals tracked over time.
- Multi-repo conductor with fair budget allocation.
