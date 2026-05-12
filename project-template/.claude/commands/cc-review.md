---
description: "(Conductor) Review code changes against spec and standards"
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
