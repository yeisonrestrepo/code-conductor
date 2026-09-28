# BUG-041: Guard 3 refinement, the walk defect and the quoted-argv mechanism

**Status:** awaiting approval
**Filed as:** `[BUG-041]` in `AGENT-READABLE BACKLOG.md`
**Subjects:** `tests/fixtures/guard3-reference.sh` (authority), `.claude/hooks/pre-tool-use.mjs` (port), `tests/fixtures/guard3-corpus.js` (shared corpus)

---

## Problem

Guard 3 denied **47 `Bash` calls in one working session** on this repository. Recovering every denial from the session transcript and re-scanning each command against today's shipped hook gives **43 unique commands**, and the population is measured, not remembered: the two scripts written to perform this measurement were themselves denied mid-measurement, which is how 41 became 43.

The denials break down by the pattern ids the hook reported:

| ids | count | what the commands actually were |
|---|---|---|
| P7 | 18 | a reader piped into a bounded pager: `grep ... \| head -15`, `... \| tail -3`, `... \| sed -n '1,40p'` |
| OBF | 6 | an escape run inside a quoted regex argument: `grep -E '\[ \] \[T-[0-9]{3,}...'` |
| P9 | 5 | a quoted commit-message body line beginning with `for`, a quoted JS program containing `for (const x of ...)`, and two genuine shell loops |
| P4 | 5 | `cat` followed by a heredoc body, and `cat FILE && ... \| head` |
| P7 OBF | 2 | both of the above in one command |
| P5, P1 P4, P5 P7 | 3 | an escaped backtick inside a double-quoted grep pattern; a real `find`; a pager plus a substitution |
| non-pattern | 8 | the length cap and the malformed-quote branch |

The shape of the dominant class is the finding: **the guard's most frequent denial is the bounded form its own deny message recommends.** Every P7 row above pipes a search into `head`, `tail` or `sed -n`, which is the "Read with an explicit offset and limit" advice expressed in shell.

### Telemetry: the escape hatch has zero uptake

`1.29.0` shipped two mitigations. The deny message names `.claude/memory/bash-scan-allowlist.txt`, and `CC_GUARD3_WARN` converts a denial into an ask.

- **`.claude/memory/bash-scan-allowlist.txt` does not exist.** No entry has ever been added, here or anywhere the repository can observe.
- **No `CC_GUARD3_WARN` trace exists** in `.conductor/last-write.log` or anywhere else.

Across 47 denials in a single session, by the agent that wrote both mitigations, neither was reached for once. This is evidence about discoverability at the moment of friction, and it sets a constraint on this spec: **no acceptance criterion here may be satisfied by "the operator can allowlist it."** A remedy nobody invokes is not a remedy.

### Two mechanisms, not four patterns

Reading `_g3_p4_cat_glob` (`guard3-reference.sh:153-165`), `_g3_p7_pager_glob` (`:226-238`) and `g3GlobWalk` (`pre-tool-use.mjs:239-249`) in full establishes the first mechanism, and reading `guard3BashScan` (`:439-457`) with `g3Scan` (`:157-194`) establishes the second.

**Mechanism 1: the walk slices by match length instead of match index.**

```sh
while [[ "$rest" =~ $pager_re ]]; do
  local mlen=${#BASH_REMATCH[0]}
  local after="${rest:mlen}"          # from position 0, not from the match
```

For a match at index N greater than zero this shaves `len(match)` bytes off the **front** of the string and re-scans nearly all of it. Each iteration walks leftward until the truncation point lands inside a quoted region; `_g3_scan "glob"` then terminates in a non-`UNQUOTED` state and its fail-closed clause reports a glob that was never in the command. P7-1 needs 8 iterations, P7-2 needs 23. `g3P4CatGlob` and `g3P7PagerGlob` both call the walk verbatim (`:251-252`), so **one defect, two patterns**.

**Mechanism 2: the pattern checks read quoted text as if it were code.**

`guard3BashScan` builds `pre` by stripping comments and joining physical lines with `;`, then hands that one string to all thirteen checks. `g3Scan` tracks five quote states while building it and then discards every one of them. Consequences, each with a measured specimen:

