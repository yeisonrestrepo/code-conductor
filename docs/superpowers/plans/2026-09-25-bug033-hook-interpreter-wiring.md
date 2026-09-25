# BUG-033 Hook Interpreter Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop every `UserPromptSubmit` from printing `python: command not found` by first correcting the shipped interpreter name, then replacing the wiring with a Node wrapper whose command the installer writes as an absolute path.

**Architecture:** Two fix commits in one patch release. Stage 1 renames `python` to `python3` in the shipped `global/settings.json` and in the test fixture, and adds the first test that ever reads the shipped asset. Stage 2 adds `global/hooks/graphify-ast-refresh.mjs` (freshness check, PATH-scan interpreter resolution, detached spawn, always exit 0), moves the command string out of the shipped asset and into `lib/installer/settings.mjs` beside `verbosityHookCommand`, and wires one call site in `bin/code-conductor.mjs`.

**Tech Stack:** Node >= 20 ESM (`node:` builtins only), vitest, the untouched Python payload `global/hooks/graphify-ast-refresh.py`.

**Spec:** `docs/superpowers/specs/2026-09-25-bug033-hook-interpreter-wiring-design.md`

## Global Constraints

- Zero runtime dependencies: the wrapper imports only `node:` builtins and adds no entry to `dependencies`.
- `global/hooks/graphify-ast-refresh.py` stays byte for byte unchanged. Replacing it is `[FEAT-021]`.
- Every wrapper path exits 0 and blocks nothing; at most one `GRAPHIFY_HOOK:` stderr line, gated behind `CC_GRAPHIFY_DEBUG` (the `CC_VERBOSITY_DEBUG` / `CC_GUARD4_DEBUG` precedent). With the variable unset the wrapper is silent on every path, internal errors included.
- The installer-written command is an absolute path with forward slashes and contains no `~`, mirroring `verbosityHookCommand` (`lib/installer/settings.mjs:17`).
- The graphify entry is agent-owned: normalization discards manual edits to it, including an env prefix. Entries this repo does not own are never touched.
- `GRAPHIFY_STALE_MINUTES` default 60, with the same non-numeric fallback as the Python payload.
- `npm test` is green at every commit. Baseline at the start of this plan: **585 passed / 12 skipped**.
- Every task edits a file before it stages it (BUG-031 rule). All plan and backlog state updates are surgical single-line edits (BUG-003).
- No em-dashes in any file this plan creates or edits.
- Commit messages end with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`; the PR description ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

---

## File Structure

| File | Responsibility |
|---|---|
| `global/settings.json` | Shipped defaults. Stage 1: `python3`. Stage 2: `permissions` only, no `hooks` key. |
| `global/hooks/graphify-ast-refresh.mjs` | New. Decides whether the toolchain exists and whether the graph is stale, then delegates. |
| `global/hooks/graphify-ast-refresh.py` | Unchanged payload. |
| `lib/installer/settings.mjs` | Command builders plus one shared merge core used by both hook writers. |
| `bin/code-conductor.mjs` | One call site beside `mergeVerbosityHook`. |
| `tests/installer/settings.test.js` | Builder, normalizer, and shipped-asset assertions. |
| `tests/installer/cli.test.js` | End-to-end: what the installed settings file actually contains. |
| `tests/hooks/graphify-refresh.test.js` | New. Stub-interpreter tests for the wrapper's four paths. |
| `README.md` | Hook description and file tree. |
| `VERSION`, `package.json`, `package-lock.json`, `CHANGELOG.md`, `AGENT-READABLE BACKLOG.md` | Release 1.27.2. |

---

### Task 0: Branch and plan commit

**Files:**
- Commit: `docs/superpowers/plans/2026-09-25-bug033-hook-interpreter-wiring.md` (force-added; `docs/` is gitignored at `.gitignore:8`)
- Commit: `.claude/memory/project.md` (already carries the BUG-033 spec summary from the spec phase)

**Interfaces:**
- Consumes: nothing.
- Produces: the working branch `fix/bug-033-hook-interpreter-wiring` with the plan tracked on it, so later tasks can commit plan-state flips.

- [X] [T-000-A] Confirm the working branch and the tree

Run:
```bash
git branch --show-current && git status --porcelain
```
Expected: `fix/bug-033-hook-interpreter-wiring`, and a status listing exactly `M .claude/memory/project.md` plus the untracked plan and spec files under `docs/`. If the branch is `main`, stop: the `/cc-plan` branch gate did not run.

- [X] [T-000-B] Stage the plan and the spec-phase memory

Run:
```bash
git add -f docs/superpowers/plans/2026-09-25-bug033-hook-interpreter-wiring.md
git add .claude/memory/project.md
git diff --cached --name-only
```
Expected: exactly two staged paths. No edit step precedes this stage because this task edits neither file; both were written in earlier phases.

- [X] [T-000-C] Commit

```bash
git commit -m "$(cat <<'EOF'
docs: add the BUG-033 hook interpreter wiring implementation plan

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 1: Stage 1, correct the shipped interpreter name

