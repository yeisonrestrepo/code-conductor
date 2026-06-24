import { describe, it, expect, afterEach } from 'vitest'
import { spawnSync } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT  = resolve(__dirname, '../..')
const HOOK_PATH  = resolve(REPO_ROOT, '.claude/hooks/context-guard.sh')
const PC_PATH    = resolve(REPO_ROOT, '.claude/hooks/post-compact.sh')

const WIN32 = process.platform === 'win32'
const _whichBash = WIN32 ? null : spawnSync('which', ['bash'], { stdio: 'pipe', timeout: 5000 })
const BASH_PATH  = (_whichBash?.status === 0) ? _whichBash.stdout.toString().trim() : 'bash'
const _bashCheck = spawnSync('bash', ['--version'], { stdio: 'pipe', timeout: 5000 })
const BASH_AVAILABLE = !_bashCheck.error && _bashCheck.status === 0

const dirs = []
function mkTmp(thresh = null, count = null) {
  const d = mkdtempSync(join(tmpdir(), 'cg-'))
  dirs.push(d)
  mkdirSync(join(d, '.claude', 'memory'), { recursive: true })
  if (thresh !== null) writeFileSync(join(d, '.claude', 'memory', 'context-threshold.txt'), `${thresh}\n`)
  if (count !== null)  writeFileSync(join(d, '.claude', 'memory', 'turn-count.txt'), `${count}\n`)
  return d
}

function runHook(cwd, env = {}) {
  const r = spawnSync(BASH_PATH, [HOOK_PATH], {
    cwd,
    env: { ...process.env, CC_PROJECT_ROOT: cwd, ...env },
    stdio: 'pipe',
    timeout: 10000,
  })
  if (r.error) throw new Error(`spawn failed: ${r.error.message}`)
  const strip = s => (s ?? '').toString().replace(/\r\n/g, '\n')
  return { status: r.status ?? -1, stdout: strip(r.stdout), stderr: strip(r.stderr) }
}

function runPC(cwd) {
  const r = spawnSync(BASH_PATH, [PC_PATH], {
    cwd,
    env: { ...process.env, CC_PROJECT_ROOT: cwd },
    stdio: 'pipe',
    timeout: 10000,
  })
  if (r.error) throw new Error(`spawn failed: ${r.error.message}`)
  return r.status ?? -1
}

afterEach(() => {
  while (dirs.length) { try { rmSync(dirs.pop(), { recursive: true }) } catch {} }
})

