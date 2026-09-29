# [BUG-047] Heredoc Body Scanning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop Guard 3 reading heredoc bodies as command text, so writing a file with arbitrary content is not denied by patterns written to catch mass reads.

**Architecture:** Both scanners gain a sixth state, `HEREDOC`, entered on a heredoc introducer and left on the terminator line. Body characters are emitted blanked and length-preserved and do not feed quote-parity tracking. Because the mask is built from the stripped output, one state in one pass reaches all thirteen checks and the allowlist.

**Tech Stack:** bash 3.2 (the frozen authority), Node 20+ ESM (the port and its mirror), vitest 3.

**Spec:** `docs/superpowers/specs/2026-09-29-bug047-heredoc-body-scanning-design.md` (24 ACs)

## Global Constraints

- **Version: MINOR `1.33.0`**, ruled at spec approval, across five locations in one commit: `VERSION`, `package.json` `version`, `package-lock.json` `version`, `package-lock.json` `packages[""].version`, `CHANGELOG.md` first heading. `project-template/` changes, so a fresh install differs and PATCH's line is crossed.
- **The authority edit is the SIXTH SANCTIONED EXCEPTION.** `tests/fixtures/guard3-reference.sh` changes **alone**, in its own commit, with its header amended in the same commit, and it carries a **declared red**.
- **The mirror pair is byte-identical.** `.claude/hooks/pre-tool-use.mjs` and `project-template/.claude/hooks/pre-tool-use.mjs` change together in one commit; `tests/installer/templates.test.js` is the enforcer.
- **No pattern regex changes.** Only what text reaches the patterns changes.
- **Blanking is length-preserved**, because `g3P7PagerGlob` slices by match length rather than match index.
- **Newlines are preserved verbatim inside a heredoc body**, unlike quoted regions, which mask them. Named and justified in T-002.
- **Leaf-first for `docs/` documents**: add the `!` leaf before staging, so plain `git add` exits 0 and no commit enters a red block-parity state.
- **Guard 3 applies to this work.** Write `.mjs` and `.sh` edits with the Write and Edit tools, never a `cat` heredoc. Commit messages via `git commit -F <file>`. The irony is the item.
- **No em-dashes in any authored output.**
- Ceiling before any filing: currently `BUG-047`, next mintable `BUG-048`. This plan mints nothing.

## Review Focus

Five input classes the spec implies that no task's tests would otherwise exercise.

1. **`<<<` here-strings.** `cat <<< [x]` denies P4 today and **must keep denying**: `<<<` is a here-string, not a heredoc. An introducer matcher accepting `<<` without excluding a third `<` silently converts a live denial into an allow. Owned by T-001 row 21 and T-002.
2. **A delimiter word appearing inside the body.** `not EOF really` must not terminate a heredoc whose delimiter is `EOF`; only a line **equal** to the delimiter does. A substring match would end the state early and expose the rest of the body to the patterns. Owned by T-001 row 25.
3. **An introducer inside a quoted region.** `echo 'cat <<EOF'` must not enter `HEREDOC`, because the existing states win and `<<` there is ordinary text. Owned by T-001 row 24.
4. **A redirect appearing after the introducer.** `cat <<'EOF' > out.txt` puts command text on the same line after the introducer, so the body must not start until the newline. Entering `HEREDOC` immediately would blank `> out.txt` and hide real command text. Owned by T-001 row 26.
5. **The terminator's newline.** If the newline after the terminator line were blanked, a command following the heredoc would no longer sit at command position and `cat *.ts` after a heredoc would stop denying. Owned by T-001 rows 18 and 19, which are the scope controls in both positions.

## File Structure

| Path | Change |
|---|---|
| `tests/fixtures/guard3-corpus.js` | 27 new rows; count assertion 127 to 154 |
| `tests/fixtures/guard3-reference.sh` | `_g3_scan` gains `HEREDOC`; header amended. **Own commit.** |
| `.claude/hooks/pre-tool-use.mjs` | `g3Scan` gains `HEREDOC` |
| `project-template/.claude/hooks/pre-tool-use.mjs` | byte-identical mirror |
| `tests/hooks/guard3.test.js` | corpus length assertion |

---

## Task 0: Commit the plan

- [ ] **[T-000-A] Add the plan's leaf to the tracked-surface block**

Modify `.gitignore`, in sorted position among the `!/docs/superpowers/plans/` leaves, after the `2026-09-29-bug046-...` entry:

```
!/docs/superpowers/plans/2026-09-29-bug047-heredoc-body-scanning.md
```

- [ ] **[T-000-B] Stage with plain `git add` and confirm rc 0**

```bash
git add "docs/superpowers/plans/2026-09-29-bug047-heredoc-body-scanning.md"
echo "rc=$?"
```

Expected `rc=0`. A non-zero exit means the leaf is missing or misspelled; fix the leaf, never reach for `-f`.

- [ ] **[T-000-C] Verify block parity**

Run: `npx vitest run tests/unit/gitignore-block-parity.test.js`
Expected: PASS, 4 of 4.

- [ ] **[T-000-D] Stage `.gitignore` and commit**

