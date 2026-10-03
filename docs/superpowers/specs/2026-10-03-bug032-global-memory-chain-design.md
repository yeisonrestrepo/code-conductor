# BUG-032: Orchestrator Protocol Memory Step Ignores Global Preferences

**Status:** APPROVED 2026-10-03. **Target:** `1.38.5`, patch. **Branch:** `fix/bug-032-global-memory-chain`.

## Problem

The orchestrator protocol's memory step (Step 1) only checked `.claude/memory/project.md`, ignoring `~/.claude/memory/personal.md` for global developer preferences.

## Solution

Step 1 now reads both paths: `.claude/memory/project.md` (project) and `~/.claude/memory/personal.md` (global preferences).

### Acceptance Criteria

1. The orchestrator protocol reads both memory files before proceeding to grep/glob.
2. The change applies to the global `CLAUDE.md` template shipped to all installed projects.

## Components Affected

- `global/CLAUDE.md` — orchestrator protocol Step 1
