---
description: "(Conductor) Review code changes against spec and standards"
---

## Phase entry - Handoff enforcement

Before doing anything else, perform this blocking check:

1. Count the number of turns in the current conversation history.
2. If turn count exceeds 5, halt immediately and output:

   > "Phase boundary detected. Please execute /compact to clear history before proceeding."

   Do not start any review tasks. Enter standby. Wait for the user to confirm `/compact` has been run before continuing.

3. If turn count ≤ 5 AND `.claude/memory/session-snapshot.md` exists, proceed to the Destructive Read Invariant below.
4. If turn count ≤ 5 AND `.claude/memory/session-snapshot.md` is absent, skip the Destructive Read Invariant and proceed directly - no snapshot context available (read-if-present fallback).

## Phase entry - Destructive Read Invariant

Applies only when snapshot exists (step 3 above).

1. Read `.claude/memory/session-snapshot.md` into context.
2. Delete the file immediately.
3. Use the snapshot contents as the starting context for this phase.

If the file cannot be deleted after reading, report the error and halt.

---

## Role dispatch - audit (FEAT-061)

`/cc-review --spec <path> --plan <path> [target]` hands the review to the `audit` role agent, so its read-only tool mask, its guards and its fixed success condition apply. Without both flags, print `audit not dispatched: name --spec and --plan to review against them` and run the classic review below.

1. Install the envelope, from the project root:

   ```sh
   S=.claude/scripts; [ -f "$S/orchestrate.mjs" ] || S=scripts
   node "$S/orchestrate.mjs" envelope audit --item <ID-or-adhoc>
   ```

   `<ID-or-adhoc>` is the backlog id the spec names (for example `FEAT-061`), else `adhoc`.
2. Read the first stdout line. `installed:` means the verb wrote `.claude/memory/band-envelope.json` for audit. `not-installed:` means a run file is present: nothing was written, and audit, which has no write tool and no shell, needs no envelope. On a non-zero exit, or a first line that starts with neither, do not dispatch: print `audit not dispatched: <the verb's stderr line>` and run the classic review below.
3. Dispatch `Agent({ subagent_type: "audit", description: "audit review", prompt })`. The brief names the spec, the plan and the review target (no target means `git diff HEAD`). It says that a phase command, not a run, dispatched the agent, and either that the envelope is installed at `.claude/memory/band-envelope.json` or, after `not-installed:`, that no envelope was installed for it.
4. Show the audit's findings and its `VERDICT:` line exactly as the agent wrote them. Show its `SNAP_HANDBACK` line; do not record it, because no run records an out-of-run hand-back. A guard denial or a report without a hand-back is shown as it is, never retried another way.
5. Only after `installed:`, run `node "$S/orchestrate.mjs" envelope --clear`, also when the agent was denied or ended without a hand-back. If it refuses, report the refusal and leave the file alone: a run now owns it.
6. Offer: "Want me to fix the blocker and major findings?" Do not run Phase 0 or the three-layer review below.

---

## Phase 0 — Skill activation

Before doing anything else, invoke both skills in order:

```
Skill({ skill: "subagent-driven-development", args: "$ARGUMENTS" })
Skill({ skill: "critical-review" })
```

`subagent-driven-development` spawns one `Explore` sub-agent per review layer (Critical / Important / Suggestions) — each returns findings, the main context aggregates only. `critical-review` then runs Phases 2–4: Adversarial Review (RESILIENCE / EFFICIENCY / FRICTION checks), Self-Correction Loop for any weakness found, and the mandatory `[VALIDATION]` section at the end.

---

Determine what to review:
- No argument → `git diff HEAD`
- File path → review that file
- Directory → review all changed files in that directory

Review in three layers:

### 🔴 Critical — Blocks merge
Issues that will cause bugs, security vulnerabilities, data loss, or breaking changes:
- Logic errors or incorrect algorithm
- SQL injection, XSS, hardcoded secrets, missing auth checks
- Mutations that bypass validation
- Breaking changes to public API without versioning

### 🟡 Important — Must fix before shipping
Issues that degrade quality or create risk:
- Missing error handling for real failure cases
- Missing tests for new behavior
- Convention violations that will confuse future readers
- N+1 queries or obvious performance problems
- Missing input validation at system boundaries

### 🟢 Suggestions — Optional improvements
Style, clarity, or minor improvements that would be nice but don't block the merge.

---

**Verdict:**
- `APPROVED` — no critical or important issues
- `APPROVED WITH CHANGES` — important issues found, fix before shipping
- `BLOCKED` — critical issues found, do not merge

After showing the report, offer:
"Want me to auto-fix the critical and important issues?"
