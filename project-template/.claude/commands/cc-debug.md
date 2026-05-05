---
description: "(Conductor) Systematically diagnose and fix a bug"
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
