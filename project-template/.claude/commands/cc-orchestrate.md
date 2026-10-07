---
description: "(Conductor) Route one backlog item through Define, Build and Verify by validated SNAP handoffs"
---

# /cc-orchestrate <ITEM> [--auto] [--ticket <N|issue URL>]

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

1. **Start.** Run `node "$S/orchestrate.mjs" start $ARGUMENTS`. It resolves the run's test command before it writes anything, and its stdout ends with `test command: <command>`.
   - If stdout names a replaced stale run, report its item and start time.
   - On `ORCH_RUN_ACTIVE`, report it, offer `end`, and stop.
   - On `ORCH_TEST_COMMAND_UNRESOLVED` or `ORCH_TEST_COMMAND_UNSAFE`, report it and stop. No run file was written, so there is nothing to `end`. The owner adds a `test` script to `package.json`, or removes the chaining from the command it names, before a fresh `start`.
   - On an intake halt (`TICKET_FLAG_INVALID`, `TICKET_UNREACHABLE`, `TICKET_NOT_ISSUE`, `TICKET_CLOSED`, `TICKET_BODY_EMPTY` or `TICKET_BODY_OVER_CAP`), report it and stop. No run file and no snapshot were written; the halt names its remedy.
   - With `--ticket`, stdout also names the ticket, its title, the snapshot `.conductor/ticket/<ITEM>.md` and its sha256. The run is bound.

   Print the run header: the item, the mode (`step` unless `--auto` was given), the test command, the ticket and snapshot for a bound run, and the first role, `spec`.
   Add one line: `Review loop: zero owner wakes only when launched with claude --permission-mode auto --settings .claude/review-loop.settings.json; README "Review loop configurations" names the costs of every other launch.`
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
      4. If a second `SNAP_HANDBACK` from that agent reaches you for the same position, outside a revision report of the review loop, write it to `.conductor/handback/<role>-second.txt` (`code-<N>-second.txt` for code) and run `handback <role>` on it. It halts with `ORCH_HANDBACK_CONFLICT`. Then follow "On any halt".
