# FEAT-048 slice 6: band agents on OpenCode, plan

Spec: `docs/superpowers/specs/2026-11-27-feat048-opencode-band-agents-design.md`

### Task 1: agent renders

**Files:**
- `lib/installer/harness-commands.mjs`
- `tests/installer/harness-commands.test.js`
- `project-template/.opencode/agent/conductor-*.md` (generated)
- `project-template/.opencode/command/cc-*.md` (regenerated)

- [X] [T-001] Tests first. Cover AC1 (drift and stale), AC2 (permission maps, unmapped tool throws) and AC8 (the agent-name sentence in command renders).
- [X] [T-002] Add `renderAgent`, `AGENT_PREAMBLE` and the `OPENCODE_NOTE` sentence. Extend `renderAll` and `staleRenders`.
- [X] [T-003] Run `node lib/installer/harness-commands.mjs --write`. The suite goes green.

### Task 2: the plugin maps `task` and attributes calls

**Files:**
- `project-template/.opencode/plugin/conductor-guard.js`
- `tests/hooks/opencode-guard.test.js`

- [X] [T-004] Tests first. Cover AC3 through AC6 with a fake `client`, stub-guard payload capture and the real guard. Replace the old AC3 "`task` is blocked" test.
- [X] [T-005] Implement:
  - the `task` mapping;
  - the session lookup and cache;
  - the `agent_type` and root `session_id`;
  - the identify-failure block.

### Task 3: installer

**Files:**
- `lib/installer/deploy.mjs`
- `tests/installer/deploy.test.js`
- `tests/installer/templates.test.js`

- [X] [T-006] Tests first, for AC7.
- [X] [T-007] Copy `.opencode/agent` with `--opencode`, and give `copyRenderedCommands` its report line from the caller.

### Task 4: docs

**Files:**
- `README.md`
- `.github/wiki/pages/Getting-Started.md`
- `docs/superpowers/specs/2026-11-10-pre-1-44-hardening-design.md`
- `.gitignore`

- [X] [T-008] Update the OpenCode table rows, the option row and the layout tree.
- [X] [T-009] Amend the hardening spec's Choice 2 in place.
- [X] [T-010] Add the `.gitignore` leaf lines for this spec and plan.

## Tests run locally

These suites only; the full suite runs in CI:
- `harness-commands`
- `opencode-guard`
- `deploy`
- `templates`
- `gitignore-block-parity`

## Risks

- **OpenCode's V2 plugin API may drop `client.session.get`.** Covered: the lookup fails closed.
- **Command bodies name roles without the prefix.** Covered by the note sentence. OpenCode's "Unknown agent type" error lists the available agents.
