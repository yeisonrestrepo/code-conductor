# BUG-043: Guard 3 reads quoted argv text as code

**Status:** awaiting approval
**Filed as:** `[BUG-043]` in `AGENT-READABLE BACKLOG.md`
**Subjects:** `tests/fixtures/guard3-reference.sh` (authority), `.claude/hooks/pre-tool-use.mjs` and its byte-identical mirror `project-template/.claude/hooks/pre-tool-use.mjs` (port), `tests/fixtures/guard3-corpus.js` (shared corpus)
**Audit:** `scratchpad/bug043-audit-and-gates.md`, both gates ruled before this was written

---

## Problem

`guard3BashScan` builds one preprocessed string and hands it to all thirteen checks. `g3Scan` walks that string with a five-state quote machine, knows the state at every character, and then returns a plain string that remembers none of it. **Quoted argv text is therefore analyzed as if it were code.**

The port loses the state at `pre-tool-use.mjs:445-456`; the authority loses it at `guard3-reference.sh:433-460`. The seam is the same shape in both: one variable, one dispatch.

### Four accidental consumers, each with a verbatim specimen

BUG-041's spec named three. The audit found a fourth.

| check | what it mistakes quoted text for | specimen |
|---|---|---|
| **P9** | a shell loop | three distinct sub-shapes, below |
| **OBF** | quoting used as evasion | a backslash run inside a quoted regex, in `grep -E`, `perl -0pi -e` and `node -e` hosts |
| **P5** | a command substitution | a backslash-escaped backtick inside a double-quoted grep pattern |
| **P11** | the bash dot operator | **English sentence punctuation.** `did not. Apply the identical two edits` inside a quoted JS string puts a period-and-space at what `G3_POS` reads as command position |

**P9 has three sub-shapes, not one.** Prose (a commit-message body line beginning with "for"), code (`for (const x of ...)` inside a quoted `node -e` program), and **regex**: an alternation containing `for pat` inside a double-quoted grep pattern. The third denied this audit while it was mapping the file the fix will edit.

P11 and the regex sub-shape are premise corrections to BUG-041's spec. **That spec is not edited.** It stands as the knowledge of its day; the corrections live here.

### Two further consumers inherit the defect through a fragment

P4 and P7 hand `g3Scan('glob', after)` a **fragment** of the preprocessed string. The fragment is scanned starting in `UNQUOTED` regardless of the state it actually begins in, so every quote in it is parity-inverted and an unquoted `?` from a `$?` reads as a glob. BUG-041 named this residual and deferred it, with the scope fence that it is in scope here **only if it shares the seam**. The measurement below says it does.

### The filing's own premise was wrong, and the correction is recorded

`[BUG-043]`'s backlog entry prices this work as needing "a second five-state scanner written in bash for the authority." **Reading `_g3_scan` at `guard3-reference.sh:82-158` disproves it.** That scanner exists, tracks all five states, and already takes a `mode` parameter whose per-state guards are the only thing that changes. The real cost is a third mode plus a dispatch-level argument swap, identical in both subjects. The entry keeps its original wording with an amendment note above it, the same discipline BUG-038's who-writes correction used: **the filing's error stays visible with the audit's sharpening on top of it.**

---

## Solution

Add a third mode to the existing scanner in both subjects. It emits a length-preserved copy of the preprocessed string in which every character inside a quoted span is replaced by `x`, with the quote characters themselves kept, so offsets and command-position anchors are unchanged. The dispatch then hands the masked copy to every check **except P6 and P12**, which read quoted content by design.

**The mask is applied before the newline-to-semicolon join**, so a newline inside a quoted region never becomes a command anchor. Both subjects use that order.

### Why the boundary is P6 and P12, and not a list of specimens

The consumer matrix classifies each of the thirteen checks by what it is **for**:

| classification | checks | evidence |
|---|---|---|
| **reads quoted content BY DESIGN** | **P6, P12** | P6 reads the grep pattern, P12 reads the alias value. 4 corpus rows plus 1 dialect row for P6; 2 rows for P12 |
| reads it **by accident** | P5, P9, P11, OBF, and P4/P7 via the fragment | 22 measured denials |
| does not read it at all | P1, P2, P3, P8, P10 | tokens and flags are unquoted in every row; masking moves nothing |

Two candidate boundaries were built and scored:

