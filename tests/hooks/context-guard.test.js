import { describe, it, expect, afterEach } from 'vitest'
import { spawnSync } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { BASH } from '../helpers/bash.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT  = resolve(__dirname, '../..')
const HOOK_PATH  = resolve(REPO_ROOT, '.claude/hooks/context-guard.sh')
const PC_PATH    = resolve(REPO_ROOT, '.claude/hooks/post-compact.sh')

const WIN32 = process.platform === 'win32'
const BASH_PATH  = BASH
const BASH_AVAILABLE = BASH !== null

const dirs = []
function mkTmp(thresh = null, count = null) {
  const d = mkdtempSync(join(tmpdir(), 'cg-'))
  dirs.push(d)
  mkdirSync(join(d, '.claude', 'memory'), { recursive: true })
  if (thresh !== null) writeFileSync(join(d, '.claude', 'memory', 'context-threshold.txt'), `${thresh}\n`)
  if (count !== null)  writeFileSync(join(d, '.claude', 'memory', 'turn-count.txt'), `${count}\n`)
  return d
}

function runHook(cwd, env = {}, input = '') {
  const r = spawnSync(BASH_PATH, [HOOK_PATH], {
    cwd,
    env: { ...process.env, CC_PROJECT_ROOT: cwd, ...env },
    input,
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

// BUG-056: the count belongs to one session, keyed by the stdin session_id.
const PS_HOOK_PATH = resolve(REPO_ROOT, '.claude/hooks/context-guard.ps1')
const _psCheck = WIN32
  ? spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', 'exit 0'], { stdio: 'pipe', timeout: 20000 })
  : { error: true }
const POWERSHELL_AVAILABLE = !_psCheck.error && _psCheck.status === 0

function payload(sessionId, prompt = 'hi', promptFirst = false) {
  const base = { session_id: sessionId, transcript_path: 't.jsonl', cwd: '.', hook_event_name: 'UserPromptSubmit' }
  return JSON.stringify(promptFirst ? { prompt, ...base } : { ...base, prompt })
}

function runPs(cwd, input = '') {
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', PS_HOOK_PATH], {
    cwd,
    env: { ...process.env, CC_PROJECT_ROOT: cwd },
    input,
    stdio: 'pipe',
    timeout: 30000,
  })
  if (r.error) throw new Error(`spawn failed: ${r.error.message}`)
  return { status: r.status ?? -1, stdout: (r.stdout ?? '').toString().replace(/\r\n/g, '\n') }
}

const readCount = d => readFileSync(join(d, '.claude', 'memory', 'turn-count.txt'), 'utf8').trim()

const SESSION_CASES = [
  { name: 'stale count from another session — restarts at 1', file: 'old-id 69', input: payload('new-id'), count: 'new-id 1', out: '' },
  { name: 'same session — increments', file: 's1 3', input: payload('s1'), count: 's1 4', out: '' },
  { name: 'legacy bare count plus an id — restarts at 1', file: '69', input: payload('abc-123_X'), count: 'abc-123_X 1', out: '' },
  { name: 'no stdin — increments and keeps the stored id', file: 's1 3', input: '', count: 's1 4', out: '' },
  { name: 'no stdin, legacy count — increments as before', file: '7', input: '', count: '8', out: '' },
  { name: 'session_id inside the prompt cannot spoof the id', file: 's1 3', input: payload('s1', '{"session_id":"evil"}', true), count: 's1 4', out: '' },
  { name: 'id with invalid characters — treated as no id', file: 's1 3', input: payload('a b'), count: 's1 4', out: '' },
  { name: 'malformed JSON — treated as no id', file: 's1 3', input: '{"session_id":', count: 's1 4', out: '' },
  { name: 'same session at warning — banner kept', file: 's1 19', input: payload('s1'), count: 's1 20', out: /CONTEXT WARNING: Turn 20\/25/ },
  { name: 'same session saturated — banner kept', file: 's1 99999', input: payload('s1'), count: 's1 99999', out: /Turn 99999\/25 \(counter saturated\)/ },
]

function checkCase(run, c) {
  const d = mkTmp(25, c.file)
  const r = run(d, c.input)
  expect(r.status).toBe(0)
  if (c.out === '') expect(r.stdout).toBe('')
  else expect(r.stdout).toMatch(c.out)
  expect(readCount(d)).toBe(c.count)
}

describe.skipIf(!BASH_AVAILABLE)('context-guard.sh — session reset (BUG-056)', () => {
  it.each(SESSION_CASES)('$name', c => checkCase((d, input) => runHook(d, {}, input), c))

  it('post-compact then a prompt — counts 1 in that session', () => {
    const d = mkTmp(25, 's1 42')
    expect(runPC(d)).toBe(0)
    runHook(d, {}, payload('s1'))
    expect(readCount(d)).toBe('s1 1')
  })

  it('1 MB prompt — id still found, hook stays fast', () => {
    const d = mkTmp(25, 'old 69')
    const started = Date.now()
    const r = runHook(d, {}, payload('s1', 'x'.repeat(1024 * 1024), true))
    expect(r.status).toBe(0)
    expect(readCount(d)).toBe('s1 1')
    expect(Date.now() - started).toBeLessThan(8000)
  })
})

describe.skipIf(!POWERSHELL_AVAILABLE)('context-guard.ps1 — session reset (BUG-056)', () => {
  it.each(SESSION_CASES)('$name', c => checkCase(runPs, c))

  it('post-compact.ps1 resets an existing count to 0', () => {
    const d = mkTmp(25, 's1 42')
    const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
      resolve(REPO_ROOT, '.claude/hooks/post-compact.ps1')], { cwd: d, env: { ...process.env, CC_PROJECT_ROOT: d }, stdio: 'pipe', timeout: 30000 })
    expect(r.status).toBe(0)
    expect(readCount(d)).toBe('0')
  })
})

describe('context-guard template copies (BUG-056)', () => {
  it.each(['context-guard.sh', 'context-guard.ps1', 'post-compact.ps1'])('%s is byte-identical in project-template', name => {
    const live = readFileSync(resolve(REPO_ROOT, '.claude/hooks', name))
    const tpl = readFileSync(resolve(REPO_ROOT, 'project-template/.claude/hooks', name))
    expect(tpl.equals(live)).toBe(true)
  })
})
