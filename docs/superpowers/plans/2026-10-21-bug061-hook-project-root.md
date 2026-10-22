# BUG-061 Hook Project Root Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The PreToolUse hook loads and reads its Guard 3 allowlist from the project root even when the session's working directory is elsewhere.

**Architecture:** Both settings copies register `node "${CLAUDE_PROJECT_DIR:-.}/.claude/hooks/pre-tool-use.mjs"`, so the hook shell resolves the script against the root Claude Code names. Inside the hook, `g3ReadAllowlist` roots the allowlist at `process.env.CLAUDE_PROJECT_DIR || process.cwd()`, identically in both byte-identical hook copies. The installer's existing fingerprint merge carries the new command to host projects and is not changed.

**Tech Stack:** Node ESM, bash (Git Bash on Windows), vitest.

**Spec:** `docs/superpowers/specs/2026-10-21-bug061-hook-project-root-design.md`, APPROVED 2026-10-21.

## Global Constraints

- The command string is exactly `node "${CLAUDE_PROJECT_DIR:-.}/.claude/hooks/pre-tool-use.mjs"` in `project-template/.claude/settings.json` and `.claude/settings.json`.
- The allowlist root is exactly `process.env.CLAUDE_PROJECT_DIR || process.cwd()`, at `pre-tool-use.mjs:628` in both `project-template/.claude/hooks/pre-tool-use.mjs` and `.claude/hooks/pre-tool-use.mjs`. The two copies stay byte-identical (`templates.test.js:116-118`).
- No existence guard on the hook command: a missing script must keep failing visibly, never exit 0.
- `lib/installer/settings-merge.mjs` and `lib/installer/host-owned.mjs` do not change.
- Tests that spawn the hook control `CLAUDE_PROJECT_DIR` explicitly, because a run inside Claude Code may inherit it.
- Out of scope: PostCompact and UserPromptSubmit hooks, the `orchestrate.mjs end` hint at `pre-tool-use.mjs:210`, Guards 1 and 2 target paths, Windows without Git Bash, `[BUG-058]`.
- No release records: no `VERSION`, `package.json`, `package-lock.json`, `CHANGELOG.md`, backlog flip, README "Known limits" removal (`README.md:460`) or `project.md` closeout. Release stays human, by `docs/RELEASE-CLOSEOUT.md`.
- Staging is by explicit path: `git add -u <path>` for tracked files, plain `git add <path>` for a new file whose `.gitignore` leaf exists. Never bare `git add -u`.
- The pre-commit hook runs the full vitest suite. Never bypass it.

## Review Focus

1. **A project root whose path contains a space** (`C:\Users\First Last\...`): the expansion stays one argument and the hook loads. Pinned in Task 2: every test in `hook-project-root.test.js` builds its root under a directory named `cc root-*`.
2. **An allowlist in the drifted cwd but not at the root**: the root wins, so the cwd file grants nothing. Pinned by T-002-A test 4.
3. **An allowlist at the root whose entries do not cover the command**: denied, which proves the file is read and not merely present. Pinned by T-002-A test 3.
4. **`CLAUDE_PROJECT_DIR` unset with the cwd at the root**: today's behavior, command and allowlist both resolve against cwd. Pinned by T-002-A test 5.
5. **A developer running the suite inside a Claude Code session that exports `CLAUDE_PROJECT_DIR`**: the Guard 3 port corpus still sees only its throwaway allowlist. Pinned by T-002-E, which deletes the variable from `guard3-port.test.js`'s spawn env.

---

### Task 0: Commit the approved spec, this plan and their ignore leaves

**Files:**
- Modify: `.gitignore` (one leaf for this plan, in sorted position after `!/docs/superpowers/plans/2026-10-20-bug060-node-env-alias.md`)
- Create (stage): `docs/superpowers/plans/2026-10-21-bug061-hook-project-root.md`
- Create (stage): `docs/superpowers/specs/2026-10-21-bug061-hook-project-root-design.md` (its leaf is already in `.gitignore:157`)
- Modify (stage): `.claude/memory/project.md` (the BUG-061 spec entry)

- [X] [T-000-0] Create and switch to the fix branch: `git switch -c "fix/bug-061-hook-project-root"`. Expected: `git branch --show-current` prints `fix/bug-061-hook-project-root`. Uncommitted and untracked files carry over.
- [X] [T-000-A] Add `!/docs/superpowers/plans/2026-10-21-bug061-hook-project-root.md` to `.gitignore` directly after the `!/docs/superpowers/plans/2026-10-20-bug060-node-env-alias.md` line. This is the BUG-042 toll: `/docs/superpowers/plans/*` denies the file until its leaf exists, and `gitignore-block-parity` fails once it is tracked without one.
- [X] [T-000-B] Stage the tracked files: `git add -u .gitignore .claude/memory/project.md`
- [X] [T-000-C] Stage the new files: `git add docs/superpowers/specs/2026-10-21-bug061-hook-project-root-design.md docs/superpowers/plans/2026-10-21-bug061-hook-project-root.md`. Both leaves exist after T-000-A, so plain `git add` exits 0.
- [X] [T-000-D] Commit: `git commit -m "docs: add the BUG-061 spec and implementation plan [BUG-061]"`. Expected: the pre-commit suite passes, including `gitignore-block-parity`.

