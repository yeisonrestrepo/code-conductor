import { describe, it, expect, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GATES, ROLES, V3_CAPS, expectedGate } from '../../scripts/snap-contract.mjs'

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

  it('rejects unknown version (v > MAX_VERSION)', async () => {
    const { MAX_VERSION } = await import('../../scripts/snap-contract.mjs')
    const payload = { ...VALID, v: MAX_VERSION + 1 }
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

  it('scripts/snap-validate.mjs stays within the 38-line hard cap', () => {
    const src = readFileSync(VALIDATOR, 'utf8').split(/\r?\n/)
    const counted = src.filter(l => l.trim() !== '' && !l.trim().startsWith('//'))
    expect(counted.length).toBeLessThanOrEqual(38)
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

  it('accepts a valid v2 payload with pr', () => {
    const v2 = { v: 2, sys: { ph: 'impl', c: 'abc1234', s: 'feat010' }, ops: { n: [], f: [] }, mem: { d: [], x: [] }, pr: 'checkpoint prose' }
    const r = run(fixture(j(v2)))
    expect(r.status).toBe(0)
    expect(r.stderr).toBe('')
  })

  it('accepts a v2 payload without pr (pr strictly optional)', () => {
    const v2 = { ...VALID, v: 2 }
    expect(run(fixture(j(v2))).status).toBe(0)
  })

  it('rejects pr on a v1 payload as an unexpected key', () => {
    const bad = { ...VALID, pr: 'nope' }
    const r = run(fixture(j(bad)))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe('SNAP_ERROR: unexpected key: pr\n')
  })

  it('rejects a non-string pr on v2', () => {
    const bad = { ...VALID, v: 2, pr: 123 }
    const r = run(fixture(j(bad)))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe('SNAP_ERROR: pr must be a string\n')
  })

  it('rejects v > MAX_VERSION with SNAP_UNKNOWN_VERSION', async () => {
    const { MAX_VERSION } = await import('../../scripts/snap-contract.mjs')
    const bad = { ...VALID, v: MAX_VERSION + 1 }
    const r = run(fixture(j(bad)))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe('SNAP_ERROR: SNAP_UNKNOWN_VERSION\n')
  })

  it('accepts a 40-char sys.c hash', () => {
    const long = { ...VALID, sys: { ...VALID.sys, c: 'a'.repeat(40) } }
    expect(run(fixture(j(long))).status).toBe(0)
  })

  it('accepts the 0000000 sentinel and 7-char hash (regression)', () => {
    expect(run(fixture(j({ ...VALID, sys: { ...VALID.sys, c: '0000000' } }))).status).toBe(0)
    expect(run(fixture(j({ ...VALID, sys: { ...VALID.sys, c: 'abc1234' } }))).status).toBe(0)
  })

  it('accepts a 64-char sys.c hash (SHA-256 object id)', () => {
    const long = { ...VALID, sys: { ...VALID.sys, c: 'a'.repeat(64) } }
    expect(run(fixture(j(long))).status).toBe(0)
  })

  it('rejects a 65-char sys.c hash', () => {
    const bad = { ...VALID, sys: { ...VALID.sys, c: 'a'.repeat(65) } }
    const r = run(fixture(j(bad)))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe('SNAP_ERROR: invalid sys.c format\n')
  })

  // ---- BUG-038: two tiers, because one number cannot do both jobs ----

  const pad = (n) => 'x'.repeat(n)

  it('accepts a v2 payload larger than the v1 4096-character budget', () => {
    const big = { v: 2, sys: { ph: 'impl', c: 'abc1234', s: 'feat010' }, ops: { n: [], f: [] }, mem: { d: [], x: [] }, pr: pad(6000) }
    const r = run(fixture(j(big)))
    expect(r.status).toBe(0)
    expect(r.stderr).toBe('')
  })

  it('still rejects a v1 payload over 4096 characters, naming the v1 cap', () => {
    const over = { ...VALID, mem: { d: [pad(300), pad(300), pad(300), pad(300), pad(300), pad(300), pad(300), pad(300), pad(300), pad(300)], x: [pad(200), pad(200), pad(200), pad(200), pad(200)] }, ops: { n: [pad(200), pad(200), pad(200)], f: [] } }
    const text = j(over)
    expect(text.length).toBeGreaterThan(4096)
    const r = run(fixture(text))
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('payload too large')
    expect(r.stderr).toContain('4096')
    expect(r.stderr).toContain('(v1 cap)')
  })

  it('rejects a payload over the pre-parse ceiling WITHOUT parsing it', () => {
    // Deliberately malformed JSON above the ceiling: if the ceiling were applied
    // after JSON.parse, the reported error would be `malformed JSON` instead.
    const r = run(fixture('{' + pad(10485760)))
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('pre-parse ceiling')
    expect(r.stderr).not.toContain('malformed JSON')
  })

  it('accepts a v2 pr carrying newlines and keeps the payload one physical line', () => {
    const withNl = { v: 2, sys: { ph: 'rev', c: 'abc1234', s: 'feat010' }, ops: { n: [], f: [] }, mem: { d: [], x: [] }, pr: 'line one\nline two\nline three' }
    const text = j(withNl)
    expect(text).not.toContain('\n')
    const r = run(fixture(text))
    expect(r.status).toBe(0)
  })

  it('rejects a payload carrying the Unicode replacement character', () => {
    const r = run(fixture(j({ ...VALID, sys: { ...VALID.sys, s: 'ok' } }).replace('"ok"', '"o�k"')))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe('SNAP_ERROR: encoding error\n')
  })

  it('rejects a payload with an internal newline', () => {
    const r = run(fixture(j(VALID).replace('{"v"', '{\n"v"')))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe('SNAP_ERROR: internal newline in payload\n')
  })

  // ---- BUG-038: field sets and the version ceiling come from the contract ----

  it('resolves its per-version top-level field set from the contract module', async () => {
    const { TOP_FIELDS } = await import('../../scripts/snap-contract.mjs')
    const src = readFileSync(VALIDATOR, 'utf8')
    expect(src).toContain('TOP_FIELDS')
    expect(src).not.toMatch(/\['v', 'sys', 'ops', 'mem'\]/)
    expect(TOP_FIELDS[2]).toContain('pr')
    expect(TOP_FIELDS[1]).not.toContain('pr')
    // v1 rejecting `pr` is the behavior that field set encodes
    const r = run(fixture(j({ ...VALID, pr: 'prose' })))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe('SNAP_ERROR: unexpected key: pr\n')
  })

  it('resolves its per-block field sets from the contract module', async () => {
    const { BLOCK_FIELDS } = await import('../../scripts/snap-contract.mjs')
    const src = readFileSync(VALIDATOR, 'utf8')
    expect(src).toContain('BLOCK_FIELDS')
    const V1 = { sys: ['ph', 'c', 's'], ops: ['n', 'f'], mem: ['d', 'x'] }
    expect(BLOCK_FIELDS).toEqual({ 1: V1, 2: V1, 3: { sys: ['ph', 'c', 's', 'role', 'tk'], ops: ['n', 'f', 'scope', 'gate'], mem: ['d', 'x', 'p'] } })
    const r = run(fixture(j({ ...VALID, sys: { ...VALID.sys, extra: 1 } })))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe('SNAP_ERROR: unexpected key: sys.extra\n')
  })

  it('tracks the contract module for the SNAP_UNKNOWN_VERSION boundary', async () => {
    const { MAX_VERSION } = await import('../../scripts/snap-contract.mjs')
    const src = readFileSync(VALIDATOR, 'utf8')
    expect(src).toContain('MAX_VERSION')
    expect(src).not.toMatch(/snap\.v > 2/)
    const over = run(fixture(j({ ...VALID, v: MAX_VERSION + 1 })))
    expect(over.status).toBe(1)
    expect(over.stderr).toBe('SNAP_ERROR: SNAP_UNKNOWN_VERSION\n')
  })

  it('[AC3] decides the version first: an unknown version carrying unknown keys is SNAP_UNKNOWN_VERSION', async () => {
    const { MAX_VERSION } = await import('../../scripts/snap-contract.mjs')
    const bad = { ...VALID, v: MAX_VERSION + 1, sys: { ...VALID.sys, role: 'code', zz: 1 }, ops: { ...VALID.ops, gate: 'x' } }
    const r = run(fixture(j(bad)))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe('SNAP_ERROR: SNAP_UNKNOWN_VERSION\n')
  })

  it('reports only missing: v when v is absent, not the whole missing list [ARCH-010 D2]', () => {
    const { v, ...noV } = VALID
    const r = run(fixture(j({ ...noV, sys: { c: 'abc1234', s: 'feat010' } })))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe('SNAP_ERROR: missing: v\n')
  })
})

// ---- ARCH-010: v3 band fields and the handoff check ----
const VALID3 = { v: 3, sys: { ph: 'impl', c: 'abc1234', s: 'arch010', role: 'code', tk: 'RW' }, ops: { n: [], f: [], scope: ['src/**'], gate: 'define_approved' }, mem: { d: [], x: [] } }
const with3 = (blk, patch) => ({ ...VALID3, [blk]: { ...VALID3[blk], ...patch } })
function runTo(path, ...args) {
  const r = spawnSync('node', [VALIDATOR, path, ...args], { stdio: 'pipe', timeout: 10000 })
  return { status: r.status ?? -1, stderr: (r.stderr ?? '').toString() }
}

describe('snap-validate.mjs v3 [ARCH-010]', () => {
  it.each(ROLES)('[AC5] accepts a valid v3 envelope for role %s', (role) => {
    const env = { ...VALID3, sys: { ...VALID3.sys, role, tk: 'X' }, ops: { n: [], f: [], gate: expectedGate(role) } }
    expect(run(fixture(j(env)))).toEqual({ status: 0, stderr: '', stdout: '' })
  })

  it.each(['sys.role', 'sys.tk', 'ops.gate'])('[AC5] names a missing %s', (key) => {
    const [blk, field] = key.split('.')
    const { [field]: _, ...rest } = VALID3[blk]
    const r = run(fixture(j({ ...VALID3, [blk]: rest })))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe(`SNAP_ERROR: missing: ${key}\n`)
  })

  it.each([
    ['sys', 'role', 'boss', 'role must be spec|plan|code|audit|qa'],
    ['sys', 'tk', 'W', 'tk must be R|RW|X'],
    ['ops', 'gate', 'green', 'gate must be boundary_routed|define_approved|build_executed|verify_pass|ship_released'],
  ])('[AC5] rejects %s.%s outside its enum', (blk, field, value, message) => {
    const r = run(fixture(j(with3(blk, { [field]: value }))))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe(`SNAP_ERROR: ${message}\n`)
  })

  it('[AC5] requires scope when tk is RW', () => {
    const { scope, ...ops } = VALID3.ops
    const r = run(fixture(j({ ...VALID3, ops })))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe('SNAP_ERROR: missing: ops.scope (required when tk is RW)\n')
  })

  it.each([[[]], ['text'], [null]])('[AC5] rejects a non-object p (%j)', (p) => {
    const r = run(fixture(j(with3('mem', { p }))))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe('SNAP_ERROR: p must be a plain object\n')
  })

  it.each([[1, 'sys', 'role'], [2, 'sys', 'tk'], [1, 'ops', 'scope'], [2, 'ops', 'gate'], [1, 'mem', 'p']])(
    '[AC5] rejects a v3-only key on v%i: %s.%s', (v, blk, field) => {
      const base = v === 2 ? { ...VALID, v: 2, pr: '' } : VALID
      const r = run(fixture(j({ ...base, [blk]: { ...base[blk], [field]: 'code' } })))
      expect(r.status).toBe(1)
      expect(r.stderr).toBe(`SNAP_ERROR: unexpected key: ${blk}.${field}\n`)
    })

  it('caps ops.scope by count, from the contract', () => {
    const scope = Array.from({ length: V3_CAPS['ops.scope'][0] + 1 }, (_, i) => `d${i}/**`)
    const r = run(fixture(j(with3('ops', { scope }))))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe('SNAP_ERROR: ops.scope exceeds cap\n')
  })

  it('requires ops.scope to be an array', () => {
    const r = run(fixture(j(with3('ops', { scope: 'src/**' }))))
    expect(r.status).toBe(1)
    expect(r.stderr).toBe('SNAP_ERROR: ops.scope must be an array\n')
  })

  it('[AC7] --to qa passes on build_executed', () => {
    expect(runTo(fixture(j(with3('ops', { gate: 'build_executed' }))), '--to', 'qa')).toEqual({ status: 0, stderr: '' })
  })

  it.each(GATES.filter(g => g !== 'build_executed'))('[AC7] --to qa halts on %s', (gate) => {
    const r = runTo(fixture(j(with3('ops', { gate }))), '--to', 'qa')
    expect(r.status).toBe(1)
    expect(r.stderr).toBe(`SNAP_ERROR: SNAP_GATE_MISMATCH: qa expects build_executed, got ${gate}\n`)
  })

  it.each([
    ['spec', 'boundary_routed'], ['plan', 'boundary_routed'], ['code', 'define_approved'],
    ['audit', 'build_executed'], ['qa', 'build_executed'],
  ])('[AC7] --to %s expects %s', (role, gate) => {
    expect(runTo(fixture(j(with3('ops', { gate }))), '--to', role)).toEqual({ status: 0, stderr: '' })
  })

  it('--to on a v1 envelope is a named error, not a silent pass', () => {
    const r = runTo(fixture(j(VALID)), '--to', 'qa')
    expect(r.status).toBe(1)
    expect(r.stderr).toBe('SNAP_ERROR: --to requires a v3 envelope\n')
  })

  it('rejects an unknown --to role with the usage line', () => {
    const r = runTo(fixture(j(VALID3)), '--to', 'boss')
    expect(r.status).toBe(1)
    expect(r.stderr).toBe('SNAP_ERROR: usage: snap-validate.mjs <file> [--to spec|plan|code|audit|qa]\n')
  })
})
