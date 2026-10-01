# FEAT-011: Orchestrator (Band Router and Phase Handoffs)

**Status:** APPROVED 2026-10-01 after two review rounds.
- **Round two folded five items:**
  - the D11 safety chain;
  - D12, terminal halts;
  - the mid-build halt sentence;
  - the R5 stated limit;
  - the folded observation, recorded as ruled.
- **Round one, the question round, folded A1–A4:**
- **A1:** Guard 6, with session-bound enforcement and the stale-run seam failing open.
- **A2:** the run ends at `verify_pass`.
- **A3:** each role writes its own artifacts.
- **A4:** step mode by default, with two approvals and one gate write.

The empty-scope halt is a rule, and the plan's first verification step is endorsed.

**Item.** `[FEAT-011]`, already minted, so no new id is needed. It consumes the `[ARCH-010]` contract shipped in `1.35.0` as given: `expectedGate(role)`, `snap-validate --to <role>`, Guard 5, and the host-owned band envelope. **No SNAP contract change:** `MAX_VERSION` stays 3, and `ROLES`, `GATES`, `BANDS` and `ROLE_BAND` are untouched.

**Target.** `1.36.0`, a minor release: a new command, a new script and a new guard. Branch `feat/feat-011-orchestrator-band-router`.

## Problem

ARCH-010 made one handoff checkable, but nothing performs handoffs:
- **Envelopes are hand-made.** A band envelope is built by hand, validated by hand with `--to`, and installed by hand, as T-007's demo did.
- **Nothing routes.** No component decides which role comes next, carries a role's result to the next role, or stops when a handoff is invalid.
- **The orchestrator's own authority is unbounded.** The backlog amendment says the orchestrator "holds no write access to the repository". Today that sentence has no enforcement, and it cannot have identity-keyed enforcement. The identity spike measured that main-session payloads carry neither `agent_id` nor `agent_type`, and that `session_id` is shared with subagents. Guard 5 treats the main session as Case A by construction.

## Field evidence, read before design

All of this is in `.claude/memory/project.md`:

- **Identity spike** ("Spike: does PreToolUse identify subagent tool calls?", with the AC11 re-run):
  - Subagent payloads carry `agent_id` and `agent_type`, and `agent_type` equals the definition's `name`.
  - Main-session payloads carry neither, in both `-p` and interactive mode.
  - `session_id` is one value across the main session and its subagents.
  - In interactive mode the main session produced an `agent_id`-only shape twice (T-001's `Bash`, then the demo's `ScheduleWakeup`).
  - All of it is measured on `claude` 2.1.286.
- **The demo's seam (AC12, Fact 3):** "A missing tool is hard, a declined redirection is soft." The mask closes the write-family path. The Bash-redirection path is closed only by cooperation at the prompt level, and Guard 5 does not cover Bash writes.
- **Installer incident:** "an installer run is a baseline-changing event: a gate's green moved without one line of the repo changing."
- **Worktree incident:** "a Verify-band gate must declare not only what it can see but where it is allowed to *write*. Isolation is part of the gate's contract." This spec therefore declares the orchestrator's write surface by enumeration, not only its prohibitions.
- **Per-task handoff observations (ARCH-010 plan):**
  - a stated mitigation is a property to verify (T-000);
  - a review pin states its discriminator (T-005);
  - parallel background agents interleave, so logs are read by `tool_use_id` (T-007).
- **Contract facts, from code:**
  - `expectedGate` returns the previous band's exit gate, so spec and plan both expect `boundary_routed`, and audit and qa both expect `build_executed` (`scripts/snap-contract.mjs:64`).
  - Guard 5 reads one envelope and denies with `BAND_ROLE_MISMATCH` when the agent is not the envelope's role (`pre-tool-use.mjs:172`).
  - Hand-back envelopes cannot be written to the envelope file by a role agent, because that is outside every role's scope.
  - `scripts/session-id.mjs:36` prefers `CLAUDE_CODE_SESSION_ID`, and falls back to a cache or a random UUID.