- **P9.** A newline inside a quoted commit message becomes `;`, and `;` is a command-position anchor, so a prose line beginning with "for" reads as a shell loop. Same for `for (const fn of [...])` inside a `node -e` program.
- **OBF.** `(\\.)+ ` at command position fires on `\[ \]` inside a single-quoted `grep -E` pattern, where a backslash run is a regex, not an evasion.
- **P5.** `after.includes('`')` fires on a backslash-escaped backtick inside a double-quoted argument, where the backtick is literal.

### What the fix is worth, measured end to end

Both hooks were copied to scratch files with the single-line walk change applied, then run over every recovered denial and over all 118 corpus and dialect rows. Nothing in the repository was modified to obtain these numbers.

| change | denials that flip deny to allow | corpus rows whose verdict moves |
|---|---|---|
| walk fix only | **20 of 41** | **2 of 118**, both the pre-declared KNOWN-FP rows P7-1 and P7-2 |
| walk fix plus a targeted quote mask | **36 of 43** | **3 of 118**, the same two plus the pre-declared P9-1 |

The corpus result is the important one. The rows that move are exactly the rows the corpus wrote down in advance as BUG-041's acceptance cases (`guard3-corpus.js:162-185`). **Zero unplanned regressions in either configuration.**

---

## Gate 1, already ruled: patch the frozen authority

The filing pre-costed this gate and it was ruled **(a) patch the authority**. Recorded here so the ruling travels with the spec.

```
AUTHORITY  tests/fixtures/guard3-reference.sh:158-159
-  local mlen=${#BASH_REMATCH[0]}
-  local after="${rest:mlen}"
+  local pre="${rest%%"${BASH_REMATCH[0]}"*}"
+  local after="${rest:${#pre}+${#BASH_REMATCH[0]}}"

PORT       .claude/hooks/pre-tool-use.mjs:244
-  const after = rest.slice(m[0].length);
+  const after = rest.slice(m.index + m[0].length);
```

The argument, in short: the authority is an oracle of **intent**, not a snapshot of behavior. Bash's `[[ =~ ]]` reports the matched text and no index, so `${#BASH_REMATCH[0]}` was the slice nearest to hand; no spec, design note or corpus row ever asserted that a match after index 0 shaves the front. The index is in fact derivable in bash, which is what the fix does, so the original was a shortcut rather than a limit. The port had `m.index`, declined it, and recorded the choice as a quirk. The decisive asymmetry against option (b), promoting the divergence to a sanctioned exception, is that the existing sanctioned divergence is **enumerable** (one allowlist row) while this one is a function of command length and quote count, so a count assertion reading 4 over an open-ended set would be a fiction. Under (b) the 111 corpus rows would stop arbitrating P4, the pattern with the quieter history: it carried zero specimens when the filing was written and five by the time this spec was, three of them pure mechanism-1 flips. AC13 makes that arbitration permanent.

`EXCEPTIONS` stays at exactly one member. `tests/hooks/guard3-port.test.js:64` keeps asserting that.

---

## Gate 2, for approval: severability

The two mechanisms are severable. The measurement above argues they should be severed, and the recommendation is to **ship mechanism 1 in this item and file mechanism 2 separately**.

**Why mechanism 1 ships now.** It is one line in each subject, it flips 20 of 41 real denials, and it moves exactly the two corpus rows that were written to be moved. Its cost is the authority edit already ruled.

**Why mechanism 2 does not ship with it.** Three reasons, the third measured:

1. It is new behavior, not a defect repair. Gate 1's argument turns on the walk never having been intended. A quote-aware dispatch was never intended either way, so the same argument does not carry it, and a second header-forbidden edit would need its own justification rather than riding on this one.
2. The authority is bash. Mechanism 2 requires a second five-state scanner written in shell and kept byte-faithful to the port's, or the two subjects diverge on exactly the rows the corpus uses to arbitrate. That is the real price, and it is not small.
3. **A blanket mask breaks true positives.** A prototype that masks every quoted span before the dispatch was scored against the corpus: it flips the three pre-declared rows and **breaks 7 genuine denials**, namely four P6 rows (`grep -r '.*' .`, `git grep '.*'`, `grep -r -e foo -e '.*' .`, `wc -l $(grep -r '.*' .)`), the P6 dialect row, and two P12 rows (`alias c=cat`, `alias g=grep`). P6 and P12 read quoted content **by design**: a grep pattern and an alias value are data the check exists to inspect. A targeted mask applied only to P5, P9 and OBF scores clean, which means mechanism 2's design question is per-check and deserves its own spec rather than a paragraph in this one.

