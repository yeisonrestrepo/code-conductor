import { describe, it, expect } from 'vitest'
import { spawnSync } from 'child_process'
import { mkdtempSync, rmdirSync } from 'fs'
import { tmpdir } from 'os'
import { fileURLToPath } from 'url'
import { dirname, join, resolve } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = resolve(__dirname, '../..')
// Use a relative path so bash on Windows can locate the script from the cwd it inherits
const HOOK = '.claude/hooks/pre-tool-use.sh'

// Use stdio:'pipe' + timeout so WSL bash (which hangs when piped) is treated as unavailable,
// matching the guard3 skip pattern on Windows.
const _bashCheck = spawnSync('bash', ['--version'], { stdio: 'pipe', timeout: 5000 })
const BASH_AVAILABLE = !_bashCheck.error && _bashCheck.status === 0

const WIN32 = process.platform === 'win32'

function runRead(filePath, { toolName = 'Read', input = null } = {}) {
  const finalInput = input ?? JSON.stringify({ file_path: filePath })
  const result = spawnSync('bash', [HOOK], {
    stdio: 'pipe',
    cwd: REPO_ROOT,
    timeout: 15000,
    env: { ...process.env, CLAUDE_TOOL_NAME: toolName, CLAUDE_TOOL_INPUT: finalInput },
  })
  if (result.error) throw new Error(`bash spawn failed: ${result.error.message}`)
  const strip = s => s.replace(/\r\n|\r/g, '\n').replace(/\x1b\[[0-9;]*m/g, '')
  return {
    status: result.status ?? -1,
    stdout: strip((result.stdout ?? Buffer.alloc(0)).toString()),
    stderr: strip((result.stderr ?? Buffer.alloc(0)).toString()),
  }
}

describe.skipIf(!BASH_AVAILABLE)('Guard 4 — Read blocker for graphify-out/ and node_modules/', () => {
  it('row1: blocks graphify-out/graph.json', () => {
    const r = runRead('graphify-out/graph.json')
    expect(r.status).toBe(1)
    const p = JSON.parse(r.stdout.trim())
    expect(p.decision).toBe('block')
    expect(p.reason).toMatch(/Guard 4/)
  })
  it('row2: blocks graphify-out/cache/ast/abc.json', () => {
    const r = runRead('graphify-out/cache/ast/abc.json')
    expect(r.status).toBe(1)
    const p = JSON.parse(r.stdout.trim())
    expect(p.decision).toBe('block')
    expect(p.reason).toMatch(/Guard 4/)
  })
  it('row3: blocks node_modules/vitest/dist/index.js', () => {
    const r = runRead('node_modules/vitest/dist/index.js')
    expect(r.status).toBe(1)
    const p = JSON.parse(r.stdout.trim())
    expect(p.decision).toBe('block')
    expect(p.reason).toMatch(/Guard 4/)
  })
  it('row4: blocks absolute path /abs/path/graphify-out/file.json', () => {
    const r = runRead('/abs/path/graphify-out/file.json')
    expect(r.status).toBe(1)
    const p = JSON.parse(r.stdout.trim())
    expect(p.decision).toBe('block')
    expect(p.reason).toMatch(/Guard 4/)
  })
  it('row5: blocks Windows backslash path graphify-out\\cache\\file.json', () => {
    const r = runRead('graphify-out\\cache\\file.json')
    expect(r.status).toBe(1)
    const p = JSON.parse(r.stdout.trim())
    expect(p.decision).toBe('block')
    expect(p.reason).toMatch(/Guard 4/)
  })
  it('row6: blocks case variant Graphify-Out/graph.json', () => {
    const r = runRead('Graphify-Out/graph.json')
    expect(r.status).toBe(1)
    const p = JSON.parse(r.stdout.trim())
    expect(p.decision).toBe('block')
    expect(p.reason).toMatch(/Guard 4/)
  })
  it('row7: blocks NODE_MODULES/pkg/index.js (uppercase)', () => {
    const r = runRead('NODE_MODULES/pkg/index.js')
    expect(r.status).toBe(1)
    const p = JSON.parse(r.stdout.trim())
    expect(p.decision).toBe('block')
    expect(p.reason).toMatch(/Guard 4/)
  })
  it('row8: allows graphify-out/../src/main.js (normpath resolves to src/main.js)', () => {
    const r = runRead('graphify-out/../src/main.js')
    expect(r.status).toBe(0)
  })
  it('row9: blocks graphify-out/ (trailing slash — normpath yields graphify-out, component matched)', () => {
    const r = runRead('graphify-out/')
    expect(r.status).toBe(1)
    const p = JSON.parse(r.stdout.trim())
    expect(p.decision).toBe('block')
    expect(p.reason).toMatch(/Guard 4/)
  })
  it('row10: blocks "  graphify-out/graph.json" (leading spaces stripped by .strip())', () => {
    const r = runRead('  graphify-out/graph.json')
    expect(r.status).toBe(1)
    const p = JSON.parse(r.stdout.trim())
    expect(p.decision).toBe('block')
    expect(p.reason).toMatch(/Guard 4/)
  })
  it('row11: allows graphify-out-backup/file.json (not an exact component match)', () => {
    const r = runRead('graphify-out-backup/file.json')
    expect(r.status).toBe(0)
  })
  it('row12: allows src/utils/graphify-out-helper.js (no blocked component)', () => {
    const r = runRead('src/utils/graphify-out-helper.js')
    expect(r.status).toBe(0)
  })
  it('row13: allows src/index.js (normal file)', () => {
    const r = runRead('src/index.js')
    expect(r.status).toBe(0)
  })
  it('row14: fail-open on malformed JSON input {invalid json}', () => {
    const r = runRead('', { input: '{invalid json}' })
    expect(r.status).toBe(0)
  })
  it('row15: fail-open on missing file_path key (empty object {})', () => {
    const r = runRead('', { input: '{}' })
    expect(r.status).toBe(0)
  })
  it.skipIf(WIN32)('row16: fail-open when python3 absent (PATH restricted to empty dir)', () => {
    // /bin → /usr/bin on modern Linux (Ubuntu CI), so python3 would be found there.
    // Use a temp empty dir to guarantee python3 is truly absent on any OS.
    const fakeBin = mkdtempSync(join(tmpdir(), 'guard4-nopy-'))
    try {
      const result = spawnSync('bash', [HOOK], {
        stdio: 'pipe',
        cwd: REPO_ROOT,
        timeout: 15000,
        env: {
          ...process.env,
          PATH: fakeBin,
          CLAUDE_TOOL_NAME: 'Read',
          CLAUDE_TOOL_INPUT: JSON.stringify({ file_path: 'graphify-out/graph.json' }),
        },
      })
      if (result.error) throw new Error(`bash spawn failed: ${result.error.message}`)
      expect(result.status ?? -1).toBe(0)
    } finally {
      rmdirSync(fakeBin)
    }
  })
  it('row17: does NOT fire Guard 4 when CLAUDE_TOOL_NAME is Bash (Guard 3 handles; exits 0)', () => {
    const r = runRead('graphify-out/graph.json', { toolName: 'Bash' })
    expect(r.status).toBe(0)
  })
})
