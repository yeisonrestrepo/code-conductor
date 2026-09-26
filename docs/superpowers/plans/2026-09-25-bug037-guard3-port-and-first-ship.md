# Guard 3 Port and First Ship Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill the Guard 3 slot that 1.28.0 declared, so the twelve-pattern bash command scanner ships to users for the first time.

**Architecture:** The thirteen checks, the preprocessing chain and the allowlist reader are translated from `tests/fixtures/guard3-reference.sh` into `project-template/.claude/hooks/pre-tool-use.mjs`, which stays one self-contained file. The allowlist moves out of the artifact into a project file the installer never ships. The 108 corpus cases become one shared table driving both the frozen bash authority and the port, asserting identical verdicts everywhere except one row where the port deliberately differs.

**Tech Stack:** Node >= 20 (`node:fs`, `node:path` only), Vitest, bash (frozen authority only).

**Spec:** `docs/superpowers/specs/2026-09-25-bug037-guard3-port-and-first-ship-design.md`

## Global Constraints

- The hook imports only `node:` builtins, adds no `dependencies` entry, and stays **one file**: no sibling module, because a missing sibling makes `import` fail at module load and fails the whole hook open.
- Every path exits 0. Guard 3 denies through `hookSpecificOutput.permissionDecision`, never an exit code.
- **No `\s`, `\S`, `\w`, `\W`, `\d` or `\D` anywhere in the guard's pattern block.** `[[:space:]]` in the C locale is exactly `[ \t\n\r\f\v]`; JavaScript `\s` also matches U+00A0, U+2028, U+2029 and U+FEFF and would widen every check.
- **The fixture's allowlist-source edit lands in its own commit before any ported pattern**, with all 108 green against the edited fixture, confined to where the array is populated, and the fixture header amended in that same commit.
- **Exactly one differential exception row may exist** (entry `file.ts` against command `cat fileXts`), asserted as an inequality by design; a test asserts the exception list has one member.
- Guard logic is translated, not revised. Where the authority has a quirk, the quirk ports verbatim: see the `rest.slice(match[0].length)` note in Task 3.
- `npm test` green at every commit. Baseline: **617 passed / 12 skipped**.
- All plan state updates are surgical single-line edits (BUG-003 invariant).
- No em-dashes in any file this plan writes.

## Pre-Flight Analysis

**Happy path.** Claude Code fires `PreToolUse` for a `Bash` call, the front door parses stdin and dispatches to Guard 3, the command is preprocessed, none of the thirteen checks fires, the hook writes nothing and exits 0.

**Failure points, each with its mitigation in a step below.**

1. **The authority slices by match length from position 0, not from the match index.** `_g3_p4_cat_glob` does `after="${rest:mlen}"` where `mlen` is the length of `BASH_REMATCH[0]`. For `ls; cat *.ts` the match is `; cat ` (6 characters) and bash's `after` is therefore `at *.ts`, not `*.ts`. The port must replicate this with `rest.slice(m[0].length)`, **not** `rest.slice(m.index + m[0].length)`. The same applies to `_g3_p7_pager_glob`. Getting this "right" would be getting it wrong.
2. **`read -ra` splits on IFS (space, tab, newline), not on `[[:space:]]`.** P3 and P6's token walks use `[ \t\n]+`, not the six-character class used elsewhere.
3. **Allowlist capture-group index.** `_bd` contributes group 1, so the directory suffix is `BASH_REMATCH[2]`. Escaping entries must not introduce groups, which is why the escape function escapes `(` and `)`.
4. **The continuation joiner appends a newline after every non-continued line, including the last**, because bash's `<<<` supplies a trailing newline. The preprocessed string therefore normally ends in `;`. The port must do the same or every `([[:space:]]|$)` anchor shifts.
5. **Test isolation.** Both subjects resolve the allowlist relative to the process cwd. Every table case spawns with cwd set to a per-run temp directory, so the suite can never read or write the developer's own `.claude/memory/`.

**Boundary conditions covered by rows in the table:** empty command; 8192 and 8193 characters; unclosed single and double quotes; escaped, single-quoted and double-quoted globs; a literal filename that happens to be a keyword (`cat for`); U+00A0 and U+2028 where `\s` would have matched; an allowlist file that is absent, empty, comment-only, or unreadable.

---

## File Structure

| File | Responsibility |
|---|---|
| `tests/fixtures/guard3-reference.sh` | The frozen authority. Edited exactly once, in Task 1, to read the allowlist from a file instead of an array literal, plus a header amendment naming the two sanctioned exceptions. |
| `tests/fixtures/guard3-corpus.js` | New. The shared table: `CORPUS` (108 rows) and `DIALECT` (7 rows), plus `EXCEPTIONS` (1 row). Data only, no assertions. |
| `tests/hooks/guard3.test.js` | Runs the table against the bash authority. Cases become rows; the harness writes the allowlist file instead of rewriting the hook. |
| `tests/hooks/guard3-port.test.js` | New. Runs the same table against the shipped `.mjs`, plus the exception row and the exception-count assertion. |
| `tests/guard3-test.sh` | Standalone bash harness; its allowlist splice becomes a file write. |
| `project-template/.claude/hooks/pre-tool-use.mjs` | Guard 3's slot filled: constants block, preprocessing chain, thirteen-row check table, allowlist reader, decision writer. |
| `.claude/hooks/pre-tool-use.mjs` | Byte-identical mirror. |
| `tests/installer/templates.test.js` | Asserts no regex shorthand in the pattern block and no shipped allowlist file. |
| `tests/hooks/pre-tool-use-contract.test.js` | Gains the warn-mode conversion test and the four-boundary scope test. |
| `README.md`, `CLAUDE.md`, `project-template/CLAUDE.md` | Guard 3 described as shipped. |
| `VERSION`, `package.json`, `package-lock.json`, `CHANGELOG.md`, `AGENT-READABLE BACKLOG.md` | Release 1.29.0. |

## Predicted test counts at every boundary

| After | Passed | Skipped | Why |
|---|---|---|---|
| Baseline | 617 | 12 | Current `main`. |
| Task 1 | 617 | 12 | Harness mechanics only; still 108 Guard 3 cases. |
| Task 2 | 618 | 12 | 108 table rows replace 108 inline cases, plus one row-count assertion. |
| Task 3 | 744 | 12 | Fixture suite gains 7 dialect rows; new port suite adds 115 rows plus the exception row plus the exception-count test; templates gains 2. |
| Task 4 | 746 | 12 | Warn conversion test plus the four-boundary scope test. |
| Task 5 | 746 | 12 | Documentation only. |
| Task 6 | 746 | 12 | Release only. |

**Honest note on Task 4's red state.** The four-boundary scope test asserts *absences* (other guards unaffected by `CC_GUARD3_WARN`), and an absence is trivially true while the feature does not exist, so that test passes before its implementation. Task 4's genuine red is one failing case, not two. Its value is as a regression guard afterward, which is why the spec requires it in the same commit rather than requiring it to fail first.

---

## Task 0: Branch and plan commit

**Files:**
- Create: `docs/superpowers/plans/2026-09-25-bug037-guard3-port-and-first-ship.md` (this file)

**Interfaces:**
- Consumes: nothing.
- Produces: the plan tracked in git on the feature branch.

- [X] [T-000-A] Stage the plan file. `docs/` is gitignored, so it must be force-added.

```bash
git add -f "docs/superpowers/plans/2026-09-25-bug037-guard3-port-and-first-ship.md"
```

- [X] [T-000-B] Verify exactly one path is staged. Depends on T-000-A.

```bash
git diff --cached --name-only
```
Expected: one line, the plan file.

- [X] [T-000-C] Commit the plan. Depends on T-000-B.

```bash
git commit -m "$(cat <<'EOF'
docs: add the BUG-037 Guard 3 port implementation plan

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 1: The authority reads the allowlist from a file

**Files:**
- Modify: `tests/fixtures/guard3-reference.sh:2-9` (header) and `:375` (the array literal)
- Modify: `tests/hooks/guard3.test.js` (the `runAllowlisted` harness only, not one case)
- Modify: `tests/guard3-test.sh:176-183` (the allowlist splice)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: both bash harnesses now express an allowlist by writing `.claude/memory/bash-scan-allowlist.txt` in the spawn's cwd. `runAllowlisted(cmd, entries)` takes `entries` as a **JavaScript array of strings** rather than a bash array literal fragment, and spawns with `cwd` set to a temp directory.

This task lands before any ported pattern so that a break in the authority surfaces against the authority alone.

- [X] [T-001-A] Teach the fixture to read the allowlist file. Modify `tests/fixtures/guard3-reference.sh`, replacing:

```bash
# BASH_SCAN_ALLOWLIST: exact literal path tokens the guard permits.
# Operators add entries here. Agents must NEVER modify this array.
BASH_SCAN_ALLOWLIST=()
```

with:

```bash
# BASH_SCAN_ALLOWLIST: exact literal path tokens the guard permits.
# Populated from .claude/memory/bash-scan-allowlist.txt, resolved against the
# process cwd, so operator policy survives an installer re-run. Absent or
# unreadable means an empty list. Blank lines and # comments are skipped, and
# each entry is trimmed. This is one of the two sanctioned edits to this file;
# see the header.
BASH_SCAN_ALLOWLIST=()
_g3_allowlist_file=".claude/memory/bash-scan-allowlist.txt"
if [ -r "$_g3_allowlist_file" ]; then
  while IFS= read -r _g3_line || [ -n "$_g3_line" ]; do
    _g3_line="${_g3_line%$'\r'}"
    _g3_line="${_g3_line#"${_g3_line%%[![:space:]]*}"}"
    _g3_line="${_g3_line%"${_g3_line##*[![:space:]]}"}"
    [ -z "$_g3_line" ] && continue
    case "$_g3_line" in '#'*) continue ;; esac
    BASH_SCAN_ALLOWLIST+=("$_g3_line")
  done < "$_g3_allowlist_file"