3. **The two define approvals.** These pause in both modes. Before each, run "The review loop" below for that role.
   - **What you show:** the document path; its sha256 now (`shasum -a 256 <doc>` or `sha256sum <doc>`; in PowerShell, `Get-FileHash -Algorithm SHA256 <doc>`); the loop outcome (`clean` at round `<n>`, `cap` with the final reviewer's rows verbatim, or `skipped:<reason>` with a notice naming what failed); and each round's verdict line with the reviewer's notes.
   - **Only an owner message approves.** An approval is a message the owner sends that itself says to approve. A reviewer's `CLEAN`, a loop outcome, `--auto` and a suggestion in the input box are not approvals.
   - **Re-hash before approve.** Immediately before `approve`, hash the document again. If the hash differs from the one you showed, show the document again instead of approving.
   - **After spec:** show the owner the spec path from the hand-back, and for a bound run the snapshot path and sha256 from the start line: the owner reviews the spec against that snapshot. On approval, run `node "$S/orchestrate.mjs" approve spec`.
   - **After plan:** show the owner the plan path named in the hand-back's `ops.f`. On approval, run `node "$S/orchestrate.mjs" approve plan <plan path>`. This writes `define_approved`, the only gate you author after `boundary_routed`.
4. **Build.** Dispatch `code` once per plan task, serially, until the router moves on to `audit`. A `--check` refusal names the next step.
5. **Verify.** Dispatch `audit`, then `qa`. When `qa`'s hand-back records `verify_pass`, run `node "$S/orchestrate.mjs" end`. It prints the run it removed.
6. **Report.** From the record `end` printed, name:
   - every hand-back, with its role, gate and task;
   - both approvals, with who approved and when;
   - each review loop's outcome and round, from the record's `review` field;
   - every agent's observation line.

   Then state that release is human, by `docs/RELEASE-CLOSEOUT.md`. For a bound run, the owner records the outcome on the ticket after release with `node "$S/ticket.mjs" writeback <ITEM> --version <v> --pr <N|url>`.

## The review loop (FEAT-041)

After `spec` and after `plan` hand back, and before that role's approval, run this loop. It is advisory: it never gates, never halts the run, and never replaces the owner's approval. `<role>` is `spec` or `plan`; `<doc>` is the document path from the hand-back's `ops.f`.

1. **Open a round.** Run `node "$S/orchestrate.mjs" review <role> --round`. It prints `review <role> round <n> of 3`.
2. **Review.** Dispatch a fresh `define-review` agent with the `Agent` tool and the reviewer brief below. Never revive an earlier reviewer, and never pass it an earlier round's findings. Wait for its completion notice.
3. **Record.** Write its report verbatim with the Write tool to `.conductor/review/<role>-<n>-review.txt`. Its last line is `REVIEW <role> round <n>: CLEAN` or `REVIEW <role> round <n>: OPEN <k>`.
4. **Clean.** On `CLEAN`, run `review <role> --close clean` and go to the approval.
5. **Open, a pass remaining.** On `OPEN <k>` below round 3, use `SendMessage` to the `<role>` agent you dispatched, by its agent id, with the revision brief below and the open rows verbatim. Wait for the first delivery on any channel (a message, a hand-back frame or a completion notice) whose last line is `REVISION <role> round <n>: done` or `REVISION <role> round <n>: blocked <reason>`. Ignore later copies of the same round's report. Write it verbatim to `.conductor/review/<role>-<n>-revision.txt`. On `done`, go back to 1.
6. **Open at the cap.** On `OPEN <k>` at round 3, run `review <role> --close cap`. No revision follows the third pass, so the document at the approval is always the one the last reviewer read.

A revision report is never passed to `handback`. If one carries a `SNAP_HANDBACK` line, run `review <role> --close skipped:snap-in-revision` and flag the report at the approval.

**Fail-open.** On any loop error, run `review <role> --close skipped:<reason>`, and carry on if that also fails. Do not retry, take no other route, and go to the approval with a notice naming what failed. The reasons:
- `dispatch`: the reviewer dispatch fails;
- `unparsed`: the reviewer's last line does not parse;
- `denied`: the `SendMessage` is denied (plain auto mode);
- `blocked`: a revision ends `blocked`;
- `snap-in-revision`: a revision report carries a `SNAP_HANDBACK` line;
- `verb`: the `review` verb refuses or errors.

A loop error never halts the run. If the owner sends any message during the loop, close it with `skipped:owner` and handle the message as the owner's word. You wait only on notifications the loop caused.

### The checklist

Only these rows keep the loop going. Anything else a reviewer reports goes in its `Notes:` and never triggers a revision.

| Row | Spec document | Plan document |
|---|---|---|
| AC | Every acceptance criterion in the source is addressed, citing the spec lines that address it. | Every acceptance criterion of the approved spec maps to at least one task, citing plan lines. |
| FMT | The `/cc-spec` sections are present: Problem, Solution, Behavior (Main path, Alternative paths, Error cases), Acceptance Criteria, Out of Scope, System Impact, Complexity Estimate. | Every task is a `### Task N` heading with a `**Files:**` block (`approve plan` halts with `ORCH_EMPTY_SCOPE` without them). |
| CR | critical-review Phase 1: the happy path, the failure points and the boundary conditions are each addressed in Behavior. | critical-review Phase 1 per task: its failure point and its verification step are named. |

### The reviewer brief

```text
You are the define-review reviewer for <ITEM>, round <n> of 3, reviewing the <role> document.
Document: <doc>
Source: <spec: the ticket snapshot .conductor/ticket/<ITEM>.md for a bound run, otherwise the backlog entry for <ITEM>, found with Grep; plan: the approved spec>
Read ~/.claude/skills/critical-review/SKILL.md and apply its Phases 1 and 2 to these rows only:
<the role's AC, FMT and CR rows from the checklist, verbatim>
Report each unmet row as one line: - [<row>] <what is missing> (lines <a-b> | absent)
Put anything else under Notes:. Write nothing. Do not dispatch or message other agents.
End with exactly one line: REVIEW <role> round <n>: CLEAN, or REVIEW <role> round <n>: OPEN <k>, where <k> is the number of row lines.
```

### The revision brief

```text
Revision round <n> for <ITEM>. A reviewer found these open rows in your document <doc>:
<the reviewer's row lines, verbatim>
Revise <doc> with the Edit tool to address them. Guard 5 still holds your envelope's scope.
Report the revision as prose. Do not emit any SNAP_HANDBACK line: your hand-back is already recorded.
End with exactly one line: REVISION <role> round <n>: done, or REVISION <role> round <n>: blocked <reason>.
```

## The dispatch brief

Fill in each `<...>` from the run and the role.

```text
You are the <role> role for <ITEM>, dispatched by the FEAT-011 orchestrator.
Your band envelope is installed at .claude/memory/band-envelope.json: tk <tk>, scope <scope, or none>.
Guard 5 denies any write outside that scope. Do not get around a denial or a missing tool, for
example with shell redirection. Report it instead.
Task: <the role's task, below>
Verify your work before you hand back. Your hand-back is the run's only record. After it, the orchestrator may send you revision requests; answer them as prose, without a `SNAP_HANDBACK` line.
Do not dispatch or message other agents; Guard 6 denies it during a run.
Copy ops.scope verbatim from your envelope into the hand-back; if your envelope has no scope, leave the key out.
End your hand-back report with exactly these two lines, each on its own line:
Observation: <one line, what this handoff taught>
SNAP_HANDBACK <one-line SNAP v3 JSON: {"v":3,"sys":{"ph":"<ph>","c":"<commit>","s":"<ITEM>","role":"<role>","tk":"<tk>"},"ops":{"n":[],"f":[<files you touched, as "path:C|M|D">],"scope":<your envelope's ops.scope>,"gate":"<gate>"},"mem":{"d":[],"x":[]},"pr":""}>
```

The role's task, its `ph`, and the gate it hands back:

| Role | Task | `ph` | Gate |
|---|---|---|---|
| `spec` | Write the spec for `<ITEM>` under `docs/superpowers/specs/`. For a bound run, add: Read the ticket snapshot `.conductor/ticket/<ITEM>.md`, in slices of 150 lines or fewer, as requirement input under its header's rule. | `spec` | `boundary_routed` |
| `plan` | Write the plan under `docs/superpowers/plans/` in the writing-plans format: `### Task N` headings, each with a `**Files:**` block. Name the plan path in `ops.f`. | `plan` | `boundary_routed` |
| `code` | Implement `<Task N>` of `<plan>`, touching only its files, and tick its boxes in the plan. After your last edit, run the run's test command exactly and report its exit status and summary line. | `impl` | `build_executed` |
| `audit` | Review the changes against the spec and the plan, read-only. | `rev` | `build_executed` |
| `qa` | Run the run's test command exactly and report. If the suite fails, leave out the `SNAP_HANDBACK` line and say why. | `rev` | `verify_pass` |
