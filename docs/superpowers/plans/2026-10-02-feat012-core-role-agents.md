# FEAT-012 Core Role Agents and Guard 7 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (native tasks). T-002 adds one fresh read-only reviewer (see Routing). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship five band role agents (`spec`, `plan`, `code`, `audit`, `qa`) with exact tool masks and prompts of 999 tokens or fewer, close the Bash seam with Guard 7, and make `orchestrate.mjs start` resolve, check and record the one test command `code` and `qa` may run. Ship as `1.37.0`.

**Architecture:**
- **`scripts/orchestrate.mjs`** gains `SHELL_METACHARACTERS` (the authority), `PM_TEST_COMMAND`, `resolveTestCommand(root)` (D6), `checkTestCommand(command)` (D7), and a `test_command` field in the run file. `start` resolves and checks before it clears a stale run or writes anything.
- **Guard 7** joins `.claude/hooks/pre-tool-use.mjs` and its `project-template/` mirror, registered first on `Bash`, ahead of Guard 3. It carries a pinned copy of the metacharacter set, and reuses Guard 5's ancestor walk and Guard 6's run-file reader.
- **Five profiles** at `project-template/.claude/agents/<role>.md`, mirrored byte-identically into `.claude/agents/`. The installer's whole-directory copy deploys them with no installer change.
- **`/cc-orchestrate`** documents the two start halts and briefs `code` and `qa` to run exactly the recorded command.

**Tech Stack:** Node ≥ 20 ESM, zero-dependency scripts, vitest, the `tools/` instruments.

**Spec:** `docs/superpowers/specs/2026-10-02-feat012-core-role-agents-design.md`, APPROVED 2026-10-02 (`f63860b`).

## Global Constraints

