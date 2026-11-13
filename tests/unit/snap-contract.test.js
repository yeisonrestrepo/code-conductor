import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CAPS, MAX_VERSION, POST_PARSE_MAX, PRE_PARSE_MAX_BYTES, V1_MAX_CHARS } from '../../scripts/snap-contract.mjs'
import * as contract from '../../scripts/snap-contract.mjs'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const src = (rel) => readFileSync(resolve(REPO_ROOT, rel), 'utf8')
const CONSUMERS = ['scripts/snap-build.mjs', 'scripts/snap-validate.mjs', 'scripts/conductor-db.mjs']

describe('snap-contract.mjs', () => {
  it('is the only file spelling a handoff limit as a literal', () => {
    // Both spellings of 10 MiB and the bare 4096 live here and nowhere else.
    for (const rel of CONSUMERS) {
      const text = src(rel)
      expect(text).not.toContain('10485760')
      expect(text).not.toContain('10 * 1024 * 1024')
      expect(text).not.toMatch(/\b4096\b/)
    }
    const contract = src('scripts/snap-contract.mjs')
    expect(contract).toContain('10485760')
    expect(contract).toContain('4096')
    expect(contract).not.toContain('10 * 1024 * 1024')
  })

  it('is imported by all three consumers', () => {
    for (const rel of CONSUMERS) {
      expect(src(rel)).toContain("from './snap-contract.mjs'")
    }
  })

  it('holds the array caps as one table in one key scheme', () => {
    expect(Object.keys(CAPS)).toEqual(['ops.n', 'ops.f', 'mem.d', 'mem.x'])
    // The leaf-keyed duplicate is what made the old drift invisible to any diff.
    expect(src('scripts/snap-build.mjs')).not.toMatch(/CAPS = \{/)
    expect(src('scripts/snap-validate.mjs')).not.toMatch(/caps = \{/)
  })

  // ---- issue #128: one measure for the element cap, shared by router, builder and validator ----
  it('[#128] measures an element as its JSON-escaped length', () => {
    const BS = String.fromCharCode(92)
    expect(contract.elementLength('src/a.js')).toBe(8)
    expect(contract.elementLength('src' + BS + 'a.js')).toBe(9) // a backslash serializes as two
    expect(contract.elementLength('a"b')).toBe(4) // so does a quote
    expect(contract.elementLength('\u{1F600}')).toBe(2) // an astral character is two UTF-16 units
    expect(contract.elementLength('é')).toBe(1) // non-ASCII is never escaped
  })

  it('[#128] is the one place the element measure is spelled', () => {
    for (const rel of ['scripts/orchestrate.mjs', 'scripts/snap-build.mjs', 'scripts/snap-validate.mjs']) {
      const text = src(rel)
      expect(text).toContain('elementLength(')
      expect(text).not.toContain('JSON.stringify(el).slice(1, -1)')
    }
  })

  it('the writer normalizes against the same caps the validator rejects against', () => {
    // 4 pending items with a cap of 3: the writer must head-drop to exactly the
    // count the validator would otherwise reject.
    const [countCap] = CAPS['ops.n']
    const input = JSON.stringify({
      ph: 'plan', c: 'abc1234', s: 'spec-stem',
      n: ['one', 'two', 'three', 'four'], f: [], d: [], x: [],
    })
    const r = spawnSync(process.execPath, [resolve(REPO_ROOT, 'scripts/snap-build.mjs')],
      { input, encoding: 'utf8' })
    expect(r.status).toBe(0)
    const built = JSON.parse(r.stdout.trim())
    expect(built.ops.n.length).toBe(countCap)
    expect(built.ops.n[0]).toBe('two') // oldest dropped from the head
  })

  it('pins both tiers and the version ceiling to single values', () => {
    expect(PRE_PARSE_MAX_BYTES).toBe(10485760)
    expect(V1_MAX_CHARS).toBe(4096)
    expect(POST_PARSE_MAX[1]).toBe(V1_MAX_CHARS)
    expect(POST_PARSE_MAX[2]).toBe(PRE_PARSE_MAX_BYTES)
    expect(POST_PARSE_MAX[3]).toBe(PRE_PARSE_MAX_BYTES)
    expect(POST_PARSE_MAX[4]).toBe(PRE_PARSE_MAX_BYTES)
    expect(MAX_VERSION).toBe(4)
    expect(Object.keys(POST_PARSE_MAX).map(Number)).toEqual([1, 2, 3, MAX_VERSION])
  })

  it('[AC1] defines v3: the version ceiling, its top-level fields and its post-parse cap', () => {
    expect(contract.MAX_VERSION).toBe(4)
    expect(contract.TOP_FIELDS[3]).toEqual(['v', 'sys', 'ops', 'mem', 'pr'])
    expect(contract.POST_PARSE_MAX[3]).toBe(contract.PRE_PARSE_MAX_BYTES)
  })

  it('[AC2] keys block membership by version, with v1 and v2 exactly as before', () => {
    const V1 = { sys: ['ph', 'c', 's'], ops: ['n', 'f'], mem: ['d', 'x'] }
    expect(contract.BLOCK_FIELDS[1]).toEqual(V1)
    expect(contract.BLOCK_FIELDS[2]).toEqual(V1)
    expect(contract.BLOCK_FIELDS[3]).toEqual({
      sys: ['ph', 'c', 's', 'role', 'tk'], ops: ['n', 'f', 'scope', 'gate'], mem: ['d', 'x', 'p'],
    })
    expect(Object.keys(contract.BLOCK_FIELDS).map(Number)).toEqual([1, 2, 3, 4])
  })

  it('holds the band enums, the band order and the handoff map [ARCH-010]', () => {
    expect(contract.ROLES).toEqual(['spec', 'plan', 'code', 'audit', 'qa', 'security'])
    expect(contract.TOOL_KINDS).toEqual(['R', 'RW', 'X'])
    expect(contract.BANDS).toEqual(['boundary', 'define', 'build', 'verify', 'ship'])
    expect(contract.GATES).toEqual(['boundary_routed', 'define_approved', 'build_executed', 'verify_pass', 'ship_released'])
    expect(contract.WRITE_TOOLS).toEqual(['Write', 'Edit', 'create_file', 'write_file'])
    expect(contract.V3_CAPS).toEqual({ 'ops.scope': [20, 300] })
    expect(Object.fromEntries(contract.ROLES.map(r => [r, contract.expectedGate(r)]))).toEqual({
      spec: 'boundary_routed', plan: 'boundary_routed', code: 'define_approved', audit: 'build_executed', qa: 'build_executed', security: 'build_executed',
    })
  })
})

describe('SNAP v4: the security role [FEAT-034]', () => {
  it('v4 is v3 plus the security role: same top fields, block fields and post-parse cap', () => {
    expect(contract.TOP_FIELDS[4]).toEqual(contract.TOP_FIELDS[3])
    expect(contract.BLOCK_FIELDS[4]).toEqual(contract.BLOCK_FIELDS[3])
    expect(contract.POST_PARSE_MAX[4]).toBe(contract.POST_PARSE_MAX[3])
  })

  it('ROLES_BY_VERSION keeps five roles at v3, adds security at v4, and ROLES is the MAX_VERSION roster', () => {
    expect(contract.ROLES_BY_VERSION[3]).toEqual(['spec', 'plan', 'code', 'audit', 'qa'])
    expect(contract.ROLES_BY_VERSION[4]).toEqual(['spec', 'plan', 'code', 'audit', 'qa', 'security'])
    expect(contract.ROLES).toEqual(contract.ROLES_BY_VERSION[contract.MAX_VERSION])
  })

  it('security belongs to verify and expects build_executed', () => {
    expect(contract.ROLE_BAND.security).toBe('verify')
    expect(contract.expectedGate('security')).toBe('build_executed')
  })
})
