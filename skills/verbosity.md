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

The active level is enforced by a `UserPromptSubmit` hook (`verbosity-remind.sh`) that fires before every response and injects a compact, level-aware reminder into the conversation context. The reminder is injected at each prompt boundary so the constraint survives context fills and session drift — not only at session start.

Read `~/.claude/memory/verbosity.md` for the configured level. Default: MIN if the file is absent, unreadable, or contains no valid `VERBOSITY:` token. To change the level, re-run the installer with `--verbosity MIN|INFO|VERBOSE` or edit the file directly.

Changes to `verbosity.md` take effect on the **next user prompt** — no session restart required. If you edit the file during an active Claude session, the hook picks up the new level on the immediately following prompt; there is no stale session state to clear. If the hook emits at an unexpected level after a change, verify the file was saved (not merely modified in an unsaved buffer), confirm that `$HOME` resolves to the expected path in the terminal that launched Claude, and check that no parent environment is setting `CC_VERBOSITY_SKIP=1`.

VERBOSITY_HOOK_VERSION: 1.11.0