fi
unset _g3_line _g3_allowlist_file
```

`unset` on a name that was never set is not an error under `set -u`, so the trailing cleanup is safe whether or not the file existed.

- [X] [T-001-B] Amend the fixture header so it stays true. Depends on T-001-A. Modify `tests/fixtures/guard3-reference.sh`, replacing:

```bash
# tests/hooks/guard3.test.js. Do not edit to make a port pass.
```

with:

```bash
# tests/hooks/guard3.test.js. Do not edit to make a port pass.
#
# Two sanctioned exceptions exist, both recorded in
# docs/superpowers/specs/2026-09-25-bug037-guard3-port-and-first-ship-design.md:
#   1. The allowlist is populated from .claude/memory/bash-scan-allowlist.txt
#      instead of an array literal, so both subjects read one source.
#   2. The port escapes allowlist entries and matches them literally, where this
#      file interpolates them raw into an ERE. Entry file.ts therefore allows
#      "cat fileXts" here and denies it there. That inequality is asserted by
#      design in the corpus EXCEPTIONS table; it is not a port defect.
# Nothing else in this file moves.
```

- [X] [T-001-C] Re-point the Vitest allowlist harness at the file. Depends on T-001-A. In `tests/hooks/guard3.test.js`, replace the whole `runAllowlisted` function (the block beginning `function runAllowlisted(cmd, entries) {` and ending at its closing brace) with:

```js
// The allowlist is now a file both subjects read, so the harness writes it into a
// throwaway cwd instead of splicing the hook. Every spawn gets a fresh cwd, which
// also guarantees the suite can never read the developer's own .claude/memory/.
function runAllowlisted(cmd, entries) {
  const dir = fs.mkdtempSync(join(TESTS_TMP, 'cc-guard3-'))
  try {
    if (entries && entries.length) {
      fs.mkdirSync(join(dir, '.claude', 'memory'), { recursive: true })
      fs.writeFileSync(join(dir, '.claude', 'memory', 'bash-scan-allowlist.txt'), entries.join('\n') + '\n', 'utf8')
    }
    const result = spawnSync(BASH, [HOOK], {
      stdio: 'pipe',
      cwd: dir,
      timeout: 10000,
      env: { ...process.env, CLAUDE_TOOL_NAME: 'Bash', CLAUDE_TOOL_INPUT: jsonCmd(cmd) },
    })
    if (result.error) throw new Error(`bash spawn failed (${result.error.code}): ${result.error.message}`)
    return result.status ?? -1
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
```

- [X] [T-001-D] Update the six allowlist call sites to pass an array. Depends on T-001-C. The verdicts do not move; only the argument's shape does. In `tests/hooks/guard3.test.js`, replace the `describe('allowlist', ...)` block with:

```js
  describe('allowlist', () => {
    it('docs/ permits glob in docs/', () => expect(runAllowlisted('cat docs/*.md', ['docs/'])).toBe(0))
    it('does NOT permit unrelated path', () => expect(runAllowlisted('cat src/*.ts', ['docs/'])).not.toBe(0))
    it('trailing-comment bypass blocked', () => expect(runAllowlisted('cat *.ts # docs/', ['docs/'])).not.toBe(0))
    it('path-traversal rejected', () => expect(runAllowlisted('cat docs/../../etc/*.conf', ['docs/'])).not.toBe(0))
    it('exact match (no trailing slash)', () => expect(runAllowlisted('cat file.ts', ['file.ts'])).toBe(0))
    it('substring not matched (docs vs doc_files)', () => expect(runAllowlisted('cat doc_files/*.ts', ['docs/'])).not.toBe(0))
  })
```

- [X] [T-001-E] Re-point the standalone bash harness. Depends on T-001-A. In `tests/guard3-test.sh`, replace the block that splices the allowlist into a temporary hook copy (the lines around `printf 'BASH_SCAN_ALLOWLIST=(%s)\n'` and `tail -n +2 "$HOOK" | grep -v '^BASH_SCAN_ALLOWLIST='`) with a temp-cwd file write:

```bash
run_allowlisted() {
  local label="$1" cmd="$2" entries="$3" expect="$4" rc=0
  local dir; dir="$(mktemp -d)"
  mkdir -p "$dir/.claude/memory"
  printf '%s\n' $entries > "$dir/.claude/memory/bash-scan-allowlist.txt"
  export CLAUDE_TOOL_NAME="Bash"
  export CLAUDE_TOOL_INPUT="$(_json_cmd "$cmd")"
  ( cd "$dir" && bash "$REPO_ROOT/$HOOK" ) >/dev/null 2>&1 && rc=0 || rc=$?
  unset CLAUDE_TOOL_NAME CLAUDE_TOOL_INPUT
  rm -rf "$dir"
  if { [[ "$expect" == "block" ]] && (( rc != 0 )); } \
  || { [[ "$expect" == "pass"  ]] && (( rc == 0 )); }; then
    echo "  PASS: $label"; PASS=$((PASS+1))
  else
    echo "  FAIL: $label  [expected=$expect rc=$rc]"; FAIL=$((FAIL+1))
  fi
}
```

Add `REPO_ROOT="$(pwd)"` immediately after the existing `HOOK=` assignment, since the subshell changes directory and `HOOK` is a relative path.

- [X] [T-001-F] Run the Guard 3 suite against the edited authority. Depends on T-001-D.

Run: `npx vitest run tests/hooks/guard3.test.js`
Expected: **108 passed**. A failure here is a defect in the fixture edit, not in any port, because no port exists yet. That separation is the whole reason this task is first.

- [X] [T-001-G] Run the full suite. Depends on T-001-F.

Run: `npm test`
Expected: **617 passed | 12 skipped**, unchanged from baseline.

- [X] [T-001-H] Stage the three files. Depends on T-001-G.

```bash
git add tests/fixtures/guard3-reference.sh tests/hooks/guard3.test.js tests/guard3-test.sh
```

- [X] [T-001-I] Verify exactly three staged paths. Depends on T-001-H.

```bash
git diff --cached --name-only
```
Expected: three lines, `tests/fixtures/guard3-reference.sh`, `tests/guard3-test.sh`, `tests/hooks/guard3.test.js`.

- [X] [T-001-J] Commit. Depends on T-001-I.

```bash
git commit -m "$(cat <<'EOF'
test: read the Guard 3 allowlist from a file in the frozen authority [BUG-037]

One of the two sanctioned edits to the frozen fixture, landing before any ported
pattern so a break here cannot be confused with a port defect. The array literal
becomes a read of .claude/memory/bash-scan-allowlist.txt, both bash harnesses
write that file in a throwaway cwd, and the header now names both exceptions so
it stays true. All 108 cases green, no verdict moved.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: The corpus becomes one shared table

**Files:**
- Create: `tests/fixtures/guard3-corpus.js`
- Modify: `tests/hooks/guard3.test.js` (cases become table rows)

**Interfaces:**
- Consumes: the file-based allowlist harness from Task 1.
- Produces: `tests/fixtures/guard3-corpus.js` exporting `CORPUS`, an array of 108 rows shaped `{ label, command, verdict, toolName?, allowlist? }` where `verdict` is `'deny'` or `'allow'`, `toolName` defaults to `'Bash'`, and `allowlist` is an optional array of entry strings. Task 3 adds `DIALECT` and `EXCEPTIONS` to the same module.

- [X] [T-002-A] Create the shared corpus table. Create `tests/fixtures/guard3-corpus.js`:

```js
// The Guard 3 corpus, converted once from the inline cases that lived in
// tests/hooks/guard3.test.js. Data only: no assertions, no spawning. Two subjects
// consume it, the frozen bash authority and the shipped .mjs port, and both must
// return the same verdict for every row. Rows are in the order of the original
// describe blocks so a reviewer can diff the conversion against git history.
//
// verdict: 'deny'  the guard must block this command
//          'allow' the guard must let it through
// toolName defaults to 'Bash'; the one 'Read' row proves the guard does not fire
// for another tool. allowlist, when present, is written to
// .claude/memory/bash-scan-allowlist.txt in the spawn's cwd, one entry per line.

export const CORPUS = [
  // sanity
  { label: 'empty command passes', command: '', verdict: 'allow' },
  { label: 'Read tool bypasses Guard 3', command: '', toolName: 'Read', verdict: 'allow' },

  // preprocessing: line continuation
  { label: 'continuation joined: cat over two lines', command: 'cat \\\n*.ts', verdict: 'deny' },
  { label: 'even backslashes: not joined', command: 'ls\\\\\ncat *.ts', verdict: 'deny' },
  { label: 'CRLF continuation normalised', command: 'cat \\\r\n*.ts', verdict: 'deny' },

  // preprocessing: comment stripping
  { label: 'unquoted hash stripped; cat *.ts blocked', command: 'cat *.ts # safe comment', verdict: 'deny' },
  { label: 'hash in double quotes is literal', command: 'grep "#pat" file.txt', verdict: 'allow' },
  { label: 'hash in single quotes is literal', command: "grep '#pat' file.txt", verdict: 'allow' },
  { label: 'backslash-hash in UNQUOTED is literal', command: 'grep \\#pat file.txt', verdict: 'allow' },

  // P1: find without/wrong depth
  { label: 'find . (no depth)', command: 'find .', verdict: 'deny' },
  { label: 'find -maxdepth 2', command: 'find src/ -maxdepth 2', verdict: 'deny' },
  { label: 'find --maxdepth=5', command: 'find / --maxdepth=5', verdict: 'deny' },
  { label: 'find -maxdepth 1 passes', command: 'find . -maxdepth 1', verdict: 'allow' },
  { label: 'find --maxdepth=1 passes', command: 'find . --maxdepth=1', verdict: 'allow' },
  { label: 'find -maxdepth +1 (+ stripped)', command: 'find . -maxdepth +1', verdict: 'allow' },
  { label: 'find -maxdepth +2 blocked', command: 'find . -maxdepth +2', verdict: 'deny' },
  { label: 'findall not triggered (word-boundary)', command: 'findall . -maxdepth 5', verdict: 'allow' },

  // P2: find -exec content dump
  { label: 'find -exec cat', command: 'find . -exec cat {} \\;', verdict: 'deny' },
  { label: 'find -execdir grep', command: 'find . -maxdepth 1 -execdir grep -r . {} \\;', verdict: 'deny' },
  { label: 'find -ok sh -c', command: "find . -ok sh -c 'cat {}' \\;", verdict: 'deny' },
  { label: 'find -exec echo (not a reader)', command: 'find . -maxdepth 1 -exec echo {} \\;', verdict: 'allow' },

  // P3: xargs + viewer
  { label: 'xargs cat', command: 'ls | xargs cat', verdict: 'deny' },
  { label: 'xargs -0 less', command: 'find . | xargs -0 less', verdict: 'deny' },
  { label: 'xargs -I {} cat {}', command: 'xargs -I {} cat {}', verdict: 'deny' },
  { label: 'xargs -d - cat (bare - consumed)', command: 'xargs -d - cat', verdict: 'deny' },
  { label: 'xargs -d -- cat (-- consumed)', command: 'xargs -d -- cat', verdict: 'deny' },
  { label: 'xargs -d -x cat (-x not consumed)', command: 'xargs -d -x cat', verdict: 'deny' },
  { label: 'xargs -i boolean (no extra token)', command: 'xargs -i cat', verdict: 'deny' },
  { label: 'xargs sh (shell interpreter)', command: 'find . | xargs sh -c cat', verdict: 'deny' },
  { label: 'xargs echo (not a reader)', command: 'ls | xargs echo', verdict: 'allow' },

  // P4: cat + glob
  { label: 'cat *.md', command: 'cat *.md', verdict: 'deny' },
  { label: 'cat src/**/*.ts', command: 'cat src/**/*.ts', verdict: 'deny' },
  { label: 'cat dir/??.sh', command: 'cat dir/??.sh', verdict: 'deny' },
  { label: 'cat {a,b}.ts', command: 'cat {a,b}.ts', verdict: 'deny' },
  { label: 'cat [abc].md', command: 'cat [abc].md', verdict: 'deny' },
  { label: "cat '*.md' (quoted passes)", command: "cat '*.md'", verdict: 'allow' },
  { label: 'cat "*.ts" (quoted passes)', command: 'cat "*.ts"', verdict: 'allow' },
  { label: 'cat \\*.ts (escaped passes)', command: 'cat \\*.ts', verdict: 'allow' },
  { label: 'cat \\\\*.ts (double-bs blocks)', command: 'cat \\\\*.ts', verdict: 'deny' },
  { label: '/bin/cat *.md (path-invoked)', command: '/bin/cat *.md', verdict: 'deny' },
  { label: 'concatenate *.md (word boundary)', command: 'concatenate *.md', verdict: 'allow' },

  // P5: cmd-subst + reading
  { label: 'cat $(ls)', command: 'cat $(ls)', verdict: 'deny' },
  { label: 'cat with backtick', command: 'cat `ls`', verdict: 'deny' },
  { label: 'cat src/$(dir)/main.ts (prefix)', command: 'cat src/$(dir)/main.ts', verdict: 'deny' },
  { label: 'cat $(root)/pkg.json (exempt)', command: 'cat "$(git rev-parse --show-toplevel)"/package.json', verdict: 'allow' },

  // P6: grep match-all
  { label: "grep -r '.*' .", command: "grep -r '.*' .", verdict: 'deny' },
  { label: "egrep -R '' .", command: "egrep -R '' .", verdict: 'deny' },
  { label: "git grep '.*'", command: "git grep '.*'", verdict: 'deny' },
  { label: "git grep '' (empty)", command: "git grep ''", verdict: 'deny' },
  { label: "grep -r -F '.*' (fixed-strings)", command: "grep -r -F '.*' .", verdict: 'allow' },
  { label: "grep -r -e foo -e '.*' .", command: "grep -r -e foo -e '.*' .", verdict: 'deny' },
  { label: "grep -r --regexp='.*' .", command: "grep -r --regexp='.*' .", verdict: 'deny' },
  { label: 'grep -r pattern src/ (targeted)', command: 'grep -r pattern src/', verdict: 'allow' },

  // P7: pager + glob
  { label: 'less *.ts', command: 'less *.ts', verdict: 'deny' },
  { label: 'head *.log', command: 'head *.log', verdict: 'deny' },
  { label: "awk '{p}' *.ts", command: "awk '{p}' *.ts", verdict: 'deny' },
  { label: 'sed -n p *.md', command: 'sed -n p *.md', verdict: 'deny' },
  { label: "less 'file.ts' (quoted passes)", command: "less 'file.ts'", verdict: 'allow' },

  // P8: ls -R
  { label: 'ls -R .', command: 'ls -R .', verdict: 'deny' },
  { label: 'ls -laR', command: 'ls -laR', verdict: 'deny' },
  { label: 'ls --recursive src/', command: 'ls --recursive src/', verdict: 'deny' },
  { label: 'ls -l (no R)', command: 'ls -l .', verdict: 'allow' },
  { label: 'rsync -R (not ls)', command: 'rsync -R src/ dest/', verdict: 'allow' },

  // P9: shell loop
  { label: 'for f in *.ts', command: 'for f in *.ts; do cat $f; done', verdict: 'deny' },
  { label: 'while true', command: 'while true; do less $f; done', verdict: 'deny' },
  { label: 'until false', command: 'until false; do grep -r . ; done', verdict: 'deny' },
  { label: 'for loop non-reader body blocked', command: 'for f in *.ts; do wc -l $f; done', verdict: 'deny' },
  { label: 'grep ... while_loop.ts (arg)', command: 'grep -r pat while_loop.ts', verdict: 'allow' },
  { label: 'cat for (literal filename passes)', command: 'cat for', verdict: 'allow' },

  // P10: mapfile / readarray
  { label: 'mapfile -t arr', command: 'mapfile -t arr < src/main.ts', verdict: 'deny' },
  { label: 'readarray lines', command: 'readarray lines < *.log', verdict: 'deny' },

  // P11: eval / source / dot
  { label: 'eval cat', command: 'eval "cat *.ts"', verdict: 'deny' },
  { label: 'source dump.sh', command: 'source dump.sh', verdict: 'deny' },
  { label: '. dump.sh (dot operator)', command: '. dump.sh', verdict: 'deny' },
  { label: './script.sh (path, not dot op)', command: './script.sh', verdict: 'allow' },

  // P12: alias remapping
  { label: 'alias c=cat', command: "alias c='cat'", verdict: 'deny' },
  { label: 'alias g=grep', command: "alias g='grep -r'", verdict: 'deny' },
  { label: 'alias e=echo (not a reader)', command: "alias e='echo'", verdict: 'allow' },

  // obfuscation detection
  { label: '$"cat" prefix blocked', command: '$"cat" *.ts', verdict: 'deny' },
  { label: "c'a't (internal quote)", command: "c'a't *.ts", verdict: 'deny' },

  // multi-line scripts
  { label: 'cat glob on line 2', command: 'echo start\ncat *.ts', verdict: 'deny' },
  { label: 'all safe', command: 'ls -l .\necho done', verdict: 'allow' },
  { label: 'for loop on line 2', command: 'echo prep\nfor f in *.ts; do echo $f; done', verdict: 'deny' },
  { label: 'continuation joins cat', command: 'cat \\\n*.ts', verdict: 'deny' },
  { label: 'find continuation valid', command: 'find . \\\n-maxdepth 1', verdict: 'allow' },

  // nested subshells and process substitution
  { label: 'echo $(cat *.ts)', command: 'echo $(cat *.ts)', verdict: 'deny' },
  { label: 'echo $(git log)', command: 'echo $(git log --oneline)', verdict: 'allow' },
  { label: 'sort < <(cat *.ts)', command: 'sort < <(cat *.ts)', verdict: 'deny' },
  { label: 'x=$((1+2)) safe', command: 'x=$((1+2)); echo $x', verdict: 'allow' },
  { label: "wc -l $(grep -r '.*' .)", command: "wc -l $(grep -r '.*' .)", verdict: 'deny' },

  // edge cases: quote/escape combinations
  { label: 'double-backslash-star glob', command: 'cat \\\\*.ts', verdict: 'deny' },
  { label: 'single-backslash-star safe', command: 'cat \\*.ts', verdict: 'allow' },
  { label: "ansi-c: $'cat' arg is fine", command: "echo $'cat'", verdict: 'allow' },
  { label: 'single-quote: backslash then quote', command: "grep 'can'\\''t' file", verdict: 'allow' },
  { label: 'nested-quote: outer-dq inner-sq', command: "grep \"it'\\''s fine\" file", verdict: 'allow' },
  { label: 'json escape: embedded quote', command: 'echo "hello \\"world\\""', verdict: 'allow' },
  { label: 'regex: grep -r specific-re', command: 'grep -r "fo[o]" src/', verdict: 'allow' },
  { label: 'path-looking: dot in path is allowed', command: 'grep -r pattern src/main.ts', verdict: 'allow' },
  { label: 'length: 8192-char command passes', command: '#'.repeat(8192), verdict: 'allow' },
  { label: 'length: 8193-char command blocked', command: '#'.repeat(8193), verdict: 'deny' },
  { label: 'malformed: unclosed single quote', command: "cat '*.ts", verdict: 'deny' },
  { label: 'malformed: unclosed double quote', command: 'grep -r "pat .', verdict: 'deny' },

  // allowlist
  { label: 'docs/ permits glob in docs/', command: 'cat docs/*.md', allowlist: ['docs/'], verdict: 'allow' },
  { label: 'does NOT permit unrelated path', command: 'cat src/*.ts', allowlist: ['docs/'], verdict: 'deny' },
  { label: 'trailing-comment bypass blocked', command: 'cat *.ts # docs/', allowlist: ['docs/'], verdict: 'deny' },
  { label: 'path-traversal rejected', command: 'cat docs/../../etc/*.conf', allowlist: ['docs/'], verdict: 'deny' },
  { label: 'exact match (no trailing slash)', command: 'cat file.ts', allowlist: ['file.ts'], verdict: 'allow' },
  { label: 'substring not matched (docs vs doc_files)', command: 'cat doc_files/*.ts', allowlist: ['docs/'], verdict: 'deny' },
];
```

- [X] [T-002-B] Make the bash suite table-driven. Depends on T-002-A. In `tests/hooks/guard3.test.js`, add the import beside the existing ones:

```js
import { CORPUS } from '../fixtures/guard3-corpus.js'
```

then replace every `describe(...)` block inside `describe.skipIf(!BASH)('guard3 - pre-tool-use.sh', ...)` (that is, everything from `describe('sanity', () => {` through the closing brace of `describe('allowlist', ...)`) with:

```js
  it('the corpus table carries exactly 108 rows', () => {
    expect(CORPUS).toHaveLength(108)
  })

  it.each(CORPUS.map(r => [r.label, r]))('%s', (_label, row) => {
    const status = runRow(row)
    if (row.verdict === 'deny') expect(status).not.toBe(0)
    else expect(status).toBe(0)
  })
```

and add the single runner the rows drive, replacing the now-unused `run`, `runRead` and `runAllowlisted` helpers:

```js
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
```

- [X] [T-002-C] Run the Guard 3 suite. Depends on T-002-B.

Run: `npx vitest run tests/hooks/guard3.test.js`
Expected: **109 passed** (108 rows plus the row-count assertion). **There is no red state for this task by design:** the conversion is a refactor of green cases, and the fixture staying green on all 108 is exactly the evidence that the conversion is faithful. A failure here means a row was transcribed wrongly; fix the row against git history, never the fixture.

- [X] [T-002-D] Run the full suite. Depends on T-002-C.

Run: `npm test`
Expected: **618 passed | 12 skipped**.

- [X] [T-002-E] Stage both files. Depends on T-002-D.

```bash
git add tests/fixtures/guard3-corpus.js tests/hooks/guard3.test.js
```

- [X] [T-002-F] Verify exactly two staged paths. Depends on T-002-E.

```bash
git diff --cached --name-only
```
Expected: two lines, `tests/fixtures/guard3-corpus.js` and `tests/hooks/guard3.test.js`.

- [X] [T-002-G] Commit. Depends on T-002-F.

```bash
git commit -m "$(cat <<'EOF'
test: convert the Guard 3 corpus into one shared table [BUG-037]

108 inline cases become 108 data rows in tests/fixtures/guard3-corpus.js, driven
against the frozen authority by one runner. The fixture staying green on every row
is the evidence that the conversion is faithful; the port becomes the table's
second subject in the next commit.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: The port

**Files:**
- Modify: `tests/fixtures/guard3-corpus.js` (add `DIALECT` and `EXCEPTIONS`)
- Create: `tests/hooks/guard3-port.test.js`
- Modify: `project-template/.claude/hooks/pre-tool-use.mjs`
- Modify: `.claude/hooks/pre-tool-use.mjs` (mirror)
- Modify: `tests/hooks/guard3.test.js` (run `DIALECT` too)
- Modify: `tests/installer/templates.test.js`

**Interfaces:**
- Consumes: `CORPUS` from Task 2, the file-based allowlist from Task 1.
- Produces: `guard3BashScan(input)` inside the hook, returning `null` or a decision object `{ permissionDecision, permissionDecisionReason }`. Reads `.claude/memory/bash-scan-allowlist.txt` relative to `process.cwd()`. `DIALECT` and `EXCEPTIONS` exported from the corpus module.

- [X] [T-003-A] Add the dialect rows and the exception row. Depends on T-002-G. Append to `tests/fixtures/guard3-corpus.js`:

```js
// Rows that exist because the translation could have gone wrong in a specific way.
// The first three fail the moment anyone replaces an explicit class with \s: in
// JavaScript \s matches U+00A0 and U+2028, in the C locale [[:space:]] does not, so
// the guard would see a command separator where the authority sees an ordinary
// character. The last four pin the checks that consume a match extent, where POSIX
// leftmost-longest and JavaScript leftmost-first could have disagreed.
export const DIALECT = [
  { label: 'dialect: U+00A0 after cat is not a separator', command: 'cat *.ts', verdict: 'allow' },
  { label: 'dialect: U+2028 after cat is not a separator', command: 'cat *.ts', verdict: 'allow' },
  { label: 'dialect: U+00A0 after ls is not a separator', command: 'ls -R .', verdict: 'allow' },
  { label: 'dialect extent P4: command cat x', command: 'command cat *.ts', verdict: 'deny' },
  { label: 'dialect extent P5: env assignment then reader', command: 'env A=1 B=2 cat $(ls)', verdict: 'deny' },
  { label: 'dialect extent P6: git grep after a semicolon', command: "echo x; git grep '.*'", verdict: 'deny' },
  { label: 'dialect extent P7: path-invoked pager', command: '/usr/bin/less *.ts', verdict: 'deny' },
];

// The ONE sanctioned divergence between the two subjects, recorded in
// docs/superpowers/specs/2026-09-25-bug037-guard3-port-and-first-ship-design.md.
// The authority interpolates allowlist entries raw into an ERE, so entry file.ts
// matches fileXts as well. The port escapes entries and matches them literally,
// which is the fix, and therefore denies where the authority allows. This is an
// inequality by design, not a port defect. Adding a second member to this list
// without amending the spec is what the length assertion exists to stop.
export const EXCEPTIONS = [
  {
    label: 'allowlist entry file.ts does not match fileXts in the port',
    command: 'cat fileXts',
    allowlist: ['file.ts'],
    fixtureVerdict: 'allow',
    portVerdict: 'deny',
  },
];
```

- [X] [T-003-B] Run the dialect rows against the authority too. Depends on T-003-A. In `tests/hooks/guard3.test.js`, change the import to:

```js
import { CORPUS, DIALECT } from '../fixtures/guard3-corpus.js'
```

and add after the existing `it.each` block:

```js
  it.each(DIALECT.map(r => [r.label, r]))('%s', (_label, row) => {
    const status = runRow(row)
    if (row.verdict === 'deny') expect(status).not.toBe(0)
    else expect(status).toBe(0)
  })
```

- [X] [T-003-C] Write the port's failing suite. Depends on T-003-A. Create `tests/hooks/guard3-port.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CORPUS, DIALECT, EXCEPTIONS } from '../fixtures/guard3-corpus.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HOOK = join(REPO_ROOT, '.claude/hooks/pre-tool-use.mjs');

// Every row spawns with a throwaway cwd, so the allowlist a row asks for is the only
// one the guard can see and the developer's own .claude/memory/ is unreachable.
function runRow(row) {
  const dir = mkdtempSync(join(tmpdir(), 'cc-g3-port-'));
  try {
    if (row.allowlist && row.allowlist.length) {
      mkdirSync(join(dir, '.claude', 'memory'), { recursive: true });
      writeFileSync(join(dir, '.claude', 'memory', 'bash-scan-allowlist.txt'), row.allowlist.join('\n') + '\n', 'utf8');
    }
    const toolName = row.toolName ?? 'Bash';
    const tool_input = toolName === 'Read' ? { file_path: '/tmp/x' } : { command: row.command };
    const r = spawnSync(process.execPath, [HOOK], {
      stdio: 'pipe',
      cwd: dir,
      timeout: 15000,
      input: JSON.stringify({ tool_name: toolName, tool_input }),
      env: { ...process.env },
    });
    if (r.error) throw new Error(`hook spawn failed: ${r.error.message}`);
    const stdout = (r.stdout ?? Buffer.alloc(0)).toString();
    return {
      status: r.status ?? -1,
      decision: stdout.trim() === '' ? null : JSON.parse(stdout).hookSpecificOutput,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const assertVerdict = (row, verdict) => {
  const r = runRow(row);
  expect(r.status).toBe(0);
  if (verdict === 'deny') {
    expect(r.decision.permissionDecision).toBe('deny');
    expect(r.decision.permissionDecisionReason).toMatch(/BASH SCAN BLOCKED/);
  } else {
    expect(r.decision).toBeNull();
  }
};

describe('Guard 3 port', () => {
  it.each(CORPUS.map(r => [r.label, r]))('corpus: %s', (_label, row) => {
    assertVerdict(row, row.verdict);
  });

  it.each(DIALECT.map(r => [r.label, r]))('dialect: %s', (_label, row) => {
    assertVerdict(row, row.verdict);
  });

  // Guarding the guard: a second entry here would mean a second place where the port
  // silently disagrees with its own authority, which the spec forbids.
  it('carries exactly one sanctioned divergence from the authority', () => {
    expect(EXCEPTIONS).toHaveLength(1);
  });

  it.each(EXCEPTIONS.map(r => [r.label, r]))('exception: %s', (_label, row) => {
    assertVerdict(row, row.portVerdict);
  });
});
```

- [X] [T-003-D] Run the port suite and confirm the red state. Depends on T-003-C.

Run: `npx vitest run tests/hooks/guard3-port.test.js`
Expected: **74 failed | 43 passed**. Guard 3's slot still returns allow, so every row whose verdict is `deny` fails at `expected null to be defined` or at the `permissionDecision` assertion, and every `allow` row passes. The 74 is 69 deny rows in `CORPUS`, 4 deny rows in `DIALECT`, and the exception row. A different failure count means the table or the harness is wrong, not the port; stop and reconcile before writing the guard.

- [X] [T-003-E] Write the constants block and the preprocessing chain. Depends on T-003-D.

First widen the path import, because the allowlist reader needs `join` and the file currently imports only `posix`. In `project-template/.claude/hooks/pre-tool-use.mjs`, replace:

```js
import { posix } from 'node:path';
```

with:

```js
import { posix, join } from 'node:path';
```

Then insert the following immediately above the existing `function guard3BashScan() {`:

```js
// ── Guard 3 constants ─────────────────────────────────────────────────────────
// POSIX ERE fragments from tests/fixtures/guard3-reference.sh, translated class by
// class. [[:space:]] in the C locale is EXACTLY [ \t\n\r\f\v]; JavaScript \s also
// matches U+00A0, U+2028, U+2029 and U+FEFF, so using it here would widen every
// check below and make the port disagree with its own authority. No \s \S \w \W \d
// \D appears anywhere in this block, and a test asserts that.
const SP = '[ \\t\\n\\r\\f\\v]';
const NSP = '[^ \\t\\n\\r\\f\\v]';
const G3_POS = '(^|[|;{([!&]|`|&&|\\|\\||;;|\\$\\(|<\\(|>\\(|(then|else|elif|do)' + SP + '|!' + SP + ')' + SP + '*';
const G3_MOD = '((env|exec|time|nohup|coproc|command|builtin)(' + SP + '+' + NSP + '+)*' + SP + '+)?';
const G3_PATH = '([A-Za-z0-9_./@%-]*/)?';
const G3_READERS = '(cat|less|more|head|tail|sed|awk|grep|egrep|fgrep|mapfile|readarray)';
const G3_SHELLS = '(sh|bash|dash|zsh|ksh|fish)';
const G3_MAX_LEN = 8192;
const G3_ALLOWLIST_REL = ['.claude', 'memory', 'bash-scan-allowlist.txt'];

const reFind = new RegExp(G3_POS + G3_MOD + G3_PATH + 'find(' + SP + '|$)');
const reCat = new RegExp(G3_POS + G3_MOD + G3_PATH + 'cat(' + SP + '|$)');
const rePager = new RegExp(G3_POS + G3_MOD + G3_PATH + '(less|more|head|tail|sed|awk)(' + SP + '|$)');
const reReader = new RegExp(G3_POS + G3_MOD + G3_PATH + G3_READERS + '(' + SP + '|$)');

// bash's `read -ra` splits on IFS (space, tab, newline), which is NARROWER than
// [[:space:]]. The token walks in P3 and P6 use this, everything else uses SP.
const IFS_SPLIT = /[ \t\n]+/;

// Join line continuations. A line ending in an ODD number of backslashes continues;
// an even number does not. bash's here-string appends a trailing newline, so a
// non-continued line always contributes one, including the last: the preprocessed
// string normally ends in a separator and every ([[:space:]]|$) anchor depends on it.
function g3JoinContinuations(input) {
  let result = '';
  for (const raw of input.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    let bs = 0;
    while (bs < line.length && line[line.length - 1 - bs] === '\\') bs += 1;
    if (bs % 2 === 1) result += line.slice(0, -1) + ' ';
    else result += line + '\n';
  }
  return result;
}

// The five-state scanner, in two modes. "strip" removes unquoted comments and
// reports malformed input (a state other than UNQUOTED at end of input, meaning an
// unclosed quote). "glob" reports whether an unquoted glob character appears, and
// treats malformed input as a glob, which is the authority's fail-closed choice.
function g3Scan(mode, input) {
  let state = 'UNQUOTED';
  let result = '';
  let i = 0;
  const len = input.length;
  while (i < len) {
    const ch = input[i];
    const two = input.slice(i, i + 2);
    if (state === 'UNQUOTED') {
      if (two === "$'") { if (mode === 'strip') result += two; i += 2; state = 'ANSI_C_QUOTED'; }
      else if (two === '$"') { if (mode === 'strip') result += two; i += 2; state = 'LOCALE_QUOTED'; }
      else if (ch === '\\') { if (mode === 'strip') result += input.slice(i, i + 2); i += 2; }
      else if (ch === "'") { if (mode === 'strip') result += ch; i += 1; state = 'SINGLE_QUOTED'; }
      else if (ch === '"') { if (mode === 'strip') result += ch; i += 1; state = 'DOUBLE_QUOTED'; }
      else if (ch === '#' && mode === 'strip') { while (i < len && input[i] !== '\n') i += 1; }
      else {
        if (mode === 'glob' && (ch === '*' || ch === '?' || ch === '{' || ch === '[')) return { glob: true };
        if (mode === 'strip') result += ch;
        i += 1;
      }
    } else if (state === 'SINGLE_QUOTED') {
      // Backslash is literal here and ANY quote exits: there is no escape mechanism.
      if (mode === 'strip') result += ch;
      if (ch === "'") state = 'UNQUOTED';
      i += 1;
    } else if (state === 'DOUBLE_QUOTED' || state === 'LOCALE_QUOTED') {
      if (ch === '\\') { if (mode === 'strip') result += input.slice(i, i + 2); i += 2; }
      else if (ch === '"') { if (mode === 'strip') result += ch; i += 1; state = 'UNQUOTED'; }
      else { if (mode === 'strip') result += ch; i += 1; }
    } else {
      if (ch === '\\') { if (mode === 'strip') result += input.slice(i, i + 2); i += 2; }
      else if (ch === "'") { if (mode === 'strip') result += ch; i += 1; state = 'UNQUOTED'; }
      else { if (mode === 'strip') result += ch; i += 1; }
    }
  }
  if (state !== 'UNQUOTED') return mode === 'strip' ? { result, malformed: true } : { glob: true };
  return mode === 'strip' ? { result, malformed: false } : { glob: false };
}
```

- [X] [T-003-F] Write the thirteen checks. Depends on T-003-E. Insert immediately below the scanner:

```js
// Each check returns true when it FIRES (the authority's shell functions returned 1).
//
// A quirk worth naming, because it looks like a bug and is not: the authority walks
// with `after="${rest:mlen}"`, slicing by the match LENGTH from position 0 rather
// than from the match index. For `ls; cat *.ts` the match is `; cat ` and bash's
// `after` is `at *.ts`, not `*.ts`. P4 and P7 reproduce that exactly. "Fixing" it
// would make the port disagree with the corpus.

function g3P1FindDepth(s) {
  if (!reFind.test(s)) return false;
  const m = new RegExp('-(-)?maxdepth[= \\t\\n\\r\\f\\v]+(\\+?)([0-9]+)').exec(s);
  if (m) return m[3] !== '1';
  return true;
}

function g3P2FindExec(s) {
  if (!reFind.test(s)) return false;
  if (!new RegExp('-(exec|execdir|ok|okdir)' + SP).test(s)) return false;
  return new RegExp('-(exec|execdir|ok|okdir)' + SP + '+(' + G3_READERS + '|' + G3_SHELLS + ')(' + SP + '|$)').test(s);
}

function g3P3Xargs(s) {
  if (!new RegExp(G3_POS + G3_MOD + 'xargs(' + SP + '|$)').test(s)) return false;
  const at = s.indexOf('xargs');
  const after = at === -1 ? '' : s.slice(at + 'xargs'.length);
  const toks = after.split(IFS_SPLIT).filter(Boolean);
  const optRe = /^(-I|--replace|-n|--max-args|-P|--max-procs|-s|--max-chars|-a|--arg-file|-d|--delimiter|-E|--eof)$/;
  const utilRe = new RegExp('^(' + G3_READERS + '|' + G3_SHELLS + ')$');
  let i = 0;
  while (i < toks.length) {
    const t = toks[i];
    if (optRe.test(t)) {
      if (i + 1 < toks.length && !/^-[A-Za-z]/.test(toks[i + 1])) i += 2;
      else i += 1;
    } else if (t.startsWith('-')) {
      i += 1;
    } else {
      return utilRe.test(t);
    }
  }
  return false;
}

function g3GlobWalk(s, re) {
  let rest = s;
  for (;;) {
    const m = re.exec(rest);
    if (!m) return false;
    const after = rest.slice(m[0].length); // authority quirk: slice by length, not index
    if (g3Scan('glob', after).glob) return true;
    rest = after;
    if (rest === '') return false;
  }
}

function g3P4CatGlob(s) { return g3GlobWalk(s, reCat); }
function g3P7PagerGlob(s) { return g3GlobWalk(s, rePager); }

function g3P5CmdSubst(s) {
  const m = reReader.exec(s);
  if (!m) return false;
  const at = s.indexOf(m[0]);
  const after = at === -1 ? '' : s.slice(at + m[0].length);
  if (/^"?\$\(([^)]+)\)"?(\/[A-Za-z0-9_./@%-]+)"?$/.test(after)) return false;
  if (/\$\(/.test(after)) return true;
  if (after.includes('`')) return true;
  return false;
}

const G3_MATCHALL = '(\\.\\*|\\.|\\.\\+|\\^|"")';
const stripQuotes = (v) => v.replace(/'/g, '').replace(/"/g, '');

function g3GrepHasMatchAll(s) {
  const whole = new RegExp('^' + G3_MATCHALL + '$');
  const eRe = new RegExp(SP + '-e' + SP + '+(' + NSP + '+)');
  let rest = s;
  for (;;) {
    const m = eRe.exec(rest);
    if (!m) break;
    if (whole.test(stripQuotes(m[1]))) return true;
    const at = rest.indexOf(m[0]);
    rest = at === -1 ? '' : rest.slice(at + m[0].length);
  }
  const rm = new RegExp('--regexp[= \\t\\n\\r\\f\\v]+(' + NSP + '+)').exec(s);
  if (rm && whole.test(stripQuotes(rm[1]))) return true;
  let seenCmd = false;
  let pat = '';
  for (const tok of s.split(IFS_SPLIT).filter(Boolean)) {
    if (/^(git|grep|egrep|fgrep|-r|-R|--recursive|-[a-zA-Z]+)$/.test(tok)) { seenCmd = true; continue; }
    if (!seenCmd) continue;
    if (tok.includes('(') || tok.includes(')')) continue;
    if (/^-/.test(tok)) continue;
    if (/^(\/|\.\/|\.\.\/|~\/)/.test(tok)) continue;
    if (tok.includes('/') && !/[*+?[\](){}^$|\\]/.test(tok)) continue;
    pat = stripQuotes(tok);
    break;
  }
  if (pat === '') return true;
  return whole.test(pat);
}

function g3P6GrepMatchAll(s) {
  if (new RegExp(SP + '-F(' + SP + '|$)').test(s)) return false;
  if (new RegExp(SP + '--fixed-strings(' + SP + '|$)').test(s)) return false;
  if (new RegExp(G3_POS + G3_MOD + '(grep|egrep|fgrep)(' + SP + '|$)').test(s)) {
    if (!new RegExp(SP + '(-r|-R|--recursive)(' + SP + '|$)').test(s)) return false;
    if (g3GrepHasMatchAll(s)) return true;
  }
  if (new RegExp(G3_POS + 'git' + SP + '+grep(' + SP + '|$)').test(s)) {
    if (g3GrepHasMatchAll(s)) return true;
  }
  return false;
}

function g3P8LsRecursive(s) {
  if (!new RegExp(G3_POS + G3_MOD + G3_PATH + 'ls(' + SP + '|$)').test(s)) return false;
  if (new RegExp(SP + '--recursive(' + SP + '|$)').test(s)) return true;
  if (new RegExp(SP + '-R(' + SP + '|$)').test(s)) return true;
  if (new RegExp(SP + '-[a-zA-Z]*R[a-zA-Z]*(' + SP + '|$)').test(s)) return true;
  return false;
}

function g3P9ShellLoop(s) {
  return new RegExp(G3_POS + '(for|while|until)' + SP).test(s);
}

function g3P10SlurpBuiltins(s) {
  return new RegExp(G3_POS + '(mapfile|readarray)(' + SP + '|$)').test(s);
}

function g3P11DynamicExec(s) {
  if (new RegExp(G3_POS + '(eval|source)(' + SP + '|$)').test(s)) return true;
  if (new RegExp(G3_POS + '\\.' + SP).test(s)) return true;
  if (new RegExp(G3_POS + '\\.$').test(s)) return true;
  return false;
}

function g3P12Alias(s) {
  if (!new RegExp(G3_POS + 'alias' + SP).test(s)) return false;
  const m = new RegExp('alias' + SP + '+[A-Za-z_][A-Za-z_0-9]*=(.+)').exec(s);
  if (!m) return false;
  let val = m[1];
  val = val.replace(/^'/, '').replace(/'$/, '').replace(/^"/, '').replace(/"$/, '');
  if (new RegExp('^(' + G3_READERS + '|eval|source|\\.)' + SP).test(val)) return true;
  if (new RegExp('^(' + G3_READERS + '|eval|source|\\.)$').test(val)) return true;
  return false;
}

function g3Obfuscation(s) {
  if (/^\$"/.test(s)) return true;
  if (new RegExp(G3_POS + '(\\\\.)+(' + SP + '|$)').test(s)) return true;
  if (new RegExp(G3_POS + "[a-zA-Z]'[a-zA-Z]+'[a-zA-Z]").test(s)) return true;
  return false;
}

// All thirteen in one place, in the authority's order. A reviewer reads this table,
// not the call sites.
const G3_CHECKS = [
  { id: 'P1', check: g3P1FindDepth },
  { id: 'P2', check: g3P2FindExec },
  { id: 'P3', check: g3P3Xargs },
  { id: 'P4', check: g3P4CatGlob },
  { id: 'P5', check: g3P5CmdSubst },
  { id: 'P6', check: g3P6GrepMatchAll },
  { id: 'P7', check: g3P7PagerGlob },
  { id: 'P8', check: g3P8LsRecursive },
  { id: 'P9', check: g3P9ShellLoop },
  { id: 'P10', check: g3P10SlurpBuiltins },
  { id: 'P11', check: g3P11DynamicExec },
  { id: 'P12', check: g3P12Alias },
  { id: 'OBF', check: g3Obfuscation },
];
```

- [X] [T-003-G] Write the allowlist reader and the guard body. Depends on T-003-F. Replace the existing slot:

```js
// Guard 3: declared and empty. The twelve-pattern bash scanner has never shipped; its
// behavioral authority is tests/fixtures/guard3-reference.sh and [BUG-037] fills this in.
// The slot exists now so that port plugs in a pattern table and nothing else, and so the
// Bash dispatch route is proven live by this release's harness.
function guard3BashScan() {
  return null;
}
```

with:

```js
// Operator policy, read fresh on every invocation so a change applies without a
// session restart. Absent means an empty list, which is policy, not a fault.
// Present-but-unreadable means an empty list PLUS a debug line, because that is a
// fault worth seeing, and neither condition may throw: a permissions problem on a
// policy file must never escalate into denying every tool call in the session.
function g3ReadAllowlist() {
  let raw;
  try {
    raw = readFileSync(join(process.cwd(), ...G3_ALLOWLIST_REL), 'utf8');
  } catch (e) {
    if (e.code !== 'ENOENT') debug(`guard 3 allowlist unreadable: ${e.message}`);
    return [];
  }
  return raw.split('\n')
    .map(l => l.trim())
    .filter(l => l !== '' && !l.startsWith('#'));
}

// Entries match LITERALLY. The authority interpolates them raw into an ERE, so its
// entry file.ts also matches fileXts; that leak is fixed here and the divergence is
// asserted by the corpus EXCEPTIONS row. Escaping also keeps an entry from adding a
// capture group, which would shift the suffix index below.
const g3EscapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const G3_BD = '(^|[ \\t\\n\\r\\f\\v|;()])';
const G3_AD = '([ \\t\\n\\r\\f\\v|;()]|$)';

function g3AllowlistCovers(s, entries) {
  if (entries.length === 0) return false;
  for (const entry of entries) {
    if (entry.endsWith('/')) {
      const m = new RegExp(G3_BD + g3EscapeRe(entry) + '([A-Za-z0-9_./@%*?-]*)' + G3_AD).exec(s);
      if (m) {
        // G3_BD contributes group 1, so the suffix is group 2, matching the
        // authority's BASH_REMATCH[2]. A suffix that walks up the tree is not
        // covered: an allowlist entry must not become a path-traversal gift.
        if (/(^|\/)\.\.(\/|$)/.test(m[2])) continue;
        return true;
      }
    } else if (new RegExp(G3_BD + g3EscapeRe(entry) + G3_AD).test(s)) {
      return true;
    }
  }
  return false;
}

function g3Blocked(detail) {
  return deny(
    `BASH SCAN BLOCKED. ${detail} ` +
    'Authorized alternatives: 1. Grep for targeted content search with file and pattern scope. ' +
    '2. Glob for path listing without file content. 3. Read with an explicit offset and limit. ' +
    'To permit a path permanently, add a commented entry to .claude/memory/bash-scan-allowlist.txt.'
  );
}

// Guard 3: the bash command scanner, ported from tests/fixtures/guard3-reference.sh.
// That file remains the behavioral authority and both are driven by one shared corpus.
function guard3BashScan(input) {
  const command = typeof input.command === 'string' ? input.command : '';
  if (command === '') return null;
  if (command.length > G3_MAX_LEN) {
    return g3Blocked(`The command string exceeds the maximum scan length (${G3_MAX_LEN} chars).`);
  }
  const scan = g3Scan('strip', g3JoinContinuations(command));
  if (scan.malformed) {
    return g3Blocked('Malformed shell syntax (unclosed quote), blocked as a precaution.');
  }
  // Real newlines become semicolons so a multi-line script reads as a command
  // sequence to every position-anchored pattern above.
  const pre = scan.result.split('\n').join(';');
  const ids = [];
  for (const { id, check } of G3_CHECKS) if (check(pre)) ids.push(id);
  if (ids.length === 0) return null;
  if (g3AllowlistCovers(pre, g3ReadAllowlist())) return null;
  return g3Blocked(`The command triggered a mass content-dump pattern. Pattern ids: ${ids.join(' ')}.`);
}
```

- [X] [T-003-H] Mirror the hook. Depends on T-003-G.

```bash
cp project-template/.claude/hooks/pre-tool-use.mjs .claude/hooks/pre-tool-use.mjs
cmp project-template/.claude/hooks/pre-tool-use.mjs .claude/hooks/pre-tool-use.mjs && echo "IDENTICAL"
```
Expected: `IDENTICAL`.

- [X] [T-003-I] Run both Guard 3 suites. Depends on T-003-H.

Run: `npx vitest run tests/hooks/guard3.test.js tests/hooks/guard3-port.test.js`
Expected: **233 passed** (116 in the authority suite, 117 in the port suite). A row that fails on the port but passes on the authority is a translation defect: fix the port, never the row and never the authority.

- [X] [T-003-I2] Measure the per-invocation allowlist read cost and record it. Depends on T-003-I. The spec ships no caching in v1 and requires the number instead, so the topic closes on evidence rather than on a guess.

```bash
node --input-type=module -e "
import { readFileSync } from 'node:fs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir = mkdtempSync(join(tmpdir(), 'cc-allow-'));
mkdirSync(join(dir, '.claude', 'memory'), { recursive: true });
const p = join(dir, '.claude', 'memory', 'bash-scan-allowlist.txt');
writeFileSync(p, Array.from({ length: 50 }, (_, i) => '# reason ' + i + '\ndocs/' + i + '/').join('\n'));
const read = () => readFileSync(p, 'utf8').split('\n').map(l => l.trim()).filter(l => l !== '' && !l.startsWith('#')).length;
read();
const t0 = process.hrtime.bigint();
for (let i = 0; i < 1000; i++) read();
const t1 = process.hrtime.bigint();
console.log('allowlist read: ' + (Number(t1 - t0) / 1e6 / 1000).toFixed(4) + ' ms per call, 100 lines');
rmSync(dir, { recursive: true, force: true });
"
```
Expected: a sub-millisecond figure. Carry it verbatim into the implementation report, as the 0.13 ms backtracking measurement was carried into the spec. A figure that is not sub-millisecond is a finding for its own backlog id, not a reason to add caching inside this release.

- [X] [T-003-J] Pin the character-class rule and the unshipped allowlist. Depends on T-003-H. Append to `tests/installer/templates.test.js`:

```js
describe('guard 3 pattern block', () => {
  // The character-class trap, made structurally unrepeatable. [[:space:]] is
  // [ \t\n\r\f\v] in the C locale; JavaScript \s also matches U+00A0 and U+2028, so
  // one shorthand would silently widen every check and the port would disagree with
  // its own authority on input no reviewer would think to try.
  it('uses explicit character classes, never regex shorthands', () => {
    const text = readText('project-template/.claude/hooks/pre-tool-use.mjs');
    const start = text.indexOf('// ── Guard 3 constants');
    expect(start).toBeGreaterThan(-1);
    const block = text.slice(start);
    expect(block).not.toMatch(/\\[sSwWdD]/);
  });

  // Not shipping the filename is the whole mechanism that keeps the installer from
  // overwriting operator policy, since deployProject copies the template wholesale.
  it('ships no allowlist file, so the installer can never overwrite one', () => {
    expect(existsSync(join(root, 'project-template/.claude/memory/bash-scan-allowlist.txt'))).toBe(false);
  });
});
```

- [X] [T-003-K] Run the full suite. Depends on T-003-J.

Run: `npm test`
Expected: **744 passed | 12 skipped**.

- [X] [T-003-L] Stage the six paths. Depends on T-003-K. The repository mirror lives under the gitignored `.claude/`, so it needs a force-add.

```bash
git add tests/fixtures/guard3-corpus.js tests/hooks/guard3-port.test.js tests/hooks/guard3.test.js \
  project-template/.claude/hooks/pre-tool-use.mjs tests/installer/templates.test.js
git add -f .claude/hooks/pre-tool-use.mjs
```

- [X] [T-003-M] Verify exactly six staged paths. Depends on T-003-L.

```bash
git diff --cached --name-only | sort
```
Expected: six lines, `.claude/hooks/pre-tool-use.mjs`, `project-template/.claude/hooks/pre-tool-use.mjs`, `tests/fixtures/guard3-corpus.js`, `tests/hooks/guard3-port.test.js`, `tests/hooks/guard3.test.js`, `tests/installer/templates.test.js`.

- [X] [T-003-N] Commit. Depends on T-003-M.

```bash
git commit -m "$(cat <<'EOF'
feat: port Guard 3's bash command scanner into the shipped hook [BUG-037]

Thirteen checks, five regex fragments, the five-state scanner and the continuation
joiner, translated from the frozen authority class by class: [[:space:]] becomes
[ \t\n\r\f\v] and never \s, which in JavaScript would also match U+00A0 and widen
every check. The authority's slice-by-match-length quirk is reproduced verbatim
rather than corrected. The allowlist moves to .claude/memory/bash-scan-allowlist.txt,
read per invocation, absent meaning empty. One shared corpus drives both subjects and
they agree on all 115 rows; the single sanctioned divergence, literal versus raw
entry matching, is asserted as an inequality by design.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: The warn escape

**Files:**
- Modify: `project-template/.claude/hooks/pre-tool-use.mjs`
- Modify: `.claude/hooks/pre-tool-use.mjs` (mirror)
- Modify: `tests/hooks/pre-tool-use-contract.test.js`

**Interfaces:**
- Consumes: `g3Blocked` from Task 3.
- Produces: `CC_GUARD3_WARN` (non-empty) converts Guard 3's `deny` into `ask` with the identical reason. No other guard and no other variable changes behavior.

- [X] [T-004-A] Write the failing tests. Depends on T-003-N. Append to `tests/hooks/pre-tool-use-contract.test.js`:

```js
describe('CC_GUARD3_WARN', () => {
  it('converts Guard 3 denial into ask, carrying the same reason', () => {
    const denied = fire({ tool_name: 'Bash', tool_input: { command: 'cat *.ts' } });
    expect(denied.decision.permissionDecision).toBe('deny');
    const warned = fire({ tool_name: 'Bash', tool_input: { command: 'cat *.ts' } }, { CC_GUARD3_WARN: '1' });
    expect(warned.status).toBe(0);
    expect(warned.decision.permissionDecision).toBe('ask');
    expect(warned.decision.permissionDecisionReason).toBe(denied.decision.permissionDecisionReason);
  });

  // The scope pin. The project now carries two override variables, so their
  // interaction is a contract rather than folklore. These four assertions are what
  // stop a refactor from widening a per-guard triage aid into a product-wide off
  // switch. They pass before the feature exists, because they assert absences; their
  // value is as a regression guard from here on.
  it('changes nothing except Guard 3', () => {
    const env = { CC_GUARD3_WARN: '1' };
    const blockedRead = fire(readPayload('graphify-out/graph.json'), env);
    expect(blockedRead.decision.permissionDecision).toBe('deny');

    const p = writeLines('existing.txt', 4);
    const write = fire({ tool_name: 'Write', tool_input: { file_path: p, content: 'x' } }, env);
    expect(write.decision.permissionDecision).toBe('ask');

    const malformed = fire('{not json', env);
    expect(malformed.decision.permissionDecision).toBe('deny');

    const overridden = fire('{not json', { ...env, CC_HOOK_ALLOW: '1' });
    expect(overridden.decision).toBeNull();
  });
});
```

- [X] [T-004-B] Run the contract suite and confirm the red state. Depends on T-004-A.

Run: `npx vitest run tests/hooks/pre-tool-use-contract.test.js`
Expected: **1 failed | 14 passed**. Only the conversion test fails, at `expected 'deny' to be 'ask'`. The scope test passes already, for the reason its own comment gives: it asserts absences, and the absence is trivially true while the feature does not exist. Two failures here would mean the scope test is coupled to Guard 3's warn path, which it must not be.

- [X] [T-004-C] Implement the escape. Depends on T-004-B. In `project-template/.claude/hooks/pre-tool-use.mjs`, replace:

```js
function g3Blocked(detail) {
  return deny(
```

with:

```js
// CC_GUARD3_WARN converts THIS guard's denial into an ask carrying the identical
// reason, so a developer who hits a false positive mid-task sees the pattern ids and
// keeps working instead of filing an uninstall. It is documented as triage, not as
// configuration: the allowlist is the sanctioned permanent exception. It has no
// relationship to CC_HOOK_ALLOW, whose scope stays the two pre-verdict conditions.
function g3Blocked(detail) {
  const decide = process.env.CC_GUARD3_WARN ? ask : deny;
  return decide(
```

- [X] [T-004-D] Mirror the hook. Depends on T-004-C.

```bash
cp project-template/.claude/hooks/pre-tool-use.mjs .claude/hooks/pre-tool-use.mjs
cmp project-template/.claude/hooks/pre-tool-use.mjs .claude/hooks/pre-tool-use.mjs && echo "IDENTICAL"
```
Expected: `IDENTICAL`.

- [X] [T-004-E] Run the contract suite green. Depends on T-004-D.

Run: `npx vitest run tests/hooks/pre-tool-use-contract.test.js`
Expected: **15 passed**.

- [X] [T-004-F] Run the full suite. Depends on T-004-E.

Run: `npm test`
Expected: **746 passed | 12 skipped**.

- [X] [T-004-G] Stage the three paths. Depends on T-004-F.

```bash
git add project-template/.claude/hooks/pre-tool-use.mjs tests/hooks/pre-tool-use-contract.test.js
git add -f .claude/hooks/pre-tool-use.mjs
```

- [X] [T-004-H] Verify exactly three staged paths. Depends on T-004-G.

```bash
git diff --cached --name-only | sort
```
Expected: three lines, `.claude/hooks/pre-tool-use.mjs`, `project-template/.claude/hooks/pre-tool-use.mjs`, `tests/hooks/pre-tool-use-contract.test.js`.

- [X] [T-004-I] Commit. Depends on T-004-H.

```bash
git commit -m "$(cat <<'EOF'
feat: add CC_GUARD3_WARN as a scoped triage escape [BUG-037]

Converts Guard 3's denial into an ask carrying the identical reason, so a false
positive on a first-ever delivery becomes a bug report rather than a hard stop. The
scope is pinned by four assertions in one test: a graphify-out Read is still denied
with it set, Guard 2 still asks, malformed stdin still fails closed, and
CC_HOOK_ALLOW is unaffected.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Documentation states what ships

**Files:**
- Modify: `README.md` (the Guard 3 paragraph in the pre-tool-use section)
- Modify: `CLAUDE.md`, `project-template/CLAUDE.md`

**Interfaces:**
- Consumes: the shipped behavior from Tasks 3 and 4.
- Produces: no code interface.

- [X] [T-005-A] Replace the Guard 3 paragraph. Modify `README.md`, replacing:

```markdown
**Bash scan guard (Guard 3)** - not shipped yet. `Bash` already routes to the guard's slot and the slot is empty. The twelve-pattern scanner is verified in this repository against `tests/fixtures/guard3-reference.sh` and ships in `[BUG-037]`.
```

with:

```markdown
**Bash scan guard (Guard 3)** - every `Bash` command is matched against twelve mass content-dump patterns before it runs: deep `find` without `-maxdepth 1`, `find -exec` with readers or shells, `xargs` with readers, `cat` or a pager followed by an unquoted glob, command substitution as a reader's argument, `grep -r` with a match-all pattern, `ls -R`, shell loops, `mapfile` and `readarray`, `eval`, `source` and the dot operator, alias remapping to a reader, and obfuscation sequences. Commands over 8192 characters and unclosed quotes are denied fail-closed.

Permanent exceptions live in `.claude/memory/bash-scan-allowlist.txt`, one entry per line, blank lines and `#` comments ignored and whitespace trimmed. An entry ending in `/` covers paths under that prefix, rejecting any suffix that walks up the tree with `..`; any other entry matches a whole command token. **Entries match literally: regex metacharacters carry no special meaning, so `file.ts` matches `file.ts` and nothing else.** The installer never ships or overwrites this file. Every line in it disarms patterns for matching commands, so give each entry a comment saying why it exists; an uncommented entry is a review smell.

Hit a block you believe is wrong? Re-run the command with `CC_GUARD3_WARN=1` and the guard asks instead of denying, carrying the same pattern ids. That is a triage aid for reporting a false positive while you keep working, not a configuration mode: the allowlist is the sanctioned permanent exception. The variable affects Guard 3 alone.
```

- [X] [T-005-B] State Guard 3 as active in the project instructions. Modify `CLAUDE.md`, replacing:

```
- NEVER read raw files under `graphify-out/` or `node_modules/` — Guard 4 blocks such
```

with:

```
- Guard 3 scans every `Bash` command for mass content-dump patterns and denies a match;
  prefer Grep, Glob and a bounded Read. See README.md for the pattern list.
- NEVER read raw files under `graphify-out/` or `node_modules/` — Guard 4 blocks such
```

- [X] [T-005-C] Apply the identical edit to `project-template/CLAUDE.md`, replacing the same `NEVER read raw files under` line with the same two-line replacement as T-005-B. Depends on T-005-B.

- [X] [T-005-D] Run the full suite. Depends on T-005-C.

Run: `npm test`
Expected: **746 passed | 12 skipped**. The `CLAUDE.md` templates suite is the one at risk here; a failure means the managed-block invariants were disturbed.

- [X] [T-005-E] Stage the three files. Depends on T-005-D.

```bash
git add README.md CLAUDE.md project-template/CLAUDE.md
```

- [X] [T-005-F] Verify exactly three staged paths. Depends on T-005-E.

```bash
git diff --cached --name-only | sort
```
Expected: three lines, `CLAUDE.md`, `README.md`, `project-template/CLAUDE.md`.

- [X] [T-005-G] Commit. Depends on T-005-F.

```bash
git commit -m "$(cat <<'EOF'
docs: describe Guard 3 as shipped [BUG-037]

The README moves from "ships in [BUG-037]" to the pattern list, the allowlist file
format with its literal-matching clause and its comment requirement, and
CC_GUARD3_WARN framed as triage rather than configuration. Both CLAUDE.md files
state the guard as active.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Release 1.29.0

**Files:**
- Modify: `VERSION`, `package.json`, `package-lock.json`, `CHANGELOG.md`, `AGENT-READABLE BACKLOG.md`

**Interfaces:**
- Consumes: the working tree from Tasks 1 to 5.
- Produces: version `1.29.0` recorded identically in all three places.

- [X] [T-006-A] Bump the manifest and the lockfile together.

```bash
npm version 1.29.0 --no-git-tag-version
```

- [X] [T-006-B] Bump the `VERSION` file. Depends on T-006-A.

```bash
printf '1.29.0\n' > VERSION
```

- [X] [T-006-C] Verify all three agree. Depends on T-006-B.

```bash
cat VERSION
node -p "require('./package.json').version"
node -p "require('./package-lock.json').version + ' / ' + require('./package-lock.json').packages[''].version"
```
Expected: `1.29.0` from each of the four readings.

- [X] [T-006-D] Add the changelog entry. Depends on T-006-C. Modify `CHANGELOG.md`, inserting immediately after the `# Changelog` line and its blank line:

```markdown
## [1.29.0] - 2026-09-25

### Added

- **[BUG-037]** Guard 3, the bash command scanner, ships for the first time. It was advertised in `README.md` from the beginning and existed only in this repository's own copy of the hook; the file the installer deployed never contained a line of it, so no user has ever had it. Every `Bash` command is now matched against twelve mass content-dump patterns before it runs, and a match is denied through `hookSpecificOutput.permissionDecision` with the matched pattern ids in the reason. Commands over 8192 characters and unclosed quotes are denied fail-closed. **This release begins blocking commands that previously ran.** Permanent exceptions live in `.claude/memory/bash-scan-allowlist.txt`, a file the installer never ships or overwrites, one entry per line with `#` comments; entries match literally, so a metacharacter in an entry has no special meaning, which is a deliberate divergence from the reference implementation that interpolated them as regular expressions. For a block you believe is wrong, `CC_GUARD3_WARN=1` makes Guard 3 ask instead of deny, carrying the same reason, so you can keep working and report the command; it affects Guard 3 alone and has no relationship to `CC_HOOK_ALLOW`. The twelve patterns were translated from the frozen reference character class by character class, and one shared corpus of 115 cases drives both the reference and the port, asserting they agree on every one.

Existing installations: re-run the installer to apply. `[BUG-035]` still applies to that re-run: the installer force-copies `settings.json` over the host's, so back it up if it carries entries you added yourself.
```

- [X] [T-006-E] Flip the backlog entry. Depends on T-006-D. Modify `AGENT-READABLE BACKLOG.md`, replacing:

```
### [ ] `[BUG-037]` Guard 3 Has Never Shipped: Port the Bash Command Scanner and Deliver It
```

with:

```
### [X] `[BUG-037]` Guard 3 Has Never Shipped: Port the Bash Command Scanner and Deliver It
```

`[BUG-034]` keeps `[~]`; `[BUG-035]`, `[BUG-038]` and `[BUG-039]` stay `[ ]`.

- [X] [T-006-F] Verify the four neighbouring checkbox states. Depends on T-006-E. A `--numstat` count is the wrong instrument here, as the BUG-036 cycle established; assert the semantics.

```bash
grep -nE '^### \[.\] `\[BUG-03[4-9]\]`' "AGENT-READABLE BACKLOG.md" | cut -c1-60
```
Expected: `[~]` for BUG-034, `[ ]` for BUG-035, `[X]` for BUG-036, `[X]` for BUG-037, `[ ]` for BUG-038, `[ ]` for BUG-039.

- [X] [T-006-G] Run the full suite. Depends on T-006-F.

Run: `npm test`
Expected: **746 passed | 12 skipped**.

- [X] [T-006-H] Stage the release set. Depends on T-006-G.

```bash
git add VERSION package.json package-lock.json CHANGELOG.md "AGENT-READABLE BACKLOG.md"
```

- [X] [T-006-I] Verify exactly five staged paths. Depends on T-006-H.

```bash
git diff --cached --name-only | sort
```
Expected: five lines, `AGENT-READABLE BACKLOG.md`, `CHANGELOG.md`, `VERSION`, `package-lock.json`, `package.json`.

- [X] [T-006-J] Commit. Depends on T-006-I.

```bash
git commit -m "$(cat <<'EOF'
chore: release 1.29.0 [BUG-037]

Minor: a guard that has never fired begins firing. The changelog states plainly
that this release begins blocking commands that previously ran.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Ship the branch

**Files:**
- Modify: `docs/superpowers/plans/2026-09-25-bug037-guard3-port-and-first-ship.md` (terminal checkbox state)

**Interfaces:**
- Consumes: the six commits from Tasks 0 to 6.
- Produces: a pushed branch and an open pull request.

- [X] [T-007-A] Push the branch.

```bash
git push -u origin HEAD
```

- [X] [T-007-B] Open the pull request. Depends on T-007-A.

```bash
gh pr create --title "feat: ship Guard 3, the bash command scanner, for the first time [BUG-037]" --body "$(cat <<'EOF'
## Summary

Guard 3 was advertised in the README from the beginning and existed only in this repository's own copy of the hook. The file the installer deployed never contained a line of it. 1.28.0 repaired the contract and declared the dispatch slot; this fills it.

Twelve patterns, translated from `tests/fixtures/guard3-reference.sh` character class by character class, plus the five-state scanner, the continuation joiner and the allowlist.

## What could have gone wrong, and what was done about it

- **POSIX leftmost-longest versus JavaScript leftmost-first.** Four checks consume the match extent to decide where scanning resumes, so a shorter match could have flipped a verdict invisibly. Measured before the design: six probes built to expose it agreed byte for byte, and the differential corpus now proves it on all 115 rows.
- **Backtracking.** `_G3_MOD` is the classic catastrophic shape and JavaScript backtracks where glibc does not. Measured at the 8192-character cap: 0.13 ms.
- **The character classes, which is where the real risk was.** `[[:space:]]` is `[ \t\n\r\f\v]`; JavaScript `\s` also matches U+00A0 and U+2028. Every class is explicit, a test forbids the shorthands in the pattern block, and three corpus rows fail the moment anyone reverts one.
- **An authority quirk that looks like a bug.** The reference slices by match length from position 0, not from the match index. The port reproduces that exactly; "fixing" it would make the port disagree with its own corpus.

## Named divergence

One, and a test asserts there is only one: the reference interpolates allowlist entries raw into an ERE, so its entry `file.ts` also allows `cat fileXts`. The port escapes and matches literally. Asserted as an inequality by design in the corpus `EXCEPTIONS` table.

## Test plan

- `npm test`: 746 passed / 12 skipped (baseline 617 / 12).
- 108 corpus rows plus 7 dialect rows run against both the frozen bash authority and the port, asserting identical verdicts.
- The fixture's one sanctioned edit (reading the allowlist from a file) landed in its own commit before any ported pattern, with all 108 green against it.
- `CC_GUARD3_WARN`'s scope is pinned by four assertions in one test.

## Upgrade note

This release begins blocking commands that previously ran. Existing installations must re-run the installer, and `[BUG-035]` still applies to that re-run.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [X] [T-007-C] Report the PR URL and hand off. Depends on T-007-B. The terminal checkbox state of this plan lands as its own closing `docs:` commit once every box above reads `[X]`, never as an amend of the release commit.

---

## Test List

- [X] [T-T01] The 108-row shared corpus, run against the frozen bash authority (Task 2) and against the port (Task 3), asserting identical verdicts.
- [X] [T-T02] Seven dialect rows: three that fail if any explicit character class is replaced by a shorthand, four that pin the checks consuming a match extent.
- [X] [T-T03] One exception row asserting the single sanctioned divergence, plus an assertion that the exception list has exactly one member.
- [X] [T-T04] A static assertion that the guard's pattern block contains no `\s \S \w \W \d \D`.
- [X] [T-T05] A static assertion that no allowlist file ships under `project-template/`.
- [X] [T-T06] `CC_GUARD3_WARN` converts deny to ask with an identical reason, and a four-boundary test that it changes nothing else.
- [X] [T-T07] No E2E test: this project ships no UI.

## Commit Order

1. **T-000**: the plan (`docs:`). 617 / 12.
2. **T-001**: the authority reads the allowlist from a file, header amended, both bash harnesses re-pointed (`test:`). 617 / 12.
3. **T-002**: the corpus becomes one shared table driven against the authority (`test:`). 618 / 12.
4. **T-003**: the port, the dialect rows, the exception row, the two static assertions (`feat:`). 744 / 12.
5. **T-004**: the warn escape and its scope pin (`feat:`). 746 / 12.
6. **T-005**: documentation (`docs:`). 746 / 12.
7. **T-006**: release 1.29.0 (`chore:`). 746 / 12.
8. **T-007**: push, PR, then the plan's terminal state as a closing `docs:` commit.

Tasks 1 and 2 are separate from Task 3 on purpose and in that order: the spec requires the authority's edit to land before any ported pattern, and the corpus conversion to be proved faithful against the authority alone, so that a failure in either can never be confused with a port defect.

## Identified Risks

| Risk | Detection | Response |
|---|---|---|
| The `rest.slice(m[0].length)` quirk gets "corrected" to `m.index + m[0].length` by a well-meaning reviewer or a later refactor. | P4 and P7 corpus rows with a leading command, such as `echo cat; cat *.ts`. | The code carries a comment naming the quirk and the reason. If a row fails, re-read the authority before changing the port. |
| A later hand keeps the corpus green by relaxing a row rather than fixing the port. | The authority subject fails the same row. | Both subjects run every row. A row that passes on one and fails on the other is a port defect by definition, and the verdict column is the contract. |
| The differential rule and the escaping requirement look contradictory the first time a case carries a metacharacter. | A new allowlist row with a dot in the entry. | The `EXCEPTIONS` table and its one-member assertion exist for exactly this. Adding a second member requires amending the spec, which is the point. |
| Test runs read or write the developer's real `.claude/memory/bash-scan-allowlist.txt`. | An allowlist row passing on a machine where the file exists and failing elsewhere. | Every row in both suites spawns with a fresh temp cwd. Never spawn a row with `cwd: REPO_ROOT`. |
| This repository guards itself from T-003 onward, so `Bash` commands in later tasks can be denied by the guard just written. | A denied `git` or `npm` command mid-task. | Expected and correct. The patterns target readers and globs, not `git`, `npm` or `node`. If a plan step is denied, that is a genuine false positive worth recording, not a reason to widen anything. |
| The allowlist read adds per-call latency on every `Bash` invocation. | Measured at T-003-I and reported. | No caching in v1 by decision. Record the number; if it is not microseconds, that is a finding for its own id. |
| `npm version` also rewrites the lockfile, so an unrelated dirty lockfile rides along. | T-006-I's five-path check. | If a sixth path appears, unstage it and investigate before committing. |