```bash
git add -u ".gitignore"
git commit -F <scratchpad>/msg-t000.txt
```

Subject: `docs: add the BUG-047 heredoc body scanning implementation plan`

---

## Task 1: The corpus rows, asserting today's behavior

**Files:** Modify `tests/fixtures/guard3-corpus.js`, `tests/hooks/guard3.test.js`

**Interfaces:**
- Consumes: the `CORPUS` array shape `{ label, command, verdict, toolName?, allowlist? }`.
- Produces: 27 rows both subject suites consume. T-002 and T-003 flip seventeen of their verdicts.

**Why the rows land first, asserting the defect.** Each row states what the guard does **today**, with its predicted post-fix verdict in a comment written **before either subject changes**. The authority edit in T-002 then turns exactly the predicted rows red, which is the discriminator: a row that does not go red when predicted to was not measuring what it claimed.

- [ ] **[T-001-A] Append the 27 rows to `tests/fixtures/guard3-corpus.js`**

Add at the end of `CORPUS`, before the closing `]`:

```js
  // ── [BUG-047] heredoc bodies ────────────────────────────────────────────────
  // Every row states TODAY's verdict. The `-> ` comment is the predicted verdict
  // after the sixth scanner state lands, written before either subject changed.
  // Four specimens are verbatim from their transcripts except where marked.

  // Specimen 1, verbatim, [BUG-041]'s session.
  { label: 'heredoc: bracketed JS body appended to a test file', verdict: 'deny', // -> allow
    command: "cat >> tests/installer/templates.test.js <<'JSEOF'\n  const rows = [\n    ['a', 1],\n  ];\nJSEOF\n" },

  // Specimen 2, CONSTRUCTED, not byte-faithful. The transcript records P4; this
  // rebuild carries ONE apostrophe and dies at the strip gate instead, because the
  // malformed branch fires before any pattern check. The mismatch is what exposed
  // the third denial mechanism, so the imperfect rebuild is kept and marked.
  { label: 'heredoc: commit message body, odd apostrophe (constructed)', verdict: 'deny', // -> allow
    command: "cat > msg.txt <<'EOF'\ndocs: approve the spec [BUG-044]\n\nGuard 3's audit found it.\nEOF\n" },

  // Specimen 2, even-apostrophe form, which is what the transcript's P4 implies.
  { label: 'heredoc: commit message body, even apostrophes', verdict: 'deny', // -> allow
    command: "cat > msg.txt <<'EOF'\nGuard 3's and the audit's finding [BUG-044]\nEOF\n" },

  // Specimen 3, [BUG-042]'s audit.
  { label: 'heredoc: mjs script body with regex class', verdict: 'deny', // -> allow
    command: "cat > probe.mjs <<'MJS'\nconst RE = /\\[(BUG)-(\\d{3,})\\]/g;\nconst n = x ?? 0;\nMJS\n" },

  // Specimen 4, [BUG-046]'s audit.
  { label: 'heredoc: mjs script body with regex class and a for-of', verdict: 'deny', // -> allow
    command: "cat > ceiling.mjs <<'SCRIPT'\nconst RE = /^### \\[.\\]/;\nfor (const line of lines) {}\nSCRIPT\n" },

  // The delimiter pair. Neither subject distinguishes them, because neither has a
  // heredoc state at all; both must allow after the fix.
  { label: 'heredoc: UNQUOTED delimiter, bracket in body', verdict: 'deny', // -> allow
    command: 'cat > out.txt <<EOF\ntext [x] more\nEOF\n' },
  { label: 'heredoc: quoted delimiter, question mark in body', verdict: 'deny', // -> allow
    command: "cat > out.txt <<'EOF'\ntext ?x more\nEOF\n" },

  // Pattern crossings: the same lexical gap produces P5 and P9 verdicts too.
  { label: 'heredoc: command substitution in body (P5 crossing)', verdict: 'deny', // -> allow
    command: "cat > out.txt <<'EOF'\nvalue is $(date)\nEOF\n" },
  { label: 'heredoc: for-of text in body (P9 crossing)', verdict: 'deny', // -> allow
    command: "cat > out.txt <<'EOF'\nfor (const x of y) {}\nEOF\n" },

  // The third mechanism: an ODD number of quote characters trips the fail-closed
  // malformed branch DURING the strip pass, before any pattern check runs.
  { label: 'heredoc: odd apostrophe count in body (malformed gate)', verdict: 'deny', // -> allow
    command: "cat > out.txt <<'EOF'\nGuard 3's audit\nEOF\n" },
  { label: 'heredoc: even apostrophe count in body', verdict: 'allow', // -> allow
    command: "cat > out.txt <<'EOF'\nGuard 3's and the audit's finding\nEOF\n" },

  // The reader-at-command-position boundary, pinned from two directions: identical
  // bodies allow under a non-cat reader today and must keep allowing.
  { label: 'heredoc: tee instead of cat, bracket body', verdict: 'allow', // -> allow
    command: "tee out.txt <<'EOF'\ntext [x] more\nEOF\n" },
  { label: 'heredoc: python reader, bracket body', verdict: 'allow', // -> allow
    command: "python3 - > out.txt <<'PY'\nprint(\"[x]\")\nPY\n" },

  // Bodies that were never denied and must not become denied.
  { label: 'heredoc: plain prose body', verdict: 'allow', // -> allow
    command: "cat > out.txt <<'EOF'\njust some ordinary prose here\nEOF\n" },
  { label: 'heredoc: hash in body is not a comment', verdict: 'allow', // -> allow
    command: "cat > out.txt <<'EOF'\n# a comment-looking line [x]\nEOF\n" },

  // Unredirected heredoc: reads zero files, so it is not a dump. Today's deny on a
  // metacharacter IS the defect. Ruled: no special case.
  { label: 'heredoc: unredirected cat, metachar body', verdict: 'deny', // -> allow
    command: 'cat <<EOF\n[x]\nEOF\n' },

  // P6 reads UNMASKED by design, so it fires on a grep shape inside a body. The flip
  // is deliberate: a grep pattern in written content is data, not a command.
  { label: 'heredoc: grep-matchall shape inside the body only', verdict: 'deny', // -> allow
    command: "cat > out.txt <<'EOF'\ngrep -r '' .\nEOF\n" },
  // THE FRONTIER: the same shape as real code must still deny.
  { label: 'heredoc frontier: grep-matchall as real code', verdict: 'deny', // -> deny
    command: "grep -r '' ." },

  // SCOPE, both positions: the skip is scoped to the body, never to the command.
  // These also pin that the terminator's newline stays verbatim, since a blanked
  // newline would strip the following command of its command position.
  { label: 'heredoc scope: genuine dump AFTER a heredoc write', verdict: 'deny', // -> deny
    command: "cat > out.txt <<'EOF'\nprose\nEOF\ncat *.ts" },
  { label: 'heredoc scope: genuine dump BEFORE a heredoc write', verdict: 'deny', // -> deny
    command: "cat *.ts; cat > out.txt <<'EOF'\nprose\nEOF\n" },

  // AC9: an unterminated heredoc is NOT malformed. Nothing after it is command, so
  // the premise that justifies fail-closed does not hold.
  { label: 'heredoc: unterminated, metachar body', verdict: 'deny', // -> allow
    command: "cat > out.txt <<'EOF'\n[x] body\n" },

  // THE FRONTIER for the introducer matcher: `<<<` is a here-string, NOT a heredoc.
  // A matcher accepting `<<` without excluding a third `<` flips this to allow.
  { label: 'heredoc frontier: here-string <<< with unquoted glob', verdict: 'deny', // -> deny
    command: 'cat <<< [x]' },
  { label: 'heredoc frontier: here-string <<< with quoted glob', verdict: 'allow', // -> allow
    command: 'cat <<< "[x]"' },

  // AC8 and AC2.
  { label: 'heredoc: two heredocs in one command', verdict: 'deny', // -> allow
    command: "cat > a.txt <<'A'\n[x]\nA\ncat > b.txt <<'B'\n[y]\nB\n" },
  { label: 'heredoc: <<- with tab-indented terminator', verdict: 'deny', // -> allow
    command: 'cat > out.txt <<-EOF\n\t[x] body\n\tEOF\n' },

  // AC7: the existing states win; `<<` inside quotes is ordinary text.
  { label: 'heredoc: introducer inside single quotes is not one', verdict: 'allow', // -> allow
    command: "echo 'cat <<EOF' > out.txt" },

  // The delimiter must match a whole line, never a substring.
  { label: 'heredoc: delimiter word appearing inside the body', verdict: 'deny', // -> allow
    command: "cat > out.txt <<'EOF'\nnot EOF really [x]\nEOF\n" },

  // The body starts after the newline, so a redirect on the introducer's own line is
  // still command text and must not be blanked.
  { label: 'heredoc: redirect after the introducer on the same line', verdict: 'deny', // -> allow
    command: "cat <<'EOF' > out.txt\n[x]\nEOF\n" },
```

