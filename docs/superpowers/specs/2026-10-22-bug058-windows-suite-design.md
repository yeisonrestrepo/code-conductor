# BUG-058: The Test Suite Does Not Pass on Windows, and No CI Leg Would Notice

**Status:** Approved by the operator on 2026-10-22
**Branch:** `fix/bug-058-windows-suite`, stacked on `fix/bug-059-fake-gh-win32` (its PR merges first; see Ordering)
**Backlog:** `[BUG-058]`, filed from issue #76
**Measured on:** Windows 11 Pro 10.0.26300, Node v24.16.0, npm 11.13.0, Vitest 3.2.6, Git for Windows with `core.autocrlf=true`, no Developer Mode, main at `17f70fe`

## Problem

A Windows clone of this repository does not pass its own suite, and the only CI that runs is `ubuntu-latest`, so that state is invisible upstream. The backlog entry names five independent causes; this spec re-measured every one of them on `17f70fe` and traced each failing test to a cause before choosing a fix.

### Baseline, measured

Every run below set `GH_TOKEN=invalid-test-token`, `GH_ENTERPRISE_TOKEN=` and `GH_CONFIG_DIR=<empty temp dir>` for the test process, because a cause-1 fix makes the fake-gh suites load and, until `[BUG-059]` lands, they reach the real `gh` (M6).

| Run | `.gitattributes` | Files failing | Tests failed / total | Notes |
|---|---|---|---|---|
| B0 | as shipped | 19 | 16 / 1149 | Git Bash's `bin/` first on PATH (CONTRIBUTING's Windows prerequisite) |
| B0' | as shipped | 23 | 227 / 1149 | PATH as this machine ships it: `bash` resolves to the WSL launcher stub (M7) |
| A | `* text=auto eol=lf` + `*.ps1 crlf` | 8 | 38 / 1544 | causes 2–5 + `[BUG-059]` + one new cause exposed |
| A+fixes | A plus every per-cause POC below | 3 | 23 / 1544 | all 23 are `[BUG-059]`'s (fake gh is POSIX-only) |

B0 reproduces the issue's numbers exactly (19 files / 16 tests), and run A reproduces its autocrlf=false number exactly (38). The 395 tests that appear between B0 and A are the 12 suites that could not load.

### Every failure, traced

| Cause | Where | Failing in B0 | Failing in A | Mechanism, measured |
|---|---|---|---|---|
| 1 EOL | 11 suites importing a shebang-led `.mjs` (guard6, guard7, cli, orchestrate, ticket, id-ceiling, record-parity, repo-invariants, skip-baseline, version-gate, role-profiles) | 11 load failures | 0 | `#!/usr/bin/env node\r\n` — Vitest's transform rejects it ("Invalid or unexpected token"); plain `node` imports the same file fine |
| 1 EOL | `merge-md.test.js:192` (AC9b), `templates.test.js:73` | 2 | 0 | byte comparison against a CRLF checkout of a `.md` and of the extensionless `project-template/gitignore` |
| 2 `--import` | `conductor-db.test.js:326, :703` (3 tests in B0, 3 in A) | 3 | 3 | `ERR_UNSUPPORTED_ESM_URL_SCHEME`: `--import C:\…\block-sqlite.mjs` reads `C:` as a URL scheme |
| 3 symlink | `file-merge` ×4, `deploy` ×3, `settings-merge` ×2 | 9 | 9 | `EPERM: operation not permitted, symlink` |
| 4 permissions | `handoff-cycle.test.js:105` and **`conductor-db.test.js:379`** (the untraced peer) | 2 | 2 | `chmodSync(dir, 0o555)` is a no-op on a Windows directory; `conductor-db` already guards with "skip where chmod fails", but Git for Windows ships a `chmod.exe` that exits 0 without effect, so the guard passes and the test runs against a writable directory |
| 5 `npm` spawn | `smoke.test.js:16` | 1 load failure | 1 load failure | `spawnSync npm ENOENT` |
| 5b `tar` (new, latent) | `smoke.test.js:19` | hidden behind 5 | hidden behind 5 | with Git's `usr/bin` on PATH, GNU tar reads `C:\…\x.tgz` as `host:path` ("Cannot connect to C: resolve failed"); `windows-latest`'s `shell: bash` puts GNU tar first |
| 6 separator (new) | `orchestrate.test.js:266` | hidden behind 1 | 1 | the script prints `relative(...)` with `/` (orchestrate.mjs:79 normalizes); the test's expectation uses native `relative(...)`, so it expects `\` on win32. A test-side bug only |
| `[BUG-059]` | `ticket` ×14, `orchestrate` ×9 | hidden behind 1 | 23 | the fake `gh` is a `#!/bin/sh` file Windows cannot run; the real `gh` answers (here: `gh exited 1` against the invalid token). Not this item's fix |

