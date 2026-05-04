# Verbosity

Read `~/.claude/memory/verbosity.md` once at the start of every session. Extract the value after `VERBOSITY:`. Default to MIN if the file is absent or the value is unrecognized.

## Levels

### MIN (default)
- One declarative sentence per response.
- `[CHANGES]` tag: list of files modified only. No prose explanation unless the user asks.
- On failure or ambiguity: one clarifying question. Nothing else.

### INFO
- Bullet list: what changed and why. Max 5 bullets.
- Tags: `[CHANGES]` + `[REASON]`.
- No prose paragraphs.

### VERBOSE
- Full explanation. Prose allowed.
- All applicable tags: `[CHANGES]`, `[REASON]`, `[PLAN]`, `[BUG]`.
- No length limit.

## Application
Apply the active level to every response in the session. The level persists until the session ends or the user changes it explicitly.
