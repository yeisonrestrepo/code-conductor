import { describe, it, expect, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DOC_SURFACE, docSurface, matchCommit, surfaceSplit } from '../../scripts/docs-sync.mjs'
import { cleanGitEnv } from '../helpers/git-env.js'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const SCRIPT = join(REPO_ROOT, 'scripts/docs-sync.mjs')
const USAGE = 'docs-sync: DOCS_USAGE: usage: docs-sync.mjs <digest|check> --release <ref> [--since <ref>]\n'
const README3 = '# Demo\nRun demo.\nFlags: none.\n'

let root
afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); root = undefined })

function fresh() {
  // realpath: the macOS tmpdir is a symlink, and the script compares paths git prints with the root it resolved.
  root = realpathSync(mkdtempSync(join(tmpdir(), 'cc-docs-sync-')))
}
function git(...args) {
  return spawnSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=t', '-c', 'user.email=t@example.com',
    '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], { cwd: root, env: cleanGitEnv(), encoding: 'utf8' })
}
function put(rel, text) {
  mkdirSync(dirname(join(root, rel)), { recursive: true })
  writeFileSync(join(root, rel), text)
}
function commit(msg) {
  git('add', '-A')
  git('commit', '-qm', msg)
  return git('rev-parse', 'HEAD').stdout.trim()
}
function sync(args, input = '') {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: root, env: cleanGitEnv(), input, encoding: 'utf8', timeout: 30000 })
  return { status: r.status, out: r.stdout, err: r.stderr }
}
const CLI_V1 = 'const a = 1\nconst flag = null\nexport { a }\n'
const CLI_V2 = "const a = 1\nconst flag = process.argv.includes('--fast')\nexport { a }\n"
// Two tagged releases: v1.0.0 is the base, v1.1.0 adds the --fast flag to src/cli.js and HEAD stays on it.
function twoTags(extra = {}) {
  fresh()
  git('init', '-q', '-b', 'main')
  put('README.md', README3)
  put('docs/guide.md', '# Guide\n')
  put('src/cli.js', CLI_V1)
  for (const [rel, text] of Object.entries(extra)) put(rel, text)
  const base = commit('chore: base')
  git('tag', 'v1.0.0')
  put('src/cli.js', CLI_V2)
  const feat = commit('feat: add the --fast flag')
  git('tag', 'v1.1.0')
  return { base, feat }
}
// An in-process docSurface call must not reach a GIT_DIR a hook exported (BUG-053).
function scrubbed(fn) {
  const saved = { ...process.env }
  for (const key of Object.keys(process.env)) delete process.env[key]
  Object.assign(process.env, cleanGitEnv(saved))
  try { return fn() } finally {
    for (const key of Object.keys(process.env)) delete process.env[key]
    Object.assign(process.env, saved)
  }
}
const short = (sha) => sha.slice(0, 7)
const status = () => git('status', '--porcelain').stdout
const check = (report, args = ['--release', 'v1.1.0']) => sync(['check', ...args], report)
const failure = (code, detail) => `docs-sync: ${code}: ${detail}\n`
const README_EDIT = () => put('README.md', `${README3}Flags: --fast.\n`)
const SURFACE_LIST = `[${DOC_SURFACE.join(', ')}]`
const FIVE_KINDS = {
  'project-template/CLAUDE.md': '# Template\n',
  'docs/a.md': '# A\n',
  'docs/guides/g.md': '# G\n',
  '.github/wiki/pages/p.md': '# P\n',
}

