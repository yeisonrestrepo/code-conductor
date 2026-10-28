# Issue #92 WSL Bash Probe — Design

**Status:** APPROVED 2026-10-24 (owner reviews in the PR)
**Issue:** #92 (backlog id assigned owner-side)

## Problem

Four suites decide whether bash is usable by running `bash --version`: `tests/hooks/context-guard.test.js:16`, `guard3.test.js:21`, `hook-project-root.test.js:14` and `verbosity-remind.test.js:22`. On Windows with WSL enabled, `bash` on the default PATH is the WSL launcher (`%LOCALAPPDATA%\Microsoft\WindowsApps\bash.exe`). It passes that probe, then fails every real call: `bash C:\…\context-guard.sh` exits 127 because WSL drops the backslashes (`C:UsersASUS…: No such file or directory`). Reproduced 2026-10-24 on `main` at `8946b1b`. The probe tests the wrong property: the suites need a bash that runs a script given by its native absolute path, not one that prints a version.

## Solution

One shared helper, `tests/helpers/bash.js`, exports `BASH`: the first candidate that runs a probe script by its native absolute path and prints `ok`, or `null`.

- Candidates: `bash` from PATH; on win32 only, also Git for Windows' `bin/bash.exe`, located from `git --exec-path` (`<git>/mingw64/libexec/git-core` → `<git>/bin/bash.exe`).
- `null` prints one named warning and the suites skip, as today's "bash not found" branch does.
- The four suites import `BASH` and spawn it in place of the literal `'bash'`; their local probes are deleted.
- The probe runs once per test run, not once per importing file: vitest loads the helper again in each file's worker, and each probe can wait up to 10 s on a slow WSL start. A vitest `globalSetup` (`tests/helpers/bash-setup.js`) probes once and `provide`s the result; `bash.js` reads it with `inject`, and probes itself only when no setup provided one. The probe functions live in `tests/helpers/bash-probe.js`, which imports nothing from vitest, so the setup can load it in the main process.

Chosen over the issue's other directions:

- `uname -r` containing `microsoft`: detects WSL by name, so any other bash that cannot open a Windows path (a Cygwin or MSYS build without path conversion) still slips through. The script probe checks the capability itself.
- Skip-only: correct but throws away ~200 tests on a host that has Git Bash installed. Falling back to Git's bash keeps them running, which is the issue's first expectation.

## Behavior

- Linux/macOS: `bash` passes the probe; behavior unchanged.
- Windows, Git Bash first on PATH (CI's `shell: bash`): `bash` passes; unchanged.
- Windows, WSL launcher first: `bash` fails the probe (exit 127), Git's `bin/bash.exe` passes; the suites run under Git Bash.
- Windows, WSL first and no Git for Windows: both fail; `BASH` is `null`, the warning names the reason, the suites skip.

## Acceptance Criteria

- [ ] With the WSL launcher first on PATH, `tests/hooks/context-guard.test.js` passes (main: 18 failed).
- [ ] `findBash` rejects a candidate that exits non-zero on the probe script and a candidate that does not exist.
- [ ] When `BASH` is non-null it runs a script by its native absolute path; on win32 with Git for Windows installed it is non-null.
- [ ] On win32 with Git for Windows installed, when the first candidate runs but cannot run the probe script (as the WSL launcher does), `findBash` returns Git's `bin/bash.exe`.
- [ ] One test run probes once, however many files import the helper.
- [ ] No suite spawns the literal `'bash'` for a script path any more.
- [ ] Full suite with WSL first on PATH: the bash-suite failures (227 on the issue host) are gone; the remaining count matches Git-Bash-first.

## Out of Scope

- Hooks themselves, `settings.json`, the installer: they already run under Claude Code's own shell choice.
- The other Windows failures tracked by `[BUG-058]`/`[BUG-059]`.
- CI: the Windows leg already uses Git Bash.

## System Impact

- New: `tests/helpers/bash.js`, `tests/helpers/bash-probe.js`, `tests/helpers/bash-setup.js`, `tests/unit/bash-helper.test.js`.
- Modified: the four suites above (probe and spawn only); `vitest.config.js` (`globalSetup`); `tools/skip-baseline.json` (the Windows-only fallback test, skipped on the Linux legs).

## Complexity Estimate

**S.** One helper of three small functions and a mechanical swap in four test files.
