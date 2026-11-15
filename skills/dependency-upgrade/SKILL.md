<!--
skill: dependency-upgrade
version: 1
jobType: dependency-security-fix
-->
# Skill: dependency upgrade (security)

Use this when a dependency has a critical advisory and must be bumped to a fixed version.

## Steps
1. Read `package.json` to find the vulnerable dependency and how it is specified.
2. Confirm the fixed version exists in the package source before changing anything (the harness enforces this; do not invent versions).
3. Bump only the vulnerable dependency to the fixed version. Change nothing else.
4. Run the tests. A major bump can rename or remove exports.
5. If the bump broke a call site, read the failing test and the module it exercises, then update the call site to the new API. Re-run the tests.
6. Stop when there are no new failures versus main.

## Output template
Bumped `<pkg>` from `<old>` to `<new>` (fixes `<advisory>`). API change: `<old-export>` → `<new-export>`; updated `<file>`. Files changed: `<list>`. run_tests: `<pass>/<total>`, `<n>` new failures.
