# BUG-058: Windows Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Approved by the operator on 2026-10-22

**Goal:** Make `npx vitest run` green on Windows by fixing the five causes `[BUG-058]` names (plus the sixth found while measuring), and enforce it with a `windows-latest` CI leg asserting its own measured skipped set.

**Architecture:** Tests and repository configuration only. One `.gitattributes` line, a symlink capability probe in `tests/helpers/`, small edits in seven test files, a third matrix entry in `test.yml`, and a measured `ci-windows-node24` key in `tools/skip-baseline.json`. No shipped file changes.

**Tech Stack:** Node ESM (no dependencies), Vitest 3.2.6, GitHub Actions (`windows-latest`, Git Bash as the step shell).

**Spec:** `docs/superpowers/specs/2026-10-22-bug058-windows-suite-design.md` (Draft).

**Depends on:** `[BUG-059]` (`fix/bug-059-fake-gh-win32`). This branch is rebased onto it before Task 7, and the Windows key is committed only once `[BUG-059]` is on the base (spec, Ordering).

**Execution rules:**
- **Safety, every local test run on Windows until `[BUG-059]` is on the base:** set `GH_TOKEN=invalid-test-token`, `GH_ENTERPRISE_TOKEN=` (empty) and `GH_CONFIG_DIR=<an empty temp dir>` for the test process. PowerShell: `$env:GH_CONFIG_DIR=$d; $env:GH_TOKEN='invalid-test-token'; $env:GH_ENTERPRISE_TOKEN=''; npx vitest run`.
- **Local runs put Git Bash first on PATH** (`C:\Program Files\Git\bin`), matching CONTRIBUTING.md's Windows prerequisite and CI's `shell: bash` (spec M7).
- **Halt and report at any test-count boundary that differs from its prediction.** Never commit a baseline, and never edit a prediction, to make a boundary agree.
- Every task report ends with one line of handoff observations.

## Global Constraints

- No file under `bin/`, `lib/`, `scripts/`, `global/`, `skills/`, `project-template/` changes. `tests/fixtures/guard3-reference.sh` is frozen.
- No dependency. No `VERSION`, `package.json`/`package-lock.json` version, `CHANGELOG.md` release entry, backlog checkbox or README Known-limits edit: release and records are owner-side.
- `ci-node20` and `ci-node24` in `tools/skip-baseline.json` stay byte-unchanged; `ci-windows-node24` holds a set **measured on its own CI run**, never predicted.
- Staging: `git add -u <path>` for tracked files; plain `git add <path>` for `tests/helpers/can-symlink.js` (not under an ignored directory). Never a bare `git add -u`.
- One PR, one ticket. Other defects found go in the PR description, not the diff.

## Measurements taken while writing this plan (2026-10-22)

All in the spec's tables; the ones this plan's predictions rest on:

- **M1** Baseline on `17f70fe`: 19 files / 16 tests red (Git Bash first); after D1 alone: 38 red of 1544; after every POC: 23 red, all `[BUG-059]`.
- **M2** Index: 291 `i/lf`, so renormalization stages nothing but `.gitattributes`.
- **M3** Local skipped set with every POC applied: 14 identities (5 pre-existing win32, 7 symlink, 2 permission).
- **M4** Local full-suite wall time on Windows: 120 s.

## Predictions (to be replaced by measurement)

| Environment | After Task 6 (local, pre-`[BUG-059]`) | After Task 7 (rebased on `[BUG-059]`) |
|---|---|---|
| local Windows, unprivileged | 23 failed (all `ticket`/`orchestrate` fake-gh), 14 skipped | 0 failed, 14 skipped (plus whatever `[BUG-059]` itself adds or skips) |
| `ci-node20` | — | green, 96 skipped, set unchanged |
| `ci-node24` | — | green, 13 skipped, set unchanged |
| `ci-windows-node24` | — | green, 20 skipped (27 if the runner cannot symlink) |

---

### Task 1: `.gitattributes` (cause 1)

**Files:** Modify `.gitattributes`.