describe('docs-sync.mjs digest [FEAT-036]', () => {
  it('prints the release, the surface, the commits and the changed paths', () => {
    const { base, feat } = twoTags()
    const r = sync(['digest', '--release', 'v1.1.0'])
    expect(r.status).toBe(0)
    expect(r.out).toBe([
      `RELEASE v1.1.0 ${feat} SINCE v1.0.0 ${base}`,
      'SURFACE README.md',
      'SURFACE docs/*.md',
      `COMMIT ${feat} feat: add the --fast flag`,
      'CHANGED M src/cli.js',
      '',
    ].join('\n'))
  })

  it('names the documentation a release touched, with an explicit --since', () => {
    const { base } = twoTags()
    put('README.md', `${README3}Flags: --fast.\n`)
    const docs = commit('docs: describe --fast')
    git('tag', 'v1.2.0')
    const r = sync(['digest', '--release', 'v1.2.0', '--since', 'v1.0.0'])
    expect(r.status).toBe(0)
    const lines = r.out.split('\n')
    expect(lines[0]).toBe(`RELEASE v1.2.0 ${docs} SINCE v1.0.0 ${base}`)
    expect(lines.filter((l) => l.startsWith('COMMIT ')).map((l) => l.split(' ').slice(2).join(' '))).toEqual(['feat: add the --fast flag', 'docs: describe --fast'])
    expect(lines.filter((l) => l.startsWith('CHANGED '))).toEqual(['CHANGED M README.md', 'CHANGED M src/cli.js'])
    expect(lines.filter((l) => l.startsWith('DOCS-TOUCHED '))).toEqual(['DOCS-TOUCHED README.md'])
  })

  it.each([
    [[]],
    [['digest']],
    [['digest', '--release']],
    [['bogus', '--release', 'v1.1.0']],
    [['digest', '--release', 'v1.1.0', '--since']],
    [['digest', '--release', '-x']],
  ])('refuses the argument list %j with DOCS_USAGE', (args) => {
    twoTags()
    expect(sync(args)).toEqual({ status: 2, out: '', err: USAGE })
  })

  it('refuses a directory that is not a repository', () => {
    fresh()
    const r = sync(['digest', '--release', 'v1.1.0'])
    expect(r.status).toBe(2)
    expect(r.err).toBe(failure('DOCS_NOT_A_REPO', `${root} is not inside a git work tree`))
  })

  it.each([
    [['--release', 'nope']],
    [['--release', 'v1.1.0', '--since', 'nope']],
  ])('refuses an unknown ref in %j', (args) => {
    twoTags()
    expect(sync(['digest', ...args])).toEqual({ status: 2, out: '', err: failure('DOCS_REF_UNKNOWN', 'nope names no commit') })
  })

  it('refuses a work tree that is not at the release', () => {
    const { base, feat } = twoTags()
    git('checkout', '-q', 'v1.1.0')
    const r = sync(['digest', '--release', 'v1.0.0'])
    expect(r.status).toBe(2)
    expect(r.err).toContain(`docs-sync: DOCS_NOT_AT_RELEASE: HEAD is ${feat}, not v1.0.0 (${base})`)
  })

  it('refuses a dirty tree and lists each path and how to clear it', () => {
    twoTags()
    put('README.md', `${README3}edit\n`)
    put('notes.txt', 'x\n')
    const r = sync(['digest', '--release', 'v1.1.0'])
    expect(r.status).toBe(2)
    expect(r.err).toContain('DOCS_TREE_DIRTY')
    expect(r.err).toContain('2 modified or untracked paths:')
    expect(r.err.split('\n')).toEqual(expect.arrayContaining(['README.md', 'notes.txt']))
    expect(r.err).toContain('.git/info/exclude')
    expect(r.err).toContain('git stash push --include-untracked')
  })

  it('does not count an ignored file as dirt', () => {
    twoTags({ '.gitignore': 'local.txt\n' })
    put('local.txt', 'x\n')
    expect(sync(['digest', '--release', 'v1.1.0']).status).toBe(0)
  })

  it('refuses a first release with no --since', () => {
    fresh()
    git('init', '-q', '-b', 'main')
    put('README.md', README3)
    commit('chore: base')
    git('tag', 'v1.0.0')
    const r = sync(['digest', '--release', 'v1.0.0'])
    expect(r.status).toBe(2)
    expect(r.err).toContain('DOCS_NO_PREVIOUS_RELEASE')
    expect(r.err).toContain('--since')
  })

  it('refuses a --since that is not an ancestor of the release', () => {
    twoTags()
    git('checkout', '-q', '-b', 'side', 'v1.0.0')
    put('side.txt', 'x\n')
    commit('chore: side')
    git('checkout', '-q', 'main')
    const r = sync(['digest', '--release', 'v1.1.0', '--since', 'side'])
    expect(r.status).toBe(2)
    expect(r.err).toBe(failure('DOCS_SINCE_NOT_ANCESTOR', 'side is not an ancestor of v1.1.0'))
  })

  it('caps the range at 300 commits', () => {
    fresh()
    git('init', '-q', '-b', 'main')
    const stream = Array.from({ length: 302 }, (_, i) => {
      const msg = `chore: ${i}`
      const body = `# Demo ${i}\n`
      return `commit refs/heads/main\ncommitter t <t@example.com> ${1700000000 + i} +0000\ndata ${msg.length}\n${msg}\nM 644 inline README.md\ndata ${body.length}\n${body}\n`
    }).join('')
    expect(spawnSync('git', ['fast-import', '--quiet'], { cwd: root, env: cleanGitEnv(), input: stream, encoding: 'utf8' }).status).toBe(0)
    git('reset', '-q', '--hard', 'main')
    const shas = git('rev-list', '--reverse', 'main').stdout.trim().split('\n')
    const tooLarge = sync(['digest', '--release', shas[301], '--since', shas[0]])
    expect(tooLarge.status).toBe(2)
    expect(tooLarge.err).toContain('DOCS_RANGE_TOO_LARGE')
    expect(tooLarge.err).toContain('301 commits')
    expect(tooLarge.err).toContain('the cap is 300')
    const edge = sync(['digest', '--release', shas[301], '--since', shas[1]])
    expect(edge.status).toBe(0)
    expect(edge.out.split('\n').filter((l) => l.startsWith('COMMIT ')).length).toBe(300)
  })

  it('refuses a release that tracks no documentation', () => {
    fresh()
    git('init', '-q', '-b', 'main')
    put('src/a.js', 'a\n')
    commit('chore: base')
    git('tag', 'v1.0.0')
    put('src/a.js', 'b\n')
    commit('feat: b')
    git('tag', 'v1.1.0')
    const r = sync(['digest', '--release', 'v1.1.0'])
    expect(r.status).toBe(2)
    expect(r.err).toContain('DOCS_NO_SURFACE')
    expect(r.err).toContain(SURFACE_LIST)
  })

  it('forwards a malformed recorded spec or plan folder', () => {
    twoTags({ 'CLAUDE.md': '- Specs: docs/specs\n' })
    const r = sync(['digest', '--release', 'v1.1.0'])
    expect(r.status).toBe(2)
    expect(r.err).toBe(failure('ORCH_DOC_LOCATION_INVALID', 'CLAUDE.md records `- Specs:` but not `- Plans:` (or the reverse); add the missing line, or remove both'))
  })

  it.each([
    ['docs', 'plans', ['SURFACE-DROPPED docs/*.md docs', 'SURFACE-DROPPED docs/guides/**/*.md docs'], ['README.md', 'project-template/CLAUDE.md', '.github/wiki/pages/*.md']],
    ['docs/guides', 'docs/plans', ['SURFACE-DROPPED docs/guides/**/*.md docs/guides'], ['README.md', 'project-template/CLAUDE.md', 'docs/*.md', '.github/wiki/pages/*.md']],
    ['docs/guides/specs', 'docs/guides/plans', ['SURFACE-DROPPED docs/guides/**/*.md docs/guides/specs'], ['README.md', 'project-template/CLAUDE.md', 'docs/*.md', '.github/wiki/pages/*.md']],
  ])('drops the surface a recorded folder %s + %s would shadow', (specs, plans, dropped, kept) => {
    twoTags({ 'CLAUDE.md': `- Specs: ${specs}\n- Plans: ${plans}\n`, ...FIVE_KINDS })
    const r = sync(['digest', '--release', 'v1.1.0'])
    expect(r.status).toBe(0)
    const lines = r.out.split('\n')
    expect(lines.filter((l) => l.startsWith('SURFACE-DROPPED '))).toEqual(dropped)
    expect(lines.filter((l) => l.startsWith('SURFACE '))).toEqual(kept.map((g) => `SURFACE ${g}`))
  })

  it('keeps all five surface elements under the default folders', () => {
    twoTags(FIVE_KINDS)
    const r = sync(['digest', '--release', 'v1.1.0'])
    expect(r.status).toBe(0)
    const lines = r.out.split('\n')
    expect(lines.filter((l) => l.startsWith('SURFACE '))).toEqual(DOC_SURFACE.map((g) => `SURFACE ${g}`))
    expect(lines.some((l) => l.startsWith('SURFACE-DROPPED '))).toBe(false)
  })

  it('docSurface equals the SURFACE globs digest prints', () => {
    twoTags(FIVE_KINDS)
    const printed = sync(['digest', '--release', 'v1.1.0']).out.split('\n').filter((l) => l.startsWith('SURFACE ')).map((l) => l.slice(8))
    expect(scrubbed(() => docSurface(root))).toEqual(printed)
  })
})