**Files:**
- Modify: `global/settings.json:18`
- Modify: `tests/installer/settings.test.js:1-10` (imports), `:27` (fixture), and append one describe block
- Test: `tests/installer/settings.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: a `describe('shipped global/settings.json')` block in `tests/installer/settings.test.js`. Task 2 rewrites its single `it` rather than adding a second block.

- [X] [T-001-A] Write the failing shipped-asset test

Add these three names to the existing imports at the top of `tests/installer/settings.test.js`. Line 4 becomes:

```js
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
```

Then append this block to the end of the file:

```js
// The first test in this suite that reads the SHIPPED asset rather than a temp
// fixture. Line 27 below is fixture input to mergeVerbosityHook, not a claim
// about what code-conductor ships, which is why the wrong interpreter shipped
// unnoticed: nothing looked at global/settings.json at all.
describe('shipped global/settings.json', () => {
  const SHIPPED = resolve(dirname(fileURLToPath(import.meta.url)), '../../global/settings.json');
  it('wires the graphify hook with python3, not the bare python macOS removed', () => {
    const o = JSON.parse(readFileSync(SHIPPED, 'utf8'));
    const cmds = o.hooks.UserPromptSubmit.flatMap(e => e.hooks.map(h => h.command));
    expect(cmds).toContain('python3 ~/.claude/hooks/graphify-ast-refresh.py');
  });
});
```

- [X] [T-001-B] Run the new test and watch it fail

Run: `npx vitest run tests/installer/settings.test.js -t 'wires the graphify hook with python3'`
Expected: 1 failed. The failure names the received array containing `python ~/.claude/hooks/graphify-ast-refresh.py`. A pass here means the asset was already edited out of order; stop and re-read `global/settings.json`.

- [X] [T-001-C] Correct the shipped command

In `global/settings.json`, change line 18 from:

```json
            "command": "python ~/.claude/hooks/graphify-ast-refresh.py"
```

to:

```json
            "command": "python3 ~/.claude/hooks/graphify-ast-refresh.py"
```

Nothing else in the file changes.

- [X] [T-001-D] Correct the test fixture

In `tests/installer/settings.test.js`, line 27, change the fixture command from `'python ~/.claude/hooks/graphify-ast-refresh.py'` to `'python3 ~/.claude/hooks/graphify-ast-refresh.py'`. The surrounding assertions are unchanged: that test asserts `mergeVerbosityHook` preserves a graphify entry, and it must not pin a command string the project no longer ships.

- [X] [T-001-E] Run the full suite

Run: `npm test`
Expected: **586 passed / 12 skipped** (585 plus the new shipped-asset test).

- [X] [T-001-F] Stage both files

```bash
git add global/settings.json tests/installer/settings.test.js
git diff --cached --name-only
```
Expected: exactly two staged paths. This step follows T-001-C and T-001-D, the only steps in this commit group that edit those files.

- [X] [T-001-G] Commit

```bash
git commit -m "$(cat <<'EOF'
fix: name python3 in the shipped hook command [BUG-033]

Apple removed the bare `python` shim in macOS 12.3, so the shipped
UserPromptSubmit wiring printed `python: command not found` on every prompt.
The test fixture pinned the same wrong string; it now names the corrected
command, and a new test reads the shipped asset directly, which nothing did
before.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Stage 2, the Node wrapper and installer-owned command

**Files:**
- Create: `global/hooks/graphify-ast-refresh.mjs`
- Create: `tests/hooks/graphify-refresh.test.js`
- Modify: `lib/installer/settings.mjs:4` (fingerprints), `:17-24` (add the second builder), `:53-88` (extract the shared merge core)
- Modify: `global/settings.json` (remove the graphify entry)
- Modify: `bin/code-conductor.mjs:7` (import), `:98` (call site)
- Modify: `tests/installer/settings.test.js` (two new describes, shipped-asset assertion flipped)
- Modify: `tests/installer/cli.test.js` (one end-to-end assertion)
- Modify: `README.md:175-177`, `:279`

**Interfaces:**
- Consumes: the `describe('shipped global/settings.json')` block from Task 1.
- Produces:
  - `graphifyHookCommand(home: string) => string` returning `node <abs>/.claude/hooks/graphify-ast-refresh.mjs` with forward slashes.
  - `mergeGraphifyHook(settingsPath: string, hookCmd: string, now?: Date) => { status: 'merged' | 'idempotent-skip' | 'malformed-skipped' }`.
  - `mergeVerbosityHook` keeps its exact signature and behavior; only its body moves into the shared core.

- [X] [T-002-A] Write the wrapper test file

