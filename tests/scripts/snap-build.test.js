import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAPS, elementLength } from '../../scripts/snap-contract.mjs';

const SCRIPT = fileURLToPath(new URL('../../scripts/snap-build.mjs', import.meta.url));
const VALIDATOR = fileURLToPath(new URL('../../scripts/snap-validate.mjs', import.meta.url));
const MAX = 10 * 1024 * 1024;

// Every child runs in its own fresh temp cwd so no test can pollute or lock the
// active project directory (snap-build writes nothing, but this keeps the suite
// hermetic and consistent with the session-id / conductor-db suites).
const sandboxes = [];
function sandbox() { const d = mkdtempSync(join(tmpdir(), 'sb-')); sandboxes.push(d); return d; }
afterEach(() => { while (sandboxes.length) { try { rmSync(sandboxes.pop(), { recursive: true }); } catch {} } });

function build(input) {
  // maxBuffer must exceed the 10 MiB v2 cap or a large payload overflows the default 1 MiB and SIGTERMs the child
  return spawnSync(process.execPath, [SCRIPT], { input, encoding: 'utf8', cwd: sandbox(), maxBuffer: MAX + 65536 });
}
function validate(line) {
  const d = sandbox(); const p = join(d, 'session-snapshot.json');
  writeFileSync(p, line.endsWith('\n') ? line : line + '\n');
  return spawnSync(process.execPath, [VALIDATOR, p], { encoding: 'utf8', cwd: d });
}
const base = { ph: 'impl', c: 'abc1234', s: 'feat010', n: [], f: [], d: [], x: [] };

