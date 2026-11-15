# Runbook: dependency upgrades

When a dependency has a security advisory, bump it to the fixed version and nothing else.

## Before you start
- Confirm the fixed version actually exists in the package source. Never invent a version number.
- Read the fixed version's exports. Major-version bumps often rename or remove functions.

## Procedure
1. Change only the one vulnerable dependency in package.json to the fixed version.
2. Run the test suite immediately after the bump.
3. If a test now fails, the public API probably changed. Read the failing test, find the renamed export, and update the call site to the new name.
4. Re-run the tests and stop when there are no new failures versus main.

## Common pitfalls
- Changing unrelated dependencies "while you are here". Don't.
- Editing the package.json scripts section — that is high-risk and always needs a human.
