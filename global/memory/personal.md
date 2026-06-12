# Personal Preferences

> Local only. Never commit this file. Updated automatically by /checkpoint.

## Language
response_language: en

## Communication Style
- Strict tone compliance: no em-dashes in any output (docs, plans, specs, responses).
- Provides precise, numbered review feedback — expects each point addressed individually before proceeding.
- Reviews intermediate artifacts (plans, specs) thoroughly before approving; multiple revision rounds are normal.

## Editor & Tools
<!-- e.g.: VSCode, prefer TypeScript, always use pnpm -->

## Workflow Preferences
- Works through backlog items sequentially in natural order (PILLAR 1 first, then by item number).
- Prefers Subagent-Driven execution over inline execution for implementation plans.
- Expects spec → plan → implement cycle with explicit approval gates at each phase.
- Uses `/cc-checkpoint` before finishing branches.

## Notes
- Prefers version bump + CHANGELOG + README as a separate chore commit after the feature commit, not bundled together.
- Confirms between tasks during `/cc-implement` execution (does not use "proceed without confirmation" mode).
