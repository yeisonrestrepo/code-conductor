import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest'
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join, resolve } from 'path'
import fs from 'fs'
import os from 'os'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = resolve(__dirname, '../..')
const GLOBAL_HOOK = join(REPO_ROOT, 'global/hooks/verbosity-remind.sh')
const PROJECT_HOOK = join(REPO_ROOT, 'project-template/.claude/hooks/verbosity-remind.sh')

// Verbosity tests use os.tmpdir() intentionally (not TESTS_TMP inside the repo).
// The hook's upward traversal from $PWD looks for .claude/hooks/verbosity-remind.sh at
// each ancestor directory. If cwd is inside the repo tree, traversal could reach the
// project's own .claude/hooks/ and find a real hook, breaking test isolation.
// os.tmpdir() is outside the repo so traversal stops before reaching any repo path.

// Detect bash availability (Windows without Git for Windows in PATH).
const BASH_AVAILABLE = (() => {
  const r = spawnSync('bash', ['--version'], { stdio: 'pipe', timeout: 5000 })
  if (r.error) {
    console.warn('[verbosity] bash not found in PATH - all tests will be skipped. Ensure Git for Windows bin/ is in PATH.')
    return false
  }
  return true
})()

let tmpDir
const createdTmpDirs = []

beforeEach(() => {
  tmpDir = fs.mkdtempSync(join(os.tmpdir(), 'cc-verbosity-'))
  createdTmpDirs.push(tmpDir)
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

// Safety sweep for dirs afterEach missed (process crash before afterEach ran).
// Uses the tracked set rather than scanning os.tmpdir() globally, consistent
// with the narrow-scope cleanup principle applied in guard3's afterAll.
afterAll(() => {
  for (const d of createdTmpDirs) {
    try { fs.rmSync(d, { recursive: true, force: true }) } catch { /* best-effort */ }
  }
})

const stripAnsi = s => s.replace(/\r\n|\r/g, '\n').replace(/\x1b\[[0-9;]*m/g, '')

function runGlobal(home, cwd, skip = '0') {
  const result = spawnSync('bash', [GLOBAL_HOOK], {
    stdio: 'pipe',
    cwd,
    timeout: 10000,
    env: { ...process.env, HOME: home, CC_VERBOSITY_SKIP: skip },
  })
  return stripAnsi((result.stdout ?? Buffer.alloc(0)).toString())
}

function runProject(home, cwd, skip = '0') {
  const result = spawnSync('bash', [PROJECT_HOOK], {
    stdio: 'pipe',
    cwd,
    timeout: 10000,
    env: { ...process.env, HOME: home, CC_VERBOSITY_SKIP: skip },
  })
  return stripAnsi((result.stdout ?? Buffer.alloc(0)).toString())
}

describe.skipIf(!BASH_AVAILABLE)('verbosity-remind hooks', () => {

  it('row1: global hook emits MIN', { timeout: 5000 }, () => {
    const home = join(tmpDir, 'h1')
    fs.mkdirSync(join(home, '.claude/memory'), { recursive: true })
    fs.writeFileSync(join(home, '.claude/memory/verbosity.md'), 'VERBOSITY: MIN\n')
    expect(runGlobal(home, home)).toContain('VERBOSITY:MIN')
  })

  it('row2: global defers (no output) when project hook exists', { timeout: 5000 }, () => {
    const home = join(tmpDir, 'h2')
    const proj = join(home, 'proj')
    fs.mkdirSync(join(home, '.claude/memory'), { recursive: true })
    fs.mkdirSync(join(proj, '.claude/hooks'), { recursive: true })
    fs.writeFileSync(join(home, '.claude/memory/verbosity.md'), 'VERBOSITY: MIN\n')
    fs.copyFileSync(PROJECT_HOOK, join(proj, '.claude/hooks/verbosity-remind.sh'))
    expect(runGlobal(home, proj).trim()).toBe('')
  })

  it('row3: global defers from subdir via traversal', { timeout: 5000 }, () => {
    const home = join(tmpDir, 'h3')
    const proj = join(home, 'proj')
    const sub = join(proj, 'src/lib')
    fs.mkdirSync(join(home, '.claude/memory'), { recursive: true })
    fs.mkdirSync(join(proj, '.claude/hooks'), { recursive: true })
    fs.mkdirSync(sub, { recursive: true })
    fs.writeFileSync(join(home, '.claude/memory/verbosity.md'), 'VERBOSITY: MIN\n')
    fs.copyFileSync(PROJECT_HOOK, join(proj, '.claude/hooks/verbosity-remind.sh'))
    expect(runGlobal(home, sub).trim()).toBe('')
  })

  it('row4: project-local verbosity.md overrides global', { timeout: 5000 }, () => {
    const home = join(tmpDir, 'h4')
    const proj = join(home, 'proj')
    fs.mkdirSync(join(home, '.claude/memory'), { recursive: true })
    fs.mkdirSync(join(proj, '.claude/memory'), { recursive: true })
    fs.writeFileSync(join(home, '.claude/memory/verbosity.md'), 'VERBOSITY: MIN\n')
    fs.writeFileSync(join(proj, '.claude/memory/verbosity.md'), 'VERBOSITY: INFO\n')
    expect(runProject(home, proj)).toContain('VERBOSITY:INFO')
  })

  it('row5: lowercase verbose normalized to VERBOSE', { timeout: 5000 }, () => {
    const home = join(tmpDir, 'h5')
    const proj = join(home, 'proj')
    fs.mkdirSync(join(home, '.claude/memory'), { recursive: true })
    fs.mkdirSync(join(proj, '.claude/memory'), { recursive: true })
    fs.writeFileSync(join(home, '.claude/memory/verbosity.md'), 'VERBOSITY: MIN\n')
    fs.writeFileSync(join(proj, '.claude/memory/verbosity.md'), 'VERBOSITY: verbose\n')
    expect(runProject(home, proj)).toContain('VERBOSITY:VERBOSE')
  })

  it('row6: sanity guard MIN when no verbosity.md at any level', { timeout: 5000 }, () => {
    const home = join(tmpDir, 'h6')
    fs.mkdirSync(home, { recursive: true })
    expect(runGlobal(home, home)).toContain('VERBOSITY:MIN')
  })

  it('row7: unrecognized level falls back to MIN', { timeout: 5000 }, () => {
    const home = join(tmpDir, 'h7')
    fs.mkdirSync(join(home, '.claude/memory'), { recursive: true })
    fs.writeFileSync(join(home, '.claude/memory/verbosity.md'), 'VERBOSITY: LOUD\n')
    expect(runGlobal(home, home)).toContain('VERBOSITY:MIN')
  })

  it('row8: HOME-level verbosity.md used when no project override', { timeout: 5000 }, () => {
    const home = join(tmpDir, 'h8')
    fs.mkdirSync(join(home, '.claude/memory'), { recursive: true })
    fs.writeFileSync(join(home, '.claude/memory/verbosity.md'), 'VERBOSITY: INFO\n')
    expect(runGlobal(home, home)).toContain('VERBOSITY:INFO')
  })

  it('row10: fenced VERBOSITY not matched; body VERBOSITY:MIN used', { timeout: 5000 }, () => {
    const home = join(tmpDir, 'h10')
    fs.mkdirSync(join(home, '.claude/memory'), { recursive: true })
    fs.writeFileSync(
      join(home, '.claude/memory/verbosity.md'),
      'Some doc\n\n```\nVERBOSITY: VERBOSE\n```\n\nVERBOSITY: MIN\n',
    )
    expect(runGlobal(home, home)).toContain('VERBOSITY:MIN')
  })

  it('row11: CC_VERBOSITY_SKIP=1 produces no output', { timeout: 5000 }, () => {
    const home = join(tmpDir, 'h11')
    fs.mkdirSync(join(home, '.claude/memory'), { recursive: true })
    fs.writeFileSync(join(home, '.claude/memory/verbosity.md'), 'VERBOSITY: VERBOSE\n')
    expect(runGlobal(home, home, '1').trim()).toBe('')
  })

  it('row12: path with spaces handled correctly', { timeout: 5000 }, () => {
    const home = join(tmpDir, 'h12 with spaces')
    fs.mkdirSync(join(home, '.claude/memory'), { recursive: true })
    fs.writeFileSync(join(home, '.claude/memory/verbosity.md'), 'VERBOSITY: MIN\n')
    expect(runGlobal(home, home)).toContain('VERBOSITY:MIN')
  })

  it.skipIf(process.platform === 'win32')(
    'row13: unreadable project hook -> global retains authority',
    { timeout: 5000 },
    () => {
      const home = join(tmpDir, 'h13')
      const proj = join(home, 'proj')
      fs.mkdirSync(join(home, '.claude/memory'), { recursive: true })
      fs.mkdirSync(join(proj, '.claude/hooks'), { recursive: true })
      fs.writeFileSync(join(home, '.claude/memory/verbosity.md'), 'VERBOSITY: MIN\n')
      const hookCopy = join(proj, '.claude/hooks/verbosity-remind.sh')
      fs.copyFileSync(PROJECT_HOOK, hookCopy)
      fs.chmodSync(hookCopy, 0o000)
      try {
        expect(runGlobal(home, proj)).toContain('VERBOSITY:MIN')
      } finally {
        fs.chmodSync(hookCopy, 0o644)
      }
    },
  )

  it('CRLF line endings normalized correctly', { timeout: 5000 }, () => {
    const home = join(tmpDir, 'hcr')
    fs.mkdirSync(join(home, '.claude/memory'), { recursive: true })
    fs.writeFileSync(join(home, '.claude/memory/verbosity.md'), 'VERBOSITY: VERBOSE\r\n')
    expect(runGlobal(home, home)).toContain('VERBOSITY:VERBOSE')
  })

  it('frontmatter VERBOSITY not matched; body VERBOSITY:INFO used', { timeout: 5000 }, () => {
    const home = join(tmpDir, 'hfm')
    fs.mkdirSync(join(home, '.claude/memory'), { recursive: true })
    fs.writeFileSync(
      join(home, '.claude/memory/verbosity.md'),
      '---\nVERBOSITY: VERBOSE\n---\n\nVERBOSITY: INFO\n',
    )
    expect(runGlobal(home, home)).toContain('VERBOSITY:INFO')
  })

  it('UTF-8 BOM stripped; VERBOSITY:INFO matched on line 1', { timeout: 5000 }, () => {
    const home = join(tmpDir, 'hbom')
    fs.mkdirSync(join(home, '.claude/memory'), { recursive: true })
    const bom = Buffer.from([0xef, 0xbb, 0xbf])
    const content = Buffer.from('VERBOSITY: INFO\n')
    fs.writeFileSync(join(home, '.claude/memory/verbosity.md'), Buffer.concat([bom, content]))
    expect(runGlobal(home, home)).toContain('VERBOSITY:INFO')
  })

  it('inline comment (space+hash) stripped; MIN extracted', { timeout: 5000 }, () => {
    const home = join(tmpDir, 'hic')
    fs.mkdirSync(join(home, '.claude/memory'), { recursive: true })
    fs.writeFileSync(join(home, '.claude/memory/verbosity.md'), 'VERBOSITY: MIN # keep it short\n')
    expect(runGlobal(home, home)).toContain('VERBOSITY:MIN')
  })

  it('bare-hash value fails normalization; sanity guard sets MIN', { timeout: 5000 }, () => {
    const home = join(tmpDir, 'hbh')
    fs.mkdirSync(join(home, '.claude/memory'), { recursive: true })
    fs.writeFileSync(join(home, '.claude/memory/verbosity.md'), 'VERBOSITY: MIN#tag\n')
    expect(runGlobal(home, home)).toContain('VERBOSITY:MIN')
  })

  it('hook exits 0 with empty HOME', { timeout: 5000 }, () => {
    const result = spawnSync('bash', [GLOBAL_HOOK], {
      stdio: 'pipe',
      timeout: 10000,
      env: { ...process.env, HOME: '', PWD: '', CC_VERBOSITY_SKIP: '0' },
    })
    expect(result.status).toBe(0)
  })

  it.skipIf(process.platform === 'win32')('T-14: traversal cap=40 blocks verbosity.md 45 levels above; HOME fallback emits MIN', { timeout: 15000 }, () => {
    const deepBase = join(tmpDir, 'deep-path-test')
    let deepPath = deepBase
    for (let i = 1; i <= 45; i++) deepPath = join(deepPath, `d${i}`)
    fs.mkdirSync(deepPath, { recursive: true })
    fs.mkdirSync(join(deepBase, '.claude/memory'), { recursive: true })
    fs.writeFileSync(join(deepBase, '.claude/memory/verbosity.md'), 'VERBOSITY: VERBOSE\n')
    const deepHome = join(tmpDir, 'deep-home')
    fs.mkdirSync(join(deepHome, '.claude/memory'), { recursive: true })
    fs.writeFileSync(join(deepHome, '.claude/memory/verbosity.md'), 'VERBOSITY: MIN\n')
    const out = runGlobal(deepHome, deepPath)
    expect(out).not.toContain('VERBOSITY:VERBOSE')
    // Either MIN from HOME fallback, or empty string (MIN default when HOME verbosity.md absent)
    expect(out.includes('VERBOSITY:MIN') || out.trim() === '').toBe(true)
  })

})
