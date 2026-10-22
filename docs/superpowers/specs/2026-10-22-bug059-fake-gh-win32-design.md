# BUG-059: The Fake gh Is POSIX-Only, So on Windows the Suites Reach the Real gh

**Status:** Draft — awaiting operator approval. **Target:** a patch release, which the owner cuts. **Ordering:** lands with or before `[BUG-058]` activates the `windows-latest` CI leg (backlog entry). **Approach:** one preload, `tests/helpers/gh-intercept.mjs`, is both the win32-resolvable fake and the fail-fast guard; an empty gh config is the suspenders.

## Problem

`tests/helpers/fake-gh.js:22` installs the fake by writing a `#!/bin/sh` script named `gh` into a temp `bin/` and prepending that directory to `PATH`. The only production caller, `scripts/ticket.mjs:70`, runs `spawnSync('gh', args, …)` with no shell. On Windows that lookup is libuv's: it never executes an extensionless script, and it appends only `.com` and `.exe`, so it skips the fake and resolves the next `gh.exe` on `PATH`, the developer's real, logged-in GitHub CLI.

Measured on Windows 11, Node 24.16.0, gh 2.93.0, on an LF export of `17f70fe` (BUG-058 cause 1 otherwise stops both suites at import):

- `ticket.mjs writeback FEAT-031 … --ticket https://github.com/acme/widgets/issues/5` under `fakeGh().env()` exits 1 with `TICKET_UNREACHABLE: gh exited 4: To get started with GitHub CLI, please run:  gh auth login`, and the fake's log holds **0 calls**. The real gh answered. It stopped at exit 4 only because the probe ran with an empty `GH_CONFIG_DIR` and no token; on a logged-in machine the same call posts a comment to `acme/widgets#5`, or closes it with `--close`.
- `tests/scripts/ticket.test.js` + `tests/scripts/orchestrate.test.js`: **169 tests, 23 failed** (ticket 13 of 57, orchestrate 10 of 112). 22 of the 23 are the real gh standing in for the fake; the 23rd is an unrelated Windows failure (see Out of Scope).

No test skips on win32, and nothing in the suite would notice a fake that is bypassed: the failures are assertion noise after the side effect, never a refusal before it. Once `[BUG-058]` cause 1 makes these suites load on Windows, `npm test` on a logged-in developer machine can write to the live repository.

## Acceptance Criteria (from the backlog entry)

The entry states two criteria; this spec answers those and adds none of its own:

1. **The fake resolves on win32** (a `.cmd`/`.bat` shim or a Node-based shim) so the suites run hermetically.
2. **A fail-fast guard** makes any test path that would invoke the real `gh` die with a named error before the call leaves the process, **on every platform**.

The entry leaves the shim's shape and the guard's mechanism open. The choices below are measured, not assumed.

## POC Evidence

Throwaway probes, run outside the repository. Every probe that could reach the real gh used a harmless argv (`help`, `--version`) or ran with gh neutralized (empty `GH_CONFIG_DIR`, no `GH_TOKEN`/`GITHUB_TOKEN`).

### Shim options: which binary does `spawnSync('gh')` (no shell, as `ticket.mjs:70`) resolve?

| Option | `shell: false` (production) | `shell: true` | Verdict |
|---|---|---|---|
| A. Today: sh script `gh` first on `PATH` | **real gh** (`Work seamlessly with GitHub…`) | real gh | the bug |
| B. `gh.cmd` first on `PATH` | **real gh** | fake | not resolved by the production call |
| C. sh `gh` + `gh.cmd` side by side | **real gh** | fake | same as B |
| D. `node.exe` copied in as `gh.exe` + a `NODE_OPTIONS --require` preload that acts on `basename(execPath) === 'gh'` | fake | fake | resolves, rejected (below) |
| E. `shell: true` on win32 in `ticket.mjs` | — | fake (B/C) | rejected (below) |
| **Y. `NODE_OPTIONS --import` preload that rewrites any `child_process` call naming `gh` to `process.execPath fake-gh-cli.mjs …`** | **fake** | fake | **chosen** |

