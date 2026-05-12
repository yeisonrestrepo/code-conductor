---
description: "(Conductor) Systematically diagnose and fix a bug"
---

## Phase 0 — Skill activation

Before doing anything else, invoke both skills in order:

```
Skill({ skill: "subagent-driven-development", args: "$ARGUMENTS" })
Skill({ skill: "critical-review" })
```

`subagent-driven-development` delegates investigation to sub-agents (graph query + git log — no inline file reads). `critical-review` Phase 2 RESILIENCE check then runs on the proposed fix before it is applied — confirm the fix doesn't introduce a silent failure or new boundary condition. The fix must pass Phase 3 self-correction before being committed. End with `[VALIDATION]`.

---

Characterize the problem before investigating:

**Symptom:** [what is observed]
**Expected:** [what should happen]
**Reproduction:** [exact steps to reproduce]
**Frequency:** [always / intermittent / only under condition X]
**Context:** [environment, recent changes, logs]

List 2–4 hypotheses ordered by probability. Present them and confirm which to investigate first before touching any code.

For visual bugs or UI flow problems, activate Playwright MCP:
"This looks like a visual/UI issue. I'll use Playwright MCP to inspect it — confirm?"

**Investigation:**
- Use grep to locate relevant code — never read whole files
- Read only the sections that match the hypothesis
- Check git log for recent changes to the area

**Report:**
- Root cause: [file:line]
- Why it happens: [explanation]
- Impact: [what else could be affected]
- Proposed fix: [exact change]

Apply the fix only after the developer confirms. After fixing, suggest a test that would have caught this bug.