describe.skipIf(!BASH_AVAILABLE)('context-guard.sh', () => {
  // row 1: count below warning (default threshold=25, warning=20)
  it('count below warning — no output', () => {
    const d = mkTmp(25, 5)            // new_count=6, warning=20
    const r = runHook(d)
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('')
  })

  // row 2: count at warning threshold
  it('count at warning — emits ⚠', () => {
    const d = mkTmp(25, 19)           // new_count=20 == warning
    const r = runHook(d)
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('⚠ CONTEXT WARNING: Turn 20/25 — consider running /cc-compact soon.\n')
  })

  // row 3: count above warning, below critical
  it('count above warning below critical — emits ⚠', () => {
    const d = mkTmp(25, 22)           // new_count=23, warning=20, critical=25
    const r = runHook(d)
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('⚠ CONTEXT WARNING: Turn 23/25 — consider running /cc-compact soon.\n')
  })

  // row 4: count at critical
  it('count at critical — emits 🚨', () => {
    const d = mkTmp(25, 24)           // new_count=25 == critical
    const r = runHook(d)
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('🚨 CONTEXT CRITICAL: Turn 25/25 — run /cc-compact NOW before context overflows.\n')
  })

  // row 5: counter saturation
  it('count=99999 — emits saturated message', () => {
    const d = mkTmp(25, 99999)        // new_count stays 99999
    const r = runHook(d)
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('🚨 CONTEXT CRITICAL: Turn 99999/25 (counter saturated) — run /cc-compact NOW.\n')
  })

  // row 6: PostCompact reset
  it('post-compact.sh resets turn-count.txt to 0', () => {
    const d = mkTmp(25, 42)
    const status = runPC(d)
    expect(status).toBe(0)
    const val = readFileSync(join(d, '.claude', 'memory', 'turn-count.txt'), 'utf8').trim()
    expect(val).toBe('0')
  })

  // row 7: corrupt turn-count.txt (non-numeric)
  it('corrupt turn-count.txt — resets to 0, no output', () => {
    const d = mkTmp(25)
    writeFileSync(join(d, '.claude', 'memory', 'turn-count.txt'), 'not-a-number\n')
    const r = runHook(d)
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('')         // new_count=1, below warning=20
    const val = readFileSync(join(d, '.claude', 'memory', 'turn-count.txt'), 'utf8').trim()
    expect(val).toBe('1')
  })

  // row 8: empty turn-count.txt
  it('empty turn-count.txt — treated as 0, no output', () => {
    const d = mkTmp(25)
    writeFileSync(join(d, '.claude', 'memory', 'turn-count.txt'), '')
    const r = runHook(d)
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('')         // new_count=1, below warning=20
  })

  // row 9: custom threshold = 10
  it('custom threshold=10 — MAX=10 in warning string', () => {
    const d = mkTmp(10, 7)            // new_count=8 == warning(8)
    const r = runHook(d)
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('⚠ CONTEXT WARNING: Turn 8/10 — consider running /cc-compact soon.\n')
  })

  // row 10: BOM-prefixed threshold file
  it('BOM-prefixed threshold — BOM stripped, correct threshold applied', () => {
    const d = mkTmp()
    const bom = Buffer.from([0xef, 0xbb, 0xbf])
    const content = Buffer.concat([bom, Buffer.from('10\n')])
    writeFileSync(join(d, '.claude', 'memory', 'context-threshold.txt'), content)
    writeFileSync(join(d, '.claude', 'memory', 'turn-count.txt'), '7\n')
    const r = runHook(d)              // new_count=8 == warning(8) of critical=10
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('⚠ CONTEXT WARNING: Turn 8/10 — consider running /cc-compact soon.\n')
  })

  // row 11: absent threshold file — fallback 25
  it('absent threshold — default 25 used', () => {
    const d = mkTmp()
    writeFileSync(join(d, '.claude', 'memory', 'turn-count.txt'), '19\n')
    const r = runHook(d)              // new_count=20 == warning(20) of critical=25
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('⚠ CONTEXT WARNING: Turn 20/25 — consider running /cc-compact soon.\n')
  })

  // row 12: locked/unreadable threshold (Unix only)
  it.skipIf(WIN32)('unreadable threshold file — fallback 25', () => {
    const d = mkTmp()
    const tf = join(d, '.claude', 'memory', 'context-threshold.txt')
    writeFileSync(tf, '10\n')
    chmodSync(tf, 0o000)
    writeFileSync(join(d, '.claude', 'memory', 'turn-count.txt'), '19\n')
    const r = runHook(d)              // new_count=20 == warning(20) of fallback critical=25
    chmodSync(tf, 0o644)              // restore so cleanup can delete
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('⚠ CONTEXT WARNING: Turn 20/25 — consider running /cc-compact soon.\n')
  })

  // row 13: negative threshold ('-5') — fallback 25
  it('negative threshold — fallback 25 used', () => {
    const d = mkTmp()
    writeFileSync(join(d, '.claude', 'memory', 'context-threshold.txt'), '-5\n')
    writeFileSync(join(d, '.claude', 'memory', 'turn-count.txt'), '19\n')
    const r = runHook(d)
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('⚠ CONTEXT WARNING: Turn 20/25 — consider running /cc-compact soon.\n')
  })

  // row 14: empty threshold file — fallback 25
  it('empty threshold file — fallback 25 used', () => {
    const d = mkTmp()
    writeFileSync(join(d, '.claude', 'memory', 'context-threshold.txt'), '')
    writeFileSync(join(d, '.claude', 'memory', 'turn-count.txt'), '19\n')
    const r = runHook(d)
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('⚠ CONTEXT WARNING: Turn 20/25 — consider running /cc-compact soon.\n')
  })

  // row 15: CRLF threshold file — CR stripped, correct threshold
  it('CRLF threshold file — CR stripped, correct threshold applied', () => {
    const d = mkTmp()
    writeFileSync(join(d, '.claude', 'memory', 'context-threshold.txt'), '10\r\n')
    writeFileSync(join(d, '.claude', 'memory', 'turn-count.txt'), '7\n')
    const r = runHook(d)              // new_count=8 == warning(8) of critical=10
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('⚠ CONTEXT WARNING: Turn 8/10 — consider running /cc-compact soon.\n')
  })

  // row 16: merge-conflict threshold — fallback 25
  it('merge-conflict threshold — fallback 25 used', () => {
    const d = mkTmp()
    writeFileSync(join(d, '.claude', 'memory', 'context-threshold.txt'),
      '<<<<<<< HEAD\n25\n=======\n50\n>>>>>>> branch\n')
    writeFileSync(join(d, '.claude', 'memory', 'turn-count.txt'), '19\n')
    const r = runHook(d)
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('⚠ CONTEXT WARNING: Turn 20/25 — consider running /cc-compact soon.\n')
  })

  // row 17: CC_GUARD_DEBUG=1 — stderr contains [context-guard]
  it('CC_GUARD_DEBUG=1 — stderr contains [context-guard]', () => {
    const d = mkTmp(25, 5)
    const r = runHook(d, { CC_GUARD_DEBUG: '1' })
    expect(r.status).toBe(0)
    expect(r.stderr).toMatch(/\[context-guard\]/)
  })

  // row 18: critical=1 (warning=0) — 🚨 fires from first turn
  it('critical=1 (warning=0) — 🚨 fires when new_count >= 1', () => {
    const d = mkTmp(1, 0)             // new_count=1, critical=1, warning=0
    const r = runHook(d)
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('🚨 CONTEXT CRITICAL: Turn 1/1 — run /cc-compact NOW before context overflows.\n')
  })

  // row 19: no .claude/ in tmpDir — hook creates dir and exits 0 cleanly
  it('no .claude/ in tmpDir — hook starts from scratch, exits 0, no output', () => {
    const d = mkdtempSync(join(tmpdir(), 'cg-empty-'))
    dirs.push(d)
    // No .claude/ directory at all
    const r = runHook(d)
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('')         // new_count=1, below warning=20 (default threshold=25)
  })
})
