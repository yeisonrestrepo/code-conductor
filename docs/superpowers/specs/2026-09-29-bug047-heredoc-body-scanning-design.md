# [BUG-047] Guard 3 Scans Heredoc Bodies as Command Text

**Status:** spec, awaiting approval
**Date:** 2026-09-29
**Backlog entry:** `AGENT-READABLE BACKLOG.md`, `### [ ] [BUG-047]`
**Ceiling at filing:** `BUG-047`, both legs heading-scoped, 47 headings on the working tree and on `origin/main`, no duplicate ids. Next mintable id is `BUG-048`. This spec mints nothing.

---

## Problem

Guard 3 exists to catch **mass content dumps**: commands that flood the context by reading many files. It reads a heredoc body as command text, so content being **written** is judged by patterns written to catch **reads**.

### The load-bearing sentence

**A heredoc body is content being written, and it is already inside the command string the scanner is holding. It cannot flood anything, and no dump shape uses one.** That is the whole argument, and it is measured rather than asserted: `cat <<EOF` with no redirect, the purest "dump wearing heredoc clothes", reads zero files and allows today on a prose body.

### The four specimens, across four consecutive sessions

1. **Read-shaped, 2026-09-28** (`[BUG-041]`'s session). `cat >> tests/installer/templates.test.js <<'JSEOF'`, denied **P4**. The body's `[` characters are read as unquoted globs.
2. **Write-shaped, 2026-09-28** (`[BUG-044]`'s spec approval). A commit-message file, `cat > <scratchpad>/msg-spec-044.txt <<'EOF'`, prose body whose first line ends `[BUG-044]`, denied **P4**. Routed around with the Write tool; the hook was not bypassed and the text landed unchanged.
3. **Script-shaped, 2026-09-28** (`[BUG-042]`'s audit). A `.mjs` audit script via `cat > <path> <<'MJS'`, denied **P4 P5 P9 at once**. First specimen showing the family crosses pattern boundaries.
4. **Script-shaped, 2026-09-29** (`[BUG-046]`'s audit). A `.mjs` probe via `cat > .../ceiling-046.mjs <<'SCRIPT'`, denied **P4 P5 P9 at once**, on a body whose only offenses are a character class in a regex, a `?? 0` and a `.forEach`.

**Specimen 2's reconstruction is not byte-faithful and is marked so.** The audit's rebuild carries one apostrophe and dies at the strip gate; the transcript records P4, so the original must have carried an even count. That mismatch is what exposed the third mechanism below, so the imperfect reconstruction earned its keep.

### Priority evidence: the platform instructs the shape this repository forbids

This session's auto-mode guidance states, verbatim, to make file changes "with sed, heredocs, or short scripts, rather than using the dedicated Read, Edit, or Write tools." Guard 3 denies any heredoc whose body carries a bracket class.

**Two sets of instructions bind at once and contradict each other.** Every agent operating here under that guidance will generate the denial, route around it, and spend the tokens again, which is why four specimens arrived across four consecutive sessions without anyone looking for them. **The remedy's value is not the friction of one denial; it is the removal of a standing contradiction.** The success measure is stated in the acceptance criteria as that conflict dissolving.

### Three denial mechanisms, not one

| body contains | verdict | gate |
|---|---|---|
| a glob metacharacter (`[`, `?`) | deny | **PATTERN** P4 |
| a command substitution or backtick | deny | **PATTERN** P5 |
| `for ... of` text | deny | **PATTERN** P4 P9 |
| an **odd** number of quote characters | deny | **STRIP**, fail-closed malformed |
| an even number of quote characters, nothing else | allow | none |
| plain prose | allow | none |

The third row of that table is new to this audit. **Two of the four specimens die at the strip gate, not at a pattern check**, and that changes where the remedy can live.

---

## Evidence

Measured 2026-09-29 against the tree at `1.32.2`. The harness is described under Conventions below, because it failed once and the way it failed is itself a finding.

### The authority question, closed

Neither subject has a heredoc state. `_g3_scan` and `g3Scan` both track exactly five: `UNQUOTED`, `SINGLE_QUOTED`, `DOUBLE_QUOTED`, `ANSI_C_QUOTED`, `LOCALE_QUOTED`. **`<<` is not a token to either.**

```
authority  <<'EOF' -> deny/pattern P4   |   <<EOF -> deny/pattern P4
port       <<'EOF' -> deny/pattern P4   |   <<EOF -> deny/pattern P4
authority distinguishes quoted from unquoted delimiter: false
port distinguishes quoted from unquoted delimiter:      false
```

**The answer is stronger than "the authority agrees with the port."** In `<<'EOF'` the quotes open and close an ordinary single-quoted region around the word `EOF`, leaving the body in `UNQUOTED` exactly as `<<EOF` does. The two forms are not merely undistinguished: **there is nothing to distinguish with.** The gap is a missing concept, not a missing branch, which is why the remedy is a new state rather than a new condition.

### Differential agreement: 17 of 17

The full matrix, over the four specimens, the delimiter pair, three controls and seven new probes, shows **no disagreement between authority and port on any row**. Heredoc handling introduces no new divergence, and the single sanctioned divergence stays at exactly one **until this item's own authority edit lands**, at which point the port is deliberately one commit behind for the length of that commit.

```
S1 read-shaped, BUG-041 session         deny/pattern P4      deny/pattern P4      yes
S2 write-shaped, BUG-044 (constructed)  deny/malformed       deny/malformed       yes
S3 mjs script, BUG-042 audit            deny/pattern P4      deny/pattern P4      yes
S4 mjs script, BUG-046 audit            deny/pattern P4 P9   deny/pattern P4 P9   yes
B1 quoted delimiter, [ in body          deny/pattern P4      deny/pattern P4      yes
B2 UNQUOTED delimiter, [ in body        deny/pattern P4      deny/pattern P4      yes
B3 quoted delimiter, ? in body          deny/pattern P4      deny/pattern P4      yes
C1 tee instead of cat                   allow                allow                yes
C2 cat with no heredoc at all           allow                allow                yes
C3 plain prose body                     allow                allow                yes
N1 odd apostrophe count in body         deny/malformed       deny/malformed       yes
N2 cat <<EOF, no redirect               deny/pattern P4      deny/pattern P4      yes
N3 hash in body                         allow                allow                yes
N4 body past the 8192 cap               deny/length          deny/length          yes
N5 python heredoc, non-cat reader       allow                allow                yes
N6 for-loop text inside body            deny/pattern P4 P9   deny/pattern P4 P9   yes
N7 command substitution inside body     deny/pattern P5      deny/pattern P5      yes
```

`C1` and `N5` together pin the boundary the dossier named: **P4 requires a reader at command position.** `tee` and `python3` both allow with identical bodies, so the denial is reached through the reader, not through the redirection.

### The consumer matrix, and a refuted prediction

Reading the authority's dispatch: **11 checks receive `_G3_MASK`** (P1, P2, P3, P4, P5, P7, P8, P9, P10, P11, OBF); **P6 and P12 receive the unmasked `_G3_PRE` by design**, because P6 reads a real grep pattern and P12 a real alias value; the allowlist also reads `_G3_PRE`.

**Predicted: no check reads heredoc content by design, so the fix has no frontier. Measured: refuted.**

```
P6 shape inside a heredoc body only    deny    P6
P6 shape as real code, control         deny    P6
P12 shape inside a heredoc body only   allow
P12 shape as real code, control        allow
```

P6 cannot tell a grep pattern from prose that looks like one, so it fires on written content. **The consequence is concrete and determines the seam:** blanking only the mask leaves P6 denying file writes, so the blanking must land in `_G3_PRE`. Because the mask is built from `_G3_PRE`, one pass there propagates to all thirteen checks and the allowlist.

### Scope holds today and must hold after

```
genuine dump AFTER a heredoc write     deny    P4
genuine dump BEFORE a heredoc write    deny    P4
```

---

## Solution

`_g3_scan` and `g3Scan` gain a **sixth state, `HEREDOC`**, entered on a heredoc introducer and left on the terminator line. While in that state every character is emitted **blanked and length-preserved** in both `strip` and `mask` modes, and **no character feeds quote-parity tracking**, so the body can neither trip a pattern check nor unbalance the malformed computation.

Because the mask is built from the stripped output, one state in one pass reaches every consumer.

### Recognition

Entered at `<<` optionally followed by `-`, then an optional quote, then a word, then an optional matching quote. The delimiter word is captured; quoting of the delimiter is **recorded and then ignored**, because the two forms behave identically in the shell for the purposes of this scanner, which is not performing expansion.

Left at the first subsequent line whose content equals the captured word. With `<<-` a leading run of tabs is allowed before the word, matching the shell.

An unterminated heredoc, meaning end of input while still in `HEREDOC`, is **not** malformed: the body simply ends. This is a deliberate departure from the other five states, where a non-`UNQUOTED` end-of-input is fail-closed, and the full reasoning belongs here so the asymmetry is never "fixed" into a regression.

**The fail-closed rule exists because an unbalanced quote leaves ambiguity about what is code.** The scanner cannot know where command text resumes after an unclosed quote, so it refuses to guess and denies. That premise is the whole justification for the rule.

**An unterminated heredoc leaves no such ambiguity.** Everything from the introducer to end of input is body, and nothing after it is command, because there is no "after". There is no unread region to protect, so the premise that justifies fail-closed does not hold.

**Bash agrees, measured rather than assumed.** A script ending mid-heredoc proceeds, treating end of input as the delimiter: on the bash this repository's authority actually runs under, GNU bash 3.2.57 on macOS, the body is delivered and the shell exits 0 with **no warning on stderr**. Newer bash emits a warning and still proceeds. The load-bearing half is "proceeds", and it holds on the interpreter that matters here.

**And fail-closed would be this item's own defect in a new state**, denying every draft of a file write whose delimiter line has not arrived yet.

**The departure from the pattern is correct precisely because the pattern's premise, unread ambiguity, does not apply.** Do not normalize this branch to match the other five.

### Why length-preserved

`g3P7PagerGlob` walks with `after = rest.slice(m[0].length)`, slicing by match length rather than match index. That quirk is preserved authority behavior. **Blanking that changed the body's length would desynchronize that walk**, so the blank is character-for-character.

---

## Behavior

### Main path

An agent writes a file with `cat > path <<'EOF'`, a body containing brackets, regexes, command substitutions, `for` loops or apostrophes, and the terminator. The scanner enters `HEREDOC` at the introducer, blanks the body, leaves at the terminator, and the surrounding command is scanned normally. **Allowed.** The platform's guidance and this repository's hook stop contradicting each other.

### Alternative paths

**`<<-EOF` with tab-indented terminator.** Recognized; a leading tab run before the terminator word is allowed.

**Two heredocs in one command.** Each is entered and left independently; the second introducer is only recognized once the first has terminated.

**A heredoc inside a quoted region.** The introducer is not recognized, because `<<` inside `SINGLE_QUOTED` or `DOUBLE_QUOTED` is ordinary text. The existing states win.

**`cat <<EOF` with no redirect.** Allowed on any body. **Ruled and recorded so it is never re-proposed:** it reads zero files, so it is not a dump. Today's behavior, allowing on prose and denying only when the body carries a metacharacter, **is the defect** rather than a feature worth preserving.

**A genuine dump beside a heredoc.** Still denied. The skip is scoped to the body, never to the command.

### Error cases

**An unterminated heredoc.** Body blanked to end of input, no malformed denial. Named above with its reasoning.

**A body pushing the command past 8192 characters.** Still denied at the length cap, which fires **before** any scanning. Unchanged and deliberately so: the cap is about the scanner's own bounds, not about dumps.

**A terminator word that never appears because the body was truncated upstream.** Identical to an unterminated heredoc.

---

## Acceptance Criteria

- [ ] **AC1.** Both scanners gain a sixth state, `HEREDOC`, entered on `<<` with an optional `-`, an optional quote, a word, and an optional matching quote.
- [ ] **AC2.** The state is left at the first subsequent line equal to the captured delimiter word, with a leading tab run permitted after `<<-`.
- [ ] **AC3.** `<<'EOF'` and `<<EOF` behave identically, and a test asserts it directly rather than by inference.
- [ ] **AC4.** Body characters are emitted blanked and **length-preserved** in both `strip` and `mask` modes, and a test pins the length equality.
- [ ] **AC5.** Body characters do not feed quote-parity tracking, so an odd number of quote characters in a body no longer produces a malformed denial.
- [ ] **AC6.** The blanking lands in `_G3_PRE`, so all thirteen checks and the allowlist see the blanked body. A test asserts P6 specifically, since P6 reads unmasked by design.
- [ ] **AC7.** An introducer inside `SINGLE_QUOTED`, `DOUBLE_QUOTED`, `ANSI_C_QUOTED` or `LOCALE_QUOTED` is not recognized.
- [ ] **AC8.** Two heredocs in one command are each recognized and terminated independently.
- [ ] **AC9.** An unterminated heredoc blanks to end of input and does **not** deny as malformed, with the reasoning recorded at the line.
- [ ] **AC10.** Specimen 1 allows: `cat >> <path> <<'JSEOF'` with a bracketed body.
- [ ] **AC11.** Specimen 2 allows, in both its constructed odd-apostrophe form and an even-apostrophe form.
- [ ] **AC12.** Specimens 3 and 4 allow, including their `P5` and `P9` crossings.
- [ ] **AC13.** A genuine dump **after** a heredoc write still denies P4.
- [ ] **AC14.** A genuine dump **before** a heredoc write still denies P4.
- [ ] **AC15.** `cat <<EOF` with no redirect allows on any body, with the reasoning recorded so it is not re-proposed.
- [ ] **AC16.** A body pushing the command past 8192 characters still denies at the length cap.
- [ ] **AC17.** The P6 real-code control still denies, pinning the frontier the P6 flip creates.
- [ ] **AC18.** The corpus gains the four specimens verbatim where a transcript exists and **marked constructed** where not, with specimen 2's caveat in its row comment.
- [ ] **AC19.** The corpus gains the three new rows: odd-quote malformed, P6-inside-body, and the dump-adjacent scope control **in both positions**.
- [ ] **AC20.** Every new corpus row carries its **predicted post-fix verdict in a comment, written before either subject changes**.
- [ ] **AC21.** Authority and port agree on every corpus row after the change, asserted as a count the way `[BUG-043]` asserted its thirteen call sites.
- [ ] **AC22.** `.claude/hooks/pre-tool-use.mjs` and `project-template/.claude/hooks/pre-tool-use.mjs` remain byte-identical, which `tests/installer/templates.test.js` already asserts.
- [ ] **AC23.** The authority edit lands **alone**, as the sixth sanctioned exception, with its header amended in the same commit per the ritual.
- [ ] **AC24.** The success measure is asserted, not narrated: a heredoc file write whose body carries arbitrary content passes in both subjects, which is the harness conflict dissolving.

---

## Conventions this audit establishes

**A probe harness runs its controls before printing any matrix, and refuses to print on control failure.** This audit's first harness reported `allow` on all fifteen rows, including `cat *.ts`, because `CLAUDE_TOOL_INPUT` carries the `tool_input` object alone rather than the whole payload and `CLAUDE_TOOL_NAME` is a separate variable that was omitted, so dispatch never reached the Bash guard. **An all-allow matrix from a broken harness is indistinguishable from a real finding**, which is the registry's own class applied to a measuring instrument. The harness now asserts a known deny and a known allow first and exits non-zero without printing if either fails.

---

## Out of Scope

- **`[BUG-045]`**, the quoted-path allowlist defect. Untouched. The allowlist is not this item.
- **Widening or narrowing any pattern.** No pattern regex changes; only what text reaches them does.
- **The 8192 length cap.** It fires before scanning and stays as it is.
- **The P7 walk quirk.** Preserved, and the reason the blanking is length-preserved.
- **Heredoc expansion semantics.** The scanner does not expand, so the quoted-delimiter distinction is recorded and ignored rather than implemented.

---

## System Impact

**Modified:** `tests/fixtures/guard3-reference.sh` (`_g3_scan`, the frozen authority, **its own commit**), `.claude/hooks/pre-tool-use.mjs` and `project-template/.claude/hooks/pre-tool-use.mjs` (`g3Scan`, the byte-identical mirror pair), `tests/fixtures/guard3-corpus.js` (new rows), `CHANGELOG.md`, `VERSION`, `package.json`, `package-lock.json`, `AGENT-READABLE BACKLOG.md`, `.claude/memory/project.md`.

**The mirror pair is a hard constraint.** `tests/installer/templates.test.js` asserts the two hook files are byte-identical; any edit lands in both in one commit.

**Version: RULED MINOR, `1.33.0`, 2026-09-29**, by the ratified test applied exactly as the `[BUG-042]` worked example prescribes. `project-template/.claude/hooks/pre-tool-use.mjs` changes, so **a fresh install differs**, which is the line PATCH requires not crossing. No further argument is needed at plan approval; cite this.

### Files Requiring Full Read (deferred to `/cc-plan`)

- `tests/fixtures/guard3-reference.sh` `_g3_scan`, lines 93 to 175. Read in outline during the audit; the sixth state is an edit inside its state machine and needs the full body.
- `.claude/hooks/pre-tool-use.mjs` `g3Scan`, lines 154 to 200, for the same reason.
- `tests/fixtures/guard3-corpus.js`, for the row shape and the count assertions AC21 extends.

---

## Complexity Estimate

**M.** One new state in two mirrored scanners, with the semantics already settled by measurement and the corpus rows already drafted as probes. The weight is in the ritual rather than the code: an edit to the frozen authority is the sixth sanctioned exception, lands alone, and carries a declared red while the port is deliberately one commit behind.
