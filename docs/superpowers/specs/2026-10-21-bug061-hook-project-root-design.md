# BUG-061: The PreToolUse Hook Command Resolves Against the Working Directory

**Status:** APPROVED 2026-10-21. **Target:** a patch release, which the owner cuts. **Approach:** 1 of 3 (owner-chosen 2026-10-21: `$CLAUDE_PROJECT_DIR`; Git Bash confirmed present on the Windows field machine).

## Problem

On Windows (PowerShell and WSL sessions) nearly every tool call shows `PreToolUse:Bash hook error. Failed with non-blocking status code: node:internal/modules/cjs/loader:1520`, Node's `MODULE_NOT_FOUND` path (owner field report, 2026-10-19).

The registered command is `node .claude/hooks/pre-tool-use.mjs` (`project-template/.claude/settings.json:9`, and this repository's `.claude/settings.json:9`). The script path is relative, so it resolves against whatever directory the hook process starts in. When that directory is not the project root, Node cannot find the script. The failure is non-blocking, so Claude Code runs the tool anyway and **Guards 1-7 are skipped on every such call**, with only a terse loader error to show for it.

A second working-directory dependency sits inside the hook: Guard 3 reads its allowlist from `join(process.cwd(), '.claude/memory/bash-scan-allowlist.txt')` (`.claude/hooks/pre-tool-use.mjs:628`). Started from a subdirectory, the hook would load but find no allowlist, and deny commands the operator has allowed.

## Solution

The command anchors the script at the project root through the variable Claude Code sets for every hook process: `node "${CLAUDE_PROJECT_DIR:-.}/.claude/hooks/pre-tool-use.mjs"`. The `:-.` fallback keeps today's behavior on a Claude Code that does not set the variable, so the change never makes things worse. Inside the hook, the Guard 3 allowlist is read from `process.env.CLAUDE_PROJECT_DIR` when it is set, and from `process.cwd()` otherwise. That change lands identically in both hook copies, `project-template/.claude/hooks/pre-tool-use.mjs` and `.claude/hooks/pre-tool-use.mjs`. Both settings copies change, and the installer's existing fingerprint merge (`pre-tool-use.mjs` substring, `lib/installer/host-owned.mjs:66-70`; in-place replace, `lib/installer/settings-merge.mjs:35-41`) rewrites the old command in host projects on the next install, with no duplicate entry.

## Behavior

### Main path

1. Claude Code starts the PreToolUse hook with `CLAUDE_PROJECT_DIR` set to the project root, in whatever directory the session's shell is in.
2. The hook shell (bash on macOS/Linux, Git Bash on Windows) expands the variable, and `node` loads `<root>/.claude/hooks/pre-tool-use.mjs`.
3. Guard 3 reads `<root>/.claude/memory/bash-scan-allowlist.txt`. Every guard runs as it does today from the root.

### Alternative paths

- **Session working directory is a subdirectory, or drifted after a `cd`:** the same as the main path. This is the bug's case.
- **`CLAUDE_PROJECT_DIR` unset (an older Claude Code, or a manual run):** the command falls back to `./.claude/hooks/pre-tool-use.mjs` and the allowlist to `process.cwd()`, exactly today's behavior.
- **Root path containing spaces** (`C:\Users\First Last\...`, `/Users/me/My Projects/...`): the expansion sits inside double quotes, so the path stays one argument.
- **Re-install over a host with the old command:** the fingerprint merge replaces the entry in place. A host that edited the command by hand still matches on the `pre-tool-use.mjs` substring and is replaced, which is the merge's existing contract.

### Error cases

- **Script missing at the resolved path** (an uninstalled project, a deleted file): Node exits with `MODULE_NOT_FOUND` and Claude Code shows the non-blocking hook error. No existence guard is added, because a guard that exits 0 would turn a visible failure into a silent skip of every guard (the backlog's safety note). The error stays visible.
- **Allowlist file absent at the root:** unchanged. Guard 3 runs with no exceptions, as it does today.

## Acceptance Criteria

- [ ] AC1: both `project-template/.claude/settings.json` and `.claude/settings.json` register the PreToolUse command `node "${CLAUDE_PROJECT_DIR:-.}/.claude/hooks/pre-tool-use.mjs"`, and `tests/installer/templates.test.js` asserts that exact string for both.
- [ ] AC2: a test runs the registered command through `bash -c` with `cwd` set to a subdirectory of a temp project root and `CLAUDE_PROJECT_DIR` set to that root. The hook loads (no `MODULE_NOT_FOUND`) and returns a Guard decision for the payload.
- [ ] AC3: with the same subdirectory `cwd` and `CLAUDE_PROJECT_DIR` at the root, a command allowed only by an entry in `<root>/.claude/memory/bash-scan-allowlist.txt` is allowed. The same command with no allowlist entry is denied, which proves the test reads the file.
- [ ] AC4: with `CLAUDE_PROJECT_DIR` unset and `cwd` at the root, the command and the allowlist behave as today: the existing Guard 3 suites, which place the allowlist in a throwaway `cwd`, pass unchanged.
- [ ] AC5: re-installing over a host `settings.json` that holds `node .claude/hooks/pre-tool-use.mjs` leaves exactly one PreToolUse entry for the hook, carrying the new command.
- [ ] AC6: the allowlist change is present in both `project-template/.claude/hooks/pre-tool-use.mjs` and `.claude/hooks/pre-tool-use.mjs`, and the existing mirrored-pair test (`templates.test.js:116-118`) passes.
- [ ] AC7: the full suite passes.

## Out of Scope

- The release and its records (`VERSION`, `package.json`, `package-lock.json`, `CHANGELOG.md`, the backlog flip, the README "Known limits" removal, the `project.md` closeout), per `docs/RELEASE-CLOSEOUT.md`.
- The PostCompact and UserPromptSubmit hooks. They already guard with `[ -f ]` or walk up from `$PWD`, and they fail open by design; changing them is a separate item.
- The relative `orchestrate.mjs end` hint the hook prints (`pre-tool-use.mjs:210`). It already checks the file under the resolved root; only the printed text is relative.
- Guards 1 and 2 resolving the tool's own target path. That path is the tool's input, not the hook's location.
- Windows without Git Bash, and `[BUG-058]` (the suite on Windows and a Windows CI leg).

## System Impact

- `project-template/.claude/settings.json:9` and `.claude/settings.json:9`: the command string.
- The allowlist root, at `:628` in **both** hook copies, which must be changed identically:
  - `project-template/.claude/hooks/pre-tool-use.mjs`, the canonical copy the installer ships to host projects;
  - `.claude/hooks/pre-tool-use.mjs`, this repository's dogfooding copy.

  The template does ship its own copy: both files exist, and on 2026-10-21 they were byte-identical (40216 bytes, `cmp` rc 0). `tests/installer/templates.test.js:116-118` (`'ships the front door as one byte-identical mirrored pair'`) asserts that identity, so changing only one copy fails the suite.
- `tests/installer/templates.test.js:131`: the exact-string assertion.
- New tests for AC2, AC3 and AC5, in the hook and installer suites. Tests that spawn the hook must control `CLAUDE_PROJECT_DIR` explicitly, because a run inside Claude Code may inherit it.
- `lib/installer/settings-merge.mjs` and `host-owned.mjs`: no change expected; AC5 pins the existing merge against the new string.

### Files Requiring Full Read (deferred to /cc-plan)

- `project-template/.claude/hooks/pre-tool-use.mjs` around `:600-640` (the Guard 3 allowlist loader; the dogfooding copy is byte-identical).
- `tests/hooks/guard3.test.js` (the spawn helper the new tests reuse).

## Complexity Estimate

S: one command string in two settings files, one path root in two byte-identical hook copies, and four focused tests.