- **Release:** `1.37.0`, a minor release. Branch `feat/feat-012-core-role-agents`.
- **No SNAP contract change (AC13).** `scripts/snap-contract.mjs` is unchanged; so are `scripts/detect-stack.mjs` and `lib/installer/*`.
- **The metacharacter set, verbatim, in both copies:** `[';', '&', '|', '`', '$(', '<', '>', '\n', '\r']`.
- **The D6 map, verbatim:** `npm` → `npm test`, `pnpm` → `pnpm test`, `yarn` → `yarn test`, `bun` → `bun run test`; no lockfile → `npm test`.
- **Guard 7's registration:** `Bash: [guard7RoleShell, guard3BashScan]`.
- **The token ceiling:** `ceil(bytes / 4) <= 999` over the whole profile file, frontmatter included.
- **Baseline:** this item adds passing tests only, so `tools/skip-baseline.json` does not change.
- **Staging:**
  - `git add -u <path>` for a tracked file.
  - Plain `git add <path>` for a new file outside an ignored directory.
  - Plain `git add <path>` for a new file at a tracked surface, only once its leaf is in `.gitignore` (measured: rc 0 for `.claude/agents/*.md` and this plan with their leaves in).
  - Never a bare `git add -u`.
  - Every task's staging line names this plan file (`[BUG-054]` interim rule).
- **Interim constraints, binding on every task:**
  - never run the installer in this repository (`[BUG-052]`);
  - never run the pre-commit test gate from a linked worktree, so no `isolation: "worktree"` (`[BUG-053]`);
  - run conductor scripts from source `scripts/` (`[BUG-051]`).
- **Never start an `orchestrate.mjs` run or invoke `/cc-orchestrate` in this repository.** The tests start runs only inside fresh tmpdirs.
- **Never apply a Guard 7 mutant to this repository's hook.** The hook is live on every tool call this session makes. Mutants run only in a scratch clone.
- **Instruments and records are edited only through Write or Edit.**
- **Owner-only actions:** the agent opens the PR and stops at green. The merge and the GitHub Release `v1.37.0` are the owner's.

## Predictions, per environment

Every number below was derived on paper first, then measured on 2026-10-02 in an independent `git clone --no-hardlinks` of `f63860b` in the session scratchpad: not a linked worktree (`[BUG-053]`), no hooks installed, `node_modules` symlinked. The clone's baseline read **1237 / 0 across 46 files**, equal to the record.

**Per environment** (unchanged from the 1.36.0 closeout, `project.md:2614-2626`):
- **Local** runs every test, 0 skipped.
- **ci-node24** skips 13 (12 conditional `code-conductor-plugin` tests and `heal`).
- **ci-node20** skips 96 (those 13 plus the `node:sqlite` files).

None of the files this plan adds or touches is in any skipped set (`tools/skip-baseline.json` names none of them), so every new test runs on all three legs and only the passed counts move.

| after | local | ci-node20 | ci-node24 |
|---|---|---|---|
| now (`f63860b`, measured) | 1237 / 0, 46 files | 1141 / 96 | 1224 / 13 |
| T-000 plan commit | 1237 / 0 | n/a | n/a |
| T-001 test command at start | **1261 / 0** (+24), 46 files | n/a | n/a |
| T-002 Guard 7 | **1300 / 0** (+39), 47 files | n/a | n/a |
| T-003 profiles | **1331 / 0** (+31), 48 files | n/a | n/a |
| T-004 `/cc-orchestrate` | **1332 / 0** (+1) | n/a | n/a |
| T-005 README and release | **1332 / 0** | **1236 / 96**, `SKIP_BASELINE_OK` | **1319 / 13**, `SKIP_BASELINE_OK` |

**Arithmetic:**
- **The delta is 24 + 39 + 31 + 1 = 95.**
- **Local:** 1237 + 95 = 1332.
- **ci-node20:** 1141 + 95 = 1236 passed, and 1236 + 96 = 1332.
- **ci-node24:** 1224 + 95 = 1319 passed, and 1319 + 13 = 1332.

**Where the 95 come from:**
- **T-001, +24** in `tests/scripts/orchestrate.test.js` (50 → 74): lockfile ×4, no lockfile ×1, no script with a detect-stack fallback ×1, blank and non-string script ×2, unparseable `package.json` ×1, non-JS ×1, nothing resolves ×1, AC9 unsafe ×1, D7 per metacharacter ×9, the set pin ×1, the stale-run-kept halt ×1, D9 ×1. Two FEAT-011 assertions are amended in place, with no new test.
- **T-002, +39** in the new `tests/hooks/guard7.test.js`: R1 ×3, R2 ×9, R2-before-R4 ×1, R3 ×5, the ancestor walk ×1, R4 ×4, R5 ×2, fail-closed ×1, not-handled ×2, registration ×1, the Guard 3 order ×1, AC7 pin ×1, AC10 ×6, AC11 ×2.
- **T-003, +31** in the new `tests/unit/role-profiles.test.js`: the directory set ×1, then ×5 each for AC1, AC2, AC3, AC4, AC5 and `findAgent`.
- **T-004, +1** in `tests/installer/commands-parity.test.js` (32 → 33).

**Measured in the clone:** per file, `orchestrate.test.js` **74 / 74**, `guard7.test.js` **39 / 39**, `role-profiles.test.js` **31 / 31**, `commands-parity.test.js` **33 / 33**. The full run with every draft applied, this plan's leaf included, read **1332 / 0, 48 files**. The intermediate rows are derived from the per-file measurements; no file's count depends on a later task.

**One derivation slip, recorded rather than absorbed.** The first clone run of the `orchestrate.test.js` draft read **1 failed / 73 passed**, against 74 / 74 derived. The failure was `[AC8] reads a non-string scripts.test as no test script`: the halt named `detect-stack returned no result` instead of the missing script. Cause: a non-string `scripts.test` makes detect-stack itself throw (`s.test.trim()` at `scripts/detect-stack.mjs:599`), which its `uncaughtException` handler turns into `{}`. The draft then checked `package.json` after spawning detect-stack. Fix: `resolveTestCommand` reads the script first (P4). Re-measured 74 / 74. The draft below is the fixed one.

**Red splits, each measured in the clone:**

| step | command | match set | measured |
|---|---|---|---|
| T-001-B | `npx vitest run tests/scripts/orchestrate.test.js` | the whole file, against the unedited router | file fails to load (missing exports `SHELL_METACHARACTERS`, `checkTestCommand`): `Test Files 1 failed (1)`, `Tests no tests` |
| T-001-D | the same, after the router edit | 74 tests | **74 / 74** |
| T-002-B | `npx vitest run tests/hooks/guard7.test.js` | 39 tests, against the unedited hook | **27 failed / 12 passed** |
| T-002-F | the same, after both hook edits | 39 tests | **39 / 39** |
| T-003-B | `npx vitest run tests/unit/role-profiles.test.js` | 31 tests, no profiles | **31 failed / 0 passed** |
| T-003-E | the same, with all ten profile files | 31 tests | **31 / 31** |
| T-004-B | `npx vitest run tests/installer/commands-parity.test.js` | 33 tests, unedited command | **1 failed / 32 passed**, the new test |
| T-004-D | the same, after both mirrors | 33 tests | **33 / 33** |

**Why T-002-B passes twelve tests on the unedited hook.** The unedited hook has only Guard 3 on `Bash`, so every case expecting *no decision* passes: the ancestor walk ×1, R5 ×2, not-handled ×2, AC10 ×6 (start is T-001's and already works), and AC11's qa `Edit`, which Guard 5 already denies. The 27 that fail are every expected Guard 7 deny (R1 3, R2 9, R2-before-R4 1, R3 5, R4 4, the Guard 3 order 1, AC11 code 1) and the three tests that import the hook's Guard 7 names (fail-closed, registration, AC7).

**Guard 7 mutants, each derived before it was measured in the clone:**
- **G1:** dropping the `session_id` comparison turns the stale R3 case red (1).
- **G2:** a prefix match (`startsWith`) instead of equality turns R4 `npm test --watch` and `npm test ` red (2).
- **G3:** R3 and R4 before R2 turns all nine R2 cases and the R2-before-R4 test red (10).
- **G4:** removing the `try`/`catch` turns the fail-closed test red (1).
- **G5:** registering after Guard 3 (`push`) turns the registration and the Guard 3 order tests red (2).
- **G6:** giving `audit` a shell turns R1 audit red (1).
- **G7:** dropping `'\r'` from the hook's set turns R2 `"\r"` and the AC7 pin red (2).

All seven matched. The script is `mutants.mjs` (Routing, T-002's reviewer).

**Halt rule:** any count that differs from its row halts the task before its commit. A prediction is amended before it is measured, never absorbed after.

## Routing

| Task | Route | Ground |
|---|---|---|
| T-000, T-001, T-003, T-004, T-005 | native | sequential, each applying a measured draft |
| T-002 | native, then a fresh read-only reviewer | a guard that can deny tools in the live session earns a fresh reviewer's gate, as Guards 5 and 6 did |

**The T-002 reviewer** (one `Agent` call, general-purpose, no worktree, no writes in this repository, no commit):
- makes its own `git clone --no-hardlinks` of this repository at T-002's commit in the scratchpad and symlinks `node_modules`;
- confirms the hook's sha256 prefix `70ce2a2e669a6e50` in both mirrors;
- re-runs G1–G7 in that clone only, expecting 1, 2, 10, 1, 2, 1, 2 failures by the titles listed above;
- returns a ≤200-word verdict and its handoff-observation line.

## Review Focus

1. **A host `package.json` whose `test` script is blank or not a string.** Expected: `ORCH_TEST_COMMAND_UNRESOLVED` naming the missing script, never detect-stack's crash. Pinned by T-001's blank and non-string cases.
2. **An agent paraphrasing the command** (a flag, a trailing space, a leading space). Expected: `ROLE_SHELL_NOT_ALLOWED`, naming the exact command so the agent can retry. Pinned by T-002's R4 ×4.
3. **A run file left behind by a crashed session, with a role dispatched later.** Expected: the role has no shell (`ROLE_SHELL_UNRESOLVED`), matching the router's refusal of a stale run. Pinned by T-002's stale R3 case.
4. **A role working from a subdirectory.** Expected: the run file is found by the same ancestor walk Guard 5 uses, and the recorded command is allowed. Pinned by T-002's ancestor-walk test.
5. **`start` halting while another session's stale run is on disk.** Expected: the stale run and its envelope are left exactly as they were, so Guard 6 keeps warning and `end` still clears them. Pinned by T-001's stale-run-kept test.

## Pre-flight analysis (critical-review Phase 1)

**Happy path.**
1. `start` resolves `npm test` (for example), checks it, and records it.
2. `code` edits inside its scope, runs `npm test` (R5), and hands back `build_executed` with the result.
3. `audit` reviews with Read, Grep and Glob only and hands back `build_executed`.
4. `qa` runs `npm test` (R5); exit 0 hands back `verify_pass`.

**Failure points:**
- **The live hook.** The edited hook runs on every Bash call this session makes. A `ReferenceError` in a registered guard fails closed on every Bash call. Mitigated by:
  - the section first (constants and functions, unregistered), the registration line last (FEAT-011's P15 order);
  - Guard 7 returning `null` before any other line for a payload with no `agent_type`, which is this session's;
  - a smoke run of the hook after each edit, which catches what `node --check` cannot.
- **detect-stack as a child process.** Imported, it installs `uncaughtException` and `unhandledRejection` handlers that print `{}` and exit 0 (`scripts/detect-stack.mjs:663-673`), which would swallow the router's own crashes. It is spawned (P3). It answers `{}` on any failure, which halts rather than defaulting (P5).
- **An invisible byte.** The Edit tool decoded a `\uFEFF` escape into a literal U+FEFF during drafting. T-001-C checks for the escape by grep.
- **Auto-delegation.** Claude Code can pick a project agent by its `description`. Every description therefore ends `Dispatched only by /cc-orchestrate during a run; never use it for ad-hoc work.` A role used outside a run still has no envelope; see Residual risk in the spec.

**Boundary conditions:**
- the recorded command plus one trailing space, or plus `&& x`;
- an empty, absent, non-string or unparseable test script;
- a lockfile with no `package.json` (detect-stack then names no JS command, so the non-JS rule applies);
- a run file without `test_command` (a 1.36.0 run file);
- a payload without `session_id`;
- `CC_GUARD3_WARN=1` on a role's dump-pattern command.

## Rulings in this plan (each is the owner's to overturn)

- **P1, D9 resolved: `v` stays 1, and `test_command` is additive.**
  - `isValidRun` (`scripts/orchestrate.mjs:68-72`) checks that required keys are present and never rejects an unknown one.
  - Guard 6's `readRunFile` (`.claude/hooks/pre-tool-use.mjs:201-207`) checks only that the file is an object with a non-empty `session_id`.
  - `snap-validate` never reads the run file.
  - So neither reader is strict-keyed, and the field needs no version bump. `isValidRun` is **not** extended to require it: a 1.36.0 run file still routes, and Guard 7's R3 refuses its roles a shell. A test pins this (`[D9]`).
  - **The invariant holds:** Guard 7 allows a command only from a run file that parses, binds this session and records a non-empty string, which is R3 as the spec enumerates it.
- **P2, D10 resolved: one authority, one pinned copy.**
  - The hook cannot import from `scripts/`, because no relative path resolves from both install locations (the reason Guard 5 states at `:122-124` and Guard 6 at `:194-195`).
  - `orchestrate.mjs` cannot import the hook, because the hook runs `main()` and reads stdin at its last line (`:750`).
  - So `orchestrate.mjs` exports `SHELL_METACHARACTERS` as the authority, beside `WRITE_SURFACE`, and the hook carries `ROLE_SHELL_METACHARACTERS`.
  - `guard7.test.js` pins the copy by evaluating the hook with `main` cut, not by a regex over its source, because the set holds a backtick and two escapes.
  - AC7's "a single constant that Guard 7 and `start` use" is read as D7's own wording: "a single shared constant, pinned equal in both copies by test".
- **P3, detect-stack is spawned, not imported.** It is a sibling of `orchestrate.mjs` in both layouts: `lib/installer/deploy.mjs:212` copies `scripts/` whole, `claude-md-fields.mjs` included.
- **P4, the script is checked before detect-stack runs.** A non-string or blank `scripts.test` counts as no test script. Measured: a non-string script makes detect-stack fail whole, so checking it afterwards named the wrong cause (the derivation slip above). detect-stack's own crash on a non-string script is outside FEAT-012 (the spec leaves detect-stack unchanged). **The owner decides** whether that crash becomes a dossier or a mint; this plan files nothing.
- **P5, a detect-stack failure halts.** Output that is `{}` or does not parse halts `ORCH_TEST_COMMAND_UNRESOLVED: detect-stack returned no result for <root>`. The `npm test` default applies only when detect-stack answered and named no lockfile, so a bun project whose detection failed is never recorded as `npm test`.
- **P6, resolution runs after the two start checks and before the stale clear.** Spec step 1 lists stale replacement among the preconditions. The checks (`ORCH_NO_SESSION_ID`, `ORCH_RUN_ACTIVE`) stay first; the destructive clear moves after resolution, so a halt leaves a stale run and its envelope as they were (Review Focus 5).
- **P7, `start` prints the command on its one line:** `run <ITEM> started; test command: <command>`, or `replaced the stale run <ITEM> started <iso>; test command: <command>`. FEAT-011's stale-replacement assertion is amended in place.
- **P8, the start halt texts, verbatim:**
  - `ORCH_TEST_COMMAND_UNRESOLVED: package.json has no scripts.test; add a test script, the run does not guess a runner`
  - `ORCH_TEST_COMMAND_UNRESOLVED: <root>/package.json does not parse, so its test script cannot be read`
  - `ORCH_TEST_COMMAND_UNRESOLVED: detect-stack returned no result for <root>`
  - `ORCH_TEST_COMMAND_UNRESOLVED: detect-stack names no test command for <root>`
  - `ORCH_TEST_COMMAND_UNSAFE: <JSON command> contains <JSON character>, which Guard 7 denies; nothing was recorded`

  Like the other start halts, they are not recorded in the run file (`cli` skips `recordHalt` for `start`).
- **P9, Guard 7's deny texts carry the `Guard 7: ` prefix,** as Guards 5 and 6 do, with the spec's code strings verbatim after it:
  - `Guard 7: ROLE_SHELL_DENIED: <role> has no shell.`
  - `Guard 7: ROLE_SHELL_CHAINING: the command contains <JSON character>; a role runs one command, never a chain.`
  - `Guard 7: ROLE_SHELL_UNRESOLVED: no live run in this session records a test command, so <role> has no shell.`
  - `Guard 7: ROLE_SHELL_NOT_ALLOWED: allowed command is <test_command>`
  - `Guard 7: ROLE_SHELL_UNRESOLVED: the guard could not decide (<message>), so the call is denied.`
- **P10, Guard 7 runs before Guard 3 on `Bash`.** Under `CC_GUARD3_WARN` Guard 3 asks instead of denying (`:658`), and the dispatch loop takes the first decision, so Guard 3 first would hand a role an ask where Guard 7 denies. Pinned by the order test and G5.
- **P11, R3 reads exactly the spec's four conditions, so a halted run still allows its recorded command.** A halt stops routing; the command is the owner's own test script. Overturning it adds `|| run.halt` to `liveTestCommand` and one test.
- **P12, Guard 7 catches its own errors.** The front door's last-line catch would deny too, but `CC_HOOK_ALLOW` lifts that denial, and that override is scoped to unparseable input. A local `catch` keeps Guard 7 fail-closed under it.
- **P13, AC1's "tools list exactly"** is pinned as the frontmatter line `tools: A, B, C` in D2's order.
- **P14, the token measure normalizes CRLF to LF.** The repository sets no eol rule for `.md` and CI is Ubuntu, so the committed bytes are LF. A CRLF checkout adds about 30 bytes per profile; the largest profile measures 503 tokens.
- **P15, audit's "produced diff" is read as the files the plan's `**Files:**` blocks name, in their current state.** audit has no shell (D3), so it cannot run `git diff`.
- **P16, the installer overwrites a host's same-named agents.** `deployProject` copies `project-template/.claude/` with `force: true` (`lib/installer/deploy.mjs:25`, `:188`), so a host's own `.claude/agents/code.md` is replaced on install and update. The spec rules out installer changes, and a host-owned row would freeze the profiles at first install, so this plan states it as a README Known limit. **Recommended: keep it a stated limit.** The alternative is a separate item.
- **P17, the profile descriptions forbid ad-hoc use** (Pre-flight, auto-delegation). It is cooperation, not enforcement.
- **P17a, the plan profile's 19-file limit has a cited ground** (owner's approval-round fix). `V3_CAPS['ops.scope']` is `[20, 300]` (`scripts/snap-contract.mjs:34`); `taskScope` puts the plan file into every task's scope (`scripts/orchestrate.mjs:142`) and halts `ORCH_SCOPE_OVER_CAP` above the cap (`:143-144`), so a task can name at most 19 files. The profile names the mechanism and the halt code rather than a file:line, because line numbers in a shipped profile drift in a host install. Re-measured: 2089 bytes, 523 tokens; the suite stays 1332 / 0.
- **P18, the "FEAT-011's D10" carry-forward, measured.** Spec line 249 asks T-004 to drop FEAT-011's D10 fixture note from `cc-orchestrate.md`. At `f63860b` that file carries no such note: a grep of it for `D10`, `fixture` and `ship` returns nothing. The note FEAT-011's D10 left ("none of which ship yet", "No role agent definitions ship until `[FEAT-012]`") is in `README.md:125` and `:231`, and T-005 drops it there. The spec is not re-committed for this (owner ruling, 2026-10-02).

---

- [X] [T-000] **Plan commit.** The branch gate is silent: the current branch `feat/feat-012-core-role-agents` carries the item's id. `origin/main` is `4428cb4`, an ancestor of `HEAD`, so there is nothing to merge.
  - [X] [T-000-A] Modify `.gitignore`: insert `!/docs/superpowers/plans/2026-10-02-feat012-core-role-agents.md` immediately after `!/docs/superpowers/plans/2026-10-01-feat011-orchestrator-band-router.md` (:99), in sorted position.
  - [X] [T-000-B] Modify `.claude/memory/project.md`: append at the end of the file
    ```markdown

    ## Plan: FEAT-012 implementation [2026-10-02]

    Plan `docs/superpowers/plans/2026-10-02-feat012-core-role-agents.md`.
    - **Approval:** APPROVED 2026-10-02 after a full review ("arithmetic re-derived, red splits checked case by case, the four test files recounted against their drafts, mutants G1-G7 checked against their declared discriminators, and the D5/AC4/AC5 phrase pins verified against all five profiles. The counts hold on all three legs."). Rulings, quoted:
      1. "Routing: Native, with the fresh read-only reviewer on T-002 as planned."
      2. "P11 stands as specified: R3 reads the spec's four conditions and a halted run still allows its recorded command. Overturning it would amend the approved spec for no measured need. If a halted run's shell ever proves harmful, that is a future item with its own evidence."
      3. "P16 stands as a README Known limit. A host-owned row for agents is registered as an intake candidate on my list, not this item's work."
      4. "P4, the detect-stack crash on a non-string scripts.test: record it as a dossier in the closeout, and I mint it by the normal process there, ceiling run on both legs first. The plan files nothing, as written."
      5. "P17 is accepted as a named risk; cooperation is what a description can give."
    - **Fix before T-000:** the plan profile's "19 files or fewer" now cites its ground (P17a: `snap-contract.mjs:34`, `orchestrate.mjs:142-144`); re-measured 2089 bytes, 523 tokens, sha256 `3f1c61b66519fce2`.
    - **D9:** `v` stays 1; `test_command` is additive; neither run-file reader is strict-keyed. **D10:** one authority in `orchestrate.mjs`, one pinned copy in the hook.
    - **Routing:** native, with a fresh read-only reviewer on T-002 re-running mutants G1–G7 in a scratch clone.
    - **Predictions,** measured on drafts in a scratch clone: local 1237 → 1332 / 0 (+95), 48 files; ci-node20 1236 / 96; ci-node24 1319 / 13.

    Handoff observations, one line per task:
    ```
  - [X] [T-000-C] `git add -u .gitignore .claude/memory/project.md`, then `git add docs/superpowers/plans/2026-10-02-feat012-core-role-agents.md` (plain, now that its leaf exists).
  - [X] [T-000-D] Commit `docs: add the FEAT-012 implementation plan [FEAT-012]`. Expected: the hook suite passes at **1237 / 0**.
  - [X] [T-000-E] Run `node tools/id-ceiling.mjs`, expecting union `{"BUG":54,"FEAT":40,"ARCH":10}`, next `BUG-055`. Then `node tools/record-parity.mjs`, expecting `RECORD_PARITY_OK`.
  - [X] [T-000-F] Append `- T-000: <one line of handoff observation>` under the plan section. This line rides T-001's commit.

- [X] [T-001] **The test command at run start** (D6, D7, D9; AC8, AC9). Native. Depends on T-000.

  **Files:**
  - Modify: `scripts/orchestrate.mjs:36` (constants), `:170-173` (after `runScript`), `:283-289` (`start`)
  - Modify: `tests/scripts/orchestrate.test.js:7-22`, `:201`, `:231`, and append after `:408`

  **Interfaces produced:** `SHELL_METACHARACTERS: string[]`, `PM_TEST_COMMAND: Record<'npm'|'pnpm'|'yarn'|'bun', string>`, `resolveTestCommand(root: string): string` (throws `Halt`), `checkTestCommand(command: string): string` (throws `Halt`), and the run file's `test_command: string`. T-002 imports `RUN_FILE` and `SHELL_METACHARACTERS` and spawns `start`.

  - [X] [T-001-A] Modify `tests/scripts/orchestrate.test.js`.
    - Replace the import block and the setup (`:7-22`) with:
      ```js
      import {
        ENVELOPE_FILE, HANDBACK_DIR, MAY_HAND_BACK, ROLE_ARTIFACTS, RUN_FILE, SHELL_METACHARACTERS, WRITE_SURFACE,
        checkTestCommand, extractTasks, findAgent, forwardGate, isValidRun, nextStep, taskScope,
      } from '../../scripts/orchestrate.mjs';

      const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
      const SCRIPT = join(REPO_ROOT, 'scripts/orchestrate.mjs');
      const ROLES = ['spec', 'plan', 'code', 'audit', 'qa'];
      const PLAN = 'docs/superpowers/plans/demo.md';
      // Every root gets a test script with no lockfile, so start records `npm test` (FEAT-012 D6).
      const PKG = '{"scripts":{"test":"vitest run"}}';

      let root, home;
      beforeEach(() => {
        root = realpathSync(mkdtempSync(join(tmpdir(), 'cc-orch-root-')));
        home = realpathSync(mkdtempSync(join(tmpdir(), 'cc-orch-home-')));
        mkdirSync(join(root, '.claude', 'memory'), { recursive: true });
        writeFileSync(join(root, 'package.json'), PKG);
      });
      ```
    - At `:201`, the `toMatchObject` gains `test_command: 'npm test'` after `halt: null`.
    - At `:231`, the expected string becomes `` `replaced the stale run FEAT-011 started ${started}; test command: npm test` ``.
    - Append after the `write surface [FEAT-011 AC4]` describe (`:408`):
      ```js

      describe('test command [FEAT-012 AC8, AC9]', () => {
        const start = () => orch(['start', 'FEAT-012']);
        const files = (map) => {
          for (const [rel, text] of Object.entries(map)) {
            mkdirSync(dirname(join(root, rel)), { recursive: true });
            writeFileSync(join(root, rel), text);
          }
        };
        const unresolved = (reason) => {
          const r = start();
          expect(r.status).toBe(1);
          expect(r.err).toBe(`ORCH_TEST_COMMAND_UNRESOLVED: ${reason}`);
          expect(existsSync(join(root, RUN_FILE))).toBe(false);
        };
        const NO_SCRIPT = 'package.json has no scripts.test; add a test script, the run does not guess a runner';

        it.each([
          ['package-lock.json', 'npm test'],
          ['pnpm-lock.yaml', 'pnpm test'],
          ['yarn.lock', 'yarn test'],
          ['bun.lockb', 'bun run test'],
        ])('[AC8] records the package manager invocation for %s', (lock, expected) => {
          files({ [lock]: '' });
          const r = start();
          expect(r.status).toBe(0);
          expect(r.out).toBe(`run FEAT-012 started; test command: ${expected}`);
          expect(runFile().test_command).toBe(expected);
        });

        it('[AC8] records npm test with no lockfile, the stated default', () => {
          expect(start().out).toBe('run FEAT-012 started; test command: npm test');
          expect(runFile().test_command).toBe('npm test');
        });

        // Discriminator: detect-stack offers jest here, and the run must not take it.
        it('[AC8] halts on a package.json without scripts.test, though detect-stack offers a runner', () => {
          files({ 'package.json': '{"dependencies":{"react":"18.0.0"}}' });
          const detected = spawnSync(process.execPath, [join(REPO_ROOT, 'scripts/detect-stack.mjs'), root], { encoding: 'utf8' });
          expect(JSON.parse(detected.stdout).test).toBe('jest');
          unresolved(NO_SCRIPT);
        });

        it.each([['a blank', '{"scripts":{"test":"  "}}'], ['a non-string', '{"scripts":{"test":true}}']])(
          '[AC8] reads %s scripts.test as no test script', (_, pkg) => {
            files({ 'package.json': pkg });
            unresolved(NO_SCRIPT);
          });

        it('[AC8] halts on a package.json that does not parse', () => {
          files({ 'package.json': '{not json' });
          unresolved(`${join(root, 'package.json')} does not parse, so its test script cannot be read`);
        });

        it('[AC8] records detect-stack\'s value for a stack with no package.json', () => {
          rmSync(join(root, 'package.json'));
          files({ 'go.mod': 'module example.com/demo\n\ngo 1.22\n' });
          expect(start().status).toBe(0);
          expect(runFile().test_command).toBe('go test ./...');
        });

        it('[AC8] halts when nothing names a test command', () => {
          rmSync(join(root, 'package.json'));
          unresolved(`detect-stack names no test command for ${root}`);
        });

        // A root with no package.json takes detect-stack's value as-is, and a workspace's script
        // reaches it verbatim: the one path by which a chaining command can resolve.
        it('[AC9] halts ORCH_TEST_COMMAND_UNSAFE on a resolved command that chains, recording nothing', () => {
          rmSync(join(root, 'package.json'));
          files({
            'pnpm-workspace.yaml': "packages:\n  - 'apps/*'\n",
            'apps/web/package.json': '{"dependencies":{"@angular/core":"17.0.0"},"scripts":{"test":"ng test && echo done"}}',
          });
          const r = start();
          expect(r.status).toBe(1);
          expect(r.err).toBe('ORCH_TEST_COMMAND_UNSAFE: "ng test && echo done" contains "&", which Guard 7 denies; nothing was recorded');
          expect(existsSync(join(root, RUN_FILE))).toBe(false);
        });

        it.each(SHELL_METACHARACTERS)('[D7] checkTestCommand halts on %j', (m) => {
          expect(() => checkTestCommand(`go test ${m} x`)).toThrow(/^ORCH_TEST_COMMAND_UNSAFE: /);
        });

        it('[D7] declares exactly the spec\'s metacharacter set', () => {
          expect(SHELL_METACHARACTERS).toEqual([';', '&', '|', '`', '$(', '<', '>', '\n', '\r']);
        });

        it('a start halt leaves a stale run of another session as it was', () => {
          orch(['start', 'FEAT-011'], { sid: 'old-session' });
          const before = readFileSync(join(root, RUN_FILE), 'utf8');
          writeFileSync(join(root, ENVELOPE_FILE), '{"stale":true}\n');
          files({ 'package.json': '{}' });
          const r = start();
          expect(r.status).toBe(1);
          expect(r.err).toBe(`ORCH_TEST_COMMAND_UNRESOLVED: ${NO_SCRIPT}`);
          expect(readFileSync(join(root, RUN_FILE), 'utf8')).toBe(before);
          expect(existsSync(join(root, ENVELOPE_FILE))).toBe(true);
        });

        // D9: the field is additive, so v stays 1 and a 1.36.0 run file still routes. Guard 7 is
        // what refuses a shell to a run that records no command (R3).
        it('[D9] still validates a run file that records no test_command', () => {
          expect(isValidRun({ v: 1, session_id: 's', item: 'FEAT-011', gate: 'boundary_routed', approvals: {}, handbacks: [], tasks: { ids: [], done: 0 } })).toBe(true);
        });
      });
      ```
  - [X] [T-001-B] Run `npx vitest run tests/scripts/orchestrate.test.js`. Expected: the file fails to load on the missing exports, `Test Files 1 failed (1)`, `Tests no tests`.
  - [X] [T-001-C] Modify `scripts/orchestrate.mjs`.
    - After `const PHASE = …` (:36), insert:
      ```js
      // Guard 7's chaining set (FEAT-012 D7). The hook carries a copy pinned to this one (D10).
      export const SHELL_METACHARACTERS = [';', '&', '|', '`', '$(', '<', '>', '\n', '\r'];
      // D6: each package manager's invocation of the owner's `test` script. `bun test` would run
      // Bun's own test runner and ignore the script, so bun goes through `run`.
      export const PM_TEST_COMMAND = { npm: 'npm test', pnpm: 'pnpm test', yarn: 'yarn test', bun: 'bun run test' };
      ```
    - After `runScript` (closing at :173), insert:
      ```js

      // detect-stack installs process-wide error handlers when imported, so it is spawned. It prints
      // {} on any failure, which answers nothing either way.
      function detectStack(root) {
        let out = null;
        try { out = JSON.parse(runScript('detect-stack.mjs', [root]).out); } catch { /* judged below */ }
        if (isPlainObject(out) && Object.keys(out).length > 0) return out;
        throw new Halt('ORCH_TEST_COMMAND_UNRESOLVED', `detect-stack returned no result for ${root}`);
      }

      // Only a non-blank string is the owner's test script.
      function hasTestScript(pkgPath) {
        let pkg;
        try { pkg = JSON.parse(readFileSync(pkgPath, 'utf8').replace(/^\uFEFF/, '')); } catch {
          throw new Halt('ORCH_TEST_COMMAND_UNRESOLVED', `${pkgPath} does not parse, so its test script cannot be read`);
        }
        const script = pkg?.scripts?.test;
        return typeof script === 'string' && script.trim() !== '';
      }

      // D6: the one command code and qa may run, resolved before anything is recorded. The script
      // is checked before detect-stack runs, because a non-string script makes detect-stack fail
      // whole and the halt would then name the wrong cause.
      export function resolveTestCommand(root) {
        const pkgPath = join(root, 'package.json');
        if (existsSync(pkgPath)) {
          if (!hasTestScript(pkgPath)) {
            throw new Halt('ORCH_TEST_COMMAND_UNRESOLVED', 'package.json has no scripts.test; add a test script, the run does not guess a runner');
          }
          return PM_TEST_COMMAND[detectStack(root).packageManager] ?? PM_TEST_COMMAND.npm;
        }
        const { test } = detectStack(root);
        if (typeof test === 'string' && test.trim() !== '') return test;
        throw new Halt('ORCH_TEST_COMMAND_UNRESOLVED', `detect-stack names no test command for ${root}`);
      }

      // D7: no command is recorded that Guard 7 would not pass.
      export function checkTestCommand(command) {
        const found = SHELL_METACHARACTERS.find((m) => command.includes(m));
        if (found === undefined) return command;
        throw new Halt('ORCH_TEST_COMMAND_UNSAFE', `${JSON.stringify(command)} contains ${JSON.stringify(found)}, which Guard 7 denies; nothing was recorded`);
      }
      ```
    - In `start`, replace from `if (old) clearRunFiles(root);` through the `return` with:
      ```js
        // Resolved before a stale run is cleared, so a halt here leaves everything as it was.
        const testCommand = checkTestCommand(resolveTestCommand(root));
        if (old) clearRunFiles(root);
        saveRun(root, {
          v: 1, session_id: sessionId, item, mode: flag ? 'auto' : 'step', started: new Date().toISOString(),
          band: 'boundary', role: null, gate: 'boundary_routed', approvals: { spec: null, plan: null },
          plan: null, tasks: { ids: [], done: 0 }, handbacks: [], halt: null, test_command: testCommand,
        });
        const begun = old ? `replaced the stale run ${old.item} started ${old.started}` : `run ${item} started`;
        return `${begun}; test command: ${testCommand}`;
      ```
    - Then confirm the escape survived: `grep -c 'uFEFF' scripts/orchestrate.mjs` prints `1`. If it prints `0`, the editor wrote a literal U+FEFF; rewrite that line with the escape before going on. Expected sha256 prefix after this step: `e82d59e409be0807`.
  - [X] [T-001-D] Run `npx vitest run tests/scripts/orchestrate.test.js`. Expected: **74 / 74**.
  - [X] [T-001-E] Run `npm test`. Expected: **1261 / 0**, 46 files. Confirm `git diff --stat scripts/snap-contract.mjs scripts/detect-stack.mjs` is empty.
  - [X] [T-001-F] Append `- T-001: <one line>` under the plan section. Then `git add -u scripts/orchestrate.mjs tests/scripts/orchestrate.test.js .claude/memory/project.md docs/superpowers/plans/2026-10-02-feat012-core-role-agents.md`. Commit `feat: resolve and record the run's test command at start [FEAT-012]`. Expected: **1261 / 0**.

