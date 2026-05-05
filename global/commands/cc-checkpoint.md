---
description: "(Conductor) Save session decisions, conventions, and debt to memory"
---

Read the conversation history from the current session.

Identify and extract:
1. **Decisions made** — architectural choices, approach selections, rejected alternatives
2. **Conventions established** — naming patterns, file organization, code style choices
3. **Technical debt** — shortcuts taken, known limitations, deferred work
4. **Workarounds** — non-obvious solutions and why they were needed

**Update `.claude/memory/project.md`** (append only, never delete):
- Add a timestamped section: `## Checkpoint [YYYY-MM-DD HH:MM]`
- List decisions, conventions, and debt from this session

**Update `.claude/memory/personal.md`** (local only):
- Add any developer preferences observed this session

**Report:**
- Timestamp of this checkpoint
- What was saved to project.md (2–3 bullets)
- What was saved to personal.md (1–2 bullets)

Suggest running `/cc-checkpoint` automatically: before `/compact`, after completing a feature, after any key architectural decision.