describe('snap-build.mjs', () => {
  it('emits v1 when pr is absent, and validates', () => {
    const r = build(JSON.stringify(base));
    expect(r.status).toBe(0);
    const obj = JSON.parse(r.stdout);
    expect(obj.v).toBe(1);
    expect('pr' in obj).toBe(false);
    expect(obj.sys).toEqual({ ph: 'impl', c: 'abc1234', s: 'feat010' });
    expect(validate(r.stdout.trim()).status).toBe(0);
  });

  it('emits v2 with pr when a non-empty prose string is given', () => {
    const r = build(JSON.stringify({ ...base, pr: 'checkpoint body' }));
    const obj = JSON.parse(r.stdout);
    expect(obj.v).toBe(2);
    expect(obj.pr).toBe('checkpoint body');
    expect(validate(r.stdout.trim()).status).toBe(0);
  });

  it('emits v1 when pr is empty or whitespace', () => {
    expect(JSON.parse(build(JSON.stringify({ ...base, pr: '' })).stdout).v).toBe(1);
  });

  it('normalizes arrays: dedup, cap counts, filter empties', () => {
    const r = build(JSON.stringify({ ...base, n: ['a', 'a', ' ', 'b', 'c', 'd'] }));
    expect(JSON.parse(r.stdout).ops.n).toEqual(['b', 'c', 'd']); // dedup + head-drop to 3
  });

  it('strips extraneous stdin keys from output', () => {
    const r = build(JSON.stringify({ ...base, evil: 'x', pr: 'p' }));
    const obj = JSON.parse(r.stdout);
    expect('evil' in obj).toBe(false);
    expect(Object.keys(obj).sort()).toEqual(['mem', 'ops', 'pr', 'sys', 'v']);
  });

  it('truncates an over-cap v2 pr to <= 10 MiB, still valid JSON', () => {
    const big = 'x'.repeat(MAX + 1000);
    const r = build(JSON.stringify({ ...base, pr: big }));
    expect(r.status).toBe(0);
    expect(Buffer.byteLength(r.stdout.trim(), 'utf8')).toBeLessThanOrEqual(MAX);
    expect(() => JSON.parse(r.stdout)).not.toThrow();
    expect(JSON.parse(r.stdout).v).toBe(2);
  });

  it('does not split a surrogate pair at the truncation boundary', () => {
    // pad with emoji (surrogate pairs) so the cut can land mid-pair
    const emoji = '😀';
    const big = emoji.repeat(Math.ceil((MAX + 4000) / 4));
    const r = build(JSON.stringify({ ...base, pr: big }));
    expect(r.status).toBe(0);
    const pr = JSON.parse(r.stdout).pr;
    // last code unit must not be a lone high surrogate
    const last = pr.charCodeAt(pr.length - 1);
    expect(last >= 0xD800 && last <= 0xDBFF).toBe(false);
  });

  it('exits non-zero with no stdout on malformed stdin', () => {
    const r = build('not json');
    expect(r.status).not.toBe(0);
    expect(r.stdout).toBe('');
  });

  it('exits non-zero on empty stdin', () => {
    const r = build('');
    expect(r.status).not.toBe(0);
    expect(r.stdout).toBe('');
  });

  it('exits non-zero when a required scalar (c) is missing', () => {
    const { c, ...noC } = base;
    const r = build(JSON.stringify(noC));
    expect(r.status).not.toBe(0);
    expect(r.stdout).toBe('');
  });

  // ---- ARCH-010: any band field selects v3, the band envelope ----
  const band = { role: 'code', tk: 'RW', scope: ['src/**'], gate: 'define_approved' };

  it('[AC6] emits v3 when band fields are present, in BLOCK_FIELDS[3] order, and it validates', () => {
    const r = build(JSON.stringify({ ...base, ...band, p: { tests: 'green' } }));
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('{"v":3,"sys":{"ph":"impl","c":"abc1234","s":"feat010","role":"code","tk":"RW"},"ops":{"n":[],"f":[],"scope":["src/**"],"gate":"define_approved"},"mem":{"d":[],"x":[],"p":{"tests":"green"}},"pr":""}');
    expect(validate(r.stdout.trim()).status).toBe(0);
  });

  it.each(['role', 'tk', 'gate'])('[AC6] dies when a band input lacks %s', (key) => {
    const { [key]: _, ...rest } = band;
    const r = build(JSON.stringify({ ...base, ...rest }));
    expect(r.status).toBe(1);
    expect(r.stderr).toBe(`SNAP_BUILD_ERROR: missing or empty scalar: ${key}\n`);
  });

  it.each([['scope', ['src/**']], ['p', {}]])('[AC6] %s alone selects v3, so the band scalars become required', (key, value) => {
    const r = build(JSON.stringify({ ...base, [key]: value }));
    expect(r.status).toBe(1);
    expect(r.stderr).toBe('SNAP_BUILD_ERROR: missing or empty scalar: role\n');
  });

  it('[AC6] dies on a non-array scope', () => {
    const r = build(JSON.stringify({ ...base, ...band, scope: 'src/**' }));
    expect(r.status).toBe(1);
    expect(r.stderr).toBe('SNAP_BUILD_ERROR: scope must be an array\n');
  });

  it('[AC6] dies on a non-object p', () => {
    const r = build(JSON.stringify({ ...base, ...band, p: ['x'] }));
    expect(r.status).toBe(1);
    expect(r.stderr).toBe('SNAP_BUILD_ERROR: p must be a plain object\n');
  });

  // ---- issue #119: D9, a scope is refused at its cap, never truncated ----
  it('[#119 AC1] refuses a scope element over 300 characters instead of truncating it', () => {
    const r = build(JSON.stringify({ ...base, ...band, scope: ['src/**', 'src/' + 'x'.repeat(297)] }));
    expect(r.status).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('SNAP_BUILD_ERROR: SNAP_SCOPE_OVER_CAP: ops.scope[1] is 301 characters; the cap is 300\n');
  });

  it('[#119 AC2] refuses a scope over 20 entries instead of head-dropping it', () => {
    const scope = Array.from({ length: 21 }, (_, i) => `f${i}.js`);
    const r = build(JSON.stringify({ ...base, ...band, scope: [...scope, ' ', 'f0.js'] }));
    expect(r.status).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('SNAP_BUILD_ERROR: SNAP_SCOPE_OVER_CAP: ops.scope has 21 entries; the cap is 20\n');
  });

  it('[#119 AC3] builds a scope at both caps unchanged, and it validates', () => {
    const scope = Array.from({ length: 20 }, (_, i) => String(i).padStart(2, '0') + 'x'.repeat(298));
    const r = build(JSON.stringify({ ...base, ...band, scope }));
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).ops.scope).toEqual(scope);
    expect(validate(r.stdout.trim()).status).toBe(0);
  });

  // ---- issue #128: the element cap is measured as the validator measures it ----
  const BS = String.fromCharCode(92);
  it.each([
    ['a backslash', 'src' + BS + 'x'.repeat(296)],
    ['an astral character', 'src/\u{1F600}' + 'x'.repeat(295)],
  ])('[#128] refuses a 300-character scope path holding %s, which escapes to 301', (_, path) => {
    const r = build(JSON.stringify({ ...base, ...band, scope: [path] }));
    expect(r.status).toBe(1);
    expect(r.stderr).toBe('SNAP_BUILD_ERROR: SNAP_SCOPE_OVER_CAP: ops.scope[0] is 301 characters; the cap is 300\n');
  });

  it('[#128] builds a backslash scope path at exactly the escaped cap, and it validates', () => {
    const path = 'src' + BS + 'x'.repeat(295);
    const r = build(JSON.stringify({ ...base, ...band, scope: [path] }));
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).ops.scope).toEqual([path]);
    expect(validate(r.stdout.trim()).status).toBe(0);
  });

  // ---- issue #132: history elements are truncated by the validator's measure ----
  const fieldOf = (obj, key) => (key === 'n' ? obj.ops.n : obj.mem[key]);
  const isLoneHigh = (s) => /[\uD800-\uDBFF]$/.test(s);

  it('[#132 AC1] truncates a quoted mem.d entry to the escaped cap, and it validates', () => {
    const r = build(JSON.stringify({ ...base, d: ['say "hi" ' + 'x'.repeat(400)] }));
    expect(r.status).toBe(0);
    const [el] = JSON.parse(r.stdout).mem.d;
    expect(el).toBe('say "hi" ' + 'x'.repeat(289));
    expect(elementLength(el)).toBe(300);
    expect(validate(r.stdout.trim()).status).toBe(0);
  });

  it.each([['n', 'ops.n'], ['d', 'mem.d'], ['x', 'mem.x']])(
    '[#132 AC2] truncates an escape-heavy %s entry within its cap, without a lone surrogate, and it validates',
    (key, capKey) => {
      const entry = ('"' + BS + '\u{1F600}').repeat(200);
      const r = build(JSON.stringify({ ...base, [key]: [entry] }));
      expect(r.status).toBe(0);
      const [el] = fieldOf(JSON.parse(r.stdout), key);
      expect(elementLength(el)).toBeLessThanOrEqual(CAPS[capKey][1]);
      expect(elementLength(el)).toBeGreaterThan(CAPS[capKey][1] - 2);
      expect(isLoneHigh(el)).toBe(false);
      expect(validate(r.stdout.trim()).status).toBe(0);
    },
  );

  // ops.f is measured the same way; since #136 the cut keeps the action code, so it validates.
  it('[#132 AC2] truncates a quoted ops.f entry within its escaped cap, and it validates', () => {
    const r = build(JSON.stringify({ ...base, f: ['"'.repeat(200) + ':C'] }));
    expect(JSON.parse(r.stdout).ops.f).toEqual(['"'.repeat(149) + ':C']);
    expect(validate(r.stdout.trim()).status).toBe(0);
  });

  it('[#132 AC3] drops an escape that would cross the cap whole', () => {
    const r = build(JSON.stringify({ ...base, d: ['x'.repeat(299) + '"'] }));
    expect(JSON.parse(r.stdout).mem.d).toEqual(['x'.repeat(299)]);
  });

  it('[#132 AC4] emits an element at the escaped cap unchanged', () => {
    const entry = 'x'.repeat(296) + '"' + BS;
    const r = build(JSON.stringify({ ...base, d: [entry] }));
    expect(JSON.parse(r.stdout).mem.d).toEqual([entry]);
    expect(validate(r.stdout.trim()).status).toBe(0);
  });

  // ---- issue #136: an over-cap ops.f entry keeps its :C/:M/:D action code ----
  const F_CAP = CAPS['ops.f'][1];

  it.each(['C', 'M', 'D'])('[#136 AC1] cuts the path of an over-cap ops.f entry and keeps :%s, and it validates', (code) => {
    const r = build(JSON.stringify({ ...base, f: ['src/' + 'x'.repeat(400) + '.js:' + code] }));
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).ops.f).toEqual(['src/' + 'x'.repeat(F_CAP - 6) + ':' + code]);
    expect(validate(r.stdout.trim()).status).toBe(0);
  });

  it('[#136 AC1] keeps the action code of an entry one character over the cap', () => {
    const r = build(JSON.stringify({ ...base, f: ['x'.repeat(F_CAP - 1) + ':C'] }));
    expect(JSON.parse(r.stdout).ops.f).toEqual(['x'.repeat(F_CAP - 2) + ':C']);
    expect(validate(r.stdout.trim()).status).toBe(0);
  });

  it.each([
    ['accented and CJK', '\u00e9\u4e2d'],
    ['astral', '\u{1F600}'],
  ])('[#136 AC2] cuts an over-cap %s path within the escaped cap, without a lone surrogate, and it validates', (_, unit) => {
    const r = build(JSON.stringify({ ...base, f: ['docs/' + unit.repeat(200) + '.md:M'] }));
    expect(r.status).toBe(0);
    const [el] = JSON.parse(r.stdout).ops.f;
    expect(el.endsWith(':M')).toBe(true);
    expect(elementLength(el)).toBeLessThanOrEqual(F_CAP);
    expect(elementLength(el)).toBeGreaterThan(F_CAP - 2);
    expect(isLoneHigh(el.slice(0, -2))).toBe(false);
    expect(validate(r.stdout.trim()).status).toBe(0);
  });

  it('[#136 AC3] emits an ops.f entry at the cap unchanged', () => {
    const entry = 'src/' + 'x'.repeat(F_CAP - 9) + '.js:M';
    const r = build(JSON.stringify({ ...base, f: [entry] }));
    expect(JSON.parse(r.stdout).ops.f).toEqual([entry]);
    expect(validate(r.stdout.trim()).status).toBe(0);
  });

  it('[#136 AC4] refuses an over-cap ops.f entry that has no action code to keep', () => {
    const r = build(JSON.stringify({ ...base, f: ['a.js:M', 'src/' + 'x'.repeat(400) + '.js'] }));
    expect(r.status).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('SNAP_BUILD_ERROR: SNAP_FILE_NO_ACTION: ops.f[1] is 407 characters, over the cap of 300, and has no :C, :M or :D suffix to keep\n');
  });

  it('[#136 AC5] still cuts the other history arrays from the end', () => {
    const r = build(JSON.stringify({ ...base, d: ['x'.repeat(400) + ':C'] }));
    expect(JSON.parse(r.stdout).mem.d).toEqual(['x'.repeat(300)]);
  });
});

describe('snap-build.mjs v4 [FEAT-034]', () => {
  const sec = { ph: 'rev', c: 'abc1234', s: 'feat034', n: [], f: [], d: [], x: [], tk: 'X', gate: 'build_executed' };

  it('writes v3 for each of the five foundation roles', () => {
    for (const role of ['spec', 'plan', 'code', 'audit', 'qa']) {
      const r = build(JSON.stringify({ ...sec, role }));
      expect(r.status).toBe(0);
      expect(JSON.parse(r.stdout).v).toBe(3);
    }
  });

  it('writes v4 for security and keeps the v3 key order', () => {
    const r = build(JSON.stringify({ ...sec, role: 'security' }));
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('{"v":4,"sys":{"ph":"rev","c":"abc1234","s":"feat034","role":"security","tk":"X"},"ops":{"n":[],"f":[],"gate":"build_executed"},"mem":{"d":[],"x":[]},"pr":""}');
  });
});
