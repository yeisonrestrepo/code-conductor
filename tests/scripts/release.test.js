import { describe, it, expect, afterEach, vi } from 'vitest'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ReleaseError, compareVersions, releaseSurface, validateProfile, windowsInvocation } from '../../scripts/release.mjs'
import { cleanGitEnv } from '../helpers/git-env.js'

vi.setConfig({ testTimeout: 120000 })

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const SCRIPT = join(REPO, 'scripts', 'release.mjs')
const USAGE = 'usage: release.mjs init [--confirm] | digest --version <v> [--items <IDs>] [--date <YYYY-MM-DD>] | check --version <v> [--items <IDs>] [--date <YYYY-MM-DD>] | handoff --version <v> [--pr <N|url>]'
const NOT_CONFIGURED = 'release: RELEASE_NOT_CONFIGURED: no release profile at HEAD; run /cc-release --init'
const DATE = '2026-02-02'

const PROFILE = {
  versions: [
    { path: 'VERSION', line: '{version}' },
    { path: 'package.json', json: ['version'] },
    { path: 'package-lock.json', json: ['version'] },
    { path: 'package-lock.json', json: ['packages', '', 'version'] },
  ],
  changelog: { path: 'CHANGELOG.md', heading: '## [{version}] - {date}' },
  tag: 'v{version}',
  remote: 'origin',
  mainline: 'main',
  checks: [{ name: 'alpha', argv: ['node', 'checks/a.mjs'] }, { name: 'beta', argv: ['node', 'checks/b.mjs'] }],
  publish: { target: 'the demo registry', argv: ['demo-publish', '{tag}', '{notes}'] },
  backlog: {
    path: 'BACKLOG.md',
    open: '### [ ] `[{id}]` {title}',
    closed: '### [X] `[{id}]` {title}',
    done: '* **DONE, shipped as `{version}` on {date}.**',
    claim: '**[{id}]**',
  },
  ticket: { writeback: true },
}
const clone = (p) => structuredClone(p)
const without = (p, ...keys) => { const c = clone(p); for (const k of keys) delete c[k]; return c }
const NOBL = without(PROFILE, 'backlog', 'ticket')
const NOCL = { ...NOBL, changelog: null }
const NOCLB = { ...clone(PROFILE), changelog: null }
const wide = (n, extra = {}) => ({
  ...clone(PROFILE),
  versions: Array.from({ length: n }, (_, i) => ({ path: `v${i}.txt`, line: 'v={version}' })),
  ...extra,
})

// ---- fixtures ----------------------------------------------------------------------------

let root = ''
const roots = []
afterEach(() => { while (roots.length) rmSync(roots.pop(), { recursive: true, force: true }) })

function fresh() {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'cc-release-')))
  roots.push(root)
  return root
}
function git(...args) {
  return spawnSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], { cwd: root, env: cleanGitEnv(), encoding: 'utf8' })
}
const gitOut = (...args) => git(...args).stdout.trim()
function put(path, text) {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), text)
}
const read = (path) => readFileSync(join(root, path), 'utf8')
function commit(msg) {
  git('add', '-A')
  git('commit', '-q', '-m', msg)
  return gitOut('rev-parse', 'HEAD')
}
function rel(args, input = '', cwd = root) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, env: cleanGitEnv(), input, encoding: 'utf8', timeout: 60000 })
  return { status: r.status, out: r.stdout, err: r.stderr }
}
const lines = (text) => text.split('\n').filter((l) => l !== '')
const jsonText = (obj) => JSON.stringify(obj, null, 2) + '\n'
const lockText = (v) => jsonText({ name: 'demo', version: v, lockfileVersion: 3, requires: true, packages: { '': { name: 'demo', version: v } } })
const checkScript = (tag, code, flag) => `import { existsSync } from 'node:fs'\nprocess.stdout.write('${tag} out\\n')\nprocess.stderr.write('${tag} err\\n')\nprocess.exitCode = existsSync('${flag}') ? ${code} : 0\n`
const CHANGELOG = '# Changelog\n\n## [1.0.0] - 2026-01-01\n\n### Added\n\n- First.\n'
const BACKLOG = '### [ ] `[FEAT-001]` Alpha\n\nBody one.\n\n### [ ] `[FEAT-002]` Beta\n\nBody two.\n\n### [X] `[FEAT-003]` Gamma\n'

function project(profile = PROFILE) {
  fresh()
  git('init', '-q', '-b', 'main')
  put('.gitignore', '.conductor/\nred-*\n')
  put('VERSION', '1.0.0\n')
  put('package.json', jsonText({ name: 'demo', version: '1.0.0' }))
  put('package-lock.json', lockText('1.0.0'))
  put('CHANGELOG.md', CHANGELOG)
  put('BACKLOG.md', BACKLOG)
  put('checks/a.mjs', checkScript('a', 3, 'red-a'))
  put('checks/b.mjs', checkScript('b', 4, 'red-b'))
  if (profile) put('.claude/release-profile.json', jsonText(profile))
  commit('chore: base')
  git('tag', 'v1.0.0')
  put('src/a.js', 'export const a = 1\n')
  commit('feat: alpha work')
  git('remote', 'add', 'origin', join(root, 'nonexistent.git'))
}

// The edits a correct release agent makes.
function applyRelease({ v, items = [], date = DATE, backlog = 'BACKLOG.md', changelog = true }) {
  put('VERSION', `${v}\n`)
  for (const [file, text] of [['package.json', null], ['package-lock.json', null]]) {
    const obj = JSON.parse(read(file))
    obj.version = v
    if (obj.packages) obj.packages[''].version = v
    put(file, text ?? jsonText(obj))
  }
  if (changelog) {
    const bullets = items.length ? items.map((id) => `- **[${id}]** Shipped ${id}.`) : ['- Shipped changes.']
    const entry = [`## [${v}] - ${date}`, '', '### Added', '', ...bullets, '']
    const cl = read('CHANGELOG.md').split('\n')
    cl.splice(cl.indexOf('## [1.0.0] - 2026-01-01'), 0, ...entry)
    put('CHANGELOG.md', cl.join('\n'))
  }
  if (!items.length) return
  let text = read(backlog)
  for (const id of items) {
    text = text.replace(new RegExp(`^### \\[ \\] \`\\[${id}\\]\` (.+)$`, 'm'), (_m, title) => `### [X] \`[${id}]\` ${title}\n* **DONE, shipped as \`${v}\` on ${date}.**`)
  }
  put(backlog, text)
}
function report(v, items = []) {
  return `RELEASE: ${v}${items.length ? ` items ${items.join(',')}` : ''}\nSNAP_HANDBACK {"v":6}\n`
}
function merge() {
  commit('chore: release')
  git('update-ref', 'refs/remotes/origin/main', 'HEAD')
}
const checkArgs = (v, items) => ['check', '--version', v, ...(items ? ['--items', items] : []), '--date', DATE]
const ticketPath = () => relative(root, join(REPO, 'scripts', 'ticket.mjs')).replaceAll('\\', '/')
function walk(dir, base = dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name === '.git') return []
    const p = join(dir, e.name)
    return e.isDirectory() ? walk(p, base) : [relative(base, p).replaceAll('\\', '/')]
  }).sort()
}
function refusal(fn) {
  try { fn() } catch (e) { return e }
  throw new Error('expected a ReleaseError')
}

// A project `init` can read: the npm layout of test 12.
function initProject({ changelog = true, tag = true } = {}) {
  fresh()
  git('init', '-q', '-b', 'main')
  put('.gitignore', '.conductor/\n')
  put('package.json', jsonText({ name: 'demo', version: '2.3.4', scripts: { test: 'vitest run' } }))
  put('package-lock.json', lockText('2.3.4'))
  if (changelog) put('CHANGELOG.md', '# Changelog\n\n## 2.3.4 (2026-02-03)\n\n- Thing.\n')
  commit('chore: base')
  if (tag) git('tag', 'v2.3.4')
  git('remote', 'add', 'origin', join(root, 'nonexistent.git'))
  git('update-ref', 'refs/remotes/origin/trunk', 'HEAD')
  git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk')
}
const proposalFile = () => JSON.parse(read('.conductor/release/profile.proposed.json'))

// This repository's own profile in a fixture holding copies of its two instruments.
function gateProject() {
  fresh()
  git('init', '-q', '-b', 'main')
  put('.gitignore', '.conductor/\n')
  put('VERSION', '1.0.0\n')
  put('package.json', jsonText({ name: 'demo', version: '1.0.0' }))
  put('package-lock.json', lockText('1.0.0'))
  put('CHANGELOG.md', '## [1.0.0] - 2026-01-01\n\n### Added\n\n- First.\n')
  put('AGENT-READABLE BACKLOG.md', '### [ ] `[FEAT-900]` Demo\n\nBody.\n')
  for (const f of ['tools/version-gate.mjs', 'tools/record-parity.mjs', '.claude/release-profile.json']) {
    mkdirSync(dirname(join(root, f)), { recursive: true })
    copyFileSync(join(REPO, f), join(root, f))
  }
  commit('chore: base')
  git('tag', 'v1.0.0')
}
const GATE_ARGS = ['--items', 'FEAT-900']

// ---- A. validator and surface (27) -------------------------------------------------------