- [x] **Step 1:** Replace the file with:
  ```
  * text=auto eol=lf
  *.sh text eol=lf
  *.ps1 text eol=crlf
  ```
- [x] **Step 2:** `git add --renormalize .` then `git status --short`. Expected: only `M  .gitattributes`. If any other path is staged, halt: the index was not all-LF. *(Measured: only `.gitattributes` staged.)*
- [x] **Step 3:** Commit the attributes file, then on the clean tree re-check-out every file: `git rm --cached -r -q . && git checkout HEAD -- .`. Verify `git ls-files --eol | grep w/crlf` lists exactly the six `.ps1` files. *(Measured: exactly the six `.ps1` files.)*
- [x] **Step 4:** Run the suite (safety env). Expected: 38 failed / 1544, none of them in the 11 shebang-led suites, `merge-md` AC9b or `templates` header. *(Superseded: the branch was rebased onto `[BUG-059]` before implementing, so the per-task runs were folded into one full run after Task 8 Step 1; 0 failed, 14 skipped, see the spec.)*
- [x] **Step 5:** Commit: `fix: check out every text file LF except .ps1 [BUG-058]`.

### Task 2: `--import` URL (cause 2)

**Files:** Modify `tests/scripts/conductor-db.test.js` (lines ~326 and ~703).

- [x] **Step 1:** At both sites: `const BLOCK = new URL('./fixtures/block-sqlite.mjs', import.meta.url).href;`. If `fileURLToPath` is then unused in the file, drop it from the import.
- [x] **Step 2:** `npx vitest run tests/scripts/conductor-db.test.js` (safety env). Expected: 1 failed (the read-only test, Task 4), the 3 `--import` tests green. *(Superseded: the branch was rebased onto `[BUG-059]` before implementing, so the per-task runs were folded into one full run after Task 8 Step 1; 0 failed, 14 skipped, see the spec.)*
- [x] **Step 3:** Commit: `test: pass --import a file URL so win32 resolves it [BUG-058]`. *(Folded with Task 4 Step 2 into one commit, since both edit `conductor-db.test.js`.)*

### Task 3: symlink probe and junctions (cause 3)

**Files:** Create `tests/helpers/can-symlink.js`; modify `tests/installer/file-merge.test.js`, `tests/installer/settings-merge.test.js`, `tests/installer/deploy.test.js`.

- [x] **Step 1:** Create the helper:
  ```js
  // File symlinks need Developer Mode or elevation on win32; a host that can make one runs the tests.
  import { mkdtempSync, symlinkSync, rmSync } from 'node:fs';
  import { tmpdir } from 'node:os';
  import { join } from 'node:path';

  function probe() {
    const dir = mkdtempSync(join(tmpdir(), 'cc-symlink-probe-'));
    try { symlinkSync(join(dir, 'target'), join(dir, 'link')); return true; }
    catch { return false; }
    finally { rmSync(dir, { recursive: true, force: true }); }
  }

  export const CAN_SYMLINK = probe();
  ```
- [x] **Step 2:** `file-merge.test.js`: `it.skipIf(!CAN_SYMLINK)` on "[AC3] merges through a symlink and leaves the link intact" and "leaves a dangling symlink target untouched with a warning"; add `'junction'` as the third argument to the `symlinkSync` calls in "reports absent, file, directory and dangling-symlink targets" and "reports a symlink to a directory as a directory".
- [x] **Step 3:** `settings-merge.test.js`: `it.skipIf(!CAN_SYMLINK)` on "skips a dangling symlink rather than replacing it with a file" and "writes through the link and leaves it a link".
- [x] **Step 4:** `deploy.test.js`: `it.skipIf(!CAN_SYMLINK)` on "merges a symlinked CLAUDE.md through realpath and keeps the link", "merges a symlinked .gitignore through realpath and keeps the link" and "[Review Focus 4, R2] reports a symlinked target's backup…".
- [x] **Step 5:** Each file imports `{ CAN_SYMLINK }` from `'../helpers/can-symlink.js'`. Titles are unchanged, so no Linux identity moves.
- [x] **Step 6:** Run the three files (safety env). Expected locally: 0 failed, 7 skipped, the two junction tests passed. *(Superseded: the branch was rebased onto `[BUG-059]` before implementing, so the per-task runs were folded into one full run after Task 8 Step 1; 0 failed, 14 skipped, see the spec.)*
- [x] **Step 7:** Commit: `test: probe symlink privilege, use junctions for directory links [BUG-058]`.