## Solution

`/cc-orchestrate <ITEM> [--auto]` runs in the main session and drives one backlog item through Define, Build and Verify.

It never edits a tracked file. Its state lives in a host-owned, gitignored run file. It moves work only by building, validating and installing SNAP v3 envelopes through a new script, `scripts/orchestrate.mjs`, which uses the existing contract, builder and validator. It dispatches each role as the subagent whose `name` equals the role.

**Two guards bound the authority:**
- **Guard 5** (unchanged) bounds the role agents.
- **Guard 6** (new) bounds everything else while a run is live in this session. A write-family call from anything other than a band role is denied outside the orchestrator's enumerated write surface. So during a run, repository writes go only through Guard 5.

**Guard 6 is bound to the run's `session_id`.** In any other session the run file is stale: Guard 6 warns and allows, and never blocks. Bash stays outside enforcement, the same measured boundary as ARCH-010.

### Decisions, each with its grounds

- **D1. The orchestrator is the main session, not a masked subagent.**
  - **Grounds:** dispatch is the `Agent` tool. Subagents are understood not to dispatch subagents, but that is unmeasured on this binary.
  - **Verification:** V1 below measures it first and halts the plan if it is false.
  - **Consequence:** identity cannot mark the orchestrator (spike, part (c)), so enforcement keys on run state (D3).
- **D2. The orchestrator is not a SNAP role.** It produces and checks envelopes and never appears in one. Boundary and Ship have no role in `ROLES`, and adding one is a version-gated contract change owned by the roster items: `[FEAT-031]` Ticket, `[FEAT-035]` Release and `[FEAT-036]` Docs.
- **D3. Guard 6 is session-bound run-state enforcement.**
  - It enforces only when a valid run file exists **and** the payload's `session_id` equals the run file's `session_id`.
  - Inside the live session (main session and subagents, which share `session_id`), enforcement is total for write-family tools.
  - Any other session sees a stale run: Guard 6 fails open with a warning.
  - Missing or invalid state never blocks the user's session. It halts the *handoff*, at the orchestrator's next step (`ORCH_RUN_INVALID`, under Error cases).
- **D4. The orchestrator's write surface is gitignored runtime state only, nothing tracked.** It is enumerated in Behavior under "Write surface". The orchestrator itself writes only through `scripts/orchestrate.mjs` and the existing conductor scripts, invoked by Bash. Its write-family tool calls inside that surface are allowed by Guard 6 and otherwise unneeded.
- **D5. Each role writes its own artifacts within its envelope scope (A3).**
  - Spec and plan scopes come from a fixed, reviewed role-artifact table. It is not invented per run.
  - The Code scope is copied from the plan task's declared files, plus the plan file for its ticks.
  - `project.md` and the closeout stay with the human, outside a run.
- **D6. Gate forwarding rule.** The orchestrator forwards a hand-back's gate only across a band boundary. Within a band, it re-issues the band's entry gate. It authors exactly two gates:
  - `boundary_routed`, its own band's exit, at start;
  - `define_approved`, once, after the human approves the plan (A4: two human approvals, one gate write).

  Spec approval is a process halt, not a gate transition.
- **D7. Step mode is the default, and `--auto` is opt-in (A4).**
  - Step mode pauses before every dispatch.
  - `--auto` advances on validated envelopes without pausing.
  - The two define approvals pause in both modes.
