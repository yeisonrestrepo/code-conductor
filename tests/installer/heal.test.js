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
