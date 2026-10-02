# FEAT-011 Orchestrator (Band Router and Phase Handoffs) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (native tasks) and superpowers:subagent-driven-development (T-003 only, see Routing). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/cc-orchestrate <ITEM> [--auto]` drives one backlog item through Define, Build and Verify. Every handoff is a SNAP v3 envelope that passed `snap-validate`, and a failed validation halts the receiving band. While a run is live, Guard 6 holds the orchestrator to its declared write surface. Ship as `1.36.0`.

**Architecture:**
- **`scripts/orchestrate.mjs`** (new) is the router.
  - It holds the run file `.claude/memory/orchestrator-run.json` and five verbs: `start`, `install`, `handback`, `approve` and `end`.
  - It builds every envelope through `snap-build.mjs`, validates it through `snap-validate.mjs` (with `--to` on install), and installs it at `.claude/memory/band-envelope.json`.
  - It exports the write surface and the router tables.
- **Guard 6** joins `.claude/hooks/pre-tool-use.mjs` and its `project-template/` mirror. On every write-family tool it runs after Guard 5 and before Guard 2.
  - It keys on the run file's `session_id`, never on identity.
  - It carries pinned copies of `orchestrate.mjs`'s write surface and run path, for the reason Guard 5 carries the band constants.
  - **R7 (amended on the D1 ruling):** on `Agent` and `SendMessage` it denies any payload carrying `agent_type` while a run is live in its session (`ORCH_NESTED_DISPATCH`). The hook's matcher names both tools in both settings files (T-004).
- **`/cc-orchestrate`** (new, byte-identical in both command mirrors) drives the verbs and the `Agent` tool. It resolves the script by presence (D11).
- **The run file** is the seventh `skip` row of `PROJECT_HOST_OWNED`. It and `.conductor/` become the fifth and sixth managed entries of `project-template/gitignore`.

**Tech Stack:** Node ≥ 20 ESM, zero-dependency scripts, vitest, the `tools/` instruments.

**Spec:** `docs/superpowers/specs/2026-10-01-feat011-orchestrator-band-router-design.md`, APPROVED 2026-10-01 (`883da0b`), amended on the D1 ruling (`e5901ae`).

**Amended 2026-10-01 on the D1 ruling, after V1 halted (T-001).** The changes:
- R7, `ORCH_HANDBACK_CONFLICT`, and the matcher change (AC3a);
- re-derived predictions and red splits, with two mutants added;
- P13 settled by measurement;
- the hand-back and dispatch text of P10 and `/cc-orchestrate` brought to the delivered-report and completion-notice rules.

Every new number was derived before it was measured in the clone.

## Global Constraints

- **Release:** `1.36.0`, a minor release. Branch `feat/feat-011-orchestrator-band-router`.
- **The contract is consumed as given.** `MAX_VERSION` stays 3, and `ROLES`, `GATES`, `BANDS` and `ROLE_BAND` are untouched. `orchestrate.mjs` imports `GATES`, `ROLE_BAND` and `V3_CAPS` and spells no contract literal.
- **The write surface, verbatim:**
  1. `.claude/memory/orchestrator-run.json`
  2. `.claude/memory/band-envelope.json`
  3. `.claude/memory/session-snapshot.json`
  4. `.conductor/**`
- **Guard 6's order:** `[guard5BandScope, guard6OrchestratorRun, …existing]` on `Write`, `Edit`, `create_file` and `write_file`.
- **R7's registration:** `Agent: [guard6OrchestratorRun]` and `SendMessage: [guard6OrchestratorRun]`, each a distinct array. The `PreToolUse` matcher reads `Read|Write|Edit|create_file|write_file|Bash|Agent|SendMessage` in both settings files.
- **Deny text, verbatim:** `Guard 6: ORCH_WRITE_DENIED: <path> is outside the orchestrator's write surface while run <item> is live; repository writes during a run go through a band role (Guard 5).`
- **R7 deny text, verbatim:** `Guard 6: ORCH_NESTED_DISPATCH: <tool> from agent <agent_type> is denied while run <item> is live; only the orchestrator dispatches or messages agents during a run.`
- **Baseline (AC13):** this item adds passing tests only, so `tools/skip-baseline.json` does not change.
- **Staging:**
  - `git add -u <path>` for a tracked file.
  - Plain `git add <path>` for a new file outside an ignored directory.
  - Plain `git add <path>` for a new file at a tracked surface, but only once its leaf is in `.gitignore`.
  - Never a bare `git add -u`.
  - Every task's staging line names this plan file, so its ticks ride the commit. This is the `[BUG-054]` interim rule.
- **Interim constraints, binding on every task:**
  - never run the installer in this repository (`[BUG-052]`);
  - never run the pre-commit test gate from a linked worktree, so no `isolation: "worktree"` for any agent (`[BUG-053]`);
  - run conductor scripts from source `scripts/` (`[BUG-051]`).
- **Never run `orchestrate.mjs start` in this repository.** Once T-003 lands, the live hook enforces Guard 6. A run started here would deny this session's own writes to the plan and the records. Every run happens in a scratch repository (T-001, T-006).
- **Owner-only actions:** the agent opens the PR and stops at green. The merge and the GitHub Release `v1.36.0` are the owner's.

## Predictions, per environment

Every number below was measured on 2026-10-01 during planning. The drafts ran in an independent `git clone --no-hardlinks` of `883da0b` in the session scratchpad: not a linked worktree (`[BUG-053]`), no hooks installed, and `node_modules` symlinked. The baseline there read **1153 / 0 across 44 files**, equal to the record.

**Re-derived on the D1 ruling.** Every row was derived on paper first, then measured in the same clone. The clone's base blobs of both settings files, `templates.test.js` and `settings-merge.test.js` equal `HEAD`'s. Every measurement matched its derivation. One derivation slip, T-004-E written as 1232 / 1233, was corrected to 1233 / 1234 before anything measured it.

**Per environment:**
- **Local** runs every test. Its 0 skipped includes the 12 conditional `code-conductor-plugin` tests, which run because the 2026-10-01 install put the personal skills in `~/.claude/skills`, and the `heal` test.
- **CI** lacks those skills. ci-node24's 13 skipped are exactly those 12 plus `heal` (1).
- **ci-node20**'s 96 add the `node:sqlite` files: `conductor-db` 74, `resume-read` 6 and `handoff-cycle` 3.

None of the files this plan adds or touches is in any skipped set, so every new test runs on all three legs and only the passed counts move.

| after | local | ci-node20 | ci-node24 |
|---|---|---|---|
| now (`883da0b`, measured) | 1153 / 0, 44 files | 1057 / 96 | 1140 / 13 |
| T-000 plan commit | 1153 / 0 | n/a | n/a |
| T-001 V1–V3 live | 1153 / 0 | n/a | n/a |
| T-002 `orchestrate.mjs` | **1203 / 0** (+50), 45 files | n/a | n/a |
| T-003 Guard 6 with R7 | **1233 / 0** (+30), 46 files | n/a | n/a |
| T-004 ignore, host-own, matcher | **1235 / 0** (+2) | n/a | n/a |
| T-005 `/cc-orchestrate` | **1237 / 0** (+2) | n/a | n/a |
| T-006 demo (AC12) | 1237 / 0 | n/a | n/a |
| T-007 README and release | **1237 / 0** | **1141 / 96**, `SKIP_BASELINE_OK` | **1224 / 13**, `SKIP_BASELINE_OK` |

**Arithmetic:**
- **The delta is 50 + 30 + 2 + 2 = 84.**
- **Local:** 1153 + 84 = 1237.
- **ci-node20:** 1057 + 84 = 1141 passed, and 1141 + 96 = 1237.
- **ci-node24:** 1140 + 84 = 1224 passed, and 1224 + 13 = 1237.

**The new tests over v1:**
- **T-002, +1:** `ORCH_HANDBACK_CONFLICT`.
- **T-003, +8:**
  - R7 deny ×3;
  - R7 no-decision ×4;
  - `[AC3a]` `DISPATCH`.
- **T-004, +1:** the `[FEAT-011 AC3a]` settings-merge test.
- **T-004 also amends `templates.test.js`'s union-matcher pin, two `it.each` cases, in place,** with no new test. Like the T-006-A red, it is never pushed: it is amended inside T-004's own commit.

A full clone run with every draft applied read **1237 / 0, 46 files**.

**Red splits, each measured in the clone, with every filter's full match set enumerated (`[BUG-054]` rule):**

