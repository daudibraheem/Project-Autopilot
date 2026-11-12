<!--
skill: flaky-test-quarantine
version: 1
jobType: ci-failure-triage
-->
# Skill: flaky-test triage and quarantine

Use this when a test on main is failing and the classifier has triaged it.

## Steps
1. Read the triage: `decision` (flaky or real_bug), `p(flaky)`, the failing test, and (for a real bug) the cause commit.
2. If **flaky** (high p(flaky), passed on re-run): read the test file and quarantine it — mark the single failing test `skip` with a reason that names this job. Never delete the test. Confirm the suite is green with it skipped.
3. If **real_bug** (deterministic, re-run also failed): read the cause commit's diff, read the changed source file, and restore the previous correct behaviour. Prefer the smallest revert over rewriting tests. Re-run to confirm.
4. Stop when there are no new failures versus main.

## Output template
`<flaky|real bug>`: "`<test>`" (`<file>`). Classifier p(flaky)=`<p>`. `<quarantined with reason | restored behaviour from cause commit <sha>>`. Files changed: `<list>`. run_tests: `<pass>/<total>`.