Create `tests/hooks/graphify-refresh.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, utimesSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const WRAPPER = join(REPO_ROOT, 'global', 'hooks', 'graphify-ast-refresh.mjs');

// The stub interpreter is a POSIX shell script: it records its argv and exits 1,
// so one file proves both that it ran and that a failing child never reaches the
// hook's own exit code. Shebangs do not execute on Windows, so the stub-based
// cases skip there. The two empty-PATH cases need no stub and always run.
const POSIX = process.platform !== 'win32';

let dir, pathDir, marker;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cc-graphify-'));
  pathDir = join(dir, 'bin');
  mkdirSync(pathDir);
  marker = join(dir, 'stub-ran.txt');
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

function writeStub(name = 'python3') {
  const p = join(pathDir, name);
  writeFileSync(p, `#!/bin/sh\necho "$@" >> "${marker}"\nexit 1\n`);
  chmodSync(p, 0o755);
  return p;
}

function writeSentinel(ageMinutes) {
  const outDir = join(dir, 'graphify-out');
  mkdirSync(outDir, { recursive: true });
  const sentinel = join(outDir, '.graphify_ast_done');
  writeFileSync(sentinel, '');
  const when = new Date(Date.now() - ageMinutes * 60000);
  utimesSync(sentinel, when, when);
}

// PATH is REPLACED, never appended to: the machine running this suite very
// likely has a real python3, and a test that asserts "no interpreter" has to
// mean it. node itself is reached through process.execPath, an absolute path.
function runHook(env = {}) {
  return spawnSync(process.execPath, [WRAPPER], {
    cwd: dir,
    encoding: 'utf8',
    env: { PATH: pathDir, ...env },
  });
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// The child is detached and unref'd, so the hook returns before it has run.
function waitForMarker(ms = 3000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (existsSync(marker)) return true;
    sleepSync(25);
  }
  return existsSync(marker);
}

describe('graphify-ast-refresh.mjs', () => {
  it('exits 0 and prints nothing when no interpreter is on PATH', () => {
    const r = runHook();
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('');
  });

  it('writes exactly one GRAPHIFY_HOOK line under CC_GRAPHIFY_DEBUG and still exits 0', () => {
    const r = runHook({ CC_GRAPHIFY_DEBUG: '1' });
    expect(r.status).toBe(0);
    expect(r.stderr.trimEnd().split('\n')).toHaveLength(1);
    expect(r.stderr.startsWith('GRAPHIFY_HOOK: ')).toBe(true);
  });

  it.skipIf(!POSIX)('short-circuits on a fresh sentinel without resolving an interpreter', () => {
    writeStub();
    writeSentinel(1);
    const r = runHook();
    expect(r.status).toBe(0);
    sleepSync(400);
    expect(existsSync(marker)).toBe(false);
  });

  it.skipIf(!POSIX)('spawns the interpreter once with the payload path when the sentinel is stale', () => {
    writeStub();
    writeSentinel(90);
    const r = runHook();
    expect(r.status).toBe(0);
    expect(waitForMarker()).toBe(true);
    sleepSync(200);
    const lines = readFileSync(marker, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0].trim()).toMatch(/graphify-ast-refresh\.py$/);
  });

  it.skipIf(!POSIX)('honors GRAPHIFY_STALE_MINUTES and falls back to 60 on a non-numeric value', () => {
    writeStub();
    writeSentinel(90);
    expect(runHook({ GRAPHIFY_STALE_MINUTES: '120' }).status).toBe(0);
    sleepSync(400);
    expect(existsSync(marker)).toBe(false);
    expect(runHook({ GRAPHIFY_STALE_MINUTES: 'later' }).status).toBe(0);
    expect(waitForMarker()).toBe(true);
  });

  it.skipIf(!POSIX)('falls through to the PATH scan when GRAPHIFY_PYTHON is not an executable file', () => {
    writeStub();
    const r = runHook({ GRAPHIFY_PYTHON: join(dir, 'nope', 'python3') });
    expect(r.status).toBe(0);
    expect(waitForMarker()).toBe(true);
    expect(readFileSync(marker, 'utf8')).toMatch(/graphify-ast-refresh\.py/);
  });
});
```

- [X] [T-002-B] Run the wrapper tests and watch them fail

Run: `npx vitest run tests/hooks/graphify-refresh.test.js`
Expected: **6 failed**, every one on `expect(r.status).toBe(0)` receiving `1`, because `node` cannot find the module. If a test passes here, the wrapper already exists; stop and inspect `global/hooks/`.

- [X] [T-002-C] Create the wrapper

Create `global/hooks/graphify-ast-refresh.mjs`:

```js
#!/usr/bin/env node
// UserPromptSubmit hook: Node wrapper over the Python AST-refresh payload.
//
// Node hosts the decision because Python is the thing being probed: a Python
// script cannot report that Python is missing. Every path exits 0 and prints
// nothing unless CC_GRAPHIFY_DEBUG is set (the CC_VERBOSITY_DEBUG and
// CC_GUARD4_DEBUG precedent), so a machine without the toolchain is silent.

