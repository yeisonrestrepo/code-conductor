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