- [ ] **[T-001-B] Update the corpus length assertion**

Modify `tests/hooks/guard3.test.js:83`:

```js
    expect(CORPUS).toHaveLength(154)
```

- [ ] **[T-001-C] Run both subject suites**

Run: `npx vitest run tests/hooks/guard3.test.js tests/hooks/guard3-port.test.js`
Expected: **PASS**. Every row asserts today's behavior, so both subjects agree with every one. A red here means a row's stated verdict is wrong; fix the row, not the subject.

- [ ] **[T-001-D] Run the full suite**

Run: `npm test`
Expected: **994 passed / 12 skipped, 40 files passed / 1 skipped** (940 plus 27 rows in each of two subject suites).

- [ ] **[T-001-E] Commit**

```bash
git add -u "tests/fixtures/guard3-corpus.js"
git add -u "tests/hooks/guard3.test.js"
git commit -F <scratchpad>/msg-t001.txt
```

Subject: `test: add the heredoc corpus rows asserting today's denials [BUG-047]`

---

## Task 2: The authority, alone

**Files:** Modify `tests/fixtures/guard3-reference.sh`

**Interfaces:**
- Consumes: nothing.
- Produces: `_g3_scan` with a sixth state. T-003 mirrors it into the port.

**THIS COMMIT LANDS ALONE.** It is the sixth sanctioned exception to the frozen authority, it amends the header in the same commit, and it **carries a declared red**: the port is deliberately one commit behind, so authority and port disagree for exactly the length of this commit.