### Task 1: Register the rooted hook command (AC1, AC5)

**Files:**
- Modify: `project-template/.claude/settings.json:9`
- Modify: `.claude/settings.json:9`
- Test: `tests/installer/templates.test.js:131` (expected string)
- Test: `tests/installer/settings-merge.test.js` (one new test in `describe('mergeSettingsFile: owned entries')`, after the `[FEAT-011 AC3a]` test)

**Interfaces:**
- Consumes: `mergeSettingsFile(templatePath, settingsPath, fingerprints)` and `PROJECT_SETTINGS_FINGERPRINTS`, unchanged.
- Produces: the registered command string `node "${CLAUDE_PROJECT_DIR:-.}/.claude/hooks/pre-tool-use.mjs"`, which Task 2's tests read from `project-template/.claude/settings.json` and run through `bash -c`.

- [X] [T-001-A] In `tests/installer/templates.test.js:131`, change the expected array to:

```js
    expect(entries[0].hooks.map(h => h.command)).toEqual(['node "${CLAUDE_PROJECT_DIR:-.}/.claude/hooks/pre-tool-use.mjs"']);
```

  The string is single-quoted, so `${...}` stays literal.
- [X] [T-001-B] In `tests/installer/settings-merge.test.js`, add this test directly after the `[FEAT-011 AC3a]` test:

```js
  // A host installed before BUG-061 holds the cwd-relative command. The pre-tool-use.mjs
  // fingerprint must replace it in place, leaving one entry that carries the rooted command.
  it('[BUG-061] AC5 replaces the cwd-relative hook command with the rooted one', () => {
    const shipped = fileURLToPath(new URL('../../project-template/.claude/settings.json', import.meta.url));
    const earlier = { matcher: 'Read|Write|Edit|create_file|write_file|Bash|Agent|SendMessage', hooks: [{ type: 'command', command: 'node .claude/hooks/pre-tool-use.mjs' }] };
    write(sp, { hooks: { PreToolUse: [HOST_ENTRY, earlier] } });
    mergeSettingsFile(shipped, sp, PROJECT_SETTINGS_FINGERPRINTS);
    const commands = read(sp).hooks.PreToolUse.flatMap(e => e.hooks.map(h => h.command));
    expect(commands.filter(c => c.includes('pre-tool-use.mjs'))).toEqual(['node "${CLAUDE_PROJECT_DIR:-.}/.claude/hooks/pre-tool-use.mjs"']);
    expect(read(sp).hooks.PreToolUse[0]).toEqual(HOST_ENTRY);
  });
```

- [X] [T-001-C] Red step: `npx vitest run tests/installer/templates.test.js tests/installer/settings-merge.test.js -t "gates Read and Bash|BUG-061"`. The filter selects exactly three tests. Expected:
  - `.claude/settings.json gates Read and Bash through one union matcher`: FAIL (old command).
  - `project-template/.claude/settings.json gates Read and Bash through one union matcher`: FAIL (old command).
  - `[BUG-061] AC5 replaces the cwd-relative hook command with the rooted one`: FAIL (the shipped template still carries the old command).
  - Totals: 3 failed, 0 passed.
- [X] [T-001-D] In `project-template/.claude/settings.json:9`, replace `"command": "node .claude/hooks/pre-tool-use.mjs"` with:

```json
            "command": "node \"${CLAUDE_PROJECT_DIR:-.}/.claude/hooks/pre-tool-use.mjs\""
```

- [X] [T-001-E] In `.claude/settings.json:9`, make the same replacement as T-001-D. Expected afterwards: `node -e "for (const f of ['.claude/settings.json','project-template/.claude/settings.json']) console.log(require('./'+f).hooks.PreToolUse[0].hooks[0].command)"` prints `node "${CLAUDE_PROJECT_DIR:-.}/.claude/hooks/pre-tool-use.mjs"` twice. This repository's live hook keeps working: the session cwd is the root, and the `:-.` fallback covers an unset variable.
- [X] [T-001-F] Green step: rerun the T-001-C command. Expected: 3 passed, 0 failed.
- [X] [T-001-G] Dependency check: `grep -rn "node .claude/hooks/pre-tool-use.mjs" tests lib bin project-template .claude/settings.json`. Expected hits only: the `earlier` fixtures in `settings-merge.test.js` (the AC3a test and the new AC5 test), the `TPL` and owned-entry fixtures at `settings-merge.test.js:12,108,118`, and the `PROJECT_SETTINGS` fixture at `deploy.test.js:349`. Each is a self-contained input fixture, not an assertion on the shipped string, so none changes. Any other hit is repaired inside this task.
- [X] [T-001-H] Full suite: `npm test`. Expected: passes.
- [X] [T-001-I] Stage: `git add -u project-template/.claude/settings.json .claude/settings.json tests/installer/templates.test.js tests/installer/settings-merge.test.js docs/superpowers/plans/2026-10-21-bug061-hook-project-root.md`
- [X] [T-001-J] Commit: `git commit -m "fix: anchor the PreToolUse hook command at CLAUDE_PROJECT_DIR [BUG-061]"`. Expected: the pre-commit suite passes.

