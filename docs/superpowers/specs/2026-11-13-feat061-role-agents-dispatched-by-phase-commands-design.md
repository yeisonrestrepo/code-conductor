# FEAT-061: Role agents dispatched by phase commands outside /cc-orchestrate

**Status:** Draft (pending independent review)
**Item:** FEAT-061 (intake of issue #179)
**Date:** 2026-11-13

## Problem

Each of the seven agent profiles under `.claude/agents/` and `project-template/.claude/agents/` ends its `description` with "Dispatched only by /cc-orchestrate during a run; never use it for ad-hoc work." So a user who works through the phase commands (`/cc-spec`, `/cc-plan`, `/cc-review`, `/cc-test`) never gets a role's tool mask, Guard 5's scope check, Guard 7's shell check or the role's fixed success condition. Today those exist only inside a full orchestrated run.

The issue proposes letting the phase commands dispatch the matching role themselves, with an envelope the command builds. The issue says the envelope's scope makes Guard 5 and Guard 7 "hold exactly as they do inside a run". Reading the guards shows this is true for Guard 5 and **not true for Guard 7 as shipped**. The spec has to deal with that gap, so here is what the code does:

- **Guard 5** (`.claude/hooks/pre-tool-use.mjs:214-230`) reads the one fixed file `.claude/memory/band-envelope.json` and nothing else. If the file is missing, a role's write is allowed anywhere (Case B, `:219`). If the file is present, the write must match the envelope's role, `tk` and `ops.scope`. A run is not consulted. So an envelope installed by a command enforces scope exactly as a run's envelope does. Without one, nothing is enforced.
- **Guard 7** (`:316-327`) takes a role's single allowed command only from a **live run of this session** (`liveRunOf`, `:294-299`, which reads `test_command` from `.claude/memory/orchestrator-run.json`). It never reads the envelope. Outside a run, `qa` gets `ROLE_SHELL_UNRESOLVED` on every command (`:321-323`). No envelope a command writes can change that. `audit`, `spec` and `plan` have no shell in any state (`:317`), so for them Guard 7 already holds everywhere.
- **The run owns the envelope file.** `band-envelope.json` is on the run's write surface (`scripts/orchestrate.mjs:22`). `install` overwrites it on each band step (`:430`), and `start`/`end` remove it (`:923-934`). If a command writes that file while a run exists, it changes the run's state. The entry's first acceptance criterion forbids exactly that.

There is a second, smaller gap. `/cc-review` and `/cc-test` exist only in `project-template/.claude/commands/`. The repository's own `.claude/commands/` has no copy of either. Only `/cc-spec` and `/cc-plan` have two mirrors.

## Solution

Add one out-of-run verb to `scripts/orchestrate.mjs`: `envelope <spec|plan|audit|qa> [--item <label>]` and `envelope --clear`. It is the only part that decides whether a command may install an envelope. It installs one only when **no run file exists at all**, and it never writes, replaces or removes a run's files. Each of the four phase commands calls the verb, dispatches its matching role with the `Agent` tool and a brief the command builds, shows the role's report, and then clears the envelope. If the verb says a dispatch is not possible, the command falls back to its current in-session behaviour and gives the verb's reason in one line.

- `/cc-review` dispatches `audit` when it is given a spec and a plan.
- `/cc-test` dispatches `qa` for its final suite run.
- `/cc-spec --delegate` and `/cc-plan --delegate` hand the file writing to `spec` and `plan`.

The agent profiles stop banning ad-hoc use. Their opening paragraph names the phase-command dispatcher next to the orchestrator.

Letting `qa` run its one command outside a run needs a change to the Guard 7 hook. That is an owner decision (see **Open question Q1**). This spec covers both outcomes. If Q1 is approved, the change is: when no run file exists, Guard 7 also accepts `mem.p.test_command` from a valid `qa` envelope.

## Behavior

### Run states

Every decision below depends on one of three states, as the verb sees them from the run root (`findRunRoot`, the walk every verb already uses):

| State | Meaning |
|-------|---------|
| **N** (no run) | No `.claude/memory/orchestrator-run.json` at the run root. |
| **L** (live run) | A valid run file whose `session_id` equals `CLAUDE_CODE_SESSION_ID`. |
| **O** (other run) | A run file that belongs to another session, or is unreadable, or is not a valid v1 run. |

If any run file is present (L or O), the verb never writes, renames or removes `orchestrator-run.json`, `band-envelope.json` or anything under `.conductor/`. It also never calls `recordHalt`. Every failure exits through `Refusal` (exit 2), so a `Halt` cannot be written into a run that does not belong to the verb. `recordHalt` (`scripts/orchestrate.mjs:938-943`) writes a `halt` into whatever valid run file it finds, including another session's, and `start` is already excluded from it (`:965`). The new verb gets the same exclusion.

### Role × state table

| Role (command) | N | L | O |
|---|---|---|---|
| `spec` (`/cc-spec --delegate`), `plan` (`/cc-plan --delegate`) | Install an RW envelope whose scope is the resolved docs folder. Dispatch, then clear. | Refuse: the run's Define band writes this document. Continue with `/cc-orchestrate`, or end the run. | Refuse: name `orchestrate.mjs end`. The command continues in-session, as it does today. |
| `audit` (`/cc-review`) | Install an R envelope (no scope). Dispatch, then clear. | Install nothing. Dispatch. | Install nothing. Dispatch. |
| `qa` (`/cc-test`) | **Q1 = A:** install an X envelope that carries `mem.p.test_command`. Dispatch, then clear. **Q1 = B:** refuse (qa has no shell outside a run), and the command runs the suite in-session. | Install nothing. Dispatch. Guard 7 allows the run's `test_command`. | Refuse: name `orchestrate.mjs end`. The command runs the suite in-session. |

Why `audit` can be dispatched in L and O without a new envelope: it has no write tool and no shell. Guard 7 refuses its shell in every state (`ROLE_SHELL_DENIED`). If the run has an envelope, Guard 5 still refuses any write through `BAND_ROLE_MISMATCH` or `BAND_READ_ONLY`. Nothing has to be written for the guards to hold, so nothing is written.

Why `qa` in L needs no envelope: Guard 7 reads the run, not the envelope, and qa has no write tool. The run's `test_command` was checked by `checkTestCommand` at `start`.

### The `envelope` verb

`node <scripts>/orchestrate.mjs envelope <role> [--item <label>]`, where `<role>` is one of `spec`, `plan`, `audit`, `qa`:

1. Check the arguments. Any other role (`code`, `security`, a typo) is refused with a usage line. `<label>` defaults to `adhoc` and must match `^[a-zA-Z0-9._-]+$`, the `sys.s` pattern `snap-validate` enforces. Anything else is refused.
2. Classify the state (N/L/O) without throwing. An unreadable run file counts as O and is not a halt.
3. If the state is L or O, apply the table. For a dispatch without an envelope, print one stdout line that starts with `not-installed:` and give the reason (for `qa` in L, include the run's test command), then exit 0. Otherwise, refuse (exit 2) with the reason.
4. If the state is N, build the fields the way `envelopeFields` does for a run step, with these differences:
   - `s` is the label.
   - `gate` is `expectedGate(role)` (spec and plan get `boundary_routed`; audit and qa get `build_executed`).
   - `tk` comes from `ROLE_ARTIFACTS`.
   - `scope` for `spec`/`plan` is `docScopes(resolveDocLocations(root, label))[role]`, the same resolver and cap that `start` pins. A resolver error is refused with its code in the message.
   - For `qa` under Q1 = A only, `p` is `{ test_command: checkTestCommand(resolveTestCommand(root)) }`. An unresolvable or unsafe command is refused.

   The fields go through `snap-build.mjs` and `validate(out, role)`, as `install` does. The output is written atomically to `.claude/memory/band-envelope.json`, and an existing envelope there is overwritten. With no run file present, that file belongs to no run. It is either left over from an earlier out-of-run dispatch or absent. The verb prints a first line `installed: <role> envelope at .claude/memory/band-envelope.json`, followed by the envelope, and exits 0. It also checks `findAgent(role, root)` and refuses, as `install` does, when the agent definition is missing.

`node <scripts>/orchestrate.mjs envelope --clear`: in state N, it removes `band-envelope.json` if present and prints `cleared` or `no envelope`, then exits 0. In L or O it refuses and touches nothing.

The verb usage line (`:959`) gains `envelope`.

### Main path

**`/cc-review --spec <path> --plan <path> [target]`, state N:**
1. The command runs `envelope audit --item <ID-or-adhoc>` and reads `installed:`.
2. It dispatches `Agent({ subagent_type: "audit", prompt })`. The brief names the spec, the plan and the review target (no target means `git diff HEAD`, as today). It says the envelope is installed at `.claude/memory/band-envelope.json`, and that a phase command, not a run, dispatched the agent.
3. It shows the audit's findings and the `VERDICT:` line exactly as the agent wrote them. The `SNAP_HANDBACK` line is shown, not recorded, because there is no run to record it in.
4. It runs `envelope --clear`. It then offers to fix the `blocker` and `major` findings, which replaces today's offer to fix critical and important issues. The three-layer review and its Phase 0 skills run only on the classic path.

**`/cc-test [scope]`, state L:** The command writes no test file: Guard 6 would deny the write, and the run's code tasks own the writes. It runs `envelope qa`, reads `not-installed: live run <item>; qa runs <command>`, and dispatches `qa` with a brief that says no envelope was installed for it. It then reports qa's exit status and summary line. **State N under Q1 = A:** the command writes tests as today. At "Run tests after writing them. Confirm before running", it runs `envelope qa` and dispatches `qa` instead of running the suite itself, then clears the envelope.

**`/cc-spec --delegate <topic>`, state N:** Phase 0 and the codebase search run in the main session, as today. The command then runs `envelope spec --item <ID-or-adhoc>`. It dispatches `spec` with a brief that names the item, the folder (the envelope's scope) and the spec section list of this command. The written file goes through the command's normal approval wait. `/cc-plan --delegate` works the same way with `plan`. The plan brief adds the command's `T-NNN` task id rules and `**Files:**` block format to the content the agent writes. That is content, not a new success condition. After the hand-back, the command checks task ids as it does today and runs the branch gate.

### Alternative paths

- **No `--spec`/`--plan` on `/cc-review`:** the audit's success condition is a review against a spec and a plan, and the command does not swap in a weaker standard. It runs the classic three-layer review and says: `audit not dispatched: name --spec and --plan to review against them`.
- **No `--delegate` on `/cc-spec` or `/cc-plan`:** the command behaves exactly as it does today. Delegation is opt-in, because the issue says these commands "can delegate", and the interactive spec flow stays in the main session.
- **A leftover envelope in state N** (from a session that crashed between dispatch and clear) is overwritten by the next `envelope` call or removed by `--clear`. A later `orchestrate.mjs install` overwrites it in any case.
- **The verb is missing** (an older install without the verb): the command treats any non-zero exit, or output that starts with neither `installed:` nor `not-installed:`, as "not dispatchable". It falls back to the classic path and prints the verb's stderr.

### Error cases

- Verb exit 2: no dispatch. The command prints the verb's stderr line and continues in-session where the table allows (O, or N under Q1 = B for qa). It stops where the table says the run owns the work (L for spec and plan).
- The role is denied by a guard during the dispatch: the role stops and reports, as its rules already say. The command shows the report, still clears the envelope, and does not retry another way.
- The role ends without a `SNAP_HANDBACK` line, or `qa` reports a failing suite: the command reports that outcome as the result. It never reruns the suite in-session to replace qa's answer.
- `--clear` refuses (a run appeared during the dispatch, for example one started from another terminal): the command reports the refusal and leaves the file alone. The file now belongs to that run.

### Agent profiles

All seven profiles in both directories drop the clause "Dispatched only by /cc-orchestrate during a run; never use it for ad-hoc work." The new last sentences are:

- `spec`: `Dispatched by /cc-orchestrate during a run, or by /cc-spec --delegate outside one.`
- `plan`: `Dispatched by /cc-orchestrate during a run, or by /cc-plan --delegate outside one.`
- `audit`: `Dispatched by /cc-orchestrate during a run, or by /cc-review outside one.`
- `qa`: `Dispatched by /cc-orchestrate during a run, or by /cc-test outside one.`
- `code`, `security`, `define-review`: `Dispatched by /cc-orchestrate during a run.`

The last three state who dispatches them without banning anything else, which meets the entry's AC literally. No phase command dispatches them in this item (see Out of Scope).

In the four dispatched profiles, the opening sentence ("The orchestrator dispatched you … and installed your band envelope …") changes to name both dispatchers: "The orchestrator during a run, or a phase command outside one". `audit` and `qa` add one sentence: "If your brief says no envelope was installed for you, there is none to read; leave the scope key out of the hand-back." Their existing rule already says what to do when there is no scope. In `qa`'s "The test command" section, the run file stays the only source under Q1 = B. Under Q1 = A, a second sentence adds: "Outside a run, it is the `mem.p.test_command` field of your envelope." Masks, success conditions, gate claims and hand-back rules do not change. Every phrase that `tests/unit/role-profiles.test.js` pins (D5, SHELL/NO_SHELL, CLAIM, gate names, no `docs/superpowers`) stays as it is.

### Guard 7 (only if Q1 = A)

`roleShellDecision` changes only in its "no live run" branch. For `role === 'qa'`, if no run file exists at the root and the envelope at the root passes `readEnvelope` with `sys.role === 'qa'` and a non-empty string `mem.p.test_command`, the allowed list is `[mem.p.test_command]`. Otherwise the result stays `ROLE_SHELL_UNRESOLVED` as today. The metacharacter check (`:319-320`) still runs first. The match is still exact. `code` and `security` get no fallback. A run file of another session (state O) disables the fallback, so a stale run's leftover envelope can never grant a shell. Both hook copies stay byte-identical.

## Acceptance Criteria

Entry AC1, "each command works with and without a live run, and never alters a live run's file":
- [ ] `envelope <role>` in state N writes a `band-envelope.json` that passes `snap-validate --to <role>`. For `spec`/`plan` its `ops.scope` equals the `docScopes` value `start` would pin for the same label. For `audit` its `tk` is `R`.
- [ ] For every role and for `--clear`, in state L and in state O (a foreign `session_id`, and separately an unparseable run file): the bytes and mtime of `orchestrator-run.json`, of `band-envelope.json` when present, and of the `.conductor/` tree are unchanged after the call, and the run file gains no `halt`.
- [ ] `envelope spec`/`plan` refuses (exit 2) in L and O. `envelope audit` prints `not-installed:` and exits 0 in L and O. `envelope qa` prints `not-installed:` with the run's test command in L, and refuses in O.
- [ ] `envelope code`, `envelope security`, an unknown role and a label outside `^[a-zA-Z0-9._-]+$` are refused, with nothing written.
- [ ] `envelope --clear` removes the envelope in state N, is a no-op that exits 0 when none exists, and refuses in L and O.
- [ ] Each of the four commands (both mirrors, where two exist) names the `envelope` verb, the `Agent` dispatch of its role, the `--clear` step after the report, and its classic-path fallback with the one-line reason.
- [ ] Q1 = A: Guard 7 allows qa's envelope `mem.p.test_command`, exactly, only in state N. It still denies in state O, for `code` and `security`, for an envelope of another role, for a missing or empty `test_command`, and for any other command (`ROLE_SHELL_NOT_ALLOWED`). Q1 = B: `envelope qa` in state N refuses with `qa has no shell outside a run`, and Guard 7 does not change.

Entry AC2, "the agents' descriptions stop forbidding ad-hoc use":
- [ ] No file in either agents directory contains `never use it for ad-hoc work` or `Dispatched only by`.
- [ ] `spec`, `plan`, `audit` and `qa` each name their phase command in `description`, with the sentence given above.

Entry AC3, "the existing parity tests cover the new wording in both mirrors":
- [ ] `tests/unit/role-profiles.test.js` asserts AC2's two rows over both directories. Its byte-identity tests still pass, and its `PROFILE_SHA256_1_37_0` rows for every changed profile are updated in the same commit with a `FEAT-061` comment, as the table's header requires.
- [ ] `tests/installer/commands-parity.test.js` gains a `cc-spec mirrors` block ("differ only in the script path nesting") and pins the dispatch wording in both mirrors of `cc-spec` and `cc-plan`, and in the template's `cc-review` and `cc-test`.
- [ ] `npm test` passes.

## Out of Scope

- Root `.claude/commands/` copies of `cc-review` and `cc-test`. The repository's own command set is a curated subset of the template (seven commands against thirteen), and adding two commands to it is a surface change this item does not need. The entry's "both mirrors" is met where two mirrors exist.
- A phase command that dispatches `code`, `security` or `define-review`.
- Recording an out-of-run hand-back anywhere, and approval or review loops outside a run.
- Two sessions in one worktree dispatching outside a run at the same time. They share the single envelope path, as two runs would. Not addressed.
- Any change to `/cc-orchestrate`, the run file schema, Guard 5 or Guard 6.

## System Impact

- `scripts/orchestrate.mjs`: the new `envelope` verb, reusing `envelopeFields`-style construction, `docScopes`, `resolveDocLocations`, `expectedGate`, `ROLE_ARTIFACTS`, `resolveTestCommand`, `checkTestCommand`, `findAgent`, `validate`, `writeAtomic`. It is excluded from `recordHalt`. The usage line changes. It is deployed to `.claude/scripts/` by the existing installer path, so the installer does not change.
- `.claude/hooks/pre-tool-use.mjs` and `project-template/.claude/hooks/pre-tool-use.mjs`: only if Q1 = A. This is a protected surface, so the change ships with its `tests/hooks/guard7.test.js` rows in the same commit.
- `project-template/.claude/commands/cc-review.md`, `cc-test.md`. `cc-spec.md` and `cc-plan.md` in both mirrors.
- All seven profiles in `.claude/agents/` and `project-template/.claude/agents/`.
- `README.md` command table rows for the four commands (`:256`, `:257`, `:260`, `:263`), to name the new flags. The Known-limits lines are not touched.
- Tests: `tests/scripts/orchestrate.test.js` (verb and state matrix), `tests/unit/role-profiles.test.js`, `tests/installer/commands-parity.test.js`, and `tests/hooks/guard7.test.js` if Q1 = A. Any test that pins the `orchestrate.mjs` usage string has to be located and updated.

### Files Requiring Full Read (deferred to /cc-plan)

These were understood through targeted search only, within the 30-line cap:
- `scripts/orchestrate.mjs`: `install`, `envelopeFields`, `cli`, `recordHalt`, `findRunRoot`.
- `scripts/doc-locations.mjs`: the `resolveDocLocations(root, item)` signature, and how a label feeds `group`.
- `.claude/hooks/pre-tool-use.mjs`: Guard 7 and `findRootHolding`.
- `tests/scripts/orchestrate.test.js`, `tests/hooks/guard7.test.js`, `tests/installer/commands-parity.test.js`: fixtures and helpers to reuse.

## Open questions

- **Q1 (owner):** Should Guard 7 let `qa` run outside a run, taking its one command from a `qa` envelope's `mem.p.test_command` when no run file exists? **A:** yes, as specified above. This is a hook change. The entry's Components list does not name the hook, but without it `/cc-test` cannot dispatch qa in state N, and the issue's claim that Guard 7 holds "exactly as inside a run" is only true with this change. The source of the command is as trustworthy as the run file, because both are written by the main session through a verb that runs `checkTestCommand`, and qa itself has no write tool. **B:** no. `/cc-test` dispatches qa only during a live run of this session, and runs the suite in-session otherwise. **Recommendation: A.**

## Complexity Estimate

L: a new script verb with a three-state matrix, four commands across up to two mirrors, fourteen profile files with pinned hashes, and a conditional protected-surface hook change.