describe('release.mjs validator and surface [FEAT-035]', () => {
  const INVALID = [
    ['an unknown top-level key', (p) => { p.extra = 1 }, 'extra', ''],
    ['an unknown placeholder in tag', (p) => { p.tag = 'v{foo}' }, 'tag', 'unknown placeholder {foo}'],
    ['{id} in the changelog heading', (p) => { p.changelog.heading = '## {version} {id}' }, 'changelog.heading', 'placeholder {id} is not allowed here'],
    ['a parent-relative version path', (p) => { p.versions[0].path = '../VERSION' }, 'versions[0].path', ''],
    ['a glob changelog path', (p) => { p.changelog.path = 'docs/*.md' }, 'changelog.path', ''],
    ['a .git version path', (p) => { p.versions[0].path = '.git/config' }, 'versions[0].path', ''],
    ['an absolute version path', (p) => { p.versions[0].path = '/abs/VERSION' }, 'versions[0].path', ''],
    ['the profile as the changelog path', (p) => { p.changelog.path = '.claude/release-profile.json' }, 'changelog.path', ''],
    ['empty checks', (p) => { p.checks = [] }, 'checks', ''],
    ['no tag', (p) => { delete p.tag }, 'tag', ''],
    ['a ticket without a backlog', (p) => { delete p.backlog }, 'ticket', ''],
    ['a version entry with both json and line', (p) => { p.versions[0].json = ['version'] }, 'versions[0]', ''],
    ['a changelog path equal to a version path', (p) => { p.changelog.path = 'VERSION' }, 'changelog.path', ''],
    ['a changelog with no heading', (p) => { delete p.changelog.heading }, 'changelog.heading', ''],
  ]

  it.each(INVALID)('1. refuses %s', (_name, mutate, field, why) => {
    const p = clone(PROFILE)
    mutate(p)
    const e = refusal(() => validateProfile(p))
    expect(e).toBeInstanceOf(ReleaseError)
    expect(e.code).toBe('RELEASE_PROFILE_INVALID')
    expect(e.reason.startsWith(field)).toBe(true)
    expect(e.reason).toContain(why)
  })

  it('2. validates the fixture profile; the lockfile counts once on the surface', () => {
    expect(validateProfile(clone(PROFILE))).toEqual(PROFILE)
    expect(releaseSurface(PROFILE)).toEqual(['VERSION', 'package.json', 'package-lock.json', 'CHANGELOG.md', 'BACKLOG.md'])
  })

  it('3. refuses 21 paths', () => {
    const e = refusal(() => validateProfile(wide(19)))
    expect(e.code).toBe('RELEASE_SURFACE_TOO_WIDE')
    expect(e.reason).toBe('21 paths exceeds ops.scope cap 20')
  })

  it('4. accepts 20 paths', () => {
    expect(releaseSurface(validateProfile(wide(18)))).toHaveLength(20)
  })

  it('5. refuses a 301-character path', () => {
    const path = 'a'.repeat(301)
    const p = clone(PROFILE)
    p.versions[0] = { path, line: '{version}' }
    const e = refusal(() => validateProfile(p))
    expect(e.code).toBe('RELEASE_SURFACE_TOO_WIDE')
    expect(e.reason).toBe(`${path} exceeds ops.scope cap 300`)
  })

  it('6. the source holds no project fact, imports only allowed modules and is import-safe', () => {
    const text = readFileSync(SCRIPT, 'utf8')
    for (const word of ['tools/', 'BACKLOG.md', 'version-gate', 'record-parity', 'id-ceiling', 'records-guard', 'skip-baseline']) {
      expect(text).not.toContain(word)
    }
    const imports = text.split('\n').filter((l) => /^import /.test(l))
    expect(imports.length).toBeGreaterThan(0)
    for (const l of imports) expect(l).toMatch(/from '(node:[a-z/_]+|\.\/snap-contract\.mjs|\.\/ticket\.mjs|\.\/orchestrate\.mjs)'/)
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(SCRIPT).href)})`], { encoding: 'utf8' })
    expect({ status: r.status, out: r.stdout, err: r.stderr }).toEqual({ status: 0, out: '', err: '' })
  })

  it('55. [O7] a null changelog validates; the surface is the version paths, then the backlog', () => {
    expect(validateProfile(clone(NOCL))).toEqual(NOCL)
    expect(releaseSurface(NOCL)).toEqual(['VERSION', 'package.json', 'package-lock.json'])
    expect(validateProfile(clone(NOCLB))).toEqual(NOCLB)
    expect(releaseSurface(NOCLB)).toEqual(['VERSION', 'package.json', 'package-lock.json', 'BACKLOG.md'])
  })

  const WIN = String.raw
  const EXT = '.COM;.EXE;.BAT;.CMD'
  const W1_ARGS = ['/d', '/s', '/c', WIN`"C:\n\npm.CMD ^"test^""`]
  const WINDOWS_ROWS = [
    ['W1', ['npm', 'test'], { PATH: WIN`C:\bin;C:\n`, PATHEXT: EXT }, [WIN`C:\n\npm.cmd`], { file: 'cmd.exe', args: W1_ARGS, verbatim: true }],
    ['W2', ['git', 'status'], { PATH: WIN`C:\git`, PATHEXT: EXT }, [WIN`C:\git\git.exe`], { file: WIN`C:\git\git.EXE`, args: ['status'], verbatim: false }],
    ['W3', ['tool.cmd', 'a b', 'x&y', '50%', 'say "hi"', WIN`C:\dir\ `.trim()], { PATH: WIN`C:\t`, PATHEXT: EXT }, [WIN`C:\t\tool.cmd`], {
      file: 'cmd.exe',
      args: ['/d', '/s', '/c', WIN`"C:\t\tool.cmd ^"a^ b^" ^"x^&y^" ^"50^%^" ^"say^ \^"hi\^"^" ^"C:\dir\\^""`],
      verbatim: true,
    }],
    ['W4', ['node_modules/.bin/vitest', 'run', 'a&b'], { PATH: WIN`C:\n`, PATHEXT: EXT }, [WIN`C:\r\node_modules\.bin\vitest.cmd`], {
      file: 'cmd.exe',
      args: ['/d', '/s', '/c', WIN`"C:\r\node_modules\.bin\vitest.CMD ^^^"run^^^" ^^^"a^^^&b^^^""`],
      verbatim: true,
    }],
    ['W5', ['nope'], { PATH: WIN`C:\n`, PATHEXT: '.EXE;.CMD' }, [], null],
    ['W6', ['npm', 'test'], { Path: WIN`C:\n`, ComSpec: WIN`C:\Windows\system32\cmd.exe` }, [WIN`C:\n\npm.cmd`], { file: WIN`C:\Windows\system32\cmd.exe`, args: W1_ARGS, verbatim: true }],
    ['W7', ['npm', 'test'], { PATH: WIN`C:\n`, PATHEXT: '.EXE;.CMD' }, [WIN`C:\r\npm.cmd`], null],
  ]

  it.each(WINDOWS_ROWS)('56. [O8] windowsInvocation %s', (_row, argv, env, files, expected) => {
    const known = new Set(files.map((f) => f.toLowerCase()))
    const isFile = (p) => known.has(p.toLowerCase())
    expect(windowsInvocation(argv, { root: WIN`C:\r`, env, isFile })).toEqual(expected)
  })
})

// ---- B. CLI basics (13) ------------------------------------------------------------------

describe('release.mjs CLI basics [FEAT-035]', () => {
  it.each([['digest'], ['check'], ['handoff']])('7. %s with no profile refuses RELEASE_NOT_CONFIGURED', (verb) => {
    project(null)
    const r = rel([verb, '--version', '1.1.0'])
    expect(r).toEqual({ status: 2, out: '', err: `${NOT_CONFIGURED}\n` })
  })

  it('8. a profile written but not committed is not configured', () => {
    project(null)
    put('.claude/release-profile.json', jsonText(PROFILE))
    const r = rel(['digest', '--version', '1.1.0', '--items', 'FEAT-001'])
    expect(r.status).toBe(2)
    expect(r.err).toContain('RELEASE_NOT_CONFIGURED')
  })

  it('9. a directory that is not a repository refuses RELEASE_NOT_A_REPO', () => {
    const dir = fresh()
    const r = rel(['digest', '--version', '1.1.0'], '', dir)
    expect(r.status).toBe(2)
    expect(r.err).toContain('RELEASE_NOT_A_REPO')
  })

  it.each([
    [[]],
    [['bogus']],
    [['digest']],
    [['digest', '--version']],
    [['digest', '--version', '1.1.0', '--items']],
    [['handoff', '--version', '1.1.0', '--pr', 'x']],
    [['digest', '--version', '1.1.0', '--items', 'FEAT-001,FEAT-001']],
  ])('10. %j refuses RELEASE_USAGE', (args) => {
    project()
    expect(rel(args)).toEqual({ status: 2, out: '', err: `release: RELEASE_USAGE: ${USAGE}\n` })
  })

  it('11. a committed 21-path profile refuses RELEASE_SURFACE_TOO_WIDE', () => {
    project(wide(19))
    const r = rel(['digest', '--version', '1.1.0', '--items', 'FEAT-001'])
    expect(r.status).toBe(2)
    expect(r.err).toContain('RELEASE_SURFACE_TOO_WIDE')
  })
})

// ---- C. init (13) ------------------------------------------------------------------------

describe('release.mjs init [FEAT-035]', () => {
  const LAST = 'release: proposal written to .conductor/release/profile.proposed.json; review it, then run init --confirm'
  const PUBLISH_GH = ['gh', 'release', 'create', '{tag}', '--verify-tag', '--title', '{tag}', '--notes-file', '{notes}']

  it('12. proposes the npm layout from the project files and writes only the proposal', () => {
    initProject()
    const before = walk(root)
    const r = rel(['init'])
    expect(r.status).toBe(0)
    expect(walk(root).filter((f) => !before.includes(f))).toEqual(['.conductor/release/profile.proposed.json'])
    expect(proposalFile()).toEqual({
      versions: [
        { path: 'package.json', json: ['version'] },
        { path: 'package-lock.json', json: ['version'] },
        { path: 'package-lock.json', json: ['packages', '', 'version'] },
      ],
      changelog: { path: 'CHANGELOG.md', heading: '## {version} ({date})' },
      tag: 'v{version}',
      remote: 'origin',
      mainline: 'trunk',
      checks: [{ name: 'test', argv: ['npm', 'test'] }],
      publish: { target: 'the npm registry', argv: ['npm', 'publish'] },
    })
    expect(r.out).not.toContain('(default)')
    expect(lines(r.out).at(-1)).toBe(LAST)
  })

  it('13. proposes a pyproject.toml project, marking the defaults', () => {
    fresh()
    git('init', '-q', '-b', 'main')
    put('.gitignore', '.conductor/\n')
    put('pyproject.toml', '[project]\nname = "demo"\nversion = "0.4.0"\n')
    put('HISTORY.md', '# Release 0.4.0\n')
    commit('chore: base')
    git('tag', '0.4.0')
    const r = rel(['init'])
    expect(r.status).toBe(0)
    expect(proposalFile()).toEqual({
      versions: [{ path: 'pyproject.toml', line: 'version = "{version}"' }],
      changelog: { path: 'HISTORY.md', heading: '# Release {version}' },
      tag: '{version}',
      remote: 'origin',
      mainline: 'main',
      checks: [],
      publish: null,
    })
    for (const field of ['remote', 'mainline', 'checks', 'publish']) {
      expect(lines(r.out).find((l) => l.startsWith(`PROPOSED ${field} `))).toContain('(default)')
    }
  })

  it('14. a workflow listening for a published release proposes the gh release step', () => {
    initProject()
    put('.github/workflows/pub.yml', 'on:\n  release:\n    types: [published]\n')
    expect(rel(['init']).status).toBe(0)
    expect(proposalFile().publish).toEqual({ target: 'the GitHub Release .github/workflows/pub.yml listens for', argv: PUBLISH_GH })
  })

  it('15. no tag marks the tag format as a default', () => {
    initProject({ tag: false })
    const r = rel(['init'])
    expect(proposalFile().tag).toBe('v{version}')
    expect(lines(r.out).find((l) => l.startsWith('PROPOSED tag '))).toContain('(default)')
  })

  it('16. locations that disagree refuse RELEASE_INIT_VERSIONS_DISAGREE', () => {
    fresh()
    git('init', '-q', '-b', 'main')
    put('VERSION', '1.0.0\n')
    put('package.json', jsonText({ name: 'demo', version: '1.1.0' }))
    commit('chore: base')
    const r = rel(['init'])
    expect(r.status).toBe(2)
    expect(r.err).toContain('RELEASE_INIT_VERSIONS_DISAGREE')
    expect(r.err).toContain('VERSION 1.0.0, package.json 1.1.0')
    expect(existsSync(join(root, '.conductor', 'release', 'profile.proposed.json'))).toBe(false)
  })

  it('17. [O7] no changelog file proposes null as a default', () => {
    initProject({ changelog: false })
    const r = rel(['init'])
    expect(r.status).toBe(0)
    expect(proposalFile().changelog).toBeNull()
    expect(lines(r.out)).toContain('PROPOSED changelog null (default)')
  })

  it.each([['at HEAD', true], ['in the tree', false]])('18. an existing profile %s refuses RELEASE_PROFILE_EXISTS', (_label, committed) => {
    if (committed) project(PROFILE)
    else { project(null); put('.claude/release-profile.json', jsonText(PROFILE)) }
    const r = rel(['init'])
    expect(r.status).toBe(2)
    expect(r.err).toContain('RELEASE_PROFILE_EXISTS')
  })

  it('19. init --confirm writes the proposal bytes unchanged', () => {
    initProject()
    rel(['init'])
    const r = rel(['init', '--confirm'])
    expect(r.status).toBe(0)
    expect(r.out.trim()).toBe('release: profile written; commit it before releasing')
    expect(read('.claude/release-profile.json')).toBe(read('.conductor/release/profile.proposed.json'))
  })

  it('20. init --confirm refuses an edited proposal with empty checks', () => {
    initProject()
    rel(['init'])
    put('.conductor/release/profile.proposed.json', jsonText({ ...proposalFile(), checks: [] }))
    const r = rel(['init', '--confirm'])
    expect(r.status).toBe(2)
    expect(r.err).toContain('RELEASE_PROFILE_INVALID: checks: ')
    expect(existsSync(join(root, '.claude', 'release-profile.json'))).toBe(false)
  })

  it('21. init --confirm refuses a profile git ignores', () => {
    initProject()
    rel(['init'])
    put('.gitignore', '.conductor/\n.claude/\n')
    const r = rel(['init', '--confirm'])
    expect(r.status).toBe(2)
    expect(r.err).toContain('RELEASE_PROFILE_IGNORED')
    expect(existsSync(join(root, '.claude', 'release-profile.json'))).toBe(false)
  })

  it('22. init --confirm refuses a 21-path proposal', () => {
    initProject()
    rel(['init'])
    const versions = Array.from({ length: 20 }, (_, i) => ({ path: `v${i}.txt`, line: 'v={version}' }))
    put('.conductor/release/profile.proposed.json', jsonText({ ...proposalFile(), versions }))
    const r = rel(['init', '--confirm'])
    expect(r.status).toBe(2)
    expect(r.err).toContain('RELEASE_SURFACE_TOO_WIDE')
  })

  it('23. init --confirm with no proposal refuses RELEASE_PROFILE_INVALID', () => {
    initProject()
    const r = rel(['init', '--confirm'])
    expect(r.status).toBe(2)
    expect(r.err).toContain('RELEASE_PROFILE_INVALID: proposal: ')
  })
})

// ---- D. digest (16) ----------------------------------------------------------------------

describe('release.mjs digest [FEAT-035]', () => {
  const DIGEST_ARGS = ['digest', '--version', '1.1.0', '--items', 'FEAT-001', '--date', DATE]

  it('24. prints the digest, line by line', () => {
    project()
    const r = rel(DIGEST_ARGS)
    expect(r.status).toBe(0)
    const out = lines(r.out)
    const commitLine = out.find((l) => l.startsWith('COMMIT '))
    expect(commitLine).toMatch(/^COMMIT [0-9a-f]+ feat: alpha work$/)
    expect(out).toEqual([
      `RELEASE 1.1.0 FROM 1.0.0 DATE ${DATE}`,
      `PROFILE ${gitOut('rev-parse', 'HEAD:.claude/release-profile.json')}`,
      'SURFACE VERSION',
      'SURFACE package.json',
      'SURFACE package-lock.json',
      'SURFACE CHANGELOG.md',
      'SURFACE BACKLOG.md',
      'LOCATION VERSION line 1 1.1.0',
      'LOCATION package.json json ["version"] 1.1.0',
      'LOCATION package-lock.json json ["version"] 1.1.0',
      'LOCATION package-lock.json json ["packages","","version"] 1.1.0',
      `CHANGELOG CHANGELOG.md HEADING ## [1.1.0] - ${DATE} AT 3`,
      'ITEM FEAT-001 1 Alpha',
      'CLOSED ### [X] `[FEAT-001]` Alpha',
      `DONE * **DONE, shipped as \`1.1.0\` on ${DATE}.**`,
      'CLAIM **[FEAT-001]**',
      commitLine,
      'CHECK alpha ok',
      'CHECK beta ok',
    ])
  })

  it('25. without --date the DATE is today (UTC)', () => {
    project()
    const before = new Date().toISOString().slice(0, 10)
    const r = rel(['digest', '--version', '1.1.0', '--items', 'FEAT-001'])
    const after = new Date().toISOString().slice(0, 10)
    expect(r.status).toBe(0)
    const date = r.out.match(/^RELEASE 1\.1\.0 FROM 1\.0\.0 DATE (\S+)$/m)[1]
    expect([before, after]).toContain(date)
  })

  const GOOD = ['--version', '1.1.0', '--items', 'FEAT-001']
  const REFUSALS = [
    ['a dirty tree', () => { put('VERSION', '9.9.9\n'); put('notes.txt', 'x\n') }, ['digest', ...GOOD], 'RELEASE_TREE_DIRTY', ['VERSION', 'notes.txt']],
    ['1.1', null, ['digest', '--version', '1.1', '--items', 'FEAT-001'], 'RELEASE_VERSION_INVALID: 1.1: only MAJOR.MINOR.PATCH is supported', []],
    ['v1.1.0', null, ['digest', '--version', 'v1.1.0', '--items', 'FEAT-001'], 'RELEASE_VERSION_INVALID: v1.1.0: only MAJOR.MINOR.PATCH is supported', []],
    ['1.0.0', null, ['digest', '--version', '1.0.0', '--items', 'FEAT-001'], 'RELEASE_VERSION_NOT_ADVANCED', []],
    ['0.9.9', null, ['digest', '--version', '0.9.9', '--items', 'FEAT-001'], 'RELEASE_VERSION_NOT_ADVANCED', []],
    ['an unknown item', null, ['digest', '--version', '1.1.0', '--items', 'FEAT-404'], 'RELEASE_ITEM_UNKNOWN', []],
    ['a closed item', null, ['digest', '--version', '1.1.0', '--items', 'FEAT-003'], 'RELEASE_ITEM_NOT_OPEN', []],
    ['VERSION matching twice', () => { put('VERSION', '1.0.0\n1.0.0\n'); commit('chore: twice') }, ['digest', ...GOOD], 'RELEASE_PROFILE_AMBIGUOUS', []],
    ['package.json with no version', () => { put('package.json', jsonText({ name: 'demo' })); commit('chore: no version') }, ['digest', ...GOOD], 'RELEASE_PROFILE_AMBIGUOUS', []],
    ['no --items with a backlog bound', null, ['digest', '--version', '1.1.0'], 'RELEASE_USAGE', ['--items is required']],
  ]

  it.each(REFUSALS)('26. refuses %s', (_name, setup, args, code, more) => {
    project()
    if (setup) setup()
    const r = rel(args)
    expect(r.status).toBe(2)
    expect(r.out).toBe('')
    expect(r.err).toContain(code)
    for (const text of more) expect(r.err).toContain(text)
  })

  it('27. --items with no backlog bound refuses RELEASE_ITEMS_UNBOUND', () => {
    project(NOBL)
    const r = rel(['digest', '--version', '1.1.0', '--items', 'FEAT-001'])
    expect(r.status).toBe(2)
    expect(r.err).toContain('RELEASE_ITEMS_UNBOUND')
  })

  it('28. with no backlog the digest lists commits since the tag and no item lines', () => {
    project(NOBL)
    const out = lines(rel(['digest', '--version', '1.1.0']).out)
    expect(out.filter((l) => l.startsWith('COMMIT '))).toHaveLength(1)
    expect(out.find((l) => l.startsWith('COMMIT '))).toMatch(/ feat: alpha work$/)
    expect(out.filter((l) => /^(ITEM|CLOSED|DONE|CLAIM) /.test(l))).toEqual([])
  })

  it('29. caps the commit list at 200 and counts the rest', () => {
    project(NOBL)
    git('tag', '-d', 'v1.0.0')
    let stream = ''
    for (let i = 0; i < 202; i++) {
      stream += `commit refs/heads/main\ncommitter t <t@example.com> ${1700000000 + i} +0000\ndata 8\nc${String(i).padStart(6, '0')}\n`
      if (i === 0) stream += 'from refs/heads/main^0\n'
      stream += `M 100644 inline bulk/${i}.txt\ndata ${String(i).length + 1}\n${i}\n\n`
    }
    const fi = spawnSync('git', ['fast-import', '--quiet'], { cwd: root, env: cleanGitEnv(), input: stream, encoding: 'utf8' })
    expect(fi.status).toBe(0)
    git('reset', '-q', '--hard')
    const out = lines(rel(['digest', '--version', '1.1.0']).out)
    expect(out.filter((l) => l.startsWith('COMMIT '))).toHaveLength(200)
    expect(out).toContain('COMMITS-TRUNCATED 4')
  })

  it('57. [O7] a null changelog prints CHANGELOG none and no claim', () => {
    project(NOCL)
    let r = rel(['digest', '--version', '1.1.0'])
    expect(r.status).toBe(0)
    let out = lines(r.out)
    expect(out.filter((l) => l.startsWith('SURFACE '))).toEqual(['SURFACE VERSION', 'SURFACE package.json', 'SURFACE package-lock.json'])
    expect(out).toContain('CHANGELOG none')
    expect(out.find((l) => l.startsWith('COMMIT '))).toMatch(/ feat: alpha work$/)

    project(NOCLB)
    r = rel(['digest', '--version', '1.1.0', '--items', 'FEAT-001'])
    expect(r.status).toBe(0)
    out = lines(r.out)
    expect(out).toContain('CHANGELOG none')
    expect(out).toContain('ITEM FEAT-001 1 Alpha')
    expect(out).toContain('CLOSED ### [X] `[FEAT-001]` Alpha')
    expect(out.some((l) => l.startsWith('DONE '))).toBe(true)
    expect(out.some((l) => l.startsWith('CLAIM '))).toBe(false)
  })
})