If this gate is ruled the other way and both mechanisms ship together, the estimate moves from M to L and the plan gains a bash-side scanner task with its own differential.

---

## Solution

Fix the walk in both subjects, in a commit of its own, ahead of any other change. Record the four classes this does not fix as corpus rows with their current verdicts, so the next item inherits pre-written acceptances the way this one did. File the second mechanism at the verified id ceiling with the measurement attached.

Nothing in this item changes a pattern's rule. Every verdict that moves, moves because a check finally receives the after-text it was always meant to receive.

---

## Behavior

### Main path

1. A `Bash` call arrives. `guard3BashScan` preprocesses it exactly as it does today.
2. P4 and P7 match a reader or pager at command position, at any index.
3. The walk now slices from the **end of the match** rather than by its length. `after` is the text that genuinely follows the command, so `grep -n "x" lib | head -15` yields `-15`, not a fragment beginning mid-quote.
4. `g3Scan('glob', after)` finds no unquoted glob and no unterminated quote, so the check does not fire.
5. The call proceeds. No allowlist entry, no `CC_GUARD3_WARN`, no operator action of any kind.

### Alternative paths

- **A genuine glob still denies.** `cat *.md`, `less *.ts`, `head *.log`, `cat src/**/*.ts`, `cat {a,b}.ts`, `cat [abc].md` and `/bin/cat *.md` all fire exactly as before; the after-text is now correct and the glob is in it.
- **Multiple readers in one command.** The walk still loops. With the index-aware slice it advances monotonically past each match and terminates on the first iteration that finds no further match, instead of grinding leftward through the string.
- **A match at index 0.** `cat *.ts` with no prefix. `m.index` is 0, so the new expression equals the old one and nothing changes. This is why the DIALECT extent rows do not move.
- **Genuine shell loops stay denied.** `for id in T-100 T-101 ...; do` and `until [ "$(gh pr view 32 ...)" = "APPROVED" ]; do sleep 30; done` are both real loops this session's agent wrote, and both remain denied under every configuration measured. Precision rises without recall moving.

### Error cases

- **Unterminated quote in the real command.** Unchanged: `g3Scan('strip', ...)` reports malformed and the guard denies before any pattern runs. The two corpus rows pinning this do not move.
- **Over the length cap.** Unchanged, and denied before the scan.
- **The bash substitution cannot find the needle.** `${rest%%"${BASH_REMATCH[0]}"*}` yields everything before the first literal occurrence of the matched text, so `${#pre}` **is** the match index and the port's `m.index + m[0].length` translates directly. POSIX ERE matching is leftmost, so an identical literal occurrence earlier in the string is impossible: the regex would have matched there instead. Quoting the needle keeps glob metacharacters literal. If the needle is somehow not found, `%%` returns `$rest` unchanged, `${#pre}` equals the whole length, `after` becomes empty, and the loop's **existing** `[[ -z "$rest" ]] && break` ends it.

  This form is chosen over `${rest#*"${BASH_REMATCH[0]}"}` for exactly that failure mode. The strip form returns `$rest` unchanged on a missing needle and loops forever, so it would need a new no-progress guard; the offset form fails safe by terminating, with no guard added. A guard's inner loop should not be able to hang the guard, and the plan proves the chosen form against a full copy of the frozen file before the frozen file is touched.

---

## Acceptance Criteria