### Task 2: Root the Guard 3 allowlist at the project directory (AC2, AC3, AC4, AC6)

**Files:**
- Create: `tests/hooks/hook-project-root.test.js`
- Modify: `project-template/.claude/hooks/pre-tool-use.mjs:620-628` (comment and allowlist root)
- Modify: `.claude/hooks/pre-tool-use.mjs:620-628` (identical change)
- Modify: `tests/hooks/guard3-port.test.js:28` (spawn env isolation)

**Interfaces:**
- Consumes: the registered command from Task 1, read at test time from `project-template/.claude/settings.json` (`hooks.PreToolUse[0].hooks[0].command`).
- Produces: `g3ReadAllowlist()` reads `join(process.env.CLAUDE_PROJECT_DIR || process.cwd(), '.claude', 'memory', 'bash-scan-allowlist.txt')`. Signature and return shape unchanged.

- [X] [T-002-A] Create `tests/hooks/hook-project-root.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TEMPLATE_HOOK = join(REPO_ROOT, 'project-template/.claude/hooks/pre-tool-use.mjs');
const COMMAND = JSON.parse(readFileSync(join(REPO_ROOT, 'project-template/.claude/settings.json'), 'utf8'))
  .hooks.PreToolUse[0].hooks[0].command;
const ROOTED = 'process.env.CLAUDE_PROJECT_DIR || process.cwd()';
const HAS_BASH = !spawnSync('bash', ['--version'], { stdio: 'pipe', timeout: 5000 }).error;

// The registered command is run the way Claude Code runs it, through a shell, so the
// ${CLAUDE_PROJECT_DIR:-.} expansion is under test, not just the hook. The root has a
// space in its path because Windows home directories often do. [BUG-061]
let base, root, sub;
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'cc root-'));
  root = join(base, 'my project');
  sub = join(root, 'src', 'deep');
  mkdirSync(join(root, '.claude', 'hooks'), { recursive: true });
  mkdirSync(sub, { recursive: true });
  copyFileSync(TEMPLATE_HOOK, join(root, '.claude', 'hooks', 'pre-tool-use.mjs'));
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

const writeAllowlist = (dir, entries) => {
  mkdirSync(join(dir, '.claude', 'memory'), { recursive: true });
  writeFileSync(join(dir, '.claude', 'memory', 'bash-scan-allowlist.txt'), entries.join('\n') + '\n', 'utf8');
};

// Strip every variable that could steer the hook, then set only what the test names.
function runHook({ cwd, projectDir, command = 'cat docs/*.md' }) {
  const env = { ...process.env };
  for (const k of ['CLAUDE_PROJECT_DIR', 'CC_HOOK_ALLOW', 'CC_GUARD3_WARN']) delete env[k];
  if (projectDir !== undefined) env.CLAUDE_PROJECT_DIR = projectDir;
  const r = spawnSync('bash', ['-c', COMMAND], {
    cwd, env, encoding: 'utf8', timeout: 15000,
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }),
  });
  if (r.error) throw new Error(`hook spawn failed: ${r.error.message}`);
  const out = r.stdout.trim();
  return { status: r.status, stderr: r.stderr, decision: out === '' ? null : JSON.parse(out).hookSpecificOutput };
}

describe.skipIf(!HAS_BASH)('[BUG-061] hook resolves against CLAUDE_PROJECT_DIR', () => {
  it('[BUG-061] AC2 loads the hook from a subdirectory cwd', () => {
    const r = runHook({ cwd: sub, projectDir: root });
    expect(r.stderr).not.toMatch(/MODULE_NOT_FOUND|Cannot find module/);
    expect(r.status).toBe(0);
    expect(r.decision.permissionDecision).toBe('deny');
  });

  it('[BUG-061] AC3 honours the root allowlist from a subdirectory cwd', () => {
    writeAllowlist(root, ['docs/']);
    const r = runHook({ cwd: sub, projectDir: root });
    expect(r.status).toBe(0);
    expect(r.decision).toBeNull();
  });

  it('[BUG-061] AC3 denies the same command when no root entry covers it', () => {
    writeAllowlist(root, ['src/']);
    const r = runHook({ cwd: sub, projectDir: root });
    expect(r.status).toBe(0);
    expect(r.decision.permissionDecision).toBe('deny');
    expect(r.decision.permissionDecisionReason).toMatch(/BASH SCAN BLOCKED/);
  });

  it('[BUG-061] reads the root allowlist, not one in the subdirectory cwd', () => {
    writeAllowlist(sub, ['docs/']);
    const r = runHook({ cwd: sub, projectDir: root });
    expect(r.status).toBe(0);
    expect(r.decision.permissionDecision).toBe('deny');
  });

  it('[BUG-061] AC4 falls back to cwd when CLAUDE_PROJECT_DIR is unset', () => {
    writeAllowlist(root, ['docs/']);
    const r = runHook({ cwd: root });
    expect(r.status).toBe(0);
    expect(r.decision).toBeNull();
  });
});

describe('[BUG-061] allowlist root in both hook copies', () => {
  it.each(['.claude/hooks/pre-tool-use.mjs', 'project-template/.claude/hooks/pre-tool-use.mjs'])(
    '[BUG-061] AC6 %s roots the allowlist at CLAUDE_PROJECT_DIR', (rel) => {
      const src = readFileSync(join(REPO_ROOT, rel), 'utf8');
      expect(src).toContain(`readFileSync(join(${ROOTED}, ...G3_ALLOWLIST_REL), 'utf8')`);
    });
});
```