// ---- E. halts (10) -----------------------------------------------------------------------

describe('release.mjs halts on a red check [FEAT-035]', () => {
  const DIGEST = ['digest', '--version', '1.1.0', '--items', 'FEAT-001']

  it('30. [E1] red alpha halts digest by name, with its output and nothing else', () => {
    project()
    put('red-a', '')
    const r = rel(DIGEST)
    expect(r.status).toBe(1)
    expect(r.out).toBe('release: RELEASE_HALT alpha: exit 3\n  a out\n  a err\n')
  })

  it('31. [E1] red beta halts digest by name; alpha prints nothing', () => {
    project()
    put('red-b', '')
    const r = rel(DIGEST)
    expect(r.status).toBe(1)
    expect(r.out).toBe('release: RELEASE_HALT beta: exit 4\n  b out\n  b err\n')
    expect(r.out).not.toContain('a out')
  })

  it('32. [E1] a program that cannot start halts exit 127 with one indented line', () => {
    project({ ...clone(PROFILE), checks: [{ name: 'ghost', argv: ['cc-no-such-binary-035'] }, ...PROFILE.checks] })
    const r = rel(DIGEST)
    expect(r.status).toBe(1)
    const out = lines(r.out)
    expect(out[0]).toBe('release: RELEASE_HALT ghost: exit 127')
    expect(out).toHaveLength(2)
    expect(out[1]).toMatch(/^ {2}\S/)
  })

  it('33. [E1] check halts on a red instrument and leaves the diff untouched', () => {
    project()
    applyRelease({ v: '1.1.0', items: ['FEAT-001'] })
    put('red-b', '')
    const before = gitOut('diff')
    const r = rel(checkArgs('1.1.0', 'FEAT-001'), report('1.1.0', ['FEAT-001']))
    expect(r.status).toBe(1)
    expect(r.out).toContain('release: RELEASE_HALT beta: exit 4')
    expect(gitOut('diff')).toBe(before)
  })

  it('34. [E1] handoff halts on a red instrument before any step or file', () => {
    project()
    applyRelease({ v: '1.1.0', items: ['FEAT-001'] })
    merge()
    put('red-a', '')
    const r = rel(['handoff', '--version', '1.1.0', '--pr', '7'])
    expect(r.status).toBe(1)
    expect(r.out).toContain('release: RELEASE_HALT alpha: exit 3')
    expect(r.out).not.toContain('STEP')
    expect(existsSync(join(root, '.conductor', 'release'))).toBe(false)
  })

  it('35. [E1] this repository\'s profile drives copies of its two instruments', () => {
    gateProject()
    const r = rel(['digest', '--version', '1.0.1', ...GATE_ARGS])
    expect(r.status).toBe(0)
    const out = lines(r.out)
    expect(out.indexOf('CHECK version-gate ok')).toBeGreaterThan(-1)
    expect(out.indexOf('CHECK record-parity ok')).toBe(out.indexOf('CHECK version-gate ok') + 1)
  })

  it('36. [E1] version-gate halts when the version locations disagree', () => {
    gateProject()
    put('VERSION', '1.0.1\n')
    commit('chore: disagree')
    const r = rel(['digest', '--version', '1.0.2', ...GATE_ARGS])
    expect(r.status).toBe(1)
    expect(r.out.split('\n')[0]).toBe('release: RELEASE_HALT version-gate: exit 1')
    expect(r.out).toContain('  FAIL ')
    expect(r.out).toContain('VERSION_GATE_FAILED')
  })

  it('37. [E1] record-parity halts on a claim whose heading is still open', () => {
    gateProject()
    put('CHANGELOG.md', '## [1.0.0] - 2026-01-01\n\n### Added\n\n- First.\n- **[FEAT-900]** Demo.\n')
    commit('chore: premature claim')
    const r = rel(['digest', '--version', '1.0.1', ...GATE_ARGS])
    expect(r.status).toBe(1)
    expect(r.out.split('\n')[0]).toBe('release: RELEASE_HALT record-parity: exit 1')
    expect(r.out).toContain('  FAIL [A] 1.0.0 claims FEAT-900 but its heading reads [ ]')
  })

  it('38. [E1] check runs both instruments on a correct release', () => {
    gateProject()
    applyRelease({ v: '1.0.1', items: ['FEAT-900'], backlog: 'AGENT-READABLE BACKLOG.md' })
    const r = rel(checkArgs('1.0.1', 'FEAT-900'), report('1.0.1', ['FEAT-900']))
    expect(r.status).toBe(0)
    expect(lines(r.out)).toEqual(['CHECK version-gate ok', 'CHECK record-parity ok', 'release: ok 1.0.1 items FEAT-900'])
  })
})