| step | command | match set | measured |
|---|---|---|---|
| T-002-B | `npx vitest run tests/scripts/orchestrate.test.js` | the whole new file | file fails to load: `Cannot find module '../../scripts/orchestrate.mjs'`, `Test Files 1 failed (1)`, `Tests no tests` |
| T-002-D | the same command, after `orchestrate.mjs` | 50 tests | **50 / 50**. Against the v1 router (no CONFLICT check), **1 failed / 49 passed**, the CONFLICT test: its discriminator. |
| T-003-B | `npx vitest run tests/hooks/guard6.test.js` | the whole new file, 30 tests | **20 failed / 10 passed** |
| T-003-E | `npx vitest run tests/hooks tests/installer/templates.test.js` | 9 files | **503** (`tests/hooks` 466 + `templates.test.js` 37) |
| T-004-B | `npx vitest run tests/installer/templates.test.js -t "managed entr"` | `[AC13] … fourth managed entry` (ARCH-010's T-006-A test) and `[FEAT-011 AC10] … sixth managed entries`; no other title in the file contains the string | **1 failed / 1 passed / 36 skipped (38)**, with the new test red |
| T-004-D | the same command, after the template edit | the same two | **1 failed / 1 passed / 36 skipped (38)**, with the T-006-A test red |
| T-004-E | `npm test` at that point | the whole suite | **1 failed / 1233 passed (1234)**, and the one failure is the T-006-A test. Derived only: no planning run measured this state. |
| T-004-J | `npx vitest run tests/installer/settings-merge.test.js -t "AC3a"` | `[FEAT-011 AC3a] carries the shipped …`, the only title containing `AC3a` | **1 failed / 17 skipped (18)**. The exact-entry assertion passes on the old template, and the `Agent`/`SendMessage` assertion fails. |
| T-004-K | `npx vitest run tests/installer/templates.test.js -t "union matcher"` | the two `it.each` cases, one per settings file, the only titles containing the string | **2 failed / 36 skipped (38)** |
| T-004-L | `npx vitest run tests/installer/settings-merge.test.js tests/installer/templates.test.js`, after both settings edits | both files | **56 / 56** (18 + 38) |
| T-004-M | `npx vitest run tests/installer tests/unit/host-owned-ignore-xor.test.js` | 17 files | **304 / 304** (302 + 1 + 1). Measured with `commands-parity.test.js` at `HEAD`. With T-005's parity tests present the clone read 306, which is the T-005 state, not T-004's. |
| T-005-B | `npx vitest run tests/installer/commands-parity.test.js -t "cc-orchestrate"` | the two tests of the new `cc-orchestrate mirrors` describe, the only full names containing the string | **2 failed / 30 skipped (32)** |

**Why T-003-B passes ten tests on the unedited hook.**
- **R1, R2 and R5 ×4** assert *allow*, which the unedited hook already does.
- **R7's four no-decision cases** assert *no decision and no warning*. The unedited hook has no `Agent` entry, so it allows silently.

Each becomes discriminating only against a wrong Guard 6. That was measured with eight scratch mutants of the drafted hook, each derived before it was measured:
- **M1:** dropping the write path's `session_id` comparison turns R4 ×2, the warning-rides-the-ask test and the V3 pin red (4);
- **M1b:** dropping R7's `session_id` comparison turns the R7 stale-run no-decision red (1);
- **M2:** keying the role skip on `agent_id` turns the `agent_id`-only R6 and the `general-purpose` R6 red (2);
- **M2b:** keying R7 on `agent_id` turns the R7 `agent_id`-only no-decision red (1);
- **M3:** removing the role skip turns R1 red (1);
- **M4:** ordering the role skip before R7 turns R7's code `Agent` and code `SendMessage` denies red (2);
- **M5:** dropping R7's `agent_type` null check turns the R7 main-session and `agent_id`-only no-decisions red (2);
- **M6:** R7 denying when no run file is found turns the R7 no-run no-decision red (1).

**The no-decision cases also prove the hook tolerates path-less inputs.**
- `fire` spawns the hook file itself, so the real `main()` runs.
- A throw there is caught at the file's last line and turned into a fail-closed deny ("the hook threw").
- So a no-decision result with exit 0 shows that `Agent` and `SendMessage` inputs, which carry no `file_path`, pass through every R7 line without throwing.

This matters because the new matcher invokes the hook on every dispatch in every install.

**The matcher pin, per environment.** `templates.test.js` and `settings-merge.test.js` are in no skipped set, so T-004-J/K's reds are the same on every leg. They are never pushed: T-004-L turns them green inside T-004's commit.

**The T-006-A red, per environment.** `templates.test.js` is in no skipped set, so the red at T-004-D/E is the same on every leg. It is never pushed: T-004-F amends the test in the same commit, and no CI leg ever sees it. Every leg sees the amended test pass, and the new test with it.

**Halt rule:** any count that differs from its row halts the task before its commit. A prediction is amended before it is measured, never absorbed after.

## Routing

| Task | Route | Ground |
|---|---|---|
| T-000, T-002, T-004, T-005, T-007 | native | sequential, sharing the records and the router module |
| T-001, T-006 | live, in-session | they run against the installed `claude`. The owner drives the interactive terminal; the agent writes the fixtures, gives each prompt verbatim, and reads the logs back. |
| T-003 | **subagent, then a reviewer** | a guard that can deny tools in the live session earns a fresh reviewer's gate, as Guard 5 did |

**Constraints on the T-003 subagent:**
- it runs in the main checkout, never in a worktree (`[BUG-053]`);
- it does not commit;
- its brief asks it for its handoff-observation line (owner ruling at ARCH-010 T-005-F).

**The reviewer** re-runs all eight mutants (M1, M1b, M2, M2b, M3, M4, M5, M6) and confirms the hook's sha256 against the planning draft.

## Review Focus

1. **A main-session write from a subdirectory `cwd` with a relative path.** Expected: the target resolves against the payload `cwd`, and the surface anchors at the run root. `sub/.conductor/x` is denied, and `<root>/.conductor/x` is allowed. Pinned by T-003's `anchors the surface at the run root, not at cwd`.
2. **Near-miss names of the surface entries,** including the `.tmp` sibling that `orchestrate.mjs`'s own atomic write uses. Expected: denied through the write tools. `orchestrate.mjs` writes through Bash, outside Guard 6. Pinned by T-003's `denies near-miss names of the surface entries`.
3. **A run file left behind by a crashed session.** Expected: a later session is warned, never blocked, and a Guard 2 ask still reaches it. Pinned by T-003's R4 ×2 (AC5) and `decides nothing with its warning`.
4. **A corrupt run file meets the router.** Expected: every verb but `end` halts with `ORCH_RUN_INVALID`, which cannot be recorded in the file it names, and `end` clears it. Pinned by T-002's `halts with ORCH_RUN_INVALID on an unreadable run file`.
5. **A plan whose Files lines carry `:N-M` suffixes, or whose task has more paths than the cap.** Expected: suffixes are stripped. Over the cap, the run halts and the scope is never truncated, and that includes a path over 300 characters, which `snap-build` would otherwise truncate silently. Pinned by T-002's extraction test and the over-cap tests.

## Pre-flight analysis (critical-review Phase 1)

**Happy path.**
1. `start` writes a session-bound run file at `boundary_routed`.
2. Each role in band order gets a `--check`, a pause, an install and a dispatch. Its single `SNAP_HANDBACK` line passes `snap-validate` and the role and gate checks, and the router advances.
3. Two human approvals write one gate, `define_approved`.
4. `qa`'s `verify_pass` ends the run.

**Failure points:**
- **The live hook.** The edited hook runs on every tool call this session makes. A throw fails closed, and Guard 6 registered before it exists is a `ReferenceError` on every write. Mitigated by:
  - the C1–C5 order, with registration last;
  - no run file existing in this repository, so R2 allows everything here;
  - the constraint never to `start` a run here.
- **V1–V3 are unmeasured on this binary:**
  - a subagent that can dispatch breaks D1;
  - a `CLAUDE_CODE_SESSION_ID` absent or different from the payload breaks D3;
  - a warning channel the user never sees makes R3/R4 silent.

  T-001 measures all three before any code, and each has its own halt.

  **Measured 2026-10-01 on 2.1.287:**
  - **V1 halted.** A subagent can dispatch. The ruling kept D1 on new grounds and added R7.
  - **V2 holds.**
  - **V3 holds,** on `systemMessage`.
- **Asynchronous dispatch and the post-hand-back tail (V1, F3–F5).** Dispatch returns before the agent finishes. An agent can keep acting after its delivered hand-back, and can report again through `SendMessage`. Mitigated by:
  - the completion-notice wait in `/cc-orchestrate`;
  - R7, which denies subagent `Agent` and `SendMessage` during a run;
  - `ORCH_HANDBACK_CONFLICT` as defense in depth.

  The lingering same-role writer is the spec's stated D8 limit.
- **Child-process seams.** `snap-build` and `snap-validate` are CLI scripts that call `process.exit` at import, so the router spawns them (P1). A spawn failure surfaces as a non-zero status, which halts with the validator's text quoted.
- **Hand-back transport.** An agent's prose in a heredoc can trip Guard 3, whose heredoc-body scan landed in `[BUG-047]`. Hand-backs therefore travel by file under `.conductor/handback/` (P10).
- **Two writers to one run file.** Dispatch is serial by construction (D8, amended): the orchestrator waits for each completion notice, `install` advances only from a recorded hand-back, and R7 blocks nested dispatch. Every write is temp-plus-rename (AC9). A concurrent `orchestrate.mjs` invocation is outside the cooperative model.

**Boundary conditions:**
- **Scope size:**
  - zero tasks, or a task with no files: `ORCH_EMPTY_SCOPE`;
  - exactly 20 entries passes;
  - 21 entries: `ORCH_SCOPE_OVER_CAP`;
  - a 301-character path: `ORCH_SCOPE_OVER_CAP`.
- **Hand-back lines:**
  - zero or two `SNAP_HANDBACK` lines: `ORCH_HANDBACK_MISSING`;
  - a valid v1 envelope: `ORCH_HANDBACK_INVALID`;
  - a second report for a position already handed back: `ORCH_HANDBACK_CONFLICT`, terminal (D12), with the first record kept.
- **Run file:**
  - a payload without `session_id`: stale (R4), never denied;
  - an empty `CLAUDE_CODE_SESSION_ID`: `ORCH_NO_SESSION_ID`;
  - an oversize run file: R3, the same ceiling as the envelope.
- **Root:** no `.claude/` above `cwd`, in which case the run root is `cwd` itself.

## Rulings in this plan (each is the owner's to overturn)

- **P1, spawn, not import.** Resolves the spec's deferred read: `snap-build.mjs` and `snap-validate.mjs` read stdin or argv and `process.exit` at module scope, so neither can be imported. `orchestrate.mjs` spawns both with `process.execPath`, siblings of its own file, so the same code runs from `scripts/` and `.claude/scripts/`.
- **P2, no bundle-list change.** Resolves the spec's deferred read: `lib/installer/deploy.mjs:212` copies `scripts/` wholesale (`cpSync`), and `package.json` `files` lists `scripts/`. `orchestrate.mjs` ships with no installer edit.
- **P3, Guard 6 shares Guard 5's helpers.** Resolves the spec's deferred read of `pre-tool-use.mjs:110-180`:
  - `findBandRoot(start)` becomes `findRootHolding(start, rel)`, the same walk with the marker as a parameter;
  - `payloadCwd(payload)` lifts Guard 5's `cwd` line;
  - the surface is matched with Guard 5's `globToRegExp`, so `.conductor/**` means what a scope glob means.
- **P4, two exit classes:**
  - **A halt** exits 1 and is recorded in the run file.
  - **A refusal** exits 2 and writes nothing. Refusals cover misuse of the CLI: an unknown verb or a usage error, a role that is not next, another session's run, an already-halted run, an approval out of order, and an unreadable plan path.
  - **The three start-time codes record nothing:** `ORCH_NO_SESSION_ID`, `ORCH_RUN_ACTIVE` and `ORCH_RUN_INVALID`. With no session id there is no file to record into. Recording `ORCH_RUN_ACTIVE` would halt the live run it protects. An invalid file cannot carry its own halt.
- **P5, install's halt codes.** The halt code is `SNAP_GATE_MISMATCH` when the validator names it, and `SNAP_ERROR` otherwise, with the validator's text quoted verbatim. Run-file validation (`isValidRun`, which checks `gate` against `GATES`) makes `SNAP_ERROR` unreachable through the router, so it stays only as a backstop.
- **P6, `install <role> --check`.** It builds and validates with `--to` and writes nothing. This is how spec step 2 prints "the envelope to be installed, and the `--to` result" before step 3 installs it, and why a declined dispatch installs nothing. It is a flag on an existing verb, not a sixth verb.
- **P7, the run file carries `handbacks`.** This is additive to the spec's field list: an array of `{role, gate, at[, task]}`. The router reads its position from this record rather than from memory, and `end` prints it for the report.
- **P8, `approve plan <plan path>`.** The path is relative to the run root, with no `..`. The owner approves the path the plan agent named in `ops.f`. Every task's scope is checked before `define_approved` is written, so a defective plan halts before any Build dispatch.
- **P9, scopes are never truncated, element-wise too.** A path over `V3_CAPS['ops.scope'][1]` (300 characters) halts with `ORCH_SCOPE_OVER_CAP`. `snap-build`'s `normArray` would otherwise cut it silently.
- **P10, hand-backs travel by file.**
  - After the agent's completion notice, `/cc-orchestrate` writes the agent's **delivered `SubagentHandback` report** with the Write tool to `.conductor/handback/<role>.txt`, or `code-<N>.txt` for code. That is inside the write surface (R5). (Amended on the D1 ruling: "final message" is undefined once an agent can report through two channels.)
  - It then feeds the file to `handback` on stdin.
  - A heredoc would carry the agent's prose through Guard 3's heredoc-body scan (`[BUG-047]`).
  - `end`, and a stale-run replacement, clear `.conductor/handback/`, so file names never collide across runs and Guard 2 never asks.
- **P11, a hand-back must be v3.** A valid v1 or v2 envelope halts with `ORCH_HANDBACK_INVALID: a hand-back must be a v3 envelope`, rather than with a role mismatch naming `undefined`.
- **P12, verbs bind to the session.** `install`, `handback` and `approve` refuse a run whose `session_id` is not `CLAUDE_CODE_SESSION_ID`. The other session sees the spec's offer instead: `end`, or `start` to replace the run.
- **P13, the warning channel.** V3 decides it.
  - If only one channel reaches the user, Guard 6 uses that one.
  - If both do, it uses `systemMessage`, because it rides the decision in the one JSON object the hook emits.
  - If neither does, T-001 halts.

  **Settled by T-001's V3:** on 2.1.287, stderr is invisible and `systemMessage` renders behind `PreToolUse:Write says: `. So T-003 carries the `systemMessage` variant only, and the stderr variants are retired. The warning text stays as written, because it reads well behind that prefix (owner ruling).
- **P14, the T-006-A test keeps its own claim.** ARCH-010's `[AC13]` test goes red on AC10's two lines, as carried forward. It is amended to assert its claim, that the band envelope is the fourth entry, with `.slice(0, 4)`. The full exact list moves to the new `[FEAT-011 AC10]` test. Exactly one exact-list test therefore owns the template, and a band envelope moved from fourth place still turns `[AC13]` red.
- **P15, the T-003 edit order is C1, C2a, C2b, C3, C4, C5, with registration last.** Every intermediate state parses, loads and runs, and registers nothing that is undefined. C1's rename touches Guard 5's only call site in the same edit.
  - **C2a, the constants, strictly precedes C2b, the functions** (amended on the D1 ruling). `guard6OrchestratorRun`'s first line reads `ORCH_DISPATCH_TOOLS`. A function edit landing before its constant would throw on every write once registered, which is the ARCH-010 brick lesson.
  - **Each step is checked by running the hook, not only by parsing it.** `node --check` cannot see a `ReferenceError`.
- **P16, v1 routes writing-plans-format plans.**
  - A task is a `### Task N` heading.
  - Its scope is the backticked paths on `Create:`, `Modify:` and `Test:` lines of its `**Files:**` block.
  - This repository's own `[T-NNN]` checkbox plans are not routable by v1, and the README states it.
- **P17, the envelope's `sys` fields:**
  - `ph` maps spec→`spec`, plan→`plan`, code→`impl`, audit→`rev` and qa→`rev`;
  - `c` is `git rev-parse HEAD` at the run root, else `0000000`;
  - `s` is the item id, which `start` requires to match `^[A-Z]+-\d{3,}$`.
- **P18, the owner drives both live tasks** in a separate terminal, because an interactive TUI cannot be driven from this session.

---

- [X] [T-000] **Plan commit.** The branch gate is silent here: the current branch `feat/feat-011-orchestrator-band-router` carries the item's id. `origin/main` is `8887e11`, an ancestor of `HEAD`, so there is nothing to merge.
  - [X] [T-000-A] Modify `.gitignore`: insert `!/docs/superpowers/plans/2026-10-01-feat011-orchestrator-band-router.md` immediately after `!/docs/superpowers/plans/2026-10-01-arch010-band-contract-vertical-slice.md` (:97), in sorted position.
  - [X] [T-000-B] Modify `.claude/memory/project.md`: append at the end of the file
    ```markdown

    ## Plan: FEAT-011 implementation [2026-10-01]

    Plan `docs/superpowers/plans/2026-10-01-feat011-orchestrator-band-router.md`.
    - **Approval:** APPROVED 2026-10-01 after full review. P1–P18 stand as written, with P13's systemMessage tie-break pre-ruled. The 49th test (`ORCH_RUN_INVALID` through the router), the routing and the never-start-a-run-here constraint are approved. One amendment: T-006-D approves Guard 2's ask, and fact 4 records the sequence warn, then ask, then the completed write.
    - **Routing:** T-003 runs as a subagent then a reviewer (main checkout, no worktree, no commit: BUG-053); T-001 and T-006 run live with the owner driving; the rest are native.
    - **Predictions,** measured on drafts in a scratch clone: local 1153 → 1227 / 0 (+74), ci-node20 1131 / 96, ci-node24 1214 / 13.

    Handoff observations, one line per task:
    ```
  - [X] [T-000-C] `git add -u .gitignore .claude/memory/project.md`, then `git add docs/superpowers/plans/2026-10-01-feat011-orchestrator-band-router.md` (plain, now that its leaf exists).
  - [X] [T-000-D] Commit `docs: add the FEAT-011 implementation plan [FEAT-011]`. Expected: the hook suite passes at **1153 / 0**.
  - [X] [T-000-E] Run `node tools/id-ceiling.mjs`, expecting union `{"BUG":54,"FEAT":40,"ARCH":10}`, next `BUG-055`. Then `node tools/record-parity.mjs`, expecting `RECORD_PARITY_OK`.
  - [X] [T-000-F] Append `- T-000: <one line of handoff observation>` under the plan section. This line rides T-001's commit.

- [X] [T-001] **V1–V3, the plan's opening measurements, before any code.** Live, owner driving, in a scratch repository outside this one. Depends on T-000. Each V has its own halt rule, and no later task starts until all three are recorded and none has halted.
  - **V1 halt:** a payload shows a `Write` of `leaf.txt` with `agent_type=leaf`, and `leaf.txt` exists. That is, a subagent dispatched a subagent. Stop for a ruling on D1.
  - **V2 halt:** the `printenv` output is empty, or differs from the `session_id` of any logged payload. Stop for a ruling on D3.
  - **V3 halt:** the owner saw neither the `V3-STDERR` nor the `V3-SYSTEM` marker. Stop for a ruling on the warning channel. Otherwise P13 picks the channel.
  - [X] [T-001-A] Create `<scratchpad>/probe-feat011` and run `git init` there. Write these files:
    - `.claude/settings.json`:
      ```json
      { "hooks": { "PreToolUse": [
        { "matcher": "*", "hooks": [ { "type": "command", "command": "node .claude/hooks/log.mjs" } ] },
        { "matcher": "Write", "hooks": [ { "type": "command", "command": "node .claude/hooks/v3.mjs" } ] }
      ] } }
      ```
    - `.claude/hooks/log.mjs`, which logs every raw payload and allows:
      ```js
      import { appendFileSync, readFileSync } from 'node:fs';
      appendFileSync('payloads.jsonl', readFileSync(0, 'utf8').trim() + '\n');
      ```
    - `.claude/hooks/v3.mjs`, which emits one marker per probe file and decides nothing, except the combined probe, which asks:
      ```js
      import { readFileSync } from 'node:fs';
      const p = JSON.parse(readFileSync(0, 'utf8'));
      const f = String(p.tool_input?.file_path ?? '');
      if (f.endsWith('v3-stderr.txt')) process.stderr.write('V3-STDERR marker\n');
      if (f.endsWith('v3-system.txt')) process.stdout.write(JSON.stringify({ systemMessage: 'V3-SYSTEM marker' }) + '\n');
      if (f.endsWith('v3-both.txt')) {
        process.stdout.write(JSON.stringify({
          systemMessage: 'V3-BOTH marker',
          hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: 'V3-ASK marker' },
        }) + '\n');
      }
      ```
    - `.claude/agents/relay.md`. It has no `tools:` line, so it inherits every tool the binary offers a subagent:
      ```markdown
      ---
      name: relay
      description: Tries to dispatch another agent. Used only by the FEAT-011 V1 probe.
      ---
      Do exactly what you are asked. Never write a file yourself. List your available tools by name, verbatim.
      ```
    - `.claude/agents/leaf.md`:
      ```markdown
      ---
      name: leaf
      description: Writes one file when asked. Used only by the FEAT-011 V1 and V2 probes.
      tools: Write
      ---
      Write exactly the file you are asked to write, then stop.
      ```
    - `read-payloads.mjs`:
      ```js
      import { readFileSync } from 'node:fs';
      for (const line of readFileSync('payloads.jsonl', 'utf8').trim().split('\n')) {
        const p = JSON.parse(line);
        const f = p.tool_input?.file_path ?? p.tool_input?.command ?? p.tool_input?.subagent_type ?? '';
        console.log(p.tool_use_id, p.tool_name, `agent_type=${p.agent_type ?? '-'}`, `agent_id=${p.agent_id ?? '-'}`, `session_id=${p.session_id ?? '-'}`, f);
      }
      ```
  - [X] [T-001-B] Run `claude --version` and record it verbatim.
  - [X] [T-001-C] **Owner, in a separate terminal:** run `cd <scratchpad>/probe-feat011 && claude`, then trust the folder. Send this prompt verbatim:

    `Run the Bash command printenv CLAUDE_CODE_SESSION_ID and show me its output verbatim. Then use the relay agent with this instruction: "Use the leaf agent to write leaf.txt containing the word leaf, and list your available tools by name." Then use the leaf agent yourself to write main-leaf.txt containing the word leaf. Then write three files yourself, v3-stderr.txt, v3-system.txt and v3-both.txt, each containing the word v3. Report every tool result verbatim.`

    Approve any permission prompt, including the ask on `v3-both.txt`. For each of `V3-STDERR`, `V3-SYSTEM`, `V3-BOTH` and `V3-ASK`, note whether that marker appeared on screen and where. Then `/exit`.
  - [X] [T-001-D] Read the evidence:
    1. `node read-payloads.mjs`;
    2. `ls leaf.txt main-leaf.txt`;
    3. the owner's paste of the `printenv` output, the relay's tool list and the four marker observations.

    Apply the three halt rules. Record V1, V2 and V3. The relay's own report of its tools is recorded as said, not interpreted (the ARCH-010 demo's rule). Any `Agent` or `Task` payload carrying `agent_type=relay` is recorded as an observation; V1's halt keys on the `leaf.txt` payload.
  - [X] [T-001-E] Modify `.claude/memory/project.md`. Insert, directly above the `## Plan: FEAT-011 implementation [2026-10-01]` heading:
    ```markdown
    ## Measurements: FEAT-011 V1–V3 [<date>]

    - **Binary:** `claude` <version>, interactive, owner driving, in a scratch repository outside this one. Binary delta: the ARCH-010 identity spike measured 2.1.286; V1–V3 measured <version>.
    - **Main-session shape on <version>:** <verbatim reader lines for the main session's v3-*.txt writes>; agent_id <absent / present>, agent_type <absent / present>. (Line amended 2026-10-01 before T-001-C by owner ruling, so that auditing Guard 6 never has to cross binaries.)
    - **V1, subagent dispatch:** <verbatim reader lines for any Agent/Task payload and for leaf.txt>; <the relay's tool list, verbatim>. Verdict: <holds / halts>.
    - **V2, session id:** printenv printed `<value>`. Payload session_ids: <the distinct values with their tool_use_ids>. Verdict: <holds / halts>.
    - **V3, warning channel:** V3-STDERR <seen where / not seen>; V3-SYSTEM <…>; V3-BOTH <…> with V3-ASK <…>. Verdict: Guard 6 warns on <systemMessage / stderr> (P13).
    ```
    Then append `- T-001: <one line of handoff observation>` under the plan section.
  - [X] [T-001-F] Run `git add -u .claude/memory/project.md docs/superpowers/plans/2026-10-01-feat011-orchestrator-band-router.md`. Commit `docs: record the FEAT-011 V1-V3 measurements [FEAT-011]`. Expected: **1153 / 0**.