"Two likely peers untraced" for cause 4 resolves to one real peer (`conductor-db:379`). The other `chmod` sites (`context-guard:160`, `verbosity-remind:179`, `heal:122`) already skip on win32 by name and are in the measured skip set below, so they are not defects.

## Solution

One change per cause, all in tests or repository configuration; **no shipped file changes** (`bin/`, `lib/`, `scripts/`, `global/`, `skills/`, `project-template/` are untouched). Then a `windows-latest` CI leg that asserts its own measured skipped set.

### D1 (cause 1): `* text=auto eol=lf`, keeping `*.ps1 text eol=crlf`

**Chosen:** `.gitattributes` becomes

```
* text=auto eol=lf
*.sh text eol=lf
*.ps1 text eol=crlf
```

**Measured (POC A vs POC B, each on a full forced re-checkout of the worktree):**

| Option | CRLF files left in the working tree | Suite |
|---|---|---|
| shipped (`*.sh`, `*.ps1` only) | 282 of 291 | B0: 19 files / 16 tests red |
| B: targeted `*.js *.mjs *.cjs *.json *.md text eol=lf` | 16: the 6 `.ps1` **plus** `.gitignore`, `LICENSE`, `VERSION`, 3 `.yml`, 2 `.txt`, `project-template/gitignore` | `templates.test.js:73` **still red** (extensionless `project-template/gitignore`) |
| **A: `* text=auto eol=lf`** | exactly the 6 `.ps1` | every cause-1 test green |

- `git add --renormalize .` under A is a **no-op on the index**: all 291 tracked files are already stored LF (`git ls-files --eol`: 291 `i/lf`, 0 `i/crlf`, 0 `i/mixed`, 0 binary). So the PR diff is the attributes file alone; no content churn.
- `*.ps1 text eol=crlf` stays and still wins (later lines override `*`): the six `.ps1` files measured `w/crlf` under A.
- B is a list that has to grow with every new extension; it already misses one shipped template. A is one line that cannot drift (Pillar 1).
- `text=auto` keeps Git's binary detection, so a future binary fixture is not mangled.
- `eol=lf` overrides `core.autocrlf` per attribute, so the result is the same on a contributor's `autocrlf=true` clone and on the runner's checkout.

**Contributor note (not a code change):** an existing clone keeps its CRLF files until they are re-checked-out. The PR description gives the one-time command (`git rm --cached -r -q . && git checkout HEAD -- .` on a clean tree); a fresh clone needs nothing.

### D2 (cause 2): pass `--import` a URL

`const BLOCK = new URL('./fixtures/block-sqlite.mjs', import.meta.url).href;` at both sites. `--import` accepts a URL on every platform, so there is no branch. Measured: the 3 tests go green on Windows. (`pathToFileURL(fileURLToPath(...)).href` is the same value with one more round-trip; rejected as redundant.)

### D3 (cause 3): a capability probe for file symlinks; junctions where the link is to a directory

**Measured (POC, unprivileged, no Developer Mode):**

| Link kind | Result | `lstat().isSymbolicLink()` |
|---|---|---|
| file symlink | EPERM | — |
| dangling file symlink | EPERM | — |
| dir symlink (`'dir'`) | EPERM | — |
| **dir junction** (`'junction'`) | OK | `true` |
| **dangling junction** | OK | `true`, `realpath` throws |
| junction pointing at a **file** | created, but `existsSync` false: unusable | — |

So "prefer running over skipping" is achievable for exactly the tests whose link is a directory or a dangling link with no file semantics:

