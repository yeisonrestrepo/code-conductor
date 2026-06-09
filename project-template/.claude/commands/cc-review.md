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
