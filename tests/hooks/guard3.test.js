import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join, resolve } from 'path'
import fs from 'fs'
import { CORPUS } from '../fixtures/guard3-corpus.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = resolve(__dirname, '../..')
// The frozen corpus subject, not a shipped artifact: the deployed hook is
// pre-tool-use.mjs, whose Guard 3 slot is empty until [BUG-037]. These 108 cases are
// the behavioral authority that port is verified against, so not one of them moves.
const HOOK = join(REPO_ROOT, 'tests/fixtures/guard3-reference.sh')
const TESTS_TMP = join(REPO_ROOT, 'tests', '.tmp')

// Detect bash availability. On Windows without Git for Windows in PATH, all tests are skipped
// rather than failing with an undiagnosable ENOENT error. Install Git for Windows and ensure
// its bin/ directory is in PATH if you need to run these tests on Windows.
const BASH = (() => {
  const r = spawnSync('bash', ['--version'], { stdio: 'pipe', timeout: 5000 })
  if (r.error) {
    console.warn('[guard3] bash not found in PATH - all tests will be skipped. On Windows, ensure Git for Windows bin/ is in PATH.')
    return null
  }
  return 'bash'
})()

beforeAll(() => { fs.mkdirSync(TESTS_TMP, { recursive: true }) })

function jsonCmd(cmd) {
  // JSON.stringify handles all escaping (backslashes, quotes, control chars, Unicode) correctly.
  return JSON.stringify({ command: cmd })
}

// One runner for every row. The allowlist, when a row carries one, is written into
// a throwaway cwd, which also guarantees the suite never reads the developer's own
// .claude/memory/. Rows without an allowlist get the same isolation for free.
function runRow(row) {
  const dir = fs.mkdtempSync(join(TESTS_TMP, 'cc-guard3-'))
  try {
    if (row.allowlist && row.allowlist.length) {
      fs.mkdirSync(join(dir, '.claude', 'memory'), { recursive: true })
      fs.writeFileSync(join(dir, '.claude', 'memory', 'bash-scan-allowlist.txt'), row.allowlist.join('\n') + '\n', 'utf8')
    }
    const toolName = row.toolName ?? 'Bash'
    const input = toolName === 'Read' ? '{"file_path":"/tmp/x"}' : jsonCmd(row.command)
    const result = spawnSync(BASH, [HOOK], {
      stdio: 'pipe',
      cwd: dir,
      timeout: 10000,
      env: { ...process.env, CLAUDE_TOOL_NAME: toolName, CLAUDE_TOOL_INPUT: input },
    })
    if (result.error) throw new Error(`bash spawn failed (${result.error.code}): ${result.error.message}`)
    return result.status ?? -1
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

// Safety sweep: remove any cc-guard3-* temp dirs leaked if a test crashed before finally.
// Scans the repo-local tests/.tmp/ directory rather than the global OS temp dir,
// keeping the cleanup scope narrow and avoiding broad system scans.
afterAll(() => {
  try {
    fs.readdirSync(TESTS_TMP)
      .filter(n => n.startsWith('cc-guard3-'))
      .forEach(n => fs.rmSync(join(TESTS_TMP, n), { recursive: true, force: true }))
  } catch { /* best-effort */ }
})

describe.skipIf(!BASH)('guard3 - pre-tool-use.sh', () => {

  it('the corpus table carries exactly 108 rows', () => {
    expect(CORPUS).toHaveLength(108)
  })

  it.each(CORPUS.map(r => [r.label, r]))('%s', (_label, row) => {
    const status = runRow(row)
    if (row.verdict === 'deny') expect(status).not.toBe(0)
    else expect(status).toBe(0)
  })
})
