# BUG-060: The Installer Rejects a Supported Node Under npx on Windows

**Status:** APPROVED 2026-10-20. **Target:** a patch release, which the owner cuts. **Approach:** 1 of 3 (owner-chosen 2026-10-20).

## Problem

On Windows, `npx @yeison.restrepo.r/code-conductor` refuses to install on Node 22.20.0 with `code-conductor: Node >=20 required, found C:\...\node.exe`.

`run()` checks the runtime floor with `nodeMajorAtLeast(20, env.node)` (`bin/code-conductor.mjs:60`), where `env` defaults to `process.env`. The `env.node` key exists so a test can inject a version (`tests/installer/cli.test.js:93`). On Windows, `process.env` lookups are case-insensitive, and npm sets `NODE` to node.exe's path for every `npx` and lifecycle run. So `env.node` returns that path, `parseInt` gets `NaN`, and the check refuses. The error message at `:61` prints the same path as the "found" version.

Every Windows `npx` install fails. The owner's field report (2026-10-15) got past it only by running `Remove-Item Env:NODE` and invoking the script directly. POSIX never shows it, because `NODE` and `node` are distinct names there, and the tests pass plain objects, which are case-sensitive.

## Solution

The version under test moves out of the environment and into `run()`'s options bag, beside the existing `cwd` and `log` injections: `run(argv, env = process.env, { cwd = process.cwd(), log, nodeVersion = process.versions.node } = {})`. The floor check and its message both use `nodeVersion`. `run()` no longer reads any environment key to decide the version, so no variable in any case or on any platform can affect the check. The existing refusal test moves to `{ nodeVersion: '18.19.1' }`.

## Behavior

### Main path

1. `npx` or a direct `node bin/code-conductor.mjs` runs `run(process.argv.slice(2))` (`:140`), with no options.
2. `nodeVersion` defaults to `process.versions.node`, for example `22.20.0`.
3. `nodeMajorAtLeast(20, '22.20.0')` returns true, and the install proceeds. An inherited `NODE=C:\...\node.exe` is never read.

### Alternative paths

- **Node exactly at the floor:** `nodeVersion` `20.0.0` passes.
- **POSIX with a lowercase `node` variable set:** it is ignored, the same as on Windows.
- **A test injects a version:** it passes `{ nodeVersion }` as the third argument. The `env` argument is left for `HOME`, `USERPROFILE` and the other keys `resolveHome` reads.

### Error cases

- **Node below the floor (for example `19.9.0` or `18.19.1`):** exit 1, with stderr `code-conductor: Node >=20 required, found 18.19.1`. Nothing is written under home.
- **A `nodeVersion` that does not parse (empty or not numeric):** `nodeMajorAtLeast` returns false (`lib/installer/env.mjs:32-35`), and the installer refuses with exit 1 and prints the value it received. This keeps the current fail-closed behavior.

## Acceptance Criteria

- [ ] AC1: with a supported runtime, `run()` does not emit the `Node >=20` refusal for either `{ HOME: home, node: 'C:\\Program Files\\nodejs\\node.exe' }` or `{ HOME: home, NODE: 'C:\\Program Files\\nodejs\\node.exe' }`. A plain object is case-sensitive, so the lowercase `node` case stands in for the Windows alias on every platform and is red before the fix. The uppercase `NODE` case is a regression guard that passes both before and after.
- [ ] AC2: `run([], { HOME: home }, { cwd, log, nodeVersion: '18.19.1' })` exits 1, its stderr matches `/Node >=20 required, found 18\.19\.1/`, and `<home>/.claude` does not exist. This is the moved `cli.test.js:93` case.
- [ ] AC3: `run([], { HOME: home, node: '18.19.1' }, { cwd, log })` does not refuse on a supported runtime. The environment is no longer an injection point.
- [ ] AC4: `nodeVersion: '20.0.0'` passes the floor.
- [ ] AC5: `bin/code-conductor.mjs` contains no `env.node`. A grep is the check.
- [ ] AC6: the full suite passes.

## Out of Scope

- The release and its records. Release stays human, by `docs/RELEASE-CLOSEOUT.md`. That covers the version bump in `VERSION`, `package.json` and `package-lock.json`, the `CHANGELOG.md` entry, the backlog heading flip and DONE bullet, the README "Known limits" removal, and the `project.md` closeout.
- `[BUG-061]` (the cwd-relative PreToolUse hook command) and `[BUG-058]` (the suite on Windows, and a Windows CI leg).
- Any other environment-key audit. The only lowercase key the installer reads from the real environment is `env.node`, verified by grep over `lib`, `bin` and `scripts` on 2026-10-20. The `env.v` and `env.ops` hits in `scripts/orchestrate.mjs` are envelope objects.
- Changing `nodeMajorAtLeast` or the floor value.
- The `~/.claude/CLAUDE.md` duplicate-section observation from the same field report. That belongs to `[FEAT-040]`.

## System Impact

- `bin/code-conductor.mjs:55-62`: the `run()` signature and the floor check.
- `tests/installer/cli.test.js:92-97`: the moved refusal test, plus AC1, AC3 and AC4.
- Callers of `run()`: only `:140` (no options) and the tests. The new key is optional and defaults, so no other caller changes.
- No release record files. The implementation touches only the two files above.

### Files Requiring Full Read (deferred to /cc-plan)

_None. The change is contained in `run()`'s first eight lines, which were read along with the one test that exercises them._

## Complexity Estimate

S: one signature default and one check change in a single function, plus four small tests in an existing suite.