| candidate | masks | denials flipped | corpus rows moved | frontier moved |
|---|---|---|---|---|
| **A, by-design boundary** | everything except P6, P12 | **22 of 26** | 4 | **0** |
| B, specimen boundary | P5, P9, OBF, P11 only | 19 of 26 | 4 | **0** |

**A is chosen because its boundary falls out of what the checks are for, while B's falls out of a specimen list that grows every session.** A boundary derived from purpose is stable under new specimens; one derived from history chases them forever. P11 is the proof: it was not in B's list until this audit found it, and it would have needed another release to add.

The three denials A fixes that B does not are exactly the P4/P7 fragment quote-parity cases, including the residual BUG-041 named by hand. **The scope fence's test returns yes: the residual shares the seam, so it is in scope at zero marginal cost.** This is the fence working, not scope growth.

---

## Behavior

### Main path

1. A `Bash` call arrives. `g3Scan('strip', ...)` runs exactly as today and reports malformed input exactly as today.
2. The new mode produces `masked`, the same length as the stripped string, quote characters preserved, every character inside a quoted span replaced by `x`.
3. The newline-to-semicolon join is applied to both strings, so a newline inside a quoted region is already `x` and never becomes `;`.
4. P6 and P12 receive the unmasked string. Every other check receives `masked`.
5. A denial reports the same pattern ids in the same format. The allowlist is consulted against the unmasked string, unchanged.

### Alternative paths

- **A genuine shell loop still denies.** `for f in *.ts`, `while true`, `until false` and the two control rows are unquoted, so the mask does not touch them.
- **A genuine match-all grep still denies.** P6 never receives the masked string.
- **A genuine aliased reader still denies.** P12 never receives the masked string, quoted value or not.
- **Real obfuscation still denies.** `c'a't` and a `$"cat"` prefix are visible in the masked skeleton because the quote characters are preserved.
- **A quoted glob is already handled** by `g3Scan('glob', ...)` and is unaffected.

### Error cases

- **Unterminated quote.** Unchanged: strip mode reports malformed and the guard denies before any check runs, so no mask is ever built from malformed input.
- **Over the length cap.** Unchanged, denied before the scan.
- **The mask and the stripped string fall out of alignment.** Structurally impossible by construction, since the mask is emitted by the same walk over the same input with one character out per character in. An AC asserts equal lengths.

---

## Acceptance Criteria

### The frontier, pinned before anything moves

- [ ] **AC1.** The seven P6/P12 true positives show **zero movement**: `grep -r '.*' .`, `git grep '.*'`, `grep -r -e foo -e '.*' .`, `wc -l $(grep -r '.*' .)`, the P6 dialect row, `alias c=cat`, `alias g=grep`. All seven still deny, asserted by their existing corpus rows, and a test run records them green at every intermediate boundary.
- [ ] **AC2.** **One MASK-DESIGN row per frontier check**, added so the by-design classification is guarded by the oracle rather than by a matrix in a document:
  - **P6:** `grep -r -e '.*' "src dir"`, `deny`. If P6 ever received the masked string, `'.*'` would become `'xx'`, the match-all test would fail and this would allow.
  - **P12:** `alias t='tail -50'`, `deny`. **This row closes a real hole:** both existing P12 rows use unquoted values (`alias c=cat`, `alias g=grep`) and would survive a mistaken mask unchanged, so nothing in the corpus currently discriminates P12's classification.
  Both rows deny before the fix and after it.
- [ ] **AC2-B.** **The allowlist frontier, restated to what is true.** The approved wording asked for a row asserting that an allowlisted path appearing inside quotes still matches. **Measured: it does not, and it never did.** `G3_BD` bounds an allowlist entry with `[ \t\n\r\f\v|;()]` or start-of-string, and a double quote is in neither set, so `cat "docs/x.md" *.md` with entry `docs/` denies today, before any mask exists. A row asserting `allow` would assert a behavior the guard has never had. What this AC pins instead is the true fact: **the allowlist consults the unmasked string**, asserted by a textual contract line in both subjects, with the honest note that feeding it the masked string would also change no measured verdict, since unquoted entries are untouched by the mask and quoted ones never matched. **The gap itself is a finding for `[BUG-044]`:** the escape hatch nobody reached for would not have worked for a quoted path either, which belongs beside that item's zero-uptake measurement.

### The corpus gap closes before the flips