- [ ] **AC1.** `tests/fixtures/guard3-reference.sh:159` and `.claude/hooks/pre-tool-use.mjs:244` carry the index-aware slice. The authority edit lands **alone, in its own commit, ahead of every other change in this item**, with the file header's edit prohibition amended in the same commit, per the `cbe9a26` precedent.
- [ ] **AC2.** The port's `g3GlobWalk` comment no longer describes the slice as a preserved quirk, and the block at `pre-tool-use.mjs:198-202` that instructs future readers not to fix it is replaced by a statement of the corrected contract.
- [ ] **AC3.** `EXCEPTIONS` still has exactly one member and `tests/hooks/guard3-port.test.js` still asserts it.
- [ ] **AC4.** The KNOWN-FP rows P7-1 and P7-2 flip to `verdict: 'allow'` in `guard3-corpus.js`, **both subjects agree on the new verdict**, and the comment block above them is rewritten to say the walk was fixed rather than preserved.
- [ ] **AC5.** Of the 118 corpus and dialect rows, **exactly those two move**. A test run before the corpus edit shows the two rows red, plus AC13's new row red, and every other row green; that three-red state is recorded in the plan as a predicted boundary.
- [ ] **AC6.** P9-1 keeps `verdict: 'deny'` and its comment is amended to name mechanism 2 and its filing id, so the row is a pre-written acceptance for the next item and not an oversight in this one.
- [ ] **AC7.** Two control rows are added and deny: the `for id in T-100 ...; do` batch loop and the `until [ "$(gh pr view ...)" = "APPROVED" ]; do sleep 30; done` poller, both quoted verbatim from this session. Their comment states that they are genuine loops correctly denied, so a later refinement that silences them is a recall regression, not a win.
- [ ] **AC8.** Three KNOWN-FP rows are added with `verdict: 'deny'` and a comment naming mechanism 2: the OBF escape-run specimen, the P5 escaped-backtick specimen, and the P9 quoted-JS-program specimen, each quoted verbatim.
- [ ] **AC9.** No acceptance criterion in this item is satisfied by adding an allowlist entry or by setting `CC_GUARD3_WARN`. The 20 measured flips occur with an absent allowlist file, which is the state every installation is in.
- [ ] **AC10.** The corrected walk is pinned where it can actually be seen. **Iteration count has no behavioral shadow**, so no test may claim to observe it: `pre-tool-use.mjs` exports nothing and calls `main()` at load (`:509`), which reads fd 0, so it cannot be imported; and `g3Scan('glob', after)` scans the **entire** after-text, so a second iteration can never find a glob the first pass missed. The property is therefore pinned by four tests instead:

  1. A textual contract assertion on the port: the source contains `rest.slice(m.index + m[0].length)` and does not contain `rest.slice(m[0].length)`.
  2. A textual contract assertion on the authority: the source does not contain `${rest:mlen}`, and the corrected offset form appears **exactly twice**, because P4 and P7 are separate functions and a half-applied fix is the regression this item exists to prevent.
  3. A termination assertion on the port, on a command built to maximize walk iterations.
  4. The same on the authority, where the bash form's no-progress risk actually lives.

  Assertions 1 and 2 follow the repository's existing structural-test pattern, the one `tests/installer/templates.test.js` uses to pin the character-class trap. This criterion replaces an earlier wording that asked for an iteration count; that wording was unsatisfiable and was corrected before implementation began rather than reinterpreted during it.
- [ ] **AC11.** `VERSION`, `package.json`, `package-lock.json` and `CHANGELOG.md` all read the same new version, checked by the mechanical gate BUG-040 introduced. This item ships as **1.31.2**.
- [ ] **AC12.** `BUG-043` is filed for mechanism 2 at the ceiling verified by `id-ceiling.mjs` with both legs live, carrying the blanket-mask measurement, the seven true positives it breaks, the targeted-mask result, and all five specimens. The P7 fragment-parity residual described below is recorded inside that entry as the same root cause in a different check.

- [ ] **AC13.** **P4 is arbitrated by the corpus, not only by the scratch measurement.** One P4 row is added, quoted verbatim from a flipped specimen, with `verdict: 'allow'`:

  ```
  wc -l tests/installer/*.js lib/installer/*.mjs && echo "--- VERSION ---" && cat VERSION && echo "--- node/test runner ---" && node -e 'const p=require("./package.json");console.log(JSON.stringify(p.scripts));console.log(p.version)'
  ```

  It denies under `P4` today and allows under the walk fix alone, measured. This specimen is chosen over the two other pure flips because it carries **unquoted globs earlier in the command** (`*.js`, `*.mjs`) while the text after `cat VERSION` has none, so the row pins the precise property the defect destroyed: the after-text begins at the **end of the match**, and a glob elsewhere in the command is not in it. A later "fix" that scans the whole string for globs turns this row red. Its comment states that P4 carried zero specimens until this session and that the row exists so a walk regression cannot return silently on the quieter of the two patterns. The row is red-predicted alongside AC5's two.

