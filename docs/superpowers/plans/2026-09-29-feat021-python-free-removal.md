# FEAT-021 Python-Free Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the graph rung and every line of Python from code-conductor. An installer heal removes the stale hook entry and the hook files from hosts that already have them.

**Architecture:** A new `lib/installer/heal.mjs` owns three pieces: the fingerprint unmerge, the content-match sweep, and a heal boundary that never throws. `bin/code-conductor.mjs` calls it where it used to call `mergeGraphifyHook`. Every other change is deletion or text: the hook files, the graphify merge, Guard 4's `graphify-out` component, and the graph rung in both CLAUDE.md templates, the repo's own CLAUDE.md, memory-first, `/cc-init` and the README.

**Tech Stack:** Node >= 20, ESM, `node:` builtins only; vitest.

**Spec:** `docs/superpowers/specs/2026-09-29-feat021-python-free-removal-design.md` (APPROVED 2026-09-29, R1 + R2)

## Plan-time measurements

Both were taken before any task was drafted, as the approval required. They are recorded here because the tasks are written against them.

### M1: `deployGlobal` merges `settings.json`, so D1's ordering is LOAD-BEARING

Read `lib/installer/deploy.mjs:95-115`, `lib/installer/host-owned.mjs:18-58` and `lib/installer/settings-merge.mjs:68-118`:

- `cpSync(globalDir, target, { filter: hostOwnedFilter(globalDir, GLOBAL_HOST_OWNED) })` never copies `settings.json`, because `GLOBAL_HOST_OWNED` maps it to `'merge'`, which excludes it from the copy.
- Next comes `mergeSettingsFile(template, target, GLOBAL_SETTINGS_FINGERPRINTS)`. `GLOBAL_SETTINGS_FINGERPRINTS` is `[]`, and `global/settings.json` has no `hooks` key. The hook-tree merge runs only when `Object.keys(tplHooks).length > 0`, so on an existing valid file it writes nothing into `hooks`.

**Consequence.** The spec cited the BUG-033 plan's claim that deploy force-copies `settings.json`. That claim is stale: BUG-039 replaced the force-copy with the filter and merge. A host's `graphify-ast-refresh` entry therefore **survives `deployGlobal` verbatim on every upgrade**, and the heal is the only thing that ever removes it. This is the spec's load-bearing world, which is why the order below is fixed:

1. unmerge first;
2. sweep only on `removed | absent`.

Sweeping a file the live entry still references would turn a silent hook into a Claude Code hook error on every prompt. The heal tests assert this world.

**Second consequence, which diverges from the spec's CLI matrix line.** `mergeSettingsFile` handles a **malformed** host `settings.json` itself: it calls `backupMalformed` and writes the template in its place (`'malformed-replaced'`), and it does this inside `deployGlobal`, which runs before the heal. So in `run()` the heal **never sees a malformed file**. It sees the template: valid, with no graphify entry. It returns `absent` and the sweep runs.

That is safe. The live file references nothing, and only the backup still names the hook. But it contradicts the spec's line "malformed settings: backup written, both files kept, exit 0" read at the CLI level. This plan therefore asserts:

- **Unit level (`healGraphifyHook` given a malformed file):** the spec's contract holds exactly. The result is `malformed-skipped`, both files are kept, and one line is emitted. The heal is guarded against a malformed file on its own terms, which is the defense in depth.
- **CLI level (`run()`):** the measured world. `deployGlobal` writes the malformed backup, the live settings is the template, the sweep runs, and the exit code is 0. The test is named for M1 so nobody reads it as a regression.

**This needs the owner's ruling at plan approval** (see *Approval points*).

### M2: no published tarball ever shipped CRLF in either hook file

The command was a scratchpad Node script. It iterates `npm view @yeison.restrepo.r/code-conductor versions`, fetches each `dist.tarball`, extracts both hook paths with `tar -xzOf`, and counts `0x0D` bytes and the SHA-256. It covered all 14 published versions, 1.23.0 through 1.33.0:

| Versions | `.py` | `.mjs` |
|---|---|---|
| 1.23.0 - 1.24.1 (5) | `cr=0`, `761199f1650b…` | absent |
| 1.30.0 - 1.33.0 (9) | `cr=0`, `761199f1650b…` | `cr=0`, `c78e4e5e6989…` |

Every npm-installed copy is byte-identical to the one shipped constant, and **no CRLF variant exists in the registry**. The hash table needs no CRLF entry.

**Residual (out of scope, fails safe):** `.gitattributes` covers only `*.sh` and `*.ps1`. A host that installed from a **Windows git clone with `core.autocrlf=true`** could hold CRLF copies. Such a file mismatches, is kept, and is named, which is the designed fail-safe. It is a clone-path install that is not npm-native. The CHANGELOG's "kept and named" sentence covers it.

## Approval points (ruled 2026-09-29: all four APPROVED)

Rulings: (1) approved, with the backup-restore residual recorded in *Identified Risks*; (2) approved on condition that a repo invariant pins the **exact** allowed set (Task 4); (3) approved, recorded as a spec gap below; (4) approved as specified. Execution: **native**, an explicit per-plan exception to the recorded subagent-driven preference, recorded in the task report.

**Spec gap the plan closed:** the spec's CLAUDE.md AC list missed Operational Philosophy's "query the graph before reading" in both CLAUDE.md files; same class as the amendment's scope, closed in Task 4.

**Second spec gap the branch closed (end-of-branch review, fix commit after `d513061`):** `project-template/.claude/commands/cc-debug.md:14` told the agent to delegate a "graph query"; it now says "grep", and the surface invariant also scans `scripts/` and `.claude/settings.json`. Same class as the Operational Philosophy line.

**Allowed-set measurement (2026-09-29, `git grep -l python3` over tracked non-record files):** the spec named `scripts/detect-stack.mjs` as an out-of-scope `python3` site, but it carries no `python3` literal (it detects Python from manifests: `uv.lock`, `pyproject.toml`, `Pipfile`). `tests/hooks/guard4.test.js:100` carries one in a historical comment, reworded in Task 3. The exact set pinned is therefore `tests/fixtures/guard3-corpus.js` and `tests/installer/heal.test.js`, and the Task 2 CLI fixture uses the original `python` pre-wrapper form so it adds no member.