describe('release.mjs on win32 [FEAT-035]', () => {
  it.skipIf(process.platform !== 'win32')('[O8] the npm test check --init proposes starts, passes when green and halts by name when red', () => {
    fresh()
    git('init', '-q', '-b', 'main')
    put('.gitignore', '.conductor/\nred-*\n')
    put('package.json', jsonText({ name: 'demo', version: '1.0.0', scripts: { test: 'node t.mjs' } }))
    put('package-lock.json', lockText('1.0.0'))
    put('CHANGELOG.md', '## [1.0.0] - 2026-01-01\n')
    put('t.mjs', checkScript('t', 3, 'red-t'))
    commit('chore: base')
    expect(rel(['init']).status).toBe(0)
    expect(proposalFile().checks).toEqual([{ name: 'test', argv: ['npm', 'test'] }])
    expect(rel(['init', '--confirm']).status).toBe(0)
    commit('chore: profile')
    const green = rel(['digest', '--version', '1.0.1'])
    expect(green.status).toBe(0)
    expect(green.out).toContain('CHECK test ok')
    put('red-t', '')
    const red = rel(['digest', '--version', '1.0.1'])
    expect(red.status).toBe(1)
    expect(red.out.split('\n')[0]).toBe('release: RELEASE_HALT test: exit 3')
    expect(red.out).toContain('  t out')
    expect(red.out).toContain('  t err')
  })
})

// ---- F. check (31) -----------------------------------------------------------------------

describe('release.mjs check [FEAT-035]', () => {
  const V = '1.1.0'
  const ITEM = ['FEAT-001']
  const SURFACE = '[VERSION, package.json, package-lock.json, CHANGELOG.md, BACKLOG.md]'
  const sub = (file, from, to) => put(file, read(file).replace(from, to))
  const release1 = () => { project(); applyRelease({ v: V, items: ITEM }) }
  const ok = report(V, ITEM)

  it('39. [E2] a correct release passes and check never writes', () => {
    release1()
    const status = gitOut('status', '--porcelain')
    const files = ['VERSION', 'package.json', 'package-lock.json', 'CHANGELOG.md', 'BACKLOG.md'].map((f) => read(f))
    const r = rel(checkArgs(V, 'FEAT-001'), ok)
    expect(r.status).toBe(0)
    expect(lines(r.out)).toEqual(['CHECK alpha ok', 'CHECK beta ok', 'release: ok 1.1.0 items FEAT-001'])
    expect(gitOut('status', '--porcelain')).toBe(status)
    expect(['VERSION', 'package.json', 'package-lock.json', 'CHANGELOG.md', 'BACKLOG.md'].map((f) => read(f))).toEqual(files)
  })

  const DEVIATIONS = [
    ['an untracked file', () => put('notes.txt', 'x\n'), ok, `RELEASE_OUT_OF_SCOPE: notes.txt is outside the release surface ${SURFACE}`],
    ['an edited check script', () => put('checks/a.mjs', `${read('checks/a.mjs')}// edit\n`), ok, 'RELEASE_OUT_OF_SCOPE: checks/a.mjs '],
    ['an edited profile', () => put('.claude/release-profile.json', `${read('.claude/release-profile.json')}\n`), ok, 'RELEASE_PROFILE_CHANGED'],
    ['a changed package.json name', () => put('package.json', jsonText({ name: 'other', version: V })), ok, 'RELEASE_LOCATION_SHAPE: package.json'],
    ['package.json re-indented', () => put('package.json', JSON.stringify({ name: 'demo', version: V }, null, 4) + '\n'), ok, 'RELEASE_LOCATION_SHAPE: package.json'],
    ['the lockfile with only version moved', () => put('package-lock.json', lockText('1.0.0').replace('"version": "1.0.0"', `"version": "${V}"`)), ok, 'RELEASE_LOCATION_SHAPE: package-lock.json'],
    ['VERSION with a second line', () => put('VERSION', `${V}\nextra\n`), ok, 'RELEASE_LOCATION_SHAPE: VERSION'],
    ['VERSION left at 1.0.0', () => put('VERSION', '1.0.0\n'), ok, 'RELEASE_LOCATION_SHAPE: VERSION'],
    ['a removed changelog line', () => sub('CHANGELOG.md', '- First.\n', ''), ok, 'RELEASE_CHANGELOG_SHAPE'],
    ['a second bullet at the end of the changelog', () => put('CHANGELOG.md', `${read('CHANGELOG.md')}- Extra.\n`), ok, 'RELEASE_CHANGELOG_SHAPE'],
    ['the heading dated another day', () => sub('CHANGELOG.md', `## [${V}] - ${DATE}`, `## [${V}] - 2026-02-03`), ok, 'RELEASE_CHANGELOG_SHAPE'],
    ['the entry inserted after the old heading', () => put('CHANGELOG.md', `# Changelog\n\n## [1.0.0] - 2026-01-01\n\n## [${V}] - ${DATE}\n\n### Added\n\n- **[FEAT-001]** Shipped FEAT-001.\n\n### Added\n\n- First.\n`), ok, 'RELEASE_CHANGELOG_SHAPE'],
    ['the closed heading title changed', () => sub('BACKLOG.md', '### [X] `[FEAT-001]` Alpha', '### [X] `[FEAT-001]` Alphax'), ok, 'RELEASE_BACKLOG_SHAPE'],
    ['FEAT-002 flipped too', () => sub('BACKLOG.md', '### [ ] `[FEAT-002]` Beta', `### [X] \`[FEAT-002]\` Beta\n* **DONE, shipped as \`${V}\` on ${DATE}.**`), ok, 'RELEASE_BACKLOG_SHAPE'],
    ['no DONE line', () => sub('BACKLOG.md', `* **DONE, shipped as \`${V}\` on ${DATE}.**\n`, ''), ok, 'RELEASE_BACKLOG_SHAPE'],
    ['Body two. edited', () => sub('BACKLOG.md', 'Body two.', 'Body 2.'), ok, 'RELEASE_BACKLOG_SHAPE'],
    ['a second bullet claiming FEAT-002', () => sub('CHANGELOG.md', '- **[FEAT-001]** Shipped FEAT-001.', '- **[FEAT-001]** Shipped FEAT-001.\n- **[FEAT-002]** Extra.'), ok, 'RELEASE_CLAIMS_MISMATCH'],
    ['a bullet without its claim token', () => sub('CHANGELOG.md', '- **[FEAT-001]** Shipped FEAT-001.', '- Shipped FEAT-001.'), ok, 'RELEASE_CLAIMS_MISMATCH'],
    ['a report with no RELEASE: line', () => {}, 'SNAP_HANDBACK {"v":6}\n', 'RELEASE_RESULT_MISSING: the report has no RELEASE: line'],
    ['a report with two RELEASE: lines', () => {}, `RELEASE: ${V} items FEAT-001\nRELEASE: ${V} items FEAT-001\n`, 'RELEASE_RESULT_MISSING: the report has 2 RELEASE: lines'],
    ['a report naming another version', () => {}, 'RELEASE: 1.2.0 items FEAT-001\n', 'RELEASE_RESULT_INCONSISTENT'],
    ['a report naming no items', () => {}, `RELEASE: ${V}\n`, 'RELEASE_RESULT_INCONSISTENT'],
  ]

  it.each(DEVIATIONS)('40. [E2] fails on %s', (_name, mutate, text, detail) => {
    release1()
    mutate()
    const r = rel(checkArgs(V, 'FEAT-001'), text)
    expect(r.status).toBe(1)
    expect(r.out).toContain(`release: ${detail}`)
    expect(r.out).not.toContain('CHECK ')
  })

  it('41. three deviations print three failure lines in order and run no check', () => {
    release1()
    put('red-a', '')
    put('notes.txt', 'x\n')
    put('VERSION', '1.0.0\n')
    const r = rel(checkArgs(V, 'FEAT-001'), '')
    expect(r.status).toBe(1)
    const out = lines(r.out)
    expect(out).toHaveLength(5)
    expect(out[0]).toMatch(/^release: RELEASE_OUT_OF_SCOPE: notes\.txt /)
    expect(out[1]).toMatch(/^release: RELEASE_LOCATION_SHAPE: VERSION/)
    expect(out[2]).toMatch(/^release: RELEASE_RESULT_MISSING/)
    expect(out[3]).toBe('release: DISCARD git --literal-pathspecs checkout HEAD -- BACKLOG.md CHANGELOG.md package-lock.json package.json')
    expect(out[4]).toBe('release: DISCARD git --literal-pathspecs clean -f -- notes.txt')
    expect(r.out).not.toContain('RELEASE_HALT')
  })

  it.each([
    ['a closed item', ['check', '--version', V, '--items', 'FEAT-003', '--date', DATE], 'RELEASE_ITEM_NOT_OPEN'],
    ['a version that does not advance', ['check', '--version', '1.0.0', '--items', 'FEAT-001', '--date', DATE], 'RELEASE_VERSION_NOT_ADVANCED'],
  ])('42. refuses %s from HEAD as digest does', (_name, args, code) => {
    project()
    const r = rel(args, ok)
    expect(r.status).toBe(2)
    expect(r.err).toContain(code)
  })

  it('43. [O4] without a backlog, version locations and an entry pass', () => {
    project(NOBL)
    applyRelease({ v: V })
    const r = rel(checkArgs(V), report(V))
    expect(r.status).toBe(0)
    expect(lines(r.out).at(-1)).toBe('release: ok 1.1.0')
  })

  it('44. [O4] without a backlog, an edited backlog file is out of scope', () => {
    project(NOBL)
    applyRelease({ v: V })
    put('BACKLOG.md', `${read('BACKLOG.md')}extra\n`)
    const r = rel(checkArgs(V), report(V))
    expect(r.status).toBe(1)
    expect(r.out).toContain('RELEASE_OUT_OF_SCOPE: BACKLOG.md ')
  })

  it('45. two items in one entry pass', () => {
    project()
    applyRelease({ v: V, items: ['FEAT-001', 'FEAT-002'] })
    const r = rel(checkArgs(V, 'FEAT-001,FEAT-002'), report(V, ['FEAT-001', 'FEAT-002']))
    expect(r.status).toBe(0)
    expect(lines(r.out).at(-1)).toBe('release: ok 1.1.0 items FEAT-001,FEAT-002')
  })

  it('59. [O7] a null changelog: a version-only diff passes, with a backlog the flips are still judged', () => {
    project(NOCL)
    applyRelease({ v: V, changelog: false })
    let r = rel(checkArgs(V), report(V))
    expect(r.status).toBe(0)
    expect(lines(r.out).at(-1)).toBe('release: ok 1.1.0')

    project(NOCLB)
    applyRelease({ v: V, items: ITEM, changelog: false })
    r = rel(checkArgs(V, 'FEAT-001'), ok)
    expect(r.status).toBe(0)
    expect(lines(r.out).at(-1)).toBe('release: ok 1.1.0 items FEAT-001')

    sub('BACKLOG.md', `* **DONE, shipped as \`${V}\` on ${DATE}.**\n`, '')
    r = rel(checkArgs(V, 'FEAT-001'), ok)
    expect(r.status).toBe(1)
    expect(r.out).toContain('RELEASE_BACKLOG_SHAPE')
  })

  it('60. [O7] a null changelog: a changelog edit is out of scope', () => {
    project(NOCL)
    applyRelease({ v: V, changelog: false })
    put('CHANGELOG.md', `${read('CHANGELOG.md')}- Extra.\n`)
    const r = rel(checkArgs(V), report(V))
    expect(r.status).toBe(1)
    expect(r.out).toContain('RELEASE_OUT_OF_SCOPE: CHANGELOG.md is outside the release surface [VERSION, package.json, package-lock.json]')
  })
})