- [ ] **AC3.** Every mechanism-2 **shape** in the 22 measured denials has a row, quoted verbatim from the transcript. Not all 17 unrepresented denials need rows; every distinct shape does:
  - **OBF in a `perl -0pi -e` substitution** (new host)
  - **OBF in a quoted `node -e` regex literal** (new host)
  - **P11, the prose-period specimen** (new consumer)
  - **P9 on a quoted regex** (new sub-shape)
  Each is added asserting `deny`, which is its pre-fix verdict, and each carries its predicted post-fix verdict in a comment before any subject changes.

  Three **boundary** shapes join them under the same rule, each measured to deny under the fixed hook and therefore unchanged by it, marked **constructed** rather than drawn from the transcript: `cat $'x'; less *.ts` and `cat $"x"; less *.ts` for the two exotic openers, and `echo "a\\b"; cat *.md` for a backslash pair inside quotes followed by a real glob. The 8193-character length-cap row already exists and is untouched.
- [ ] **AC4.** The fragment quote-parity residual gets a row of its own, quoted verbatim (`echo "current=$(git branch --show-current)"; ... sed 's|^origin/||'; ...`), `deny` before the fix and `allow` after. Leaving it unarbitrated would repeat exactly the gap AC13 had to close in BUG-041.
- [ ] **AC5.** The four inherited rows (`KNOWN-FP P9-1`, `KNOWN-FP OBF`, `KNOWN-FP P5`, `KNOWN-FP P9 for-of`) flip to `allow`, each with its predicted red recorded before the pattern work begins.

### The mechanism

- [ ] **AC6.** `_g3_scan` gains a third mode in the existing `case "$state"` block, and `g3Scan` gains the mirrored mode. **Neither subject gains a second scanner**, and the spec's problem statement records that the filing's "second five-state scanner" pricing was disproved by reading the existing one.
- [ ] **AC7.** **BINDING ORDER: the mask is applied before the newline-to-semicolon join** in both subjects. Pinned two ways, because the masked copy is not observable from outside the hook and an order that only a comment records does not survive a refactor:
  1. A **textual contract assertion per subject** that the mask call precedes the join, in the style that pins the walk contract and the character-class trap.
  2. A **behavioral pair already in the corpus**: the quoted multiline body (`KNOWN-FP P9-1`) allows, and its unquoted counterpart (`for loop on line 2`) still denies. The pair asserts the property the order exists to produce, which is that no command anchor survives inside a quoted span.
  Stated honestly: the two orders are **observationally equivalent** on every measured case, because a quoted newline becomes `x` either way. The order is fixed for reasoning, and the ACs pin the property rather than pretending to observe the order.
- [ ] **AC8.** **Length preservation is a textual contract with no behavioral discriminator, and the AC says so rather than inventing one.** Every branch of the mask emits exactly one output character per input character, including two for a backslash pair inside quotes, and a textual contract assertion per subject pins that shape. **No behavioral test is written, because none exists.** A variant emitting one character per escape pair was built and scored against all 124 corpus rows plus four constructed cases: **it agreed with the correct mask on every one.** The reason is structural. The masked string is consumed on its own and is never compared offset-wise with the unmasked one, so a length divergence is internally consistent and invisible. Length preservation is a design invariant that keeps the seam reasonable about, not a property the oracle can defend, and recording that honestly is the point of the AC.
- [ ] **AC9.** **Quote characters survive the mask at their original offsets**, pinned by a textual contract assertion per subject **and by a corpus row that is measured to discriminate**: `c'a't (internal quote)`. OBF's `[a-zA-Z]'[a-zA-Z]+'[a-zA-Z]` matches only if the quote characters are still there, so a mask that replaced them turns that row green. Verified, not assumed: a quote-replacing variant was built and scored, and `c'a't` is **the single row in the whole corpus whose verdict it changes** (deny becomes allow). The AC names that row as its guard.
- [ ] **AC9-B.** **The mask is built from the stripped string**, never from the raw input, because comment removal shifts every offset after it. A textual contract assertion per subject pins the mask call's argument. This was a pre-flight finding promoted to a pinned item rather than left as prose.
- [ ] **AC10.** Exactly two checks receive the unmasked string. The dispatch names them in one place per subject, so the boundary is a single readable fact and not a condition spread across thirteen call sites.
- [ ] **AC11.** Both members of the port's **byte-identical mirrored pair** carry the change. `tests/installer/templates.test.js` is the guard; BUG-041's tripwire fired because a plan named one member.
- [ ] **AC12.** `EXCEPTIONS` still has exactly one member.

