# BUG-058 (re-dispatch): The Test Suite Does Not Pass on Windows — Verification That the Fix on `main` Meets the Entry

**Status:** Draft (pending independent review)

**Base:** `origin/main` at `a8c584c`. **Prior work:** spec `docs/superpowers/specs/2026-10-22-bug058-windows-suite-design.md`, plan `docs/superpowers/plans/2026-10-22-bug058-windows-suite.md`, fix commits `18ddaf8` through `f16f207`, merged in `8d0be53` (PR #90, 2026-10-24). `git merge-base --is-ancestor 8d0be53 HEAD` succeeds.

## Problem

The backlog entry `[BUG-058]` is still an open checkbox, and the README Known limits still lists it as open (`README.md:498`), so the item was dispatched again. `grep -c BUG-058 CHANGELOG.md` gives 0. The code the entry asks for has been on `main` since PR #90, and every cause it names is still fixed at `a8c584c`:

| # | Cause in the entry | Fixed on `main` by | Still present at `a8c584c` |
|---|---|---|---|
| 1 | `.gitattributes` sets EOL only for `*.sh`/`*.ps1` | `18ddaf8`: `* text=auto eol=lf` as the first line, keeping `*.sh text eol=lf` and `*.ps1 text eol=crlf` | `.gitattributes:1-3`. `git ls-files --eol` finds no `i/crlf` entry, so a checkout with `autocrlf=true` gets LF for every non-`.ps1` text file |
| 2 | `--import` gets a Windows path | `215bae5`: `BLOCK = new URL('./fixtures/block-sqlite.mjs', import.meta.url).href` | `tests/scripts/conductor-db.test.js:327`, `:705` (the call sites are now `:331`, `:710`, `:718`) |
| 3 | Symlinks created without a privilege check | `f67b265`: `tests/helpers/can-symlink.js` probes (`CAN_SYMLINK`, line 13), and directory links use `'junction'` | `deploy`, `file-merge` and `settings-merge` import the probe. The later `tests/unit/adopt-claude-md.test.js:279` (FEAT-040) also uses `'junction'` |
| 4 | `chmod`-based read-only fixtures | `db20bbb`, `215bae5`: named win32 skips | `handoff-cycle.test.js:99` and `conductor-db.test.js:374` use `skipIf(process.platform === 'win32' …)` with the reason in a comment. The "unreadable run file" test in `orchestrate.test.js:342` was traced in the prior spec: it does not depend on `chmod`, and it passes on Windows |
| 5 | `spawnSync('npm', …)` without a shell | `3a97739`: one shell string for `npm pack`, and a relative tarball for `tar` | `tests/installer/smoke.test.js:17`, `:21` |
| — | Enforcement: a `windows-latest` leg asserting its own key | `ca75d03`, `3ad0b3b`: matrix row `{ os: windows-latest, node: '24', env: ci-windows-node24 }`, Git Bash as the default shell | `.github/workflows/test.yml:25`, `:28-30`; `tools/skip-baseline.json` key `ci-windows-node24` |

The prior work also fixed two causes the entry did not list. Cause 6 was a separator in an `orchestrate` expectation (`orchestrate.test.js:346`, `.split('\\').join('/')`). D8 was a production defect that only the Windows runner showed: an 8.3 `TEMP` spelling put `plan_file` outside the root, fixed with `canonical()` in `scripts/conductor-db.mjs:87-88`. Both are still present.

The leg is live, not dormant. Three later items each updated its key in their own PR: `4b68f2a` (BUG-069), `ebe4b95` (BUG-087) and `6b0ba58` (BUG-088). The key now holds 24 identities. The entry's ordering clause ("`[BUG-059]` lands with or before the leg is activated") holds: BUG-059 merged in PR #87 (`25e29e8`), before PR #90, and its records closed in 1.52.13.

One clause of the entry is not fully met on `main`: "self-skip with a named reason". The key holds 11 identities that `ci-node24` does not (24 in all, 13 shared). Eight of them name their reason in the skip condition or in a comment next to it. Three do not:

| # | Identity (file:line of the skip) | Condition | Reason named at the site? | Reason (class) |
|---|---|---|---|---|
| W1 | `context-guard` "unreadable threshold file — fallback 25" (`tests/hooks/context-guard.test.js:156`) | `WIN32` | yes: comment `:155` "locked/unreadable threshold (Unix only)", and the body uses `chmodSync(tf, 0o000)` | win32 permission bits |
| W2 | `guard4` row16 "denies with PATH restricted to an empty dir" (`tests/hooks/guard4.test.js:110`) | `WIN32` | **no**: the comment at `:108-109` explains why the verdict flipped, not why win32 skips | POSIX-only fixture: the case replaces `PATH` wholesale. The skip dates from `340f796` (BUG-017), when the case set `PATH: '/bin'`, a POSIX path |
| W3 | `verbosity-remind` T-14 "traversal cap=40 blocks verbosity.md 45 levels above…" (`tests/hooks/verbosity-remind.test.js:230`) | `process.platform === 'win32'` | **no** | path length: the fixture starts the hook in a working directory 45 levels deep, about 240 characters under a default Windows temp directory. That is within a few characters of the 260-character `MAX_PATH` limit on a working directory, so a longer profile path breaks it |
| W4 | `verbosity-remind` row13 "unreadable project hook -> global retains authority" (`tests/hooks/verbosity-remind.test.js:161`) | `process.platform === 'win32'` | **no**: the `chmodSync(hookCopy, 0o000)` is in the body, and no comment names it | win32 permission bits |
| W5 | `deploy` [BUG-069] "…when the backup fails" (`tests/installer/deploy.test.js:711`) | `!POSIX_NON_ROOT` | yes: the condition (`:49`) | win32 permission bits / root |
| W6 | `deploy` [BUG-087] "…when the link cannot be removed" (`:758`) | `!POSIX_NON_ROOT \|\| !CAN_SYMLINK` | yes: the condition | win32 permission bits / root, `CAN_SYMLINK` |
| W7, W8 | `deploy` [BUG-088] "escapes control characters…" and "escapes C1 control characters…" (`:782`, `:799`) | `!POSIX_SYMLINK` | yes: comment `:663` "win32 rejects them in paths" | win32 path rules: control characters in a link target |
| W9 | `heal` "names each file it could not delete and keeps going" (`tests/installer/heal.test.js:119`) | `!POSIX_NON_ROOT` | yes: the condition (`:25`) | win32 permission bits / root |
| W10 | `conductor-db` "degrades to exit 0 … when the db dir is read-only" (`tests/scripts/conductor-db.test.js:374`) | `process.platform === 'win32'` | yes: comment `:376-377` | win32 permission bits |
| W11 | `handoff-cycle` "survives a DB write failure at the boundary…" (`tests/scripts/handoff-cycle.test.js:100`) | `win32 \|\| root` | yes: comment `:98` | win32 permission bits / root |

The reasons for W2 and W3 were never written down. The ones above come from the skip's history (W2) and from the fixture's own arithmetic (W3). Neither has been re-measured on Windows, and this item does not lift either skip (see Out of Scope).

Beyond that clause, what is missing is the records: the backlog checkbox and DONE line, the README Known limits line, and a `CHANGELOG.md` entry. Under the repository's rules, all three belong to the release, not to an item branch.

## Solution

No behavior change. This spec maps each acceptance criterion of the entry to code and tests already on `main`, adds the three missing skip reasons as comments, re-runs the suite on this branch, and hands the record updates to the release. The plan that follows has one comment-only edit task and one verification task.

The comment-only change adds one `//` line (or a short block) directly above each of the three skips. It changes no condition, no test name and no test body, so no skip identity changes and `tools/skip-baseline.json` stays as it is. The wording is fixed here so the build does not invent it:
- W2, above `tests/hooks/guard4.test.js:110`: `// Skipped on win32: the case replaces PATH wholesale, a POSIX fixture (it set PATH=/bin when the skip was added in BUG-017).`
- W4, above `tests/hooks/verbosity-remind.test.js:161`: `// Skipped on win32: chmod 0o000 does not make a file unreadable there, so the project hook would still be read.`
- W3, above `tests/hooks/verbosity-remind.test.js:230`: `// Skipped on win32: the 45-level working directory sits within a few characters of the 260-character MAX_PATH limit under a default temp directory.`

The comments state each reason as its class (see the table), and they do not claim a Windows measurement that was never made. The PR the branch opens runs all three CI legs, and the `ci-windows-node24` leg's green run with `SKIP_BASELINE_OK` is the Windows evidence. This sandbox runs Linux only, so it cannot produce that evidence itself. If the verification turns red for a reason other than the two named environment cases below, that is a regression since `8d0be53`. The build then stops and reports it, and the fix gets a new spec instead of going in silently here.

Choices made where the entry leaves one open. All were made in the prior spec, which the owner approved, and this spec does not reopen them:
- **Cause 3:** a capability probe plus junctions, not an unconditional win32 skip. The probe lets an elevated runner or a Developer Mode machine run the file-symlink tests, and the hosted runner does run them: its first run skipped none of the 7.
- **Cause 4:** a named win32 skip, not ACL fixtures. Node's `chmod` on Windows sets only the read-only attribute, which neither fixture's directory case honours, and ACL fixtures would add a platform-specific fixture layer to the tests.
- **Windows leg:** Node 24 only. The Node 20 leg exists for the `node:sqlite`-absent paths, which do not depend on the platform (the `test.yml:17-19` comment).

### Measured during this spec (Linux, Node v24.22.2, git 2.43.0, `a8c584c` plus this spec's `.gitignore` leaf)

`npm test` gives `Test Files 2 failed | 64 passed (66)`, `Tests 4 failed | 3614 passed | 12 skipped (3630)`, rc 1. All 4 failures come from the environment or the phase, and none come from BUG-058:
- `tests/unit/gitignore-block-parity.test.js`, 2 tests: the spec's leaf line is in `.gitignore` while the spec file is not yet in the index. The tests pass once the runner commits the spec, which is the toll this test exists to collect (CLAUDE.md, Staging Convention).
- `tests/unit/staging-convention.test.js` AC7 and AC8: this sandbox's git 2.43.0 exits 0, not 128, on `git add -u <untracked path>`. Reproduced in a fresh `git init` in a temp directory: `rc=0`. This is a property of the local git version and has nothing to do with Windows.

## Behavior

### Main path
1. A Windows clone with git defaults (`core.autocrlf=true`) checks out every non-`.ps1` text file LF (cause 1). The shebang-led `.mjs` suites load, and the byte-comparison tests (`merge-md` AC9b, the `templates` gitignore header) compare LF to LF.
2. `npm test` runs every suite. `conductor-db` hands `--import` a `file://` URL (cause 2), and `smoke` resolves `npm.cmd` through a shell string (cause 5).
3. Tests that cannot run on that machine skip under a named reason: file symlinks when `CAN_SYMLINK` is false (cause 3), and the two `chmod`-enforced fixtures on win32 (cause 4).
4. In CI, the `ci-windows-node24` leg runs the same suite and asserts its skipped set against its key with `tools/skip-baseline.mjs --env ci-windows-node24`.

### Alternative paths
- A Windows machine that can create symlinks (Developer Mode or elevated): the 7 file-symlink tests run instead of skipping. The hosted runner is one of these.
- A clone with `core.autocrlf=false`: same result, because the attributes fix the EOL whatever the local setting.
- A later item adds a test that skips on Windows: that PR's Windows leg goes red until it adds the identity to `ci-windows-node24`. BUG-069, BUG-087 and BUG-088 did exactly that.

### Error cases
- A regression in any cause (say, a new bare-path `--import`) makes the Windows leg red on the PR that introduces it. That leg is the enforcement the entry asks for.
- The skipped set changes in either direction: the instrument fails and names every identity to add or remove.

## Acceptance Criteria

From the entry. Each is met on `main` and re-verified on this branch as named:

- [ ] AC1 (cause 1): `.gitattributes` line 1 is `* text=auto eol=lf` and line 3 is `*.ps1 text eol=crlf`. `git ls-files --eol | grep -c i/crlf` is 0. `tests/unit/merge-md.test.js` (AC9b) and `tests/installer/templates.test.js` pass.
- [ ] AC2 (cause 2): every `--import` argument in `tests/scripts/conductor-db.test.js` is the `BLOCK` URL built with `new URL(…, import.meta.url).href` (lines 327 and 705), and the suite passes.
- [ ] AC3 (cause 3): every `symlinkSync` under `tests/` either passes `'junction'` or sits in a test gated on `CAN_SYMLINK` from `tests/helpers/can-symlink.js`. Check with `grep -rn symlinkSync tests` and a read of each site.
- [ ] AC4 (cause 4): every `chmod`-enforced fixture under `tests/**/*.test.js` is skipped on win32 by a named condition (`WIN32`, `process.platform === 'win32'` or `POSIX_NON_ROOT`), and its skip identity is in `ci-windows-node24`. Check with `grep -rn chmod tests --include='*.test.js'` against the key. That grep catches both `chmodSync` and the `execFileSync('chmod', …)` at `tests/scripts/conductor-db.test.js:381` (skip at `:374`). Expected sites: `context-guard:156`, `verbosity-remind:161`, `deploy:715`, `:766`, `heal:122`, `handoff-cycle:105`, `conductor-db:381`. The `chmodHooks` hits in `deploy.test.js` are the production function's name, not a fixture. `tests/scripts/installer-fill.test.sh` is not in the vitest `include` (`vitest.config.js:7`).
- [ ] AC5 (cause 5): `tests/installer/smoke.test.js` runs `npm pack` as a shell string and `tar` on a relative name, and the suite passes.
- [ ] AC6 (enforcement): `.github/workflows/test.yml` has the `windows-latest` / Node 24 / `ci-windows-node24` matrix row and the skip-baseline step. `tools/skip-baseline.json` has the `ci-windows-node24` key. The PR's `ci-windows-node24` leg is green and prints `SKIP_BASELINE_OK ci-windows-node24`.
- [ ] AC7 (self-skip with a named reason): each of the 11 identities in `ci-windows-node24` that `ci-node24` does not hold comes from a `skipIf` whose condition, or a comment on the line above it (or inside it, as in W10), names its reason. The reason is in one of the classes in the Problem table: win32 permission bits (with or without root, `POSIX_NON_ROOT`), `CAN_SYMLINK`, win32 path rules, path length, or a POSIX-only fixture. Check: list the identities with a set difference of the two keys, then read each site. After the build, W2, W3 and W4 carry the comments fixed under Solution.
- [ ] AC8 (ordering): `git merge-base --is-ancestor 25e29e8 8d0be53` succeeds, so `[BUG-059]` landed before the leg.
- [ ] AC9: `npm test` on this branch fails only in the 4 environment/phase tests named under "Measured", and the parity pair passes once the spec is committed. `git diff --stat origin/main -- scripts tools .gitattributes .github vitest.config.js` is empty. `git diff --stat origin/main -- tests` names only `tests/hooks/guard4.test.js` and `tests/hooks/verbosity-remind.test.js`. In `git diff -U0 origin/main -- tests`, every changed line is an added `//` comment line, with no removed lines. The skipped set is unchanged: the identity lists of the three keys in `tools/skip-baseline.json` are byte-identical to `origin/main`.

## Out of Scope

- Any code, workflow or baseline change, and any test change beyond the three comments. The fix is on `main` and approved, and `.github/workflows/` is not this branch's to edit.
- Lifting the W2 or W3 skip. Either one might pass on the hosted runner: W2's case now spawns `process.execPath` by absolute path, and W3 is a few characters under the limit there. But lifting a skip changes the `ci-windows-node24` key, and only a Windows run can measure that. This Linux sandbox cannot produce one. A later item can try it, with the Windows leg as its evidence.
- The records: ticking `[BUG-058]` and writing its DONE line in `AGENT-READABLE BACKLOG.md`, removing the `[BUG-058]` line from the README Known limits (`README.md:498`), and the `CHANGELOG.md` entry. These belong to the release.
- The rest of issue #65 (audit, PR-title lint, coverage and other CI work). The entry absorbs only its first candidate, the Windows leg.
- `staging-convention.test.js` AC7/AC8 on git versions that exit 0 for `add -u <untracked>`. That is a separate fact about the test's portability across git versions, reported here and not fixed.

## System Impact

- Files changed by this item: this spec, its plan, their two leaf lines in `.gitignore`, and three comments in `tests/hooks/guard4.test.js` (one) and `tests/hooks/verbosity-remind.test.js` (two). Both test files are already tracked, so they are staged with `git add -u <path>`. Neither is a protected surface (CONTRIBUTING, "Protected surfaces follow their ritual").
- Reviewed, not changed: `.gitattributes`, `.github/workflows/test.yml`, `tools/skip-baseline.json`, `tests/helpers/can-symlink.js`, `tests/hooks/context-guard.test.js`, `tests/installer/heal.test.js`, `tests/scripts/conductor-db.test.js`, `tests/scripts/handoff-cycle.test.js`, `tests/scripts/orchestrate.test.js`, `tests/installer/smoke.test.js`, `tests/installer/deploy.test.js`, `tests/installer/file-merge.test.js`, `tests/installer/settings-merge.test.js`, `tests/unit/adopt-claude-md.test.js`, `scripts/conductor-db.mjs:87-88`.
- Risk: none at runtime, and none to the suite, because the comments change no identity. The only open effect is that the README still tells Windows contributors the suite fails until the release updates the records.

### Files Requiring Full Read (deferred to /cc-plan)

None.

## Complexity Estimate

**XS.** Three comment lines in two test files, one verification run and a CI result. No behavior changes. The only work left after this item is the release's record update.