- [X] [T-002-B] Red step: `npx vitest run tests/hooks/hook-project-root.test.js`. The file holds seven tests. Expected:
  - AC2 loads from a subdirectory cwd: PASS (Task 1's command already loads the hook).
  - AC3 honours the root allowlist: FAIL (the hook reads the subdirectory cwd, finds no allowlist, denies).
  - AC3 denies with no covering entry: PASS.
  - reads the root, not the cwd: FAIL (the cwd allowlist grants `docs/`, decision is null).
  - AC4 fallback with the variable unset: PASS.
  - AC6 `.claude/hooks/pre-tool-use.mjs`: FAIL.
  - AC6 `project-template/.claude/hooks/pre-tool-use.mjs`: FAIL.
  - Totals: 4 failed, 3 passed.
- [X] [T-002-C] In `project-template/.claude/hooks/pre-tool-use.mjs`, replace the comment block and read line of `g3ReadAllowlist` (`:620-628`) so the function opens:

```js
// Operator policy, read fresh on every invocation so a change applies without a
// session restart. Absent means an empty list, which is policy, not a fault.
// Present-but-unreadable means an empty list PLUS a debug line, because that is a
// fault worth seeing, and neither condition may throw: a permissions problem on a
// policy file must never escalate into denying every tool call in the session.
// The root is CLAUDE_PROJECT_DIR because the session's cwd drifts; cwd is only the
// fallback for a launcher that does not set it (BUG-061).
function g3ReadAllowlist() {
  let raw;
  try {
    raw = readFileSync(join(process.env.CLAUDE_PROJECT_DIR || process.cwd(), ...G3_ALLOWLIST_REL), 'utf8');
```

  Lines after the `readFileSync` call stay unchanged.
- [X] [T-002-D] Make the identical edit in `.claude/hooks/pre-tool-use.mjs`. Expected: `cmp .claude/hooks/pre-tool-use.mjs project-template/.claude/hooks/pre-tool-use.mjs` exits 0.
- [X] [T-002-E] In `tests/hooks/guard3-port.test.js`, inside `runRow`, replace `env: { ...process.env },` with `env: portEnv(),` and add this helper directly above `runRow`:

```js
// The hook roots its allowlist at CLAUDE_PROJECT_DIR when set (BUG-061). A suite run
// inside Claude Code may inherit it, which would point every row at the developer's
// own allowlist instead of the row's throwaway cwd.
const portEnv = () => {
  const env = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  return env;
};
```

  No corpus row or assertion changes.
- [X] [T-002-F] Green step: rerun the T-002-B command. Expected: 7 passed, 0 failed.
- [X] [T-002-G] AC4 isolation check: `CLAUDE_PROJECT_DIR="$PWD" npx vitest run tests/hooks/guard3-port.test.js`. Expected: passes, proving the port corpus ignores an inherited variable. This repository's `.claude/memory/bash-scan-allowlist.txt` has zero live entries today, so also confirm T-002-E is present with `grep -n "delete env.CLAUDE_PROJECT_DIR" tests/hooks/guard3-port.test.js` (one hit).
- [X] [T-002-H] Dependency check: `grep -n "process.cwd()" .claude/hooks/pre-tool-use.mjs`. Expected: two hits, `:132` (`payloadCwd`, Guard 1/2 target paths, out of scope) and the new rooted line. No other cwd read exists.
- [X] [T-002-I] AC7: `npm test`. Expected: the full suite passes, including `templates.test.js` `'ships the front door as one byte-identical mirrored pair'`.
- [X] [T-002-J] Stage: `git add -u project-template/.claude/hooks/pre-tool-use.mjs .claude/hooks/pre-tool-use.mjs tests/hooks/guard3-port.test.js docs/superpowers/plans/2026-10-21-bug061-hook-project-root.md`
- [X] [T-002-K] Stage the new test: `git add tests/hooks/hook-project-root.test.js`
- [X] [T-002-L] Commit: `git commit -m "fix: read the Guard 3 allowlist from CLAUDE_PROJECT_DIR [BUG-061]"`. Expected: the pre-commit suite passes.

The ticks for T-002-J through T-002-L are made after their commit. Only the human-owned closeout commit can carry them. This plan does not add a closeout commit.

### Task 3: Isolate the contract harness from an inherited CLAUDE_PROJECT_DIR (review finding)

Added 2026-10-21 by owner approval of the whole-branch review's finding 1. `fire()` in `tests/hooks/pre-tool-use-contract.test.js:14-22` spawns the hook with `{ ...process.env, ...env }` and `cwd: REPO_ROOT`. An inherited `CLAUDE_PROJECT_DIR` therefore points Guard 3 at another root's allowlist. A permissive entry there flips three deny assertions. Reproduced before this task: 3 failed, 17 passed.

**Files:**
- Modify: `tests/hooks/pre-tool-use-contract.test.js:14-22` (`fire` env)
- Scratch (gitignored, not staged): `tests/.tmp/bug061-permissive/.claude/memory/bash-scan-allowlist.txt`

**Interfaces:**
- Consumes: the rooted allowlist read from Task 2.
- Produces: `fire(payload, env)` strips the inherited `CLAUDE_PROJECT_DIR` before applying `env`. A caller that passes `CLAUDE_PROJECT_DIR` in `env` still sets it. No caller does today.

- [X] [T-003-A] Create `tests/.tmp/bug061-permissive/.claude/memory/bash-scan-allowlist.txt` with the single line `*.ts`. `tests/.tmp/` is gitignored.
- [X] [T-003-B] Red step: `CLAUDE_PROJECT_DIR="$PWD/tests/.tmp/bug061-permissive" npx vitest run tests/hooks/pre-tool-use-contract.test.js`. Expected:
  - `routes a Bash payload to Guard 3, which denies a mass-dump command`: FAIL.
  - `a pattern denial names the allowlist as operator policy`: FAIL.
  - `CC_GUARD3_WARN > converts Guard 3 denial into ask, carrying the same reason`: FAIL.
  - Totals: 3 failed, 17 passed.
- [X] [T-003-C] In `fire`, replace `env: { ...process.env, ...env },` with `env: { ...contractEnv(), ...env },` and add this helper directly above the comment that precedes `fire`:

```js
// The hook roots its allowlist at CLAUDE_PROJECT_DIR when set (BUG-061). A run inside
// Claude Code, or in a worktree, may inherit one that names another checkout, whose
// allowlist would then decide the Guard 3 assertions below.
const contractEnv = () => {
  const env = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  return env;
};
```

- [X] [T-003-D] Green step: rerun the T-003-B command. Expected: 20 passed, 0 failed.
- [X] [T-003-E] Dependency check: `grep -rln "pre-tool-use.mjs" tests/hooks`. For each file that spawns the hook, confirm that its spawn env strips `CLAUDE_PROJECT_DIR` or sets it explicitly: `guard3-port.test.js` (T-002-E), `hook-project-root.test.js` (T-002-A), and `pre-tool-use-contract.test.js` (this task). Any other spawner is repaired inside this task.
- [X] [T-003-F] Full suite: `npm test`. Expected: passes.
- [X] [T-003-G] Stage: `git add -u tests/hooks/pre-tool-use-contract.test.js docs/superpowers/plans/2026-10-21-bug061-hook-project-root.md`
- [X] [T-003-H] Commit: `git commit -m "test: isolate the contract harness from an inherited CLAUDE_PROJECT_DIR [BUG-061]"`. Expected: the pre-commit suite passes.

The T-002-L tick rides T-003-G. The T-003-H tick rides T-004-J.

### Task 4: Launch the hook without shell expansion (review finding 2, owner-directed)

Added 2026-10-21 at the owner's direction, which overrides the spec's Out of Scope line for Windows without Git Bash and AC1's exact string. `${CLAUDE_PROJECT_DIR:-.}` is bash syntax. Under cmd or PowerShell it stays literal, and the hook fails even from the root, where the old relative command worked. The replacement command uses no shell expansion: Node reads the variable itself.

```text
node -e "import(require('url').pathToFileURL(require('path').resolve(process.env.CLAUDE_PROJECT_DIR||'.','.claude/hooks/pre-tool-use.mjs')).href)"
```

Why it is shell-agnostic:
- There is no `$`, `%`, backtick or `^`, so bash, sh, cmd and PowerShell all pass the script unchanged.
- The `||` and the single quotes sit inside one double-quoted argument, where cmd and PowerShell treat them as literal and bash does not expand them.
- `pathToFileURL` turns a Windows `C:\...` path into a valid `import()` specifier.
- `||'.'` keeps the unset-variable fallback, which is today's behavior.

The hook runs `main()` on import and reads neither `process.argv` nor `import.meta` (grep on 2026-10-21: zero hits), so importing it from `-e` is equivalent to running it as a file. A missing script still fails visibly with `ERR_MODULE_NOT_FOUND`, rc 1, which keeps the spec's "no existence guard" rule.

Prototyped on 2026-10-21 from `tests/hooks` with `CLAUDE_PROJECT_DIR` at the root:
- Through `bash -c`, `sh -c` and a direct no-shell spawn: rc 0 and a Guard 3 deny, in each case.
- With the variable unset and the cwd at the root: rc 0 and a deny.
- With a nonexistent root: rc 1 and `ERR_MODULE_NOT_FOUND`.

PowerShell is not installed on this machine, so the no-shell spawn plus the no-expansion-syntax assertion stand in for it. A Windows PowerShell session is the owner's field check at release.

**Files:**
- Modify: `project-template/.claude/settings.json:9`, `.claude/settings.json:9`
- Modify: `tests/installer/templates.test.js:131`, `tests/installer/settings-merge.test.js` (the `[BUG-061] AC5` expected string)
- Modify: `tests/hooks/hook-project-root.test.js` (header comment, `runHook`, two new tests)

**Interfaces:**
- Consumes: `g3ReadAllowlist()` rooted at `CLAUDE_PROJECT_DIR` (Task 2); the fingerprint merge on the `pre-tool-use.mjs` substring, which the new command still contains.
- Produces: the registered command above; `INLINE = /^node -e "([^"]+)"$/` in the test file, from which the no-shell test extracts the script.

- [X] [T-004-A] In `tests/installer/templates.test.js:131`, change the expected array to ``[`node -e "import(require('url').pathToFileURL(require('path').resolve(process.env.CLAUDE_PROJECT_DIR||'.','.claude/hooks/pre-tool-use.mjs')).href)"`]``, a template literal with no `${`.
- [X] [T-004-B] In `tests/installer/settings-merge.test.js`, in the `[BUG-061] AC5` test, change the expected array of the `commands.filter(...)` assertion to the same template-literal string as T-004-A.
- [X] [T-004-C] In `tests/hooks/hook-project-root.test.js`, make three edits:
  1. Add `const INLINE = /^node -e "([^"]+)"$/;` below the `ROOTED` constant.
  2. Replace the three-line header comment above `let base, root, sub;` with:

```js
// The registered command is run the way Claude Code runs it, through a shell, and its
// inline script is also run with no shell at all, which is what cmd or PowerShell amount
// to for a command that carries no expansion syntax. The root has a space in its path
// because Windows home directories often do. [BUG-061]
```

  3. Replace `runHook` with the function below, and append the new `describe` block at the end of the file:

```js
// Strip every variable that could steer the hook, then set only what the test names.
function runHook({ cwd, projectDir, command = 'cat docs/*.md', viaShell = true }) {
  const env = { ...process.env };
  for (const k of ['CLAUDE_PROJECT_DIR', 'CC_HOOK_ALLOW', 'CC_GUARD3_WARN']) delete env[k];
  if (projectDir !== undefined) env.CLAUDE_PROJECT_DIR = projectDir;
  const [file, args] = viaShell ? ['bash', ['-c', COMMAND]] : [process.execPath, ['-e', COMMAND.match(INLINE)[1]]];
  const r = spawnSync(file, args, {
    cwd, env, encoding: 'utf8', timeout: 15000,
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }),
  });
  if (r.error) throw new Error(`hook spawn failed: ${r.error.message}`);
  const out = r.stdout.trim();
  return { status: r.status, stderr: r.stderr, decision: out === '' ? null : JSON.parse(out).hookSpecificOutput };
}
```

```js
describe('[BUG-061] command runs under any shell', () => {
  it('[BUG-061] the command carries no shell expansion syntax', () => {
    expect(COMMAND).toMatch(INLINE);
    expect(COMMAND).not.toMatch(/[$%`^]/);
  });

  // The deny half proves the hook loaded, so the allow half cannot pass on a script
  // that imported nothing.
  it('[BUG-061] the inline script roots the allowlist with no shell from a subdirectory cwd', () => {
    expect(runHook({ cwd: sub, projectDir: root, viaShell: false }).decision.permissionDecision).toBe('deny');
    writeAllowlist(root, ['docs/']);
    const r = runHook({ cwd: sub, projectDir: root, viaShell: false });
    expect(r.status).toBe(0);
    expect(r.decision).toBeNull();
  });
});
```

- [X] [T-004-D] Red step: `npx vitest run tests/installer/templates.test.js tests/installer/settings-merge.test.js tests/hooks/hook-project-root.test.js -t "gates Read and Bash|BUG-061"`. The filter selects twelve tests. Expected:
  - The two `templates.test.js` `gates Read and Bash through one union matcher` tests: FAIL (old string).
  - `[BUG-061] AC5 replaces the cwd-relative hook command with the rooted one`: FAIL (old string).
  - The seven existing `hook-project-root.test.js` tests: PASS (the bash path still runs the old command).
  - `the command carries no shell expansion syntax`: FAIL.
  - `the inline script roots the allowlist with no shell`: FAIL (`INLINE` does not match the old command).
  - Totals: 5 failed, 7 passed.
- [X] [T-004-E] In `project-template/.claude/settings.json:9`, replace the command line with `            "command": "node -e \"import(require('url').pathToFileURL(require('path').resolve(process.env.CLAUDE_PROJECT_DIR||'.','.claude/hooks/pre-tool-use.mjs')).href)\""`.
- [X] [T-004-F] Make the same replacement in `.claude/settings.json:9`. Expected afterwards: `node -e "for (const f of ['.claude/settings.json','project-template/.claude/settings.json']) console.log(require('./'+f).hooks.PreToolUse[0].hooks[0].command)"` prints the new command twice. This session's live hook keeps working, because the session cwd is the root.
- [X] [T-004-G] Green step: rerun the T-004-D command. Expected: 12 passed, 0 failed.
- [X] [T-004-H] Dependency check: `grep -rn "CLAUDE_PROJECT_DIR:-" tests lib bin project-template .claude/settings.json`. Expected: zero hits.
- [X] [T-004-I] Full suite: `npm test`. Expected: passes.
- [X] [T-004-J] Stage: `git add -u project-template/.claude/settings.json .claude/settings.json tests/installer/templates.test.js tests/installer/settings-merge.test.js tests/hooks/hook-project-root.test.js docs/superpowers/plans/2026-10-21-bug061-hook-project-root.md`
- [X] [T-004-K] Commit: `git commit -m "fix: launch the PreToolUse hook without shell expansion [BUG-061]"`. Expected: the pre-commit suite passes.

The T-004-K tick rides T-005-K.

### Task 5: Release 1.39.3 (owner-directed)

Added 2026-10-21 at the owner's direction. It overrides the spec's Out of Scope line for `VERSION`, `package.json`, `package-lock.json`, `CHANGELOG.md`, the backlog flip and the README "Known limits" removal. `docs/RELEASE-CLOSEOUT.md` step 2 requires all of these in one commit: record parity fails a `CHANGELOG` claim whose backlog heading still reads `[ ]`, and `repo-invariants.test.js:115-119` fails a flipped heading whose README Known-limits bullet remains. The release PR, merge, sync, the `project.md` closeout record and branch deletion (steps 1 and 5-10) stay with the owner.

**Files:**
- Modify: `VERSION`, `package.json:3`, `package-lock.json` (`version` and `packages[""].version`)
- Modify: `CHANGELOG.md:3` (new first entry)
- Modify: `AGENT-READABLE BACKLOG.md:1014` (heading flip and DONE bullet)
- Modify: `README.md:460` (remove the `[BUG-061]` Known-limits bullet)

**Interfaces:**
- Consumes: the merged behavior of Tasks 1-4.
- Produces: version `1.39.3` in all five gate locations.

- [X] [T-005-A] Run `npm version 1.39.3 --no-git-tag-version`. It moves `package.json` `version` plus both `package-lock.json` fields. Expected: prints `v1.39.3`.
- [X] [T-005-B] In `VERSION`, replace `1.39.2` with `1.39.3`.
- [X] [T-005-C] In `CHANGELOG.md`, insert this entry directly above `## [1.39.2] - 2026-10-20`:

```markdown
## [1.39.3] - 2026-10-21

### Fixed
- **[BUG-061]** The PreToolUse hook no longer depends on the session's working directory or on the shell that runs it. In both `settings.json` copies the command is `node -e "import(...)"`, which resolves `.claude/hooks/pre-tool-use.mjs` against `CLAUDE_PROJECT_DIR` inside Node and falls back to the working directory when the variable is unset. The command has no shell expansion syntax, so bash, Git Bash, cmd and PowerShell all run it alike. A session whose working directory had drifted from the root used to fail with a non-blocking `MODULE_NOT_FOUND` that skipped every guard. Guard 3 reads its allowlist from `CLAUDE_PROJECT_DIR` too, in both hook copies. A re-install replaces the old command in place through the existing fingerprint merge. `tests/hooks/hook-project-root.test.js` runs the registered command through `bash -c`, and its inline script with no shell, from a subdirectory of a root with a space in its path. A settings-merge test pins the in-place replacement. The port and contract suites strip an inherited `CLAUDE_PROJECT_DIR`.

```

- [X] [T-005-D] In `AGENT-READABLE BACKLOG.md:1014`, flip `### [ ] \`[BUG-061]\`` to `### [X] \`[BUG-061]\`` on the heading line only.
- [X] [T-005-E] Directly below that heading, insert one line in the `[BUG-060]` DONE style: `* **DONE, shipped as \`1.39.3\` on 2026-10-21.** The hook command is a shell-agnostic \`node -e "import(...)"\` that resolves the script against \`CLAUDE_PROJECT_DIR\` inside Node, falling back to the working directory, in both settings copies. Guard 3 reads its allowlist from \`process.env.CLAUDE_PROJECT_DIR || process.cwd()\` in both hook copies. The installer's fingerprint merge rewrites the old command in place. The recorded \`${CLAUDE_PROJECT_DIR:-.}\` fix shape was superseded after review, because it is bash-only. Spec: \`docs/superpowers/specs/2026-10-21-bug061-hook-project-root-design.md\`; plan: \`docs/superpowers/plans/2026-10-21-bug061-hook-project-root.md\`.`
- [X] [T-005-F] In `README.md`, delete the single line that starts `- **\`[BUG-061]\`, open:**` (`:460`).
- [X] [T-005-G] Version gate: `node tools/version-gate.mjs`. Expected: five `ok` lines and `VERSION_GATE_OK 1.39.3`, rc 0.
- [X] [T-005-H] Record parity: `node tools/record-parity.mjs`. Expected: `RECORD_PARITY_OK`, rc 0.
- [X] [T-005-I] Full suite: `npm test`. Expected: passes, including `repo-invariants.test.js` `'lists every open filed defect in Known limits, and only those'`.
- [X] [T-005-J] Stage: `git add -u VERSION package.json package-lock.json CHANGELOG.md "AGENT-READABLE BACKLOG.md" README.md`
- [X] [T-005-K] Stage the plan: `git add -u docs/superpowers/plans/2026-10-21-bug061-hook-project-root.md`
- [ ] [T-005-L] Commit: `git commit -m "chore: release 1.39.3 [BUG-061]"`. Expected: the pre-commit suite passes.