describe('release.mjs check discards a rejected diff [BUG-090]', () => {
  const V = '1.1.0'
  const SURFACE = '[VERSION, package.json, package-lock.json, CHANGELOG.md, BACKLOG.md]'
  const release1 = () => { project(); applyRelease({ v: V, items: ['FEAT-001'] }) }
  const ok = report(V, ['FEAT-001'])
  const check = (text = ok) => rel(checkArgs(V, 'FEAT-001'), text)
  const sub = (file, from, to) => put(file, read(file).replace(from, to))
  const discards = (out) => lines(out).filter((l) => l.startsWith('release: DISCARD '))
  const runDiscards = (out) => {
    for (const line of discards(out)) {
      // The fixture commits with core.autocrlf=false; a Windows runner defaults it to true, and the
      // printed git commands would then restore CRLF files that status reports as modified.
      const env = { ...cleanGitEnv(), GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.autocrlf', GIT_CONFIG_VALUE_0: 'false' }
      const r = spawnSync('bash', ['-c', line.slice('release: DISCARD '.length)], { cwd: root, env, encoding: 'utf8' })
      expect(r.status, `${line}: ${r.stderr}`).toBe(0)
    }
  }
  const CP = 'which project tooling reads; discard the whole diff before running any package manager, test, build or hook command'

  it('[AC1] a postinstall script in package.json and a new .npmrc print the warning and both discard commands after the failure lines', () => {
    release1()
    const pkg = JSON.parse(read('package.json'))
    put('package.json', jsonText({ ...pkg, scripts: { postinstall: 'node x.js' } }))
    put('.npmrc', 'x=1\n')
    const r = check()
    expect(r.status).toBe(1)
    expect(lines(r.out)).toEqual([
      `release: RELEASE_OUT_OF_SCOPE: .npmrc is outside the release surface ${SURFACE}`,
      'release: RELEASE_LOCATION_SHAPE: package.json differs from HEAD in more than its version keys',
      `release: RELEASE_DISCARD_FIRST: the rejected diff touches .npmrc, package.json, ${CP}`,
      'release: DISCARD git --literal-pathspecs checkout HEAD -- BACKLOG.md CHANGELOG.md VERSION package-lock.json package.json',
      'release: DISCARD git --literal-pathspecs clean -f -- .npmrc',
    ])
  })

  it.each(['.npmrc', 'sub/package.json'])('[AC2] an out-of-scope control-plane path %s prints the warning', (p) => {
    release1()
    put(p, 'x\n')
    const r = check()
    expect(r.out).toContain(`release: RELEASE_DISCARD_FIRST: the rejected diff touches ${p}, ${CP}`)
    expect(r.out).toContain(`release: DISCARD git --literal-pathspecs clean -f -- ${p}`)
  })

  it('[AC3] an edited profile alone prints the warning and restores the profile from HEAD', () => {
    release1()
    put('.claude/release-profile.json', `${read('.claude/release-profile.json')}\n`)
    const r = check()
    expect(r.out).toContain(`release: RELEASE_DISCARD_FIRST: the rejected diff touches .claude/release-profile.json, ${CP}`)
    expect(r.out).toContain('release: DISCARD git --literal-pathspecs checkout HEAD -- .claude/release-profile.json BACKLOG.md CHANGELOG.md VERSION package-lock.json package.json')
  })

  it.each([
    ['an untracked notes.txt', () => put('notes.txt', 'x\n')],
    ['a changelog shape', () => sub('CHANGELOG.md', '- First.\n', '')],
  ])('[AC4] a failure on %s alone prints no warning but the discard commands', (_name, edit) => {
    release1()
    edit()
    const r = check()
    expect(r.status).toBe(1)
    expect(r.out).not.toContain('RELEASE_DISCARD_FIRST')
    expect(discards(r.out).length).toBeGreaterThan(0)
  })

  const mixedDiff = () => {
    release1()
    put('docs/new.md', 'x\n')
    git('add', 'docs/new.md')
    put('notes.txt', 'x\n')
    rmSync(join(root, 'src/a.js'))
  }

  it('[AC5] each path of the diff is on exactly one command, by its git state, sorted', () => {
    mixedDiff()
    const r = check()
    expect(discards(r.out)).toEqual([
      'release: DISCARD git --literal-pathspecs checkout HEAD -- BACKLOG.md CHANGELOG.md VERSION package-lock.json package.json src/a.js',
      'release: DISCARD git --literal-pathspecs rm -f -- docs/new.md',
      'release: DISCARD git --literal-pathspecs clean -f -- notes.txt',
    ])
    expect(r.out).not.toContain('RELEASE_DISCARD_FIRST')
  })

  it('[AC6] the printed commands, run verbatim, leave the work tree clean', () => {
    mixedDiff()
    const r = check()
    runDiscards(r.out)
    expect(gitOut('status', '--porcelain')).toBe('')
  })

  it.skipIf(process.platform === 'win32')('[AC7] the printed commands remove an untracked :/x and keep the tracked root x and a file created after check', () => {
    project()
    put('x', 'x\n')
    commit('chore: tracked x')
    applyRelease({ v: V, items: ['FEAT-001'] })
    put(':/x', 'x\n')
    const r = check()
    expect(lines(r.out)).toContain('release: DISCARD git --literal-pathspecs clean -f -- :/x')
    put('later.txt', 'x\n')
    runDiscards(r.out)
    expect(existsSync(join(root, ':/x'))).toBe(false)
    expect(read('x')).toBe('x\n')
    expect(existsSync(join(root, 'later.txt'))).toBe(true)
  })

  it('[AC8] a path with a space and a path with a single quote are each left to one DISCARD_BY_HAND line', () => {
    release1()
    put('my notes.txt', 'x\n')
    put("it's.txt", 'x\n')
    const r = check()
    expect(lines(r.out).filter((l) => l === 'release: DISCARD_BY_HAND "my notes.txt"')).toHaveLength(1)
    expect(discards(r.out).some((l) => l.includes('notes.txt'))).toBe(false)
    expect(r.out).toContain('release: DISCARD_BY_HAND "it\'s.txt"')
    expect(discards(r.out).some((l) => l.includes("it's.txt"))).toBe(false)
  })

  it.skipIf(process.platform === 'win32')('[AC8] a path with a newline is on no command and on one DISCARD_BY_HAND line', () => {
    release1()
    put('a\nb.txt', 'x\n')
    const r = check()
    const hand = 'release: DISCARD_BY_HAND "a\\u000ab.txt"'
    expect(lines(r.out).filter((l) => l === hand)).toHaveLength(1)
    expect(r.out).toContain(`release: RELEASE_DISCARD_FIRST: the rejected diff touches "a\\u000ab.txt", ${CP}`)
    expect(discards(r.out).some((l) => l.includes('b.txt'))).toBe(false)
  })

  it('[AC8] a path with U+009B is on no command and its DISCARD_BY_HAND line escapes it as six ASCII characters', () => {
    release1()
    put('a\u009bb.txt', 'x\n')
    const r = check()
    const hand = 'release: DISCARD_BY_HAND "a\\u009bb.txt"'
    expect(lines(r.out).filter((l) => l === hand)).toHaveLength(1)
    expect(r.out).toContain(`release: RELEASE_DISCARD_FIRST: the rejected diff touches "a\\u009bb.txt", ${CP}`)
    expect(discards(r.out).some((l) => l.includes('b.txt'))).toBe(false)
    // RELEASE_OUT_OF_SCOPE keeps printing the raw path (spec, Out of Scope), so only the new lines are checked.
    const added = r.out.split('\n').filter((l) => /^release: (RELEASE_DISCARD_FIRST|DISCARD )|^release: DISCARD_BY_HAND/.test(l))
    expect(added.length).toBeGreaterThan(0)
    for (const l of added) expect(l).not.toMatch(/\p{Cc}/u)
  })

  // PowerShell also closes a quote on U+2019, cmd.exe runs what follows "&", and U+202E reorders the shown line.
  it.each([
    ['U+2019', 'it’s.txt', '"it\\u2019s.txt"'],
    ['&', 'a&b.txt', '"a&b.txt"'],
    ['U+202E', 'a‮txt.b', '"a\\u202etxt.b"'],
  ])('[AC8] a path with %s is on no command and on one DISCARD_BY_HAND line', (_name, path, json) => {
    release1()
    put(path, 'x\n')
    const r = check()
    expect(lines(r.out).filter((l) => l === `release: DISCARD_BY_HAND ${json}`)).toHaveLength(1)
    expect(discards(r.out).some((l) => l.includes(path))).toBe(false)
    const added = r.out.split('\n').filter((l) => /^release: (RELEASE_DISCARD_FIRST|DISCARD)/.test(l))
    for (const l of added) expect(l).toMatch(/^[\x20-\x7e]*$/)
  })

  it.each([
    ['a comma', 'a,b.txt', '"a,b.txt"'],
    ['a leading @', '@x.txt', '"@x.txt"'],
    ['a segment starting with @', 'dir/@x.txt', '"dir/@x.txt"'],
    ['a leading -', '-x.txt', '"-x.txt"'],
    ['a $', 'a$b.txt', '"a$b.txt"'],
  ])('[AC8] a path with %s is on no command and on one DISCARD_BY_HAND line (BUG-095)', (_name, path, json) => {
    release1()
    put(path, 'x\n')
    const r = check()
    expect(lines(r.out).filter((l) => l === `release: DISCARD_BY_HAND ${json}`)).toHaveLength(1)
    expect(discards(r.out).some((l) => l.includes(path))).toBe(false)
  })

  it('[AC8] a path with @ inside a segment stays bare on its command (BUG-095)', () => {
    release1()
    put('a@b.txt', 'x\n')
    const r = check()
    expect(r.out).toContain('release: DISCARD git --literal-pathspecs clean -f -- a@b.txt')
    expect(lines(r.out).some((l) => l.startsWith('release: DISCARD_BY_HAND') && l.includes('a@b.txt'))).toBe(false)
  })

  it('[AC8] no DISCARD command holds a quote, and every path on one is bare (BUG-095)', () => {
    release1()
    for (const p of ['my notes.txt', 'a,b.txt', '@x.txt', '-x.txt', 'a$b.txt', 'a@b.txt', 'k=v.txt']) put(p, 'x\n')
    const r = check()
    const commands = discards(r.out)
    expect(commands.length).toBeGreaterThan(0)
    const isBare = (w) => /^[A-Za-z0-9._/:=@+-]+$/.test(w) && !w.startsWith('-') && !w.split('/').some((s) => s.startsWith('@'))
    for (const l of commands) {
      expect(l).not.toMatch(/['"]/)
      for (const w of l.split(' -- ')[1].split(' ')) expect(isBare(w)).toBe(true)
    }
  })

  it('[AC8] a control-plane path that is not bare is named by its JSON string in the warning (BUG-095)', () => {
    release1()
    put('a,b/package.json', 'x\n')
    const r = check()
    expect(r.out).toContain(`release: RELEASE_DISCARD_FIRST: the rejected diff touches "a,b/package.json", ${CP}`)
    expect(r.out).toContain('release: DISCARD_BY_HAND "a,b/package.json"')
    expect(discards(r.out).some((l) => l.includes('a,b/package.json'))).toBe(false)
  })

  it.each([
    ['release: ok', () => { release1() }, 0],
    ['a RELEASE_HALT', () => { release1(); put('red-a', '') }, 1],
    ['a judgment failure with an empty diff', () => { project() }, 1],
  ])('[AC9] %s prints no warning and no discard command', (name, setup, status) => {
    setup()
    const r = check(name.startsWith('a judgment') ? '' : ok)
    expect(r.status).toBe(status)
    if (name === 'a RELEASE_HALT') expect(r.out).toContain('RELEASE_HALT')
    expect(r.out).not.toContain('DISCARD')
  })

  it('[E1] git failing while classifying the diff is a refusal, not a partial command', () => {
    release1()
    writeFileSync(join(root, '.git', 'index'), 'garbage')
    const r = check()
    expect(r.status).toBe(2)
    expect(r.out).toBe('')
    expect(r.err).toMatch(/^release: RELEASE_GIT_FAILED: /)
  })

  it('[AC13] an out-of-scope path with a non-ASCII character prints the warning', () => {
    release1()
    put('pаckage.json', 'x\n')
    const r = check()
    // A look-alike spelling is outside printable ASCII, so it is escaped and left to a DISCARD_BY_HAND line.
    expect(r.out).toContain(`release: RELEASE_DISCARD_FIRST: the rejected diff touches "p\\u0430ckage.json", ${CP}`)
    expect(r.out).toContain('release: DISCARD_BY_HAND "p\\u0430ckage.json"')
    expect(discards(r.out).some((l) => l.includes('pаckage.json'))).toBe(false)
  })
})

// ---- G. handoff (13) ---------------------------------------------------------------------

describe('release.mjs handoff [FEAT-035]', () => {
  const V = '1.1.0'
  const HANDOFF = ['handoff', '--version', V, '--pr', '7']
  const released = (profile = PROFILE, items = ['FEAT-001']) => { project(profile); applyRelease({ v: V, items }); merge() }
  const noRelease = () => existsSync(join(root, '.conductor', 'release'))

  it('46. [D1, E3] prints the steps against HEAD and writes the notes and the excerpt', () => {
    released()
    put('.conductor/ticket/FEAT-001.md', 'ticket\n')
    const r = rel(HANDOFF)
    expect(r.status).toBe(0)
    const sha = gitOut('rev-parse', 'HEAD')
    expect(lines(r.out)).toEqual([
      'CHECK alpha ok',
      'CHECK beta ok',
      `STEP 1 tag git tag -a v${V} -m v${V} ${sha}`,
      `STEP 2 push git push origin v${V}`,
      'PUBLISH-TARGET the demo registry',
      `STEP 3 publish demo-publish v${V} .conductor/release/${V}/notes.md`,
      `STEP 4 writeback node ${ticketPath()} writeback FEAT-001 --version ${V} --pr 7 --changelog .conductor/release/${V}/FEAT-001.md`,
      `release: handoff ready ${V}`,
    ])
    expect(read(`.conductor/release/${V}/notes.md`)).toBe('### Added\n\n- **[FEAT-001]** Shipped FEAT-001.\n')
    expect(read(`.conductor/release/${V}/FEAT-001.md`)).toBe('- **[FEAT-001]** Shipped FEAT-001.\n')
    expect(gitOut('tag', '-l', `v${V}`)).toBe('')
    expect(r.out).not.toContain('--close')
  })

  it('47. [E3] an item with no bound ticket prints WRITEBACK-NONE', () => {
    released(PROFILE, ['FEAT-001', 'FEAT-002'])
    put('.conductor/ticket/FEAT-001.md', 'ticket\n')
    const out = lines(rel(HANDOFF).out)
    expect(out.some((l) => l.startsWith('STEP 4 writeback ') && l.includes(' writeback FEAT-001 '))).toBe(true)
    expect(out).toContain('WRITEBACK-NONE FEAT-002')
  })

  it('48. [E3] a bound item with no --pr refuses RELEASE_USAGE', () => {
    released()
    put('.conductor/ticket/FEAT-001.md', 'ticket\n')
    const r = rel(['handoff', '--version', V])
    expect(r.status).toBe(2)
    expect(r.err).toContain('RELEASE_USAGE')
    expect(r.err).toContain('--pr is required')
  })

  it('49. [E3] a profile with no ticket prints no writeback line, with or without --pr', () => {
    released(without(PROFILE, 'ticket'))
    for (const args of [HANDOFF, ['handoff', '--version', V]]) {
      const r = rel(args)
      expect(r.status).toBe(0)
      expect(r.out).not.toContain('writeback')
      expect(r.out).not.toContain('WRITEBACK-NONE')
    }
  })

  it('50. [D1] publish null prints only the tag and the push', () => {
    released({ ...clone(PROFILE), publish: null })
    const out = lines(rel(HANDOFF).out)
    expect(out.filter((l) => l.startsWith('STEP ')).map((l) => l.split(' ')[2])).toEqual(['tag', 'push', 'writeback'].slice(0, out.filter((l) => l.startsWith('STEP ')).length))
    expect(out.some((l) => l.startsWith('PUBLISH-TARGET'))).toBe(false)
    expect(out.some((l) => l.startsWith('STEP 3 publish'))).toBe(false)
  })

  const REFUSED = [
    ['an untracked file', () => put('x.txt', 'x\n'), HANDOFF, 'RELEASE_TREE_DIRTY'],
    ['a version not released', () => {}, ['handoff', '--version', '1.2.0', '--pr', '7'], 'RELEASE_NOT_RELEASED'],
    ['the local mainline ref behind HEAD', () => { put('src/b.js', 'x\n'); commit('feat: later'); git('update-ref', 'refs/remotes/origin/main', 'HEAD~1') }, HANDOFF, 'RELEASE_NOT_ON_MAIN'],
    ['no local mainline ref', () => { git('update-ref', '-d', 'refs/remotes/origin/main') }, HANDOFF, 'RELEASE_NOT_ON_MAIN: no local ref'],
    ['an existing tag', () => { git('tag', `v${V}`) }, HANDOFF, `RELEASE_TAG_EXISTS: v${V} already exists`],
  ]

  it.each(REFUSED)('51. [D1] refuses %s', (_name, setup, args, detail) => {
    released()
    setup()
    const r = rel(args)
    expect(r.status).toBe(2)
    expect(r.err).toContain(detail)
    expect(noRelease()).toBe(false)
  })

  it('52. [E3] a claim excerpt over the cap refuses RELEASE_EXCERPT_TOO_LARGE', () => {
    project()
    applyRelease({ v: V, items: ['FEAT-001'] })
    put('CHANGELOG.md', read('CHANGELOG.md').replace('Shipped FEAT-001.', 'x'.repeat(33000)))
    merge()
    put('.conductor/ticket/FEAT-001.md', 'ticket\n')
    const r = rel(HANDOFF)
    expect(r.status).toBe(2)
    expect(r.err).toContain('RELEASE_EXCERPT_TOO_LARGE')
    expect(noRelease()).toBe(false)
  })

  it('53. [D1] a publish argument with a space is shell-quoted', () => {
    released({ ...clone(PROFILE), publish: { target: 'the demo registry', argv: ['demo-publish', '{tag}', '--title', 'Release {version}'] } })
    const step = lines(rel(HANDOFF).out).find((l) => l.startsWith('STEP 3 publish'))
    expect(step.endsWith("--title 'Release 1.1.0'")).toBe(true)
  })

  it('61. [O7] a null changelog writes notes.md from the commit subjects and the excerpt from the item title', () => {
    project(NOCL)
    applyRelease({ v: V, changelog: false })
    merge()
    let r = rel(['handoff', '--version', V])
    expect(r.status).toBe(0)
    const out = lines(r.out)
    expect(out).toContain(`STEP 1 tag git tag -a v${V} -m v${V} ${gitOut('rev-parse', 'HEAD')}`)
    expect(out).toContain(`STEP 2 push git push origin v${V}`)
    expect(out).toContain('PUBLISH-TARGET the demo registry')
    expect(out).toContain(`STEP 3 publish demo-publish v${V} .conductor/release/${V}/notes.md`)
    expect(out.some((l) => l.includes('writeback'))).toBe(false)
    expect(read(`.conductor/release/${V}/notes.md`)).toBe('- chore: release\n- feat: alpha work\n')

    project(NOCLB)
    applyRelease({ v: V, items: ['FEAT-001'], changelog: false })
    merge()
    put('.conductor/ticket/FEAT-001.md', 'ticket\n')
    r = rel(HANDOFF)
    expect(r.status).toBe(0)
    expect(lines(r.out).at(-2)).toBe(`STEP 4 writeback node ${ticketPath()} writeback FEAT-001 --version ${V} --pr 7 --changelog .conductor/release/${V}/FEAT-001.md`)
    expect(read(`.conductor/release/${V}/FEAT-001.md`)).toBe('### [X] `[FEAT-001]` Alpha\n')
    expect(read(`.conductor/release/${V}/notes.md`)).toBe('- chore: release\n- feat: alpha work\n')
  })
})

// ---- FEAT-062: version schemes and the prerelease publish step ----------------------------

const GH_ARGV = ['gh', 'release', 'create', '{tag}', '--verify-tag', '--title', '{tag}', '--notes-file', '{notes}']
const NPM_NEXT = { channel: 'next', target: 'the npm registry', argv: ['npm', 'publish', '--tag', '{channel}'] }
const GH_PRE = { channel: 'prerelease', target: 'the GitHub Release', argv: [...GH_ARGV, '--prerelease'] }
const SCRIPT_NEXT = { channel: 'next', target: 'the demo registry', argv: ['./scripts/publish.sh', '{channel}'] }
const pre = (publish, counts = false) => ({ publish, countsAsLastRelease: counts })
const withScheme = (scheme, prerelease, base = PROFILE) => ({ ...clone(base), scheme, ...(prerelease === undefined ? {} : { prerelease }) })
const SCHEME_LIST = 'MAJOR.MINOR.PATCH, semver, pep440, numeric'

describe('release.mjs version schemes in the profile [FEAT-062]', () => {
  const VALID = [
    ['no scheme', clone(PROFILE)],
    ['MAJOR.MINOR.PATCH named', withScheme('MAJOR.MINOR.PATCH')],
    ['semver with an npm prerelease step', withScheme('semver', pre(NPM_NEXT))],
    ['pep440 with an npm prerelease step', withScheme('pep440', pre(NPM_NEXT))],
    ['numeric without prerelease', withScheme('numeric')],
    ['semver with no prerelease publish', withScheme('semver', pre(null))],
    ['semver where a prerelease counts as the last release', withScheme('semver', pre(NPM_NEXT, true))],
  ]

  it.each(VALID)('[E1] validates %s', (_name, profile) => {
    expect(validateProfile(clone(profile))).toEqual(profile)
  })

  const SCHEME_WHY = `must be one of ${SCHEME_LIST}`
  const INVALID = [
    ['an unknown scheme', () => ({ ...clone(PROFILE), scheme: 'calver' }), 'scheme', SCHEME_WHY],
    ['a scheme that is an array', () => ({ ...clone(PROFILE), scheme: ['semver'] }), 'scheme', SCHEME_WHY],
    ['semver without prerelease', () => ({ ...clone(PROFILE), scheme: 'semver' }), 'prerelease', 'required by scheme semver'],
    ['pep440 without prerelease', () => ({ ...clone(PROFILE), scheme: 'pep440' }), 'prerelease', 'required by scheme pep440'],
    ['numeric with prerelease', () => withScheme('numeric', pre(null)), 'prerelease', 'not allowed with scheme numeric'],
    ['no scheme with prerelease', () => ({ ...clone(PROFILE), prerelease: pre(null) }), 'prerelease', 'not allowed with scheme MAJOR.MINOR.PATCH'],
    ['an unknown prerelease key', () => withScheme('semver', { ...pre(null), extra: 1 }), 'prerelease.extra', 'unknown key'],
    ['a non-boolean countsAsLastRelease', () => withScheme('semver', { publish: null, countsAsLastRelease: 'no' }), 'prerelease.countsAsLastRelease', 'must be true or false'],
    ['a channel with a space', () => withScheme('semver', pre({ ...NPM_NEXT, channel: 'a b' })), 'prerelease.publish.channel', 'must match [A-Za-z0-9._-]+'],
    ['a target with a placeholder', () => withScheme('semver', pre({ ...NPM_NEXT, target: 'the {tag} registry' })), 'prerelease.publish.target', 'must be a non-empty single-line string with no placeholder'],
    ['an empty argv', () => withScheme('semver', pre({ ...NPM_NEXT, argv: [] })), 'prerelease.publish.argv', 'must be a non-empty array'],
    ['{channel} in the stable publish argv', () => { const p = clone(PROFILE); p.publish.argv[1] = '{channel}'; return p }, 'publish.argv[1]', 'placeholder {channel} is not allowed here'],
    ['{channel} in the tag', () => ({ ...clone(PROFILE), tag: 'v{version}{channel}' }), 'tag', 'placeholder {channel} is not allowed here'],
  ]

  it.each(INVALID)('[E1] refuses %s', (_name, build, field, why) => {
    const e = refusal(() => validateProfile(build()))
    expect(e).toBeInstanceOf(ReleaseError)
    expect(e.code).toBe('RELEASE_PROFILE_INVALID')
    expect(e.reason).toBe(`${field}: ${why}`)
  })

  const NPM_WHY = 'npm publish needs --tag {channel} or --tag <channel>'
  const RISKY = [
    ['npm publish alone', ['npm', 'publish'], NPM_WHY],
    ['npm publish --tag with another name', ['npm', 'publish', '--tag', 'latest2'], NPM_WHY],
    ['gh release create without --prerelease', GH_ARGV, 'gh release create needs --prerelease'],
    ['gh release create with --latest', [...GH_ARGV, '--prerelease', '--latest'], 'gh release create must not carry --latest'],
    ['gh release create with --latest=true', [...GH_ARGV, '--prerelease', '--latest=true'], 'gh release create must not carry --latest'],
  ]

  it.each(RISKY)('[E4] refuses a prerelease step that would move latest: %s', (_name, argv, why) => {
    const e = refusal(() => validateProfile(withScheme('semver', pre({ ...NPM_NEXT, argv }))))
    expect(e.code).toBe('RELEASE_PROFILE_INVALID')
    expect(e.reason).toBe(`prerelease.publish.argv: ${why}`)
  })

  const SAFE = [
    ['npm publish --tag {channel}', NPM_NEXT.argv],
    ['npm publish --tag next', ['npm', 'publish', '--tag', 'next']],
    ['npm publish --tag=next', ['npm', 'publish', '--tag=next']],
    ['npm publish --tag={channel}', ['npm', 'publish', '--tag={channel}']],
    ['gh release create with --prerelease', GH_PRE.argv],
    ['gh release create with --prerelease and --latest=false', [...GH_PRE.argv, '--latest=false']],
    ['another program', SCRIPT_NEXT.argv],
  ]

  it.each(SAFE)('[E4] accepts a prerelease step: %s', (_name, argv) => {
    const profile = withScheme('semver', pre({ ...NPM_NEXT, argv }))
    expect(validateProfile(clone(profile))).toEqual(profile)
  })
})

describe('release.mjs digest under each scheme [FEAT-062]', () => {
  const PRE = pre(NPM_NEXT)
  const profileOf = (scheme) => (scheme === 'numeric' || scheme === 'MAJOR.MINOR.PATCH' ? withScheme(scheme) : withScheme(scheme, PRE))
  const digest = (v) => rel(['digest', '--version', v, '--items', 'FEAT-001', '--date', DATE])
  const SEMVER_FAR = 'not MAJOR.MINOR.PATCH with an optional -prerelease'
  const PEP_NORMAL = 'not in PEP 440 normal form'
  const NUMERIC_FAR = 'not two or more dot-separated numbers'

  const REFUSED = [
    ['semver', '1.1.0+build.5', 'build metadata is not supported'],
    ['semver', '1.1.0-rc.01', 'prerelease identifier 01 has a leading zero'],
    ['semver', '1.1', SEMVER_FAR],
    ['semver', '1.1.0-', SEMVER_FAR],
    ['pep440', '1.1.0-rc1', PEP_NORMAL],
    ['pep440', '1.1.0RC1', PEP_NORMAL],
    ['pep440', '1.1.0.beta1', PEP_NORMAL],
    ['pep440', '1.02', PEP_NORMAL],
    ['pep440', '1!1.1.0', 'an epoch is not supported'],
    ['pep440', '1.1.0+local', 'a local version is not supported'],
    ['numeric', '2', NUMERIC_FAR],
    ['numeric', '2026.11-beta', NUMERIC_FAR],
    ['MAJOR.MINOR.PATCH', '1.1.0-rc.1', null],
  ]

  it.each(REFUSED)('[E3] %s refuses %s', (scheme, version, why) => {
    project(profileOf(scheme))
    const text = why === null ? 'only MAJOR.MINOR.PATCH is supported' : `not a ${scheme} version: ${why}`
    expect(digest(version)).toEqual({ status: 2, out: '', err: `release: RELEASE_VERSION_INVALID: ${version}: ${text}\n` })
  })

  const ACCEPTED = [
    ['semver', '1.1.0-rc.1', 'prerelease'],
    ['semver', '1.1.0', 'stable'],
    ['pep440', '1.1.0rc1', 'prerelease'],
    ['pep440', '1.1.0.dev1', 'prerelease'],
    ['pep440', '1.0.0.post1', 'stable'],
    ['numeric', '2026.11', 'stable'],
  ]

  it.each(ACCEPTED)('[E3] %s accepts %s as %s', (scheme, version, kind) => {
    project(profileOf(scheme))
    const r = digest(version)
    expect(r.status).toBe(0)
    expect(lines(r.out).slice(0, 2)).toEqual([`RELEASE ${version} FROM 1.0.0 DATE ${DATE}`, `SCHEME ${scheme} ${kind}`])
  })

  const NOT_ADVANCED = [
    ['semver', '1.0.0-rc.1'],
    ['pep440', '1.0'],
    ['pep440', '1.0.0rc1'],
    ['numeric', '1.0.0.0'],
    ['numeric', '1.0'],
  ]

  it.each(NOT_ADVANCED)('[E3] %s refuses %s as not advancing 1.0.0', (scheme, version) => {
    project(profileOf(scheme))
    expect(digest(version)).toEqual({ status: 2, out: '', err: `release: RELEASE_VERSION_NOT_ADVANCED: ${version} does not advance 1.0.0\n` })
  })

  const CHAINS = [
    ['semver', ['1.2.0-1', '1.2.0-alpha', '1.2.0-alpha.1', '1.2.0-beta', '1.2.0-rc.1', '1.2.0-rc.10', '1.2.0', '1.10.0']],
    ['pep440', ['1.2.0.dev1', '1.2.0a1', '1.2.0b2', '1.2.0rc1', '1.2.0', '1.2.0.post1.dev1', '1.2.0.post1', '1.10']],
    ['numeric', ['2026.9', '2026.10', '2026.10.1', '2026.11', '2027.1']],
  ]

  it.each(CHAINS)('[E3] %s precedence follows its published order', (scheme, chain) => {
    chain.forEach((a, i) => chain.slice(i + 1).forEach((b) => {
      expect([a, b, compareVersions(a, b, scheme)]).toEqual([a, b, -1])
      expect([b, a, compareVersions(b, a, scheme)]).toEqual([b, a, 1])
    }))
  })

  it('[E3] versions equal under precedence compare as 0', () => {
    expect(compareVersions('1.2', '1.2.0', 'pep440')).toBe(0)
    expect(compareVersions('2026.11', '2026.11.0', 'numeric')).toBe(0)
    expect(compareVersions('2026.01', '2026.1', 'numeric')).toBe(0)
  })

  it('[E6] compareVersions without a scheme is the MAJOR.MINOR.PATCH order', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1)
    expect(compareVersions('1.10.0', '1.9.0', 'MAJOR.MINOR.PATCH')).toBe(1)
  })
})

describe('release.mjs init detects the scheme [FEAT-062]', () => {
  const PROPOSAL = '.conductor/release/profile.proposed.json'
  const pkg = (version, extra = {}) => jsonText({ name: 'demo', version, ...extra })
  function repo(files, tags = []) {
    fresh()
    git('init', '-q', '-b', 'main')
    put('.gitignore', '.conductor/\n')
    for (const [path, text] of Object.entries(files)) put(path, text)
    commit('chore: base')
    for (const t of tags) git('tag', t)
  }
  const npmRc = () => repo({ 'package.json': pkg('1.2.0-rc.1', { scripts: { test: 'vitest run' } }), 'package-lock.json': lockText('1.2.0-rc.1') })
  const row = (out, field) => lines(out).find((l) => l.startsWith(`PROPOSED ${field} `))
  const schemeRow = (out) => row(out, 'scheme')

  it('i1. a prerelease in package.json proposes semver and its prerelease block', () => {
    npmRc()
    const r = rel(['init'])
    expect(r.status).toBe(0)
    expect(schemeRow(r.out)).toBe('PROPOSED scheme "semver" (from package.json 1.2.0-rc.1)')
    expect(lines(r.out).filter((l) => l.startsWith('PROPOSED ')).map((l) => l.split(' ')[1])).toEqual(['versions', 'scheme', 'changelog', 'tag', 'remote', 'mainline', 'checks', 'publish', 'prerelease'])
    expect(row(r.out, 'prerelease')).toContain('(default)')
    expect(proposalFile().scheme).toBe('semver')
    expect(proposalFile().prerelease).toEqual(pre(NPM_NEXT))
  })

  it('i2. a prerelease tag proposes semver from the tag', () => {
    initProject()
    git('tag', 'v2.4.0-rc.1')
    expect(schemeRow(rel(['init']).out)).toBe('PROPOSED scheme "semver" (from tag v2.4.0-rc.1)')
  })

  it('i3. a PEP 440 pre-release in pyproject.toml proposes pep440', () => {
    repo({ 'pyproject.toml': '[project]\nname = "demo"\nversion = "1.2.0rc1"\n' })
    const r = rel(['init'])
    expect(schemeRow(r.out)).toBe('PROPOSED scheme "pep440" (from pyproject.toml 1.2.0rc1)')
    expect(proposalFile().prerelease).toEqual(pre(null))
  })

  it('i4. one scheme accepting every value is not a conflict: 5.0 with a 5.1a1 tag is pep440', () => {
    repo({ 'pyproject.toml': '[project]\nname = "demo"\nversion = "5.0"\n' }, ['5.0', '5.1a1'])
    expect(schemeRow(rel(['init']).out)).toBe('PROPOSED scheme "pep440" (from pyproject.toml 5.0; tag 5.1a1)')
  })

  it('i5. CalVer in VERSION proposes numeric and no prerelease block', () => {
    repo({ VERSION: '2026.11\n' }, ['v2026.09', 'v2026.10'])
    const r = rel(['init'])
    expect(schemeRow(r.out)).toBe('PROPOSED scheme "numeric" (from VERSION 2026.11)')
    expect(row(r.out, 'prerelease')).toBeUndefined()
    expect('prerelease' in proposalFile()).toBe(false)
  })

  it('i6. a CalVer tag beside a plain current version proposes numeric from the tag', () => {
    repo({ 'package.json': pkg('1.0.0', { private: true }) }, ['v2026.10'])
    expect(schemeRow(rel(['init']).out)).toBe('PROPOSED scheme "numeric" (from tag v2026.10)')
  })

  it('i7. plain versions show their evidence and keep FEAT-035\'s profile file', () => {
    initProject()
    const r = rel(['init'])
    expect(schemeRow(r.out)).toBe('PROPOSED scheme "MAJOR.MINOR.PATCH" (from package.json 2.3.4; tag v2.3.4)')
    expect(row(r.out, 'prerelease')).toBeUndefined()
    expect('scheme' in proposalFile()).toBe(false)
  })

  it('i8. no evidence at all marks the default scheme (default)', () => {
    repo({})
    expect(schemeRow(rel(['init']).out)).toBe('PROPOSED scheme "MAJOR.MINOR.PATCH" (default)')
  })

  it('i9. a single-part tag and tags no scheme accepts are not evidence', () => {
    initProject()
    for (const t of ['v1', 'vnext', 'v2.0.0.Final', 'release-3']) git('tag', t)
    const r = rel(['init'])
    expect(schemeRow(r.out)).toBe('PROPOSED scheme "MAJOR.MINOR.PATCH" (from package.json 2.3.4; tag v2.3.4)')
    for (const ignored of ['vnext', 'Final', 'release-3']) expect(r.out).not.toContain(ignored)
  })

  const UNSUPPORTED = [
    ['package.json 2.0.0.Final', { 'package.json': pkg('2.0.0.Final') }, ''],
    ['package.json 1.0.0+build', { 'package.json': pkg('1.0.0+build') }, ' (semver: build metadata is not supported; pep440: a local version is not supported)'],
    ['VERSION 1!2.0', { VERSION: '1!2.0\n' }, ' (pep440: an epoch is not supported)'],
  ]

  it.each(UNSUPPORTED)('i10. %s refuses RELEASE_INIT_SCHEME_UNSUPPORTED and writes nothing', (what, files, near) => {
    repo(files)
    const r = rel(['init'])
    expect(r).toEqual({ status: 2, out: '', err: `release: RELEASE_INIT_SCHEME_UNSUPPORTED: ${what}: fits none of ${SCHEME_LIST}${near}\n` })
    expect(existsSync(join(root, PROPOSAL))).toBe(false)
  })

  it('i11. evidence no single scheme accepts refuses RELEASE_INIT_SCHEME_CONFLICT', () => {
    repo({ 'package.json': pkg('1.2.0-rc.1') }, ['v1.2.0rc1'])
    const r = rel(['init'])
    const why = 'MAJOR.MINOR.PATCH rejects package.json 1.2.0-rc.1; semver rejects tag v1.2.0rc1; numeric rejects package.json 1.2.0-rc.1; pep440 rejects package.json 1.2.0-rc.1'
    expect(r).toEqual({ status: 2, out: '', err: `release: RELEASE_INIT_SCHEME_CONFLICT: ${why}\n` })
    expect(existsSync(join(root, PROPOSAL))).toBe(false)
  })

  it('i12. a workflow listening for a published release proposes a gh prerelease step', () => {
    npmRc()
    put('.github/workflows/pub.yml', 'on:\n  release:\n    types: [published]\n')
    expect(rel(['init']).status).toBe(0)
    expect(proposalFile().prerelease.publish).toEqual({ channel: 'prerelease', target: 'the GitHub Release .github/workflows/pub.yml listens for', argv: [...GH_ARGV, '--prerelease'] })
  })

  it('i13. init --confirm judges a hand-edited prerelease block like the release verbs do', () => {
    npmRc()
    rel(['init'])
    const bytes = read(PROPOSAL)
    const edited = proposalFile()
    delete edited.prerelease
    put(PROPOSAL, jsonText(edited))
    const refused = rel(['init', '--confirm'])
    expect(refused).toEqual({ status: 2, out: '', err: 'release: RELEASE_PROFILE_INVALID: prerelease: required by scheme semver\n' })
    expect(existsSync(join(root, '.claude/release-profile.json'))).toBe(false)
    rel(['init'])
    expect(read(PROPOSAL)).toBe(bytes)
    expect(rel(['init', '--confirm']).status).toBe(0)
    expect(read('.claude/release-profile.json')).toBe(bytes)
  })
})

describe('release.mjs prerelease publish and range [FEAT-062]', () => {
  const HANDOFF = (v) => ['handoff', '--version', v, '--pr', '7']
  const released = (profile, v, { items = ['FEAT-001'], changelog = true } = {}) => { project(profile); applyRelease({ v, items, changelog }); merge() }
  const stepsOf = (v) => {
    const sha = gitOut('rev-parse', 'HEAD')
    return [`STEP 1 tag git tag -a v${v} -m v${v} ${sha}`, `STEP 2 push git push origin v${v}`]
  }
  const writeback = (n, v) => `STEP ${n} writeback node ${ticketPath()} writeback FEAT-001 --version ${v} --pr 7 --changelog .conductor/release/${v}/FEAT-001.md`

  it('[E4] h1. an npm prerelease publishes under its channel and never the stable step', () => {
    const v = '1.1.0-rc.1'
    released(withScheme('semver', pre(NPM_NEXT)), v)
    put('.conductor/ticket/FEAT-001.md', 'ticket\n')
    const r = rel(HANDOFF(v))
    expect(r.status).toBe(0)
    expect(lines(r.out)).toEqual([
      'CHECK alpha ok', 'CHECK beta ok', ...stepsOf(v),
      'PUBLISH-TARGET the npm registry', 'PUBLISH-CHANNEL next', 'STEP 3 publish npm publish --tag next',
      writeback(4, v), `release: handoff ready ${v}`,
    ])
    expect(r.out).not.toContain('demo-publish')
    expect(r.out).not.toContain('unverified')
  })

  it('[E4] h2. a GitHub Release prerelease carries --prerelease and its channel', () => {
    const v = '1.1.0-rc.1'
    released(withScheme('semver', pre(GH_PRE)), v)
    const r = rel(HANDOFF(v))
    expect(r.status).toBe(0)
    const out = lines(r.out)
    expect(out).toContain('PUBLISH-TARGET the GitHub Release')
    expect(out).toContain('PUBLISH-CHANNEL prerelease')
    expect(out).toContain(`STEP 3 publish gh release create v${v} --verify-tag --title v${v} --notes-file .conductor/release/${v}/notes.md --prerelease`)
    expect(r.out).not.toContain('unverified')
  })

  it('[E4] h3. a prerelease with no publish step prints no target, channel or publish step', () => {
    const v = '1.1.0-rc.1'
    released(withScheme('semver', pre(null)), v)
    put('.conductor/ticket/FEAT-001.md', 'ticket\n')
    const r = rel(HANDOFF(v))
    expect(r.status).toBe(0)
    expect(r.out).not.toContain('PUBLISH-TARGET')
    expect(r.out).not.toContain('PUBLISH-CHANNEL')
    expect(r.out).not.toContain(' publish ')
    expect(lines(r.out)).toContain(writeback(3, v))
  })

  it('[E4, D1] h4. a publish program the driver does not know prints its channel as unverified', () => {
    const v = '1.1.0-rc.1'
    released(withScheme('semver', pre(SCRIPT_NEXT)), v)
    const out = lines(rel(HANDOFF(v)).out)
    expect(out).toContain('PUBLISH-TARGET the demo registry')
    expect(out).toContain('PUBLISH-CHANNEL next unverified')
    expect(out).toContain('STEP 3 publish ./scripts/publish.sh next')
  })

  it('[E4] h5. a stable release under a prerelease scheme prints exactly the stable step', () => {
    released(withScheme('semver', pre(NPM_NEXT)), '1.1.0')
    put('.conductor/ticket/FEAT-001.md', 'ticket\n')
    const r = rel(HANDOFF('1.1.0'))
    expect(lines(r.out)).toEqual([
      'CHECK alpha ok', 'CHECK beta ok', ...stepsOf('1.1.0'),
      'PUBLISH-TARGET the demo registry', 'STEP 3 publish demo-publish v1.1.0 .conductor/release/1.1.0/notes.md',
      writeback(4, '1.1.0'), 'release: handoff ready 1.1.0',
    ])
    expect(r.out).not.toContain('PUBLISH-CHANNEL')
  })

  it.each([
    ['1.0.0.post1', ['PUBLISH-TARGET the demo registry', 'STEP 3 publish demo-publish v1.0.0.post1 .conductor/release/1.0.0.post1/notes.md'], false],
    ['1.1.0.dev1', ['PUBLISH-TARGET the npm registry', 'PUBLISH-CHANNEL next', 'STEP 3 publish npm publish --tag next'], true],
  ])('[E4] h6. pep440 %s takes the publish step its kind decides', (v, expected, channel) => {
    released(withScheme('pep440', pre(NPM_NEXT)), v)
    const out = lines(rel(HANDOFF(v)).out)
    for (const line of expected) expect(out).toContain(line)
    expect(out.some((l) => l.startsWith('PUBLISH-CHANNEL'))).toBe(channel)
  })

  it.each([['semver', '1.1.0-rc.1'], ['pep440', '1.1.0rc1']])('[E5] %s: check passes %s and handoff tags it and takes its notes from its heading', (scheme, v) => {
    project(withScheme(scheme, pre(NPM_NEXT)))
    applyRelease({ v, items: ['FEAT-001'] })
    const checked = rel(checkArgs(v, 'FEAT-001'), report(v, ['FEAT-001']))
    expect(checked.status).toBe(0)
    expect(lines(checked.out).at(-1)).toBe(`release: ok ${v} items FEAT-001`)
    merge()
    const r = rel(HANDOFF(v))
    expect(r.status).toBe(0)
    expect(lines(r.out)).toContain(`STEP 1 tag git tag -a v${v} -m v${v} ${gitOut('rev-parse', 'HEAD')}`)
    expect(read(`.conductor/release/${v}/notes.md`)).toBe('### Added\n\n- **[FEAT-001]** Shipped FEAT-001.\n')
  })

  const rcThenBeta = () => {
    git('tag', 'v1.1.0-rc.1')
    put('src/b.js', 'export const b = 2\n')
    commit('feat: beta work')
  }
  const subjects = (out) => lines(out).filter((l) => l.startsWith('COMMIT ')).map((l) => l.replace(/^COMMIT \S+ /, ''))

  it.each([
    ['a stable release skips the prerelease tag', false, '1.1.0', ['feat: beta work', 'feat: alpha work']],
    ['a stable release counts it when the profile says so', true, '1.1.0', ['feat: beta work']],
    ['a prerelease starts at the previous tag of any kind', false, '1.1.0-rc.2', ['feat: beta work']],
  ])('[E5] %s', (_name, counts, v, expected) => {
    project(withScheme('semver', pre(NPM_NEXT, counts)))
    rcThenBeta()
    const r = rel(['digest', '--version', v, '--items', 'FEAT-001', '--date', DATE])
    expect(r.status).toBe(0)
    expect(subjects(r.out)).toEqual(expected)
  })

  it('[E5] the notes of a release with no changelog use the same range', () => {
    project(withScheme('semver', pre(NPM_NEXT), NOCLB))
    rcThenBeta()
    applyRelease({ v: '1.1.0', items: ['FEAT-001'], changelog: false })
    merge()
    expect(rel(HANDOFF('1.1.0')).status).toBe(0)
    expect(read('.conductor/release/1.1.0/notes.md')).toBe('- chore: release\n- feat: beta work\n- feat: alpha work\n')
  })

  it('[E6] a MAJOR.MINOR.PATCH profile behaves the same with and without an explicit scheme', () => {
    const record = (profile) => {
      project(profile)
      const run = (args, input) => { const r = rel(args, input); return { status: r.status, out: r.out, err: r.err } }
      const runs = [run(['digest', '--version', '1.1.0', '--items', 'FEAT-001', '--date', DATE]), run(['digest', '--version', '1.1.0-rc.1', '--items', 'FEAT-001', '--date', DATE])]
      applyRelease({ v: '1.1.0', items: ['FEAT-001'] })
      runs.push(run(checkArgs('1.1.0', 'FEAT-001'), report('1.1.0', ['FEAT-001'])))
      merge()
      runs.push(run(HANDOFF('1.1.0')), { notes: read('.conductor/release/1.1.0/notes.md') })
      return runs
    }
    const mask = (runs) => JSON.parse(JSON.stringify(runs).replace(/\b[0-9a-f]{7,40}\b/g, '<sha>'))
    const implicit = mask(record(PROFILE))
    const explicit = mask(record(withScheme('MAJOR.MINOR.PATCH')))
    expect(implicit).toEqual(explicit)
    expect(JSON.stringify(implicit)).not.toContain('SCHEME')
    expect(implicit.map((r) => r.status)).toEqual([0, 2, 0, 0, undefined])
  })
})

// ---- H. this repository's profile (1) ----------------------------------------------------

describe('this repository\'s release profile [FEAT-035]', () => {
  it('54. [O5] validates with its five paths and its two checks', () => {
    const profile = validateProfile(JSON.parse(readFileSync(join(REPO, '.claude', 'release-profile.json'), 'utf8')))
    expect(releaseSurface(profile)).toEqual(['VERSION', 'package.json', 'package-lock.json', 'CHANGELOG.md', 'AGENT-READABLE BACKLOG.md'])
    expect(profile.checks.map((c) => c.name)).toEqual(['version-gate', 'record-parity'])
  })
})
