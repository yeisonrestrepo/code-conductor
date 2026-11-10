# Spec: isolate the pre-tool-use contract harness from the checkout's live run (issue #118)

**Status:** Draft, awaiting owner approval

Candidate id: pending owner intake (no BUG id minted). Produced by an AI agent on a contributor's behalf.

## Problem

`tests/hooks/pre-tool-use-contract.test.js` spawns the hook with `cwd: REPO_ROOT`. The hook finds Guard 6's run file by walking up from cwd, so it reads this checkout's own `.claude/memory/orchestrator-run.json`. While a `/cc-orchestrate` run is live, Guard 6 adds a `systemMessage` (`ORCH_RUN_STALE`) and the case `allows a Write to a path that does not exist` fails with `expected undefined to be null`. Measured: `1 failed | 23 passed (24)` with a run present, `24 passed` without one.

The same cwd also roots the Guard 3 allowlist (`CLAUDE_PROJECT_DIR` is already deleted by the harness), so an operator's local `bash-scan-allowlist.txt` can reach the Guard 3 cases too.

## Solution

`fire()` spawns the hook with `cwd` set to the per-test temp directory `dir` that `beforeEach` already creates and `afterEach` already removes. The suite then sees no run file and no allowlist, whatever the checkout holds.

**Design choice named:** the issue's candidate also copies the hook into the temp root. This spec does not copy it. The hook imports only `node:` modules and derives every root from cwd (or `CLAUDE_PROJECT_DIR`, which the harness deletes), never from its own location, so a copy changes nothing the tests observe. Guard suites 5, 6 and 7 use the same pattern: the repository hook, run from a temp cwd.

The Write case also asserts `stdout === ''`, so any Guard 6 warning that reaches the harness fails it by name rather than as `undefined`.

## Acceptance criteria

- [ ] **AC1.** With a live run in the checkout, `npx vitest run tests/hooks/pre-tool-use-contract.test.js` passes 24/24.
- [ ] **AC2.** With no run in the checkout, the same command passes 24/24.
- [ ] **AC3.** Only `tests/hooks/pre-tool-use-contract.test.js` changes in code; the hook is untouched.
- [ ] **AC4.** The full suite passes locally; no skip-baseline change.

## Out of scope

Hook behavior, other suites, and any temp root whose own ancestors hold a run file.
