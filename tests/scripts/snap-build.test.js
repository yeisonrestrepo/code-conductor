import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
});