1. **M1's malformed-file divergence** from the spec's CLI matrix line, as asserted above. The alternative would move the heal ahead of `deployGlobal`. Rejected: the spec's AC places it after the deploy, and a pre-deploy heal would see settings the deploy is about to rewrite.
2. **The `python3` grep AC allow-list gains one file:** `tests/installer/heal.test.js`. Its pre-wrapper fixture is the literal command `python3 ~/.claude/hooks/graphify-ast-refresh.py`, which is heal input data of the same class as `tests/fixtures/guard3-corpus.js:320-321`. The heal cannot be tested against the real specimen without it.
3. **One CLAUDE.md line the spec's AC list omits:** Operational Philosophy's "query the graph before reading" (`CLAUDE.md:53`, `project-template/CLAUDE.md:54`) loses its graph clause ("search before opening; never ingest what can be looked up"). It points at the removed tool and falls under the spec's Problem item 2. It is included in Task 4.
4. **One stdout notice** when the heal removes an entry: `code-conductor: removed the retired graphify-ast-refresh hook from settings.json (backup written beside it)`. The spec's happy path allows "no heal output beyond what it removed". A second run prints nothing.

## Global Constraints

- `package.json` `dependencies` stays `{}` (there is no `dependencies` key today; none is added). Only `node:` builtins.
- Every heal path is fail-open. A heal throw never changes `run()`'s exit code.
- Mirror parity:
  - `.claude/hooks/pre-tool-use.mjs` stays byte-identical to `project-template/.claude/hooks/pre-tool-use.mjs` (measured `cmp` identical at plan time).
  - Both `cc-init.md` mirrors receive identical edits, and `tests/installer/commands-parity.test.js` stays green.
- Root `CLAUDE.md` and `project-template/CLAUDE.md` change in the same commit.
- Release is `1.34.0` per `docs/RELEASE-CLOSEOUT.md`: `VERSION_GATE_OK 1.34.0`, `RECORD_PARITY_OK`, with `[FEAT-021]` at `[X]`.
- Staging:
  - tracked file → `git add -u <path>`;
  - deletion → `git rm <path>`;
  - new file outside ignored surfaces → `git add <path>`;
  - never bare `git add -u`.
- BUG-003: backlog and plan-state edits are single-line surgical edits.
- Shipped hashes, verbatim:
  - `.py` @`968dc6f` `761199f1650b9a38273ce04b91fffdc8dcd5f73bd9adad957b7bbc1c3e9a800b`
  - `.mjs` @`5b4a1af` `c78e4e5e6989731f8a8ef60e7039c0b17b8e5feaa8ac30ee595441c215282e36`

## Test totals, predicted per boundary (local macOS, not root)

Baseline at `fcd5c6a`: **996 passed / 12 skipped**.

| After | Delta | Predicted |
|---|---|---|
| Task 1 | `heal.test.js` +17 | 1013 / 12 |
| Task 2 | `settings.test.js` -7, `cli.test.js` -1 +4, `graphify-refresh.test.js` -6, `repo-invariants` +1 | 1004 / 12 |
| Task 3 | `guard4.test.js` +2, `pre-tool-use-contract.test.js` +1 | 1007 / 12 |
| Task 4 | `repo-invariants` +2 | 1009 / 12 |
| Task 5 | none | 1009 / 12 |

In CI (ubuntu, `actions/checkout@v4` depth 1) the hash pin skips, so CI reads 1008 / 13. A difference from the prediction is reported at the boundary where it appears, never absorbed.

## Review Focus

