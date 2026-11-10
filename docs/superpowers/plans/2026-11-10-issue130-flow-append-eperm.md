# Issue #130 flow append EPERM implementation plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Update one checkbox per edit (BUG-003 invariant).

**Goal:** a rotation's rename on Windows never costs another hook its flow event.

**Spec:** `docs/superpowers/specs/2026-11-10-issue130-flow-append-eperm-design.md` (draft, pending owner approval). Id pending owner intake.

## Global Constraints

- One protected surface changes: the PreToolUse hook. Only the emitter's append changes. Both copies (`project-template/.claude/hooks/` and `.claude/hooks/`) stay byte-identical. Rotation, the lock and every guard are untouched.
- No release records (`VERSION`, `package.json` version, `CHANGELOG.md`, backlog).
- No new dependencies. Tests are added, none skipped, so `tools/skip-baseline.json` is untouched on every leg.

## Predicted red table (written before any run)

| Suite | Before the hook change | After |
|---|---|---|
| `tests/hooks/flow-events.test.js`, new "fails once with EPERM" case | red: 3 lines, the event is lost | green |
| `tests/hooks/flow-events.test.js`, new "keeps failing with EPERM" case | green (no event, decision unchanged) | green |
| every other suite | green | green |

## Tasks

- [x] 1. `tests/hooks/flow-events.test.js`: AC1 and AC2, with an `--import` preload that fails the event file's open with `EPERM`; AC1 red on `main`.
- [x] 2. Hook: `openFlowEvents` / `appendFlowLine` replace `appendFileSync` in `recordFlowEvent`; copy to `.claude/hooks/`; AC1 and AC2 green.
- [x] 3. `tests/hooks/flow-append-race.test.js`: the worker's append mirrors the emitter's; header records the #130 measurement.
- [x] 4. `.gitignore`: spec and plan leaves in sorted position.
- [x] 5. Loop `flow-append-race.test.js` 30 times; run the full suite once with `npx vitest run --maxWorkers=2 --minWorkers=1`.