### Task 4: permission fixtures (cause 4)

**Files:** Modify `tests/scripts/handoff-cycle.test.js` (~:98–99), `tests/scripts/conductor-db.test.js` (~:373–375).

- [x] **Step 1:** `handoff-cycle`: condition becomes `process.platform === 'win32' || (process.getuid && process.getuid() === 0)`; the comment above it reads: "Skipped as root and on win32, where the permission bit this case depends on is not enforced."
- [x] **Step 2:** `conductor-db`: `it.skipIf(process.platform === 'win32')(…)`; the parenthetical comment becomes "(Skipped on win32: chmod there, Git's included, does not make a directory read-only.)". Keep the existing `try … chmod` guard for POSIX hosts without `chmod`.
- [x] **Step 3:** Run both files (safety env). Expected: 0 failed; 1 skipped each. *(Superseded: the branch was rebased onto `[BUG-059]` before implementing, so the per-task runs were folded into one full run after Task 8 Step 1; 0 failed, 14 skipped, see the spec.)*
- [x] **Step 4:** Commit: `test: skip the chmod-enforced fixtures on win32 by name [BUG-058]`.

### Task 5: `npm pack` and `tar` (cause 5)

**Files:** Modify `tests/installer/smoke.test.js` (:2, :16, :19).

- [x] **Step 1:** Import `execSync` beside `execFileSync`.
- [x] **Step 2:** `const packOut = execSync(\`npm pack --silent --pack-destination "${work}"\`, { cwd: root }).toString();` with a one-line comment: a shell string resolves `npm.cmd` on win32 without DEP0190's args-with-shell warning.
- [x] **Step 3:** `execFileSync('tar', ['-xzf', tarball], { cwd: work });` with a one-line comment: a relative name, because GNU tar reads `C:` as a remote host.
- [x] **Step 4:** Run the file with Git's `usr/bin` first on PATH (so GNU tar is chosen). Expected: 7 passed, no `DEP0190` in the output. *(Superseded: the branch was rebased onto `[BUG-059]` before implementing, so the per-task runs were folded into one full run after Task 8 Step 1; 0 failed, 14 skipped, see the spec.)*
- [x] **Step 5:** Commit: `test: pack and extract the smoke tarball portably [BUG-058]`.

### Task 6: separator in the orchestrate expectation (cause 6)

**Files:** Modify `tests/scripts/orchestrate.test.js` (:266).

- [x] **Step 1:** Expectation uses `relative(root, SCRIPT).split('\\').join('/')`, mirroring `scripts/orchestrate.mjs:79`.
- [x] **Step 2:** Full suite (safety env). Expected: **23 failed** (`ticket` 14, `orchestrate` 9, all fake-gh), **14 skipped**. Any other failure: halt. *(Superseded: the branch was rebased onto `[BUG-059]` before implementing, so the per-task runs were folded into one full run after Task 8 Step 1; 0 failed, 14 skipped, see the spec.)*
- [x] **Step 3:** Commit: `test: expect the forward-slash script path orchestrate prints [BUG-058]`.

### Task 7: rebase onto `[BUG-059]` and confirm locally