1. **A shared `UserPromptSubmit` entry** (a graphify hook beside the host's own hooks). Only the graphify hook goes, the siblings keep their order, and the entry survives. Pinned by Task 1, test 3.
2. **The settings file is a directory, unreadable, or otherwise throws.** The heal reports one line and returns, the sweep does not run, and the install still exits 0. Pinned by Task 1, test 16.
3. **A read-only `~/.claude/hooks`.** Each undeletable file is named and the next one is still attempted. Pinned by Task 1, test 10 (POSIX, non-root).
4. **A graphify command under a different event** (`Stop`, `PreToolUse`) is never touched. Pinned by Task 1, test 7.
5. **Upgrade through the real CLI with a malformed settings file** (M1's world). Pinned by Task 2, CLI test `M1: …`.

---

### Task 0: Commit this plan

**Files:**
- Modify: `.gitignore` (one leaf after line 91)
- Create: `docs/superpowers/plans/2026-09-29-feat021-python-free-removal.md`

- [X] [T-000-A] Insert `!/docs/superpowers/plans/2026-09-29-feat021-python-free-removal.md` into `.gitignore` directly after the line `!/docs/superpowers/plans/2026-09-29-bug047-heredoc-body-scanning.md` (sorted position; `tests/unit/gitignore-block-parity.test.js` checks it).
- [X] [T-000-B] Stage: `git add -u .gitignore && git add docs/superpowers/plans/2026-09-29-feat021-python-free-removal.md` (plain `add` works once the leaf exists; expect rc 0).
- [X] [T-000-C] Commit: `git commit -m "docs: add the FEAT-021 python-free removal implementation plan"` with the Co-Authored-By trailer. The pre-commit hook runs the full suite; expect 996 / 12.

---

### Task 1: The heal module

**Files:**
- Create: `lib/installer/heal.mjs`
- Test: `tests/installer/heal.test.js`

**Interfaces:**
- Consumes:
  - `backupMalformed(settingsPath, now)` and `utcStamp` via `lib/installer/settings.mjs`;
  - `resolveRealTarget(p)`, `backupFile(realPath, now)` and `writeAtomic(realPath, text)` from `lib/installer/file-merge.mjs`.
- Produces:
  - `GRAPHIFY_FINGERPRINT: 'graphify-ast-refresh'`
  - `SHIPPED_GRAPHIFY_HASHES: Map<string, string>` (basename → sha256 hex)
  - `unmergeGraphifyHook(settingsPath: string, now?: Date): 'removed' | 'absent' | 'malformed-skipped'`, which throws on unreadable input
  - `sweepGraphifyHooks(hooksDir: string, shipped?: Map): string[]`, returning one human line per file kept or failed
  - `healGraphifyHook(home: string, { shipped?, now? }?): { status: 'removed' | 'absent' | 'malformed-skipped' | 'error', lines: string[] }`, which never throws

- [X] [T-001-A] Write the failing test file `tests/installer/heal.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { unmergeGraphifyHook, sweepGraphifyHooks, healGraphifyHook, SHIPPED_GRAPHIFY_HASHES } from '../../lib/installer/heal.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PY = 'graphify-ast-refresh.py';
const MJS = 'graphify-ast-refresh.mjs';
const sha = (s) => createHash('sha256').update(s).digest('hex');
// The shipped bytes left the tree with FEAT-021, so the sweep runs against a table
// naming stand-in bodies. The pin at the bottom is what ties the real table to history.
const PY_BODY = '# stand-in for the shipped payload\n';
const MJS_BODY = '// stand-in for the shipped wrapper\n';
const SHIPPED = new Map([[PY, sha(PY_BODY)], [MJS, sha(MJS_BODY)]]);
// The live specimen on the developer machine: the pre-wrapper generation, hand-edited
// to python3 as the BUG-033 stopgap. Heal input data, not a Python dependency.
const PRE_WRAPPER = 'python3 ~/.claude/hooks/graphify-ast-refresh.py';
const WRAPPER = 'node /h/.claude/hooks/graphify-ast-refresh.mjs';
const entry = (command) => ({ matcher: '', hooks: [{ type: 'command', command }] });
const VERBOSITY = entry('bash /h/.claude/hooks/verbosity-remind.sh');
const POSIX_NON_ROOT = process.platform !== 'win32' && process.getuid?.() !== 0;

let home, claude, hooks, sp;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'cc-heal-'));
  claude = join(home, '.claude');
  hooks = join(claude, 'hooks');
  sp = join(claude, 'settings.json');
  mkdirSync(hooks, { recursive: true });
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const writeSettings = (o) => writeFileSync(sp, typeof o === 'string' ? o : `${JSON.stringify(o, null, 2)}\n`);
const readSettings = () => JSON.parse(readFileSync(sp, 'utf8'));
const backups = (suffix) => readdirSync(claude).filter((n) => n.startsWith(`settings.json${suffix}`));
const plant = (name, body) => writeFileSync(join(hooks, name), body);
const heal = () => healGraphifyHook(home, { shipped: SHIPPED });

describe('unmergeGraphifyHook', () => {
  it('removes a pre-wrapper python3 entry and backs the file up first', () => {
    writeSettings({ hooks: { UserPromptSubmit: [entry(PRE_WRAPPER)] } });
    const before = readFileSync(sp, 'utf8');
    expect(unmergeGraphifyHook(sp)).toBe('removed');
    expect(readSettings().hooks.UserPromptSubmit).toEqual([]);
    const b = backups('.installer-backup.');
    expect(b).toHaveLength(1);
    expect(readFileSync(join(claude, b[0]), 'utf8')).toBe(before);
  });

  it('removes a wrapper node entry', () => {
    writeSettings({ hooks: { UserPromptSubmit: [entry(WRAPPER)] } });
    expect(unmergeGraphifyHook(sp)).toBe('removed');
    expect(readSettings().hooks.UserPromptSubmit).toEqual([]);
  });

  // Settled at spec approval: hooks sharing an entry with ours were never ours.
  it('removes only the graphify hook from a shared entry and keeps every other entry in order', () => {
    const mine = { type: 'command', command: 'bash /x/mine.sh' };
    const also = { type: 'command', command: 'bash /x/also.sh' };
    const shared = { matcher: '', hooks: [mine, { type: 'command', command: WRAPPER }, also] };
    const tail = entry('bash /x/tail.sh');
    const stop = entry('bash /x/stop.sh');
    writeSettings({ model: 'x', hooks: { UserPromptSubmit: [VERBOSITY, shared, tail], Stop: [stop] } });
    expect(unmergeGraphifyHook(sp)).toBe('removed');
    const s = readSettings();
    expect(s.hooks.UserPromptSubmit).toEqual([VERBOSITY, { matcher: '', hooks: [mine, also] }, tail]);
    expect(s.hooks.Stop).toEqual([stop]);
    expect(s.model).toBe('x');
  });

  it('returns absent with no settings file and creates none', () => {
    expect(unmergeGraphifyHook(sp)).toBe('absent');
    expect(existsSync(sp)).toBe(false);
  });

  it('returns absent and writes nothing when no entry matches', () => {
    writeSettings({ hooks: { UserPromptSubmit: [VERBOSITY] } });
    const before = readFileSync(sp, 'utf8');
    expect(unmergeGraphifyHook(sp)).toBe('absent');
    expect(readFileSync(sp, 'utf8')).toBe(before);
    expect(backups('.installer-backup.')).toEqual([]);
  });

  it('backs up a malformed file, leaves it as it was and reports malformed-skipped', () => {
    writeSettings('{ not json');
    expect(unmergeGraphifyHook(sp)).toBe('malformed-skipped');
    expect(readFileSync(sp, 'utf8')).toBe('{ not json');
    expect(backups('.malformed-backup.')).toHaveLength(1);
  });

  it('leaves a graphify command under another event alone', () => {
    writeSettings({ hooks: { Stop: [entry(WRAPPER)] } });
    expect(unmergeGraphifyHook(sp)).toBe('absent');
    expect(readSettings().hooks.Stop).toEqual([entry(WRAPPER)]);
  });
});

describe('sweepGraphifyHooks', () => {
  it('deletes each file whose content is the shipped version', () => {
    plant(PY, PY_BODY);
    plant(MJS, MJS_BODY);
    expect(sweepGraphifyHooks(hooks, SHIPPED)).toEqual([]);
    expect(existsSync(join(hooks, PY))).toBe(false);
    expect(existsSync(join(hooks, MJS))).toBe(false);
  });

  it('keeps a modified file and names it', () => {
    plant(PY, `${PY_BODY}# edited\n`);
    const lines = sweepGraphifyHooks(hooks, SHIPPED);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/kept .*graphify-ast-refresh\.py \(modified since install\)/);
    expect(existsSync(join(hooks, PY))).toBe(true);
  });

  it.skipIf(!POSIX_NON_ROOT)('names each file it could not delete and keeps going', () => {
    plant(PY, PY_BODY);
    plant(MJS, MJS_BODY);
    chmodSync(hooks, 0o555);
    let lines;
    try { lines = sweepGraphifyHooks(hooks, SHIPPED); } finally { chmodSync(hooks, 0o755); }
    expect(lines).toHaveLength(2);
    for (const l of lines) expect(l).toMatch(/could not remove .*graphify-ast-refresh/);
  });
});