describe('docs-sync.mjs surfaceSplit [FEAT-036]', () => {
  it.each([
    [['project-template/CLAUDE.md'], ['project-template', 'x'], [], [{ glob: 'project-template/CLAUDE.md', folder: 'project-template' }]],
    [['project-template/CLAUDE.md'], ['project-template/sub', 'x'], ['project-template/CLAUDE.md'], []],
    [['README.md'], ['docs', 'plans'], ['README.md'], []],
    [['README.md', 'docs/a.md'], ['docs/specs', 'docs/plans'], ['README.md', 'docs/*.md'], []],
  ])('splits %j under the folders %j', (tracked, folders, scope, dropped) => {
    expect(surfaceSplit(tracked, folders)).toEqual({ scope, dropped })
  })
})

describe('docs-sync.mjs check [FEAT-036]', () => {
  it('accepts a cited edit and writes nothing', () => {
    const { feat } = twoTags()
    expect(status()).toBe('')
    expect(sync(['digest', '--release', 'v1.1.0']).status).toBe(0)
    expect(status()).toBe('')
    README_EDIT()
    const before = status()
    const r = check(`CITE README.md:+4 commit ${short(feat)}\nDOCS: drift 1 lines in 1 files\n`)
    expect(r).toEqual({ status: 0, out: 'docs-sync: ok drift 1 lines in 1 files\n', err: '' })
    expect(status()).toBe(before)
    expect(before).toBe(' M README.md\n')
  })

  it('accepts no drift for an empty diff', () => {
    twoTags()
    expect(check('DOCS: no drift found\n')).toEqual({ status: 0, out: 'docs-sync: ok no drift found\n', err: '' })
  })

  it('rejects "no drift found" over a non-empty diff', () => {
    const { feat } = twoTags()
    README_EDIT()
    const r = check(`CITE README.md:+4 commit ${short(feat)}\nDOCS: no drift found\n`)
    expect(r.status).toBe(1)
    expect(r.out).toBe(failure('DOCS_RESULT_INCONSISTENT', 'the report says "no drift found" but the diff changes 1 lines in 1 files'))
  })

  it('rejects a drift count that differs from the diff', () => {
    const { feat } = twoTags()
    README_EDIT()
    const r = check(`CITE README.md:+4 commit ${short(feat)}\nDOCS: drift 2 lines in 1 files\n`)
    expect(r.status).toBe(1)
    expect(r.out).toContain('DOCS_RESULT_INCONSISTENT')
  })

  it.each([
    ['', 'the report has no DOCS: line'],
    ['DOCS: no drift found\nDOCS: no drift found\n', 'the report has 2 DOCS: lines'],
  ])('rejects a report whose DOCS: lines are %j', (report, reason) => {
    twoTags()
    const r = check(report)
    expect(r.status).toBe(1)
    expect(r.out).toBe(failure('DOCS_RESULT_MISSING', reason))
  })

  it('names a changed line with no CITE line', () => {
    twoTags()
    README_EDIT()
    const r = check('DOCS: drift 1 lines in 1 files\n')
    expect(r.status).toBe(1)
    expect(r.out).toBe(failure('DOCS_UNCITED', 'README.md:+4 has no CITE line'))
  })

  it('keys a removed line by its old number', () => {
    twoTags()
    put('README.md', '# Demo\nFlags: none.\n')
    const r = check('DOCS: drift 1 lines in 1 files\n')
    expect(r.out).toBe(failure('DOCS_UNCITED', 'README.md:-2 has no CITE line'))
  })

  it('rejects a commit outside the range', () => {
    const { base } = twoTags()
    README_EDIT()
    const r = check(`CITE README.md:+4 commit ${short(base)}\nDOCS: drift 1 lines in 1 files\n`)
    expect(r.status).toBe(1)
    expect(r.out).toContain(failure('DOCS_CITE_INVALID', `CITE README.md:+4 commit ${short(base)}: commit ${short(base)} is not a commit of v1.0.0..v1.1.0`))
  })

  it('rejects a prefix no range commit starts with', () => {
    const { feat } = twoTags()
    README_EDIT()
    let prefix = `${feat[0] === 'a' ? 'b' : 'a'}${feat.slice(1, 7)}`
    expect(feat.startsWith(prefix)).toBe(false)
    const r = check(`CITE README.md:+4 commit ${prefix}\nDOCS: drift 1 lines in 1 files\n`)
    expect(r.out).toContain(`commit ${prefix} is not a commit of v1.0.0..v1.1.0`)
  })

  it('matchCommit resolves, lowercases and flags ambiguity', () => {
    const pad = (s) => s.padEnd(40, '0')
    expect(matchCommit('abcdef1', [pad('abcdef1aaa'), pad('abcdef1bbb')])).toBe('ambiguous')
    expect(matchCommit('ABCDEF1', [pad('abcdef1aaa'), pad('1234567')])).toBe(pad('abcdef1aaa'))
    expect(matchCommit('7777777', [pad('abcdef1aaa')])).toBeNull()
  })

  const fileCite = (feat, target) => `CITE README.md:+4 file ${target}\nDOCS: drift 1 lines in 1 files\n`

  it.each([
    ['src/nope.js', 'file src/nope.js is not tracked at v1.1.0'],
    ['src/cli.js:99', 'file src/cli.js has 3 lines at v1.1.0'],
    ['README.md:4', 'file README.md is documentation, not evidence'],
    ['docs/guide.md:1', 'file docs/guide.md is documentation, not evidence'],
  ])('rejects the file citation %s', (target, why) => {
    const { feat } = twoTags()
    README_EDIT()
    const r = check(fileCite(feat, target))
    expect(r.status).toBe(1)
    expect(r.out).toContain(failure('DOCS_CITE_INVALID', `CITE README.md:+4 file ${target}: ${why}`))
  })

  it('bounds a file citation by the release blob, not the work tree', () => {
    const { feat } = twoTags()
    README_EDIT()
    put('src/cli.js', `${CLI_V2}x\nx\nx\nx\nx\n`)
    const r = check(fileCite(feat, 'src/cli.js:6'))
    expect(r.status).toBe(1)
    expect(r.out).toContain('file src/cli.js has 3 lines at v1.1.0')
    expect(r.out).toContain('DOCS_OUT_OF_SCOPE')
    expect(r.out).toContain('DOCS_UNCITED')
  })

  it('rejects a CITE line without a sign as malformed', () => {
    const { feat } = twoTags()
    README_EDIT()
    const r = check(`CITE README.md:4 commit ${short(feat)}\nDOCS: drift 1 lines in 1 files\n`)
    expect(r.out).toContain('DOCS_CITE_INVALID')
    expect(r.out).toContain('malformed; write CITE <path>:<+|-><line> commit <sha> or file <path>[:<line>]')
  })

  it('rejects a CITE key that is not a changed line', () => {
    const { feat } = twoTags()
    README_EDIT()
    const r = check(`CITE README.md:+4 commit ${short(feat)}\nCITE README.md:+1 commit ${short(feat)}\nDOCS: drift 1 lines in 1 files\n`)
    expect(r.status).toBe(1)
    expect(r.out).toBe(failure('DOCS_CITE_UNMATCHED', 'README.md:+1 is not a changed line'))
  })

  it('accepts a replaced line and a second file, each cited', () => {
    const { feat } = twoTags()
    put('README.md', '# Demo\nRun demo fast.\nFlags: none.\n')
    put('docs/guide.md', '# Guide\nMore.\n')
    const report = [
      `CITE README.md:-2 commit ${short(feat)}`, 'CITE README.md:+2 file src/cli.js:2', 'CITE docs/guide.md:+2 file src/cli.js',
      'notes: free text is ignored', 'DOCS: drift 3 lines in 2 files', '',
    ].join('\n')
    expect(check(report)).toEqual({ status: 0, out: 'docs-sync: ok drift 3 lines in 2 files\n', err: '' })
  })

  it('needs no citation for a blank line', () => {
    const { feat } = twoTags()
    put('README.md', `${README3}\nFlags: --fast.\n`)
    const r = check(`CITE README.md:+5 commit ${short(feat)}\nDOCS: drift 1 lines in 1 files\n`)
    expect(r).toEqual({ status: 0, out: 'docs-sync: ok drift 1 lines in 1 files\n', err: '' })
  })

  it('rejects a changed path outside the surface', () => {
    const { feat } = twoTags()
    put('src/cli.js', CLI_V2.replace('export { a }', 'export { a, flag }'))
    const sha = short(feat)
    const r = check(`CITE src/cli.js:-3 commit ${sha}\nCITE src/cli.js:+3 commit ${sha}\nDOCS: drift 2 lines in 1 files\n`)
    expect(r.status).toBe(1)
    expect(r.out).toBe(failure('DOCS_OUT_OF_SCOPE', 'src/cli.js is outside the documentation surface [README.md, docs/*.md]'))
  })

  it('judges an untracked file as wholly added', () => {
    const { feat } = twoTags()
    put('notes.txt', 'hi\n')
    const cited = check(`CITE notes.txt:+1 commit ${short(feat)}\nDOCS: drift 1 lines in 1 files\n`)
    expect(cited.out).toBe(failure('DOCS_OUT_OF_SCOPE', 'notes.txt is outside the documentation surface [README.md, docs/*.md]'))
    expect(check('DOCS: drift 1 lines in 1 files\n').out).toContain(failure('DOCS_UNCITED', 'notes.txt:+1 has no CITE line'))
  })

  describe('the managed block of project-template/CLAUDE.md', () => {
    const TEMPLATE = 'p1\np2\n<!-- cc:managed:start -->\nm1\nm2\n<!-- cc:managed:end -->\n'
    const edit = (line, text) => {
      const lines = TEMPLATE.split('\n')
      lines[line - 1] = text
      put('project-template/CLAUDE.md', lines.join('\n'))
    }
    const both = (feat, n) => `CITE project-template/CLAUDE.md:-${n} commit ${short(feat)}\nCITE project-template/CLAUDE.md:+${n} commit ${short(feat)}\nDOCS: drift 2 lines in 1 files\n`

    it('rejects an edit to a placeholder line on both sides of the diff', () => {
      const { feat } = twoTags({ 'project-template/CLAUDE.md': TEMPLATE })
      edit(1, 'p1 edited')
      const r = check(both(feat, 1))
      expect(r.status).toBe(1)
      expect(r.out).toContain(failure('DOCS_OUTSIDE_MANAGED', 'project-template/CLAUDE.md:-1 is outside the managed block of project-template/CLAUDE.md'))
      expect(r.out).toContain(failure('DOCS_OUTSIDE_MANAGED', 'project-template/CLAUDE.md:+1 is outside the managed block of project-template/CLAUDE.md'))
    })

    it('accepts an edit inside the block', () => {
      const { feat } = twoTags({ 'project-template/CLAUDE.md': TEMPLATE })
      edit(4, 'm1 edited')
      expect(check(both(feat, 4))).toEqual({ status: 0, out: 'docs-sync: ok drift 2 lines in 1 files\n', err: '' })
    })

    it('rejects an edit to the end marker itself', () => {
      const { feat } = twoTags({ 'project-template/CLAUDE.md': TEMPLATE })
      edit(6, '<!-- cc:managed:end --> x')
      const r = check(both(feat, 6))
      expect(r.status).toBe(1)
      expect(r.out).toContain('project-template/CLAUDE.md:-6 is outside the managed block')
      expect(r.out).toContain('project-template/CLAUDE.md:+6 is outside the managed block')
    })
  })

  it('refuses a work tree that is not at the release, without refusing a dirty one', () => {
    twoTags()
    git('checkout', '-q', 'v1.0.0')
    const r = check('DOCS: no drift found\n')
    expect(r.status).toBe(2)
    expect(r.err).toContain('DOCS_NOT_AT_RELEASE')
  })
})

describe('docs-sync.mjs as a module [FEAT-036]', () => {
  it('has no import side effect and imports only node: modules and doc-locations', () => {
    const url = pathToFileURL(SCRIPT).href
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(url)}); console.log(String(process.exitCode))`], { encoding: 'utf8', timeout: 30000 })
    expect(r.stdout).toBe('undefined\n')
    expect(r.stderr).toBe('')
    const imports = readFileSync(SCRIPT, 'utf8').match(/^import .*$/gm)
    expect(imports.length).toBeGreaterThan(0)
    for (const line of imports) expect(line).toMatch(/from '(node:[a-z:_/]+|\.\/doc-locations\.mjs)'/)
  })

  it('carries the same globToRegExp as Guard 5, so check and the hook agree on a scope', () => {
    const slice = (file) => readFileSync(join(REPO_ROOT, file), 'utf8').match(/function globToRegExp\(glob\) \{[\s\S]*?\n\}\n/)[0]
    expect(slice('scripts/docs-sync.mjs')).toBe(slice('.claude/hooks/pre-tool-use.mjs'))
  })
})