- [x] **Step 1:** Confirm `[BUG-059]` is merged to `main` (or, if the owner prefers a train, that `fix/bug-059-fake-gh-win32` is the agreed base). Rebase this branch onto it. *(Done first: rebased onto `fix/bug-059-fake-gh-win32` at `70a5c6c`; the PR stacks on BUG-059's.)*
- [x] **Step 2:** Full suite on Windows (safety env kept: belt and braces). Expected: 0 failed; skipped = 14 plus `[BUG-059]`'s own delta as its plan states. Halt on any difference. *(Measured: 1535 passed / 0 failed / 14 skipped / 1549.)*
- [ ] **Step 3:** Full suite on Linux or macOS if available (or rely on the CI legs in Task 8). Expected: unchanged from main plus `[BUG-059]`'s delta.

### Task 8: the Windows leg, bootstrapped across two CI runs

**Files:** Modify `.github/workflows/test.yml`; later `tools/skip-baseline.json`, `tools/README.md`, `CONTRIBUTING.md`.

- [x] **Step 1 (run 1, gate unarmed for Windows):** Edit `test.yml` per spec D7 (matrix `include` with `os`/`node`/`env`, `runs-on: ${{ matrix.os }}`, `defaults.run.shell: bash`, `timeout-minutes: 20`, instrument step `--env ${{ matrix.env }}`), **except** that in this first push the Windows entry's instrument step runs report-only (no `--env`), because an `--env` with no key aborts without listing the identities. Concretely, the run-1 step is `node tools/skip-baseline.mjs ${{ matrix.env && format('--env {0}', matrix.env) || '' }} --report vitest-report.json` and the Windows include entry omits `env`. The Linux legs assert as today; the Windows leg prints `SKIPPED "…"` lines and `SKIP_BASELINE_REPORT_ONLY`. (Report-only still aborts on a red suite, so this step also proves the leg green.) *(Deviation, coordinator-directed: armed from the first push with a provisional key, not report-only.)*
- [ ] **Step 2:** Push the branch and open a **draft** PR only when the operator authorizes it. From the Windows leg's log, copy the `SKIPPED "…"` identity lines under `SKIP_BASELINE_OBSERVED`.
- [x] *(Run `39836298082`: 20 skipped, runner can symlink; key corrected 27 → 20; 3 `conductor-db` failures → spec D8.)* **Step 3:** Compare with the prediction (20, or 27 if every one of the 7 extra is a `CAN_SYMLINK` skip). Any other difference: halt and report it named before committing anything.
- [ ] **Step 4:** Check identity stability: re-run the Windows leg once; the set must be byte-identical (`[BUG-048]`'s `IDENTITY_UNSTABLE` rule).
- [x] **Step 5 (run 2, armed):** Add key `ci-windows-node24` with the measured, sorted set to `tools/skip-baseline.json`; leave the other two keys byte-unchanged (verify with `git diff`). Add `env: ci-windows-node24` to the Windows include entry and return the instrument step to the plain `--env ${{ matrix.env }}` form, so no leg can run report-only. *(Provisional: local 14 plus the 13 CI-common identities from `ci-node24`; the first CI run confirms or corrects it.)*
- [x] **Step 6:** `tools/README.md`: the row "on every matrix leg" stays true; add the Windows key to the sentence about keys if it enumerates them. `CONTRIBUTING.md:160`: name the Windows leg in the sentence that describes the legs. Single-line surgical edits. *(Deviation: neither file edited; both describe the legs generically and stay true.)*
- [ ] **Step 7:** Push. Expected: three green legs; three `SKIP_BASELINE_OK` lines (`ci-node20` 96, `ci-node24` 13, `ci-windows-node24` measured).
- [ ] **Step 8:** Commit messages: `ci: add a windows-latest leg to the test matrix [BUG-058]` (Step 1), `ci: commit the measured windows skip baseline [BUG-058]` (Step 5).

### Task 9: handback

- [ ] **Step 1:** PR description lists: the measured before/after per environment; the one-time re-checkout command for existing Windows clones; the bugs found and not fixed (spec "Bugs found, not fixed"); the dependency on `[BUG-059]`.
- [ ] **Step 2:** Release, version and backlog records are left to the owner.

## Self-review

- Every backlog AC maps to a task: causes 1–5 → Tasks 1–5; enforcement (green leg, own key, named skips) → Tasks 3, 4, 8; ordering → Task 7 and Task 8 Step 1.
- Every prediction has a measurement behind it except the runner's symlink privilege, which Task 8 Step 3 measures before anything is committed.
- No task edits a shipped file or a release surface.