- [ ] **[T-002-A] Amend the header with the sixth exception**

Modify the header comment block at the top of `tests/fixtures/guard3-reference.sh`, appending to the numbered list of recorded changes:

```
#   5. _g3_scan gained a sixth state, HEREDOC, entered on a heredoc introducer and
#      left on the terminator line. Body characters are emitted blanked and
#      length-preserved and do NOT feed quote-parity tracking, so written content can
#      neither trip a pattern check nor produce a malformed denial. A heredoc body is
#      content being WRITTEN and is already inside the command string; it cannot flood
#      anything, and no dump shape uses one (measured: unredirected `cat <<EOF` reads
#      zero files). Sixth sanctioned exception, landing alone. [BUG-047]
```

- [ ] **[T-002-B] Add heredoc introducer recognition to the UNQUOTED branch**

Modify `_g3_scan`. Add a local for the pending delimiter beside the existing locals:

```bash
  local state="UNQUOTED" result=""
  local i=0 len=${#input} ch="" two=""
  local hd_pending="" hd_delim="" hd_dash=0
```

Then, inside the `UNQUOTED)` case, add a branch **before** the regular-character `else`, and **after** the backslash branch:

```bash
        elif [[ "$two" == '<<' ]] && [[ "${input:i+2:1}" != '<' ]]; then
          # Heredoc introducer. `<<<` is a HERE-STRING, not a heredoc, and excluding
          # it is load-bearing: `cat <<< [x]` denies P4 today and must keep denying.
          # The body does not begin until after this line's newline, so the delimiter
          # is recorded and the rest of the line keeps being scanned as command text.
          local j=$((i+2)) q="" w=""
          hd_dash=0
          [[ "${input:j:1}" == '-' ]] && { hd_dash=1; j=$((j+1)); }
          while [[ "${input:j:1}" == ' ' || "${input:j:1}" == $'\t' ]]; do j=$((j+1)); done
          [[ "${input:j:1}" == "'" || "${input:j:1}" == '"' ]] && { q="${input:j:1}"; j=$((j+1)); }
          while [[ "${input:j:1}" =~ [A-Za-z0-9_.-] ]]; do w+="${input:j:1}"; j=$((j+1)); done
          [[ -n "$q" && "${input:j:1}" == "$q" ]] && j=$((j+1))
          if [[ -n "$w" ]]; then
            # Delimiter quoting is recorded and then IGNORED: this scanner performs no
            # expansion, so <<'EOF' and <<EOF are the same to it. [BUG-047]
            hd_pending="$w"
            [[ "$mode" == "strip" || "$mode" == "mask" ]] && result+="${input:i:j-i}"
            i=$j
          else
            [[ "$mode" == "strip" || "$mode" == "mask" ]] && result+="$ch"
            i=$((i+1))
          fi
```

- [ ] **[T-002-C] Enter `HEREDOC` at the newline that follows the introducer**

Modify the regular-UNQUOTED-character branch so a newline with a pending delimiter switches state:

```bash
        else
          # Regular UNQUOTED character
          if [[ "$mode" == "glob" ]] && [[ "$ch" =~ [*?{[] ]]; then
            return 1  # unquoted glob found
          fi
          [[ "$mode" == "strip" || "$mode" == "mask" ]] && result+="$ch"
          i=$((i+1))
          if [[ "$ch" == $'\n' && -n "$hd_pending" ]]; then
            hd_delim="$hd_pending"; hd_pending=""; state="HEREDOC"
          fi
        fi ;;
```

- [ ] **[T-002-D] Add the `HEREDOC` case**

Add a new case arm after `ANSI_C_QUOTED)`:

```bash
      HEREDOC)
        # One line at a time. Every non-newline character is blanked to 'x',
        # length-preserved because g3P7PagerGlob slices by match LENGTH and a change in
        # length would desynchronise its walk.
        #
        # Newlines are kept VERBATIM here, unlike quoted regions, which mask them. The
        # quoted-region masking exists so a newline inside a string cannot become a
        # command-position anchor. Here the opposite is needed: the newline AFTER the
        # terminator must survive, or a command following the heredoc would lose its
        # command position and `cat *.ts` after a heredoc would stop denying. Body
        # newlines are harmless because everything around them is 'x'. [BUG-047]
        local line="" eol=$i
        while (( eol < len )) && [[ "${input:eol:1}" != $'\n' ]]; do eol=$((eol+1)); done
        line="${input:i:eol-i}"
        local cmp="$line"
        (( hd_dash )) && cmp="${cmp#"${cmp%%[!$'\t']*}"}"
        if [[ "$mode" == "strip" || "$mode" == "mask" ]]; then
          local k=0
          while (( k < ${#line} )); do result+="x"; k=$((k+1)); done
        fi
        i=$eol
        if (( i < len )); then
          [[ "$mode" == "strip" || "$mode" == "mask" ]] && result+=$'\n'
          i=$((i+1))
        fi
        # Only a line EQUAL to the delimiter terminates. A substring would end the
        # state early and expose the rest of the body to the patterns.
        [[ "$cmp" == "$hd_delim" ]] && { state="UNQUOTED"; hd_delim=""; hd_dash=0; }
        ;;
```