describe('healGraphifyHook', () => {
  it('pre-wrapper entry plus its matching file: entry removed, file deleted, nothing to report', () => {
    writeSettings({ hooks: { UserPromptSubmit: [VERBOSITY, entry(PRE_WRAPPER)] } });
    plant(PY, PY_BODY);
    expect(heal()).toEqual({ status: 'removed', lines: [] });
    expect(readSettings().hooks.UserPromptSubmit).toEqual([VERBOSITY]);
    expect(existsSync(join(hooks, PY))).toBe(false);
  });

  it('wrapper entry plus both matching files: both deleted', () => {
    writeSettings({ hooks: { UserPromptSubmit: [entry(WRAPPER)] } });
    plant(PY, PY_BODY);
    plant(MJS, MJS_BODY);
    expect(heal()).toEqual({ status: 'removed', lines: [] });
    expect(readdirSync(hooks)).toEqual([]);
  });

  it('malformed settings: both files kept and one line says why', () => {
    writeSettings('{ not json');
    plant(PY, PY_BODY);
    plant(MJS, MJS_BODY);
    const r = heal();
    expect(r.status).toBe('malformed-skipped');
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatch(/malformed/);
    expect(existsSync(join(hooks, PY))).toBe(true);
    expect(existsSync(join(hooks, MJS))).toBe(true);
  });

  it('no settings file: the sweep still runs', () => {
    plant(PY, PY_BODY);
    expect(heal()).toEqual({ status: 'absent', lines: [] });
    expect(existsSync(join(hooks, PY))).toBe(false);
  });

  it('a second run reports nothing and changes nothing', () => {
    writeSettings({ hooks: { UserPromptSubmit: [entry(WRAPPER)] } });
    plant(PY, PY_BODY);
    plant(MJS, MJS_BODY);
    heal();
    const snap = () => ({ s: readFileSync(sp, 'utf8'), claude: readdirSync(claude).sort(), hooks: readdirSync(hooks).sort() });
    const first = snap();
    expect(heal()).toEqual({ status: 'absent', lines: [] });
    expect(snap()).toEqual(first);
  });

  it('an unexpected failure is reported as one line and never thrown', () => {
    mkdirSync(sp);
    plant(PY, PY_BODY);
    let r;
    expect(() => { r = heal(); }).not.toThrow();
    expect(r.status).toBe('error');
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatch(/graphify cleanup skipped/);
    expect(existsSync(join(hooks, PY))).toBe(true);
  });
});

// A local instrument, not a merge gate. actions/checkout@v4 fetches depth 1, so CI has
// neither commit, and the npm tarball ships no tests. fetch-depth: 0 was declined for
// the id ceiling on the same grounds (docs/RELEASE-CLOSEOUT.md, step 8). A skip here
// means the history is absent, never that the hashes were verified.
const PIN = [[PY, '968dc6f'], [MJS, '5b4a1af']];
const haveHistory = PIN.every(([, c]) => spawnSync('git', ['cat-file', '-e', `${c}^{commit}`], { cwd: ROOT }).status === 0);
describe('SHIPPED_GRAPHIFY_HASHES', () => {
  it.skipIf(!haveHistory)('pins each shipped hash to its blob (skips on a shallow clone: CI depth 1, id-ceiling ruling)', () => {
    for (const [name, commit] of PIN) {
      const blob = spawnSync('git', ['show', `${commit}:global/hooks/${name}`], { cwd: ROOT }).stdout;
      expect(sha(blob)).toBe(SHIPPED_GRAPHIFY_HASHES.get(name));
    }
  });
});
```

- [X] [T-001-B] Run `npx vitest run tests/installer/heal.test.js`. Expect FAIL: `lib/installer/heal.mjs` cannot be resolved.
- [X] [T-001-C] Create `lib/installer/heal.mjs`:

```js
import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { backupMalformed } from './settings.mjs';
import { resolveRealTarget, backupFile, writeAtomic } from './file-merge.mjs';

// FEAT-021 retired the graph rung. Deleting the hook from the package deletes nothing
// from hosts, because deployGlobal copies and never removes, and it merges settings.json
// without touching `hooks` (plan M1). This module is the only thing that ever removes
// what earlier releases installed. It follows the BUG-020 purge (remove what we put
// there) and the 1.24.0 flat-skill sweep (remove only on an exact content match).
export const GRAPHIFY_FINGERPRINT = 'graphify-ast-refresh';

// Each file shipped exactly one version (.py @968dc6f, .mjs @5b4a1af), and no published
// tarball carries a CRLF copy (plan M2). The files are gone from the tree, so these
// constants are the only surviving record; tests/installer/heal.test.js pins them.
export const SHIPPED_GRAPHIFY_HASHES = new Map([
  ['graphify-ast-refresh.py', '761199f1650b9a38273ce04b91fffdc8dcd5f73bd9adad957b7bbc1c3e9a800b'],
  ['graphify-ast-refresh.mjs', 'c78e4e5e6989731f8a8ef60e7039c0b17b8e5feaa8ac30ee595441c215282e36'],
]);

const isGraphifyHook = (h) => h && typeof h.command === 'string' && h.command.includes(GRAPHIFY_FINGERPRINT);

// Hooks sharing an entry with ours were never ours: remove only the matching hook and
// drop the entry only when that empties it. Returns null when nothing matched.
function pruneEntries(entries) {
  let changed = false;
  const out = [];
  for (const entry of entries) {
    if (!entry || !Array.isArray(entry.hooks) || !entry.hooks.some(isGraphifyHook)) { out.push(entry); continue; }
    changed = true;
    const kept = entry.hooks.filter((h) => !isGraphifyHook(h));
    if (kept.length > 0) out.push({ ...entry, hooks: kept });
  }
  return changed ? out : null;
}

// UserPromptSubmit only: no release ever wrote the hook under another event.
export function unmergeGraphifyHook(settingsPath, now = new Date()) {
  const target = resolveRealTarget(settingsPath);
  if (!target.exists) return 'absent';
  const raw = readFileSync(target.realPath, 'utf8');
  if (raw.trim() === '') return 'absent';
  let obj;
  try { obj = JSON.parse(raw); } catch { obj = undefined; }
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    backupMalformed(target.realPath, now);
    return 'malformed-skipped';
  }
  const entries = obj.hooks?.UserPromptSubmit;
  if (!Array.isArray(entries)) return 'absent';
  const pruned = pruneEntries(entries);
  if (!pruned) return 'absent';
  backupFile(target.realPath, now);
  obj.hooks.UserPromptSubmit = pruned;
  writeAtomic(target.realPath, `${JSON.stringify(obj, null, 2)}\n`);
  return 'removed';
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

// An unreadable file counts as modified: keeping it is the safe side of the match.
function sweepOne(path, shippedHash) {
  if (!existsSync(path)) return null;
  let hash = null;
  try { hash = sha256(path); } catch { /* treated as modified below */ }
  if (hash !== shippedHash) return `kept ${path} (modified since install); it is no longer used and can be deleted`;
  try { unlinkSync(path); return null; }
  catch (e) { return `could not remove ${path} (${e.code ?? e.message}); it is no longer used and can be deleted`; }
}

export function sweepGraphifyHooks(hooksDir, shipped = SHIPPED_GRAPHIFY_HASHES) {
  const lines = [];
  for (const [name, hash] of shipped) {
    const line = sweepOne(join(hooksDir, name), hash);
    if (line) lines.push(line);
  }
  return lines;
}