The T-005-L tick is made after its commit, so it rides the owner's closeout record commit.

## Test List

- [ ] Unit: `templates.test.js` exact command for both settings copies (AC1); AC6 source assertion for both hook copies.
- [ ] Integration: `settings-merge.test.js` `[BUG-061] AC5` merge over the old command; `hook-project-root.test.js` five shell-spawned cases (AC2, AC3 x2, root-over-cwd, AC4).
- [ ] E2E: none. No UI. A Windows Git Bash session with a drifted cwd is the owner's field check at release.

## Commit Order

1. Task 0: spec, plan, `.gitignore` leaf and `project.md` (docs).
2. Task 1: rooted command in both settings copies, its assertion and the AC5 merge test (fix).
3. Task 2: rooted allowlist in both hook copies, the project-root suite and the port-suite isolation (fix).
4. Task 3: contract-harness env isolation (test).
5. Task 4: shell-agnostic `node -e` launcher in both settings copies, with its tests (fix).
6. Task 5: release 1.39.3, with the five version locations, the CHANGELOG, the backlog flip and the README Known-limits removal (chore).

## Identified Risks

- **Pre-flight, happy path:** Claude Code starts the hook with `CLAUDE_PROJECT_DIR=<root>` in any cwd; bash expands the quoted path, Node loads `<root>/.claude/hooks/pre-tool-use.mjs`, and Guard 3 reads `<root>/.claude/memory/bash-scan-allowlist.txt`.
- **Pre-flight, failure points:**
  - Editing `.claude/settings.json` changes this session's live hook. The session cwd is the root and `:-.` covers an unset variable, so the guards keep running; T-001-E's next tool call is the live check.
  - Editing one hook copy without the other fails the mirrored-pair test. T-002-D runs `cmp` immediately.
  - A Windows host without Git Bash runs hook commands through a shell that does not expand `${VAR:-.}`. Out of scope by the spec; the error stays visible because no existence guard is added.
  - A test spawn that inherits `CLAUDE_PROJECT_DIR` would read the wrong allowlist. The new suite deletes it per spawn, and T-002-E does the same for the port corpus.
- **Pre-flight, boundary conditions:**
  - Root path with spaces: every new test runs under `cc root-*/my project`.
  - `CLAUDE_PROJECT_DIR` set to an empty string: `||` treats it as unset and falls back to cwd; bash's `:-` does the same for the command. Both sides agree.
  - Allowlist absent at the root: empty list, unchanged (AC2 test exercises it).
  - Allowlist present only in the drifted cwd: ignored (root-over-cwd test).
- **README `:460` Known-limits line** still describes BUG-061 as open after merge. Its removal is a release record and stays with the owner.