- [ ] **[T-002-E] Exempt `HEREDOC` from the fail-closed end-of-input check**

Modify the closing block:

```bash
  # Fail-closed: unclosed quote is malformed input.
  #
  # HEREDOC is deliberately exempt. The rule exists because an unbalanced quote leaves
  # AMBIGUITY about where command text resumes, and the scanner refuses to guess. An
  # unterminated heredoc leaves no ambiguity: everything to end of input is body and
  # there is no "after", so there is nothing unread to protect. Bash agrees, measured:
  # on GNU bash 3.2.57 a script ending mid-heredoc delivers the body and exits 0 with
  # no warning; newer bash warns and still proceeds. Fail-closed here would deny every
  # draft of a file write whose delimiter line has not arrived yet, which is this
  # item's own defect resurrected in a new state. The departure is correct BECAUSE the
  # rule's premise does not apply. Do not normalise this branch. [BUG-047]
  if [[ "$state" != "UNQUOTED" && "$state" != "HEREDOC" ]]; then
```

- [ ] **[T-002-F] Run the authority suite and confirm the DECLARED RED**

Run: `npx vitest run tests/hooks/guard3.test.js`
Expected: **RED, exactly 17 cases**, each a heredoc row whose corpus verdict still reads `deny` while the authority now allows:

```
heredoc: bracketed JS body appended to a test file
heredoc: commit message body, odd apostrophe (constructed)
heredoc: commit message body, even apostrophes
heredoc: mjs script body with regex class
heredoc: mjs script body with regex class and a for-of
heredoc: UNQUOTED delimiter, bracket in body
heredoc: quoted delimiter, question mark in body
heredoc: command substitution in body (P5 crossing)
heredoc: for-of text in body (P9 crossing)
heredoc: odd apostrophe count in body (malformed gate)
heredoc: unredirected cat, metachar body
heredoc: grep-matchall shape inside the body only
heredoc: unterminated, metachar body
heredoc: two heredocs in one command
heredoc: <<- with tab-indented terminator
heredoc: delimiter word appearing inside the body
heredoc: redirect after the introducer on the same line
```

**Any other count, or any other case, is a tripwire halt.** In particular: if either `heredoc frontier: here-string <<< with unquoted glob` or either scope control goes red, the introducer matcher or the newline handling is wrong, and that is a defect rather than the declared red.

- [ ] **[T-002-G] Confirm the port suite is still green**

Run: `npx vitest run tests/hooks/guard3-port.test.js`
Expected: **PASS.** The port is unchanged and the corpus still says `deny`, so it agrees. This is what "deliberately one commit behind" means, and it is the proof that the red in T-002-F belongs to the authority alone.

- [ ] **[T-002-H] Commit the authority ALONE, bypassing the gate once**

The pre-commit hook runs the full suite, which is red by design here. The bypass belongs to **this one commit** and the hook is never edited or weakened.

```bash
git add -u "tests/fixtures/guard3-reference.sh"
git status --short
git commit --no-verify -F <scratchpad>/msg-t002.txt
```

`git status --short` must show **exactly one** modified path before committing. Subject: `fix: stop the authority scanner reading heredoc bodies as command text [BUG-047]`

The body names the sixth sanctioned exception, quotes the seventeen failing case names verbatim, and states that the port is deliberately one commit behind for the length of this commit.

---

## Task 3: The port, its mirror, and the corpus flip

**Files:** Modify `.claude/hooks/pre-tool-use.mjs`, `project-template/.claude/hooks/pre-tool-use.mjs`, `tests/fixtures/guard3-corpus.js`

- [ ] **[T-003-A] Add the sixth state to `g3Scan` in `.claude/hooks/pre-tool-use.mjs`**

Replace the scanner's state handling with the heredoc-aware form:

```js
function g3Scan(mode, input) {
  const emit = mode === 'strip' || mode === 'mask';
  let state = 'UNQUOTED';
  let result = '';
  let i = 0;
  let hdPending = null;   // delimiter recorded at the introducer
  let hdDelim = null;     // delimiter in force while state === 'HEREDOC'
  let hdDash = false;
  const len = input.length;
  while (i < len) {
    const ch = input[i];
    const two = input.slice(i, i + 2);
    if (state === 'UNQUOTED') {
      if (two === "$'") { if (emit) result += two; i += 2; state = 'ANSI_C_QUOTED'; }
      else if (two === '$"') { if (emit) result += two; i += 2; state = 'LOCALE_QUOTED'; }
      else if (ch === '\\') { if (emit) result += input.slice(i, i + 2); i += 2; }
      else if (ch === "'") { if (emit) result += ch; i += 1; state = 'SINGLE_QUOTED'; }
      else if (ch === '"') { if (emit) result += ch; i += 1; state = 'DOUBLE_QUOTED'; }
      else if (two === '<<' && input[i + 2] !== '<') {
        // Heredoc introducer. `<<<` is a HERE-STRING, not a heredoc, and excluding it
        // is load-bearing: `cat <<< [x]` denies P4 today and must keep denying.
        // The body does not begin until after this line's newline, so the delimiter is
        // recorded and the rest of the line keeps being scanned as command text.
        let j = i + 2;
        hdDash = input[j] === '-';
        if (hdDash) j += 1;
        while (input[j] === ' ' || input[j] === '\t') j += 1;
        const q = (input[j] === "'" || input[j] === '"') ? input[j] : '';
        if (q) j += 1;
        let w = '';
        while (j < len && /[A-Za-z0-9_.-]/.test(input[j])) { w += input[j]; j += 1; }
        if (q && input[j] === q) j += 1;
        if (w) {
          // Delimiter quoting is recorded and then IGNORED: this scanner performs no
          // expansion, so <<'EOF' and <<EOF are the same to it. [BUG-047]
          hdPending = w;
          if (emit) result += input.slice(i, j);
          i = j;
        } else {
          if (emit) result += ch;
          i += 1;
        }
      }
      else if (ch === '#' && mode === 'strip') { while (i < len && input[i] !== '\n') i += 1; }
      else {
        if (mode === 'glob' && (ch === '*' || ch === '?' || ch === '{' || ch === '[')) return { glob: true };
        if (emit) result += ch;
        i += 1;
        if (ch === '\n' && hdPending !== null) { hdDelim = hdPending; hdPending = null; state = 'HEREDOC'; }
      }
    } else if (state === 'HEREDOC') {
      // One line at a time. Every non-newline character is blanked to 'x',
      // length-preserved because g3P7PagerGlob slices by match LENGTH.
      //
      // Newlines stay VERBATIM here, unlike quoted regions, which mask them. Quoted
      // masking stops a newline inside a string becoming a command-position anchor.
      // Here the opposite is needed: the newline after the terminator must survive, or
      // a command following the heredoc loses its command position and `cat *.ts`
      // after a heredoc stops denying. Body newlines are harmless because everything
      // around them is 'x'. [BUG-047]
      let eol = input.indexOf('\n', i);
      if (eol === -1) eol = len;
      const line = input.slice(i, eol);
      const cmp = hdDash ? line.replace(/^\t+/, '') : line;
      if (emit) result += 'x'.repeat(line.length);
      i = eol;
      if (i < len) { if (emit) result += '\n'; i += 1; }
      // Only a line EQUAL to the delimiter terminates. A substring would end the state
      // early and expose the rest of the body to the patterns.
      if (cmp === hdDelim) { state = 'UNQUOTED'; hdDelim = null; hdDash = false; }
    } else if (state === 'SINGLE_QUOTED') {
      if (mode === 'strip') result += ch;
      else if (mode === 'mask') result += ch === "'" ? ch : 'x';
      if (ch === "'") state = 'UNQUOTED';
      i += 1;
    } else if (state === 'DOUBLE_QUOTED' || state === 'LOCALE_QUOTED') {
      if (ch === '\\') { if (mode === 'strip') result += input.slice(i, i + 2); else if (mode === 'mask') result += 'xx'; i += 2; }
      else if (ch === '"') { if (emit) result += ch; i += 1; state = 'UNQUOTED'; }
      else { if (mode === 'strip') result += ch; else if (mode === 'mask') result += 'x'; i += 1; }
    } else {
      if (ch === '\\') { if (mode === 'strip') result += input.slice(i, i + 2); else if (mode === 'mask') result += 'xx'; i += 2; }
      else if (ch === "'") { if (emit) result += ch; i += 1; state = 'UNQUOTED'; }
      else { if (mode === 'strip') result += ch; else if (mode === 'mask') result += 'x'; i += 1; }
    }
  }
  // HEREDOC is deliberately exempt from the fail-closed check. The rule exists because
  // an unbalanced quote leaves AMBIGUITY about where command text resumes. An
  // unterminated heredoc leaves none: everything to end of input is body and there is
  // no "after". Bash agrees, measured: on GNU bash 3.2.57 a script ending mid-heredoc
  // delivers the body and exits 0 with no warning. Fail-closed here would deny every
  // draft of a file write whose delimiter line has not arrived, which is this item's
  // own defect in a new state. Do not normalise this branch. [BUG-047]
  if (state !== 'UNQUOTED' && state !== 'HEREDOC') return emit ? { result, malformed: true } : { glob: true };
  return emit ? { result, malformed: false } : { glob: false };
}
```

Also update the scanner's doc comment above the function from "five-state" to "six-state", naming `HEREDOC`.

- [ ] **[T-003-B] Mirror the file byte-for-byte**

```bash
cp ".claude/hooks/pre-tool-use.mjs" "project-template/.claude/hooks/pre-tool-use.mjs"
diff ".claude/hooks/pre-tool-use.mjs" "project-template/.claude/hooks/pre-tool-use.mjs" && echo "mirror identical"
```

- [ ] **[T-003-C] Flip the seventeen corpus verdicts**

