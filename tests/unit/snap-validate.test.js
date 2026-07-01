import { describe, it, expect, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '../..')
const VALIDATOR = resolve(REPO_ROOT, 'scripts/snap-validate.mjs')

const dirs = []
function fixture(content) {
  const d = mkdtempSync(join(tmpdir(), 'snap-'))
  dirs.push(d)
  const p = join(d, 'session-snapshot.json')
  writeFileSync(p, content, 'utf8')
  return p
}
function run(path) {
  const args = path === undefined ? [VALIDATOR] : [VALIDATOR, path]
  const r = spawnSync('node', args, { stdio: 'pipe', timeout: 10000 })
  return { status: r.status ?? -1, stderr: (r.stderr ?? '').toString(), stdout: (r.stdout ?? '').toString() }
}
afterEach(() => { while (dirs.length) { try { rmSync(dirs.pop(), { recursive: true }) } catch {} } })

const VALID = { v: 1, sys: { ph: 'impl', c: 'abc1234', s: 'feat010' }, ops: { n: [], f: [] }, mem: { d: [], x: [] } }
const j = (obj) => JSON.stringify(obj)

describe('snap-validate.mjs', () => {
  it('accepts a valid v1 payload, exit 0, no stdout', () => {
    const r = run(fixture(j(VALID)))
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('')
    expect(r.stderr).toBe('')
  })

  it('rejects missing path argument', () => {
    const r = run(undefined)
    expect(r.status).toBe(1)
    expect(r.stderr).toBe('SNAP_ERROR: no path provided\n')
  })

  it('rejects non-existent file path', () => {
    const r = run(join(tmpdir(), 'snap-does-not-exist-xyz.json'))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe('SNAP_ERROR: file not found\n')
  })

  it('rejects a directory passed as the path (EISDIR, not ENOENT)', () => {
    const d = mkdtempSync(join(tmpdir(), 'snap-dir-'))
    dirs.push(d)
    const r = run(d)
    expect(r.status).toBe(1)
    expect(r.stderr).toBe('SNAP_ERROR: EISDIR\n')
  })

  it('rejects empty file', () => {
    const r = run(fixture(''))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe('SNAP_ERROR: empty file\n')
  })

  it('rejects malformed JSON', () => {
    const r = run(fixture('{not json'))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe('SNAP_ERROR: malformed JSON\n')
  })

  it.each([
    ['array', '[1,2,3]'],
    ['string', '"just a string"'],
    ['number', '42'],
    ['boolean', 'true'],
    ['null', 'null'],
  ])('rejects non-object root (%s)', (label, raw) => {
    const r = run(fixture(raw))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe('SNAP_ERROR: root must be a plain object\n')
  })

  it.each(['sys', 'ops', 'mem'])('rejects missing parent block: %s', (block) => {
    const payload = { ...VALID }
    delete payload[block]
    const r = run(fixture(j(payload)))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe(`SNAP_ERROR: missing block: ${block}\n`)
  })

  it('rejects ph outside enum', () => {
    const payload = { ...VALID, sys: { ...VALID.sys, ph: 'SPEC' } }
    const r = run(fixture(j(payload)))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe('SNAP_ERROR: ph must be spec|plan|impl|rev\n')
  })

  it('rejects unknown version (v > 1)', () => {
    const payload = { ...VALID, v: 2 }
    const r = run(fixture(j(payload)))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe('SNAP_ERROR: SNAP_UNKNOWN_VERSION\n')
  })

  it.each([
    ['ops.n', 'n', 'ops', 'a string'],
    ['ops.f', 'f', 'ops', 42],
    ['mem.d', 'd', 'mem', {}],
    ['mem.x', 'x', 'mem', null],
  ])('rejects %s when it is not an array (%s)', (key, sub, blk, badValue) => {
    const payload = { ...VALID, [blk]: { ...VALID[blk], [sub]: badValue } }
    const r = run(fixture(j(payload)))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe(`SNAP_ERROR: ${key} must be an array\n`)
  })

  it.each([
    ['ops.n', 'n', 'ops', 4],
    ['ops.f', 'f', 'ops', 21],
    ['mem.d', 'd', 'mem', 11],
    ['mem.x', 'x', 'mem', 6],
  ])('rejects %s exceeding array cap', (key, sub, blk, count) => {
    const arr = blk === 'ops' && sub === 'f'
      ? Array.from({ length: count }, (_, i) => `f${i}.js:M`)
      : Array.from({ length: count }, (_, i) => `e${i}`)
    const payload = { ...VALID, [blk]: { ...VALID[blk], [sub]: arr } }
    const r = run(fixture(j(payload)))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe(`SNAP_ERROR: ${key} exceeds cap\n`)
  })

  it('rejects invalid ops.f action code character', () => {
    const payload = { ...VALID, ops: { ...VALID.ops, f: ['a.js:X'] } }
    const r = run(fixture(j(payload)))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe('SNAP_ERROR: invalid action code in ops.f[0]\n')
  })

  it('rejects lowercase ops.f action code', () => {
    const payload = { ...VALID, ops: { ...VALID.ops, f: ['a.js:m'] } }
    const r = run(fixture(j(payload)))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe('SNAP_ERROR: invalid action code in ops.f[0]\n')
  })

  it('rejects backslash in ops.f path', () => {
    const payload = { ...VALID, ops: { ...VALID.ops, f: ['a\\b.js:M'] } }
    const r = run(fixture(j(payload)))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe('SNAP_ERROR: backslash in ops.f[0]\n')
  })

  it('rejects empty array element', () => {
    const payload = { ...VALID, mem: { ...VALID.mem, d: ['  '] } }
    const r = run(fixture(j(payload)))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe('SNAP_ERROR: empty element in mem.d[0]\n')
  })

  it('rejects a null array element (caught by the same not-a-string check as empty strings)', () => {
    const payload = { ...VALID, mem: { ...VALID.mem, d: [null] } }
    const r = run(fixture(j(payload)))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe('SNAP_ERROR: empty element in mem.d[0]\n')
  })

  it('rejects extra top-level key', () => {
    const payload = { ...VALID, extra: true }
    const r = run(fixture(j(payload)))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe('SNAP_ERROR: unexpected key: extra\n')
  })

  it('rejects v as a float', () => {
    const payload = { ...VALID, v: 1.5 }
    const r = run(fixture(j(payload)))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe('SNAP_ERROR: v must be a positive integer\n')
  })

  it('rejects v as a numeric string', () => {
    const payload = { ...VALID, v: '1' }
    const r = run(fixture(j(payload)))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe('SNAP_ERROR: v must be a positive integer\n')
  })

  it('rejects v of 0', () => {
    const payload = { ...VALID, v: 0 }
    const r = run(fixture(j(payload)))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe('SNAP_ERROR: v must be a positive integer\n')
  })

  it('rejects negative v', () => {
    const payload = { ...VALID, v: -1 }
    const r = run(fixture(j(payload)))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe('SNAP_ERROR: v must be a positive integer\n')
  })

  it('rejects v at Number.MAX_SAFE_INTEGER as an unknown future version, not a crash', () => {
    const payload = { ...VALID, v: Number.MAX_SAFE_INTEGER }
    const r = run(fixture(j(payload)))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe('SNAP_ERROR: SNAP_UNKNOWN_VERSION\n')
  })

  it('rejects non-hex sys.c', () => {
    const payload = { ...VALID, sys: { ...VALID.sys, c: 'ZZZZZZZ' } }
    const r = run(fixture(j(payload)))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe('SNAP_ERROR: invalid sys.c format\n')
  })

  it('rejects illegal characters in sys.s', () => {
    const payload = { ...VALID, sys: { ...VALID.sys, s: 'a/b' } }
    const r = run(fixture(j(payload)))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe('SNAP_ERROR: invalid chars in sys.s\n')
  })

  it('round-trips all field values unchanged on valid input', () => {
    const payload = { v: 1, sys: { ph: 'plan', c: '0000000', s: 'feat010' }, ops: { n: ['step a'], f: ['x.js:C'] }, mem: { d: ['decision a'], x: ['constraint a'] } }
    const path = fixture(j(payload))
    const r = run(path)
    expect(r.status).toBe(0)
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(payload)
  })

  it('leaves the file on disk after a schema violation', () => {
    const path = fixture('{not json')
    run(path)
    expect(readFileSync(path, 'utf8')).toBe('{not json')
  })

  it('writes errors to stderr only, never stdout', () => {
    const r = run(fixture('{not json'))
    expect(r.stdout).toBe('')
    expect(r.stderr).not.toBe('')
  })

  it('contains no console.* invocations (stdout must stay empty on every path, not just the tested ones)', () => {
    const src = readFileSync(VALIDATOR, 'utf8')
    expect(src).not.toMatch(/console\./)
  })

  it('scripts/snap-validate.mjs stays within the 30-line hard cap', () => {
    const src = readFileSync(VALIDATOR, 'utf8').split(/\r?\n/)
    const counted = src.filter(l => l.trim() !== '' && !l.trim().startsWith('//'))
    expect(counted.length).toBeLessThanOrEqual(30)
  })

  it('SNAP v1 serialization is at most 85% of the equivalent markdown snapshot length', () => {
    const snapFixture = '{"v":1,"sys":{"ph":"impl","c":"4a6bc93","s":"2026-06-24-bug015-auto-claude-md-design"},"ops":{"n":["run /cc-implement bug015"],"f":["tests/scripts/_fill_helper.cjs:M","tests/scripts/_fill_helper.ps1:C","tests/scripts/installer-fill.test.ps1:M"]},"mem":{"d":["_fill_helper.cjs dual-mode argv[2]: {→JSON else filepath","PS5.1 strips exe quotes→write tempfile","test harness wraps _fill_helper.ps1"],"x":["BUG-003 surgical single-line edits","PS5.1 dblquote strip"]}}'
    const markdownFixture = [
      '# Session Snapshot',
      '**Phase:** impl',
      '**Commit:** 4a6bc93',
      '',
      '## Decisions',
      '- _fill_helper.cjs dual-mode argv[2]: {→JSON else filepath',
      '- PS5.1 strips exe quotes→write tempfile',
      '- test harness wraps _fill_helper.ps1',
      '',
      '## Pending',
      '- run /cc-implement bug015',
      '',
      '## Files Touched',
      '- `tests/scripts/_fill_helper.cjs` - modified',
      '- `tests/scripts/_fill_helper.ps1` - created',
      '- `tests/scripts/installer-fill.test.ps1` - modified',
      '',
      '## Constraints',
      '- BUG-003 surgical single-line edits',
      '- PS5.1 dblquote strip',
      '',
      '## Spec Reference',
      '`docs/superpowers/specs/2026-06-24-bug015-auto-claude-md-design.md`',
    ].join('\n')
    const norm = (s) => s.replace(/\r\n/g, '\n')
    expect(norm(snapFixture).length).toBeLessThanOrEqual(norm(markdownFixture).length * 0.85)
  })
})
