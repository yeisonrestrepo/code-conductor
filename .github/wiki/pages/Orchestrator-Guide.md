# Orchestrator Guide

`/cc-orchestrate` routes one backlog item through **Define → Build → Verify** using five role agents, each boxed by its own scope envelope and guarded by hooks.

## Launch

```bash
# Launch with the review-loop exception for zero owner wakes
claude --permission-mode auto --settings .claude/review-loop.settings.json
```

Then inside the session:

```
/cc-orchestrate FEAT-123
```

## What happens

### 1. Start

The orchestrator resolves your project's test command and records it in the run file. Resolution order:

1. Package manager's `test` invocation (from `package.json`)
2. `detect-stack.mjs` test command (if no `package.json`)
3. Halt with `ORCH_TEST_COMMAND_UNRESOLVED` if neither resolves
4. Halt with `ORCH_TEST_COMMAND_UNSAFE` if the command chains

### 2. Define

| Step | What happens |
|------|-------------|
| Spec | `spec` agent writes the specification |
| Review | `define-review` agent checks against checklist (up to 3 passes, 2 revisions) |
| Approve | **You approve** — shown with SHA-256 hash, re-hashed before approval |
| Plan | `plan` agent writes the plan |
| Review | Same review loop |
| Approve | **You approve again** |

### 3. Build

`code` agent dispatched once per plan task, serially. For each:

1. Orchestrator builds a SNAP v3 envelope
2. Validates with `snap-validate --to code`
3. Dispatches the agent
4. Waits for completion
5. Validates the `SNAP_HANDBACK` line

### 4. Verify

| Agent | What it does |
|-------|-------------|
| `audit` | Static code review (read-only, no shell) |
| `qa` | Runs the recorded test command (cannot write files — Guard 5) |

### 5. Report

You receive every hand-back, both approvals, and each review-loop outcome. **Release stays human.**

## Flags

| Flag | Effect |
|------|--------|
| `--auto` | Skip pause between role dispatches. Spec and plan approvals always pause. |
| `--ticket 42` | Bind to a GitHub issue. Fetches once via `gh`, writes snapshot to `.conductor/ticket/<ITEM>.md`. |

## Review Loop Configurations

| Configuration | Cost per round |
|---|---|
| Auto mode + shipped exception (`--settings .claude/review-loop.settings.json`) | 0 wakes, 0 prompts |
| Default (ask) permission mode | 0 wakes; one approval per revision write |
| Plain auto mode | Denied on first revision; loop closes `skipped:denied` |

## Recovery

A failed validation halts the run terminally. Recover with:

```
orchestrate.mjs end    # then
orchestrate.mjs start  # fresh start
```

## Guards Active During Orchestration

| Guard | Protects |
|-------|----------|
| Guard 5 | Band scope — role can only write inside its envelope |
| Guard 6 | Orchestrator writes — non-band writers locked to run surface |
| Guard 7 | Role shell — only the exact test command, no chaining |