// Cleanup of our own leftovers, not deployment, so it is the one deliberate exception to
// run()'s mid-copy failure policy: every failure becomes a line and none escapes. The
// files go only after the entry is gone (or was never there), because deleting a file a
// live entry still names turns a silent hook into an error on every prompt.
export function healGraphifyHook(home, { shipped = SHIPPED_GRAPHIFY_HASHES, now = new Date() } = {}) {
  const claudeDir = join(home, '.claude');
  try {
    const status = unmergeGraphifyHook(join(claudeDir, 'settings.json'), now);
    if (status === 'malformed-skipped') {
      return { status, lines: ['left the graphify-ast-refresh hook files in place: settings.json is malformed and may still reference them'] };
    }
    return { status, lines: sweepGraphifyHooks(join(claudeDir, 'hooks'), shipped) };
  } catch (e) {
    return { status: 'error', lines: [`graphify cleanup skipped: ${e.message}`] };
  }
}
```

- [X] [T-001-D] Run `npx vitest run tests/installer/heal.test.js`. Expect 17 passed (the pin runs locally).
- [X] [T-001-E] Run `npm test`. Expect **1013 passed / 12 skipped**.
- [X] [T-001-F] Stage: `git add lib/installer/heal.mjs tests/installer/heal.test.js`.
- [X] [T-001-G] Commit: `git commit -m "feat: add the graphify heal, unmerge before a content-match sweep [FEAT-021]"`.

---

### Task 2: Replace the graphify merge with the heal and delete the hook

**Files:**
- Delete:
  - `global/hooks/graphify-ast-refresh.py`
  - `global/hooks/graphify-ast-refresh.mjs`
  - `tests/hooks/graphify-refresh.test.js`
  - `tests/verbosity-hook-test.sh`
- Modify:
  - `lib/installer/settings.mjs:5,27-35,110-112`
  - `bin/code-conductor.mjs:7,98`
  - `tests/installer/settings.test.js:6,9,27-36,144-209`
  - `tests/installer/cli.test.js:34-43`
  - `tests/tools/repo-invariants.test.js`

**Interfaces:**
- Consumes: `healGraphifyHook(home)` from Task 1.
- Produces: `run()` emits one `stdout` notice on `removed`, and each heal line on `stderr` prefixed `code-conductor: `. Its exit code is unchanged.

- [X] [T-002-A] In `tests/installer/cli.test.js`, replace the test `'writes the graphify hook as an absolute node command with no tilde'` (lines 34-43) with these four tests. Add `readdirSync` to the `node:fs` import on line 2.

```js
  const graphifyCommands = () => {
    const s = JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8'));
    return (s.hooks?.UserPromptSubmit ?? []).flatMap(e => e.hooks.map(h => h.command)).filter(c => c.includes('graphify-ast-refresh'));
  };
  it('installs no graphify hook and deploys no graphify file', () => {
    expect(run([], { HOME: home }, { cwd, log })).toBe(0);
    expect(graphifyCommands()).toEqual([]);
    expect(readdirSync(join(home, '.claude', 'hooks')).filter(n => n.includes('graphify'))).toEqual([]);
  });
  it('removes a pre-wrapper graphify entry on upgrade and names a modified hook file it keeps', () => {
    mkdirSync(join(home, '.claude', 'hooks'), { recursive: true });
    writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({ hooks: { UserPromptSubmit: [
      { matcher: '', hooks: [{ type: 'command', command: 'python ~/.claude/hooks/graphify-ast-refresh.py' }] },
    ] } }));
    writeFileSync(join(home, '.claude', 'hooks', 'graphify-ast-refresh.py'), '# edited by hand\n');
    expect(run([], { HOME: home }, { cwd, log })).toBe(0);
    expect(graphifyCommands()).toEqual([]);
    expect(existsSync(join(home, '.claude', 'hooks', 'graphify-ast-refresh.py'))).toBe(true);
    expect(logs.some(l => l.startsWith('stdout:') && l.includes('removed the retired graphify-ast-refresh hook'))).toBe(true);
    expect(logs.some(l => l.startsWith('stderr:') && l.includes('kept') && l.includes('graphify-ast-refresh.py'))).toBe(true);
  });
  // Plan M1: deployGlobal's settings merge replaces a malformed file with the template
  // (backup beside it) BEFORE the heal runs, so the heal sees no entry and sweeps. The
  // heal's own malformed-skipped branch is pinned in heal.test.js, not reachable here.
  it('M1: a malformed settings.json is replaced by deploy before the heal, so the heal sweeps', () => {
    mkdirSync(join(home, '.claude', 'hooks'), { recursive: true });
    writeFileSync(join(home, '.claude', 'settings.json'), '{ not json');
    writeFileSync(join(home, '.claude', 'hooks', 'graphify-ast-refresh.mjs'), '// edited by hand\n');
    expect(run([], { HOME: home }, { cwd, log })).toBe(0);
    expect(readdirSync(join(home, '.claude')).some(n => n.startsWith('settings.json.malformed-backup.'))).toBe(true);
    expect(graphifyCommands()).toEqual([]);
    expect(logs.some(l => l.includes('kept') && l.includes('graphify-ast-refresh.mjs'))).toBe(true);
    expect(logs.some(l => l.includes('settings.json is malformed'))).toBe(false);
  });
  it('a second run emits nothing about graphify', () => {
    run([], { HOME: home }, { cwd, log });
    logs = [];
    expect(run([], { HOME: home }, { cwd, log })).toBe(0);
    expect(logs.filter(l => l.includes('graphify'))).toEqual([]);
  });