- **D8. Dispatch is serial across roles.** There is one envelope file, and Guard 5's `BAND_ROLE_MISMATCH` makes concurrent roles impossible by construction. FEAT-011 dispatches one agent at a time, including one Code dispatch per plan task.
- **D9. An empty plan scope is a plan defect and halts the run with `ORCH_EMPTY_SCOPE`.** Code is never dispatched with `tk:R` as a fallback, because a read-only Code dispatch would hide the defect.
- **D10. No agent definitions ship in FEAT-011 (A2).** A role whose definition is not found halts with `ORCH_AGENT_MISSING`. The demo uses fixture agents. The real profiles are `[FEAT-012]`'s.
- **D11. Script paths resolve by presence.** The command tries `.claude/scripts/` then `scripts/`, so it runs both in deployed projects and in this repository. This follows the constraint the `[BUG-051]` reverse-direction sighting recorded: "path resolution must go by presence". It does not repair BUG-051's other commands.
  - **Why the probe order is safe here.** Probing `.claude/scripts/` first is safe in this repository only because of a chain of rules:
    1. `[BUG-052]`'s interim rule forbids installer runs here;
    2. so no stale `.claude/scripts/` copy exists to win the probe;
    3. so the probe falls through to source `scripts/`, which is what `[BUG-051]`'s interim rule requires.
  - **If that invariant broke,** for example through an installer run like the 2026-10-01 incident, the presence-first order would pick the deployed copy over source and violate BUG-051's interim rule. The safety of the order depends on this chain, and the chain depends on BUG-052's rule holding.
- **D12. In v1, a halt is terminal.** The verbs are `start`, `install`, `handback`, `approve` and `end`, and there is no retry. A halted run stays halted until `end`, and `ORCH_RUN_ACTIVE` refuses a same-session `start` until then. Recovery is `end` followed by a fresh `start`. A resume or retry verb is future work and out of scope.

## Behavior

### Run file (`.claude/memory/orchestrator-run.json`)

It is host-owned, gitignored, and written atomically (temp file plus rename) by `scripts/orchestrate.mjs` only. Its fields:
- `v: 1`
- `session_id`
- `item` (the backlog id)
- `mode` (`step` | `auto`)
- `started` (ISO time)
- `band`, `role` and `gate` (the current position)
- `approvals.spec` and `approvals.plan`, each `{at, by}` or null, where `by` is the `git config user.name` value
- `plan` (path or null)
- `tasks` (`{ids, done}`)
- `halt` (null, or `{code, reason, at}`)

