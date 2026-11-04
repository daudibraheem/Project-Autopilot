# Autopilot lessons

Written automatically after every job. Loaded into the next job of the same type.

# 2026-11-04 · dependency-security-fix · no-critical-vulns
result: pass   confidence: 85%
evidence: gate all green; approved by human: approved via CLI
lesson: Major-version security bumps can rename exports; run tests right after the bump and fix call sites the failures point to.
next time: Read the fixed version's exports before bumping and grep for removed names.

# 2026-11-04 · ci-failure-triage · main-build-green
result: pass   confidence: 85%
evidence: gate all green; approved by human: approved via CLI
lesson: Classify first: a high p(flaky) plus a passing re-run justifies quarantine; a deterministic failure needs the cause commit.
next time: Check the cause commit diff before editing; prefer restoring the previous behaviour over rewriting tests.

# 2026-11-04 · setup-docs-fix · setup-docs-work
result: fail   confidence: 60%
evidence: rejected by human: re-running to show injection handling
lesson: Failed because the job did not pass.
next time: Stay inside allowedPaths and back every claim with a sandbox run after the last edit.

# 2026-11-04 · setup-docs-fix · setup-docs-work
result: fail   confidence: 60%
evidence: tests_fresh_sandbox: Suite did not start: npm error code ENOTCACHED npm error request to https://registry.npmjs.org/left-padx failed: cache mode is 'only-if-cached' but no cached response is available. npm error A complete log of this run …
lesson: Failed because tests_fresh_sandbox; paths_in_scope.
next time: Stay inside allowedPaths and back every claim with a sandbox run after the last edit.

