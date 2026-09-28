// BUG-040. The convention in CLAUDE.md rests on four facts about `git add`.
// These cases pin those facts, so the rule cannot outlive its own justification.
import { describe, it, expect, afterEach } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8').replace(/\r\n/g, '\n')
const TARGET = 'box/memory/notes.md'

const trees = []
afterEach(() => { while (trees.length) { try { rmSync(trees.pop(), { recursive: true, force: true }) } catch {} } })

// `track: true` commits the target and then modifies it, which is the shape of
// every real reproduction: a TRACKED, MODIFIED file under an ignored ancestor.
function mkRepo(ignoreBody, { track }) {
  const dir = mkdtempSync(join(tmpdir(), 'staging-'))
  trees.push(dir)
  const g = (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  g(['init', '-q'])
  g(['config', 'user.email', 't@t.t'])
  g(['config', 'user.name', 'T'])
  mkdirSync(join(dir, 'box', 'memory'), { recursive: true })
  writeFileSync(join(dir, '.gitignore'), ignoreBody, 'utf8')
  writeFileSync(join(dir, 'seed.txt'), 'seed\n', 'utf8')
  writeFileSync(join(dir, TARGET), 'v1\n', 'utf8')
  g(['add', '.gitignore', 'seed.txt'])
  if (track) g(['add', '-f', TARGET])
  g(['commit', '-q', '-m', 'init'])
  if (track) writeFileSync(join(dir, TARGET), 'v2\n', 'utf8')
  return dir
}

function add(dir, args) {
  const r = spawnSync('git', ['add', ...args], { cwd: dir, encoding: 'utf8' })
  const s = spawnSync('git', ['diff', '--cached', '--name-only'], { cwd: dir, encoding: 'utf8' })
  return {
    status: r.status,
    stderr: r.stderr || '',
    staged: (s.stdout || '').trim().split('\n').filter(Boolean),
  }
}

describe('the git contract the staging convention rests on', () => {
  it('AC5: -u on a tracked file under an ignored ancestor exits 0 and stages it', () => {
    // The five reproductions' scenario, end to end.
    const r = add(mkRepo('box/\n', { track: true }), ['-u', TARGET])
    expect(r.status).toBe(0)
    expect(r.staged).toEqual([TARGET])
  })

  it('AC6: plain add on the same file exits 1 AND stages it, which is the defect', () => {
    // Pins the disease, not only the cure: if a future git stops lying here, this
    // fails and the convention's reason for existing is re-examined deliberately.
    const r = add(mkRepo('box/\n', { track: true }), [TARGET])
    expect(r.status).toBe(1)
    expect(r.staged).toEqual([TARGET])
    expect(r.stderr).toContain('ignored by one of your .gitignore files')
  })

  it('AC7: -u on an untracked path exits 128 and stages nothing', () => {
    const r = add(mkRepo('box/\n', { track: false }), ['-u', TARGET])
    expect(r.status).toBe(128)
    expect(r.staged).toEqual([])
    expect(r.stderr).toContain('did not match any file(s) known to git')
  })

  it('AC8: -u on an untracked path exits 128 with NO ignore rule too, so the branch is tracked-ness', () => {
    const clean = mkRepo('unrelated/\n', { track: false })
    const viaU = add(clean, ['-u', TARGET])
    expect(viaU.status).toBe(128)
    expect(viaU.staged).toEqual([])
    // ...and plain add is the CORRECT command there, which is why a global
    // command must never prescribe an unconditional -u.
    const plain = add(mkRepo('unrelated/\n', { track: false }), [TARGET])
    expect(plain.status).toBe(0)
    expect(plain.staged).toEqual([TARGET])
  })
})
