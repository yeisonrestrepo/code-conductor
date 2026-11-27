# FEAT-048 slice 7: context injection on OpenCode, plan

Spec: `docs/superpowers/specs/2026-11-27-feat048-opencode-context-injection-design.md`

### Task 1: the context plugin

**Files:**
- `project-template/.opencode/plugin/conductor-context.js`
- `tests/hooks/opencode-context.test.js`

- [X] [T-001] Tests first, for AC1 through AC6. Use the shipped hooks and fake hooks, a fake `client`, and an isolated `HOME`.
- [X] [T-002] Implement `ConductorContext`.

### Task 2: installer

**Files:**
- `lib/installer/deploy.mjs`
- `tests/installer/deploy.test.js`
- `tests/installer/templates.test.js`

- [X] [T-003] Tests first: AC7, plus the BUG-069 pin naming the second plugin.
- [X] [T-004] Install it from `installOpencodePlugin`.

### Task 3: docs

**Files:**
- `README.md`
- `.github/wiki/pages/Getting-Started.md`
- `.gitignore`

- [X] [T-005] Update the OpenCode rows, the option row and the layout tree.
- [X] [T-006] Add the `.gitignore` leaf lines for this spec and plan.

## Tests run locally

These suites only; the full suite runs in CI:
- `opencode-context`
- `opencode-guard`
- `deploy`
- `templates`
- `gitignore-block-parity`
- `docs-sync`
- `wiki`