- **Run, via `'junction'`:** `file-merge.test.js:143` (dangling link inside `resolveRealTarget`'s mixed test) and `:148` (link to a directory). The type argument is ignored off Windows, so Linux behavior is identical. Measured green.
- **Self-skip with a named reason:** the 7 tests that need a link to a *file* (`file-merge` AC3 and dangling-target, `settings-merge` ×2, `deploy` ×3). They `it.skipIf(!CAN_SYMLINK)`, where `CAN_SYMLINK` comes from a new `tests/helpers/can-symlink.js` that tries one symlink in a temp dir once per importing test file. The reason is named by the constant and by a one-line comment in the helper ("file symlinks need Developer Mode or elevation on win32"), the same idiom as `HAS_SQLITE`, `BASH_AVAILABLE` and `POSIX_NON_ROOT`.
- **Why a probe and not `process.platform === 'win32'`:** a Windows host that *can* make symlinks (Developer Mode, an elevated runner) runs them. A platform skip would throw away coverage the host can provide.

### D4 (cause 4): a named win32 skip, not ACLs

**Measured:**

| Attempt | Result |
|---|---|
| `chmodSync(dir, 0o555)` | directory stays writable |
| Git's `chmod 555 dir` | exits 0, directory stays writable (this is why `conductor-db`'s guard misfires) |
| `icacls dir /deny USER:(W,DC)` | file creation blocked, but `rename`/`unlink` of an existing file **still succeed** (the file's own inherited DELETE right wins), so `conductor-db`'s recovery hops are not forced to fail |
| `icacls dir /deny USER:(OI)(CI)(W,D,DC)` | blocks the hops but also makes the existing file **unreadable** (EPERM on read), a different fixture than the test describes; and a failed run leaves a directory the next `rmSync` cannot delete (it did, twice, in this POC) |
| replace `.conductor` with a regular file (portable, root-proof) | **does not fail**: `conductor-db.mjs:361` already self-heals a squatting file by moving it aside, and `conductor-db`'s "non-regular file at db path" suite already pins that |

No Windows mechanism reproduces "writable-to-read, unwritable-to-modify" without fixture semantics drifting and cleanup becoming fragile. **Chosen:** both tests skip on win32 by name:

- `handoff-cycle.test.js:99` extends its existing condition: `process.platform === 'win32' || getuid() === 0`, with the reason in its existing comment ("the permission bit this case depends on is not enforced").
- `conductor-db.test.js:373` adds `it.skipIf(process.platform === 'win32')` and its comment is corrected: chmod is not absent on Windows, it is ineffective, which is why the early return never fired.

The fail-open behavior these tests pin is still covered on Windows by the `node:sqlite`-unavailable and non-regular-file suites; only the permission-denied fixture is POSIX-only.

### D5 (cause 5 and 5b): one shell string for `npm pack`; a relative tarball for `tar`

**Measured (`poc5.mjs`, Node 24.16.0):**

| Option | Result |
|---|---|
| `execFileSync('npm', …)` | ENOENT |
| `execFileSync('npm.cmd', …)` | **EINVAL** (Node refuses `.cmd` without a shell since the CVE-2024-27980 fix) |
| `execFileSync('npm', args, { shell: process.platform === 'win32' })` | works, but prints **DEP0190** ("Passing args to a child process with shell option true…") on Node 24 |
| `process.execPath` + `npm_execpath` | works under `npm test`/`npx`, but `npm_execpath` is **unset** when Vitest is started any other way |
| `process.execPath` + sibling `node_modules/npm/bin/npm-cli.js` | works for the official installer layout, **fails** under a relocated Node (measured under `npx node`); version managers vary |
| **`execSync(\`npm pack --silent --pack-destination "${work}"\`)`** | works on win32 and POSIX, no deprecation warning, no platform branch |

**Chosen:** the `execSync` string. Its only interpolated value is `work`, a `mkdtemp` path under `os.tmpdir()` created by the test itself, double-quoted for both `cmd.exe` and `/bin/sh`.

**5b:** `execFileSync('tar', ['-xzf', tarball], { cwd: work })`. A relative archive name has no drive colon, so GNU tar (Git's, first on PATH under `shell: bash`) and Windows' bsdtar both accept it. Measured: `smoke.test.js` 7/7 green with GNU tar first on PATH; the absolute-path form fails with "Cannot connect to C: resolve failed".

### D6 (new cause 6): normalize the expectation's separator

`orchestrate.test.js:266` builds its expectation with `relative(root, SCRIPT).split('\\').join('/')`, mirroring `orchestrate.mjs:79`. The script is right; the test was platform-specific. Measured green. This is a test-only defect of the same kind the backlog lists, found only once cause 1 let the suite load, so it belongs to this ticket's AC ("the suite passes on Windows") rather than a new id.

### D7: the `windows-latest` leg

```yaml
strategy:
  fail-fast: false
  matrix:
    include:
      - { os: ubuntu-latest,  node: '20', env: ci-node20 }
      - { os: ubuntu-latest,  node: '24', env: ci-node24 }
      - { os: windows-latest, node: '24', env: ci-windows-node24 }
runs-on: ${{ matrix.os }}
defaults:
  run:
    shell: bash
```

- **One Windows leg, Node 24 only.** Node 24 executes the `node:sqlite` suites (the most coverage per minute); the Node 20 degradation paths are platform-independent and already asserted on `ci-node20`. A Windows Node 20 leg would double Windows minutes for no new coverage (Pillar 1, cost).
- **Baseline key `ci-windows-node24`.** The existing keys stay byte-identical (`ci-node20`, `ci-node24`), so the two Linux baselines do not churn. The `env` matrix field carries the key so the step reads `--env ${{ matrix.env }}` instead of string-building per OS.
- **`shell: bash` for every step.** On Windows this is Git Bash, which puts Git's `bin/` first on PATH. That makes `bash` resolve to Git Bash rather than the WSL launcher (M7), which is the environment CONTRIBUTING.md:172 already documents as the Windows prerequisite. On Ubuntu `bash` is already the default, so the Linux legs are unchanged.
- **Cache key already includes `runner.os`** (`vitest-${{ runner.os }}-node${{ matrix.node }}-…`), so no change is needed there; `setup-node`'s npm cache is per-OS by construction.
- **`timeout-minutes: 10` → `20`.** The full Windows suite took 120 s locally; hosted Windows runners are commonly 2–3× slower on process-spawn-heavy suites, and this suite spawns `bash`, `node` and `git` per test.
- **Check names change** from `test (20)` / `test (24)` to the include tuples. Branch protection on `main` requires no status checks (`[BUG-048]` M4), so the rename blocks nothing; the plan re-verifies before merging.

## Ordering: depends on `[BUG-059]`

D1 makes `ticket.test.js` and `orchestrate.test.js` load on Windows, and until `[BUG-059]` lands they invoke the **real, logged-in `gh`** (measured: 23 failures, each a real `gh` call answered by the invalid token this spec's runs injected). Therefore:

1. This branch is rebased onto `fix/bug-059-fake-gh-win32` and merges **after** it (or both in one merge train). `[BUG-059]`'s Windows shim and fail-fast guard are what turn those 23 into passes.
2. Until then, every local Windows run in this item's plan sets `GH_TOKEN=invalid-test-token`, `GH_ENTERPRISE_TOKEN=` and `GH_CONFIG_DIR=<empty dir>` for the test process.
3. The `windows-latest` leg is not armed (its baseline key not committed) until `[BUG-059]` is on the base branch. A Windows CI run before that point is red on the 23, by design.

The CI runner has no `gh` credential for the repository in the test process (`GITHUB_TOKEN` is not exported to `npm test`), so the leg cannot cause a live side effect even if mis-ordered; it would only be red.

## Predictions (to be replaced by measurement, never committed as the baseline)

This item adds no test and removes none; it changes skip conditions only for the 7 file-symlink tests (probe), and two permission tests (win32).

| Environment | Red/green | Skipped | Skipped composition | Evidence |
|---|---|---|---|---|
| `ci-node20` (ubuntu, Node 20) | green | **96**, set unchanged | as committed | no skip condition changes off win32: the probe is true on Linux, the new conditions are win32-only |
| `ci-node24` (ubuntu, Node 24) | green | **13**, set unchanged | heal shallow-clone 1, plugin 12 | same |
| `ci-windows-node24` (windows-latest, Node 24) | green after `[BUG-059]` | **20** predicted; **27** if the runner cannot create symlinks | CI-common 13 (as `ci-node24`) + pre-existing win32 skips 5 (`context-guard` unreadable threshold, `guard4` row16, `verbosity-remind` row13 and T-14, `heal` names-each) + this item's 2 (`handoff-cycle`, `conductor-db` read-only) [+ 7 symlink if `CAN_SYMLINK` is false] | local measurement with the POCs applied: 13 skipped = 5 pre-existing + 7 symlink + 1 `conductor-db`, plus `handoff-cycle` measured separately; the plugin 12 pass locally only because this machine has the skills installed |
| local Windows (this machine, unprivileged) | green after `[BUG-059]` | 14 | 5 pre-existing + 7 symlink + 2 permission | measured, POCs applied (23 `[BUG-059]` failures excepted) |

The 20 vs 27 fork is the one prediction this spec cannot measure locally: GitHub's hosted Windows runner is believed to run elevated (so `CAN_SYMLINK` is true), but that is checked on the first run, not assumed. Either result is a legitimate baseline; the key commits whatever the leg measured.

### Measured at implementation (2026-10-22), and the provisional Windows key

Same machine; each ref given a fresh-clone-equivalent checkout under the default `core.autocrlf=true`; Git Bash first on PATH; `GH_TOKEN`, `GITHUB_TOKEN`, `GH_ENTERPRISE_TOKEN` unset; empty `GH_CONFIG_DIR`.

| Ref | Passed | Failed | Skipped | Total |
|---|---|---|---|---|
| `main` `17f70fe` | 1121 | 16 (19 files) | 12 | 1149 |
| `[BUG-059]` base `70a5c6c` | 1126 | 16 (19 files) | 12 | 1154 |
| this branch | **1535** | **0** | **14** | 1549 |

Base → branch: 11 suites move from load failure to loaded (395 tests appear, all passing); 7 failures pass (cause 1 ×2, cause 2 ×3, junctions ×2); 9 failures become named skips (`CAN_SYMLINK` ×7, win32 permission ×2); the 7 `smoke` tests, reported as skipped on the base because their `beforeAll` threw, pass. The 12 base skips were 5 pre-existing win32 skips plus those 7.

**The `ci-windows-node24` key is provisional.** It holds the 14 identities measured locally plus the 13 that every CI leg skips for runner reasons (shallow clone, skills absent), copied verbatim from the measured `ci-node24` key: 27 identities. If the hosted runner can create symlinks, its first run reports `−7` (the `CAN_SYMLINK` skips), and the key is corrected to that run's set in the same PR. The first CI run confirms or corrects the key; it is not final until then.

## Acceptance Criteria

From the backlog entry, not invented:

### The five causes

- [ ] **Cause 1:** `.gitattributes` is D1's three lines; `git add --renormalize .` stages nothing but the attributes file; a fresh `autocrlf=true` Windows clone checks out every non-`.ps1` file LF. The 11 shebang-led suites load; `merge-md` AC9b and `templates` header pass.
- [ ] **Cause 2:** `conductor-db.test.js` passes `--import` a `file://` URL at both sites; the 3 tests pass on Windows.
- [ ] **Cause 3:** no test fails with `EPERM … symlink`. The 2 directory/dangling links use `'junction'` and run; the 7 file-symlink tests self-skip on `!CAN_SYMLINK` from `tests/helpers/can-symlink.js`.
- [ ] **Cause 4:** `handoff-cycle` and `conductor-db`'s read-only tests self-skip on win32 by name, with corrected comments; no test depends on `chmod` enforcement on Windows.
- [ ] **Cause 5:** `smoke.test.js` loads and passes on Windows (D5, including the `tar` fix).
- [ ] **Cause 6 (found here):** `orchestrate.test.js:266` passes on Windows.

### Enforcement (owner's binding AC)

- [ ] `test.yml` runs a green `windows-latest` / Node 24 leg alongside the unchanged Linux legs (D7).
- [ ] `tools/skip-baseline.json` gains key `ci-windows-node24` holding the set **measured on that leg's own run**; `ci-node20` and `ci-node24` are byte-unchanged.
- [ ] The leg's instrument line reads `SKIP_BASELINE_OK ci-windows-node24: N skipped identities match …`.
- [ ] `[BUG-059]` is on the base branch before the key is committed (Ordering).
- [ ] `tools/README.md` and `CONTRIBUTING.md` stay unedited: both already describe the legs without naming them ("every matrix leg", "each leg"), so they stay true with a third leg, and an external PR ships only code, tests and design docs.

### Unchanged

- [ ] No file under `bin/`, `lib/`, `scripts/`, `global/`, `skills/`, `project-template/` changes; `tests/fixtures/guard3-reference.sh` is untouched; no dependency is added.
- [ ] Release surfaces (`VERSION`, `package.json` version, `CHANGELOG.md` release entry, backlog checkbox) are owner-side and not edited on this branch.

## Out of Scope

- **`[BUG-059]`'s fake-gh shim and fail-fast guard.** A dependency, not this item.
- **The WSL-stub `bash` resolution (M7)** — see "Bugs found, not fixed".
- **A Windows Node 20 leg, or macOS.**
- **Making the 7 file-symlink tests run unprivileged** (would need product code to accept a junction or a hard link in their place; the tests pin symlink semantics on purpose).
- **Normalizing existing clones' working trees** beyond the one-time note.

## Bugs found, not fixed (reported for the owner to file)

1. **`BASH_AVAILABLE`-style probes accept the WSL launcher.** `tests/hooks/context-guard.test.js:16` (and peers in `guard3`, `hook-project-root`, `verbosity-remind`) probe with `spawnSync('bash', ['--version'])`. On a Windows machine whose PATH has `%LOCALAPPDATA%\Microsoft\WindowsApps\bash.exe` (the WSL stub) before Git Bash, the probe passes, the suites run under WSL, and they fail with exit 127 and `EPERM` on `rmSync` of their temp dirs (run B0': 227 failures) instead of skipping or running under Git Bash. CI is unaffected by D7's `shell: bash`; contributors following CONTRIBUTING.md:172 are unaffected; others see 211 spurious failures.
2. **`conductor-db.test.js:379`'s "skip where chmod fails" guard is ineffective wherever a no-op `chmod` exists** (Git for Windows). Fixed here only as a by-product of D4's win32 skip; the guard idiom itself remains elsewhere if copied.

## System Impact

| Surface | Change |
|---|---|
| `.gitattributes` | D1 |
| `tests/helpers/can-symlink.js` (new) | the probe |
| `tests/installer/file-merge.test.js`, `deploy.test.js`, `settings-merge.test.js` | D3 |
| `tests/scripts/conductor-db.test.js` | D2 (2 lines), D4 (skip + comment) |
| `tests/scripts/handoff-cycle.test.js` | D4 |
| `tests/installer/smoke.test.js` | D5 |
| `tests/scripts/orchestrate.test.js` | D6 |
| `.github/workflows/test.yml` | D7 |
| `tools/skip-baseline.json` | new key `ci-windows-node24`, provisional until the first CI run confirms it |

**Pillar fit.** Pillar 5 (Infrastructure, Ecosystem, QA): the defect is a platform the project claims to support (the installer, hooks and `.ps1` launchers ship for Windows) with no executed evidence; the leg makes that claim measured and the baseline makes Windows coverage loss red. Pillar 1 (simplicity): one attributes line instead of a growing list; one tiny probe helper; no platform branches in shipped code; skips only where POCs showed no portable fixture exists; zero dependencies.

**Pre-flight (critical-review Phase 1)**

- **Happy path:** three legs green, three `SKIP_BASELINE_OK` lines, Linux sets unchanged.
- **Failure points:** the runner may lack symlink privilege (20 vs 27, decided by measurement); hosted Windows may be slow enough to hit the timeout (20 min, measured 2 min locally); `[BUG-059]` mis-ordering makes the leg red, never side-effecting (no credential in the test env); a test title that embeds a Windows temp path would make an identity unstable — the plan checks the measured set across two runs, as `[BUG-048]` did.
- **Boundary conditions:** `CAN_SYMLINK` is evaluated once per importing test file, since Vitest isolates modules per file (cheap: one temp dir); the probe must clean up even on EPERM (`finally`); `.gitattributes` order matters (`*` first so the later lines win).

## Measurements (M-index)

- **M1** B0/B0'/A/A+fixes runs: the tables above; JSON reports kept in the session scratchpad, not committed.
- **M2** `git ls-files --eol`: 291 `i/lf`; working tree 282 `w/crlf` shipped, 16 under B, 6 (`.ps1`) under A.
- **M3** symlink kinds: D3 table.
- **M4** permission mechanisms: D4 table.
- **M5** npm/tar spawn: D5 table.
- **M6** without `GH_TOKEN` injection, the 23 fake-gh tests would have used the operator's real `gh` login; with it, `gh` exited 1 on auth.
- **M7** `Get-Command bash -All` on this machine: only `…\WindowsApps\bash.exe`; Git's `bin/` is not on PATH by default (only `Git\cmd`).

## Complexity Estimate

**S–M.** Each code change is one to ten lines in tests; the attributes change is one line. The cost is in the CI bootstrap: the Windows key cannot be written before the leg measures it, and the leg cannot be green before `[BUG-059]` is on the base, so the plan orders two CI runs after a rebase.