- [X] [T-002] **`scripts/orchestrate.mjs`: the router, the run file, and the five verbs** (AC1, AC2, AC4, AC7, AC8, AC9; Review Focus 4 and 5). Native. Depends on T-001's three verdicts.
  - [X] [T-002-A] Create `tests/scripts/orchestrate.test.js` with exactly this content (sha256 `88ab6418c72abefbd0e16b5de8f5107ecf850e62be361d9b8755cedfa7dc6897`, 50 tests; amended 2026-10-01 on the D1 ruling, adding the `ORCH_HANDBACK_CONFLICT` test):
    ```js
    import { describe, it, expect, beforeEach, afterEach } from 'vitest';
    import { spawnSync } from 'node:child_process';
    import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
    import { tmpdir } from 'node:os';
    import { join, relative, resolve, dirname } from 'node:path';
    import { fileURLToPath } from 'node:url';
    import {
      ENVELOPE_FILE, HANDBACK_DIR, MAY_HAND_BACK, ROLE_ARTIFACTS, RUN_FILE, WRITE_SURFACE,
      extractTasks, findAgent, forwardGate, nextStep, taskScope,
    } from '../../scripts/orchestrate.mjs';

    const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
    const SCRIPT = join(REPO_ROOT, 'scripts/orchestrate.mjs');
    const ROLES = ['spec', 'plan', 'code', 'audit', 'qa'];
    const PLAN = 'docs/superpowers/plans/demo.md';

    let root, home;
    beforeEach(() => {
      root = realpathSync(mkdtempSync(join(tmpdir(), 'cc-orch-root-')));
      home = realpathSync(mkdtempSync(join(tmpdir(), 'cc-orch-home-')));
      mkdirSync(join(root, '.claude', 'memory'), { recursive: true });
    });
    afterEach(() => {
      rmSync(root, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    });

    // Through the CLI's real contract: verb on argv, hand-back on stdin, this session's id in env.
    function orch(args, { input = '', sid = 'sess-1' } = {}) {
      const env = { ...process.env, HOME: home, USERPROFILE: home };
      delete env.CLAUDE_CODE_SESSION_ID;
      if (sid !== null) env.CLAUDE_CODE_SESSION_ID = sid;
      const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: root, env, input, encoding: 'utf8', timeout: 30000 });
      if (r.error) throw new Error(`orchestrate spawn failed: ${r.error.message}`);
      return { status: r.status, out: r.stdout.trim(), err: r.stderr.trim() };
    }
    const runFile = () => JSON.parse(readFileSync(join(root, RUN_FILE), 'utf8'));
    const runFileText = (text) => writeFileSync(join(root, RUN_FILE), text);
    const envelopeText = () => readFileSync(join(root, ENVELOPE_FILE), 'utf8');
    const envelope = () => JSON.parse(envelopeText());

    function agents(roles = ROLES, dir = join(root, '.claude', 'agents')) {
      mkdirSync(dir, { recursive: true });
      for (const r of roles) writeFileSync(join(dir, `${r}.md`), `---\nname: ${r}\ndescription: fixture\n---\nfixture\n`);
    }
    function plan(body) {
      mkdirSync(join(root, 'docs', 'superpowers', 'plans'), { recursive: true });
      writeFileSync(join(root, PLAN), body);
    }
    const task = (n, files) => `### Task ${n}: thing ${n}\n\n**Files:**\n${files.map((f) => `- Modify: \`${f}\``).join('\n')}\n\n- [ ] **Step 1: do it**\n`;
    const TWO_TASKS = `# Demo Plan\n\n${task(1, ['src/a.js:10-20', 'tests/a.test.js'])}\n${task(2, ['src/b.js'])}\n## Test List\n`;
    const handbackLine = (role, gate, extra = {}) => 'SNAP_HANDBACK ' + JSON.stringify({
      v: 3, sys: { ph: 'impl', c: '0000000', s: 'FEAT-011', role, tk: 'X', ...extra.sys },
      ops: { n: [], f: [], gate }, mem: { d: [], x: [] }, pr: '',
    });
    const say = (role, gate) => `Done.\nObservation: fine.\n${handbackLine(role, gate)}\n`;

    // Drives a fresh run to the point where `role` is next, recording each step on the way.
    function driveTo(role) {
      agents();
      plan(TWO_TASKS);
      const steps = [
        ['spec', () => { orch(['install', 'spec']); orch(['handback', 'spec'], { input: say('spec', 'boundary_routed') }); orch(['approve', 'spec']); }],
        ['plan', () => { orch(['install', 'plan']); orch(['handback', 'plan'], { input: say('plan', 'boundary_routed') }); orch(['approve', 'plan', PLAN]); }],
        ['code', () => { for (let i = 0; i < 2; i++) { orch(['install', 'code']); orch(['handback', 'code'], { input: say('code', 'build_executed') }); } }],
        ['audit', () => { orch(['install', 'audit']); orch(['handback', 'audit'], { input: say('audit', 'build_executed') }); }],
      ];
      expect(orch(['start', 'FEAT-011']).status).toBe(0);
      for (const [name, step] of steps) { if (name === role) return; step(); }
    }

    const blank = { gate: 'boundary_routed', approvals: { spec: null, plan: null }, tasks: { ids: [], done: 0 }, handbacks: [] };
    const hb = (...roles) => roles.map((role) => ({ role }));

    describe('router [FEAT-011 AC7]', () => {
      it.each([
        ['a fresh run dispatches spec', blank, { role: 'spec' }],
        ['a spec hand-back waits for spec approval', { ...blank, handbacks: hb('spec') }, { await: 'spec' }],
        ['an approved spec dispatches plan', { ...blank, handbacks: hb('spec'), approvals: { spec: {}, plan: null } }, { role: 'plan' }],
        ['a plan hand-back waits for plan approval', { ...blank, handbacks: hb('spec', 'plan'), approvals: { spec: {}, plan: null } }, { await: 'plan' }],
        ['an approved plan dispatches code for its first task', { ...blank, handbacks: hb('spec', 'plan'), approvals: { spec: {}, plan: {} }, tasks: { ids: ['Task 1', 'Task 2'], done: 0 } }, { role: 'code', task: 'Task 1' }],
        ['the last code hand-back dispatches audit', { ...blank, handbacks: hb('spec', 'plan'), approvals: { spec: {}, plan: {} }, tasks: { ids: ['Task 1', 'Task 2'], done: 2 } }, { role: 'audit' }],
        ['an audit hand-back dispatches qa', { ...blank, handbacks: hb('spec', 'plan', 'audit'), approvals: { spec: {}, plan: {} }, tasks: { ids: ['Task 1'], done: 1 } }, { role: 'qa' }],
        ['a qa hand-back ends the run', { ...blank, handbacks: hb('spec', 'plan', 'audit', 'qa'), approvals: { spec: {}, plan: {} }, tasks: { ids: ['Task 1'], done: 1 } }, { end: true }],
      ])('%s', (_, run, expected) => {
        expect(nextStep(run)).toEqual(expected);
      });

      it('may hand back exactly the gates the band table names', () => {
        expect(MAY_HAND_BACK).toEqual({
          spec: ['boundary_routed'], plan: ['boundary_routed'], code: ['build_executed'],
          audit: ['build_executed'], qa: ['verify_pass'],
        });
      });

      it('gives each role the reviewed tool kind and scope (D5)', () => {
        expect(ROLE_ARTIFACTS).toEqual({
          spec: { tk: 'RW', scope: ['docs/superpowers/specs/**'] },
          plan: { tk: 'RW', scope: ['docs/superpowers/plans/**'] },
          code: { tk: 'RW', scope: null },
          audit: { tk: 'R', scope: null },
          qa: { tk: 'X', scope: null },
        });
      });

      const at = (gate, done = 0) => ({ gate, tasks: { ids: ['Task 1', 'Task 2'], done } });
      it.each([
        ['spec re-issues boundary_routed inside Define', at('boundary_routed'), 'spec', 'boundary_routed', 'boundary_routed'],
        ['plan re-issues boundary_routed inside Define', at('boundary_routed'), 'plan', 'boundary_routed', 'boundary_routed'],
        ['a non-final code task re-issues define_approved', at('define_approved', 0), 'code', 'build_executed', 'define_approved'],
        ['the final code task forwards build_executed', at('define_approved', 1), 'code', 'build_executed', 'build_executed'],
        ['audit re-issues build_executed inside Verify', at('build_executed', 2), 'audit', 'build_executed', 'build_executed'],
        ['qa forwards verify_pass and ends the band', at('build_executed', 2), 'qa', 'verify_pass', 'verify_pass'],
      ])('D6: %s', (_, run, role, handed, expected) => {
        expect(forwardGate(run, role, handed)).toBe(expected);
      });

      it('writes define_approved only through approve plan, and only once', () => {
        driveTo('plan');
        orch(['install', 'plan']);
        orch(['handback', 'plan'], { input: say('plan', 'boundary_routed') });
        expect(runFile().gate).toBe('boundary_routed');
        expect(orch(['approve', 'plan', PLAN]).status).toBe(0);
        expect(runFile().gate).toBe('define_approved');
        const again = orch(['approve', 'plan', PLAN]);
        expect(again.status).toBe(2);
        expect(again.err).toBe('orchestrate: approve plan: the next step is install code');
      });

      it('approving the spec records the approval and writes no gate', () => {
        driveTo('spec');
        orch(['install', 'spec']);
        orch(['handback', 'spec'], { input: say('spec', 'boundary_routed') });
        expect(orch(['approve', 'spec']).status).toBe(0);
        const run = runFile();
        expect(run.gate).toBe('boundary_routed');
        expect(run.approvals.spec.by).toEqual(expect.any(String));
        expect(run.approvals.plan).toBeNull();
      });

      it('runs start to verify_pass on a two-task plan, each envelope passing --to its role', () => {
        driveTo('qa');
        expect(orch(['install', 'qa']).status).toBe(0);
        expect(envelope().sys).toMatchObject({ role: 'qa', tk: 'X' });
        expect(envelope().ops.gate).toBe('build_executed');
        expect(orch(['handback', 'qa'], { input: say('qa', 'verify_pass') }).status).toBe(0);
        const run = runFile();
        expect(run.gate).toBe('verify_pass');
        expect(run.handbacks.map((h) => h.task ? `${h.role}:${h.task}` : h.role))
          .toEqual(['spec', 'plan', 'code:Task 1', 'code:Task 2', 'audit', 'qa']);
        expect(nextStep(run)).toEqual({ end: true });
      });
    });

    describe('scope [FEAT-011 AC8]', () => {
      it('extracts the Files block of each task, strips line suffixes and adds the plan file', () => {
        const tasks = extractTasks(TWO_TASKS);
        expect(tasks.map((t) => t.id)).toEqual(['Task 1', 'Task 2']);
        expect(taskScope(tasks[0], PLAN)).toEqual(['src/a.js', 'tests/a.test.js', PLAN]);
        expect(taskScope(tasks[1], PLAN)).toEqual(['src/b.js', PLAN]);
      });

      it('halts with ORCH_EMPTY_SCOPE on a task that declares no files', () => {
        expect(() => taskScope(extractTasks('### Task 1: nothing\n\n- [ ] **Step 1**\n')[0], PLAN)).toThrow('ORCH_EMPTY_SCOPE');
      });

      it('halts with ORCH_EMPTY_SCOPE on a plan with zero tasks, writing no gate', () => {
        driveTo('plan');
        plan('# Plan\n\nNo tasks here.\n');
        orch(['install', 'plan']);
        orch(['handback', 'plan'], { input: say('plan', 'boundary_routed') });
        const r = orch(['approve', 'plan', PLAN]);
        expect(r.status).toBe(1);
        expect(r.err).toMatch(/^ORCH_EMPTY_SCOPE: /);
        expect(runFile().gate).toBe('boundary_routed');
        expect(runFile().halt.code).toBe('ORCH_EMPTY_SCOPE');
      });

      it.each([[19, 'passes'], [20, 'halts']])('a task with %i files plus the plan file %s at the cap of 20', (n, outcome) => {
        const files = Array.from({ length: n }, (_, i) => `src/f${i}.js`);
        const call = () => taskScope({ id: 'Task 1', files }, PLAN);
        if (outcome === 'passes') expect(call()).toHaveLength(20);
        else expect(call).toThrow('ORCH_SCOPE_OVER_CAP: Task 1 needs 21 scope entries; the cap is 20');
      });

      it('halts on a scope path past the 300-character element cap rather than truncating it', () => {
        expect(() => taskScope({ id: 'Task 1', files: ['src/' + 'x'.repeat(300)] }, PLAN)).toThrow(/^ORCH_SCOPE_OVER_CAP: Task 1 has a 304-character path/);
      });

      it('installs a code envelope holding RW and exactly the task scope', () => {
        driveTo('code');
        expect(orch(['install', 'code']).status).toBe(0);
        expect(envelope().sys).toMatchObject({ role: 'code', tk: 'RW', ph: 'impl' });
        expect(envelope().ops).toMatchObject({ scope: ['src/a.js', 'tests/a.test.js', PLAN], gate: 'define_approved' });
      });
    });

    describe('run file [FEAT-011 AC9]', () => {
      it('start records boundary_routed in step mode by default, and auto with --auto', () => {
        expect(orch(['start', 'FEAT-011']).status).toBe(0);
        expect(runFile()).toMatchObject({ v: 1, session_id: 'sess-1', item: 'FEAT-011', mode: 'step', band: 'boundary', gate: 'boundary_routed', halt: null });
        orch(['end']);
        orch(['start', 'FEAT-011', '--auto']);
        expect(runFile().mode).toBe('auto');
      });

      it('refuses to start without CLAUDE_CODE_SESSION_ID (ORCH_NO_SESSION_ID)', () => {
        const r = orch(['start', 'FEAT-011'], { sid: '' });
        expect(r.status).toBe(1);
        expect(r.err).toMatch(/^ORCH_NO_SESSION_ID: /);
        expect(existsSync(join(root, RUN_FILE))).toBe(false);
      });

      it('refuses a second start in the same session (ORCH_RUN_ACTIVE), leaving the run untouched', () => {
        orch(['start', 'FEAT-011']);
        const before = readFileSync(join(root, RUN_FILE), 'utf8');
        const r = orch(['start', 'FEAT-012']);
        expect(r.status).toBe(1);
        expect(r.err).toBe('ORCH_RUN_ACTIVE: run FEAT-011 is live in this session; end it first');
        expect(readFileSync(join(root, RUN_FILE), 'utf8')).toBe(before);
      });

      it('replaces the stale run of another session and reports what it replaced', () => {
        orch(['start', 'FEAT-011'], { sid: 'old-session' });
        const { started } = runFile();
        writeFileSync(join(root, ENVELOPE_FILE), '{"stale":true}\n');
        mkdirSync(join(root, HANDBACK_DIR), { recursive: true });
        writeFileSync(join(root, HANDBACK_DIR, 'spec.txt'), 'stale\n');
        const r = orch(['start', 'FEAT-012']);
        expect(r.status).toBe(0);
        expect(r.out).toBe(`replaced the stale run FEAT-011 started ${started}`);
        expect(runFile()).toMatchObject({ item: 'FEAT-012', session_id: 'sess-1' });
        expect(existsSync(join(root, ENVELOPE_FILE))).toBe(false);
        expect(existsSync(join(root, HANDBACK_DIR))).toBe(false);
      });

      it('writes the run file atomically, leaving no temp file behind', () => {
        orch(['start', 'FEAT-011']);
        expect(readdirSync(join(root, '.claude', 'memory'))).toEqual(['orchestrator-run.json']);
      });

      it('end removes the run file, the envelope and the hand-back files, printing the run it removed', () => {
        driveTo('spec');
        orch(['install', 'spec']);
        mkdirSync(join(root, HANDBACK_DIR), { recursive: true });
        writeFileSync(join(root, HANDBACK_DIR, 'spec.txt'), say('spec', 'boundary_routed'));
        const r = orch(['end']);
        expect(r.status).toBe(0);
        expect(JSON.parse(r.out).item).toBe('FEAT-011');
        expect(existsSync(join(root, RUN_FILE))).toBe(false);
        expect(existsSync(join(root, ENVELOPE_FILE))).toBe(false);
        expect(existsSync(join(root, HANDBACK_DIR))).toBe(false);
      });

      it('halts with ORCH_RUN_INVALID on an unreadable run file, which cannot record its own halt', () => {
        runFileText('{not json');
        const r = orch(['install', 'spec']);
        expect(r.status).toBe(1);
        expect(r.err).toBe(`ORCH_RUN_INVALID: ${join(root, RUN_FILE)} is unreadable or not a v1 run file; clear it with: node ${relative(root, SCRIPT)} end`);
        expect(readFileSync(join(root, RUN_FILE), 'utf8')).toBe('{not json');
        expect(orch(['end']).status).toBe(0);
      });

      it('halts with ORCH_AGENT_MISSING against an empty agents directory', () => {
        mkdirSync(join(root, '.claude', 'agents'));
        orch(['start', 'FEAT-011']);
        const r = orch(['install', 'spec']);
        expect(r.status).toBe(1);
        expect(r.err).toBe('ORCH_AGENT_MISSING: no agent definition named spec in .claude/agents/ or ~/.claude/agents/');
        expect(runFile().halt.code).toBe('ORCH_AGENT_MISSING');
      });

      it('finds an agent definition in ~/.claude/agents/ by its name field', () => {
        agents(['spec'], join(home, '.claude', 'agents'));
        expect(findAgent('spec', root, home)).toBe(join(home, '.claude', 'agents', 'spec.md'));
        expect(findAgent('plan', root, home)).toBeNull();
      });

      it('refuses every verb but end once a run has halted (D12)', () => {
        orch(['start', 'FEAT-011']);
        orch(['install', 'spec']);
        agents();
        const r = orch(['install', 'spec']);
        expect(r.status).toBe(2);
        expect(r.err).toBe('orchestrate: run FEAT-011 halted with ORCH_AGENT_MISSING; recover with end, then start (D12)');
        expect(orch(['end']).status).toBe(0);
      });

      it('refuses to drive a run from another session', () => {
        driveTo('spec');
        const r = orch(['install', 'spec'], { sid: 'other-session' });
        expect(r.status).toBe(2);
        expect(r.err).toBe('orchestrate: run FEAT-011 belongs to another session; end it, or start to replace it');
      });

      it('refuses to install a role that is not next, writing nothing', () => {
        driveTo('spec');
        const r = orch(['install', 'plan']);
        expect(r.status).toBe(2);
        expect(r.err).toBe('orchestrate: install plan: the next step is install spec');
        expect(existsSync(join(root, ENVELOPE_FILE))).toBe(false);
      });

      it('install --check prints the envelope it would install and writes nothing', () => {
        driveTo('spec');
        const r = orch(['install', 'spec', '--check']);
        expect(r.status).toBe(0);
        expect(JSON.parse(r.out).sys).toMatchObject({ role: 'spec', tk: 'RW' });
        expect(existsSync(join(root, ENVELOPE_FILE))).toBe(false);
        expect(runFile().role).toBeNull();
      });
    });

    describe('every handoff is a validated envelope [FEAT-011 AC1, AC2]', () => {
      // A known envelope on disk, so "unchanged" is a byte comparison rather than an absence.
      function dispatched(role) {
        driveTo(role);
        orch(['install', role]);
        return envelopeText();
      }
      function expectHalt(r, code, before) {
        expect(r.status).toBe(1);
        expect(r.err.startsWith(`${code}: `)).toBe(true);
        expect(runFile().halt.code).toBe(code);
        expect(envelopeText()).toBe(before);
      }

      it('[AC1] install writes no envelope that fails snap-validate --to', () => {
        driveTo('spec');
        writeFileSync(join(root, RUN_FILE), JSON.stringify({ ...runFile(), gate: 'build_executed' }));
        const r = orch(['install', 'spec']);
        expect(r.status).toBe(1);
        expect(existsSync(join(root, ENVELOPE_FILE))).toBe(false);
      });

      it('[AC1] handback records nothing that fails snap-validate', () => {
        const before = dispatched('spec');
        const r = orch(['handback', 'spec'], { input: 'SNAP_HANDBACK {"v":3}\n' });
        expect(r.status).toBe(1);
        expect(runFile().handbacks).toEqual([]);
        expect(envelopeText()).toBe(before);
      });

      it.each([['no', ''], ['two', `${handbackLine('spec', 'boundary_routed')}\n${handbackLine('spec', 'boundary_routed')}\n`]])(
        '[AC2] ORCH_HANDBACK_MISSING on %s SNAP_HANDBACK lines', (_, input) => {
          const before = dispatched('spec');
          expectHalt(orch(['handback', 'spec'], { input }), 'ORCH_HANDBACK_MISSING', before);
        });

      it('[AC2] ORCH_HANDBACK_INVALID quotes the validator verbatim', () => {
        const before = dispatched('spec');
        const r = orch(['handback', 'spec'], { input: 'SNAP_HANDBACK {not json}\n' });
        expectHalt(r, 'ORCH_HANDBACK_INVALID', before);
        expect(r.err).toBe('ORCH_HANDBACK_INVALID: SNAP_ERROR: malformed JSON');
      });

      it('[AC2] ORCH_HANDBACK_INVALID on a valid envelope that is not v3', () => {
        const before = dispatched('spec');
        const v1 = 'SNAP_HANDBACK {"v":1,"sys":{"ph":"spec","c":"0000000","s":"FEAT-011"},"ops":{"n":[],"f":[]},"mem":{"d":[],"x":[]}}\n';
        const r = orch(['handback', 'spec'], { input: v1 });
        expectHalt(r, 'ORCH_HANDBACK_INVALID', before);
        expect(r.err).toBe('ORCH_HANDBACK_INVALID: a hand-back must be a v3 envelope, got v1');
      });

      it('[AC2] ORCH_HANDBACK_ROLE_MISMATCH when the hand-back names another role', () => {
        const before = dispatched('spec');
        expectHalt(orch(['handback', 'spec'], { input: say('plan', 'boundary_routed') }), 'ORCH_HANDBACK_ROLE_MISMATCH', before);
      });

      it('[AC2] ORCH_GATE_UNEARNED when spec claims define_approved, and plan is not dispatched', () => {
        const before = dispatched('spec');
        const r = orch(['handback', 'spec'], { input: say('spec', 'define_approved') });
        expectHalt(r, 'ORCH_GATE_UNEARNED', before);
        expect(r.err).toBe('ORCH_GATE_UNEARNED: spec may hand back boundary_routed, not define_approved');
        expect(orch(['install', 'plan']).status).toBe(2);
      });

      it('[AC2] ORCH_HANDBACK_CONFLICT on a second report for one position, keeping the first', () => {
        const before = dispatched('spec');
        orch(['handback', 'spec'], { input: say('spec', 'boundary_routed') });
        const first = runFile().handbacks;
        const r = orch(['handback', 'spec'], { input: say('spec', 'boundary_routed') });
        expectHalt(r, 'ORCH_HANDBACK_CONFLICT', before);
        expect(r.err).toBe('ORCH_HANDBACK_CONFLICT: spec already handed back for this position; a second report is not routed');
        expect(runFile().handbacks).toEqual(first);
      });

      it('[AC2] SNAP_GATE_MISMATCH halts install as the backstop behind the router', () => {
        const before = dispatched('spec');
        orch(['handback', 'spec'], { input: say('spec', 'boundary_routed') });
        orch(['approve', 'spec']);
        writeFileSync(join(root, RUN_FILE), JSON.stringify({ ...runFile(), gate: 'define_approved' }));
        const r = orch(['install', 'plan']);
        expectHalt(r, 'SNAP_GATE_MISMATCH', before);
        expect(r.err).toBe('SNAP_GATE_MISMATCH: SNAP_ERROR: SNAP_GATE_MISMATCH: plan expects boundary_routed, got define_approved');
      });
    });

    describe('write surface [FEAT-011 AC4]', () => {
      it('declares exactly the four entries the spec enumerates', () => {
        expect(WRITE_SURFACE).toEqual([
          '.claude/memory/orchestrator-run.json',
          '.claude/memory/band-envelope.json',
          '.claude/memory/session-snapshot.json',
          '.conductor/**',
        ]);
      });
    });
    ```
  - [X] [T-002-B] Run `npx vitest run tests/scripts/orchestrate.test.js`. Expected: the file fails to load with `Cannot find module '../../scripts/orchestrate.mjs'`, reading `Test Files 1 failed (1)` and `Tests no tests`.
  - [X] [T-002-C] Create `scripts/orchestrate.mjs` with exactly this content (sha256 `cb99c5a0c97e17d4004439ef8c9d29a84db47fcde5a96a68409ce2682152ace9`, 338 lines; every function ≤ 30 lines; amended 2026-10-01 on the D1 ruling, adding the `ORCH_HANDBACK_CONFLICT` check ahead of the refusal):
    ```js
    #!/usr/bin/env node
    // scripts/orchestrate.mjs
    // The band router (FEAT-011). It builds, validates and installs SNAP v3 envelopes and
    // records a run's position in a host-owned run file. It never edits a tracked file, and
    // it is the only writer of the run file. Zero dependencies, node: builtins only.
    import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
    import { spawnSync } from 'node:child_process';
    import { homedir, tmpdir } from 'node:os';
    import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
    import { fileURLToPath, pathToFileURL } from 'node:url';
    import { GATES, ROLE_BAND, V3_CAPS } from './snap-contract.mjs';

    const HERE = dirname(fileURLToPath(import.meta.url));

    export const RUN_FILE = '.claude/memory/orchestrator-run.json';
    export const ENVELOPE_FILE = '.claude/memory/band-envelope.json';
    // The orchestrator's whole write surface (D4). Guard 6 carries a copy pinned to this one.
    export const WRITE_SURFACE = [RUN_FILE, ENVELOPE_FILE, '.claude/memory/session-snapshot.json', '.conductor/**'];
    // Where /cc-orchestrate writes each agent's final message for `handback` to read: inside
    // the surface, and cleared with the run so file names never collide across runs.
    export const HANDBACK_DIR = '.conductor/handback';

    // D5: the reviewed role-artifact table. Code's scope comes from its plan task instead.
    export const ROLE_ARTIFACTS = {
      spec: { tk: 'RW', scope: ['docs/superpowers/specs/**'] },
      plan: { tk: 'RW', scope: ['docs/superpowers/plans/**'] },
      code: { tk: 'RW', scope: null },
      audit: { tk: 'R', scope: null },
      qa: { tk: 'X', scope: null },
    };
    // The router table's "may hand back" column.
    export const MAY_HAND_BACK = {
      spec: ['boundary_routed'], plan: ['boundary_routed'], code: ['build_executed'],
      audit: ['build_executed'], qa: ['verify_pass'],
    };
    const PHASE = { spec: 'spec', plan: 'plan', code: 'impl', audit: 'rev', qa: 'rev' };

    // A halt stops the run and is recorded in it (D12). A refusal is a misuse of the CLI:
    // nothing is written and nothing is recorded.
    export class Halt extends Error {
      constructor(code, reason) { super(`${code}: ${reason}`); this.code = code; this.reason = reason; }
    }
    export class Refusal extends Error {}

    const isPlainObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

    // The run root is the nearest ancestor of cwd holding the run file, the walk Guard 6
    // makes; before a run exists, it is the nearest one holding .claude/.
    export function findRunRoot(start) {
      for (const marker of [RUN_FILE, '.claude']) {
        for (let dir = resolve(start); ; dir = dirname(dir)) {
          if (existsSync(join(dir, marker))) return dir;
          if (dirname(dir) === dir) break;
        }
      }
      return resolve(start);
    }

    function writeAtomic(path, text) {
      mkdirSync(dirname(path), { recursive: true });
      const tmp = `${path}.${process.pid}.tmp`;
      writeFileSync(tmp, text);
      renameSync(tmp, path);
    }

    const scriptRef = (root) => relative(root, join(HERE, 'orchestrate.mjs')).split('\\').join('/');

    export function isValidRun(run) {
      return isPlainObject(run) && run.v === 1 && typeof run.session_id === 'string' && run.session_id !== ''
        && typeof run.item === 'string' && GATES.includes(run.gate) && isPlainObject(run.approvals)
        && Array.isArray(run.handbacks) && Array.isArray(run.tasks?.ids) && Number.isInteger(run.tasks?.done);
    }

    function readRun(root) {
      const path = join(root, RUN_FILE);
      if (!existsSync(path)) return null;
      let run = null;
      try { run = JSON.parse(readFileSync(path, 'utf8')); } catch { /* judged below */ }
      if (!isValidRun(run)) {
        throw new Halt('ORCH_RUN_INVALID', `${path} is unreadable or not a v1 run file; clear it with: node ${scriptRef(root)} end`);
      }
      return run;
    }

    const saveRun = (root, run) => writeAtomic(join(root, RUN_FILE), JSON.stringify(run, null, 2) + '\n');

    // Every verb but start and end drives a run that must exist, be this session's, and not be halted.
    function liveRun(root, sessionId) {
      const run = readRun(root);
      if (!run) throw new Refusal(`no run file at ${join(root, RUN_FILE)}; start one first`);
      if (run.session_id !== sessionId) {
        throw new Refusal(`run ${run.item} belongs to another session; end it, or start to replace it`);
      }
      if (run.halt) throw new Refusal(`run ${run.item} halted with ${run.halt.code}; recover with end, then start (D12)`);
      return run;
    }

    const handedBack = (run, role) => run.handbacks.some((h) => h.role === role);

    // The band sequence, read off the run's record.
    export function nextStep(run) {
      if (!handedBack(run, 'spec')) return { role: 'spec' };
      if (!run.approvals.spec) return { await: 'spec' };
      if (!handedBack(run, 'plan')) return { role: 'plan' };
      if (!run.approvals.plan) return { await: 'plan' };
      if (run.tasks.done < run.tasks.ids.length) return { role: 'code', task: run.tasks.ids[run.tasks.done] };
      if (!handedBack(run, 'audit')) return { role: 'audit' };
      if (!handedBack(run, 'qa')) return { role: 'qa' };
      return { end: true };
    }

    const describeStep = (s) => (s.role ? `install ${s.role}` : s.await ? `approve ${s.await}` : 'end');

    // D6: a gate crosses only a band boundary; inside a band the entry gate is re-issued.
    export function forwardGate(run, role, gate) {
      if (role === 'code') return run.tasks.done + 1 === run.tasks.ids.length ? gate : run.gate;
      if (role === 'qa') return gate;
      return run.gate;
    }

    // writing-plans tasks: `### Task N` opens one; its **Files:** block lists the paths.
    export function extractTasks(planText) {
      const tasks = [];
      let current = null;
      let inFiles = false;
      for (const line of planText.split(/\r?\n/)) {
        const head = line.match(/^### (Task \d+)\b/);
        if (head) { current = { id: head[1], files: [] }; tasks.push(current); inFiles = false; continue; }
        if (/^#{1,3} /.test(line)) { current = null; continue; }
        if (!current) continue;
        if (line.trim() === '**Files:**') { inFiles = true; continue; }
        const entry = inFiles && line.match(/^\s*- (?:Create|Modify|Test): (.*)$/);
        if (!entry) { inFiles = false; continue; }
        for (const m of entry[1].matchAll(/`([^`]+)`/g)) current.files.push(m[1].replace(/:\d+(-\d+)?$/, '').replace(/^\.\//, ''));
      }
      return tasks;
    }

    // D9: an empty scope is a plan defect, never a read-only fallback; scopes are never truncated.
    export function taskScope(task, planRel) {
      if (task.files.length === 0) throw new Halt('ORCH_EMPTY_SCOPE', `${task.id} declares no files`);
      const scope = [...new Set([...task.files, planRel])];
      const [cap, elemCap] = V3_CAPS['ops.scope'];
      if (scope.length > cap) throw new Halt('ORCH_SCOPE_OVER_CAP', `${task.id} needs ${scope.length} scope entries; the cap is ${cap}`);
      const long = scope.find((p) => p.length > elemCap);
      if (long) throw new Halt('ORCH_SCOPE_OVER_CAP', `${task.id} has a ${long.length}-character path; the cap is ${elemCap}`);
      return scope;
    }

    function readPlan(root, planRel) {
      if (!planRel || isAbsolute(planRel) || planRel.split(/[\\/]/).includes('..')) {
        throw new Refusal('usage: orchestrate.mjs approve plan <plan path relative to the run root>');
      }
      try { return readFileSync(join(root, planRel), 'utf8'); } catch { throw new Refusal(`cannot read ${planRel}`); }
    }

    // ORCH_AGENT_MISSING's search. Plugin-provided agents are not searched, a stated limit.
    export function findAgent(role, root, home = homedir()) {
      for (const dir of [join(root, '.claude', 'agents'), join(home, '.claude', 'agents')]) {
        let names = [];
        try { names = readdirSync(dir).filter((n) => n.endsWith('.md')); } catch { continue; }
        for (const n of names) {
          const front = readFileSync(join(dir, n), 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/);
          if (front && new RegExp(`^name:[ \\t]*${role}[ \\t]*$`, 'm').test(front[1])) return join(dir, n);
        }
      }
      return null;
    }

    function runScript(name, args, input = '') {
      const r = spawnSync(process.execPath, [join(HERE, name), ...args], { input, encoding: 'utf8' });
      return { status: r.status, out: r.stdout, err: (r.stderr || '').trim() };
    }

    // The validator reads a file, so the candidate goes through a private temp dir. Returns
    // the validator's error text, or '' when it passes.
    function validate(text, role) {
      const dir = mkdtempSync(join(tmpdir(), 'cc-orch-'));
      try {
        writeFileSync(join(dir, 'snap.json'), text);
        const r = runScript('snap-validate.mjs', [join(dir, 'snap.json'), ...(role ? ['--to', role] : [])]);
        return r.status === 0 ? '' : r.err || `snap-validate exited ${r.status}`;
      } finally { rmSync(dir, { recursive: true, force: true }); }
    }

    function gitValue(root, args, fallback) {
      const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
      return (r.status === 0 && r.stdout.trim()) || fallback;
    }

    function envelopeFields(run, root, step) {
      const head = gitValue(root, ['rev-parse', 'HEAD'], '0000000').toLowerCase();
      const { tk, scope } = ROLE_ARTIFACTS[step.role];
      const fields = {
        ph: PHASE[step.role], c: /^[0-9a-f]{7,40}$/.test(head) ? head : '0000000', s: run.item,
        n: [], f: [], d: [], x: [], role: step.role, tk, gate: run.gate,
      };
      if (step.role === 'code') {
        const task = extractTasks(readPlan(root, run.plan)).find((t) => t.id === step.task);
        fields.scope = taskScope(task ?? { id: step.task, files: [] }, run.plan);
      } else if (scope) fields.scope = scope;
      return fields;
    }

    // Builds and validates the next envelope with --to; installs it unless only checking.
    function install(root, sessionId, role, check) {
      const run = liveRun(root, sessionId);
      const step = nextStep(run);
      if (step.role !== role) throw new Refusal(`install ${role}: the next step is ${describeStep(step)}`);
      if (!findAgent(role, root)) {
        throw new Halt('ORCH_AGENT_MISSING', `no agent definition named ${role} in .claude/agents/ or ~/.claude/agents/`);
      }
      const built = runScript('snap-build.mjs', [], JSON.stringify(envelopeFields(run, root, step)));
      if (built.status !== 0) throw new Halt('SNAP_ERROR', built.err);
      const error = validate(built.out, role);
      if (error) throw new Halt(error.includes('SNAP_GATE_MISMATCH') ? 'SNAP_GATE_MISMATCH' : 'SNAP_ERROR', error);
      if (check) return built.out.trim();
      writeAtomic(join(root, ENVELOPE_FILE), built.out);
      saveRun(root, { ...run, band: ROLE_BAND[role], role });
      return built.out.trim();
    }

    export function recordHandback(run, role, gate) {
      const entry = { role, gate, at: new Date().toISOString(), ...(role === 'code' ? { task: run.tasks.ids[run.tasks.done] } : {}) };
      const tasks = role === 'code' ? { ...run.tasks, done: run.tasks.done + 1 } : run.tasks;
      return { ...run, role: null, gate: forwardGate(run, role, gate), tasks, handbacks: [...run.handbacks, entry] };
    }

    function parseHandback(text) {
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith('SNAP_HANDBACK '));
      if (lines.length !== 1) throw new Halt('ORCH_HANDBACK_MISSING', `expected exactly one SNAP_HANDBACK line, found ${lines.length}`);
      const json = lines[0].slice('SNAP_HANDBACK '.length).trim();
      const error = validate(json + '\n');
      if (error) throw new Halt('ORCH_HANDBACK_INVALID', error);
      const env = JSON.parse(json);
      if (env.v !== 3) throw new Halt('ORCH_HANDBACK_INVALID', `a hand-back must be a v3 envelope, got v${env.v}`);
      return env;
    }

    function handback(root, sessionId, role, text) {
      const run = liveRun(root, sessionId);
      // The binary refuses a second SubagentHandback, yet an agent can still report again (V1, F4).
      if (!run.role && run.handbacks.at(-1)?.role === role) {
        throw new Halt('ORCH_HANDBACK_CONFLICT', `${role} already handed back for this position; a second report is not routed`);
      }
      if (!run.role || run.role !== role) throw new Refusal(`handback ${role}: the dispatched role is ${run.role ?? 'none'}`);
      const env = parseHandback(text);
      if (env.sys.role !== role) throw new Halt('ORCH_HANDBACK_ROLE_MISMATCH', `dispatched ${role}, the hand-back names ${env.sys.role}`);
      if (!MAY_HAND_BACK[role].includes(env.ops.gate)) {
        throw new Halt('ORCH_GATE_UNEARNED', `${role} may hand back ${MAY_HAND_BACK[role].join('|')}, not ${env.ops.gate}`);
      }
      saveRun(root, recordHandback(run, role, env.ops.gate));
      return `${role} handed back ${env.ops.gate}`;
    }

    // Two human approvals, one gate write (A4): only an approved plan writes define_approved.
    function approve(root, sessionId, what, planRel) {
      const run = liveRun(root, sessionId);
      const step = nextStep(run);
      if (step.await !== what) throw new Refusal(`approve ${what}: the next step is ${describeStep(step)}`);
      const approval = { at: new Date().toISOString(), by: gitValue(root, ['config', 'user.name'], 'unknown') };
      if (what === 'spec') {
        saveRun(root, { ...run, approvals: { ...run.approvals, spec: approval } });
        return 'spec approved';
      }
      const tasks = extractTasks(readPlan(root, planRel));
      if (tasks.length === 0) throw new Halt('ORCH_EMPTY_SCOPE', `${planRel} holds no "### Task N" section`);
      for (const t of tasks) taskScope(t, planRel);
      saveRun(root, {
        ...run, gate: 'define_approved', plan: planRel, tasks: { ids: tasks.map((t) => t.id), done: 0 },
        approvals: { ...run.approvals, plan: approval },
      });
      return `plan approved: define_approved, ${tasks.length} task(s)`;
    }

    function start(root, sessionId, item, flag) {
      if (!/^[A-Z]+-\d{3,}$/.test(item ?? '') || (flag !== undefined && flag !== '--auto')) {
        throw new Refusal('usage: orchestrate.mjs start <ITEM> [--auto]');
      }
      if (!sessionId) throw new Halt('ORCH_NO_SESSION_ID', 'CLAUDE_CODE_SESSION_ID is absent or empty, so Guard 6 could never bind this run');
      const old = readRun(root);
      if (old && old.session_id === sessionId) throw new Halt('ORCH_RUN_ACTIVE', `run ${old.item} is live in this session; end it first`);
      if (old) clearRunFiles(root);
      saveRun(root, {
        v: 1, session_id: sessionId, item, mode: flag ? 'auto' : 'step', started: new Date().toISOString(),
        band: 'boundary', role: null, gate: 'boundary_routed', approvals: { spec: null, plan: null },
        plan: null, tasks: { ids: [], done: 0 }, handbacks: [], halt: null,
      });
      return old ? `replaced the stale run ${old.item} started ${old.started}` : `run ${item} started`;
    }

    function clearRunFiles(root) {
      rmSync(join(root, ENVELOPE_FILE), { force: true });
      rmSync(join(root, HANDBACK_DIR), { recursive: true, force: true });
    }

    // Prints the run it removes, so the closing report reads the record rather than memory.
    function end(root) {
      const path = join(root, RUN_FILE);
      const text = existsSync(path) ? readFileSync(path, 'utf8').trim() : 'no run file';
      rmSync(path, { force: true });
      clearRunFiles(root);
      return text;
    }

    function recordHalt(root, halt) {
      try {
        const run = readRun(root);
        if (run && !run.halt) saveRun(root, { ...run, halt: { code: halt.code, reason: halt.reason, at: new Date().toISOString() } });
      } catch { /* an unreadable run file cannot carry its own halt */ }
    }

    export function cli(argv, env, cwd = process.cwd()) {
      const [verb, a, b] = argv;
      const root = findRunRoot(cwd);
      const sid = env.CLAUDE_CODE_SESSION_ID;
      const verbs = {
        start: () => start(root, sid, a, b),
        install: () => install(root, sid, a, b === '--check'),
        handback: () => handback(root, sid, a, readFileSync(0, 'utf8')),
        approve: () => approve(root, sid, a, b),
        end: () => end(root),
      };
      try {
        if (!verbs[verb]) throw new Refusal('usage: orchestrate.mjs start|install|handback|approve|end');
        process.stdout.write(verbs[verb]() + '\n');
        return 0;
      } catch (e) {
        if (e instanceof Refusal) { process.stderr.write(`orchestrate: ${e.message}\n`); return 2; }
        if (!(e instanceof Halt)) throw e;
        if (verb !== 'start') recordHalt(root, e);
        process.stderr.write(`${e.code}: ${e.reason}\n`);
        return 1;
      }
    }

    const invoked = process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;
    if (invoked) process.exitCode = cli(process.argv.slice(2), process.env);
    ```
  - [X] [T-002-D] Run `npx vitest run tests/scripts/orchestrate.test.js`, expecting **50 / 50**. Then `npx vitest run tests/unit/snap-contract.test.js tests/unit/snap-validate.test.js tests/scripts/snap-build.test.js`, all passing with no file edited. Then `npm test`: **1203 / 0**, 45 files.
  - [X] [T-002-E] Append `- T-002: <one line>` under the plan section. Then:
    - `git add scripts/orchestrate.mjs tests/scripts/orchestrate.test.js`;
    - `git add -u .claude/memory/project.md docs/superpowers/plans/2026-10-01-feat011-orchestrator-band-router.md`.

    Commit `feat: orchestrate.mjs, the band router and its run file [FEAT-011]`. Expected: **1203 / 0**.

- [X] [T-003] **Guard 6, with R7** (AC3, AC3a's `DISPATCH` half, AC4, AC5, AC6; Review Focus 1–3). **Subagent, then a reviewer.** It runs in the main checkout with no worktree, and the subagent does not commit. Depends on T-002, whose `RUN_FILE` and `WRITE_SURFACE` the test imports, and on T-001's V3 verdict.
  - [X] [T-003-A] Create `tests/hooks/guard6.test.js` with exactly this content: sha256 `31e7d6bdb9575672c55c851f8983c42668650b4682135f3fdee51beb4204c2f1`, 30 tests, for the measured `systemMessage` verdict. It was amended on the D1 ruling, adding R7 ×7 and `[AC3a]`, and the stderr variant is retired.
    ```js
    import { describe, it, expect, beforeEach, afterEach } from 'vitest';
    import { spawnSync } from 'node:child_process';
    import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
    import { tmpdir } from 'node:os';
    import { join, resolve, dirname } from 'node:path';
    import { fileURLToPath, pathToFileURL } from 'node:url';
    import { RUN_FILE, WRITE_SURFACE } from '../../scripts/orchestrate.mjs';

    const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
    const HOOK = join(REPO_ROOT, '.claude/hooks/pre-tool-use.mjs');

    // The spike's measured key set (claude 2.1.286). Main session: no agent_id, no agent_type.
    // sid null leaves session_id out entirely.
    function payload(tool, filePath, { cwd, sid = 'sess-1', agentId, agentType } = {}) {
      return {
        ...(sid === null ? {} : { session_id: sid }), transcript_path: '/tmp/t.jsonl', cwd, prompt_id: 'prompt-1',
        permission_mode: 'default', effort: 'high', hook_event_name: 'PreToolUse',
        tool_name: tool, tool_input: { file_path: filePath, content: 'x' }, tool_use_id: 'toolu_1',
        ...(agentId ? { agent_id: agentId } : {}), ...(agentType ? { agent_type: agentType } : {}),
      };
    }

    // The whole stdout object, because a warning travels beside the decision, not inside it.
    function fire(p) {
      const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(p), cwd: p.cwd, encoding: 'utf8', timeout: 15000 });
      if (r.error) throw new Error(`hook spawn failed: ${r.error.message}`);
      expect(r.status).toBe(0);
      const out = r.stdout.trim() === '' ? {} : JSON.parse(r.stdout);
      return { decision: out.hookSpecificOutput ?? null, warning: `${out.systemMessage ?? ''}${r.stderr}`, out, stderr: r.stderr };
    }

    let root, sub;
    beforeEach(() => {
      // realpath: the macOS tmpdir is a symlink, and the guards compare paths without resolving links.
      root = realpathSync(mkdtempSync(join(tmpdir(), 'cc-guard6-')));
      sub = join(root, 'sub');
      mkdirSync(join(root, '.claude', 'memory'), { recursive: true });
      mkdirSync(join(sub, 'src'), { recursive: true });
    });
    afterEach(() => rmSync(root, { recursive: true, force: true }));

    const runFile = (text) => writeFileSync(join(root, RUN_FILE), text);
    const liveRun = (fields = {}) => runFile(JSON.stringify({ v: 1, session_id: 'sess-1', item: 'FEAT-011', started: '2026-10-01T12:00:00.000Z', gate: 'boundary_routed', ...fields }));
    const asMain = (target, opts = {}) => fire(payload('Write', target, { cwd: root, ...opts }));
    const denied = (target) => `Guard 6: ORCH_WRITE_DENIED: ${target} is outside the orchestrator's write surface while run FEAT-011 is live; repository writes during a run go through a band role (Guard 5).`;
    const tracked = () => join(root, 'README.md');
    // R7's tools carry no file_path. The inputs are the shapes FEAT-011 V1 logged on claude 2.1.287.
    const DISPATCH_INPUT = {
      Agent: { description: 'Write leaf.txt file', prompt: 'Write leaf.txt', subagent_type: 'leaf' },
      SendMessage: { to: 'main', summary: 'report', message: 'done', type: 'message' },
    };
    const dispatch = (tool, opts = {}) => fire({ ...payload(tool, '', { cwd: root, ...opts }), tool_input: DISPATCH_INPUT[tool] });
    const nested = (tool, agentType) => `Guard 6: ORCH_NESTED_DISPATCH: ${tool} from agent ${agentType} is denied while run FEAT-011 is live; only the orchestrator dispatches or messages agents during a run.`;

    describe('Guard 6: the orchestrator holds no repository write access [FEAT-011]', () => {
      it('[R1] steps aside for a band role, which Guard 5 governs', () => {
        liveRun();
        writeFileSync(join(root, '.claude', 'memory', 'band-envelope.json'), JSON.stringify({
          v: 3, sys: { ph: 'impl', c: 'abc1234', s: 'FEAT-011', role: 'code', tk: 'RW' },
          ops: { n: [], f: [], scope: ['sub/src/**'], gate: 'define_approved' }, mem: { d: [], x: [] },
        }));
        expect(fire(payload('Write', join(sub, 'src', 'a.js'), { cwd: sub, agentId: 'a1', agentType: 'code' })).decision).toBeNull();
      });

      it('[R2] allows every write when no run file exists', () => {
        const r = asMain(tracked());
        expect(r.decision).toBeNull();
        expect(r.warning).toBe('');
      });

      it.each([['bad JSON', '{not json'], ['a missing session_id', JSON.stringify({ v: 1, item: 'FEAT-011' })]])(
        '[R3] fails open with ORCH_RUN_INVALID on %s', (_, text) => {
          runFile(text);
          const r = asMain(tracked());
          expect(r.decision).toBeNull();
          expect(r.warning).toContain(`Guard 6: ORCH_RUN_INVALID: ${join(root, RUN_FILE)} is unreadable or not a valid run file`);
          expect(r.warning).toContain('Clear it with: node scripts/orchestrate.mjs end');
        });

      it.each([['another session', 'sess-2'], ['no session_id at all', null]])(
        '[R4] fails open with ORCH_RUN_STALE when the payload carries %s (AC5)', (_, sid) => {
          liveRun();
          const r = asMain(tracked(), { sid });
          expect(r.decision).toBeNull();
          expect(r.warning).toContain('Guard 6: ORCH_RUN_STALE: run FEAT-011 (started 2026-10-01T12:00:00.000Z) belongs to another session');
          expect(r.warning).toContain('Clear it with: node scripts/orchestrate.mjs end');
        });

      it.each([
        '.claude/memory/orchestrator-run.json', '.claude/memory/band-envelope.json',
        '.claude/memory/session-snapshot.json', '.conductor/cache.db',
      ])('[R5] allows the live session to write %s', (rel) => {
        liveRun();
        // Edit, because Guard 2 would rightly ask about the run file, which already exists.
        const r = fire(payload('Edit', join(root, rel), { cwd: root }));
        expect(r.decision).toBeNull();
        expect(r.warning).toBe('');
      });

      it('[R6] denies the main-session shape a tracked path', () => {
        liveRun();
        expect(asMain(tracked()).decision).toEqual({
          hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: denied(tracked()),
        });
      });

      // Discriminator: a Guard 6 keyed on agent_id (as if it marked a subagent) lets this through.
      // T-001 of ARCH-010 measured the shape in interactive mode on claude 2.1.286.
      it('[R6] denies an agent_id-only payload a tracked path', () => {
        liveRun();
        expect(asMain(tracked(), { agentId: 'adcc0758336c23e70' }).decision.permissionDecisionReason).toBe(denied(tracked()));
      });

      it('[R6] denies a non-role agent such as general-purpose a tracked path', () => {
        liveRun();
        expect(asMain(tracked(), { agentId: 'a2', agentType: 'general-purpose' }).decision.permissionDecisionReason).toBe(denied(tracked()));
      });

      it('[R6] denies a write that names no path', () => {
        liveRun();
        expect(asMain('').decision.permissionDecisionReason).toBe(denied('<no path>'));
      });

      it('denies near-miss names of the surface entries', () => {
        liveRun();
        for (const rel of ['.claude/memory/orchestrator-run.json.tmp', '.claude/memory/band-envelope.json.bak', '.conductorx/cache.db', '.claude/memory/project.md']) {
          expect(asMain(join(root, rel)).decision.permissionDecision).toBe('deny');
        }
      });

      it('denies a target above the run root', () => {
        liveRun();
        expect(asMain('../outside.txt').decision.permissionDecisionReason).toBe(denied('../outside.txt'));
      });

      it('anchors the surface at the run root, not at cwd', () => {
        liveRun();
        expect(fire(payload('Write', join(root, '.conductor', 'x.log'), { cwd: sub })).decision).toBeNull();
        expect(fire(payload('Write', join(sub, '.conductor', 'x.log'), { cwd: sub })).decision.permissionDecision).toBe('deny');
      });

      it('outranks Guard 2: an existing tracked file is denied, never asked about', () => {
        liveRun();
        writeFileSync(tracked(), 'exists\n');
        expect(asMain(tracked()).decision.permissionDecision).toBe('deny');
      });

      it('decides nothing with its warning: a stale run still lets Guard 2 ask', () => {
        liveRun({ session_id: 'sess-2' });
        writeFileSync(tracked(), 'exists\n');
        const r = asMain(tracked());
        expect(r.decision.permissionDecision).toBe('ask');
        expect(r.warning).toContain('Guard 6: ORCH_RUN_STALE');
      });

      it('[V3] warns on the channel V3 measured: systemMessage, with stderr left empty', () => {
        liveRun({ session_id: 'sess-2' });
        const r = asMain(tracked());
        expect(r.out.systemMessage).toContain('Guard 6: ORCH_RUN_STALE');
        expect(r.stderr).toBe('');
      });

      it('[AC6] registers Guard 6 between Guard 5 and Guard 2 on four distinct write-family arrays', async () => {
        const text = readFileSync(HOOK, 'utf8').replace(/try \{ main\(\); \}.*$/s, 'export { DISPATCH };\n');
        const dir = mkdtempSync(join(tmpdir(), 'cc-guard6-dispatch-'));
        try {
          writeFileSync(join(dir, 'hook.mjs'), text);
          const { DISPATCH } = await import(pathToFileURL(join(dir, 'hook.mjs')).href);
          const names = (tool) => DISPATCH[tool].map((g) => g.name);
          for (const tool of ['Write', 'create_file', 'write_file']) {
            expect(names(tool)).toEqual(['guard5BandScope', 'guard6OrchestratorRun', 'guard2DuplicateWrite']);
          }
          expect(names('Edit')).toEqual(['guard5BandScope', 'guard6OrchestratorRun']);
          expect(new Set(['Write', 'Edit', 'create_file', 'write_file'].map((t) => DISPATCH[t])).size).toBe(4);
        } finally { rmSync(dir, { recursive: true, force: true }); }
      });

      // Discriminator: a Guard 6 that checks the role skip before R7 lets both role cases through.
      it.each([['Agent', 'code'], ['Agent', 'general-purpose'], ['SendMessage', 'code']])(
        '[R7] denies %s from agent %s while the run is live', (tool, agentType) => {
          liveRun();
          expect(dispatch(tool, { agentId: 'a3', agentType }).decision).toEqual({
            hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: nested(tool, agentType),
          });
        });

      // Silent, not warned: dispatch outside a live run is the shipped cooperative posture.
      it.each([
        ['the main-session shape during a live run', true, {}],
        ['an agent_id-only payload during a live run', true, { agentId: 'adcc0758336c23e70' }],
        ['a role with no run file', false, { agentId: 'a3', agentType: 'code' }],
        ['a role during a stale run', 'stale', { agentId: 'a3', agentType: 'code' }],
      ])('[R7] decides nothing for an Agent call from %s', (_, run, opts) => {
        if (run === true) liveRun();
        if (run === 'stale') liveRun({ session_id: 'sess-2' });
        const r = dispatch('Agent', opts);
        expect(r.decision).toBeNull();
        expect(r.warning).toBe('');
      });

      it('[AC3a] registers Guard 6 alone on Agent and SendMessage, as distinct arrays', async () => {
        const text = readFileSync(HOOK, 'utf8').replace(/try \{ main\(\); \}.*$/s, 'export { DISPATCH };\n');
        const dir = mkdtempSync(join(tmpdir(), 'cc-guard6-r7-'));
        try {
          writeFileSync(join(dir, 'hook.mjs'), text);
          const { DISPATCH } = await import(pathToFileURL(join(dir, 'hook.mjs')).href);
          for (const tool of ['Agent', 'SendMessage']) expect(DISPATCH[tool].map((g) => g.name)).toEqual(['guard6OrchestratorRun']);
          expect(new Set(['Agent', 'SendMessage', 'Write', 'Edit'].map((t) => DISPATCH[t])).size).toBe(4);
        } finally { rmSync(dir, { recursive: true, force: true }); }
      });

      it('[AC4] carries the write surface and run path equal to scripts/orchestrate.mjs', () => {
        const text = readFileSync(HOOK, 'utf8');
        const list = (name) => JSON.parse(text.match(new RegExp(`const ${name} = (\\[[^\\]]*\\]);`))[1].replace(/'/g, '"'));
        expect(list('ORCH_WRITE_SURFACE')).toEqual(WRITE_SURFACE);
        expect(list('ORCH_RUN_REL').join('/')).toBe(RUN_FILE);
      });
    });
    ```
  - [X] [T-003-B] Run `npx vitest run tests/hooks/guard6.test.js`. Expected: **20 failed / 10 passed** (30). The ten that pass are R1, R2 and R5 ×4, the allow cases, and R7's four no-decision cases (see Predictions).
  - [X] [T-003-C] Modify `.claude/hooks/pre-tool-use.mjs` (sha256 before: `062c686f06daa03c70ef3384208c7d19a22680eca1dcccbcc9ee50cb5ed884d4`, 680 lines), with the Edit tool, in exactly this order (P15).
    - **C1, the shared helpers (P3).**
      - After `const isPlainObject = …;` (:121), insert:
        ```js
        const payloadCwd = (payload) => (typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd());
        ```
      - Replace `function findBandRoot(start) {` with these two lines:
        ```js
        // Guard 6 finds its run root by the same walk.
        function findRootHolding(start, rel) {
        ```
        Then, in that function, replace `while (!existsSync(join(dir, ...BAND_ENVELOPE_REL))) {` with `while (!existsSync(join(dir, ...rel))) {`.
      - In `guard5BandScope`, replace the two lines `const cwd = typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd();` and `const root = findBandRoot(cwd);` with:
        ```js
          const cwd = payloadCwd(payload);
          const root = findRootHolding(cwd, BAND_ENVELOPE_REL);
        ```

      Make the rename and its one call site in consecutive edits. The main session carries no `agent_type`, so Guard 5 returns before the call, and the gap between those two edits never throws for this session.
    - **C2a, the Guard 6 constants, strictly before C2b (P15).** Insert immediately before `// ── Guard 3 constants`, followed by one blank line:
      ```js
      // ── Guard 6 constants ─────────────────────────────────────────────────────────
      // Copies of scripts/orchestrate.mjs values (FEAT-011 AC4), carried for Guard 5's reason:
      // no import resolves from both install locations. tests/hooks/guard6.test.js pins them.
      const ORCH_RUN_REL = ['.claude', 'memory', 'orchestrator-run.json'];
      const ORCH_WRITE_SURFACE = ['.claude/memory/orchestrator-run.json', '.claude/memory/band-envelope.json', '.claude/memory/session-snapshot.json', '.conductor/**'];
      const ORCH_DISPATCH_TOOLS = ['Agent', 'SendMessage'];
      ```
    - **C2b, the Guard 6 functions, unregistered.** Insert immediately before `// ── Guard 3 constants`, after C2a's block, followed by one blank line:
      ```js
      // Only what Guard 6 itself reads is checked: an object with a session to bind to.
      function readRunFile(path) {
        try {
          if (statSync(path).size > BAND_ENVELOPE_MAX_BYTES) return null;
          const run = JSON.parse(readFileSync(path, 'utf8'));
          return isPlainObject(run) && typeof run.session_id === 'string' && run.session_id !== '' ? run : null;
        } catch { return null; }
      }

      // The deployed copy first, then source (FEAT-011 D11).
      const orchEnd = (root) => `node ${existsSync(join(root, '.claude', 'scripts', 'orchestrate.mjs')) ? '.claude/scripts' : 'scripts'}/orchestrate.mjs end`;

      // R7: on claude 2.1.287 a subagent can dispatch and message agents (FEAT-011 V1), so a role
      // could reach the envelope through a helper in two hops. During a live run only the main
      // session, which carries no agent_type, dispatches. Silent outside a live run: no warning.
      function guard6NestedDispatch(payload) {
        if (payload.agent_type == null) return null;
        const root = findRootHolding(payloadCwd(payload), ORCH_RUN_REL);
        if (!root) return null;
        const run = readRunFile(join(root, ...ORCH_RUN_REL));
        if (!run || payload.session_id !== run.session_id) return null;
        return deny(`Guard 6: ORCH_NESTED_DISPATCH: ${payload.tool_name} from agent ${payload.agent_type} is denied while run ${run.item} is live; only the orchestrator dispatches or messages agents during a run.`);
      }

      // Guard 6: while a run is live in this session, nothing but a band role writes outside the
      // orchestrator's write surface (FEAT-011 D3). Identity cannot mark the main session, so the
      // run's session_id is the key. Another session's run is stale: warned about, never enforced,
      // so a crashed run cannot lock a later session out. R7 precedes the role skip, because a
      // role's dispatch is exactly what it closes.
      function guard6OrchestratorRun(input, payload) {
        if (ORCH_DISPATCH_TOOLS.includes(payload.tool_name)) return guard6NestedDispatch(payload);
        if (BAND_ROLES.includes(payload.agent_type)) return null;
        const cwd = payloadCwd(payload);
        const root = findRootHolding(cwd, ORCH_RUN_REL);
        if (!root) return null;
        const file = join(root, ...ORCH_RUN_REL);
        const run = readRunFile(file);
        if (!run) return warn(`Guard 6: ORCH_RUN_INVALID: ${file} is unreadable or not a valid run file, so writes are not restricted. Clear it with: ${orchEnd(root)}`);
        if (payload.session_id !== run.session_id) {
          return warn(`Guard 6: ORCH_RUN_STALE: run ${run.item} (started ${run.started}) belongs to another session, so writes are not restricted. Clear it with: ${orchEnd(root)}`);
        }
        const target = targetPath(input);
        const rel = relative(root, resolve(cwd, target)).split(sep).join('/');
        if (target !== '' && ORCH_WRITE_SURFACE.some((g) => globToRegExp(g).test(rel))) return null;
        return deny(`Guard 6: ORCH_WRITE_DENIED: ${target || '<no path>'} is outside the orchestrator's write surface while run ${run.item} is live; repository writes during a run go through a band role (Guard 5).`);
      }
      ```
      `warn` is referenced only when Guard 6 runs, and nothing registers `guard6OrchestratorRun` or `guard6NestedDispatch` until C5. So the unregistered block is inert, even before C3 defines `warn`. C2a has already defined every constant it reads.
    - **C3, the warning channel: `systemMessage`, as T-001's V3 measured.**
      - Replace the whole `function emit(decision) { … }` (:22–28) with:
        ```js
        let warning = '';

        // A warning decides nothing (FEAT-011): it rides the call's decision, or goes out alone
        // once every guard has passed. systemMessage is the channel V3 measured reaching the user.
        function warn(msg) {
          warning += (warning ? '\n' : '') + msg;
          return null;
        }

        function emit(decision) {
          if (emitted) return;
          emitted = true;
          process.stdout.write(JSON.stringify({
            ...(warning ? { systemMessage: warning } : {}),
            ...(decision ? { hookSpecificOutput: { hookEventName: 'PreToolUse', ...decision } } : {}),
          }) + '\n');
        }
        ```
        Every existing `emit` call passes a decision, so its output is byte-identical while `warning` is empty.
    - **C4, the lone warning.** In `main`, after the `for (const guard of guards) { … }` loop's closing `}`, insert `  if (warning) emit(null);`.
    - **C5, the registration, last.** Replace:
      ```js
      // Guard 5 runs first on every write-family tool: a scope deny outranks Guard 2's ask.
      for (const tool of BAND_WRITE_TOOLS) DISPATCH[tool].unshift(guard5BandScope);
      ```
      with:
      ```js
      // Guards 5 and 6 run first on every write-family tool, in that order: a scope deny
      // outranks Guard 2's ask, and Guard 6 steps aside for the band roles Guard 5 governs.
      for (const tool of BAND_WRITE_TOOLS) DISPATCH[tool].unshift(guard5BandScope, guard6OrchestratorRun);
      // R7 sees dispatch only where settings.json routes it: the matcher names Agent and SendMessage.
      for (const tool of ORCH_DISPATCH_TOOLS) DISPATCH[tool] = [guard6OrchestratorRun];
      ```

    **After every step, run the hook, not only parse it** (P15).
    - **Before C1,** write two fixtures to `<scratchpad>`, with `<repo>` and `<scratchpad>` as absolute paths:
      - `smoke-write.json`: `{"session_id":"smoke","cwd":"<repo>","hook_event_name":"PreToolUse","tool_use_id":"t","tool_name":"Write","tool_input":{"file_path":"<scratchpad>/smoke.txt","content":"x"}}`
      - `smoke-agent.json`: `{"session_id":"smoke","cwd":"<repo>","hook_event_name":"PreToolUse","tool_use_id":"t","tool_name":"Agent","agent_id":"a","agent_type":"code","tool_input":{"subagent_type":"leaf","prompt":"p"}}`
    - **After each of C1 (all four edits), C2a, C2b, C3, C4 and C5,** run `node .claude/hooks/pre-tool-use.mjs < <scratchpad>/smoke-write.json`, then the same with `smoke-agent.json`. Each must exit 0 with empty stdout. A stdout carrying "the hook threw" is a `ReferenceError` the parser cannot see. **Halt rule:** any other result stops the task before the next edit.

    **The replay that proves this order.** Planning replayed this exact order on the original hook as string replacements. After every step it ran five payloads: main-session `Write`, `general-purpose` `Edit`, role `Agent`, main-session `Read` and role `Write`.
    - **Every state loaded and ran.** The one throw was a band-role `Write` between the C1 rename and its call site, which the hook turns into a fail-closed deny. That is the window C1's note already accepts: no band role runs during T-003, and its subagent is not one.
    - **The final state equalled the draft byte for byte.**

    Expected result: **750 lines**, sha256 `d03d21286de263ac5f38b0a4460de32ecbedce886bde83fa39c583afd463eba6`, the planning draft byte for byte (the `systemMessage` hook, amended with R7). **Halt rule:** a different sha256 stops the task for a diff review before anything else runs.
  - [X] [T-003-D] Copy `.claude/hooks/pre-tool-use.mjs` over `project-template/.claude/hooks/pre-tool-use.mjs`, and confirm both with `cmp`.
  - [X] [T-003-E] Run `npx vitest run tests/hooks tests/installer/templates.test.js`, all passing: 9 files, **503 tests** (473 + 30). Then `npm test`: **1233 / 0**, 46 files.
  - [X] [T-003-F] **Reviewer** (fresh, read-only):
    - confirm the hook's sha256 against T-003-C, and the mirror by `cmp`;
    - re-run all eight mutants on a scratch copy, with the real hook untouched. Each turns exactly its pinned tests red (Predictions: M1 4, M1b 1, M2 2, M2b 1, M3 1, M4 2, M5 2, M6 1);
    - confirm `git worktree list` shows one entry, and `git log` shows no subagent commit.

    Each finding is ruled by the owner before T-003-G.
  - [X] [T-003-G] Append `- T-003: <one line, written by the subagent per its brief>` under the plan section. Then:
    - `git add tests/hooks/guard6.test.js`;
    - `git add -u .claude/hooks/pre-tool-use.mjs project-template/.claude/hooks/pre-tool-use.mjs .claude/memory/project.md docs/superpowers/plans/2026-10-01-feat011-orchestrator-band-router.md`.

    Commit `feat: Guard 6 holds the orchestrator to its declared write surface [FEAT-011]`. Expected: **1233 / 0**.

- [X] [T-004] **Ignore and host-own the run file; ignore `.conductor/` in projects; route `Agent` and `SendMessage` to the hook** (AC10, AC3a, the folded `README.md:325` observation, P14). Native. Depends on T-000, and on T-003 for the matcher steps: `DISPATCH` must hold the `Agent` and `SendMessage` entries before any settings file routes those tools to the hook.
  - [X] [T-004-A] Modify `tests/installer/templates.test.js`: append inside `describe('project-template/gitignore', …)`, after the `[AC13]` test:
    ```js
      // Discriminator for the folded README:325 observation: red on the pre-FEAT-011 template,
      // which never listed .conductor/.
      it('[FEAT-011 AC10] ignores the run file and .conductor/ as the fifth and sixth managed entries', () => {
        const lines = readFileSync(join(root, 'project-template/gitignore'), 'utf8').split('\n').map(l => l.trim());
        expect(lines.filter(l => l && !l.startsWith('#'))).toEqual([
          '.claude/memory/turn-count.txt', '*.installer-backup.*', '*.installer-tmp.*', '.claude/memory/band-envelope.json',
          '.claude/memory/orchestrator-run.json', '.conductor/',
        ]);
      });
    ```
  - [X] [T-004-B] Run `npx vitest run tests/installer/templates.test.js -t "managed entr"`. Expected: **1 failed / 1 passed / 36 skipped (38)**. The new test is red and `[AC13]` is green.
  - [X] [T-004-C] Modify `project-template/gitignore`: append `.claude/memory/orchestrator-run.json` and `.conductor/` as lines 6 and 7, keeping the trailing newline.
  - [X] [T-004-D] Run the T-004-B command again. Expected: **1 failed / 1 passed / 36 skipped (38)**, now with **`[AC13]` red** (the carried-forward T-006-A red) and the new test green.
  - [X] [T-004-E] Run `npm test`. Expected: **1 failed / 1233 passed (1234)**, and the one failure is `[AC13]`. **Halt rule:** any other failure stops the task.
  - [X] [T-004-F] Modify the `[AC13]` test in `tests/installer/templates.test.js` (P14):
    - insert above its `it(` line: `  // The full list is FEAT-011 AC10's below; this keeps ARCH-010's own claim, the fourth entry.`;
    - change `expect(lines.filter(l => l && !l.startsWith('#'))).toEqual([` to `expect(lines.filter(l => l && !l.startsWith('#')).slice(0, 4)).toEqual([`.
  - [X] [T-004-G] Modify `lib/installer/host-owned.mjs`: insert `  ['memory/orchestrator-run.json', 'skip'],` after `  ['memory/band-envelope.json', 'skip'],` (:43).
  - [X] [T-004-H] Modify `tests/installer/deploy.test.js:15`, the fixture that mirrors the template. In `TPL_GITIGNORE`, after `.claude/memory/band-envelope.json\n`, append `.claude/memory/orchestrator-run.json\n.conductor/\n`. **Halt rule:** `deploy.test.js` read 53 / 53 before and after this edit in planning. Any other reading stops the task, because a fixture change may not rewrite an expectation silently.
  - [X] [T-004-I] Modify `tests/installer/settings-merge.test.js` (AC3a; amended on the D1 ruling):
    - after `import { join } from 'node:path';`, insert `import { fileURLToPath } from 'node:url';`;
    - change `import { MERGE_OWNED_KEYS } from '../../lib/installer/host-owned.mjs';` to `import { MERGE_OWNED_KEYS, PROJECT_SETTINGS_FINGERPRINTS } from '../../lib/installer/host-owned.mjs';`;
    - inside `describe('mergeSettingsFile: owned entries', …)`, immediately before `it('is byte-identical on a second run of an unchanged release', …)`, insert:
    ```js
      // The shipped template over the entry a 1.35.0 install wrote: R7 is dead on a host the
      // merge leaves on the old matcher, because the hook is never invoked for Agent. The whole
      // entry is compared, so a merge that dropped Read through Bash (Guards 1-5) fails too.
      it('[FEAT-011 AC3a] carries the shipped Agent and SendMessage matcher over a 1.35.0 entry', () => {
        const shipped = fileURLToPath(new URL('../../project-template/.claude/settings.json', import.meta.url));
        const earlier = { matcher: 'Read|Write|Edit|create_file|write_file|Bash', hooks: [{ type: 'command', command: 'node .claude/hooks/pre-tool-use.mjs' }] };
        write(sp, { hooks: { PreToolUse: [HOST_ENTRY, earlier] } });
        mergeSettingsFile(shipped, sp, PROJECT_SETTINGS_FINGERPRINTS);
        const arr = read(sp).hooks.PreToolUse;
        expect(arr).toHaveLength(2);
        expect(arr[0]).toEqual(HOST_ENTRY);
        expect(arr[1]).toEqual(read(shipped).hooks.PreToolUse[0]);
        expect(arr[1].matcher.split('|')).toEqual(expect.arrayContaining(['Agent', 'SendMessage']));
      });
    ```
    The exact-entry assertion is the owner's strengthening. With `arrayContaining` alone, a merge that collapsed the matcher to `Agent|SendMessage` would pass while stripping Guards 1–5 from every install.
  - [X] [T-004-J] Run `npx vitest run tests/installer/settings-merge.test.js -t "AC3a"`. Expected: **1 failed / 17 skipped (18)**. On the old template the exact-entry assertion passes and the `Agent`/`SendMessage` assertion fails.
  - [X] [T-004-K] Modify the union-matcher pin in `tests/installer/templates.test.js`:
    - insert above its `it.each(SETTINGS)(` line: `  // Agent and SendMessage likewise: without them Guard 6's R7 never runs (FEAT-011 AC3a).`;
    - change `expect(entries[0].matcher).toBe('Read|Write|Edit|create_file|write_file|Bash');` to `expect(entries[0].matcher).toBe('Read|Write|Edit|create_file|write_file|Bash|Agent|SendMessage');`;
    - after `expect(entries[0].matcher.split('|')).toContain('Bash');`, insert `    expect(entries[0].matcher.split('|')).toContain('Agent');` and `    expect(entries[0].matcher.split('|')).toContain('SendMessage');`.

    Then run `npx vitest run tests/installer/templates.test.js -t "union matcher"`. Expected: **2 failed / 36 skipped (38)**.
  - [X] [T-004-L] Modify `.claude/settings.json` and `project-template/.claude/settings.json`, one Edit each. Change `"matcher": "Read|Write|Edit|create_file|write_file|Bash",` to `"matcher": "Read|Write|Edit|create_file|write_file|Bash|Agent|SendMessage",`.
    - **Parse check, added by owner ruling at T-004's go.** Immediately after each settings edit, and before anything else runs, `JSON.parse` both settings files. **Halt rule:** any parse failure stops the task before the next step.
    - **Measured:** both files parsed after the `.claude/settings.json` edit, and both again after the template edit.
    - **The live file takes effect in this session.** From here the hook runs on this session's `Agent` and `SendMessage` calls, and no run file exists here, so R7 decides nothing.
    - Then run `npx vitest run tests/installer/settings-merge.test.js tests/installer/templates.test.js`. Expected: **56 / 56** (18 + 38).

    **No full-suite run happens between T-004-I and T-004-L.** Those steps hold up to three reds at once: the AC3a merge test and both union-matcher cases. Only the targeted commands above run, until T-004-M.
  - [X] [T-004-M] Run these checks:
    1. `git check-ignore -v .claude/memory/orchestrator-run.json`, expecting `.gitignore:36:/.claude/memory/*`;
    2. `git ls-files --error-unmatch .claude/memory/orchestrator-run.json`, expecting rc 1;
    3. `npx vitest run tests/installer tests/unit/host-owned-ignore-xor.test.js`, expecting **304 / 304** across 17 files (302 + 1 + 1);
    4. `npm test`, expecting **1235 / 0**.
  - [X] [T-004-N] Append `- T-004: <one line>` under the plan section. Then `git add -u project-template/gitignore lib/installer/host-owned.mjs tests/installer/templates.test.js tests/installer/deploy.test.js tests/installer/settings-merge.test.js .claude/settings.json project-template/.claude/settings.json .claude/memory/project.md docs/superpowers/plans/2026-10-01-feat011-orchestrator-band-router.md`. Commit `feat: ignore and host-own the orchestrator run file, ignore .conductor/ in projects, and route Agent and SendMessage to the hook [FEAT-011]`. The commit gate expects **1235 / 0**.

- [X] [T-005] **The `/cc-orchestrate` command, in both mirrors** (AC10, D7, D11, P10). Native. Depends on T-002.
  - [X] [T-005-A] Modify `tests/installer/commands-parity.test.js`: append at the end of the file:
    ```js

    // The command resolves its script by presence (FEAT-011 D11), so unlike the mirrors above
    // the two copies carry no path nesting to undo: they are byte-identical.
    const ORCH_MIRRORS = ['.claude/commands/cc-orchestrate.md', 'project-template/.claude/commands/cc-orchestrate.md'];

    describe('cc-orchestrate mirrors [FEAT-011 AC10]', () => {
      it('are byte-identical', () => {
        expect(read(ORCH_MIRRORS[1])).toBe(read(ORCH_MIRRORS[0]));
      });

      it('probe the deployed script before the source script (D11)', () => {
        expect(read(ORCH_MIRRORS[0])).toContain('S=.claude/scripts; [ -f "$S/orchestrate.mjs" ] || S=scripts');
      });
    });
    ```
  - [X] [T-005-B] Run `npx vitest run tests/installer/commands-parity.test.js -t "cc-orchestrate"`. Expected: **2 failed / 30 skipped (32)**, each failure `ENOENT`.
  - [X] [T-005-C] Create `.claude/commands/cc-orchestrate.md` with exactly this content (sha256 `97176ee7e40fe552525c48785afd6fb0075540d7d63a945508738676bf0fe4a5`; it was `c4d1b32537ff83cdfe63586d9d66671c1126f65bba104da6ed7aca9d27524ca7` until T-005-H). It was amended on the D1 ruling: a wait for the completion notice, the delivered `SubagentHandback` report as the hand-back, the second-report route to `ORCH_HANDBACK_CONFLICT`, the in-flight wait on a halt, and the brief's verify-first and no-dispatch lines. In the clone it measured 36 / 36 on parity, and 1237 / 0 on the full suite. Then copy it to `project-template/.claude/commands/cc-orchestrate.md` and confirm the two with `cmp`.
    ````markdown
    ---
    description: "(Conductor) Route one backlog item through Define, Build and Verify by validated SNAP handoffs"
    ---

    # /cc-orchestrate <ITEM> [--auto]

    You are the orchestrator for one run (FEAT-011). You hold no repository write access. You never write a tracked file, and while the run is live Guard 6 denies any write-family call outside your write surface:
    - `.claude/memory/orchestrator-run.json`
    - `.claude/memory/band-envelope.json`
    - `.claude/memory/session-snapshot.json`
    - `.conductor/**`

    You move work only through `orchestrate.mjs` and the `Agent` tool. Release, `project.md` and the closeout stay with the human. Bash is outside Guard 6, as it is outside Guard 5: never use it to write a repository file.

    ## Resolve the script (D11)

    Begin every Bash call that runs the script with the same resolution, the deployed copy first, then source:

    ```sh
    S=.claude/scripts; [ -f "$S/orchestrate.mjs" ] || S=scripts
    ```

    Then run `node "$S/orchestrate.mjs" <verb> ...` in that same call. The exit codes:
    - `0`: success.
    - `1`: a halt. The code and the reason are on stderr and recorded in the run file.
    - `2`: a refusal. Nothing was written. Read the message: it names the step the run is actually at.

    ## On any halt

    1. Print the stderr line verbatim.
    2. Dispatch nothing further. If an agent is still in flight, wait for its completion notice before you report the halt; its writes stay bounded by the envelope in force. Then stop.

    A halt is terminal in v1 (D12). Recovery is `node "$S/orchestrate.mjs" end`, then a fresh `start`, each only on the owner's word.

    ## Steps

    1. **Start.** Run `node "$S/orchestrate.mjs" start $ARGUMENTS`.
       - If stdout names a replaced stale run, report its item and start time.
       - On `ORCH_RUN_ACTIVE`, report it, offer `end`, and stop.

       Print the run header: the item, the mode (`step` unless `--auto` was given), and the first role, `spec`.
    2. **Each dispatch.** Take the roles in band order: `spec`, `plan`, then `code` once per plan task, then `audit`, then `qa`. For each one:
       1. **Check.** Run `node "$S/orchestrate.mjs" install <role> --check`. Print the role and the envelope it prints, and state that `--to <role>` passed.
       2. **Pause.** In step mode, ask the owner for a go. On a decline, stop: the run stays at its position, and nothing is installed. Under `--auto`, skip this pause.
       3. **Install.** Run `node "$S/orchestrate.mjs" install <role>`.
       4. **Dispatch.** Use the `Agent` tool with `subagent_type: <role>` and the brief below. Dispatch one agent at a time, never in parallel (D8).
       5. **Wait.** Dispatch returns before the agent finishes, and an agent can keep acting after its hand-back. Wait for the agent's completion notice. Run nothing for this position until it arrives (D8).
       6. **Hand back.**
          1. Write the agent's **delivered `SubagentHandback` report** with the Write tool, verbatim, to `.conductor/handback/<role>.txt`. That is the one report the binary delivered, never a later message. For code, use `.conductor/handback/code-<N>.txt`, where `<N>` is the task number.
          2. Run `node "$S/orchestrate.mjs" handback <role> < <that file>`.
          3. Keep the agent's `Observation:` line for the report.
          4. If a second `SNAP_HANDBACK` from that agent reaches you for the same position, write it to `.conductor/handback/<role>-second.txt` (`code-<N>-second.txt` for code) and run `handback <role>` on it. It halts with `ORCH_HANDBACK_CONFLICT`. Then follow "On any halt".
    3. **The two define approvals.** These pause in both modes.
       - **After spec:** show the owner the spec path from the hand-back. On approval, run `node "$S/orchestrate.mjs" approve spec`.
       - **After plan:** show the owner the plan path named in the hand-back's `ops.f`. On approval, run `node "$S/orchestrate.mjs" approve plan <plan path>`. This writes `define_approved`, the only gate you author after `boundary_routed`.
    4. **Build.** Dispatch `code` once per plan task, serially, until the router moves on to `audit`. A `--check` refusal names the next step.
    5. **Verify.** Dispatch `audit`, then `qa`. When `qa`'s hand-back records `verify_pass`, run `node "$S/orchestrate.mjs" end`. It prints the run it removed.
    6. **Report.** From the record `end` printed, name:
       - every hand-back, with its role, gate and task;
       - both approvals, with who approved and when;
       - every agent's observation line.

       Then state that release is human, by `docs/RELEASE-CLOSEOUT.md`.

    ## The dispatch brief

    Fill in each `<...>` from the run and the role.

    ```text
    You are the <role> role for <ITEM>, dispatched by the FEAT-011 orchestrator.
    Your band envelope is installed at .claude/memory/band-envelope.json: tk <tk>, scope <scope, or none>.
    Guard 5 denies any write outside that scope. Do not get around a denial or a missing tool, for
    example with shell redirection. Report it instead.
    Task: <the role's task, below>
    Verify your work before you hand back: your first hand-back is final, and a second is refused.
    Do not dispatch or message other agents; Guard 6 denies it during a run.
    Copy ops.scope verbatim from your envelope into the hand-back; if your envelope has no scope, leave the key out.
    End your hand-back report with exactly these two lines, each on its own line:
    Observation: <one line, what this handoff taught>
    SNAP_HANDBACK <one-line SNAP v3 JSON: {"v":3,"sys":{"ph":"<ph>","c":"<commit>","s":"<ITEM>","role":"<role>","tk":"<tk>"},"ops":{"n":[],"f":[<files you touched, as "path:C|M|D">],"scope":<your envelope's ops.scope>,"gate":"<gate>"},"mem":{"d":[],"x":[]},"pr":""}>
    ```

    The role's task, its `ph`, and the gate it hands back:

    | Role | Task | `ph` | Gate |
    |---|---|---|---|
    | `spec` | Write the spec for `<ITEM>` under `docs/superpowers/specs/`. | `spec` | `boundary_routed` |
    | `plan` | Write the plan under `docs/superpowers/plans/` in the writing-plans format: `### Task N` headings, each with a `**Files:**` block. Name the plan path in `ops.f`. | `plan` | `boundary_routed` |
    | `code` | Implement `<Task N>` of `<plan>`, touching only its files, and tick its boxes in the plan. | `impl` | `build_executed` |
    | `audit` | Review the changes against the spec and the plan, read-only. | `rev` | `build_executed` |
    | `qa` | Run the project's tests and report. If verification fails, leave out the `SNAP_HANDBACK` line and say why. | `rev` | `verify_pass` |
    ````
  - [X] [T-005-D] Modify `.gitignore`: insert `!/.claude/commands/cc-orchestrate.md` between `!/.claude/commands/cc-init.md` (:38) and `!/.claude/commands/cc-plan.md`, in sorted position. This pays the toll before staging. Planning measured `gitignore-block-parity` at 2 failed / 2 passed with the file indexed and no leaf, and plain `git add` at rc 0 once the leaf was in.
  - [X] [T-005-E] Stage, before measuring, because block parity reads the index:
    - `git add .claude/commands/cc-orchestrate.md project-template/.claude/commands/cc-orchestrate.md`, plain, now that the leaf exists;
    - `git add -u .gitignore tests/installer/commands-parity.test.js`.
  - [X] [T-005-F] Run `npx vitest run tests/installer/commands-parity.test.js tests/unit/gitignore-block-parity.test.js`, expecting **36 / 36**. Then `npm test`: **1237 / 0**.
  - [X] [T-005-G] Append `- T-005: <one line>` under the plan section. Then `git add -u .claude/memory/project.md docs/superpowers/plans/2026-10-01-feat011-orchestrator-band-router.md`. Commit `feat: add the /cc-orchestrate command [FEAT-011]`. Expected: **1237 / 0**.
  - [X] [T-005-H] **Amended on T-006's demo, which caught a defect in the shipped template.** Run A's spec hand-back carried `tk` `RW` and no `ops.scope`, and `handback spec` halted `ORCH_HANDBACK_INVALID: SNAP_ERROR: missing: ops.scope (required when tk is RW)`. `snap-validate.mjs:25` requires `ops.scope` only when `tk` is `RW`, and `:27` caps it whenever it is present. `envelopeFields` gives spec, plan and code (`RW`) a scope and gives audit (`R`) and qa (`X`) none. The brief therefore tells the agent to copy `ops.scope` verbatim from its envelope and to leave the key out when the envelope has none, which is correct for every `tk` and invents nothing. The draft above now carries that line and the template's `"scope"` field, at sha `97176ee7…`. Overwrite both mirrors from it with Write, then confirm with `cmp`. No test asserts on the brief text, so the counts are predicted unchanged: `npx vitest run tests/installer/commands-parity.test.js tests/unit/gitignore-block-parity.test.js` at **36 / 36**, and `npm test` at **1237 / 0**, 46 files. Then `git add -u .claude/commands/cc-orchestrate.md project-template/.claude/commands/cc-orchestrate.md .claude/memory/project.md docs/superpowers/plans/2026-10-01-feat011-orchestrator-band-router.md` (BUG-054). Commit `fix: the handback template omits ops.scope, which the validator requires for RW [FEAT-011]`.

- [X] [T-006] **AC12: the live demo, in a scratch project.** Owner driving, step mode. Depends on T-002 through T-005. **Halt rule:** any of the four facts landing otherwise than below stops the task for a ruling before release. **Every T-006 record states its session's `permission_mode`,** read from that session's payloads (AC12, amended on the D1 ruling).
  - [X] [T-006-A] Create `<scratchpad>/demo-feat011`. Run `git init`, write `README.md` containing `demo`, and commit it, so the run has a tracked path to be denied. Then copy in, from this branch:
    - `scripts/orchestrate.mjs`, `scripts/snap-contract.mjs`, `scripts/snap-build.mjs` and `scripts/snap-validate.mjs`, into `scripts/`. There is no `.claude/scripts/`, so D11 falls through to source;
    - `.claude/hooks/pre-tool-use.mjs`;
    - `.claude/commands/cc-orchestrate.md`;
    - T-001's `log.mjs` and `read-payloads.mjs`.

    Then write:
    - `.claude/settings.json`:
      ```json
      { "hooks": { "PreToolUse": [
        { "matcher": "*", "hooks": [ { "type": "command", "command": "node .claude/hooks/log.mjs" } ] },
        { "matcher": "Read|Write|Edit|create_file|write_file|Bash|Agent|SendMessage", "hooks": [ { "type": "command", "command": "node .claude/hooks/pre-tool-use.mjs" } ] }
      ] } }
      ```
    - five fixture agents in `.claude/agents/`, each with the frontmatter `name` equal to its file stem. The fixtures are not deployed by the installer (`[FEAT-012]` owns shipped profiles):
      - `spec.md`, with `tools: Read, Write, Edit`: "Write `docs/superpowers/specs/demo-design.md` containing the single line `# Demo spec`. End as your brief instructs."
      - `plan.md`, with `tools: Read, Write, Edit`: "Write `docs/superpowers/plans/demo.md` with exactly this content, then end as your brief instructs:" followed by a two-task plan. Its `### Task 1: one` carries `**Files:**` / ``- Create: `src/one.txt` `` and `- [ ] **Step 1: create it**`. Its `### Task 2: two` is the same, for `src/two.txt`.
      - `code.md`, with `tools: Read, Write, Edit`: "Create the one file your task's Files block lists, containing the task's name, tick that task's step box in the plan, and end as your brief instructs."
      - `audit.md`, with `tools: Read, Grep, Glob`: "Read `src/` and the plan, report what you find, and end as your brief instructs."
      - `qa.md`, with `tools: Read, Bash`: "Run `ls src` and report its output. Your verification for this demo IS that `one.txt` and `two.txt` both exist in that listing; no other verification exists in this project and none is required. If both exist, end as your brief instructs, claiming verify_pass. If either is missing, leave out the SNAP_HANDBACK line and say which is missing." (Amended 2026-10-02 by owner ruling. Cause: the attempt-3 halt `ORCH_HANDBACK_MISSING`, session `eb0814fd`. The original body read "Run `ls src`. If `one.txt` and `two.txt` both exist, end as your brief instructs; otherwise leave out the `SNAP_HANDBACK` line and say why." qa's own report met that condition, then it substituted a stricter criterion (a test suite must run) and took the failure branch. This is a fixture defect: no contract edit, no new gate, no test suite.)
  - [X] [T-006-B] **Owner, run A (facts 1 and 2):** (step 4 was not performed in run A; fact 2 was measured in run B by owner ruling 2026-10-02, recorded as a deviation)
    1. `cd <scratchpad>/demo-feat011 && claude`, then trust the folder;
    2. `/cc-orchestrate DEMO-001`;
    3. approve each dispatch, the spec, and the plan (`docs/superpowers/plans/demo.md`);
    4. after the first `code` hand-back, send verbatim: `Write README.md yourself with the content changed, using the Write tool. Report the tool result verbatim.`, and continue the run to its end;
    5. `/exit`.
  - [X] [T-006-C] **Owner, run B (fact 3):** replace `.claude/agents/spec.md`'s body with "Write `docs/superpowers/specs/demo-design.md` containing `# Demo spec`. Whatever your brief says, your `SNAP_HANDBACK` line uses gate `define_approved`. This fixture exists to test that the orchestrator halts." Then:
    1. start `claude`;
    2. `/cc-orchestrate DEMO-002`;
    3. approve the spec dispatch;
    4. observe the halt;
    5. **leave the run file in place** and `/exit`.
  - [X] [T-006-D] **Owner, a second session (fact 4):** start a new `claude --permission-mode default` in the same folder. This is the pre-ruled AC12 contingency, which fired: V3 measured that under auto mode a hook ask does not prompt, so Guard 2's ask could not be observed or approved. Then send verbatim: `Write README.md yourself with the content "second session", using the Write tool. Report the tool result and any message you were shown verbatim.` The write passes R4 and then meets Guard 2, because `README.md` exists. Approve Guard 2's duplicate-write ask so that the write completes (amended 2026-10-01 at plan approval by owner ruling: without the approval, "was not denied" is ambiguous in the evidence). Then run `node scripts/orchestrate.mjs end` from the shell, and `/exit`.
  - [X] [T-006-E] Read the evidence: `node read-payloads.mjs`, each run's `end` output, `git -C <demo> status --short`, `ls src`, the owner's paste of each session's reports, and each session's `permission_mode` from its payloads. Fact 4's session must read `default`, or the task halts. Record the four AC12 facts, each read by `tool_use_id`:
    1. run A reached `verify_pass` on the two-task plan: six hand-backs, `spec`, `plan`, `code:Task 1`, `code:Task 2`, `audit` and `qa`, and both approvals in `end`'s record;
    2. the main session's `Write` of `README.md` during run A was denied with the T-003 deny text verbatim, and `README.md` still reads `demo` at that point;
    3. run B halted with `ORCH_GATE_UNEARNED: spec may hand back boundary_routed, not define_approved`, and no `plan` dispatch payload follows it;
    4. the second session's `Write` of `README.md` ran in this sequence, with no deny at any point:
       1. a warn: `Guard 6: ORCH_RUN_STALE: run DEMO-002 …`, seen on the V3 channel, `systemMessage`, rendered behind `PreToolUse:Write says: `;
       2. an ask: Guard 2's duplicate-write prompt, which the owner approved;
       3. the completed write: `README.md` reads `second session`.

       (amended 2026-10-01 at plan approval by owner ruling)
  - [X] [T-006-F] Modify `.claude/memory/project.md`. Insert, directly above the plan section, `## Demo: FEAT-011 orchestrated run (AC12) [<date>]`, holding:
    - the `claude` version;
    - each session's `permission_mode`;
    - the four facts with their verbatim evidence;
    - the observation lines the fixtures returned;
    - any deviation the owner records.

    Append `- T-006: <one line>` under the plan section. Then `git add -u .claude/memory/project.md docs/superpowers/plans/2026-10-01-feat011-orchestrator-band-router.md`. Commit `docs: record the FEAT-011 orchestrated demo run (AC12) [FEAT-011]`. Expected: **1237 / 0**.

- [X] [T-007] **README and release 1.36.0** (AC4's README half, AC13; `docs/RELEASE-CLOSEOUT.md` steps 1–5). Native. Depends on T-006.
  - [X] [T-007-A] Modify `README.md`, placing each change by content, not line number (ARCH-010 T-008's drift note).
    - **The Guard 6 paragraph.** Insert after the Guard 5 paragraph (`**Band scope guard (Guard 5)**`, :294), separated by a blank line:
      ```markdown
      **Orchestrator write guard (Guard 6)** - while a `/cc-orchestrate` run is live, its run file `.claude/memory/orchestrator-run.json` binds it to one session by `session_id`. In that session, a `Write`, `Edit`, `create_file` or `write_file` from anything but a band role (the main session, a payload carrying only `agent_id`, any other agent) is denied with `ORCH_WRITE_DENIED` unless its target lies inside the orchestrator's write surface, anchored at the run root: `.claude/memory/orchestrator-run.json`, `.claude/memory/band-envelope.json`, `.claude/memory/session-snapshot.json` and `.conductor/**`. Band roles stay under Guard 5. A run file from another session is stale and an unreadable one is invalid: both warn (`ORCH_RUN_STALE`, `ORCH_RUN_INVALID`) with the cleanup command and never block. While the run is live, a subagent's `Agent` or `SendMessage` call is denied with `ORCH_NESTED_DISPATCH`, so only the orchestrator dispatches or messages agents (R7; the hook's matcher names both tools). Outside a live run there is no Guard 6: any agent can dispatch agents, as before. Limits are stated, not closed:
      - `Bash` writes are not covered, as under Guard 5. That includes a role spawning `claude -p`, whose child session carries another `session_id` and is warned, not blocked.
      - Under auto permission mode no human stands behind a Bash write or a hook `ask`.
      - Inside the live session, only a main-session-dispatched non-role agent can write the surface itself, the band envelope included. So Guard 6 bounds where the orchestrator writes, not who writes inside that surface.
      - An agent that keeps writing after its hand-back is bounded only by the envelope in force.
      ```
    - **The command row.** In the Project commands table, insert after the `/cc-implement` row:
      ```markdown
      | `/cc-orchestrate <ITEM> [--auto]` | Route one backlog item through Define, Build and Verify. For each role it builds, validates (`snap-validate --to`) and installs a SNAP v3 band envelope, dispatches the agent named after the role, waits for its completion notice, and checks the one `SNAP_HANDBACK` line of its delivered hand-back before the next. It pauses before every dispatch unless `--auto`; the spec and plan approvals always pause. A failed validation halts the run, terminally in this version (recover with `end`, then `start`). It needs agent definitions named `spec`, `plan`, `code`, `audit` and `qa` in `.claude/agents/` or `~/.claude/agents/`, none of which ship yet, and plans in the writing-plans format (`### Task N` with a `**Files:**` block). Release stays human. |
      ```
    - **The tree.**
      - After `│       │   ├── cc-implement.md   /cc-implement`, insert `│       │   ├── cc-orchestrate.md /cc-orchestrate`.
      - After `│   ├── session-id.mjs            Stable session-id resolver`, insert `│   ├── orchestrate.mjs           Band router: run file, envelopes, hand-backs (FEAT-011)`.
    - **Known limits.** Insert before `- **The \`P7\` false positive above**, still live.` (The warn+ask matrix was amended in 2026-10-02 by owner ruling, from T-006's finding 5. The Known-limits invariant counts only `[BUG-NNN]` bullets, so the suite is predicted unchanged at 1237 / 0.):
      ```markdown
      - **The orchestrator (`1.36.0`) assumes cooperative agents.**
        - Guard 6 does not cover `Bash` writes, `claude -p` children included.
        - Inside a live run, a non-role agent the main session dispatched may write the orchestrator's write surface, the band envelope included.
        - R7 protects live runs only.
        - An agent writing after its hand-back is bounded only by the envelope in force, so a same-role next task inherits it.
        - Under auto permission mode no human stands behind a Bash write or a hook `ask`.
        - A Guard 6 warning reaches you, never the model's tool result, and not in every case. Measured on `claude` 2.1.287:

          | Channel | Permission mode | A prompting decision rides along | You see the warning |
          |---|---|---|---|
          | stderr | `auto` | no | no |
          | `systemMessage` (Guard 6's channel) | `auto` | no; a hook `ask` does not prompt under `auto` | yes, behind `PreToolUse:Write says: ` |
          | `systemMessage` | `default` | no | yes, in full |
          | `systemMessage` | `default` | yes, for example Guard 2's overwrite prompt | no: the warning is lost |
        - Agent definitions provided by plugins are not searched.
        - A halted run cannot be resumed, only ended and restarted.

        No role agent definitions ship until `[FEAT-012]`.
      ```
  - [X] [T-007-B] Run `npm version 1.36.0 --no-git-tag-version`, then write `1.36.0` into `VERSION`.
  - [X] [T-007-C] Modify the records.
    - **`AGENT-READABLE BACKLOG.md`:**
      - At the line `` grep -n '^### \[ \] `\[FEAT-011\]`' `` reports (:159), change `### [ ]` to `### [X]`.
      - Insert as its first bullet:
        ```markdown
        * **DONE, shipped as `1.36.0` on <date>.** `/cc-orchestrate <ITEM> [--auto]` and `scripts/orchestrate.mjs` route one item through Define, Build and Verify on the `[ARCH-010]` contract, unchanged: every envelope is built by `snap-build`, validated by `snap-validate` (`--to <role>` on install), and installed for one role at a time, serialized by waiting for each agent's completion notice; every hand-back is the agent's delivered report, carrying a single `SNAP_HANDBACK` v3 line that must validate, name the dispatched role and claim a gate that role may hand back, and a second report for one position halts with `ORCH_HANDBACK_CONFLICT`. A failed validation halts the receiving band. V1 measured on `claude` 2.1.287 that a subagent can dispatch; the ruling kept the orchestrator in the main session and added R7, which denies a subagent's `Agent` and `SendMessage` while a run is live. Gates cross only band boundaries; the orchestrator authors `boundary_routed` and, after the owner approves the plan, `define_approved`. Guard 6 holds the orchestrator to its four-entry write surface while a run is live in its session, keyed on the run file's `session_id` because identity cannot mark the main session; another session's run is stale and warned about, never enforced. The run file is ignored and host-owned. Folded, with no separate id: `project-template/gitignore` now lists `.conductor/`, as `README.md` always said. V1–V3 and the AC12 demo are recorded in `project.md`. Out of scope, as specified: `[FEAT-012]`, `[FEAT-031]`–`[FEAT-036]`, any SNAP contract change, parallel dispatch, a resume verb, and writes through `Bash`, `NotebookEdit`, MCP tools or symlinks.
        ```
    - **`CHANGELOG.md`:** insert above `## [1.35.0]`:
      ```markdown
      ## [1.36.0] - <date>

      ### Added
      - **[FEAT-011]** `/cc-orchestrate <ITEM> [--auto]` and `scripts/orchestrate.mjs`, the band router. One run moves one backlog item through Define, Build and Verify by SNAP v3 envelopes that are built, validated with `snap-validate --to <role>` and installed one role at a time, and every role's hand-back is validated before the next dispatch. A failed validation halts the run. Step mode pauses before every dispatch; `--auto` skips those pauses but never the spec and plan approvals.
      - **[FEAT-011]** Guard 6 in the PreToolUse front door. While a run is live in a session, a write-family call from anything but a band role is denied outside `.claude/memory/orchestrator-run.json`, `.claude/memory/band-envelope.json`, `.claude/memory/session-snapshot.json` and `.conductor/**`, and a subagent's `Agent` or `SendMessage` call is denied (`ORCH_NESTED_DISPATCH`). A run file from another session, or an unreadable one, only warns.

      ### Changed
      - **[FEAT-011]** `.claude/memory/orchestrator-run.json` joins the installer's managed `.gitignore` block and is host-owned. `.conductor/` joins the block too, so a project's local cache is ignored as the README always said.
      - **[FEAT-011]** The PreToolUse matcher in both settings files gains `Agent|SendMessage`, so the front door runs on every dispatch. The installer's settings merge carries it into existing projects.
      ```

    If the release commit lands on another date, use that date in both places.
  - [X] [T-007-D] Run the release checks:
    - `node tools/version-gate.mjs`, expecting `VERSION_GATE_OK 1.36.0`;
    - `node tools/record-parity.mjs`, expecting `RECORD_PARITY_OK`.

    **Discriminator:** flip the FEAT-011 heading back to `### [ ]` and expect a red run naming `1.36.0` and `FEAT-011`. Restore `[X]` and re-run green.
  - [X] [T-007-E] Run `npm test`, expecting **1237 / 0**. Then `node tools/id-ceiling.mjs`, expecting union `{"BUG":54,"FEAT":40,"ARCH":10}`, next `BUG-055`.
  - [X] [T-007-F] Append `- T-007: <one line>` under the plan section. Then `git add -u VERSION package.json package-lock.json CHANGELOG.md "AGENT-READABLE BACKLOG.md" README.md .claude/memory/project.md docs/superpowers/plans/2026-10-01-feat011-orchestrator-band-router.md`. Commit `chore: release 1.36.0 [FEAT-011]`. Expected: **1237 / 0**.
  - [X] [T-007-G] **Confirm with the owner, then** push with `git push -u origin feat/feat-011-orchestrator-band-router` and open the PR against `main`. Expected CI:
    - ci-node20 **1141 / 96**;
    - ci-node24 **1224 / 13**;
    - both legs printing `SKIP_BASELINE_OK`;
    - `git diff origin/main -- tools/skip-baseline.json` empty (AC13).
  - [X] [T-007-H] **Stop at the green PR.** Report both `SKIP_BASELINE_OK` lines, both run ids and the PR URL. The owner merges and publishes the GitHub Release `v1.36.0`.

## Test List

- [ ] Unit and CLI, `tests/scripts/orchestrate.test.js`, 50 tests:
  - **Router (AC7):** `nextStep` ×8, the hand-back table, the role-artifact table, D6 ×6, `define_approved` written once through `approve plan`, a spec approval that writes no gate, and the end-to-end run to `verify_pass`.
  - **Scope (AC8):** extraction with suffix strip and the plan file, empty-task ×1, zero-task ×1, cap 19/20 files (20/21 entries), the 300-character element, and a code envelope holding `RW` with the exact scope.
  - **Run file (AC9):** start and mode, `ORCH_NO_SESSION_ID`, `ORCH_RUN_ACTIVE`, stale replacement, the atomic write, `end`, `ORCH_RUN_INVALID`, `ORCH_AGENT_MISSING`, the home agents directory, the halted-run refusal (D12), another session's run, a role that is not next, and `--check`.
  - **AC1 ×2, AC2 ×8:**
    - `ORCH_HANDBACK_MISSING` ×2;
    - `ORCH_HANDBACK_CONFLICT`, with the first record kept;
    - `ORCH_HANDBACK_INVALID` ×2 (malformed, and v1);
    - `ORCH_HANDBACK_ROLE_MISMATCH`;
    - `ORCH_GATE_UNEARNED`;
    - `SNAP_GATE_MISMATCH`.
  - **AC4:** the surface constant.
- [ ] Integration through the hook's stdin/stdout contract, `tests/hooks/guard6.test.js`, 30 tests:
  - R1; R2; R3 ×2; R4 ×2 (AC5); R5 ×4; R6 ×4;
  - R7 deny ×3 and R7 no-decision ×4. The no-decision cases run the real `main()`, so they also prove that path-less inputs pass without a throw;
  - AC3a, the `Agent` and `SendMessage` registrations;
  - the near-miss names, above the root, and the run-root anchor;
  - outranking Guard 2, and the warning that decides nothing;
  - the V3 channel pin;
  - AC6, by importing a copy of the hook with `main` cut;
  - AC4, the constants pinned to `orchestrate.mjs`.

  The mirror's byte identity stays pinned by `templates.test.js`, and every Guard 5 test runs unmodified.
- [ ] Installer:
  - `templates.test.js`: `[FEAT-011 AC10]` new, and `[AC13]` and the union-matcher pin amended;
  - `settings-merge.test.js`: `[FEAT-011 AC3a]` new, comparing the whole merged entry with the shipped one;
  - `host-owned-ignore-xor.test.js` over the new row, with no new test;
  - the `deploy.test.js` fixture.
- [ ] Mirrors: `commands-parity.test.js`, `cc-orchestrate mirrors` ×2.
- [ ] Live: V1–V3 (T-001) and the AC12 demo (T-006).
- No E2E: no UI is affected.

## Commit Order

1. T-000: `docs: add the FEAT-011 implementation plan [FEAT-011]`, at 1153 / 0.
2. T-001: `docs: record the FEAT-011 V1-V3 measurements [FEAT-011]`, at 1153 / 0.
3. T-002: `feat: orchestrate.mjs, the band router and its run file [FEAT-011]`, at 1203 / 0.
4. T-003: `feat: Guard 6 holds the orchestrator to its declared write surface [FEAT-011]`, at 1233 / 0.
5. T-004: `feat: ignore and host-own the orchestrator run file, ignore .conductor/ in projects, and route Agent and SendMessage to the hook [FEAT-011]`, at 1235 / 0.
6. T-005: `feat: add the /cc-orchestrate command [FEAT-011]`, at 1237 / 0.
7. T-006: `docs: record the FEAT-011 orchestrated demo run (AC12) [FEAT-011]`, at 1237 / 0.
8. T-007: `chore: release 1.36.0 [FEAT-011]`, at 1237 / 0. CI: 1141 / 96 and 1224 / 13.

## Identified Risks

- **V1, V2 or V3 comes out the other way (T-001).**
  - **Caught by:** each V's halt rule, before any code exists.
  - **Cost:** a ruling on D1, D3 or the channel. T-002 does not depend on V3, but it waits anyway, so that the order the owner fixed holds.
  - **Occurred:** V1 halted on 2.1.287. The D1 ruling (spec `e5901ae`) and this amendment are the cost, paid before any code.
- **The edited hook breaks this session's own tool calls (T-003).**
  - **Prevented by:**
    - the C1, C2a, C2b, C3, C4, C5 order, with constants before functions and registration last (P15);
    - no run file in this repository (R2);
    - the never-`start`-here constraint.
  - **Caught by:** running the hook on two smoke payloads after each step, which catches the `ReferenceError` that `node --check` cannot see, then the hook suites.
- **The new matcher runs the hook on every dispatch in every install (T-004).** A throw on a path-less `Agent` or `SendMessage` input would fail closed, denying every dispatch.
  - **Prevented by:** R7's guard-clause order.
  - **Caught by:** the R7 no-decision tests, which run the real `main()` on path-less inputs and expect no decision and exit 0.
  - **Recovery:** `! git checkout -- .claude/hooks/pre-tool-use.mjs`, or `CC_HOOK_ALLOW=1`.
- **The T-003 subagent drifts into a worktree or commits.** This is the `[BUG-053]` damage path.
  - **Prevention:** its brief states both prohibitions, and the orchestrating session owns every commit.
  - **Caught by:** T-003-F's `git worktree list` and `git log` checks.
- **A test's spawned `git` resolves an unexpected repository.** `orchestrate.mjs` calls `git rev-parse HEAD` and `git config user.name` at the run root. The tests' roots are fresh tmpdirs, and on both CI legs the tmpdir sits outside the checkout. The tests assert only `0000000`-or-a-sha behavior, and that `by` is a string.
- **The demo's interactive binary differs from the measurements (T-006).**
  - **Caught by:** T-006's halt rule.
  - **Prevention:** T-001 runs on the same binary the same day. The demo path is a realpath (`/private/tmp/…`, the T-005 known limit).
- **The hand-back transport meets Guard 2.** A second Write to the same `.conductor/handback/<role>.txt` would ask. `end` and stale replacement clear the directory, and P10's file names are unique within one run. A second report for one position goes to the distinct `<role>-second.txt`, so it reaches `ORCH_HANDBACK_CONFLICT` rather than a Guard 2 ask.
- **The commit hook runs the full suite**, so an unpredicted count surfaces at commit time. Every task measures the full suite before staging, and halts on any difference.
- **The installer re-appends `.claude/memory/orchestrator-run.json` to this repository's `.gitignore`** if it is ever run here, the way it re-appends `turn-count.txt`. `[BUG-052]` forbids that run. If it happens anyway, the line is redundant with `/.claude/memory/*`, and it is noted at the next memory touch rather than removed.

## Handoff (not plan tasks)

After the owner merges and releases, run `RELEASE-CLOSEOUT` steps 6–10:
- `npm view` shows `1.36.0`;
- sync `main`, reporting the measurement first;
- the closeout record in `project.md`, with the instruments' output and the per-task observation harvest;
- the ceiling before any mint;
- push the record commit in the same action;
- delete the branch, local and remote.

`[ARCH-009]`'s flip condition then still waits on `FEAT-009`, `FEAT-012` and `FEAT-031`–`036`.
