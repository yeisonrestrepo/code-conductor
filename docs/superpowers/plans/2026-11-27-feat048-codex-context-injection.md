# Plan: FEAT-048 slice 5, context injection on Codex CLI

**Spec:** `docs/superpowers/specs/2026-11-27-feat048-codex-context-injection-design.md` (approved 2026-11-27)
**Status:** Approved 2026-11-27 (pre-approved with the spec)
**Branch:** `feat/feat-048-context-injection`
**Test command:** `npx vitest run`

## Tasks

- [X] **T1 (tests first): adapter.** New `tests/hooks/codex-context.test.js`: a temp project with the shipped `verbosity-remind.sh` and `context-guard.sh` and the adapter; a Codex payload yields one JSON object with `hookEventName: "UserPromptSubmit"` and `additionalContext` containing `[VERBOSITY:`; fake hooks show the outputs joined in order; nothing is printed for no output, a missing hook, a non-zero exit, or non-JSON stdin; exit 0 throughout. Expected red.
- [X] **T2: adapter.** `project-template/.codex/hooks/conductor-context.mjs`. Green.
- [X] **T3 (tests first): install.** `tests/installer/deploy.test.js`: `--codex` installs the adapter and a `UserPromptSubmit` entry; a re-run keeps one entry of each; a host entry survives. `tests/installer/templates.test.js`: `.codex/hooks.json` added to the fingerprint coverage table with `CODEX_HOOK_FINGERPRINTS`. Expected red.
- [X] **T4: install.** `project-template/.codex/hooks.json` entry; `lib/installer/deploy.mjs` exports `CODEX_HOOK_FINGERPRINTS`, installs the adapter and merges with both fingerprints; report line. Green.
- [X] **T5: live.** Install the template's `.codex/` and `.claude/hooks/` into the scratchpad probe project, trust once, run `codex exec`, and confirm the verbosity line in the session as `hooks.additional_context`.
- [X] **T6: docs.** README Codex section and wiki `--codex` row.
- [X] **T7: verify.** Affected suites locally; the full suite runs in CI (owner workflow); `dependencies` still `{}`.