Modify `tests/fixtures/guard3-corpus.js`: for each of the seventeen rows listed in T-002-F, change `verdict: 'deny'` to `verdict: 'allow'` and change its trailing comment from `// -> allow` to `// [BUG-047] flipped`. **Leave all ten other heredoc rows untouched**, including both frontiers and both scope controls.

- [ ] **[T-003-D] Run both subject suites**

Run: `npx vitest run tests/hooks/guard3.test.js tests/hooks/guard3-port.test.js`
Expected: **PASS, both.** The single sanctioned divergence returns to exactly one.

- [ ] **[T-003-E] Run the mirror assertion**

Run: `npx vitest run tests/installer/templates.test.js`
Expected: PASS, including `ships the front door as one byte-identical mirrored pair`.

- [ ] **[T-003-F] Run the full suite**

Run: `npm test`
Expected: **994 passed / 12 skipped, 40 files passed / 1 skipped**, unchanged from T-001-D because no test was added or removed, only verdicts and code changed.

- [ ] **[T-003-G] Prove the harness conflict has dissolved, end to end, through the live hook**

```bash
node <scratchpad>/harness-conflict-check.mjs
```

Write that file with the Write tool. It pipes a realistic heredoc file write, a `.mjs` body carrying a character class, a `??`, a `.forEach` and an apostrophe, into `.claude/hooks/pre-tool-use.mjs` in a throwaway cwd, and asserts the hook allows it. It also asserts `cat *.ts` still denies, as its control.

Expected: `allow` for the heredoc write, `deny` for the control. **This is AC24 and it is the item's success measure**: the platform's guidance and this repository's hook stop contradicting each other.

- [ ] **[T-003-H] Commit**

```bash
git add -u ".claude/hooks/pre-tool-use.mjs"
git add -u "project-template/.claude/hooks/pre-tool-use.mjs"
git add -u "tests/fixtures/guard3-corpus.js"
git commit -F <scratchpad>/msg-t003.txt
```

Subject: `fix: port the heredoc scanner state and flip the corpus verdicts [BUG-047]`

---

## Task 4: The release

**Files:** Modify `VERSION`, `package.json`, `package-lock.json`, `CHANGELOG.md`, `AGENT-READABLE BACKLOG.md`

**One commit, per the atomic-record exception ruled at `fab33de`.** Splitting the version bump from the `CHANGELOG` leaves the version invariant red between commits; splitting the heading flip from the claim leaves record parity's direction A red.

- [ ] **[T-004-A] Set `VERSION` to `1.33.0`**
- [ ] **[T-004-B] Set `package.json` `version` to `1.33.0`**
- [ ] **[T-004-C] Set both `package-lock.json` locations to `1.33.0`**

- [ ] **[T-004-D] Add the `CHANGELOG.md` entry above the `1.32.2` heading**

The bullet must lead with the bolded id marker under a shipped-change section, or record parity will not see it:

```markdown
## [1.33.0] - 2026-09-29

### Fixed
- **[BUG-047]** Guard 3 read heredoc bodies as command text, so writing a file whose content carried a glob metacharacter, a command substitution or an odd number of quote characters was denied by patterns written to catch mass reads. Both scanners gain a sixth state, `HEREDOC`: body characters are blanked length-preserved and do not feed quote-parity tracking, so content being written can neither trip a pattern check nor produce a malformed denial. Four specimens across four consecutive sessions are corpus rows.

### Changed
- **[BUG-047]** `project-template/.claude/hooks/pre-tool-use.mjs` changes, so a fresh install differs. That is why this release is minor rather than a patch.

Nothing else under `project-template/` or `lib/` changed. A heredoc body is content being written and is already inside the command string the scanner holds, so it cannot flood anything, and no dump shape uses one: unredirected `cat <<EOF` reads zero files. A genuine dump before or after a heredoc is still denied, and `<<<` here-strings are untouched.
```

- [ ] **[T-004-E] Flip the `[BUG-047]` backlog heading and add its DONE bullet**

Surgical single-line edit of the heading to `[X]`, then insert as the first bullet beneath it, above the 2026-09-29 amendment.

- [ ] **[T-004-F] Run the version gate and record parity**

```bash
node tools/version-gate.mjs; echo "rc=$?"
node tools/record-parity.mjs; echo "rc=$?"
```

Expected: `VERSION_GATE_OK 1.33.0` and `RECORD_PARITY_OK`, rc 0 each. **The instruments' third official act.**

- [ ] **[T-004-G] Prove the parity green rather than trusting it**

Flip the `[BUG-047]` heading to `[ ]`, run `node tools/record-parity.mjs`, confirm it reports `FAIL [A] 1.33.0 claims BUG-047 but its heading reads [ ]` once per claim bullet and exits 1, then flip it back and confirm green.

- [ ] **[T-004-H] Run the full suite**

Run: `npm test`
Expected: **994 passed / 12 skipped, 40 files passed / 1 skipped**.

- [ ] **[T-004-I] Stage the five paths and commit**

Subject: `1.33.0 - BUG-047: stop Guard 3 reading heredoc bodies as command text`