**Run start:**
- **`session_id`** comes from `CLAUDE_CODE_SESSION_ID`. If that variable is absent or empty, the run refuses to start with `ORCH_NO_SESSION_ID`. A recorded id that can never match would make Guard 6 permanently stale, which is silent non-enforcement.
- **A second start** in the same session while a run file exists for it halts with `ORCH_RUN_ACTIVE`.
- **A start over a stale run file** (another session's `session_id`) replaces it, and reports the replaced run's item and `started` time.

### Write surface (the orchestrator's, enumerated)

Paths are relative to the run root: the directory whose `.claude/memory/` holds the run file, found by the same walk-up from `cwd` that Guard 5 uses for the band root.
1. `.claude/memory/orchestrator-run.json`
2. `.claude/memory/band-envelope.json`
3. `.claude/memory/session-snapshot.json`
4. `.conductor/**`

Nothing else, and nothing tracked. Containment is by path text, the same rule and the same symlink limit as Guard 5 (T-005 known limit).

### Router (pure functions in `scripts/orchestrate.mjs`)

**The band sequence** is fixed from the band table and the contract:

| Step | Role | Entry gate it must be dispatched on | It may hand back | Exit rule |
|---|---|---|---|---|
| 0 | the orchestrator (no role) | none | none | it writes `boundary_routed` at start |
| 1 | `spec` | `boundary_routed` | `boundary_routed` | process halt: spec approval |
| 2 | `plan` | `boundary_routed` | `boundary_routed` | plan approval, after which the orchestrator writes `define_approved` |
| 3…n | `code`, one dispatch per plan task | `define_approved` | `build_executed` | forwarded only after the last task |
| n+1 | `audit` | `build_executed` | `build_executed` | re-issued to `qa` |
| n+2 | `qa` | `build_executed` | `verify_pass` | run ends |

**The role-artifact table (D5)** gives each role its `tk` and `scope`:

| Role | `tk` | `scope` |
|---|---|---|
| `spec` | `RW` | `["docs/superpowers/specs/**"]` |
| `plan` | `RW` | `["docs/superpowers/plans/**"]` |
| `code` | `RW` | the task's declared files plus the plan file |
| `audit` | `R` | none |
| `qa` | `X` | none |

**Scope extraction for `code`:**
- It reads the task's `**Files:**` block, in the `writing-plans` format:
  - backticked paths on `Create:`, `Modify:` and `Test:` lines;
  - a `:N-M` line suffix is stripped;
  - each path becomes an exact-path glob.
- No parseable path halts with `ORCH_EMPTY_SCOPE` (D9).
- More than 20 entries (`V3_CAPS`) halts with `ORCH_SCOPE_OVER_CAP`. Scopes are never truncated.

### Main path (step mode)

1. `/cc-orchestrate FEAT-NNN`:
   - resolves the script path by presence (D11);
   - runs `orchestrate.mjs start FEAT-NNN` (the run file is written with `gate: boundary_routed`);
   - prints the run header.
2. **Before each dispatch** the orchestrator prints the role, the envelope to be installed, and the `--to` result, then waits for the owner's go. In `--auto` it proceeds.
3. **Install:** `orchestrate.mjs install <role>` does the following, in order, and any failure halts:
   1. builds the next envelope through `snap-build`, with the role, `tk`, `scope` and gate from the router;
   2. validates it with `snap-validate --to <role>`;
   3. writes it atomically to `.claude/memory/band-envelope.json`;
   4. records the position.
4. **Dispatch:** the `Agent` tool with `subagent_type: <role>`.
   - The brief carries the item, the artifact paths, and the hand-back instruction.
   - It also asks for the one-line handoff observation (the ARCH-010 brief lesson).
5. **Hand-back:** the role agent's final message carries exactly one line `SNAP_HANDBACK <single-line v3 JSON>`. The orchestrator pipes that line to `orchestrate.mjs handback <role>`, which:
   1. validates the envelope;
   2. checks `sys.role` equals the dispatched role;
   3. checks the gate against the table's "may hand back" column;
   4. records the result.
6. **Define pauses:** after spec, the owner approves the spec, which is a halt only. After plan, the owner approves the plan, and `orchestrate.mjs approve plan` writes `define_approved`, recording `approvals.plan`.
7. **Build:** Code is dispatched once per plan task, serially. Each dispatch gets a fresh envelope scoped to that task. If a task halts, `tasks.done` stays as recorded, nothing is forwarded, and nothing further is dispatched (D12).
8. **Verify:** audit, then qa. When qa hands back `verify_pass`:
   - `orchestrate.mjs end` removes the run file and the envelope;
   - the report names every hand-back, every approval and every handoff observation, and states that release is human (`docs/RELEASE-CLOSEOUT.md`).

### Guard 6 (write-family tools: `Write`, `Edit`, `create_file`, `write_file`)

**Front-door evaluation order:**
- The write-family `DISPATCH` arrays become `[guard5BandScope, guard6OrchestratorRun, …existing]`.
- So Guard 5 runs first, then Guard 6, then Guard 2. A Guard 6 deny outranks Guard 2's ask, for the same reason Guard 5's does.

**Guard 6's cases, evaluated in order:**

| Case | Condition | Result |
|---|---|---|
| R1 | `agent_type` names a band role | not applicable: Guard 6 returns nothing and Guard 5 governs |
| R2 | no run file found by the walk-up | allow (nothing to enforce) |
| R3 | run file unreadable or invalid (bad JSON, missing `session_id`) | **fail open:** allow, warn `ORCH_RUN_INVALID` naming the file and the command `node <scripts>/orchestrate.mjs end` |
| R4 | payload `session_id` missing, or not equal to the run's | **stale run, fail open:** allow, warn `ORCH_RUN_STALE` naming the run's item, its `started` time and the cleanup command; **never deny** |
| R5 | same session, target inside the write surface | allow |
| R6 | same session, target outside the write surface (this includes the main session, `agent_id`-only payloads, and non-role agents such as `general-purpose`) | **deny** |

The R6 deny message reads: `Guard 6: ORCH_WRITE_DENIED: <path> is outside the orchestrator's write surface while run <item> is live; repository writes during a run go through a band role (Guard 5).`

**Warnings never decide the call.** A warning is emitted without a decision, so the remaining guards still run.

**The warning channel is chosen by measurement (V3).** Either stderr at exit 0, or the hook output's `systemMessage` field, whichever the binary surfaces to the user.

**Bash is not covered.** A main-session or agent `Bash` write during a run is outside Guard 6, as it is outside Guard 5. The spec, the README and the deny text's documentation all say so plainly. It is the measured boundary of the shipped contract, not a gap this item claims to close.

**R5 is broad; this is a stated limit.** Inside the live session, any non-role agent can write the write surface itself, including `band-envelope.json`. So under the cooperative model, an envelope can be forged through write tools. This is the same trust class as taking `agent_type` on trust: Guard 6 bounds where the orchestrator writes, not who writes inside that surface. The README states it beside the Bash limit.

### Alternative paths

- **`--auto`:** step 2's pauses are skipped, but step 6's two approvals are not.
- **A one-task plan** dispatches Code once. A plan with zero tasks halts with `ORCH_EMPTY_SCOPE`.
- **A new session after a crash:** Guard 6 is R4 (warn, allow). `/cc-orchestrate` there reports the stale run, and offers `end`, or `start` to replace it.
- **`/compact` mid-run** keeps `session_id`, so the run stays enforced. A resumed session that is given a new `session_id` sees a stale run (R4), which is safe in both directions.
- **The owner declines a dispatch in step mode:** the run is left at its position, and nothing is installed.

### Error cases

Every orchestrator halt:
- prints the code and reason verbatim;
- records `halt` in the run file;
- dispatches nothing further.

A halted run in its live session keeps Guard 6 enforcing until `orchestrate.mjs end`, the same session's explicit exit.

| Code | When |
|---|---|
| `ORCH_NO_SESSION_ID` | start without `CLAUDE_CODE_SESSION_ID` |
| `ORCH_RUN_ACTIVE` | start while this session's run exists |
| `ORCH_RUN_INVALID` | a step finds the run file unreadable (halt, while Guard 6 itself fails open) |
| `ORCH_AGENT_MISSING` | no agent definition whose `name` equals the role, in `.claude/agents/` or `~/.claude/agents/` (plugin-provided agents are not searched; that limit is stated) |
| `ORCH_HANDBACK_MISSING` | the final message has no `SNAP_HANDBACK` line, or more than one |
| `ORCH_HANDBACK_INVALID` | the hand-back fails `snap-validate`; the `SNAP_ERROR` is quoted verbatim |
| `ORCH_HANDBACK_ROLE_MISMATCH` | the hand-back's `sys.role` is not the dispatched role |
| `ORCH_GATE_UNEARNED` | the hand-back's gate is not in that role's "may hand back" column (for example spec or plan claiming `define_approved`) |
| `SNAP_GATE_MISMATCH` | the existing `--to` error on the next envelope; this should be unreachable through the router, and is kept as the backstop |
| `ORCH_EMPTY_SCOPE` / `ORCH_SCOPE_OVER_CAP` | the Code scope rules (D9) |

**A failed validation halts the receiving band:** it is not dispatched, and no envelope is installed for it.

## Verification first (the plan's opening steps, before any guard code; AC11-style, owner driving, scratch repo outside this repository)

On the installed `claude` binary, version recorded beside the output:
- **V1:** a subagent's tool set offers no working `Agent` dispatch. Equivalently, a subagent asked to dispatch a fixture agent cannot. **If it can, the plan halts for a ruling on D1.**
- **V2:** `CLAUDE_CODE_SESSION_ID`, read by a main-session `Bash`, equals the `session_id` in that session's PreToolUse payloads, both main-session and subagent. **If it differs or is absent, the plan halts for a ruling on D3.**
- **V3:** for an allowed PreToolUse call, which channel reaches the user: stderr at exit 0, or a `systemMessage` field. Guard 6's warning uses the measured one.

## Acceptance Criteria

- [ ] **AC1. Every handoff is a validated SNAP envelope.**
  - `install` never writes an envelope that has not passed `snap-validate --to <role>`.
  - `handback` never records an envelope that has not passed `snap-validate`.
  - Unit tests feed one invalid envelope through each path and assert nothing is written.
- [ ] **AC2. A failed validation halts the receiving band.** For each of the following, a test asserts the halt code, that `halt` is recorded, and that the envelope file is unchanged:
  - `ORCH_HANDBACK_MISSING`
  - `ORCH_HANDBACK_INVALID`
  - `ORCH_HANDBACK_ROLE_MISMATCH`
  - `ORCH_GATE_UNEARNED`
  - `SNAP_GATE_MISMATCH`
- [ ] **AC3. The orchestrator holds no repository write access, enforced.** Guard 6's tests cover each case:
  - R1: a band role is untouched by Guard 6;
  - R2: allow;
  - R3: warn and allow;
  - R4: warn and allow, with a mismatched `session_id` and a missing one;
  - R5: allow, for each of the four surface entries;
  - R6: deny for the main-session shape, the `agent_id`-only shape and a `general-purpose` agent, each writing a tracked path.

  A review pin states its discriminator. A mutant that drops the `session_id` comparison turns R4 red, and a mutant keyed on `agent_id` turns the `agent_id`-only R6 red.
- [ ] **AC4. The write surface is declared, not only implied.**
  - The four entries appear in one exported constant in `orchestrate.mjs`, and Guard 6's copy is pinned to it by test, in the same pattern as `BAND_ROLES`.
  - The README names all four.
- [ ] **AC5. The stale-run seam never blocks a session.** A test with a run file from another `session_id` and a tracked-path `Write` from the main-session shape gets **no deny decision** and a warning naming the cleanup command.
- [ ] **AC6. Evaluation order.** A test proves that Guard 6 sits between Guard 5 and Guard 2 in all four write-family arrays, and that the arrays stay distinct instances (the T-005 probe pattern).
- [ ] **AC7. Router table.** Unit tests cover each row of the band sequence, D6's forwarding rule (intra-band re-issue, cross-band forward), and that the orchestrator writes `define_approved` once and only via `approve plan`.
- [ ] **AC8. Scope.** Unit tests cover:
  - extraction from a `**Files:**` block, with the line-suffix strip and the plan file added;
  - `ORCH_EMPTY_SCOPE` for a task with no files and for a plan with zero tasks;
  - `ORCH_SCOPE_OVER_CAP` at 21;
  - that no path yields a Code envelope with `tk` other than `RW`.
- [ ] **AC9. Run file lifecycle.**
  - `ORCH_NO_SESSION_ID`, `ORCH_RUN_ACTIVE`, stale replacement with its report, the atomic write, and `end` removing both files.
  - `ORCH_AGENT_MISSING` against an empty `agents` directory.
- [ ] **AC10. Mirrors and host-owned state.**
  - `project-template/.claude/hooks/pre-tool-use.mjs` is byte-identical to the hook.
  - The `/cc-orchestrate` command exists in both command mirrors.
  - `PROJECT_HOST_OWNED` gains a `skip` row `memory/orchestrator-run.json`.
  - `project-template/gitignore` gains `.claude/memory/orchestrator-run.json` and `.conductor/`.
  - The installer and deploy suites pass.
- [ ] **AC11. V1–V3 are recorded verbatim** in `project.md` before any guard code, with the version.
- [ ] **AC12. Live demo** (scratch repo, fixture agents `spec`, `plan`, `code`, `audit` and `qa`, owner driving, step mode):
  1. a full run from `start` to `verify_pass` with a two-task plan;
  2. a main-session `Write` to a tracked path during the run is denied with `ORCH_WRITE_DENIED`;
  3. a fixture whose hand-back claims the wrong gate halts with `ORCH_GATE_UNEARNED`, and the next band is not dispatched;
  4. a second session started while the run file remains writes a tracked file and is **not** blocked, and sees `ORCH_RUN_STALE`.

  It is recorded the way the ARCH-010 demo was, read by `tool_use_id`.
- [ ] **AC13. Baseline.** `tools/skip-baseline.json` is unchanged, because this item adds passing tests only. Per-environment count predictions are stated in the plan before any run.

## Out of Scope

- Agent definitions and profiles (`[FEAT-012]`).
- Ship-band roles (`[FEAT-035]` Release, `[FEAT-036]` Docs).
- The Ticket agent and the Release-to-Ticket closure (`[FEAT-031]`).
- The Define, Build and Verify extensions (`[FEAT-032]`–`[FEAT-034]`).
- Any SNAP contract change.
- Bash, `NotebookEdit`, MCP-tool and symlink writes, in Guard 6 as in Guard 5.
- Hostile agent definitions, since `agent_type` is taken on trust.
- Parallel role dispatch.
- A resume or retry verb for a halted run (D12).
- Repairing `[BUG-051]` in other commands, and `[BUG-052]` or `[BUG-053]`.
- The `Orchestrator Protocol` section of the `CLAUDE.md` templates. That is the lookup chain, a different thing with the same word, and it is left as is.
- `project.md` writes and the closeout during a run, which stay human.

## Folded observation (ruled: fold, owner, 2026-10-01)

**The discrepancy:** `README.md:325` says "`.conductor/` is local-only and never committed", but `project-template/gitignore` does not list `.conductor/`. Deployed projects therefore rely on each user's own ignore rules. This repository ignores it at `.gitignore:11`.

**Ruling:** fold it into this item; no separate id. AC10's template leaf closes the gap.

**Discriminator:** the AC10 assertion that `project-template/gitignore` contains `.conductor/` is red on the pre-FEAT-011 template and green after.

The closeout cites this section.

## System Impact

- **New `scripts/orchestrate.mjs`:** the router, run file, install, hand-back, approve, end, and the write-surface constant.
- **New `/cc-orchestrate` command** in `project-template/.claude/commands/` and the `.claude/commands/` mirror.
- **`.claude/hooks/pre-tool-use.mjs` and its template mirror:** Guard 6, its registration, and the pinned surface constant.
- **`lib/installer/host-owned.mjs`:** one `skip` row.
- **`project-template/gitignore`:** two lines.
- **Tests:**
  - new `tests/hooks/guard6.test.js` and `tests/scripts/orchestrate.test.js` (directory per existing layout, settled at plan);
  - updates to the templates and deploy suites.
- **README:** a Guard 6 paragraph beside Guard 5, the orchestrator section, the write surface, the Bash limit, the R5 limit (non-role agents can write the surface, envelope included), and Known limits. The CHANGELOG entry lands at release.
- **This repository's `.gitignore`:**
  - the spec's own leaf `!/docs/superpowers/specs/2026-10-01-feat011-orchestrator-band-router-design.md`, in sorted position after line 122, lands in the spec commit;
  - the run file and `.conductor/` are already ignored here (`/.claude/memory/*` at `:36`, `.conductor/` at `:11`);
  - any new tracked command or plan file pays its leaf in its own commit.

### Files Requiring Full Read (deferred to /cc-plan)

- `scripts/snap-build.mjs` and `scripts/snap-validate.mjs`: whether `orchestrate.mjs` imports them or invokes them as child processes.
- `.claude/hooks/pre-tool-use.mjs`, around `:110-180` and `:628-637`: Guard 5's walk-up and helpers for Guard 6 to share.
- `lib/installer/deploy.mjs`: whether the scripts bundle list needs `orchestrate.mjs` named.

## Complexity Estimate

**L.** A new script with a state machine, a new guard with a fail-open seam, a new command, two mirrors, three live measurements and a live multi-role demo. It is bounded by consuming the ARCH-010 contract unchanged.