Y measured end to end: a static ESM `import { spawnSync } from 'node:child_process'` child, and a node → node → gh grandchild hop (the `orchestrate.mjs:184` shape), both reach the fake with argv `["api","-X","POST","repos/a/b"]` intact. On the LF export with Y alone, the two suites go from **23 failed to 1 failed** (169 tests; the 1 is the unrelated Windows failure). `syncBuiltinESMExports()` is what makes the rewrite visible to an ESM named import, and it is a public `node:module` API.

Why the others lose:

- **B/C (`.cmd`)** are found only through a shell. The production call has none, so the real `gh.exe` still wins. This is the shim the backlog names first, and the measurement rules it out on its own.
- **D (renamed node.exe)** works, but at a price: Node resolves the first gh argument as a script path (`help` arrives as `C:\…\worktree\help`), any leading `-` argument is eaten as a Node flag, the hardlink fails with `EPERM` against `C:\Program Files\nodejs\node.exe` so each fake is an ~80 MB copy (1.8–4.2 s measured), and it still needs a `NODE_OPTIONS` preload. Y is that preload without the binary.
- **E (`shell: true`)** changes production for a test problem. Node 24 prints `DEP0190` for it, and `ticket.mjs` passes untrusted issue text through `-F` fields, so `cmd.exe` metacharacters in that text become a command-injection surface. Rejected on safety, not taste.
- **A production seam** (an env var naming the gh binary) was considered and not built: it adds a redirect knob to shipped code and weakens `ticket.test.js:81`, which pins `spawnSync('gh', args` as the only way the script reaches GitHub.

### Guard options: what stops a test that reaches for the real gh?

