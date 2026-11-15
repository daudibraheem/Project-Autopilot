# Runbook: flaky tests

A flaky test fails intermittently without a code change. A real bug fails deterministically.

## Telling them apart
- Look at the historical failure rate and whether a plain re-run passes.
- Timeouts, socket resets and "connection reset" against an external service are usually flaky.
- Assertion failures on computed values that reproduce on re-run are usually real bugs.

## If flaky
1. Quarantine the single failing test: mark it skipped with a reason that names the tracking job.
2. Never delete the test. Confirm the suite is green with it skipped.

## If a real bug
1. Find the cause commit (the newest commit whose parent still passes the failing test).
2. Read its diff, then restore the previous correct behaviour in the source file.
3. Prefer the smallest revert over rewriting the test. Re-run to confirm.
