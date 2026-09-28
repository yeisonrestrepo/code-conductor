# BUG-043 quoted-argv blindness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Guard 3's code-reading checks a copy of the command in which quoted content cannot be mistaken for code, while the two checks that read quoted content by design keep receiving it.

**Architecture:** A third mode on the scanner that already tracks five quote states, in both subjects, plus a dispatch that names the two by-design checks in one place. No new scanner, no new file, no change to the hook's single-file deployment.

**Tech Stack:** bash (the frozen authority), Node ESM (the shipped hook and its mirror), vitest (both harnesses).

**Spec:** `docs/superpowers/specs/2026-09-28-bug043-quoted-argv-blindness-design.md` (17 ACs, approved 2026-09-28, reworded in `fd4a65f`)

## Global Constraints

- Baseline is **873 passed, 12 skipped**, confirmed at `fd4a65f`.
- Corpus is **117 CORPUS rows plus 7 DIALECT rows = 124**, driven by **both** harnesses. `tests/hooks/guard3.test.js:83` asserts the CORPUS length and **must move in the same step as any row addition**; the port suite has no equivalent assertion.
- `EXCEPTIONS` has exactly **1** member and `tests/hooks/guard3-port.test.js` asserts it.
- **The port is a byte-identical mirrored pair.** Both `.claude/hooks/pre-tool-use.mjs` and `project-template/.claude/hooks/pre-tool-use.mjs` carry every change; `tests/installer/templates.test.js:96-98` is the guard.
- **The mask is built from the stripped string and applied before the newline-to-semicolon join** in both subjects.
- **Exactly two checks receive the unmasked string: P6 and P12.**
- The seven P6/P12 true positives and both P9 controls must not move at any boundary.
- **No second file.** The scanner is not extracted; a missing sibling would make the hook fail at module load and fail open, which is the defect the single-file decision exists to prevent.
- Ship as **1.31.3**, with `version-gate.mjs` reading all five locations.
- Stage by tracked-ness, commit with `git commit -F`, surgical single-line plan-state edits, no em-dashes.

---

## Corrected boundary table

The approved numbers were 873 to 889. **They moved, and the cause is arithmetic rather than drift:** AC3 gained three constructed boundary rows and AC2-B plus AC9-B added contract lines, all after the table was stated. Ten rows land instead of seven, and the contract assertions consolidate into four tests rather than twelve.

| after | passed | failed | suites | why |
|---|---|---|---|---|
| baseline | 873 | 0 | | confirmed at `fd4a65f` |
| T-002, rows added | **893** | 0 | | +20: ten rows across two suites, each asserting its **pre-fix** verdict |
| T-003, authority alone | **884** | **9** | `guard3.test.js` only | the nine flipping rows, authority side. **Declared red state 1** |
| T-004-D, port and mirror | **875** | **18** | both suites, nine each | both subjects allow while the rows still record `deny`. **Declared red state 2**, observed and not committed |
| T-004-H, rows flipped | **893** | 0 | | green restored |
| T-005, contract tests | **897** | 0 | | +4 |

Any deviation in count **or suite** is a tripwire halt. The nine flipping rows are the four inherited (`KNOWN-FP P9-1`, `KNOWN-FP OBF`, `KNOWN-FP P5`, `KNOWN-FP P9 for-of`) plus the four new shape rows plus the fragment-parity row.

**If T-003 cannot pass the gate**, the bypass follows the BUG-041 ritual under AC12: suite run manually first, verbatim failure list in the commit body, one commit only, halt on any tenth failure or any red in the port suite, and the exception belongs to the commit rather than to the hook.

---

## File Structure

| file | responsibility |
|---|---|
| `tests/fixtures/guard3-reference.sh` | `_g3_scan` gains a `mask` mode; the dispatch gains one call and eleven argument swaps |
| `.claude/hooks/pre-tool-use.mjs` | `g3Scan` gains the mirrored mode; `guard3BashScan` gains the mask call and the `UNMASKED_CHECKS` set |
| `project-template/.claude/hooks/pre-tool-use.mjs` | the identical change; the pair is asserted byte-identical |
| `tests/fixtures/guard3-corpus.js` | ten rows added, nine rows flipped, two comment blocks rewritten |
| `tests/hooks/guard3.test.js` | corpus-length assertion 117 to 127 |
| `tests/hooks/guard3-port.test.js` | four contract tests, both subjects |
| `AGENT-READABLE BACKLOG.md` | amendment note, entry closed |
| `VERSION`, `package.json`, `package-lock.json`, `CHANGELOG.md`, `.claude/memory/project.md` | the 1.31.3 release and its record |