- [ ] **AC14.** **`BUG-044` is filed for the deny-message defect**, at the ceiling, after AC12 mints `043`. The entry carries the zero-uptake measurement (47 denials, zero allowlist entries, zero `CC_GUARD3_WARN` traces), the fact that `.claude/memory/bash-scan-allowlist.txt` exists in no installation while the deny message names it as the remedy, and the candidate shapes: seed the file with its commented header at install time, which lands in BUG-039's host-owned policy table as a `seed` row; or have the message state how to create it; or both. The decision is reserved for that item's spec. The escape hatch's discoverability becomes that entry's second concern.

---

## Out of Scope

Named with specimens, because an unnamed residual reads as an oversight.

- **Mechanism 2, the quoted-argv blindness.** Gate 2 argues the split. Specimens are recorded as corpus rows by AC6 and AC8.
- **Heredoc bodies scanned as command text.** `cat >> tests/installer/templates.test.js <<'JSEOF'` denies under P4 because the heredoc body contains `[` characters that the scanner sees as unquoted globs. Two specimens this session. Related family, different remedy (heredoc delimiters, not quote spans); it needs its own characterization before it is worth an id.
- **P7 and P4 fragment quote-parity.** After the walk fix, one P7 denial survives: the after-text begins inside an enclosing double-quoted region, `g3Scan` starts it in `UNQUOTED`, and every subsequent quote is parity-inverted until an unquoted `?` from a `$?` is read as a glob. The walk fix corrects where the fragment starts, not what state it starts in. Recorded in BUG-043's entry as the same root cause in a different check.
- **P9's breadth.** `until ...; do` and `for id in ...; do` are denied by P9's rule working correctly. Whether a polling loop that dumps nothing should be denied at all is a rule question, not a defect, and this item pins the current answer as a control rather than changing it.
- **The deny message naming a file that does not exist.** A product defect independent of any pattern: documentation lying about the remedy. It constrains this spec's acceptance criteria (AC9) and is **filed as `BUG-044` by AC14** rather than left as a paragraph here, because an unhomed finding does not stay found. Its discoverability question travels with it.

---

## System Impact

| file | change | why |
|---|---|---|
| `tests/fixtures/guard3-reference.sh` | modify `:159`, amend header | mechanism 1 in the authority, its own commit |
| `.claude/hooks/pre-tool-use.mjs` | modify `:244`, rewrite `:198-202` | mechanism 1 in the port |
| `tests/fixtures/guard3-corpus.js` | flip 2 rows, add 6 rows, rewrite 1 comment block | acceptance and inheritance |
| `tests/hooks/guard3-port.test.js` | add the walk-progress test | AC10 |
| `AGENT-READABLE BACKLOG.md` | close BUG-041, file BUG-043 and BUG-044 | record |
| `.claude/memory/project.md` | spec summary, then implementation record | record |
| `VERSION`, `package.json`, `package-lock.json`, `CHANGELOG.md` | 1.31.2 | release |

Both harnesses (`tests/hooks/guard3.test.js` for the authority, `tests/hooks/guard3-port.test.js` for the port) drive `CORPUS` and `DIALECT`, so every corpus edit moves both subjects at once. Only the port harness reads `EXCEPTIONS`. That asymmetry is why gate 1's ruling keeps the rows arbitrating.

### Files Requiring Full Read (deferred to /cc-plan)

_None._ The reads this spec was gated on were discharged before it was written: `_g3_scan` (`guard3-reference.sh:73-149`), `_g3_p4_cat_glob` (`:153-165`), `_g3_p7_pager_glob` (`:226-238`), `_g3_p9_shell_loop` (`:249-253`), `g3Scan` (`pre-tool-use.mjs:157-194`), `g3GlobWalk` (`:239-252`), `g3P5CmdSubst` (`:254-263`), `g3P9ShellLoop` (`:318-320`), `g3Obfuscation` (`:344-349`), the `G3_POS` constant (`:120`), the line-join and dispatch (`:439-457`), the corpus KNOWN-FP block (`guard3-corpus.js:162-185`) and `EXCEPTIONS` (`:206-226`).

---

## Complexity Estimate

**M.** The code change is two lines. The estimate is carried by the ritual around them: an authority edit that lands alone with its header amended, a predicted-red corpus boundary that must be observed before the rows are flipped, eight corpus rows written from verbatim specimens, and a release. Mechanism 1's impact is already measured, so the plan's boundary predictions start from numbers rather than estimates.
