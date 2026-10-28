# Memory Architecture

code-conductor uses a two-tier memory system: shared project memory (committed to git) and local personal memory (never committed).

## Memory Files

```
~/.claude/memory/
  personal.md      ← local only, never committed
  verbosity.md     ← MIN/INFO/VERBOSE level

<project>/.claude/memory/
  project.md       ← in git, shared with the team
```

## What goes where

| File | Scope | Content |
|------|-------|---------|
| `project.md` | Team (git) | Architecture decisions, conventions, technical debt, workarounds |
| `personal.md` (project) | Local | Developer preferences, personal shortcuts for this project |
| `personal.md` (global) | Local | Cross-project preferences |

## The Lookup Chain

The `memory-first` skill enforces this order before any file read:

```
1. Check project.md + personal.md  →  answer found? STOP
2. Grep / Glob                      →  answer found? STOP
3. Targeted read (offset + limit)   →  max 150 lines
```

This is the single biggest token saver: most questions about conventions, decisions, and architecture are answered by memory without reading any source file.

## `/cc-checkpoint`

Writes to both memory files. Run it:

- Before `/compact`
- After completing a feature
- After key architectural decisions

Every decision captured once is a conversation the team never has again.

`project.md` history is append-only, so it grows with the project. Phase commands therefore never read it whole. A bounded `## Current State` digest at the top of the file holds the active spec, the last checkpoint, and at most 12 conventions and 12 debt items, within 40 lines. `/cc-implement`, `/cc-plan` and `/cc-resume` read it with `limit: 60` and Grep the history below for detail. `/cc-spec` and `/cc-checkpoint` update it one line per Edit. A file without the section gets it on its next `/cc-checkpoint`, and nothing in the history is moved or deleted.

## Local State Cache

On top of markdown memory, `/cc-implement` Step 6 records task state to SQLite:

| Property | Value |
|----------|-------|
| Location | `.conductor/cache.db` |
| Engine | `scripts/conductor-db.mjs` (wraps `node:sqlite`) |
| Requires | Node >= 22.5 (self-disables below) |
| Schema | v2 (ARCH-008): `task_state`, `sessions`, `snapshots`, `raw_history` |
| Gitignored | Yes (`.conductor/` is local-only) |

### Phase-Entry Resume

`/cc-spec`, `/cc-plan`, and `/cc-implement` open each phase by running `resume-read.mjs`:

1. Resolve current git commit hash
2. Look for a DB snapshot for that commit → use it if found
3. Fall back to `.claude/memory/session-snapshot.json`
4. Clean miss → start fresh
5. Corrupt handoff → halt with `SNAP_INVALID` (exit 4)

This means work survives branch switches, rollbacks, and multi-day gaps.

## Session State Files

| File | Purpose | Gitignored |
|------|---------|-----------|
| `session-snapshot.json` | SNAP JSON written by `/cc-compact` | No |
| `orchestrator-run.json` | Active orchestrate run state | Yes |
| `band-envelope.json` | Current role's SNAP envelope | Yes |
| `turn-count.txt` | Context turn counter, stored as `<session_id> <count>` and reset when the session changes ([C4 Components](C4-Components#context-guard)) | Yes |
| `context-threshold.txt` | Configurable turn threshold (default 25) | No |
| `bash-scan-allowlist.txt` | Guard 3 permanent exceptions | No |
