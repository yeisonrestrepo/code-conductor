import { describe, it, expect } from 'vitest'
import { spawnSync } from 'child_process'
import { mkdtempSync, rmdirSync } from 'fs'
import { tmpdir } from 'os'
import { fileURLToPath } from 'url'
import { dirname, join, resolve } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = resolve(__dirname, '../..')
const HOOK = join(REPO_ROOT, '.claude/hooks/pre-tool-use.mjs')

const WIN32 = process.platform === 'win32'

// These 17 cases are Guard 4's logic of record. The runtime and the input contract both
// changed under them, so the mechanics move (JSON on stdin, decision in stdout, exit 0
// always) while the verdicts do not, except at row14 and row16, which the contract itself
// flips and which are named in the plan rather than quietly adjusted.
function runRead(filePath, { toolName = 'Read', input = null, env = {} } = {}) {
  const payload = input ?? JSON.stringify({ tool_name: toolName, tool_input: { file_path: filePath } })
  const result = spawnSync(process.execPath, [HOOK], {
    stdio: 'pipe',
    cwd: REPO_ROOT,
    timeout: 15000,
    input: payload,
    env: { ...process.env, ...env },
  })
  if (result.error) throw new Error(`hook spawn failed: ${result.error.message}`)
  const strip = s => s.replace(/\r\n|\r/g, '\n').replace(/\x1b\[[0-9;]*m/g, '')
  const stdout = strip((result.stdout ?? Buffer.alloc(0)).toString())
  return {
    status: result.status ?? -1,
    stdout,
    stderr: strip((result.stderr ?? Buffer.alloc(0)).toString()),
    decision: stdout.trim() === '' ? null : JSON.parse(stdout).hookSpecificOutput,
  }
}

const expectBlocked = (r, matcher = /Guard 4/) => {
  expect(r.status).toBe(0)
  expect(r.decision.permissionDecision).toBe('deny')
  expect(r.decision.permissionDecisionReason).toMatch(matcher)
}
const expectAllowed = (r) => {
  expect(r.status).toBe(0)
  expect(r.decision).toBeNull()
}

describe('Guard 4 — Read blocker for graphify-out/ and node_modules/', () => {
  it('row1: blocks graphify-out/graph.json', () => {
    expectBlocked(runRead('graphify-out/graph.json'))
  })
  it('row2: blocks graphify-out/cache/ast/abc.json', () => {
    expectBlocked(runRead('graphify-out/cache/ast/abc.json'))
  })
  it('row3: blocks node_modules/vitest/dist/index.js', () => {
    expectBlocked(runRead('node_modules/vitest/dist/index.js'))
  })
  it('row4: blocks absolute path /abs/path/graphify-out/file.json', () => {
    expectBlocked(runRead('/abs/path/graphify-out/file.json'))
  })
  it('row5: blocks Windows backslash path graphify-out\\cache\\file.json', () => {
    expectBlocked(runRead('graphify-out\\cache\\file.json'))
  })
  it('row6: blocks case variant Graphify-Out/graph.json', () => {
    expectBlocked(runRead('Graphify-Out/graph.json'))
  })
  it('row7: blocks NODE_MODULES/pkg/index.js (uppercase)', () => {
    expectBlocked(runRead('NODE_MODULES/pkg/index.js'))
  })
  it('row8: allows graphify-out/../src/main.js (normalize resolves to src/main.js)', () => {
    expectAllowed(runRead('graphify-out/../src/main.js'))
  })
  it('row9: blocks graphify-out/ (trailing slash: component still matched)', () => {
    expectBlocked(runRead('graphify-out/'))
  })
  it('row10: blocks "  graphify-out/graph.json" (leading spaces trimmed)', () => {
    expectBlocked(runRead('  graphify-out/graph.json'))
  })
  it('row11: allows graphify-out-backup/file.json (not an exact component match)', () => {
    expectAllowed(runRead('graphify-out-backup/file.json'))
  })
  it('row12: allows src/utils/graphify-out-helper.js (no blocked component)', () => {
    expectAllowed(runRead('src/utils/graphify-out-helper.js'))
  })
  it('row13: allows src/index.js (normal file)', () => {
    expectAllowed(runRead('src/index.js'))
  })
  // FLIPPED. Was "fail-open on malformed JSON". Unparseable stdin is not "nothing to
  // verify", it is "the verifier could not run", which is the condition that fails closed.
  it('row14: denies malformed JSON input {invalid json} and names the override', () => {
    const r = runRead('', { input: '{invalid json}' })
    expectBlocked(r, /CC_HOOK_ALLOW/)
  })
  // UNCHANGED verdict. A payload that names no file_path carries no path that could reach
  // graphify-out/, so there is nothing to deny (Case A).
  it('row15: allows a valid Read payload with no file_path', () => {
    expectAllowed(runRead('', { input: JSON.stringify({ tool_name: 'Read', tool_input: {} }) }))
  })
  // FLIPPED. Was "fail-open when python3 absent". The path check is now pure JavaScript
  // over an already-parsed string, so an empty PATH cannot disarm it.
  it.skipIf(WIN32)('row16: denies with PATH restricted to an empty dir', () => {
    const fakeBin = mkdtempSync(join(tmpdir(), 'guard4-nopath-'))
    try {
      expectBlocked(runRead('graphify-out/graph.json', { env: { PATH: fakeBin } }))
    } finally {
      rmdirSync(fakeBin)
    }
  })
  it('row17: does NOT fire Guard 4 when tool_name is Bash (Guard 3 slot handles it)', () => {
    expectAllowed(runRead('graphify-out/graph.json', { toolName: 'Bash' }))
  })
})