---

## Ordered Steps

### Task 0: the plan commit

- [X] [T-000-A] Stage this plan file. `docs/` is ignored by `.gitignore:8` and the file is new, so this is the `-f` branch of the staging convention: `git add -f "docs/superpowers/plans/2026-09-28-bug043-quoted-argv-blindness.md"`. Confirm `add_rc=0`.
- [>] [T-000-B] Commit with subject `docs: add the BUG-043 quoted-argv blindness implementation plan` and the two trailers, via `git commit -F <scratchpad>/msg-t000.txt`. The gate runs green; nothing has changed yet.

---

### Task 1: premise gates

Every step runs before a character of either subject changes.

- [ ] [T-001-A] Confirm the authority's scanner is byte-for-byte what this plan edits. Read `tests/fixtures/guard3-reference.sh` at `offset: 81, limit: 78`. It must contain `local mode="$1" input="$2"`, the five `case "$state"` arms, and eleven `[[ "$mode" == "strip" ]] && result+=` guards. Any difference halts.
- [ ] [T-001-B] Confirm the port's scanner. Read `.claude/hooks/pre-tool-use.mjs` at `offset: 156, limit: 40`. `g3Scan(mode, input)` must carry the same five states and return `{ result, malformed }` for strip and `{ glob }` for glob.
- [ ] [T-001-C] Confirm the dispatch shapes. Read `guard3-reference.sh` at `offset: 424, limit: 40` and `pre-tool-use.mjs` at `offset: 438, limit: 20`. The authority must show `_G3_PRE=$(_g3_scan "strip" "$_G3_JOINED")`, the `//$'\n'/;` substitution and thirteen call sites; the port must show `const pre = g3Chomp(scan.result).split('\n').join(';');` and the single dispatch loop.
- [ ] [T-001-D] Confirm the corpus-length assertion currently reads `117` and that `guard3-port.test.js` still has no CORPUS-length assertion of its own.
- [ ] [T-001-E] Record the baseline: `npx vitest run --reporter=basic`. Expected `873 passed | 12 skipped`. Any other number replaces the table's first row before Task 2 begins.
- [ ] [T-001-F] Prove the bash mask mode on a **full copy** of the frozen file before the frozen file is touched, the way T-001-C did for BUG-041. Write `<scratchpad>/probe-bash-mask.mjs` that copies `guard3-reference.sh` with the Task 3 edits applied, then runs these through the copy with `LC_ALL=C LANG=C`:

  | command | expected |
  |---|---|
  | `KNOWN-FP P9-1`'s command | allow |
  | `KNOWN-FP OBF`'s command | allow |
  | `KNOWN-FP P5`'s command | allow |
  | `KNOWN-FP P9 for-of`'s command | allow |
  | `for f in *.ts` | deny |
  | `grep -r '.*' .` | deny |
  | `alias c=cat` | deny |
  | `c'a't` | **deny** (AC9's guard: quote characters survived) |
  | `cat *.md` | deny |

  Any disagreement halts before the frozen file is edited.

- [ ] [T-001-G] Confirm the ten new rows' **pre-fix** verdicts against the current hook, so Task 2 can assert them. Write `<scratchpad>/verify-prefix-verdicts.mjs` that runs each of the ten commands through `.claude/hooks/pre-tool-use.mjs` and prints its verdict. **All ten must read `deny`.** A row that already allows pre-fix cannot be added asserting `deny`.

---

### Task 2: the corpus rows, with their pre-fix verdicts

**Files:** modify `tests/fixtures/guard3-corpus.js`, `tests/hooks/guard3.test.js:83`

- [ ] [T-002-A] Add the two **MASK-DESIGN** rows, which guard the by-design classification and deny both before and after the fix:

  ```js
  // MASK-DESIGN rows, [BUG-043]. These two exist so the P6/P12 by-design boundary is
  // guarded by the oracle rather than by a matrix in a spec. Both read quoted content
  // ON PURPOSE, so both must keep denying after the mask lands.
  //
  // P12's row closes a real hole: alias c=cat and alias g=grep use UNQUOTED values,
  // which a mistaken mask would leave untouched, so nothing in the corpus discriminated
  // P12's classification before this row.
  { label: 'MASK-DESIGN P6: quoted match-all pattern must stay readable', command: 'grep -r -e \'.*\' "src dir"', verdict: 'deny' },
  { label: 'MASK-DESIGN P12: quoted alias value must stay readable', command: 'alias t=\'tail -50\'', verdict: 'deny' },
  ```

- [ ] [T-002-B] Add the four **shape** rows for the mechanism-2 classes that lack one, each quoted verbatim from the session transcript, each `deny` now and predicted `allow` after the fix. Source them with a script that pulls the exact strings from the transcript rather than retyping, the method BUG-041 used: `node <scratchpad>/add-rows-043.mjs shapes`. The four shapes are the OBF `perl -0pi -e` host, the OBF `node -e` regex host, the P11 prose-period specimen, and the P9 quoted-regex specimen. Comment block:

  ```js
  // MECHANISM-2 shapes, pending the fix in this same item. One root cause, four
  // accidental consumers: P9 reads quoted prose, quoted code and a quoted REGEX as a
  // shell loop; OBF reads a backslash run inside a quoted regex as evasion, in grep -E,
  // perl -0pi -e and node -e hosts; P5 reads an escaped backtick as a command
  // substitution; P11 reads an English sentence's period-and-space as the bash dot
  // operator. P11 and the regex sub-shape are corrections to [BUG-041]'s spec, recorded
  // here rather than back-edited into it.
  ```

- [ ] [T-002-C] Add the **fragment quote-parity** row, verbatim, `deny` now and predicted `allow` after:

  ```js
  // FRAGMENT QUOTE-PARITY, [BUG-041]'s named residual, in scope here because it shares
  // the seam: P4 and P7 hand g3Scan a FRAGMENT that starts in UNQUOTED regardless of the
  // state it really begins in, so quotes invert and an unquoted ? from a $? reads as a
  // glob. Masking the input removes the content that inversion was misreading.
  ```

- [ ] [T-002-D] Add the three **constructed** boundary rows, marked as constructed rather than drawn from the transcript, each `deny` before and after:

  ```js
  // CONSTRUCTED boundary rows, not transcript specimens. They pin the scanner's exotic
  // openers and the escaped-pair branch through the mask, and each carries a real
  // unquoted glob after the quoted part so the verdict turns on the glob, not the quote.
  { label: 'boundary: ansi-c opener before a pager glob (constructed)', command: 'cat $\'x\'; less *.ts', verdict: 'deny' },
  { label: 'boundary: locale opener before a pager glob (constructed)', command: 'cat $"x"; less *.ts', verdict: 'deny' },
  { label: 'boundary: escaped pair inside quotes then a glob (constructed)', command: 'echo "a\\\\b"; cat *.md', verdict: 'deny' },
  ```

- [ ] [T-002-E] Move the corpus-length assertion in the **same step group**: `tests/hooks/guard3.test.js:83` from `toHaveLength(117)` to `toHaveLength(127)`. Skipping this is the BUG-041 lesson; it costs one failure above every prediction.
- [ ] [T-002-F] Verify the rows parse and say what they mean: `node <scratchpad>/verify-new-rows-043.mjs`, which imports the corpus, asserts `CORPUS.length === 127`, and compares each of the ten commands byte-for-byte against its source string.
- [ ] [T-002-G] Run the suite: `npx vitest run --reporter=basic`. **Expected: 893 passed, 12 skipped, 0 failed.** Every new row denies correctly under the unfixed hook, which is what makes them pre-written acceptances rather than wishes.
- [ ] [T-002-H] Stage and commit. Both files are tracked: `git add -u "tests/fixtures/guard3-corpus.js" "tests/hooks/guard3.test.js"`. Subject `test: land the BUG-043 acceptance rows before the fix`, body naming the ten rows, their pre-fix verdicts and the nine predicted flips.

---

### Task 3: the authority

**Files:** modify `tests/fixtures/guard3-reference.sh`

- [ ] [T-003-A] Add the `mask` mode to `_g3_scan`. The header comment gains a third bullet, and each accumulation guard learns the mode. Unquoted characters are emitted unchanged in both modes; quoted content becomes `x`; **quote characters and the two-character openers are always emitted as themselves**; a backslash pair inside quotes emits **two** mask characters. Replace the `SINGLE_QUOTED`, `DOUBLE_QUOTED|LOCALE_QUOTED` and `ANSI_C_QUOTED` arms with:

  ```sh
      SINGLE_QUOTED)
        # \ is literal; any ' exits (there is no escape mechanism here)
        [[ "$mode" == "strip" ]] && result+="$ch"
        if [[ "$mode" == "mask" ]]; then
          if [[ "$ch" == "'" ]]; then result+="$ch"; else result+="x"; fi
        fi
        [[ "$ch" == "'" ]] && state="UNQUOTED"
        i=$((i+1)) ;;
      DOUBLE_QUOTED|LOCALE_QUOTED)
        if [[ "$ch" == '\' ]]; then
          [[ "$mode" == "strip" ]] && result+="${input:i:2}"
          [[ "$mode" == "mask" ]] && result+="xx"
          i=$((i+2))
        elif [[ "$ch" == '"' ]]; then
          [[ "$mode" == "strip" || "$mode" == "mask" ]] && result+="$ch"
          i=$((i+1)); state="UNQUOTED"
        else
          [[ "$mode" == "strip" ]] && result+="$ch"
          [[ "$mode" == "mask" ]] && result+="x"
          i=$((i+1))
        fi ;;
      ANSI_C_QUOTED)
        if [[ "$ch" == '\' ]]; then
          [[ "$mode" == "strip" ]] && result+="${input:i:2}"
          [[ "$mode" == "mask" ]] && result+="xx"
          i=$((i+2))
        elif [[ "$ch" == "'" ]]; then
          [[ "$mode" == "strip" || "$mode" == "mask" ]] && result+="$ch"
          i=$((i+1)); state="UNQUOTED"
        else
          [[ "$mode" == "strip" ]] && result+="$ch"
          [[ "$mode" == "mask" ]] && result+="x"
          i=$((i+1))
        fi ;;
  ```

- [ ] [T-003-B] In the `UNQUOTED` arm, widen the five emit guards from `[[ "$mode" == "strip" ]]` to `[[ "$mode" == "strip" || "$mode" == "mask" ]]` for the `$'` opener, the `$"` opener, the unquoted backslash pair, the `'` and `"` characters, and the regular-character branch. **Leave the `#` comment branch on `strip` alone:** the mask runs over an already-stripped string, so it never meets a comment, and widening it would be a second way to shorten the output.
- [ ] [T-003-C] At the end of the function, emit the mask the way strip emits its result: extend the two `[[ "$mode" == "strip" ]] && printf '%s' "$result"` lines to `[[ "$mode" == "strip" || "$mode" == "mask" ]]`, so the mask reaches stdout on both the malformed and clean paths.
- [ ] [T-003-D] Build the mask in the dispatch, **before** the newline substitution, and mask the newlines the same way afterward. Replace the block at the `//$'\n'/;` line:

  ```sh
  # Build the masked copy BEFORE the newline substitution, so a newline inside a quoted
  # region can never become a command-position anchor. [BUG-043].
  _G3_MASK=$(_g3_scan "mask" "$_G3_PRE")

  # Normalise real newlines to semicolons (simplifies all pattern regexes)
  _G3_PRE="${_G3_PRE//$'\n'/;}"
  _G3_MASK="${_G3_MASK//$'\n'/;}"
  ```

- [ ] [T-003-E] Swap the argument at eleven of the thirteen call sites from `"$_G3_PRE"` to `"$_G3_MASK"`. **P6 and P12 keep `"$_G3_PRE"`**, and the allowlist call keeps it too. Put the boundary in one readable place directly above the block:

  ```sh
  # Exactly two checks read quoted content BY DESIGN and therefore receive the UNMASKED
  # string: P6 reads the grep pattern, P12 reads the alias value. Every other check reads
  # code, and receives the mask. The allowlist also reads the unmasked string. [BUG-043].
  ```

- [ ] [T-003-F] Run the suite. **Expected: 884 passed, 9 failed, 12 skipped**, all nine in `tests/hooks/guard3.test.js`, being the four inherited rows, the four shape rows and the fragment row. **A tenth failure, or any failure in `tests/hooks/guard3-port.test.js`, halts the task.**
- [ ] [T-003-G] Stage `git add -u "tests/fixtures/guard3-reference.sh"` and commit. If the gate blocks, apply the single authorized bypass under AC12's inheritance: suite run already done at T-003-F, its verbatim failure list pasted into the commit body, `git commit --no-verify -F <scratchpad>/msg-t003.txt`, subject `feat: mask quoted argv before the code-reading checks [BUG-043]`. The header's sanctioned-exception list gains a **fourth** entry describing the mask mode, in this same commit.

---

### Task 4: the port, its mirror, and the flips

**Files:** modify `.claude/hooks/pre-tool-use.mjs`, `project-template/.claude/hooks/pre-tool-use.mjs`, `tests/fixtures/guard3-corpus.js`

- [ ] [T-004-A] Add the mirrored `mask` mode to `g3Scan`. Unquoted branches emit unchanged in both modes; quoted branches emit `x`; quote characters and openers are always themselves; a backslash pair inside quotes emits `xx`:

  ```js
  function g3Scan(mode, input) {
    const emit = mode === 'strip' || mode === 'mask';
    let state = 'UNQUOTED';
    let result = '';
    let i = 0;
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
        else if (ch === '#' && mode === 'strip') { while (i < len && input[i] !== '\n') i += 1; }
        else {
          if (mode === 'glob' && (ch === '*' || ch === '?' || ch === '{' || ch === '[')) return { glob: true };
          if (emit) result += ch;
          i += 1;
        }
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
    if (state !== 'UNQUOTED') return emit ? { result, malformed: true } : { glob: true };
    return emit ? { result, malformed: false } : { glob: false };
  }
  ```

- [ ] [T-004-B] Rewrite the dispatch in `guard3BashScan` so the mask is built from the stripped string, before the join, and the boundary is one readable fact:

  ```js
    // The mask is built from the STRIPPED string and BEFORE the newline join, so a
    // newline inside a quoted region can never become a command-position anchor.
    // Exactly two checks read quoted content BY DESIGN: P6 reads the grep pattern and
    // P12 reads the alias value. Everything else reads code and gets the mask. The
    // allowlist reads the unmasked string. [BUG-043].
    const chomped = g3Chomp(scan.result);
    const pre = chomped.split('\n').join(';');
    const masked = g3Scan('mask', chomped).result.split('\n').join(';');
    const UNMASKED_CHECKS = new Set(['P6', 'P12']);
    const ids = [];
    for (const { id, check } of G3_CHECKS) if (check(UNMASKED_CHECKS.has(id) ? pre : masked)) ids.push(id);
  ```

  Delete the old `const pre = ...` and `const ids = [];` lines the block replaces, and leave `g3AllowlistCovers(pre, ...)` untouched.

- [ ] [T-004-C] Apply the identical two edits to `project-template/.claude/hooks/pre-tool-use.mjs`, then verify byte identity with a direct comparison of the two members. **This step exists because BUG-041's tripwire fired on exactly this omission.**
- [ ] [T-004-D] Run the suite. **Expected: 875 passed, 18 failed**, nine per suite, the same nine labels in each. **Declared red state 2.** Do not commit.
- [ ] [T-004-E] Flip the four inherited rows to `verdict: 'allow'`: `KNOWN-FP P9-1`, `KNOWN-FP OBF`, `KNOWN-FP P5`, `KNOWN-FP P9 for-of`.
- [ ] [T-004-F] Flip the four shape rows and the fragment-parity row to `verdict: 'allow'`.
- [ ] [T-004-G] Rewrite the two comment blocks so they describe a corrected contract rather than a tolerated defect: the mechanism-2 block states that the mask landed and names the four accidental consumers in the past tense; the fragment-parity block states that masking removed the content the inversion was misreading.
- [ ] [T-004-H] Run the suite. **Expected: 893 passed, 12 skipped, 0 failed.**
- [ ] [T-004-I] Stage and commit all four tracked files: `git add -u ".claude/hooks/pre-tool-use.mjs" "project-template/.claude/hooks/pre-tool-use.mjs" "tests/fixtures/guard3-corpus.js"`. Subject `fix: carry the mask into the port and flip the nine rows [BUG-043]`.

---

### Task 5: the contract tests

**Files:** modify `tests/hooks/guard3-port.test.js`

Four tests, all in one file so a reader sees the differential's two halves together. They pin what no behavioral test can reach, and each one states why in its comment.

- [ ] [T-005-A] The port's mask contract:

  ```js
  // What these assert cannot be observed from a verdict: the hook exports nothing and
  // runs main() at load, so the masked copy is unreachable. These pin the contract in
  // the source, the way templates.test.js pins the character-class trap. [BUG-043].
  it('builds the mask from the stripped string, before the newline join', () => {
    const src = readFileSync(HOOK, 'utf8');
    expect(src).toContain("const chomped = g3Chomp(scan.result);");
    expect(src).toContain("const masked = g3Scan('mask', chomped).result.split('\\n').join(';');");
  });
  ```

- [ ] [T-005-B] The port's mask shape, covering length preservation and quote survival:

  ```js
  // AC8 has NO behavioral discriminator: a variant emitting one character per escaped
  // pair agreed with the correct mask on all 124 corpus rows and four constructed cases,
  // because the masked string is consumed alone and never compared offset-wise with the
  // unmasked one. So length preservation is pinned textually and nowhere else, and this
  // comment records that honestly. AC9 is different: it has a measured discriminator,
  // the corpus row c'a't, which turns green if quote characters stop surviving.
  it('emits one mask character per input character and keeps the quote characters', () => {
    const src = readFileSync(HOOK, 'utf8');
    expect(src).toContain("result += 'xx'");
    expect(src).toContain("result += ch === \"'\" ? ch : 'x'");
    expect(src).not.toContain("mask') result += 'x'; i += 2");
  });
  ```

- [ ] [T-005-C] The authority's mirror of both contracts:

  ```js
  it('keeps the authority on the same mask contract', () => {
    const src = readFileSync(join(REPO_ROOT, 'tests/fixtures/guard3-reference.sh'), 'utf8');
    expect(src).toContain('_G3_MASK=$(_g3_scan "mask" "$_G3_PRE")');
    expect(src).toContain('_G3_MASK="${_G3_MASK//$\'\\n\'/;}"');
    expect(src).toContain('result+="xx"');
    expect(src.indexOf('_G3_MASK=$(_g3_scan "mask"')).toBeLessThan(src.indexOf('_G3_PRE="${_G3_PRE//$\'\\n\'/;}"'));
  });
  ```

  The final assertion is the ordering pin: the mask call appears before the newline substitution in the file, which is the one place that order is visible.

- [ ] [T-005-D] The dispatch boundary, both subjects, as a counted fact rather than a comment:

  ```js
  // AC10: the by-design boundary is one readable fact per subject. In the port it is a
  // Set; in the authority it is the count of call sites reading each variable, which is
  // what makes a silent drift to a twelfth masked check impossible to miss.
  it('gives exactly two checks the unmasked string in both subjects', () => {
    const port = readFileSync(HOOK, 'utf8');
    expect(port).toContain("const UNMASKED_CHECKS = new Set(['P6', 'P12']);");
    expect(port).toContain('g3AllowlistCovers(pre,');
    const ref = readFileSync(join(REPO_ROOT, 'tests/fixtures/guard3-reference.sh'), 'utf8');
    const callSites = ref.split('\n').filter(l => /^\s*_g3_(p[0-9]+|obfuscation)[a-z_0-9]*\s+"\$_G3_(PRE|MASK)"/.test(l));
    expect(callSites).toHaveLength(13);
    expect(callSites.filter(l => l.includes('_G3_PRE'))).toHaveLength(2);
    expect(callSites.filter(l => l.includes('_G3_MASK'))).toHaveLength(11);
  });
  ```

- [ ] [T-005-E] Run the suite. **Expected: 897 passed, 12 skipped, 0 failed.**
- [ ] [T-005-F] Stage `git add -u "tests/hooks/guard3-port.test.js"` and commit with subject `test: pin the mask contract in both subjects [BUG-043]`.

---

### Task 6: the record and the release

- [ ] [T-006-A] Add the **amendment note** to `[BUG-043]`'s backlog entry, leaving its original wording in place: the entry priced this as "a second five-state scanner written in bash for the authority", and reading `_g3_scan` disproved it, since the scanner exists, tracks all five states and takes a mode parameter. The fix was a third mode plus a dispatch-level argument swap.
- [ ] [T-006-B] Close the `[BUG-043]` entry with what shipped and what was left: the mask, ten rows, nine flips, the fragment-parity residual resolved as a side effect of sharing the seam, and the heredoc family still out and still unfiled.
- [ ] [T-006-C] Add the allowlist finding to `[BUG-044]`'s entry: `G3_BD` bounds an entry with `[ \t\n\r\f\v|;()]` or start-of-string, so a quoted path never matched an allowlist entry, before or after this change. The escape hatch nobody reached for would not have worked for a quoted path either.
- [ ] [T-006-D] Run `npm version 1.31.3 --no-git-tag-version`, then `printf '1.31.3\n' > VERSION`, then add the `CHANGELOG.md` entry under `## [1.31.3]`.
- [ ] [T-006-E] Run `node <scratchpad>/version-gate.mjs 1.31.3` and confirm all five locations agree.
- [ ] [T-006-F] Append the implementation record to `.claude/memory/project.md`, including **both queued convention lines**: an AC that asserts a property of an internal value must name its observation point at spec time or be written as contract-plus-discriminator from the start; and a discriminator is confirmed by building the defect it claims to catch and scoring it against the full corpus, because a discriminator never seen to fail is an assumption wearing a test's name.
- [ ] [T-006-G] Run the suite a final time and confirm **897 passed, 12 skipped, 0 failed**.
- [ ] [T-006-H] Stage and commit: `git add -u "AGENT-READABLE BACKLOG.md" VERSION package.json package-lock.json CHANGELOG.md ".claude/memory/project.md"`, subject `chore: release 1.31.3 [BUG-043]`.

---

## Test List

- [ ] [T-100] Ten rows added, each asserting its measured pre-fix verdict (T-002-A through T-002-D)
- [ ] [T-101] Nine rows flip to allow, arbitrated in both suites (T-004-E, T-004-F)
- [ ] [T-102] The seven P6/P12 true positives never move (every boundary run)
- [ ] [T-103] Both P9 controls never move (every boundary run)
- [ ] [T-104] `c'a't` still denies, which is AC9's measured guard (every boundary run)
- [ ] [T-105] The mask is built from the stripped string, before the join (T-005-A, T-005-C)
- [ ] [T-106] One mask character per input character, quote characters kept (T-005-B, T-005-C)
- [ ] [T-107] Exactly two checks read the unmasked string, counted in both subjects (T-005-D)
- [ ] [T-108] `EXCEPTIONS` still has exactly one member (existing test, green throughout)
- [ ] [T-109] The mirrored pair stays byte-identical (existing test, green from T-004-C)

## Commit Order

1. **T-000-B** the plan. Green.
2. **T-002-H** the acceptance rows. Green at 893.
3. **T-003-G** the authority alone. **Red by design: 9 failures, authority suite only.** Bypass under AC12 if the gate blocks.
4. **T-004-I** the port, the mirror and the flips. Green at 893.
5. **T-005-F** the contract tests. Green at 897.
6. **T-006-H** the record and the release. Green.

## Identified Risks

**Risk 1. The bash mask mode behaves differently inside the real file than in a fragment.** T-001-F runs the edits in a full copy of the real file under `LC_ALL=C`, including `c'a't` as AC9's guard, before the frozen file is touched.

**Risk 2. A widened emit guard shortens the output.** The `#` comment branch stays on `strip` alone. T-003-B names it explicitly, and T-005-B asserts the escaped pair still emits two characters.

**Risk 3. The mirror is forgotten again.** T-004-C is its own step with its own byte comparison, and `templates.test.js` fails loudly at T-004-D otherwise. BUG-041's tripwire is the reason this is a step and not a clause.

**Risk 4. The corpus-length assertion is not moved with the rows.** T-002-E is in the same task and the same commit group. Skipping it puts exactly one failure above every later prediction.

**Risk 5. A masked fragment still inverts quote parity.** Masking removes the content that inversion misreads, which is why the residual flips, but the surviving quote characters can still unbalance a fragment. The corpus row added at T-002-C arbitrates the measured shape. **If T-004-D shows a tenth failure that is a P4 or P7 row, that is a second parity shape and it gets its own row before the flips**, per the spec's instruction.

**Risk 6. Bash pays a second character-by-character pass.** Inputs are capped at 8192 and the authority suite already runs a 8193-char row. If T-003-F's wall-clock rises by more than half, report it with the number rather than absorbing it.

**Risk 7. The predicted counts are wrong because the AC set grew after they were stated.** They were: the table above supersedes 873 to 889 with 873 to 897, and the cause is ten rows instead of seven plus four contract tests instead of two. Any further deviation is a tripwire halt.
