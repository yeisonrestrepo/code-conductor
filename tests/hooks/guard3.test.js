import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join, resolve } from 'path'
import fs from 'fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = resolve(__dirname, '../..')
const HOOK = join(REPO_ROOT, '.claude/hooks/pre-tool-use.sh')
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

function run(cmd) {
  const result = spawnSync(BASH, [HOOK], {
    stdio: 'pipe',
    cwd: REPO_ROOT,
    timeout: 10000,
    env: { ...process.env, CLAUDE_TOOL_NAME: 'Bash', CLAUDE_TOOL_INPUT: jsonCmd(cmd) },
  })
  if (result.error) throw new Error(`bash spawn failed (${result.error.code}): ${result.error.message}`)
  // Strip ANSI SGR escape sequences before asserting; CI terminals and some
  // shell configs emit color codes that would break exact-string comparisons.
  const strip = s => s.replace(/\r\n|\r/g, '\n').replace(/\x1b\[[0-9;]*m/g, '')
  return {
    status: result.status ?? -1,
    stdout: strip((result.stdout ?? Buffer.alloc(0)).toString()),
    stderr: strip((result.stderr ?? Buffer.alloc(0)).toString()),
  }
}

function runRead() {
  const result = spawnSync(BASH, [HOOK], {
    stdio: 'pipe',
    cwd: REPO_ROOT,
    timeout: 10000,
    env: {
      ...process.env,
      CLAUDE_TOOL_NAME: 'Read',
      CLAUDE_TOOL_INPUT: '{"file_path":"/tmp/x"}',
    },
  })
  if (result.error) throw new Error(`bash spawn failed (${result.error.code}): ${result.error.message}`)
  return result.status ?? -1
}

function runAllowlisted(cmd, entries) {
  const lines = fs.readFileSync(HOOK, 'utf8').replace(/\r\n|\r/g, '\n').split('\n')
  // Dynamically locate BASH_SCAN_ALLOWLIST block to preserve the actual script
  // header. Handles both single-line `=()` and multi-line `=(\n...\n)` by
  // tracking parenthesis depth rather than assuming line structure.
  const startIdx = lines.findIndex(l => /^BASH_SCAN_ALLOWLIST\s*=/.test(l))
  if (startIdx === -1) throw new Error('BASH_SCAN_ALLOWLIST= not found in hook')
  let depth = 0
  let endIdx = startIdx
  let closeCharPos = -1
  outer: for (let i = startIdx; i < lines.length; i++) {
    for (let k = 0; k < lines[i].length; k++) {
      const ch = lines[i][k]
      if (ch === '(') depth++
      else if (ch === ')') {
        depth--
        if (depth <= 0) { endIdx = i; closeCharPos = k; break outer }
      }
    }
  }
  // Preserve any content on the closing-paren line after `)` (e.g., inline comments).
  const closingSuffix = closeCharPos >= 0 ? lines[endIdx].slice(closeCharPos + 1) : ''
  const header = lines.slice(0, startIdx).join('\n')
  const restLines = lines.slice(endIdx + 1).join('\n')
  const tail = closingSuffix ? closingSuffix + (restLines ? '\n' + restLines : '') : restLines
  const modified = `${header}\nBASH_SCAN_ALLOWLIST=(${entries})\n${tail}`
  const tmpDir = fs.mkdtempSync(join(TESTS_TMP, 'cc-guard3-'))
  const tmpHook = join(tmpDir, 'hook.sh')
  try {
    fs.writeFileSync(tmpHook, modified, 'utf8')
    const result = spawnSync(BASH, [tmpHook], {
      stdio: 'pipe',
      cwd: REPO_ROOT,
      timeout: 10000,
      env: { ...process.env, CLAUDE_TOOL_NAME: 'Bash', CLAUDE_TOOL_INPUT: jsonCmd(cmd) },
    })
    if (result.error) throw new Error(`bash spawn failed (${result.error.code}): ${result.error.message}`)
    return result.status ?? -1
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
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

  describe('sanity', () => {
    it('empty command passes', () => expect(run('').status).toBe(0))
    it('Read tool bypasses Guard 3', () => expect(runRead()).toBe(0))
  })

  describe('preprocessing: line continuation', () => {
    it('continuation joined: cat over two lines', () => expect(run('cat \\\n*.ts').status).not.toBe(0))
    it('even backslashes: not joined', () => expect(run('ls\\\\\ncat *.ts').status).not.toBe(0))
    it('CRLF continuation normalised', () => expect(run('cat \\\r\n*.ts').status).not.toBe(0))
  })

  describe('preprocessing: comment stripping', () => {
    it('unquoted hash stripped; cat *.ts blocked', () => expect(run('cat *.ts # safe comment').status).not.toBe(0))
    it('hash in double quotes is literal', () => expect(run('grep "#pat" file.txt').status).toBe(0))
    it('hash in single quotes is literal', () => expect(run("grep '#pat' file.txt").status).toBe(0))
    it('backslash-hash in UNQUOTED is literal', () => expect(run('grep \\#pat file.txt').status).toBe(0))
  })

  describe('P1: find without/wrong depth', () => {
    it('find . (no depth)', () => expect(run('find .').status).not.toBe(0))
    it('find -maxdepth 2', () => expect(run('find src/ -maxdepth 2').status).not.toBe(0))
    it('find --maxdepth=5', () => expect(run('find / --maxdepth=5').status).not.toBe(0))
    it('find -maxdepth 1 passes', () => expect(run('find . -maxdepth 1').status).toBe(0))
    it('find --maxdepth=1 passes', () => expect(run('find . --maxdepth=1').status).toBe(0))
    it('find -maxdepth +1 (+ stripped)', () => expect(run('find . -maxdepth +1').status).toBe(0))
    it('find -maxdepth +2 blocked', () => expect(run('find . -maxdepth +2').status).not.toBe(0))
    it('findall not triggered (word-boundary)', () => expect(run('findall . -maxdepth 5').status).toBe(0))
  })

  describe('P2: find -exec content dump', () => {
    it('find -exec cat', () => expect(run('find . -exec cat {} \\;').status).not.toBe(0))
    it('find -execdir grep', () => expect(run('find . -maxdepth 1 -execdir grep -r . {} \\;').status).not.toBe(0))
    it('find -ok sh -c', () => expect(run("find . -ok sh -c 'cat {}' \\;").status).not.toBe(0))
    it('find -exec echo (not a reader)', () => expect(run('find . -maxdepth 1 -exec echo {} \\;').status).toBe(0))
  })

  describe('P3: xargs + viewer', () => {
    it('xargs cat', () => expect(run('ls | xargs cat').status).not.toBe(0))
    it('xargs -0 less', () => expect(run('find . | xargs -0 less').status).not.toBe(0))
    it('xargs -I {} cat {}', () => expect(run('xargs -I {} cat {}').status).not.toBe(0))
    it('xargs -d - cat (bare - consumed)', () => expect(run('xargs -d - cat').status).not.toBe(0))
    it('xargs -d -- cat (-- consumed)', () => expect(run('xargs -d -- cat').status).not.toBe(0))
    it('xargs -d -x cat (-x not consumed)', () => expect(run('xargs -d -x cat').status).not.toBe(0))
    it('xargs -i boolean (no extra token)', () => expect(run('xargs -i cat').status).not.toBe(0))
    it('xargs sh (shell interpreter)', () => expect(run('find . | xargs sh -c cat').status).not.toBe(0))
    it('xargs echo (not a reader)', () => expect(run('ls | xargs echo').status).toBe(0))
  })

  describe('P4: cat + glob', () => {
    it('cat *.md', () => expect(run('cat *.md').status).not.toBe(0))
    it('cat src/**/*.ts', () => expect(run('cat src/**/*.ts').status).not.toBe(0))
    it('cat dir/??.sh', () => expect(run('cat dir/??.sh').status).not.toBe(0))
    it('cat {a,b}.ts', () => expect(run('cat {a,b}.ts').status).not.toBe(0))
    it('cat [abc].md', () => expect(run('cat [abc].md').status).not.toBe(0))
    it("cat '*.md' (quoted passes)", () => expect(run("cat '*.md'").status).toBe(0))
    it('cat "*.ts" (quoted passes)', () => expect(run('cat "*.ts"').status).toBe(0))
    it('cat \\*.ts (escaped passes)', () => expect(run('cat \\*.ts').status).toBe(0))
    it('cat \\\\*.ts (double-bs blocks)', () => expect(run('cat \\\\*.ts').status).not.toBe(0))
    it('/bin/cat *.md (path-invoked)', () => expect(run('/bin/cat *.md').status).not.toBe(0))
    it('concatenate *.md (word boundary)', () => expect(run('concatenate *.md').status).toBe(0))
  })

  describe('P5: cmd-subst + reading', () => {
    it('cat $(ls)', () => expect(run('cat $(ls)').status).not.toBe(0))
    it('cat with backtick', () => expect(run('cat `ls`').status).not.toBe(0))
    it('cat src/$(dir)/main.ts (prefix)', () => expect(run('cat src/$(dir)/main.ts').status).not.toBe(0))
    it('cat $(root)/pkg.json (exempt)', () => expect(run('cat "$(git rev-parse --show-toplevel)"/package.json').status).toBe(0))
  })

  describe('P6: grep match-all', () => {
    it("grep -r '.*' .", () => expect(run("grep -r '.*' .").status).not.toBe(0))
    it("egrep -R '' .", () => expect(run("egrep -R '' .").status).not.toBe(0))
    it("git grep '.*'", () => expect(run("git grep '.*'").status).not.toBe(0))
    it("git grep '' (empty)", () => expect(run("git grep ''").status).not.toBe(0))
    it("grep -r -F '.*' (fixed-strings)", () => expect(run("grep -r -F '.*' .").status).toBe(0))
    it("grep -r -e foo -e '.*' .", () => expect(run("grep -r -e foo -e '.*' .").status).not.toBe(0))
    it("grep -r --regexp='.*' .", () => expect(run("grep -r --regexp='.*' .").status).not.toBe(0))
    it('grep -r pattern src/ (targeted)', () => expect(run('grep -r pattern src/').status).toBe(0))
  })

  describe('P7: pager + glob', () => {
    it('less *.ts', () => expect(run('less *.ts').status).not.toBe(0))
    it('head *.log', () => expect(run('head *.log').status).not.toBe(0))
    it("awk '{p}' *.ts", () => expect(run("awk '{p}' *.ts").status).not.toBe(0))
    it('sed -n p *.md', () => expect(run('sed -n p *.md').status).not.toBe(0))
    it("less 'file.ts' (quoted passes)", () => expect(run("less 'file.ts'").status).toBe(0))
  })

  describe('P8: ls -R', () => {
    it('ls -R .', () => expect(run('ls -R .').status).not.toBe(0))
    it('ls -laR', () => expect(run('ls -laR').status).not.toBe(0))
    it('ls --recursive src/', () => expect(run('ls --recursive src/').status).not.toBe(0))
    it('ls -l (no R)', () => expect(run('ls -l .').status).toBe(0))
    it('rsync -R (not ls)', () => expect(run('rsync -R src/ dest/').status).toBe(0))
  })

  describe('P9: shell loop', () => {
    it('for f in *.ts', () => expect(run('for f in *.ts; do cat $f; done').status).not.toBe(0))
    it('while true', () => expect(run('while true; do less $f; done').status).not.toBe(0))
    it('until false', () => expect(run('until false; do grep -r . ; done').status).not.toBe(0))
    it('for loop non-reader body blocked', () => expect(run('for f in *.ts; do wc -l $f; done').status).not.toBe(0))
    it('grep ... while_loop.ts (arg)', () => expect(run('grep -r pat while_loop.ts').status).toBe(0))
    it('cat for (literal filename passes)', () => expect(run('cat for').status).toBe(0))
  })

  describe('P10: mapfile / readarray', () => {
    it('mapfile -t arr', () => expect(run('mapfile -t arr < src/main.ts').status).not.toBe(0))
    it('readarray lines', () => expect(run('readarray lines < *.log').status).not.toBe(0))
  })

  describe('P11: eval / source / dot', () => {
    it('eval cat', () => expect(run('eval "cat *.ts"').status).not.toBe(0))
    it('source dump.sh', () => expect(run('source dump.sh').status).not.toBe(0))
    it('. dump.sh (dot operator)', () => expect(run('. dump.sh').status).not.toBe(0))
    it('./script.sh (path, not dot op)', () => expect(run('./script.sh').status).toBe(0))
  })

  describe('P12: alias remapping', () => {
    it("alias c=cat", () => expect(run("alias c='cat'").status).not.toBe(0))
    it("alias g=grep", () => expect(run("alias g='grep -r'").status).not.toBe(0))
    it("alias e=echo (not a reader)", () => expect(run("alias e='echo'").status).toBe(0))
  })

  describe('obfuscation detection', () => {
    it('$"cat" prefix blocked', () => expect(run('$"cat" *.ts').status).not.toBe(0))
    it("c'a't (internal quote)", () => expect(run("c'a't *.ts").status).not.toBe(0))
  })

  describe('multi-line scripts', () => {
    it('cat glob on line 2', () => expect(run('echo start\ncat *.ts').status).not.toBe(0))
    it('all safe', () => expect(run('ls -l .\necho done').status).toBe(0))
    it('for loop on line 2', () => expect(run('echo prep\nfor f in *.ts; do echo $f; done').status).not.toBe(0))
    it('continuation joins cat', () => expect(run('cat \\\n*.ts').status).not.toBe(0))
    it('find continuation valid', () => expect(run('find . \\\n-maxdepth 1').status).toBe(0))
  })

  describe('nested subshells and process substitution', () => {
    it('echo $(cat *.ts)', () => expect(run('echo $(cat *.ts)').status).not.toBe(0))
    it('echo $(git log)', () => expect(run('echo $(git log --oneline)').status).toBe(0))
    it('sort < <(cat *.ts)', () => expect(run('sort < <(cat *.ts)').status).not.toBe(0))
    it('x=$((1+2)) safe', () => expect(run('x=$((1+2)); echo $x').status).toBe(0))
    it("wc -l $(grep -r '.*' .)", () => expect(run("wc -l $(grep -r '.*' .)").status).not.toBe(0))
  })

  describe('edge cases: quote/escape combinations', () => {
    it('double-backslash-star glob', () => expect(run('cat \\\\*.ts').status).not.toBe(0))
    it('single-backslash-star safe', () => expect(run('cat \\*.ts').status).toBe(0))
    it("ansi-c: $'cat' arg is fine", () => expect(run("echo $'cat'").status).toBe(0))
    it("single-quote: backslash then quote", () => expect(run("grep 'can'\\''t' file").status).toBe(0))
    it("nested-quote: outer-dq inner-sq", () => expect(run("grep \"it'\\''s fine\" file").status).toBe(0))
    it('json escape: embedded quote', () => expect(run('echo "hello \\"world\\""').status).toBe(0))
    it('regex: grep -r specific-re', () => expect(run('grep -r "fo[o]" src/').status).toBe(0))
    it('path-looking: dot in path is allowed', () => expect(run('grep -r pattern src/main.ts').status).toBe(0))
    it('length: 8192-char command passes', () => expect(run('#'.repeat(8192)).status).toBe(0))
    it('length: 8193-char command blocked', () => expect(run('#'.repeat(8193)).status).not.toBe(0))
    it('malformed: unclosed single quote', () => expect(run("cat '*.ts").status).not.toBe(0))
    it('malformed: unclosed double quote', () => expect(run('grep -r "pat .').status).not.toBe(0))
  })

  describe('allowlist', () => {
    it('docs/ permits glob in docs/', () => expect(runAllowlisted('cat docs/*.md', '"docs/"')).toBe(0))
    it('does NOT permit unrelated path', () => expect(runAllowlisted('cat src/*.ts', '"docs/"')).not.toBe(0))
    it('trailing-comment bypass blocked', () => expect(runAllowlisted('cat *.ts # docs/', '"docs/"')).not.toBe(0))
    it('path-traversal rejected', () => expect(runAllowlisted('cat docs/../../etc/*.conf', '"docs/"')).not.toBe(0))
    it('exact match (no trailing slash)', () => expect(runAllowlisted('cat file.ts', '"file.ts"')).toBe(0))
    it('substring not matched (docs vs doc_files)', () => expect(runAllowlisted('cat doc_files/*.ts', '"docs/"')).not.toBe(0))
  })

})