The body records the atomic-record exception citing `fab33de`.

---

## Task 5: The pull request

- [ ] **[T-005-A] Push the branch**

```bash
git push -u origin "fix/bug-047-heredoc-body-scanning"
```

- [ ] **[T-005-B] Open the PR with a body written to a file, never a heredoc**

```bash
gh pr create --title "1.33.0 - BUG-047: stop Guard 3 reading heredoc bodies as command text" --body-file <scratchpad>/pr-body-047.md
```

The body states: the load-bearing sentence; the four specimens; the harness conflict and its dissolution as the success measure; the 17-of-17 differential agreement and the declared red that briefly broke it; the two frontiers (`<<<` and P6-as-real-code) and the two scope controls; AC9's departure with its bash measurement; and the boundary table with every predicted count met.

- [ ] **[T-005-C] Confirm CI green before requesting review**

```bash
gh pr checks --watch
```

---

## Task 6: Closeout

Runs after the merge, per the settled ritual and `docs/RELEASE-CLOSEOUT.md`.

- [ ] **[T-006-A] Sync `main`, reporting `N ahead / M behind` before fast-forwarding**
- [ ] **[T-006-B] Re-run all three instruments on the merged tree**
- [ ] **[T-006-C] Append the closeout record to `.claude/memory/project.md`**

It carries: the boundary table; the declared red with its seventeen case names verbatim; the two frontier rows and why each would have been silently broken; AC9's bash measurement; the harness-conflict proof; and whether the sixth-exception ritual held.

- [ ] **[T-006-D] Commit and push in the same action, then delete the branch with `-d`**

---

## Test List

- [ ] 27 corpus rows, driving both subject suites, 54 test cases in total.
- [ ] The mirror assertion in `tests/installer/templates.test.js`, already present.
- [ ] The corpus length assertion, 127 to 154.
- [ ] The harness-conflict end-to-end check in T-003-G, a scratchpad probe rather than a tracked test, because it asserts a property the corpus rows already pin and its value is the demonstration.

No new test file is added: the corpus is the instrument, and it already drives both subjects.

## Commit Order

| Commit | Task | Contents |
|---|---|---|
| 1 | T-000 | plan file, `.gitignore` leaf |
| 2 | T-001 | corpus rows, length assertion |
| 3 | T-002 | **the authority, alone**, header amended, `--no-verify`, declared red |
| 4 | T-003 | port, mirror, corpus verdict flips |
| 5 | T-004 | five version locations, `CHANGELOG`, backlog flip and DONE bullet |
| 6 | T-006 | `.claude/memory/project.md`, on `main`, after merge |

## Predicted Boundaries

| After | Tests | Files | Suite |
|---|---|---|---|
| baseline | 940 / 12 | 40 / 1 | all |
| T-000 | 940 / 12 | 40 / 1 | `gitignore-block-parity` green throughout |
| T-001 | **994 / 12** | 40 / 1 | `guard3`, `guard3-port`, both green |
| T-002 | **RED, exactly 17 cases** | 40 / 1 | `guard3.test.js` only; `guard3-port.test.js` stays green |
| T-003 | 994 / 12 | 40 / 1 | both green; `templates.test.js` mirror green |
| T-004 | 994 / 12 | 40 / 1 | all green at `1.33.0` |

**The one declared red is T-002's, and its contract is the case list in T-002-F.** Deviation in count, in case membership, or in suite is a tripwire halt. Two specific reds would be defects rather than the declared red: either `<<<` frontier row, or either scope control.

## Identified Risks

1. **`<<<` swallowed by the introducer matcher.** `cat <<< [x]` denies P4 today; a matcher accepting `<<` without excluding a third `<` flips a live denial to an allow. **Caught early by** the frontier row in T-001 going red at T-002-F, where it is explicitly listed as a defect rather than part of the declared red.
2. **The terminator's newline blanked.** Then a command after the heredoc loses its command position and `cat *.ts` stops denying. **Caught early by** both scope controls, which is why they exist in both positions.
3. **Delimiter matched as a substring.** `not EOF really` would end the state early and expose the rest of the body. **Caught early by** the delimiter-inside-body row.
4. **The body entered too early**, blanking a redirect on the introducer's own line. **Caught early by** the redirect-after-introducer row.
5. **The mirror drifting.** `templates.test.js` asserts byte identity; T-003-B copies rather than re-editing, and T-003-E runs the assertion before the commit.
6. **The `--no-verify` bypass leaking beyond one commit.** T-002-H checks `git status --short` shows exactly one modified path before committing, and no later task uses `--no-verify`. The hook itself is never edited.
7. **bash 3.2 syntax.** The authority runs under GNU bash 3.2.57 on macOS, which lacks `${var,,}` and associative arrays. The code in T-002 uses only substring extraction, `[[ =~ ]]` and arithmetic, all 3.2-safe. **Caught early by** T-002-F, which runs the authority itself.
8. **Guard 3 denying this plan's own work.** Every `.mjs` and `.sh` edit goes through the Write and Edit tools and every commit message through `git commit -F`. A denial here is this item's own family and is routed around, never bypassed.