### Process

- [ ] **AC13.** The four-point red table discipline carries over: every intermediate state is predicted with its **suites named**, and any deviation in count **or suite** is a tripwire halt. If the shared corpus forces a red at the authority-alone commit, the bypass follows the BUG-041 ritual exactly: declared, evidenced with the verbatim failure list in the commit body, bounded to one commit, and belonging to the commit rather than to the hook.
- [ ] **AC14.** `[BUG-043]`'s backlog entry gains an **amendment note** recording that its "second five-state scanner" pricing was wrong and why, with the original wording left in place.
- [ ] **AC15.** `VERSION`, `package.json`, `package-lock.json` (both fields) and `CHANGELOG.md` agree, checked by `version-gate.mjs`. This ships as **1.31.3**.

---

## The headline, and the number the launch post cites

After this release, the 52 unique commands Guard 3 denied across this session reduce to **four denials**:

| residual | count | correct? |
|---|---|---|
| heredoc body scanned as command text | 1 | out of scope, different remedy, unfiled |
| `find global -type f \| sort` | 1 | **yes, a genuine `find` without `-maxdepth 1`** |
| `for id in T-100 ...; do` | 1 | **yes, a genuine loop, a pinned control** |
| `until [ "$(gh pr view ...)" ]; do` | 1 | **yes, a genuine loop, a pinned control** |

Three of the four are the guard working. **Fifty-two commands, four denials, two of them controls this release deliberately keeps.**

---

## Predicted boundaries

Baseline **873**. Seven new rows across two suites is +14; two contract assertions is +2.

| after | passed | failed | why |
|---|---|---|---|
| rows added, pre-fix verdicts | 887 | 0 | all seven deny correctly under the unfixed hook |
| authority alone | 878 | **9**, `guard3.test.js` only | the nine flipping rows, authority side |
| port and mirror added | 869 | **18**, nine per suite | both subjects allow, rows still record `deny` |
| nine rows flipped | 887 | 0 | green restored |
| contract assertions added | **889** | 0 | final |

---

## Out of Scope

- **The heredoc family.** `cat >> file <<'JSEOF'` denies because the heredoc body is scanned as command text. Different remedy (heredoc delimiters, not quote spans), two specimens, still uncharacterized. It stays unfiled under the evidence-first rule until someone characterizes it.
- **P9's breadth.** Whether a polling loop that dumps nothing should be denied at all is a rule question. Both controls stay pinned; this spec does not answer it.
- **`[BUG-044]`**, the deny message that names a file existing in no installation. `g3Blocked` is untouched by the mask. Noted and left.
- **Editing BUG-041's spec.** P11 and the P9 regex sub-shape are corrections to it; they live here. That record stands as the knowledge of its day.

## System Impact

| file | change |
|---|---|
| `tests/fixtures/guard3-reference.sh` | third mode in `_g3_scan` (`:82-158`), one extra call after `:433`, argument swap across `:448-460` |
| `.claude/hooks/pre-tool-use.mjs` | third mode in `g3Scan` (`:157-194`), mask call at `:445`, dispatch branch at `:456` |
| `project-template/.claude/hooks/pre-tool-use.mjs` | the identical change; the pair is asserted byte-identical |
| `tests/fixtures/guard3-corpus.js` | 7 rows added, 9 rows flipped, comment blocks rewritten |
| `tests/hooks/guard3.test.js` | corpus-length assertion moved; contract assertion |
| `tests/hooks/guard3-port.test.js` | contract assertion |
| `AGENT-READABLE BACKLOG.md` | amendment note, entry closed |
| `VERSION`, `package.json`, `package-lock.json`, `CHANGELOG.md`, `.claude/memory/project.md` | the 1.31.3 release and its record |

### Files Requiring Full Read (deferred to /cc-plan)

_None._ Both scanners, both dispatches and the corpus machinery were read in full during the audit: `_g3_scan` (`:82-158`), the authority dispatch (`:425-460`), `g3Scan` (`:157-194`), `guard3BashScan` (`:439-457`), `G3_CHECKS` (`:356-370`), and the corpus KNOWN-FP block.

## Complexity Estimate

**M.** The mechanism is a third mode on a scanner that already exists, and the dispatch change is one line per subject. The estimate is carried by the ritual: nine flipping rows each with a predicted red, seven new rows quoted verbatim, a red table with named suites at every step, a probable sanctioned bypass at the authority-alone commit, and a release.
