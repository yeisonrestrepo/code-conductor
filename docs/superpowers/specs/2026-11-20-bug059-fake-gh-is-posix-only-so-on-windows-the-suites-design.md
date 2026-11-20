# BUG-059 (re-dispatch): The Fake gh Is POSIX-Only — Verification That the Fix on `main` Meets the Entry

**Status:** Approved 2026-11-20 by independent review (round 1)

**Base:** `origin/main` at `3b23689`. **Prior work:** spec `docs/superpowers/specs/2026-10-22-bug059-fake-gh-win32-design.md`, plan `docs/superpowers/plans/2026-10-22-bug059-fake-gh-win32.md`, fix commits `8a943ad` and `88a9076`, merged in `25e29e8` (PR #87, 2026-10-24). `git merge-base --is-ancestor 25e29e8 HEAD` succeeds.

## Problem

The backlog entry `[BUG-059]` is still an open checkbox, and the README Known limits still lists it as open (`README.md:499`), so the item was dispatched again. The code it asks for is already on `main`:

- `tests/helpers/fake-gh.js` no longer writes a `#!/bin/sh` file or touches `PATH`. It returns an env that adds `--import=<file URL of tests/helpers/gh-intercept.mjs>` to `NODE_OPTIONS` and points `FAKE_GH_STATE`/`FAKE_GH_LOG` at a temp state.
- `tests/helpers/gh-intercept.mjs` wraps `spawn`, `spawnSync`, `execFile` and `execFileSync`. A call whose file is `gh` or `gh.exe` (any directory, any case) runs `tests/helpers/fake-gh-cli.mjs` under the current `node` when `FAKE_GH_STATE` is set. When it is not set, the process writes `CC_REAL_GH_BLOCKED: …` to stderr and exits 97 before any spawn.
- `tests/helpers/gh-guard.js` is the vitest `setupFiles` entry (`vitest.config.js:8`). It arms the intercept in every worker, exports the hook through `NODE_OPTIONS` so every node child and grandchild inherits it, deletes the four gh token variables and points `GH_CONFIG_DIR` at an empty directory. That empty config covers any path the preload cannot see, such as a shell string.
- `tests/unit/gh-guard.test.js` pins both halves of the entry under `[BUG-059]` titles.
- The `windows-latest` leg exists (`.github/workflows/test.yml:25`), so the entry's ordering clause ("lands with or before `[BUG-058]` activates the Windows CI leg") was met.

What is missing is only the records: the backlog checkbox and DONE line, the README Known limits line, and a `CHANGELOG.md` entry (`grep BUG-059 CHANGELOG.md` finds nothing). Under the repository's rules all three belong to the release, not to an item branch.

## Solution

No code change. This spec maps each acceptance criterion of the entry to code and tests that already exist on `main`, and re-runs those tests on this branch. It hands the record updates to the release. The plan that follows has one verification task and no edit task. The build commits nothing beyond the spec and plan unless the verification turns red. A red run would mean a regression since `25e29e8`; the build then stops and reports it, and that becomes a new spec, not a silent fix here.

Choice made where the entry leaves one open: the entry allows "a `.cmd`/`.bat` shim or a Node-based shim". `main` took the Node-based route, a preload, not a file on `PATH`. The prior spec gives the reason: libuv's `spawnSync('gh')` without a shell runs neither an extensionless script nor a `.cmd`, so no file on `PATH` can win over `gh.exe`. That choice stands, and this spec does not reopen it.

Measured during this spec on Linux at `3b23689`: `npx vitest run tests/unit/gh-guard.test.js tests/scripts/ticket.test.js tests/scripts/orchestrate.test.js` gives `Test Files 3 passed (3)`, `Tests 1193 passed (1193)`, and `grep -rn "bin/sh" tests/helpers/` finds nothing.

## Behavior

### Main path
1. A test calls `fakeGh(state)` and spawns `scripts/ticket.mjs` with `gh.env()`.
2. The child loads `gh-intercept.mjs` through `NODE_OPTIONS`. `ticket.mjs:70` calls `spawnSync('gh', args)`, which runs `fake-gh-cli.mjs` under the same `node`, so it behaves the same on Linux, macOS and Windows.
3. The fake records argv in `FAKE_GH_LOG`, and the test reads it with `gh.calls()`.

### Alternative paths
- A test names gh by absolute path (`C:/Program Files/GitHub CLI/gh.exe`): the basename still matches, so the call takes the same route.
- A node grandchild: it inherits `NODE_OPTIONS`, so it gets the same intercept.
- `ticket.test.js:306` deliberately runs with an empty `PATH` and without the guard. The empty `PATH` is what keeps the real gh out of that test. The prior spec approved this opt-out.

### Error cases
- A test path reaches gh with no fake: exit 97, stderr starts with `CC_REAL_GH_BLOCKED: `, and nothing is spawned.
- A path the preload cannot intercept (a shell string, a non-node script): it meets a gh with no token and an empty config, so gh exits 4 ("gh auth login") before any request.

## Acceptance Criteria

From the entry. Each one is met on `main` and re-verified on this branch by the named test:

- [ ] AC1 (fake resolves on win32, hermetic): `tests/unit/gh-guard.test.js` "routes a gh call to the fake through fakeGh().env(), leaving PATH alone" passes. So do `tests/scripts/ticket.test.js` and `tests/scripts/orchestrate.test.js`, with every gh call served by the fake. Their win32 run is covered by the `ci-windows-node24` leg, and the original Windows measurement is in the prior spec's AC1.
- [ ] AC2 (fail-fast, child): "kills a node child that names gh without a fake, with a named error" passes (exit 97, `CC_REAL_GH_BLOCKED: `, empty stdout).
- [ ] AC3 (fail-fast, depth): "kills a node grandchild too, because NODE_OPTIONS is inherited" passes.
- [ ] AC4 (fail-fast, in process, by name and by `.exe` path): "blocks gh in the test worker itself, by name and by an .exe path" passes.
- [ ] AC5 (suspenders): "strands any path the preload cannot see with no gh credentials" passes.
- [ ] AC6 (every platform): no `[BUG-059]` test carries a platform skip (`grep -n "skipIf\|platform" tests/unit/gh-guard.test.js` is empty), and `tests/helpers/` holds no `#!/bin/sh` writer.
- [ ] AC7: `npm test` is green on this branch with no change under `tests/`, `scripts/` or `vitest.config.js` (`git diff --stat origin/main -- tests scripts vitest.config.js` is empty).

## Out of Scope

- Any code change to the fake, the intercept or the guard. They are on `main` and approved.
- The records: ticking `[BUG-059]` and its DONE line in `AGENT-READABLE BACKLOG.md`, removing the `[BUG-059]` line from the README Known limits (`README.md:499`), and the `CHANGELOG.md` entry. These belong to the release.
- `[BUG-058]` and the other Windows causes it tracks.
- Intercepting gh calls made through a shell string. The empty-config suspenders cover them, as the prior spec decided.

## System Impact

- Files changed by this item: this spec, its plan, and their two leaf lines in `.gitignore`. Nothing else.
- Reviewed, not changed: `tests/helpers/fake-gh.js`, `tests/helpers/gh-intercept.mjs`, `tests/helpers/gh-guard.js`, `tests/helpers/fake-gh-cli.mjs`, `tests/unit/gh-guard.test.js`, `vitest.config.js:8`, `scripts/ticket.mjs:70`, `.github/workflows/test.yml:25`.
- Risk: none at runtime. The only open effect is that the README still warns Windows users until the release updates the records.

### Files Requiring Full Read (deferred to /cc-plan)

None.

## Complexity Estimate

**XS.** One verification run and no code. The only work left after this item is the release's record update.