```

- [X] [T-002-B] In `tests/installer/settings.test.js`:
  - line 6: drop `graphifyHookCommand, mergeGraphifyHook` from the import;
  - line 9: delete the `GRAPHIFY_CMD` constant;
  - lines 27-36: rename the test to `'adds the hook beside an entry it does not own (fresh install)'`, change the fixture command to `'bash /other/hook.sh'` and the last assertion to `h.command === 'bash /other/hook.sh'`;
  - delete from `describe('graphifyHookCommand'` (line 144) through end of file (line 209), plus the one blank line before it.
- [X] [T-002-C] Append to the `describe('this repository, at every commit'` block in `tests/tools/repo-invariants.test.js`, and add `import { execFileSync } from 'node:child_process';` to its imports:

```js
  // FEAT-021: the package's defining constraints are zero dependencies and npm-native
  // distribution, and the graph hook was the only Python in it.
  it('tracks no Python file', () => {
    expect(execFileSync('git', ['ls-files', '*.py'], { cwd: ROOT, encoding: 'utf8' }).trim()).toBe('');
  });
```

- [X] [T-002-D] Run `npx vitest run tests/installer/cli.test.js tests/tools/repo-invariants.test.js`. Expect FAIL on `'installs no graphify hook…'`, `'removes a pre-wrapper…'` (no stdout notice), `'M1: …'` and `'tracks no Python file'`.
- [X] [T-002-E] `lib/installer/settings.mjs`: delete line 5 (`GRAPHIFY_FINGERPRINT`), the `graphifyHookCommand` function (lines 27-35) and `mergeGraphifyHook` (lines 110-112). Change the `mergeHook` comment "One merge serves both hooks" to "One merge serves the verbosity hook".
- [X] [T-002-F] `bin/code-conductor.mjs`:
  - line 7 becomes `import { verbosityHookCommand, mergeVerbosityHook } from '../lib/installer/settings.mjs';`;
  - add `import { healGraphifyHook } from '../lib/installer/heal.mjs';` after it;
  - replace line 98 (`mergeGraphifyHook(...)`) with:

```js
    // Never throws and never changes the exit code: see healGraphifyHook.
    const heal = healGraphifyHook(home);
    if (heal.status === 'removed') emit('stdout', 'code-conductor: removed the retired graphify-ast-refresh hook from settings.json (backup written beside it)');
    for (const line of heal.lines) emit('stderr', `code-conductor: ${line}`);
```

- [X] [T-002-G] Delete the four files: `git rm global/hooks/graphify-ast-refresh.py global/hooks/graphify-ast-refresh.mjs tests/hooks/graphify-refresh.test.js tests/verbosity-hook-test.sh`.
- [X] [T-002-H] Run `git grep -n "mergeGraphifyHook\|graphifyHookCommand\|GRAPHIFY_FINGERPRINT" -- lib bin tests`. Expect only `lib/installer/heal.mjs` (`GRAPHIFY_FINGERPRINT`) lines.
- [X] [T-002-I] Run `npm test`. Expect **1004 passed / 12 skipped**.
- [X] [T-002-J] Stage: `git add -u lib/installer/settings.mjs bin/code-conductor.mjs tests/installer/settings.test.js tests/installer/cli.test.js tests/tools/repo-invariants.test.js` (the deletions are already staged by `git rm`).
- [X] [T-002-K] Commit: `git commit -m "feat: replace the graphify merge with the heal and delete the Python hook [FEAT-021]"`.

---

### Task 3: Guard 4 keeps `node_modules` only; Guard 1 drops the graph step

**Files:**
- Modify:
  - `.claude/hooks/pre-tool-use.mjs:11,56-68,84`
  - `project-template/.claude/hooks/pre-tool-use.mjs` (identical)
  - `tests/hooks/guard4.test.js`
  - `tests/hooks/pre-tool-use-contract.test.js:49-50,164-165,184,216`

- [X] [T-003-A] `tests/hooks/guard4.test.js`: change the `describe` title to `'Guard 4 — Read blocker for node_modules/'`, and rewrite the rows so the normalization coverage survives on `node_modules`:
  - row1 `node_modules/pkg/package.json` blocked;
  - row2 `node_modules/.cache/ast/abc.json` blocked;
  - row4 `/abs/path/node_modules/file.json` blocked;
  - row5 `node_modules\\cache\\file.json` blocked;
  - row6 `Node_Modules/pkg/index.js` blocked;
  - row8 `node_modules/../src/main.js` allowed;
  - row9 `node_modules/` blocked;
  - row10 `'  node_modules/pkg/index.js'` blocked;
  - row11 `node_modules-backup/file.json` allowed;
  - row12 `src/utils/node_modules-helper.js` allowed;
  - rows 16 and 17: `node_modules/pkg/index.js`;
  - the row15 comment: `node_modules/`;
  - the row16 comment (line 100): `Was "fail-open when python3 absent"` becomes `Was "fail-open when no Python interpreter was on PATH"` (keeps the exact python3 allowed set at two files).

  Update each `it` title to match its path. Change the header comment "These 17 cases" to "These 19 cases", adding "rows 18 and 19 are FEAT-021's flip". Append:

```js
  // FLIPPED at FEAT-021. The graph rung is gone, so graphify-out/ is an ordinary
  // directory; Guard 1 still covers an unbounded read of a large file inside it.
  it('row18: allows graphify-out/graph.json', () => {
    expectAllowed(runRead('graphify-out/graph.json'))
  })
  it('row19: the deny message names no graph tool', () => {
    const r = runRead('node_modules/pkg/index.js')
    expectBlocked(r)
    expect(r.decision.permissionDecisionReason).not.toMatch(/graphify/i)
  })
```

- [X] [T-003-B] `tests/hooks/pre-tool-use-contract.test.js`:
  - replace `graphify-out/graph.json` with `node_modules/pkg/index.js` at lines 50, 165, 184 and 216;
  - retitle line 49 to `'denies a node_modules read and still exits 0'` and line 164 to `'CC_HOOK_ALLOW=1 still denies a well-formed node_modules read'`;
  - add after the first test:

```js
  it('Guard 1 names no graph step in its lookup chain', () => {
    const r = fire(readPayload(writeLines('big.txt', 200)));
    expect(r.decision.permissionDecision).toBe('deny');
    expect(r.decision.permissionDecisionReason).toMatch(/Guard 1/);
    expect(r.decision.permissionDecisionReason).not.toMatch(/graph/i);
  });
```

- [X] [T-003-C] Run `npx vitest run tests/hooks/guard4.test.js tests/hooks/pre-tool-use-contract.test.js`. Expect FAIL on row18, row19 and the Guard 1 case.
- [X] [T-003-D] Edit `.claude/hooks/pre-tool-use.mjs`:
  - line 11: `const BLOCKED_COMPONENTS = new Set(['node_modules']);`
  - line 56: the comment reads `// Guard 4: reads of node_modules/ (BUG-017; graphify-out/ left the set at FEAT-021). Runs before Guard 1 for`
  - lines 66-67: the message is `'Guard 4: direct reads of node_modules/ are forbidden. Use Glob for existence checks.'`
  - line 84: the lookup text is `'1. Check .claude/memory/project.md  2. Use Grep/Glob for pattern searches  ' +` and line 85 is `'3. Read with explicit offset + limit.'`
- [X] [T-003-E] Mirror: `cp .claude/hooks/pre-tool-use.mjs project-template/.claude/hooks/pre-tool-use.mjs`, then `cmp` the two files. Expect no output, rc 0.
- [X] [T-003-F] Run `npm test`. Expect **1007 passed / 12 skipped**.
- [X] [T-003-G] Stage: `git add -u .claude/hooks/pre-tool-use.mjs project-template/.claude/hooks/pre-tool-use.mjs tests/hooks/guard4.test.js tests/hooks/pre-tool-use-contract.test.js`.
- [X] [T-003-H] Commit: `git commit -m "feat: drop graphify-out from Guard 4 and the graph step from Guard 1 [FEAT-021]"`.

---

### Task 4: Remove the graph rung from every instruction surface

**Files:**
- Modify:
  - `global/CLAUDE.md:27-31`
  - `project-template/CLAUDE.md:37-44,54,60-63,78`
  - `CLAUDE.md:36-43,53,59-62,77`
  - `skills/memory-first/SKILL.md:3,21-45`
  - `.claude/commands/cc-init.md:87-91,107,113`
  - `project-template/.claude/commands/cc-init.md` (same lines)
  - `README.md:165,198,254-257,269-273,279,289,383-384,405,422`
  - `.gitignore:2`
  - `tests/tools/repo-invariants.test.js`

- [X] [T-004-A] Append the two failing invariants (graphify surface, exact python3 set) to `tests/tools/repo-invariants.test.js`, inside the same `describe`:

```js
  // FEAT-021: the graph rung is gone from every surface an agent reads or an install
  // ships. The heal is the one file that must still name the hook, to remove it.
  it('ships no graph-rung surface: only the heal names graphify', () => {
    const surfaces = ['global', 'skills', 'project-template', 'bin', 'lib', '.claude/commands', '.claude/hooks', 'README.md', 'CLAUDE.md'];
    const files = execFileSync('git', ['ls-files', ...surfaces], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
    expect(files.filter((f) => f !== 'lib/installer/heal.mjs' && /graphify/i.test(read(f)))).toEqual([]);
  });

  // FEAT-021, owner ruling 2: an exact set, so a new mention anywhere else fails rather
  // than growing an allowlist silently. Records are excluded; they describe history.
  // The needle is assembled so this file does not match itself.
  it('mentions python3 only in the two files whose subject it is', () => {
    const needle = ['python', '3'].join('');
    const records = [':!docs/superpowers', ':!CHANGELOG.md', ':!AGENT-READABLE BACKLOG.md', ':!.claude/memory'];
    const r = spawnSync('git', ['grep', '-l', needle, '--', '.', ...records], { cwd: ROOT, encoding: 'utf8' });
    const hits = r.stdout.split('\n').filter(Boolean).sort();
    expect(hits).toEqual(['tests/fixtures/guard3-corpus.js', 'tests/installer/heal.test.js']);
  });
```

  Extend the `node:child_process` import to `import { execFileSync, spawnSync } from 'node:child_process';` (`git grep` exits 1 on no match, so `spawnSync` rather than `execFileSync`).

- [X] [T-004-B] Run `npx vitest run tests/tools/repo-invariants.test.js`. Expect FAIL on both: the surface test lists the CLAUDE.md files, the cc-init mirrors, memory-first and the README; the python3 test lists `README.md` as the extra member.
  **Executed deviations (2026-09-29, count unchanged):** (a) the surface invariant allows `bin/code-conductor.mjs` beside `heal.mjs`, because the call site names `healGraphifyHook` and prints the upgrade notice, which the plan text missed; (b) the Task 3 Guard 4 comment was reworded to name no graphify, and the python3 invariant was retitled because its own title matched the needle.
- [X] [T-004-C] `global/CLAUDE.md`: delete line 27 (`2. **Graph** — …`), then renumber the Grep / Glob, Explore sub-agent, Parallel agents and Targeted read rungs to 2, 3, 4, 5.
- [X] [T-004-D] `project-template/CLAUDE.md` and `CLAUDE.md` (same edits; line numbers are those of `project-template/CLAUDE.md`, minus one in the root file).

  **Session Initialization** (lines 37-44) becomes:

```markdown
- At session start: use **Glob** (NEVER use Read) to check that `project.md`
  exists; run `/cc-init` if absent.
```

  The Guard 3 bullet is unchanged. The NEVER-read bullet becomes:

```markdown
- NEVER read raw files under `node_modules/` — Guard 4 blocks such reads at the
  hook level.
- Do not accept implementation tasks without valid project memory.
```

  **Operational Philosophy** line: `- Token efficiency: query the graph before reading; search before opening; never ingest what can be looked up.` becomes `- Token efficiency: search before opening; never ingest what can be looked up.`

  **The section** `### Graph-First` becomes:

```markdown
### Search-First
Before modifying any file:
1. Grep for all callers, dependents, and related usages of the target symbol.
2. If the answer spans 3+ files, spawn an Explore sub-agent (≤150 words, callers + file paths).
3. Open a file only when you have a specific line range. Always pass limit on files > 150 lines.
```

  **The delegation table:** delete the `| Graph querying             | Explore sub-agent         |` row.
- [X] [T-004-E] `skills/memory-first/SKILL.md`:
  - line 3's description becomes `"Lookup chain enforced before any file read or search: project memory, grep/glob, targeted read — stop at the first step that answers"`;
  - step 1's "proceed to step 2" is unchanged;
  - delete the whole `### 2. Graphify Graph` section (from its heading up to the line before `### 3. Grep / Glob`);
  - renumber `### 3. Grep / Glob` → `### 2.` and `### 4. Targeted Read` → `### 3.`;
  - "Only when steps 1–3 cannot answer" becomes "Only when steps 1–2 cannot answer".
- [X] [T-004-F] In **both** `cc-init.md` mirrors:
  - delete `## Step 5 — Graph sync *(skip if IS_NEW=true)*`, its blank line, and the `/graphify .` line with its trailing blank line;
  - renumber `## Step 6 — Hook integrity check` → `## Step 5` and `## Step 7 — Confirm` → `## Step 6`;
  - delete the report line `- Graph: [built / refreshed / skipped — new project]`.

  Then run `npx vitest run tests/installer/commands-parity.test.js` and expect it to pass.
- [X] [T-004-G] `README.md`:
  - **:165** becomes: `> **Note:** Do not clone this repository into a parent directory named \`node_modules\`. Guard 4 checks path components and will block agent \`Read\` calls on source files if the repository root is nested inside such a directory.`
  - **:198:** delete `refresh the project graph, `.
  - **:254-257:** the chain becomes `1. **Project memory**` / `2. **Grep / Glob**` / `3. **Targeted read**`.
  - **:269-274:** delete the `### graphify-ast-refresh *(global)*` heading and its two paragraphs.
  - **:279:** "(memory, graph, grep, targeted read)" becomes "(memory, grep, targeted read)".
  - **:289** becomes: `**node_modules guard (Guard 4)** - a \`Read\` whose path carries \`node_modules\` as an exact path component is denied, with backslashes and \`..\` resolved first. Use Glob for existence checks.`
  - **:383-384:** the two rows become the single row `│   │   └── verbosity-remind.sh       Verbosity reminder on UserPromptSubmit`.
  - **:405:** "graphify-out guards" becomes "node_modules guards".
  - **:422:** "memory → graph → grep → read chain" becomes "memory → grep → read chain".
- [X] [T-004-H] `.gitignore`: delete line 2 (`graphify-out/`). The BUG-017 doc leaves stay.
- [X] [T-004-I] Run `git grep -n -i "graphify" -- global skills project-template bin lib .claude/commands .claude/hooks README.md CLAUDE.md`. Expect only `lib/installer/heal.mjs` lines.
- [X] [T-004-J] Run `npm test`. Expect **1009 passed / 12 skipped**.
- [X] [T-004-K] Stage: `git add -u global/CLAUDE.md project-template/CLAUDE.md CLAUDE.md skills/memory-first/SKILL.md .claude/commands/cc-init.md project-template/.claude/commands/cc-init.md README.md .gitignore tests/tools/repo-invariants.test.js`.
- [X] [T-004-L] Commit: `git commit -m "docs: remove the graph rung from every instruction surface [FEAT-021]"`.

---

### Task 5: Release 1.34.0

**Files:**
- Modify:
  - `VERSION`, `package.json`, `package-lock.json`
  - `CHANGELOG.md` (new top entry)
  - `AGENT-READABLE BACKLOG.md:226` (heading flip) and a DONE bullet after line 232

- [X] [T-005-A] `npm version 1.34.0 --no-git-tag-version`. This moves `package.json` and both `package-lock.json` locations. Write `1.34.0` plus a newline to `VERSION`.
- [X] [T-005-B] `CHANGELOG.md`: insert above `## [1.33.0]`:

```markdown
## [1.34.0] - <release date>

### Removed
- **[FEAT-021]** The graph rung and all Python. `global/hooks/graphify-ast-refresh.py` and its Node wrapper are gone, the installer no longer registers the hook, and the lookup chain is memory, grep/glob, Explore sub-agent, targeted read in both CLAUDE.md templates, `/cc-init` and the memory-first skill. Guard 4 now blocks `node_modules/` only; Guard 1's redirect names no graph step.

### Changed
- **[FEAT-021]** **Upgrading removes the old hook.** The installer takes the `graphify-ast-refresh` hook out of `~/.claude/settings.json`'s `UserPromptSubmit` (a timestamped backup is written beside it; any other hook sharing that entry is kept) and then deletes `~/.claude/hooks/graphify-ast-refresh.py` and `.mjs` **only if they are byte-identical to what code-conductor shipped**. A copy you edited is kept and named in the installer output; it is no longer used and can be deleted by hand. The entry is always removed before the files, so no prompt ever runs a hook whose file is gone.
- **[FEAT-021]** `project-template/` changes (`CLAUDE.md`, `cc-init.md`, `pre-tool-use.mjs`), so a fresh install differs. That is why this release is minor.
```

- [X] [T-005-C] Backlog, surgical, one line each:
  - line 226, `### [ ] \`[FEAT-021]\`` → `### [X] \`[FEAT-021]\``;
  - insert after line 232: `* **DONE, shipped as \`1.34.0\` on <release date>.** Graph rung and all Python removed; an installer heal unmerges the \`graphify-ast-refresh\` hook before a content-match sweep of the two deployed files. Spec: \`docs/superpowers/specs/2026-09-29-feat021-python-free-removal-design.md\`. Plan: \`docs/superpowers/plans/2026-09-29-feat021-python-free-removal.md\` (M1: deploy merges settings, so the ordering is load-bearing; M2: no tarball ever shipped CRLF).`
- [X] [T-005-D] `node tools/version-gate.mjs` → five `ok` lines and `VERSION_GATE_OK 1.34.0`, rc 0.
- [X] [T-005-E] `node tools/record-parity.mjs` → `RECORD_PARITY_OK`, rc 0.
- [X] [T-005-F] `npm test` → **1009 passed / 12 skipped**.
- [X] [T-005-G] Confirm that `node -e "console.log(JSON.stringify(require('./package.json').dependencies ?? {}))"` prints `{}`.
- [X] [T-005-H] Stage: `git add -u VERSION package.json package-lock.json CHANGELOG.md "AGENT-READABLE BACKLOG.md"`.
- [X] [T-005-I] Commit: `git commit -m "chore: release 1.34.0 [FEAT-021]"`.
- [ ] [T-005-J] With owner confirmation, push the branch and open the release PR (closeout step 1). Closeout steps 5-10 follow the merge, per `docs/RELEASE-CLOSEOUT.md`.

## Test List

- [ ] Unit: `unmergeGraphifyHook` (7), `sweepGraphifyHooks` (3), `healGraphifyHook` (6), hash pin (1, local-only): Task 1
- [ ] Integration (`run()`): fresh install, upgrade with a modified file, M1 malformed world, second-run silence: Task 2
- [ ] Repo invariants: no tracked `.py` (Task 2); no graphify in shipped or agent-read surfaces except the heal, and python3 in exactly `guard3-corpus.js` and `heal.test.js` (Task 4)
- [ ] Hook contract: Guard 4 flip rows 18-19, Guard 1 message: Task 3
- [ ] E2E: not applicable (no UI)

## Commit Order

1. Task 0: plan (`docs:`)
2. Task 1: heal module and tests (`feat:`)
3. Task 2: swap, deletions and CLI tests (`feat:`)
4. Task 3: guards, both mirrors (`feat:`)
5. Task 4: instruction surfaces, README, `.gitignore` (`docs:`)
6. Task 5: release (`chore:`)

Every commit is green under the pre-commit hook at the predicted total.

## Identified Risks

- **The ordering is load-bearing (M1).** A refactor that sweeps before or regardless of the unmerge would break every upgraded host's prompts. Mitigation: `healGraphifyHook` gates the sweep on the unmerge status, and the malformed and error cases assert files kept.
- **Hash pin green in CI proves nothing.** It skips there by design; the skip reason is in the test title and comment. Mitigation: it runs on every local `npm test` and pre-commit.
- **Windows git-clone installs with `autocrlf`** hold CRLF copies that never match (M2 residual). They fail safe: kept and named.
- **`JSON.stringify` re-serializes the whole settings file on `removed`.** Formatting changes, content does not, and the backup keeps the original bytes. `mergeVerbosityHook` already canonicalizes the same file to two-space, so no new formatting drift is introduced.
- **Guard 4 narrowing:** a leftover `graphify-out/graph.json` becomes readable. Guard 1 still denies an unbounded read of it (spec D2).
- **Hand-restoring the malformed backup after an M1-world upgrade (accepted, owner ruling 1).** The `settings.json.malformed-backup.*` file deploy writes still holds the graphify entry, and the sweep has just deleted the files it names, so a user who restores that backup by hand gets a hook error on every prompt. Accepted as a decision, not an omission: restoring a malformed backup is an owner act, the CHANGELOG's upgrade note covers the surprise, and the fix is deleting one line.