- [X] [T-002] **Guard 7** (AC6, AC7, AC10, AC11). Native, then the reviewer. Depends on T-001 (`SHELL_METACHARACTERS`, and `start` for AC10).

  **Files:**
  - Create: `tests/hooks/guard7.test.js`
  - Modify: `.claude/hooks/pre-tool-use.mjs:245` (section after Guard 6), `:706` (registration)
  - Modify: `project-template/.claude/hooks/pre-tool-use.mjs` (the same two edits)

  **Interfaces:** consumes `RUN_FILE`, `SHELL_METACHARACTERS` and the `start` CLI from T-001; reuses the hook's `findRootHolding`, `payloadCwd`, `readRunFile`, `ORCH_RUN_REL`, `BAND_ROLES` and `deny`. Produces `guard7RoleShell(input, payload)`, `ROLE_SHELL_METACHARACTERS` and `DISPATCH.Bash = [guard7RoleShell, guard3BashScan]`.

  - [X] [T-002-A] Create `tests/hooks/guard7.test.js`:
    ```js
    import { describe, it, expect, beforeEach, afterEach } from 'vitest';
    import { spawnSync } from 'node:child_process';
    import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
    import { tmpdir } from 'node:os';
    import { join, resolve, dirname } from 'node:path';
    import { fileURLToPath, pathToFileURL } from 'node:url';
    import { RUN_FILE, SHELL_METACHARACTERS } from '../../scripts/orchestrate.mjs';

    const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
    const HOOK = join(REPO_ROOT, '.claude/hooks/pre-tool-use.mjs');
    const ORCH = join(REPO_ROOT, 'scripts/orchestrate.mjs');

    // FEAT-011's measured payload shape. A subagent carries agent_id and agent_type; the main
    // session carries neither.
    function bash(command, { cwd, sid = 'sess-1', agentType } = {}) {
      return {
        session_id: sid, transcript_path: '/tmp/t.jsonl', cwd, hook_event_name: 'PreToolUse',
        tool_name: 'Bash', tool_input: { command, description: 'run' }, tool_use_id: 'toolu_1',
        ...(agentType ? { agent_id: 'a7', agent_type: agentType } : {}),
      };
    }

    // CC_GUARD3_WARN is cleared unless a test sets it, so a developer's shell cannot flip a verdict.
    function fire(p, extraEnv = {}) {
      const env = { ...process.env };
      delete env.CC_GUARD3_WARN;
      const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(p), cwd: p.cwd, env: { ...env, ...extraEnv }, encoding: 'utf8', timeout: 15000 });
      if (r.error) throw new Error(`hook spawn failed: ${r.error.message}`);
      expect(r.status).toBe(0);
      return r.stdout.trim() === '' ? null : (JSON.parse(r.stdout).hookSpecificOutput ?? null);
    }

    // The hook runs main() at its last line, so a copy with main cut is what can be imported.
    async function loadHook() {
      const text = readFileSync(HOOK, 'utf8').replace(/try \{ main\(\); \}.*$/s, 'export { DISPATCH, ROLE_SHELL_METACHARACTERS, guard7RoleShell };\n');
      const dir = mkdtempSync(join(tmpdir(), 'cc-guard7-hook-'));
      try {
        writeFileSync(join(dir, 'hook.mjs'), text);
        return await import(pathToFileURL(join(dir, 'hook.mjs')).href);
      } finally { rmSync(dir, { recursive: true, force: true }); }
    }

    let root;
    beforeEach(() => {
      // realpath: the macOS tmpdir is a symlink, and the guards compare paths without resolving links.
      root = realpathSync(mkdtempSync(join(tmpdir(), 'cc-guard7-')));
      mkdirSync(join(root, '.claude', 'memory'), { recursive: true });
    });
    afterEach(() => rmSync(root, { recursive: true, force: true }));

    const runFile = (fields = {}) => writeFileSync(join(root, RUN_FILE), JSON.stringify({
      v: 1, session_id: 'sess-1', item: 'FEAT-012', started: '2026-10-02T12:00:00.000Z', gate: 'boundary_routed', test_command: 'npm test', ...fields,
    }));
    const as = (agentType, command, opts = {}) => fire(bash(command, { cwd: root, agentType, ...opts }));
    const denied = (reason) => ({ hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason });
    const chaining = (m) => denied(`Guard 7: ROLE_SHELL_CHAINING: the command contains ${JSON.stringify(m)}; a role runs one command, never a chain.`);
    const NOT_ALLOWED = denied('Guard 7: ROLE_SHELL_NOT_ALLOWED: allowed command is npm test');
    const PKG = '{"scripts":{"test":"vitest run"}}';

    describe('Guard 7: a band role runs the recorded test command or nothing [FEAT-012]', () => {
      it.each(['spec', 'plan', 'audit'])('[R1] denies %s any shell, the test command included', (role) => {
        runFile();
        expect(as(role, 'npm test')).toEqual(denied(`Guard 7: ROLE_SHELL_DENIED: ${role} has no shell.`));
      });

      it.each(SHELL_METACHARACTERS)('[R2] denies a command carrying %j', (m) => {
        runFile();
        expect(as('code', `npm test ${m} x`)).toEqual(chaining(m));
      });

      it('[R2] precedes R4: the recorded command plus `&& x` is chaining, not a near miss', () => {
        runFile();
        expect(as('qa', 'npm test && x')).toEqual(chaining('&'));
      });

      it.each([
        ['no run file', null],
        ['an unparseable run file', '{not json'],
        ['a run file with no test_command', { test_command: undefined }],
        ['a run file with an empty test_command', { test_command: '' }],
        ['a run of another session, which is stale (P12)', { session_id: 'sess-2' }],
      ])('[R3] denies code the shell with %s', (_, state) => {
        if (typeof state === 'string') writeFileSync(join(root, RUN_FILE), state);
        else if (state) runFile(state);
        expect(as('code', 'npm test')).toEqual(denied('Guard 7: ROLE_SHELL_UNRESOLVED: no live run in this session records a test command, so code has no shell.'));
      });

      it('[R3] finds the run file by the ancestor walk from a subdirectory', () => {
        runFile();
        mkdirSync(join(root, 'sub'));
        expect(fire(bash('npm test', { cwd: join(root, 'sub'), agentType: 'qa' }))).toBeNull();
      });

      it.each(['npm test --watch', 'npm test ', ' npm test', 'ls'])('[R4] denies %j, naming the allowed command', (command) => {
        runFile();
        expect(as('qa', command)).toEqual(NOT_ALLOWED);
      });

      it.each(['code', 'qa'])('[R5] allows %s the recorded command, byte for byte', (role) => {
        runFile();
        expect(as(role, 'npm test')).toBeNull();
      });

      it('fails closed: a throw inside the guard denies', async () => {
        const { guard7RoleShell } = await loadHook();
        const input = { get command() { throw new Error('boom'); } };
        expect(guard7RoleShell(input, { agent_type: 'code', cwd: root, session_id: 'sess-1' })).toEqual({
          permissionDecision: 'deny', permissionDecisionReason: 'Guard 7: ROLE_SHELL_UNRESOLVED: the guard could not decide (boom), so the call is denied.',
        });
      });

      it.each([['the main session', undefined], ['a non-role agent', 'Explore']])('decides nothing for %s, whatever the command', (_, agentType) => {
        runFile();
        expect(as(agentType, 'echo a; echo b')).toBeNull();
      });

      it('registers Guard 7 before Guard 3 on Bash', async () => {
        const { DISPATCH } = await loadHook();
        expect(DISPATCH.Bash.map((g) => g.name)).toEqual(['guard7RoleShell', 'guard3BashScan']);
      });

      // Discriminator: under CC_GUARD3_WARN Guard 3 asks, so Guard 3 first would hand qa an ask.
      it('outranks Guard 3 under CC_GUARD3_WARN, so a role never gets an ask where Guard 7 denies', () => {
        runFile();
        expect(fire(bash('cat *.md', { cwd: root }), { CC_GUARD3_WARN: '1' }).permissionDecision).toBe('ask');
        expect(fire(bash('cat *.md', { cwd: root, agentType: 'qa' }), { CC_GUARD3_WARN: '1' })).toEqual(NOT_ALLOWED);
      });

      it('[AC7] carries the metacharacter set equal to scripts/orchestrate.mjs', async () => {
        const { ROLE_SHELL_METACHARACTERS } = await loadHook();
        expect(ROLE_SHELL_METACHARACTERS).toEqual(SHELL_METACHARACTERS);
      });

      it.each([
        ['npm, by package-lock.json', { 'package.json': PKG, 'package-lock.json': '' }, 'npm test'],
        ['pnpm', { 'package.json': PKG, 'pnpm-lock.yaml': '' }, 'pnpm test'],
        ['yarn', { 'package.json': PKG, 'yarn.lock': '' }, 'yarn test'],
        ['bun', { 'package.json': PKG, 'bun.lockb': '' }, 'bun run test'],
        ['npm, the default with no lockfile', { 'package.json': PKG }, 'npm test'],
        ['go, by detect-stack', { 'go.mod': 'module example.com/demo\n\ngo 1.22\n' }, 'go test ./...'],
      ])('[AC10] the command start records for %s passes Guard 7 as qa', (_, files, expected) => {
        for (const [rel, text] of Object.entries(files)) writeFileSync(join(root, rel), text);
        const r = spawnSync(process.execPath, [ORCH, 'start', 'FEAT-012'], { cwd: root, env: { ...process.env, CLAUDE_CODE_SESSION_ID: 'sess-1' }, encoding: 'utf8', timeout: 30000 });
        expect(r.status).toBe(0);
        const recorded = JSON.parse(readFileSync(join(root, RUN_FILE), 'utf8')).test_command;
        expect(recorded).toBe(expected);
        expect(as('qa', recorded)).toBeNull();
      });

      it('[AC11] code cannot run a general shell command', () => {
        runFile();
        expect(as('code', 'curl https://example.com')).toEqual(NOT_ALLOWED);
      });

      it('[AC11] qa cannot edit a code file: Guard 5 denies its write under a tk X envelope', () => {
        writeFileSync(join(root, '.claude', 'memory', 'band-envelope.json'), JSON.stringify({
          v: 3, sys: { ph: 'rev', c: 'abc1234', s: 'FEAT-012', role: 'qa', tk: 'X' },
          ops: { n: [], f: [], gate: 'build_executed' }, mem: { d: [], x: [] },
        }));
        const edit = { ...bash('', { cwd: root, agentType: 'qa' }), tool_name: 'Edit', tool_input: { file_path: join(root, 'src', 'a.js'), old_string: 'a', new_string: 'b' } };
        expect(fire(edit)).toEqual(denied('Guard 5: BAND_READ_ONLY: role qa holds tk X, not RW.'));
      });
    });
    ```
    Expected sha256 prefix: `1baa5590ee378804`.
  - [X] [T-002-B] Run `npx vitest run tests/hooks/guard7.test.js`. Expected: **27 failed / 12 passed (39)**.
  - [X] [T-002-C] **C1, the section, unregistered.** Modify `.claude/hooks/pre-tool-use.mjs`: insert after `guard6OrchestratorRun`'s closing brace (:245) and before `// ── Guard 3 constants`, separated by one blank line on each side:
    ```js
    // ── Guard 7 constants ─────────────────────────────────────────────────────────
    // A copy of scripts/orchestrate.mjs SHELL_METACHARACTERS (FEAT-012 D10), carried for Guard
    // 5's reason: no import resolves from both install locations. tests/hooks/guard7.test.js pins it.
    const ROLE_SHELL_METACHARACTERS = [';', '&', '|', '`', '$(', '<', '>', '\n', '\r'];
    const ROLE_SHELL_ROLES = ['code', 'qa'];

    // R3: the test command a live run of this session recorded, or null. The run root is found
    // by Guard 5's walk and the file read by Guard 6's reader.
    function liveTestCommand(payload) {
      const root = findRootHolding(payloadCwd(payload), ORCH_RUN_REL);
      if (!root) return null;
      const run = readRunFile(join(root, ...ORCH_RUN_REL));
      if (!run || payload.session_id !== run.session_id) return null;
      return typeof run.test_command === 'string' && run.test_command !== '' ? run.test_command : null;
    }

    // R1-R5, the first match decides. The match is exact: a prefix allowlist is walked around by
    // chaining, which is the T-003 vector.
    function roleShellDecision(role, input, payload) {
      if (!ROLE_SHELL_ROLES.includes(role)) return deny(`Guard 7: ROLE_SHELL_DENIED: ${role} has no shell.`);
      const command = typeof input.command === 'string' ? input.command : '';
      const found = ROLE_SHELL_METACHARACTERS.find((m) => command.includes(m));
      if (found !== undefined) return deny(`Guard 7: ROLE_SHELL_CHAINING: the command contains ${JSON.stringify(found)}; a role runs one command, never a chain.`);
      const allowed = liveTestCommand(payload);
      if (allowed === null) return deny(`Guard 7: ROLE_SHELL_UNRESOLVED: no live run in this session records a test command, so ${role} has no shell.`);
      if (command !== allowed) return deny(`Guard 7: ROLE_SHELL_NOT_ALLOWED: allowed command is ${allowed}`);
      return null;
    }

    // Guard 7: a band role's Bash (FEAT-012). The tool mask is the authority and this is the layer
    // beneath it: in FEAT-011's T-003 a declined Write was completed through Bash, so a prompt is
    // not enough. Fail-closed: a throw denies here, where CC_HOOK_ALLOW cannot reach it.
    function guard7RoleShell(input, payload) {
      const role = payload.agent_type;
      if (!BAND_ROLES.includes(role)) return null;
      try { return roleShellDecision(role, input, payload); }
      catch (e) { return deny(`Guard 7: ROLE_SHELL_UNRESOLVED: the guard could not decide (${e && e.message}), so the call is denied.`); }
    }
    ```
    Smoke: `printf '%s' '{"tool_name":"Bash","tool_input":{"command":"git status"}}' | node .claude/hooks/pre-tool-use.mjs` prints nothing and exits 0.
  - [X] [T-002-D] **C2, the registration.** After `for (const tool of ORCH_DISPATCH_TOOLS) DISPATCH[tool] = [guard6OrchestratorRun];` (:706), insert:
    ```js
    // Guard 7 runs before Guard 3 on Bash: under CC_GUARD3_WARN Guard 3 asks instead of denying,
    // and an ask must never outrank a role's shell deny.
    DISPATCH.Bash.unshift(guard7RoleShell);
    ```
    Smoke twice:
    - the main-session payload above prints nothing and exits 0;
    - `printf '%s' '{"tool_name":"Bash","agent_type":"code","session_id":"x","tool_input":{"command":"npm test"}}' | node .claude/hooks/pre-tool-use.mjs` prints a deny whose reason starts `Guard 7: ROLE_SHELL_UNRESOLVED:`, since this repository has no run file.

    Expected sha256 prefix: `70ce2a2e669a6e50`.
  - [X] [T-002-E] Make the same two edits to `project-template/.claude/hooks/pre-tool-use.mjs` with Edit, then `cmp .claude/hooks/pre-tool-use.mjs project-template/.claude/hooks/pre-tool-use.mjs` exits 0.
  - [X] [T-002-F] Run `npx vitest run tests/hooks/guard7.test.js`. Expected: **39 / 39**. Then `npx vitest run tests/hooks tests/installer/templates.test.js`, expecting every Guard 1–6 test unchanged and `templates.test.js`'s mirror identity green.
  - [X] [T-002-G] Run `npm test`. Expected: **1300 / 0**, 47 files.
  - [X] [T-002-H] Append `- T-002: <one line>` under the plan section. Then `git add tests/hooks/guard7.test.js` and `git add -u .claude/hooks/pre-tool-use.mjs project-template/.claude/hooks/pre-tool-use.mjs .claude/memory/project.md docs/superpowers/plans/2026-10-02-feat012-core-role-agents.md`. Commit `feat: Guard 7 holds a band role's shell to the recorded test command [FEAT-012]`. Expected: **1300 / 0**.
  - [X] [T-002-I] Dispatch the reviewer (Routing) against that commit. Record its verdict and observation line in `project.md`; they ride T-003's commit. A reviewer finding halts T-003 until the owner rules on it.

- [X] [T-003] **The five profiles** (D1, D2, D5, D8; AC1–AC5). Native. Depends on T-000 only, ordered after T-002 so the masks never ship without the guard beneath them.

  **Files:**
  - Create: `project-template/.claude/agents/spec.md`, `project-template/.claude/agents/plan.md`, `project-template/.claude/agents/code.md`, `project-template/.claude/agents/audit.md`, `project-template/.claude/agents/qa.md`
  - Create: `.claude/agents/spec.md`, `.claude/agents/plan.md`, `.claude/agents/code.md`, `.claude/agents/audit.md`, `.claude/agents/qa.md`
  - Create: `tests/unit/role-profiles.test.js`
  - Modify: `.gitignore:30-37`

  **Interfaces:** consumes `MAY_HAND_BACK` and `findAgent` from `orchestrate.mjs` and `GATES`, `ROLES` from `snap-contract.mjs`, all unchanged.

  - [X] [T-003-A] Create `tests/unit/role-profiles.test.js`:
    ```js
    import { describe, it, expect } from 'vitest';
    import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
    import { tmpdir } from 'node:os';
    import { join, resolve, dirname } from 'node:path';
    import { fileURLToPath } from 'node:url';
    import { GATES, ROLES } from '../../scripts/snap-contract.mjs';
    import { MAY_HAND_BACK, findAgent } from '../../scripts/orchestrate.mjs';

    const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
    const TEMPLATE = 'project-template/.claude/agents';
    const MIRROR = '.claude/agents';
    const read = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
    const profile = (role) => read(`${TEMPLATE}/${role}.md`);
    const field = (text, key) => text.match(/^---\n([\s\S]*?)\n---\n/)[1].match(new RegExp(`^${key}:[ \\t]*(.*)$`, 'm'))?.[1];

    // D2, verbatim. No mask carries Agent, SendMessage or NotebookEdit.
    const MASKS = {
      spec: ['Read', 'Grep', 'Glob', 'Write', 'Edit'],
      plan: ['Read', 'Grep', 'Glob', 'Write', 'Edit'],
      code: ['Read', 'Grep', 'Glob', 'Write', 'Edit', 'Bash'],
      audit: ['Read', 'Grep', 'Glob'],
      qa: ['Read', 'Grep', 'Glob', 'Bash'],
    };
    // D5's five items, each pinned by a fixed phrase: the fixed success condition (two phrases),
    // a denial means stop, one hand-back (two phrases), no dispatch, and the scope copy.
    const D5 = [
      'Your success condition is fixed:',
      'Do not substitute a stricter or different standard of your own',
      'A hook or owner denial is an instruction to stop and report, never an obstacle to route around.',
      'Deliver exactly one report',
      'exactly one `SNAP_HANDBACK` line',
      'Never dispatch or message another agent.',
      'Copy `ops.scope` verbatim from your envelope into the hand-back; if your envelope has no scope, leave the key out.',
    ];
    const SHELL = 'Run exactly the command named in the run file';
    const NO_SHELL = 'You have no shell';
    // Each role's Gate semantics row, by the sentence that states its claim.
    const CLAIM = {
      spec: 'a spec file was written under `docs/superpowers/specs/` that answers the item',
      plan: 'a plan file was written under `docs/superpowers/plans/` from the approved spec, and each task names its files',
      code: 'after your last edit you ran the test command, and your report states its exact exit status and summary line',
      audit: 'a static review of the changes against the spec and plan was completed, and its findings are listed',
      qa: 'you ran the test command yourself and the suite passed',
    };

    describe('role agent profiles [FEAT-012]', () => {
      it('ships exactly the five ROLES in both agents directories', () => {
        for (const dir of [TEMPLATE, MIRROR]) expect(readdirSync(join(ROOT, dir)).sort()).toEqual(ROLES.map((r) => `${r}.md`).sort());
      });

      it.each(ROLES)('[AC1] %s names its role and carries the D2 mask exactly', (role) => {
        const text = profile(role);
        expect(field(text, 'name')).toBe(role);
        expect(field(text, 'tools').split(', ')).toEqual(MASKS[role]);
        expect(field(text, 'description')).toMatch(/\S/);
      });

      it.each(ROLES)('[AC2] %s is byte-identical in the .claude/agents mirror', (role) => {
        expect(read(`${MIRROR}/${role}.md`)).toBe(profile(role));
      });

      it.each(ROLES)('[AC3] %s measures at most 999 tokens as ceil(bytes / 4) over the whole file', (role) => {
        expect(Math.ceil(Buffer.byteLength(profile(role), 'utf8') / 4)).toBeLessThanOrEqual(999);
      });

      it.each(ROLES)('[AC4] %s carries every D5 item and the shell rule its mask implies', (role) => {
        const text = profile(role);
        for (const phrase of D5) expect(text).toContain(phrase);
        const shell = MASKS[role].includes('Bash');
        expect(text.includes(SHELL)).toBe(shell);
        expect(text.includes(NO_SHELL)).toBe(!shell);
      });

      it.each(ROLES)('[AC5] %s states its Gate semantics claim and names only the gates it may hand back', (role) => {
        const text = profile(role);
        expect(text).toContain(CLAIM[role]);
        for (const gate of MAY_HAND_BACK[role]) expect(text).toContain(`only the gate \`${gate}\``);
        for (const gate of GATES.filter((g) => !MAY_HAND_BACK[role].includes(g))) expect(text).not.toContain(gate);
      });

      it.each(ROLES)('findAgent resolves %s to its mirror, so ORCH_AGENT_MISSING cannot fire here', (role) => {
        const home = mkdtempSync(join(tmpdir(), 'cc-profiles-home-'));
        try { expect(findAgent(role, ROOT, home)).toBe(join(ROOT, MIRROR, `${role}.md`)); }
        finally { rmSync(home, { recursive: true, force: true }); }
      });
    });
    ```
    Expected sha256 prefix: `cbff7a07137777a3`.
  - [X] [T-003-B] Run `npx vitest run tests/unit/role-profiles.test.js`. Expected: **31 failed / 0 passed (31)**.
  - [X] [T-003-C] Create the five template profiles with Write, each exactly as below. Measured sizes and tokens: spec 1796 bytes (449), plan 2089 (523), code 2009 (503), audit 1725 (432), qa 1864 (466).

    `project-template/.claude/agents/spec.md` (sha256 prefix `819553795a7b65a4`):
    ```markdown
    ---
    name: spec
    description: Define-band role of a /cc-orchestrate run. Writes the spec for one backlog item under docs/superpowers/specs/ and hands back boundary_routed. No shell. Dispatched only by /cc-orchestrate during a run; never use it for ad-hoc work.
    tools: Read, Grep, Glob, Write, Edit
    ---

    You are the `spec` role of a code-conductor orchestrated run. The orchestrator dispatched you with a brief naming the item and installed your band envelope at `.claude/memory/band-envelope.json`. Read the envelope first.

    ## Your job

    Write the spec for the item as one new file under `docs/superpowers/specs/`, named `YYYY-MM-DD-<topic>-design.md`. Read the item's backlog entry and the code it touches before you write. The spec states the problem, the solution, the behavior including its error cases, testable acceptance criteria, what is out of scope, and the files the change affects.

    ## Success condition

    Your success condition is fixed: a spec file was written under `docs/superpowers/specs/` that answers the item. List the questions the codebase does not settle as open questions in your report; do not decide them, because the owner rules them at the approval boundary. Do not substitute a stricter or different standard of your own.

    ## Rules

    - You have no shell. Write only inside your envelope's scope; Guard 5 denies anything else.
    - A hook or owner denial is an instruction to stop and report, never an obstacle to route around.
    - Never dispatch or message another agent.
    - Deliver exactly one report, ending in exactly one `SNAP_HANDBACK` line, then stop. Claim only the gate `boundary_routed`.
    - Copy `ops.scope` verbatim from your envelope into the hand-back; if your envelope has no scope, leave the key out.
    - List the spec file in the hand-back's `ops.f` as `<path>:C`.
    ```

    `project-template/.claude/agents/plan.md` (sha256 prefix `3f1c61b66519fce2`):
    ```markdown
    ---
    name: plan
    description: Define-band role of a /cc-orchestrate run. Writes the implementation plan for the approved spec under docs/superpowers/plans/ and hands back boundary_routed. No shell. Dispatched only by /cc-orchestrate during a run; never use it for ad-hoc work.
    tools: Read, Grep, Glob, Write, Edit
    ---

    You are the `plan` role of a code-conductor orchestrated run. The orchestrator dispatched you with a brief naming the item and its approved spec, and installed your band envelope at `.claude/memory/band-envelope.json`. Read the envelope first.

    ## Your job

    Write the implementation plan for the item from its approved spec, as one new file under `docs/superpowers/plans/`. Use the writing-plans format, because the orchestrator routes code tasks from it: each task is a `### Task N: <name>` heading followed by a `**Files:**` block whose lines start `- Create:`, `- Modify:` or `- Test:` and name each path in backticks. A code agent may touch only the files its task names, so name every file the task changes, its tests included. A task's envelope scope is its files plus the plan file, and the router halts a scope over 20 entries with `ORCH_SCOPE_OVER_CAP`, so keep each task to 19 files or fewer. Order the tasks so that each one ends with the suite green.

    ## Success condition

    Your success condition is fixed: a plan file was written under `docs/superpowers/plans/` from the approved spec, and each task names its files. Do not substitute a stricter or different standard of your own.

    ## Rules

    - You have no shell. Write only inside your envelope's scope; Guard 5 denies anything else.
    - A hook or owner denial is an instruction to stop and report, never an obstacle to route around.
    - Never dispatch or message another agent.
    - Deliver exactly one report, ending in exactly one `SNAP_HANDBACK` line, then stop. Claim only the gate `boundary_routed`.
    - Copy `ops.scope` verbatim from your envelope into the hand-back; if your envelope has no scope, leave the key out.
    - List the plan file in the hand-back's `ops.f` as `<path>:C`. The owner approves that path.
    ```

    `project-template/.claude/agents/code.md` (sha256 prefix `21b7697ef9317a7a`):
    ```markdown
    ---
    name: code
    description: Build-band role of a /cc-orchestrate run. Implements one plan task inside the files it names, runs the run's recorded test command, and hands back build_executed. Dispatched only by /cc-orchestrate during a run; never use it for ad-hoc work.
    tools: Read, Grep, Glob, Write, Edit, Bash
    ---

    You are the `code` role of a code-conductor orchestrated run. The orchestrator dispatched you with a brief naming one task of the approved plan, and installed your band envelope at `.claude/memory/band-envelope.json`. Read the envelope first: its `ops.scope` is the task's files plus the plan file.

    ## Your job

    Implement exactly the task your brief names. Touch only the files in your envelope's scope; Guard 5 denies a write anywhere else. When the task is done, tick its checkboxes in the plan.

    ## The test command

    Your shell runs one command: the run's test command, the `test_command` field of `.claude/memory/orchestrator-run.json`. Run exactly the command named in the run file, byte for byte, with no added flag, pipe, redirect or second command. Guard 7 denies anything else, and its denial names the allowed command.

    ## Success condition

    Your success condition is fixed: after your last edit you ran the test command, and your report states its exact exit status and summary line. A red suite is reported as red; the gate claims only that the run happened and was reported. Do not substitute a stricter or different standard of your own.

    ## Rules

    - A hook or owner denial is an instruction to stop and report, never an obstacle to route around. Never redo a denied write through another tool.
    - Never dispatch or message another agent.
    - Deliver exactly one report, ending in exactly one `SNAP_HANDBACK` line, then stop. Claim only the gate `build_executed`.
    - Copy `ops.scope` verbatim from your envelope into the hand-back; if your envelope has no scope, leave the key out.
    - List every file you changed in the hand-back's `ops.f` as `<path>:C`, `<path>:M` or `<path>:D`.
    ```

    `project-template/.claude/agents/audit.md` (sha256 prefix `5bfeff19ef086a21`):
    ```markdown
    ---
    name: audit
    description: Verify-band role of a /cc-orchestrate run. Reviews the item's changes statically against its spec and plan, read-only, and hands back build_executed with its findings. No shell. Dispatched only by /cc-orchestrate during a run; never use it for ad-hoc work.
    tools: Read, Grep, Glob
    ---

    You are the `audit` role of a code-conductor orchestrated run. The orchestrator dispatched you with a brief naming the item, its spec and its plan, and installed your band envelope at `.claude/memory/band-envelope.json`. Read the envelope first.

    ## Your job

    Review the work the code role produced, statically, against the approved spec and plan. The plan's `**Files:**` blocks name the files each task changed; read them as they stand now. Check them against the spec's behavior and acceptance criteria, the plan's tasks, and the conventions in the project's `CLAUDE.md`. Nothing is run: judge what is written.

    ## Success condition

    Your success condition is fixed: a static review of the changes against the spec and plan was completed, and its findings are listed in your report, each with a `file:line` and one sentence. Findings do not withhold the gate; the claim is that the review was done and reported. Do not substitute a stricter or different standard of your own.

    ## Rules

    - You have no shell and no write tools.
    - A hook or owner denial is an instruction to stop and report, never an obstacle to route around.
    - Never dispatch or message another agent.
    - Deliver exactly one report, ending in exactly one `SNAP_HANDBACK` line, then stop. Claim only the gate `build_executed`.
    - Copy `ops.scope` verbatim from your envelope into the hand-back; if your envelope has no scope, leave the key out.
    ```

    `project-template/.claude/agents/qa.md` (sha256 prefix `19194c34cfc43b78`):
    ```markdown
    ---
    name: qa
    description: Verify-band role of a /cc-orchestrate run. Re-runs the run's recorded test command as a non-author and hands back verify_pass only when the suite passes. No write tools. Dispatched only by /cc-orchestrate during a run; never use it for ad-hoc work.
    tools: Read, Grep, Glob, Bash
    ---

    You are the `qa` role of a code-conductor orchestrated run. The orchestrator dispatched you with a brief naming the item, and installed your band envelope at `.claude/memory/band-envelope.json`. Read the envelope first.

    ## Your job

    Verify the item independently. You did not write this code and you cannot write files. Your run of the suite is the authoritative one, whatever any other role reported.

    ## The test command

    Your shell runs one command: the run's test command, the `test_command` field of `.claude/memory/orchestrator-run.json`. Run exactly the command named in the run file, byte for byte, with no added flag, pipe, redirect or second command. Guard 7 denies anything else, and its denial names the allowed command.

    ## Success condition

    Your success condition is fixed: you ran the test command yourself and the suite passed, meaning the command exited with status 0. Report its exact exit status and summary line. Do not substitute a stricter or different standard of your own: exit status 0 is a pass, and anything else is a fail.

    ## Rules

    - A hook or owner denial is an instruction to stop and report, never an obstacle to route around.
    - Never dispatch or message another agent.
    - Deliver exactly one report, then stop. If the suite passed, end it in exactly one `SNAP_HANDBACK` line and claim only the gate `verify_pass`. If it failed, leave the `SNAP_HANDBACK` line out and say why, quoting the summary line.
    - Copy `ops.scope` verbatim from your envelope into the hand-back; if your envelope has no scope, leave the key out.
    ```
  - [X] [T-003-D] Create the five `.claude/agents/<role>.md` mirrors with Write, each byte-identical to its template, then `cmp` each pair (five `cmp` calls, each exiting 0).
  - [X] [T-003-E] Run `npx vitest run tests/unit/role-profiles.test.js`. Expected: **31 / 31**.
  - [X] [T-003-F] Modify `.gitignore`. This pays the toll before staging.
    - After `/.claude/*` (:30), insert `!/.claude/agents/` and `/.claude/agents/*`, ahead of `!/.claude/commands/`.
    - After `/.claude/memory/*` (:36), insert the five leaves ahead of `!/.claude/commands/cc-implement.md`: `!/.claude/agents/audit.md`, `!/.claude/agents/code.md`, `!/.claude/agents/plan.md`, `!/.claude/agents/qa.md`, `!/.claude/agents/spec.md`.

    This is the order `tests/unit/gitignore-block-parity.test.js`'s `expectedBlock` computes: directories sorted before every leaf, and `.claude/agents` sorting before `.claude/commands`.
  - [X] [T-003-G] Stage, plain, now that the leaves exist (measured rc 0): `git add .claude/agents/audit.md .claude/agents/code.md .claude/agents/plan.md .claude/agents/qa.md .claude/agents/spec.md project-template/.claude/agents/audit.md project-template/.claude/agents/code.md project-template/.claude/agents/plan.md project-template/.claude/agents/qa.md project-template/.claude/agents/spec.md tests/unit/role-profiles.test.js`.
  - [X] [T-003-H] Run `npm test`. Expected: **1331 / 0**, 48 files, with `gitignore-block-parity` green against the staged index.
  - [X] [T-003-I] Append `- T-003: <one line>` under the plan section. Then `git add -u .gitignore .claude/memory/project.md docs/superpowers/plans/2026-10-02-feat012-core-role-agents.md`. Commit `feat: ship the five band role agent profiles [FEAT-012]`. Expected: **1331 / 0**.

- [X] [T-004] **`/cc-orchestrate` documents the start halts and the test command.** Native. Depends on T-001.

  **Files:**
  - Modify: `.claude/commands/cc-orchestrate.md:37-41`, `:89`, `:91`
  - Modify: `project-template/.claude/commands/cc-orchestrate.md` (the same)
  - Modify: `tests/installer/commands-parity.test.js:180-183`

  **The FEAT-011's D10 carry-forward (P18):** this task touches `cc-orchestrate.md`, and that file holds no FEAT-011's D10 fixture note to drop. The note lives in `README.md:125` and `:231`, which T-005-A rewrites.

  - [X] [T-004-A] Modify `tests/installer/commands-parity.test.js`: inside the `cc-orchestrate mirrors [FEAT-011 AC10]` describe, after the D11 test, insert:
    ```js

      it('names both start halts that write no run file [FEAT-012]', () => {
        const text = read(ORCH_MIRRORS[0]);
        expect(text).toContain('On `ORCH_TEST_COMMAND_UNRESOLVED` or `ORCH_TEST_COMMAND_UNSAFE`, report it and stop.');
      });
    ```
  - [X] [T-004-B] Run `npx vitest run tests/installer/commands-parity.test.js`. Expected: **1 failed / 32 passed (33)**, the new test.
  - [X] [T-004-C] Modify `.claude/commands/cc-orchestrate.md`.
    - Replace step 1 (:37-41) with:
      ```markdown
      1. **Start.** Run `node "$S/orchestrate.mjs" start $ARGUMENTS`. It resolves the run's test command before it writes anything, and its stdout ends with `test command: <command>`.
         - If stdout names a replaced stale run, report its item and start time.
         - On `ORCH_RUN_ACTIVE`, report it, offer `end`, and stop.
         - On `ORCH_TEST_COMMAND_UNRESOLVED` or `ORCH_TEST_COMMAND_UNSAFE`, report it and stop. No run file was written, so there is nothing to `end`. The owner adds a `test` script to `package.json`, or removes the chaining from the command it names, before a fresh `start`.

         Print the run header: the item, the mode (`step` unless `--auto` was given), the test command, and the first role, `spec`.
      ```
    - Replace the `code` row (:89) with:
      ```markdown
      | `code` | Implement `<Task N>` of `<plan>`, touching only its files, and tick its boxes in the plan. After your last edit, run the run's test command exactly and report its exit status and summary line. | `impl` | `build_executed` |
      ```
    - Replace the `qa` row (:91) with:
      ```markdown
      | `qa` | Run the run's test command exactly and report. If the suite fails, leave out the `SNAP_HANDBACK` line and say why. | `rev` | `verify_pass` |
      ```

    Make the same edits to `project-template/.claude/commands/cc-orchestrate.md`, then `cmp` the pair. Expected sha256 prefix of both: `be871ea95421370e`.
  - [X] [T-004-D] Run `npx vitest run tests/installer/commands-parity.test.js`. Expected: **33 / 33**.
  - [X] [T-004-E] Run `npm test`. Expected: **1332 / 0**, 48 files.
  - [X] [T-004-F] Append `- T-004: <one line>` under the plan section. Then `git add -u .claude/commands/cc-orchestrate.md project-template/.claude/commands/cc-orchestrate.md tests/installer/commands-parity.test.js .claude/memory/project.md docs/superpowers/plans/2026-10-02-feat012-core-role-agents.md`. Commit `feat: /cc-orchestrate reports the test command and its start halts [FEAT-012]`. Expected: **1332 / 0**.

- [ ] [T-005] **README and release 1.37.0** (AC12, AC13; `docs/RELEASE-CLOSEOUT.md` steps 1–5). Native. Depends on T-001 through T-004.

  **Files:**
  - Modify: `README.md`, `VERSION`, `package.json`, `package-lock.json`, `CHANGELOG.md`, `AGENT-READABLE BACKLOG.md`

  - [ ] [T-005-A] Modify `README.md`, placing each change by content, not line number. The clone measured the suite unchanged at 1332 / 0 with all four.
    - **Known limits.** Replace the line `  No role agent definitions ship until \`[FEAT-012]\`.` (inside the 1.36.0 orchestrator item) with the block below, so the new item follows it, before `- **The \`P7\` false positive above**, still live.`:
      ```markdown
        The five role agent definitions it dispatches ship from `1.37.0`; their limits are the next item.
      - **The role agents (`1.37.0`) are bounded by their tool masks, and Guard 7 bounds one thing beneath them: the shell.**
        - `qa`'s test command is enforcement: Guard 5 keeps qa from writing, so qa only ever runs files it did not write. `code`'s identical allowance is process discipline, not a security boundary, because code writes the tests that command runs.
        - The profiles are live in this repository, because the mirror convention puts them in `.claude/agents/`. The standing rule forbids starting an orchestrator run here; it does not forbid the files being present. A role dispatched by hand through `/agents` or `Agent` creates no band envelope, so Guard 5 allows every write its mask holds, which is `[ARCH-010]`'s no-envelope rule. Guard 7 still denies it the shell. This is named, not fixed.
        - Installing or updating copies `.claude/agents/{spec,plan,code,audit,qa}.md` over the host project's files of the same names, as it does every shipped `.claude/` asset.
        - A gate certifies protocol position and the claim its role states, never the truth of the work beyond that claim.
      ```
    - **The command row.** In the `/cc-orchestrate` row, replace `in \`.claude/agents/\` or \`~/.claude/agents/\`, none of which ship yet, and plans in the writing-plans format` with:
      ```markdown
      in `.claude/agents/` or `~/.claude/agents/`, which ship from `1.37.0`; a root `package.json` with a `test` script, or a stack whose test command detect-stack names, since `start` records the one command `code` and `qa` may run and halts when none resolves; and plans in the writing-plans format
      ```
    - **The Guard 7 paragraph.** Insert after the Guard 6 paragraph's last limit bullet (`- An agent that keeps writing after its hand-back is bounded only by the envelope in force.`), separated by a blank line, before `Input the hook cannot parse fails closed`:
      ```markdown
      **Role shell guard (Guard 7)** - a `Bash` call from a subagent whose `agent_type` names a band role is decided before Guard 3, so Guard 3's `CC_GUARD3_WARN` ask can never outrank it. `spec`, `plan` and `audit` have no shell (`ROLE_SHELL_DENIED`). `code` and `qa` may run exactly one command, byte for byte: the `test_command` that `orchestrate.mjs start` recorded in the run file of a run live in their session. A command carrying `;`, `&`, `|`, a backtick, `$(`, `<`, `>` or a line break is denied first (`ROLE_SHELL_CHAINING`). No run file, a run of another session, or no recorded command is denied (`ROLE_SHELL_UNRESOLVED`), and any other command is denied naming the allowed one (`ROLE_SHELL_NOT_ALLOWED`). An error inside the guard denies too, and `CC_HOOK_ALLOW` does not reach it. The main session and every other agent are untouched. The two allowances differ in kind: for `qa`, which Guard 5 keeps from writing, the guard is enforcement; for `code`, which writes the tests the command runs, it is process discipline, not a security boundary. `start` resolves the command before it writes anything: the package manager's `test` invocation when a root `package.json` has a `test` script (`npm test`, `pnpm test`, `yarn test`, or `bun run test` by lockfile, and `npm test` with none), detect-stack's test command when there is no `package.json`, and otherwise a halt (`ORCH_TEST_COMMAND_UNRESOLVED`). A resolved command carrying a chaining character halts too (`ORCH_TEST_COMMAND_UNSAFE`), so nothing is recorded that Guard 7 would deny.
      ```
    - **The tree.** After `│       ├── settings.json         Hooks wiring (pre-tool-use, post-compact)`, insert `│       ├── agents/               Band roles: spec, plan, code, audit, qa (FEAT-012)`.
  - [ ] [T-005-B] Run `npm version 1.37.0 --no-git-tag-version`, then write `1.37.0` into `VERSION`.
  - [ ] [T-005-C] Modify the records.
    - **`AGENT-READABLE BACKLOG.md`:**
      - At the line `` grep -n '^### \[ \] `\[FEAT-012\]`' `` reports (:167), change `### [ ]` to `### [X]`.
      - Insert as its first bullet:
        ```markdown
        * **DONE, shipped as `1.37.0` on <date>.** Five role agents, one per `ROLES` entry, ship in `project-template/.claude/agents/` and are mirrored into `.claude/agents/`. Each `tools:` mask is exact (D2), and each prompt measures at most 999 tokens by `ceil(bytes/4)` and carries the five mandatory items: a fixed success condition, a denial means stop, one hand-back claiming only the role's own gate, no dispatch, and the verbatim scope copy. Guard 7 closes the Bash seam FEAT-011's T-003 walked through: spec, plan and audit have no shell, and code and qa may run only the test command `orchestrate.mjs start` resolved and recorded, byte for byte, with chaining denied and every guard error denying. `start` halts rather than guess (`ORCH_TEST_COMMAND_UNRESOLVED`) and never records a command Guard 7 would deny (`ORCH_TEST_COMMAND_UNSAFE`). The acceptance criterion holds as the spec reads it: one exact command with chaining denied is not general shell access, and a qa write is denied by its mask and by Guard 5. code's command is process discipline, not a boundary; qa's is enforcement. Rulings A1 (the spec role is non-interactive) and A2 (the allowlist is the test command only) stand. No SNAP contract change. Out of scope, as specified: running lint, plan's SQLite writes, the orchestrator's own wait, the per-dispatch wake, the no-envelope write path, `[FEAT-031]`–`[FEAT-036]`, and changes to detect-stack's output.
        ```
    - **`CHANGELOG.md`:** insert above `## [1.36.0]`:
      ```markdown
      ## [1.37.0] - <date>

      ### Added
      - **[FEAT-012]** Five band role agents, `spec`, `plan`, `code`, `audit` and `qa`, ship in `.claude/agents/`. Each frontmatter `tools:` list is the role's tool mask, and each prompt states a fixed success condition, stop-on-denial, one hand-back claiming only the role's own gate, no dispatch, and the verbatim scope copy, in 999 tokens or fewer.
      - **[FEAT-012]** Guard 7 in the PreToolUse front door. A band role's `Bash` is denied for `spec`, `plan` and `audit`; `code` and `qa` may run exactly the test command recorded for a run live in their session, and a chaining character, a missing or stale run, or any other command is denied. An error inside the guard denies.

      ### Changed
      - **[FEAT-012]** `orchestrate.mjs start` resolves the run's test command before it writes the run file and records it as `test_command`: the package manager's `test` invocation for a root `package.json` with a `test` script (`bun run test` for bun), and detect-stack's command otherwise. It halts with `ORCH_TEST_COMMAND_UNRESOLVED` when none resolves and with `ORCH_TEST_COMMAND_UNSAFE` when the command chains. `/cc-orchestrate` documents both halts and briefs `code` and `qa` to run exactly that command.
      ```

    If the release commit lands on another date, use that date in both places.
  - [ ] [T-005-D] Run the release checks:
    - `node tools/version-gate.mjs`, expecting `VERSION_GATE_OK 1.37.0`;
    - `node tools/record-parity.mjs`, expecting `RECORD_PARITY_OK`;
    - `git diff origin/main -- scripts/snap-contract.mjs` empty (AC13).

    **Discriminator:** flip the FEAT-012 heading back to `### [ ]` and expect a red run naming `1.37.0` and `FEAT-012`. Restore `[X]` and re-run green.
  - [ ] [T-005-E] Run `npm test`, expecting **1332 / 0**. Then `node tools/id-ceiling.mjs`, expecting union `{"BUG":54,"FEAT":40,"ARCH":10}`, next `BUG-055`.
  - [ ] [T-005-F] Append `- T-005: <one line>` under the plan section. Then `git add -u VERSION package.json package-lock.json CHANGELOG.md "AGENT-READABLE BACKLOG.md" README.md .claude/memory/project.md docs/superpowers/plans/2026-10-02-feat012-core-role-agents.md`. Commit `chore: release 1.37.0 [FEAT-012]`. Expected: **1332 / 0**.
  - [ ] [T-005-G] **Confirm with the owner, then** push with `git push -u origin feat/feat-012-core-role-agents` and open the PR against `main`. Expected CI:
    - ci-node20 **1236 / 96**;
    - ci-node24 **1319 / 13**;
    - both legs printing `SKIP_BASELINE_OK`;
    - `git diff origin/main -- tools/skip-baseline.json` empty.
  - [ ] [T-005-H] **Stop at the green PR.** Report both `SKIP_BASELINE_OK` lines, both run ids and the PR URL. The owner merges and publishes the GitHub Release `v1.37.0`.

## Test List

- [ ] Unit and CLI, `tests/scripts/orchestrate.test.js`, +24 (AC8, AC9, D7, D9), and two FEAT-011 assertions amended in place.
- [ ] Integration through the hook's stdin/stdout contract, `tests/hooks/guard7.test.js`, 39 (AC6, AC7, AC10, AC11). AC10 spans both seams: `start` records, then the hook allows exactly that.
- [ ] Content and mirror, `tests/unit/role-profiles.test.js`, 31 (AC1–AC5, D1's `findAgent` match).
- [ ] Mirror docs, `tests/installer/commands-parity.test.js`, +1.
- [ ] Mutants G1–G7, by the T-002 reviewer in a scratch clone.
- No E2E: no UI is affected. No live demo: an orchestrated run is forbidden in this repository, and the guard's live behavior is covered by spawning the real hook.

## Commit Order

1. T-000: `docs: add the FEAT-012 implementation plan [FEAT-012]`, at 1237 / 0.
2. T-001: `feat: resolve and record the run's test command at start [FEAT-012]`, at 1261 / 0.
3. T-002: `feat: Guard 7 holds a band role's shell to the recorded test command [FEAT-012]`, at 1300 / 0.
4. T-003: `feat: ship the five band role agent profiles [FEAT-012]`, at 1331 / 0.
5. T-004: `feat: /cc-orchestrate reports the test command and its start halts [FEAT-012]`, at 1332 / 0.
6. T-005: `chore: release 1.37.0 [FEAT-012]`, at 1332 / 0. CI: 1236 / 96 and 1319 / 13.

## Identified Risks

- **The edited hook breaks this session's own Bash calls (T-002).**
  - **Prevented by:** the C1/C2 order with registration last; Guard 7's first line returns `null` for a payload with no `agent_type`, which is this session's.
  - **Caught by:** the two smoke payloads after each edit, then the hook suites.
  - **Recovery:** `! git checkout -- .claude/hooks/pre-tool-use.mjs`.
- **A mutant applied to the live hook.** Prevented by the Global Constraint; the reviewer works only in its own clone.
- **The profiles go live in this session's agent list at T-003.** Claude Code may offer them as subagent types. The descriptions forbid ad-hoc use (P17), and no task dispatches a role. A dispatched role here would have no envelope and no shell (R3), per the spec's Residual risk.
- **detect-stack is slow or hangs in a large host tree.** It bounds its own walk (depth 5, 200 dirs, a 10 s readdir timeout) and exits explicitly. A hang would hold `start`, which writes nothing until it returns. Not observed in the clone; every AC10 and AC8 fixture returned well inside the 30 s test timeout.
- **An invisible U+FEFF instead of the escape (T-001-C).** Caught by the grep in that step.
- **The commit hook runs the full suite**, so an unpredicted count surfaces at commit time. Every task measures the full suite before staging and halts on any difference.

## Handoff (not plan tasks)

After the owner merges and releases, run `RELEASE-CLOSEOUT` steps 6–10:
- `npm view` shows `1.37.0`;
- sync `main`, reporting the measurement first;
- the closeout record in `project.md`, with the instruments' output and the per-task observation harvest;
- the ceiling before any mint, and the owner's call on detect-stack's non-string-script crash (P4);
- push the record commit in the same action;
- delete the branch, local and remote.
