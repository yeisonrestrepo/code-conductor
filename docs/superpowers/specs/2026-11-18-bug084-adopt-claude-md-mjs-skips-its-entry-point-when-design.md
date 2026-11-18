# BUG-084: adopt-claude-md.mjs skips its entry point when run through a symlinked directory

**Status:** Draft (pending independent review)

**Item:** `[BUG-084]` (intake of issue #242). Pillar 5: infrastructure, ecosystem and QA.

## Problem

`scripts/adopt-claude-md.mjs:223` decides whether it was launched directly with:

```js
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
```

Node's ESM loader sets `import.meta.url` to the module's realpath, while `process.argv[1]` keeps the path as typed (made absolute, symlinks not resolved). When any directory on the way to the script is a symlink, the two URLs differ, the main block is skipped, and the script exits 0 with empty stdout. The caller sees a silent success with no output.

The macOS default temp dir is such a path (`/var/folders/...` resolves to `/private/var/folders/...`). There, `tests/installer/deploy.test.js` "ships the merge engine so the deployed adopt-claude-md.mjs runs [FEAT-040]" (line 87) spawns the deployed script under `tmpdir()` and fails at line 95 with `SyntaxError: Unexpected end of JSON input`, because `run.stdout` is empty. With `TMPDIR` set to its real path the test passes. The same skip hits a user whose project or home directory is reached through a symlink, since the installer deploys the script to `.claude/scripts/adopt-claude-md.mjs`.

## Solution

Resolve `process.argv[1]` with `fs.realpathSync` before turning it into a file URL, the same rule `bin/code-conductor.mjs:146-157` (`invokedDirectly`) already applies for the same reason. The check moves into a small function, `invokedDirectly()`, that returns `false` when `argv[1]` is absent, falls back to the unresolved path when `realpathSync` throws, and compares `import.meta.url` with `pathToFileURL(resolved).href`. The fix stays inside `scripts/adopt-claude-md.mjs`; no new import is needed beyond the `fs` and `pathToFileURL` it already has (`scripts/adopt-claude-md.mjs:14,16`).

**Choice the entry leaves open: which form of the fix.** The repository has two working forms: `bin/code-conductor.mjs` (realpath with a fallback to the raw path on error) and `scripts/ticket.mjs:278` / `scripts/doc-locations.mjs:191` (realpath inside a `try` that returns `false` on error). This spec takes the `bin/code-conductor.mjs` form. A realpath error on `argv[1]` means the path cannot be resolved, which in practice does not happen for a script Node just loaded; falling back to the raw comparison keeps today's behavior exactly in that case instead of introducing a new "never runs" outcome. Comparing `fileURLToPath(import.meta.url)` against the realpath was rejected: comparing URLs keeps the Windows path handling the current line already gets from `pathToFileURL`.

## Behavior

### Main path

1. A caller runs `node <path>/adopt-claude-md.mjs <verb> ...` where some directory in `<path>` is a symlink (for example under the macOS default `TMPDIR`, or a symlinked home or project directory).
2. `invokedDirectly()` resolves `argv[1]` to its realpath, which now equals the realpath Node used for `import.meta.url`.
3. The main block runs: the verb's output reaches stdout and the exit code is the verb's own (0 on success, 2 on an `AdoptError`), as on a path without symlinks.

### Alternative paths

- **No symlink on the path:** realpath returns the same path; behavior is unchanged.
- **The script file itself is a symlink** (not only a directory above it): Node also loads the realpath of the file, and `realpathSync(argv[1])` resolves the file link too, so the main block runs. Covered by the same fix; not separately tested (see Acceptance Criteria for the reason).
- **Imported as a module** (as `tests/unit/adopt-claude-md.test.js:7` does): `argv[1]` is the test runner's entry, whose realpath is not this module, so the main block stays skipped and importing has no side effects.
- **`argv[1]` absent** (for example `node --input-type=module -e "import(...)"`): `invokedDirectly()` returns `false`; the main block is skipped, as today.

### Error cases

- **`realpathSync(argv[1])` throws:** the raw `argv[1]` is used, so the outcome equals today's comparison. No new error is raised and nothing is printed.
- **A verb fails:** unchanged. `AdoptError` still prints `ERROR: <message>` to stderr and exits 2; any other error is rethrown.

## Acceptance Criteria

- [ ] Run through a path whose directory is reached by a symlink, `node <link-dir>/scripts/adopt-claude-md.mjs sections <file>` prints the same JSON to stdout and exits with the same status as the same command through the real path. Pinned by a new test in `tests/unit/adopt-claude-md.test.js` that builds a temp dir, makes a directory link to a copy of the script's layout (or to the repository's `scripts/` and `lib/` parents, whichever the plan finds simplest), runs `sections` through the link, and asserts exit 0 and parseable JSON with the expected `trigger`. This answers the entry's "Expected": the check holds whether or not the script's directory is reached through a symlink.
- [ ] The test creates the link with `symlinkSync(target, link, 'junction')`. On POSIX the type argument is ignored; on Windows a junction needs no elevation, so the test needs no `CAN_SYMLINK` skip and does not change the skipped-test set in `tools/skip-baseline.json` on any CI leg.
- [ ] The test fails against the current line 223 (empty stdout, so the JSON assertion fails) and passes with the fix. The plan records this red-then-green check.
- [ ] Importing `scripts/adopt-claude-md.mjs` as a module still does not run its main block: the existing `tests/unit/adopt-claude-md.test.js` suite passes unchanged.
- [ ] `tests/installer/deploy.test.js` "ships the merge engine so the deployed adopt-claude-md.mjs runs [FEAT-040]" passes unchanged; on macOS with the default `TMPDIR` it now passes too (the issue's reproduction). No change to that test is needed.
- [ ] `npm test` exits 0.

## Out of Scope

- **Other scripts with the same unresolved comparison.** `scripts/detect-stack.mjs:698`, `scripts/init-wizard.mjs:195` and `scripts/session-metrics.mjs:387` compare `argv[1]` with the unresolved module path and share this failure mode. The entry names only `adopt-claude-md.mjs`; per CONTRIBUTING ("Do not expand scope"), these are reported for separate intake, not fixed here.
- **A shared helper for the entry-point check.** Four scripts already carry their own copy; extracting one is a refactor no entry asks for.
- **The `[BUG-084]` line under "Known limits" in `README.md:511`.** It is an owner-side record and is removed at release, not by this change.
- **Changes to `tests/installer/deploy.test.js`** or to the `TMPDIR` the suite uses.

## System Impact

- `scripts/adopt-claude-md.mjs`: line 223 replaced by a call to a new `invokedDirectly()` function placed just above it; the `fs` import already present supplies `realpathSync`. Not a protected surface (not a hook, the installer, a SNAP script or a settings file).
- Deployed copies: `lib/installer/deploy.mjs:287` copies `scripts/` into a project's `.claude/scripts/`, so installed projects get the fix on their next install or upgrade; no installer change.
- `tests/unit/adopt-claude-md.test.js`: one new test (and the `symlinkSync` import it needs).
- Callers grepped: `tests/installer/deploy.test.js`, `tests/unit/adopt-claude-md.test.js`, `lib/installer/deploy.mjs`. None depends on the main block being skipped from a symlinked path.

### Files Requiring Full Read (deferred to /cc-plan)

- `tests/unit/adopt-claude-md.test.js`: the fixture setup (`beforeEach`/`afterEach`, temp dirs, the `sections` input that yields `trigger: true`) is needed to place the new test and reuse its fixture; it was not read past its imports.

## Complexity Estimate

S: a one-line condition becomes a six-line function that mirrors an existing one in the repository, plus one test.