import { statSync, accessSync, constants } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK_DIR = dirname(fileURLToPath(import.meta.url));
const PAYLOAD = join(HOOK_DIR, 'graphify-ast-refresh.py');

function debug(msg) {
  if (process.env.CC_GRAPHIFY_DEBUG) process.stderr.write(`GRAPHIFY_HOOK: ${msg}\n`);
}

// Mirrors the payload's int(os.environ.get("GRAPHIFY_STALE_MINUTES", "60")) and
// its ValueError fallback. Python's int() accepts surrounding whitespace and a
// sign and rejects everything else, while parseInt would read "120abc" as 120;
// the regex keeps the two readers of this variable in agreement.
function staleMinutes() {
  const raw = process.env.GRAPHIFY_STALE_MINUTES;
  if (typeof raw !== 'string' || !/^\s*[+-]?\d+\s*$/.test(raw)) return 60;
  return Number.parseInt(raw, 10);
}

function isFresh(cwd) {
  try {
    const { mtimeMs } = statSync(join(cwd, 'graphify-out', '.graphify_ast_done'));
    return (Date.now() - mtimeMs) / 60000 < staleMinutes();
  } catch {
    return false; // absent or unreadable sentinel counts as stale
  }
}

function isExecutableFile(candidate) {
  try {
    if (!statSync(candidate).isFile()) return false;
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// A PATH scan, never an execution: starting an interpreter to learn whether an
// interpreter exists is the cost this hook is meant to avoid, and it is the
// reason no negative cache is needed.
function resolveInterpreter() {
  const override = process.env.GRAPHIFY_PYTHON;
  if (override && isExecutableFile(override)) return override;
  const exts = process.platform === 'win32' ? ['.exe', '.bat', '.cmd'] : [''];
  const dirs = (process.env.PATH || '').split(delimiter).filter(Boolean);
  for (const name of ['python3', 'python']) {
    for (const dir of dirs) {
      for (const ext of exts) {
        const candidate = join(dir, `${name}${ext}`);
        if (isExecutableFile(candidate)) return candidate;
      }
    }
  }
  return null;
}

function main() {
  const cwd = process.cwd();
  if (isFresh(cwd)) return;
  const python = resolveInterpreter();
  if (!python) {
    debug('no python3 or python on PATH; graph refresh skipped');
    return;
  }
  // Detached with stdio ignored and unref'd: the child's exit status can never
  // surface as a hook error, which is what keeps the `import graphify` guard in
  // the payload where it already lives.
  const child = spawn(python, [PAYLOAD], { cwd, detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', (e) => debug(`spawn failed: ${e.message}`));
  child.unref();
}

// No explicit process.exit: the unref'd child holds nothing open, so the default
// exit code 0 stands, and the deferred 'error' event above still gets to fire.
try {
  main();
} catch (e) {
  debug(`unexpected: ${e && e.message}`);
}
```

- [X] [T-002-D] Run the wrapper tests and watch them pass

Run: `npx vitest run tests/hooks/graphify-refresh.test.js`
Expected: **6 passed** on macOS and Linux (4 skipped, 2 passed on Windows).

- [X] [T-002-E] Write the installer tests and flip the shipped-asset assertion

In `tests/installer/settings.test.js`, extend the import on line 5 to:

```js
import { verbosityHookCommand, mergeVerbosityHook, graphifyHookCommand, mergeGraphifyHook, pruneMalformedBackups, utcStamp, pruneBackups } from '../../lib/installer/settings.mjs';
```

Add this constant beside `CMD` on line 8:

```js
const GRAPHIFY_CMD = 'node /h/.claude/hooks/graphify-ast-refresh.mjs';
```

Append these two describe blocks:

```js
describe('graphifyHookCommand', () => {
  it('builds the node hook command from home', () => {
    expect(graphifyHookCommand('/h')).toBe(GRAPHIFY_CMD);
  });
  // A hook `command` with no `args` runs under PowerShell on a Windows host that
  // has no Git Bash, and PowerShell does not expand a bare `~/...` passed to an
  // external program. The installer therefore writes an absolute path, always.
  it('uses forward slashes and no tilde for a Windows-style home', () => {
    const cmd = graphifyHookCommand('C:\\Users\\a');
    expect(cmd).toBe('node C:/Users/a/.claude/hooks/graphify-ast-refresh.mjs');
    expect(cmd).not.toContain('\\');
    expect(cmd).not.toContain('~');
  });
});

describe('mergeGraphifyHook', () => {
  const OTHER = { matcher: '', hooks: [{ type: 'command', command: 'bash /existing/hook.sh' }] };

  it('rewrites a legacy python tilde entry to the canonical node command', () => {
    writeFileSync(sp, JSON.stringify({ hooks: { UserPromptSubmit: [
      { matcher: '', hooks: [{ type: 'command', command: 'python ~/.claude/hooks/graphify-ast-refresh.py' }] }
    ] } }));
    expect(mergeGraphifyHook(sp, GRAPHIFY_CMD).status).toBe('merged');
    const arr = JSON.parse(readFileSync(sp, 'utf8')).hooks.UserPromptSubmit;
    expect(arr).toHaveLength(1);
    expect(arr[0].hooks[0].command).toBe(GRAPHIFY_CMD);
  });

  // The graphify entry is agent-owned: tuning belongs in the environment both the
  // wrapper and the payload read, not in a command string the installer rewrites.
  it('discards a manual env prefix on the entry it owns', () => {
    writeFileSync(sp, JSON.stringify({ hooks: { UserPromptSubmit: [
      { matcher: '', hooks: [{ type: 'command', command: 'GRAPHIFY_STALE_MINUTES=120 python3 ~/.claude/hooks/graphify-ast-refresh.py' }] }
    ] } }));
    mergeGraphifyHook(sp, GRAPHIFY_CMD);
    const arr = JSON.parse(readFileSync(sp, 'utf8')).hooks.UserPromptSubmit;
    expect(arr).toHaveLength(1);
    expect(arr[0].hooks[0].command).toBe(GRAPHIFY_CMD);
  });

  it('leaves an entry it does not own byte for byte', () => {
    writeFileSync(sp, JSON.stringify({ hooks: { UserPromptSubmit: [OTHER] } }));
    mergeGraphifyHook(sp, GRAPHIFY_CMD);
    const arr = JSON.parse(readFileSync(sp, 'utf8')).hooks.UserPromptSubmit;
    expect(arr).toHaveLength(2);
    expect(arr[0]).toEqual(OTHER);
    expect(arr[1].hooks[0].command).toBe(GRAPHIFY_CMD);
  });

  it('is idempotent - a second run changes the file not at all', () => {
    writeFileSync(sp, '{}');
    mergeGraphifyHook(sp, GRAPHIFY_CMD);
    const first = readFileSync(sp, 'utf8');
    expect(mergeGraphifyHook(sp, GRAPHIFY_CMD).status).toBe('idempotent-skip');
    expect(readFileSync(sp, 'utf8')).toBe(first);
  });

  it('coexists with the verbosity writer - each owns one entry', () => {
    writeFileSync(sp, '{}');
    mergeVerbosityHook(sp, CMD);
    mergeGraphifyHook(sp, GRAPHIFY_CMD);
    const arr = JSON.parse(readFileSync(sp, 'utf8')).hooks.UserPromptSubmit;
    expect(arr.filter(e => e.hooks.some(h => h.command === CMD))).toHaveLength(1);
    expect(arr.filter(e => e.hooks.some(h => h.command === GRAPHIFY_CMD))).toHaveLength(1);
  });
});
```

Then replace the whole `it` inside the `describe('shipped global/settings.json')` block added in Task 1 with:

```js
  // After 1.27.2 the shipped asset carries no graphify entry at all, exactly as
  // it has never carried the verbosity one: a file that cannot know the host's
  // home cannot hold an absolute path, and a `~` path is what BUG-033 was. Any
  // reappearance here means one leaked back in.
  it('carries no graphify hook entry - the installer owns that command', () => {
    const raw = readFileSync(SHIPPED, 'utf8');
    expect(raw).not.toContain('graphify-ast-refresh');
    const o = JSON.parse(raw);
    expect(o.hooks?.UserPromptSubmit ?? []).toEqual([]);
  });
```

- [X] [T-002-F] Run the settings suite and watch it fail

Run: `npx vitest run tests/installer/settings.test.js`
Expected: the file fails to collect, with `does not provide an export named 'graphifyHookCommand'`. A collection error, not an assertion failure, is the correct red state here because the import is at module scope.

- [X] [T-002-G] Add the builder and the shared merge core

In `lib/installer/settings.mjs`, add a second fingerprint beside line 4:

```js
const FINGERPRINT = 'verbosity-remind.sh';
const GRAPHIFY_FINGERPRINT = 'graphify-ast-refresh';
```

Add the second builder immediately after `verbosityHookCommand` (after line 24):

```js
export function graphifyHookCommand(home) {
  // Same absolute-path rule as verbosityHookCommand, for a second reason: a hook
  // `command` with no `args` runs under PowerShell on a Windows host without Git
  // Bash, and PowerShell does not expand a bare `~/...` passed to an external
  // program. The installer is the only party that knows the host's home, so the
  // shipped settings.json carries no graphify entry at all.
  const hookPath = join(home, '.claude', 'hooks', 'graphify-ast-refresh.mjs').replace(/\\/g, '/');
  return `node ${hookPath}`;
}
```

Then replace the `export function mergeVerbosityHook(...)` declaration at line 53 with the shared core and two thin wrappers. The body is moved verbatim except for the single `FINGERPRINT` reference, which becomes the `fingerprint` parameter:

```js
// One merge serves both hooks: same malformed-file handling, same idempotency
// rule, same canonical two-space write. `fingerprint` is the substring naming
// the entry this repo OWNS. Every entry matching it is replaced by hookCmd, so
// manual edits to an owned entry are discarded by design; every entry that does
// not match is left exactly as it was.
function mergeHook(settingsPath, hookCmd, fingerprint, now) {
  // A missing settings.json (ENOENT) is not an error: initialize a fresh, empty
  // config object and let the merge create the file. The existsSync check plus
  // the ENOENT catch guard against both the plain-missing case and a TOCTOU
  // delete between the check and the read.
  let raw = '{}';
  if (existsSync(settingsPath)) {
    try { raw = readFileSync(settingsPath, 'utf8'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  // A zero-byte or whitespace-only file is NOT malformed - it is an uninitialized
  // config. Treat it as an empty object and merge. Only genuine non-empty invalid
  // JSON triggers a backup.
  if (raw.trim() === '') raw = '{}';
  let obj;
  try { obj = JSON.parse(raw); } catch { backupMalformed(settingsPath, now); return { status: 'malformed-skipped' }; }
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    backupMalformed(settingsPath, now);
    return { status: 'malformed-skipped' };
  }
  if (typeof obj.hooks !== 'object' || obj.hooks === null || Array.isArray(obj.hooks)) obj.hooks = {};
  let arr = Array.isArray(obj.hooks.UserPromptSubmit) ? obj.hooks.UserPromptSubmit : [];

  if (arr.some(e => entryHasCommand(e, h => h.command === hookCmd))) return { status: 'idempotent-skip' };

  arr = arr.filter(e => !entryHasCommand(e, h => typeof h.command === 'string' && h.command.includes(fingerprint)));
  arr.push({ matcher: '', hooks: [{ type: 'command', command: hookCmd }] });
  obj.hooks.UserPromptSubmit = arr;
  // Enforce 2-space indentation (matches the bundled settings.json) rather than
  // detecting the user's indent width - one canonical format keeps diffs stable
  // and the merge deterministic. The `+ '\n'` appends the single trailing newline
  // POSIX text files expect. Explicit utf8 encoding.
  writeFileSync(settingsPath, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  return { status: 'merged' };
}

export function mergeVerbosityHook(settingsPath, hookCmd, now = new Date()) {
  return mergeHook(settingsPath, hookCmd, FINGERPRINT, now);
}

export function mergeGraphifyHook(settingsPath, hookCmd, now = new Date()) {
  return mergeHook(settingsPath, hookCmd, GRAPHIFY_FINGERPRINT, now);
}
```

- [X] [T-002-H] Remove the graphify entry from the shipped asset

Replace the entire contents of `global/settings.json` with:

```json
{
  "permissions": {
    "allow": [
      "Bash(grep:*)",
      "Bash(find:*)",
      "Bash(ls:*)",
      "Bash(cat:*)"
    ],
    "deny": []
  }
}
```

The `hooks` key goes away entirely. `mergeHook` already handles a settings file with no `hooks` key, which the `'{}'` cases in the suite cover.

- [X] [T-002-I] Run the settings suite and watch it pass

Run: `npx vitest run tests/installer/settings.test.js`
Expected: **22 passed** (14 before this release, plus 1 from Task 1, plus 7 here).

- [X] [T-002-J] Wire the call site

In `bin/code-conductor.mjs`, line 7 becomes:

```js
import { verbosityHookCommand, mergeVerbosityHook, graphifyHookCommand, mergeGraphifyHook } from '../lib/installer/settings.mjs';
```

And immediately after the existing `mergeVerbosityHook(...)` call at line 98, add:

```js
    mergeGraphifyHook(join(claudeDir, 'settings.json'), graphifyHookCommand(home));
```

Order matters only in that both run after `deployGlobal`, which force-copies the shipped `settings.json` over the host's.

- [X] [T-002-K] Assert what the installer actually writes

In `tests/installer/cli.test.js`, add this test immediately after the existing `it('registers the verbosity hook idempotently across two runs', ...)` block:

```js
  it('writes the graphify hook as an absolute node command with no tilde', () => {
    run([], { HOME: home }, { cwd, log });
    const s = JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8'));
    const graphify = s.hooks.UserPromptSubmit
      .flatMap(e => e.hooks.map(h => h.command))
      .filter(c => c.includes('graphify-ast-refresh'));
    expect(graphify).toHaveLength(1);
    expect(graphify[0]).toBe(`node ${join(home, '.claude', 'hooks', 'graphify-ast-refresh.mjs').replace(/\\/g, '/')}`);
    expect(graphify[0]).not.toContain('~');
  });
```

- [X] [T-002-L] Run the full suite

Run: `npm test`
Expected: **600 passed / 12 skipped** (586 after Task 1, plus 6 wrapper tests, plus 7 settings tests, plus 1 CLI test).

- [X] [T-002-M] Update the README

Replace the paragraph at `README.md:175` and the sentence at `:177` with:

```markdown
Fires on every `UserPromptSubmit`. A small Node wrapper (`graphify-ast-refresh.mjs`) checks whether `graphify-out/.graphify_ast_done` is fresh (default: 60 min, override with `GRAPHIFY_STALE_MINUTES`). If it is stale or missing, the wrapper looks for a `python3` or `python` on `PATH` (override with `GRAPHIFY_PYTHON`) and spawns the Python payload (`graphify-ast-refresh.py`) in the background to run file detection and AST extraction - no LLM calls, no tokens. The main session inherits a ready graph without paying the generation cost.

Node hosts the check because Python is what is being probed: on a machine with no Python the wrapper exits 0 in silence rather than printing an interpreter error on every prompt. Set `CC_GRAPHIFY_DEBUG=1` to see the one line it would otherwise swallow. Works on Windows, Linux, and macOS, and returns immediately when the graph is current.
```

Then replace the file tree line at `README.md:279` with these two lines, preserving the existing box-drawing prefix width:

```
│   │   ├── graphify-ast-refresh.mjs Node wrapper: freshness + interpreter check
│   │   └── graphify-ast-refresh.py  Background AST refresh on UserPromptSubmit
```

- [X] [T-002-N] Stage the eight changed paths

```bash
git add global/hooks/graphify-ast-refresh.mjs global/settings.json \
        lib/installer/settings.mjs bin/code-conductor.mjs \
        tests/hooks/graphify-refresh.test.js tests/installer/settings.test.js \
        tests/installer/cli.test.js README.md
git diff --cached --name-only
```
Expected: exactly eight staged paths. This step follows every edit step in this commit group (T-002-A, C, E, G, H, J, K, M).

- [X] [T-002-O] Commit

```bash
git commit -m "$(cat <<'EOF'
fix: wire the graph refresh hook through a Node wrapper [BUG-033]

Renaming the interpreter moved the failure rather than removing it: a machine
with no Python at all still printed `python3: command not found`. The wrapper
decides before executing anything - sentinel freshness first, then a PATH scan
for an interpreter - and exits 0 in silence when the toolchain is absent.

The command moves out of the shipped settings.json and into the installer,
mirroring verbosityHookCommand: a hook command without `args` runs under
PowerShell on a Windows host with no Git Bash, and PowerShell does not expand a
bare `~/...` passed to an external program, so the shipped tilde path was
already broken there for a second, independent reason.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Release 1.27.2

**Files:**
- Modify: `VERSION`, `package.json`, `package-lock.json`, `CHANGELOG.md`, `AGENT-READABLE BACKLOG.md:246`

**Interfaces:**
- Consumes: Tasks 1 and 2, both committed.
- Produces: the release commit and the pull request.

- [X] [T-003-A] Bump `VERSION`

Replace the sole line of `VERSION` with `1.27.2`.

- [X] [T-003-B] Bump the manifest and the lockfile together

Run: `npm version 1.27.2 --no-git-tag-version`
Expected: `v1.27.2` on stdout, and `git status --porcelain` shows `package.json` and `package-lock.json` modified. This edits both lockfile `"version": "1.27.1"` occurrences (root and `packages[""]`) in one step, which a hand edit routinely misses.

- [X] [T-003-C] Add the changelog entry

Insert this section into `CHANGELOG.md` immediately after the `# Changelog` heading and before `## [1.27.1] - 2026-09-25`:

```markdown
## [1.27.2] - 2026-09-25

### Fixed

- **[BUG-033]** The `UserPromptSubmit` graph refresh hook was wired as `python ~/.claude/hooks/graphify-ast-refresh.py`, but the script's own shebang is `python3` and Apple removed the bare `python` shim in macOS 12.3, so every single prompt printed `python: command not found`. Nothing was functionally lost, which is the worst version of this bug: it trains a developer to ignore hook output, and that is how a real hook failure gets missed. The interpreter name is corrected, and the wiring is now a zero-dependency Node wrapper (`global/hooks/graphify-ast-refresh.mjs`) that checks the sentinel's freshness first, then scans `PATH` for `python3` or `python` (override with `GRAPHIFY_PYTHON`) without executing anything, and exits 0 in silence when no interpreter exists. `CC_GRAPHIFY_DEBUG=1` reveals the single line it otherwise swallows. The command string moved out of the shipped `settings.json` and into the installer as an absolute forward-slash path, mirroring the verbosity hook: a hook command without `args` runs under PowerShell on a Windows host with no Git Bash, and PowerShell does not expand a bare `~/...` passed to an external program. The Python payload is unchanged. A new test reads the shipped `global/settings.json` directly, which nothing did before, which is why the wrong interpreter shipped unnoticed.

Existing installations: re-run the installer to apply.
```

- [X] [T-003-D] Flip the backlog entry

In `AGENT-READABLE BACKLOG.md`, line 246, change the single leading checkbox from `### [ ]` to `### [X]`, leaving the rest of the heading byte for byte identical:

```markdown
### [X] `[BUG-033]` UserPromptSubmit Hook Is Launched With a `python` That Modern macOS Does Not Have
```

This is a surgical single-line edit (BUG-003). Do not rewrite the entry's body.

- [X] [T-003-E] Run the full suite one last time

Run: `npm test`
Expected: **600 passed / 12 skipped**, unchanged from T-002-L.

- [X] [T-003-F] Stage the five release paths

```bash
git add VERSION package.json package-lock.json CHANGELOG.md "AGENT-READABLE BACKLOG.md"
git diff --cached --name-only
```
Expected: exactly five staged paths. This step follows T-003-A through T-003-D, every edit step in this commit group.

- [X] [T-003-G] Commit

```bash
git commit -m "$(cat <<'EOF'
chore: release 1.27.2 [BUG-033]

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [X] [T-003-H] Push and open the pull request

```bash
git push -u origin fix/bug-033-hook-interpreter-wiring
```

Then open the PR with title `fix: wire the graph refresh hook through a Node wrapper [BUG-033]`, a body summarizing the two stages, the verification evidence (test counts at each commit), and the `🤖 Generated with [Claude Code](https://claude.com/claude-code)` trailer.

---

## Test List

- [ ] Unit tests for `graphifyHookCommand` (POSIX home, Windows-style home, no `~`)
- [ ] Unit tests for `mergeGraphifyHook` (legacy tilde entry rewritten, env prefix discarded, unowned entry preserved, idempotent, coexists with the verbosity writer)
- [ ] Unit tests for the wrapper (no interpreter, debug line, fresh sentinel short-circuit, stale sentinel spawn, `GRAPHIFY_STALE_MINUTES`, unusable `GRAPHIFY_PYTHON`)
- [ ] Integration test at the shipped-asset seam: `global/settings.json` read directly, asserted in both stage states
- [ ] Integration test at the installer seam: `tests/installer/cli.test.js` asserts what a real install writes into `~/.claude/settings.json`
- [ ] No E2E test: there is no UI.

## Commit Order

1. **T-000**: `docs: add the BUG-033 hook interpreter wiring implementation plan`
2. **T-001**: `fix: name python3 in the shipped hook command [BUG-033]` (2 files)
3. **T-002**: `fix: wire the graph refresh hook through a Node wrapper [BUG-033]` (8 files)
4. **T-003**: `chore: release 1.27.2 [BUG-033]` (5 files)

Each fix commit leaves the suite green, so the history stays bisectable and stage 1 alone is a shippable improvement if stage 2 is ever reverted.

## Identified Risks

| Risk | How it is caught early |
|---|---|
| The `mergeVerbosityHook` extraction changes verbosity behavior. | The 8 existing `mergeVerbosityHook` tests are untouched and must stay green at T-002-I. The wrapper delegates with the same `FINGERPRINT`, and only one identifier in the moved body changes. |
| The normalizer eats an entry the repo does not own. | The fingerprint is `graphify-ast-refresh`, a filename no unrelated hook carries. T-002-E's "leaves an entry it does not own byte for byte" test uses `toEqual` on the whole entry object, not a substring check. |
| The wrapper's detached child makes a test flaky. | `waitForMarker` polls to a 3s deadline rather than sleeping a fixed interval, and the negative assertions sleep 400ms before asserting absence. The stub exits 1 on purpose, so a child whose failure leaked into the parent's exit code would fail `expect(r.status).toBe(0)` loudly. |
| A real `python3` on the test machine defeats the "no interpreter" cases. | `runHook` replaces `PATH` wholesale with an empty temp dir; it never appends. `node` is reached through `process.execPath`, which is absolute. |
| The freshness window drifts from the payload's. | T-002-A's `GRAPHIFY_STALE_MINUTES` test asserts both the honored value and the non-numeric fallback to 60, and the wrapper's regex deliberately mirrors Python's `int()` acceptance rather than `parseInt`'s. |
| Coverage thresholds (`lib/installer/**` at 90% lines, 80% branches) fail on the new installer code. | Every branch of `graphifyHookCommand` and `mergeGraphifyHook` is exercised by T-002-E's 7 tests; the shared core's branches keep their existing coverage. |
| A user re-runs the installer as the changelog instructs and loses their own `~/.claude/settings.json` customizations. | Pre-existing and out of scope here: `deployGlobal` force-copies the shipped `settings.json` over the host's (`lib/installer/deploy.mjs:110`), so `mergeGraphifyHook`'s "leaves unowned entries byte for byte" guarantee holds in unit tests and not on a real install. Filed as `[BUG-035]` with its own terms; not folded into this release. |