| Option | Measured | Named error before spawn? | Every platform? | Covers |
|---|---|---|---|---|
| G1. Y's own no-state branch: `FAKE_GH_STATE` unset → write `CC_REAL_GH_BLOCKED: …` to stderr, `process.exit(97)` | child: exit 97 + named line; grandchild: exit 97; vitest worker: the call throws (vitest traps `process.exit`) | **yes** | yes (pure Node) | every node process carrying `NODE_OPTIONS`, i.e. every test spawn that inherits `process.env` |
| G2. Neutralize credentials: `GH_CONFIG_DIR` → an empty dir, delete `GH_TOKEN`, `GITHUB_TOKEN`, `GH_ENTERPRISE_TOKEN`, `GITHUB_ENTERPRISE_TOKEN` | real gh: `auth status` exit 1, `api user` exit 4, `issue view 1 -R cli/cli` exit 4, each `…gh auth login`, no request sent | no (gh's own message, after the spawn) | yes | anything G1 cannot see: a shell string, a script, a non-node spawner |
| G3. A guard `gh` first on `PATH` | POSIX only: on Windows it is option A/B again | — | **no** | rejected |
| G2′. `GH_TOKEN=invalid` instead of deleting it | gh treats itself as authenticated and **sends** the request, which then fails 401 | no | yes | rejected: the call leaves the machine |

### Whole-suite effect of arming the hook everywhere

The full suite ran twice on the Windows LF export, gh neutralized, once at `17f70fe` and once with the POC applied (intercept, guard setup file, `fake-gh.js` rewrite, the `ticket.test.js:306` opt-out, and the five guard tests):

| | Total | Passed | Failed | Skipped |
|---|---|---|---|---|
| Before | 1540 | 1289 | 238 | 13 |
| After | 1545 | 1330 | 202 | 13 |

50 tests that failed before pass after. 14 tests fail after that passed before, and all 14 are `EPERM` on temp-directory cleanup in `guard3.test.js` and `verbosity-remind.test.js`, two suites that fail 80-90% of their tests on Windows either way. That failure class moves between runs (155 `EPERM` failures before, 138 after), so it is Windows file-locking noise from the `[BUG-058]` family, not the hook. **No non-`EPERM` test changed from pass to fail.** WSL Ubuntu on this machine has gh but no node, so the Linux side is reasoned, not measured: Y uses only platform-neutral Node APIs, and the CI matrix is the measurement (AC7).

G1 alone meets criterion 2. G2 is the belt-and-suspenders layer: it covers what a preload cannot see, and it makes the bypassed case fail locally rather than on GitHub. G2′ is recorded because "set an invalid token" is the intuitive form, and the measurement shows it is the wrong one.

## Solution

1. **`tests/helpers/gh-intercept.mjs` (new, ~30 lines).** On import it wraps `spawn`, `spawnSync`, `execFile` and `execFileSync` of `node:child_process`, then calls `syncBuiltinESMExports()`. A call whose file is `gh` or `gh.exe` (by basename, case-insensitive) is rewritten to `process.execPath [fake-gh-cli.mjs, …args]` when `FAKE_GH_STATE` is set, and dies with `CC_REAL_GH_BLOCKED` (exit 97) when it is not. Any other file passes through untouched. A `Symbol.for` marker keeps the wrap idempotent, because vitest re-runs setup files per test file in a shared worker.
2. **`tests/helpers/fake-gh.js`.** Drops the sh wrapper and the `bin/` directory. Exports `GH_HOOK`, the `--import=<file URL>` flag (a URL, not a path: BUG-058 cause 2). `env()` returns `base` plus `FAKE_GH_STATE`, `FAKE_GH_LOG`, and `NODE_OPTIONS` with `GH_HOOK` appended if absent. `PATH` is no longer touched. `calls`, `state`, `update`, `cleanup` and the `issue`/`pull` builders are unchanged, so no consuming test changes for the fake.
3. **`tests/helpers/gh-guard.js` (new, vitest `setupFiles`).** Imports the intercept into the worker, appends `GH_HOOK` to `process.env.NODE_OPTIONS` so every spawned node child inherits it, points `GH_CONFIG_DIR` at a fixed empty dir under `os.tmpdir()`, and deletes the four token variables.
4. **`vitest.config.js`.** One line: `setupFiles: ['tests/helpers/gh-guard.js']`.
5. **`tests/scripts/ticket.test.js:306`.** The "gh is not on PATH" test passes `NODE_OPTIONS: ''` beside its empty `PATH`. Without it the guard fires first (measured: exit 97, not 1), because the intercept cannot know `PATH` is empty. Its empty `PATH` is itself the guarantee that no real gh is reachable, so this is the one deliberate opt-out, commented as such.

`fake-gh-cli.mjs` and every production file are unchanged.

## Behavior

### Main path

1. vitest loads `gh-guard.js` before each test file: the worker is armed, `process.env` carries the hook and no gh credentials.
2. A test calls `fakeGh(state).env()` and spawns `ticket.mjs` or `orchestrate.mjs`. The child, and any node grandchild, loads the intercept through `NODE_OPTIONS`.
3. `ticket.mjs:70` calls `spawnSync('gh', args)`. The intercept sees `FAKE_GH_STATE` and runs `fake-gh-cli.mjs` under the same node. Identical on Linux, macOS and Windows.

### Alternative paths

- **A test forgets `fakeGh().env()`** but inherits `process.env`: the first gh call dies `CC_REAL_GH_BLOCKED`, exit 97, before any spawn.
- **A test calls gh in the worker itself:** the call throws (vitest's `process.exit` trap), naming exit code 97.
- **A test builds its env from scratch**, without `NODE_OPTIONS`: the preload is absent, and the env also lacks a token and has whatever `GH_CONFIG_DIR` it was given. That is the gap G2 narrows and cannot close; the plan's dependency check greps for such spawns near gh.
- **gh reached through a shell string or a non-node script:** G1 cannot see it; G2 leaves gh with no credentials, and it exits 4 locally.
- **A developer's `NODE_OPTIONS`** (e.g. `--input-type=module`): kept; the hook is appended, never substituted.

### Error cases

- **Node older than 20.6**, where `--import` is not allowed in `NODE_OPTIONS`: every node child refuses to start and the suite goes red. Fail-closed by construction. CI's `node: '20'` resolves to the newest 20.x, and `conductor-db.test.js` already depends on `--import`.
- **The intercept file missing or broken:** every node child fails to load it. Loud, not silent.

## Acceptance Criteria Mapping

- [ ] AC1 (criterion 1): on Windows, `ticket.test.js` and `orchestrate.test.js` pass with every gh call served by the fake: `fakeGh().calls()` records them and no real gh runs. Measured POC: 168 of 169 on Windows; the remaining failure is outside this item.
- [ ] AC2 (criterion 2, child): a node child that spawns `gh` without `fakeGh().env()` exits 97 with stderr starting `CC_REAL_GH_BLOCKED: `, and writes nothing to stdout.
- [ ] AC3 (criterion 2, depth): the same through a node → node hop.
- [ ] AC4 (criterion 2, in process): `spawnSync('gh')` and `execFileSync('<dir>/gh.exe')` in the test worker throw before spawning.
- [ ] AC5 (fake still routes): the AC2 call under `fakeGh().env()` reaches the fake with argv intact and no `CC_REAL_GH_BLOCKED`.
- [ ] AC6 (suspenders): in the worker, the four token variables are unset and `GH_CONFIG_DIR` is an empty directory.
- [ ] AC7: the full suite passes on the Linux CI matrix (`node: ['20', '24']`), with no new skip (`tools/skip-baseline.json` unchanged).

AC2-AC6 run on every platform; none skips on win32 or POSIX. Their gh argv is `--version`, so a red run, before the guard exists, reaches nothing that writes.

## Pillar Justification

- **Pillar 5 (Infrastructure, Ecosystem and QA), primary.** The test harness stops being able to write to production, on every OS, which is the precondition for `[BUG-058]`'s Windows leg. One mechanism replaces a platform-specific one, so the fake and the guard cannot drift apart per platform.
- **Pillar 1 (minimalism).** Two new helper files of about 30 and 15 lines, one config line, one test-env edit; the sh wrapper and the `bin/` directory are deleted. No production change.
- **Zero dependency.** `node:child_process`, `node:module`, `node:fs`, `node:os`, `node:path`, `node:url` only. `package.json` is untouched.
- **Fail-closed.** Every failure mode of the guard is a red suite or a local exit 4, never a request to GitHub.

## Predicted Test Counts

| Scope | Before | After | Delta |
|---|---|---|---|
| `tests/unit/gh-guard.test.js` (new) | 0 | 5 | +5 (AC2-AC6) |
| `tests/scripts/ticket.test.js` | 57 | 57 | 0 (one env edited) |
| `tests/scripts/orchestrate.test.js` | 112 | 112 | 0 |
| Full suite, Windows LF export (POC-measured) | 1540 | 1545 | +5, 0 new skips |
| Full suite, Linux CI legs | N | N + 5 | +5, 0 new skips |
| Windows, the two fake-gh suites (LF checkout) | 23 failed / 169 | 1 failed / 169 | −22 failures (POC-measured) |

N is the current total on each CI leg, which the PR description states. The Windows total omits one suite that does not load there (`[BUG-058]`), so N may exceed 1540.

## Out of Scope

- `[BUG-058]` and its five causes, including the Windows CI leg itself. The 23rd baseline failure, `orchestrate.test.js:262` `halts with ORCH_RUN_INVALID on an unreadable run file`, fails on Windows for a reason unrelated to gh: production normalizes the hint path to `/` (`scripts/orchestrate.mjs:79`, `scriptRef`), while the test's expected string uses a bare `relative(root, SCRIPT)`, which yields `\` on win32. It is reported to the operator, not fixed here.
- Production `scripts/ticket.mjs` and `scripts/orchestrate.mjs`: unchanged.
- The release and its records, per `CONTRIBUTING.md` "Records are owner-side".

## System Impact

- New: `tests/helpers/gh-intercept.mjs`, `tests/helpers/gh-guard.js`, `tests/unit/gh-guard.test.js`.
- Modified: `tests/helpers/fake-gh.js` (wrapper removed, `GH_HOOK` exported, `env()` rewritten), `vitest.config.js` (`setupFiles`), `tests/scripts/ticket.test.js:306` (opt-out).
- Every test file now runs with the hook in `NODE_OPTIONS`. The POC full-suite comparison above is the Windows evidence that no other suite changes outcome; the Linux CI legs are the POSIX evidence.

### Files Requiring Full Read (deferred to /cc-plan)

- `tests/helpers/fake-gh.js` (34 lines) and `tests/helpers/fake-gh-cli.mjs` around `:1-20`.
- `tests/scripts/ticket.test.js:300-316`.

## Complexity Estimate

S: two small helpers, one config line, one test-env edit, one five-test file. No production code.
