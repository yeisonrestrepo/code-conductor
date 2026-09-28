# BUG-041 Guard 3 refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the Guard 3 walk in both subjects so P4 and P7 receive the text that genuinely follows the matched command, and record every specimen this item does not fix as a corpus row the next item inherits.

**Architecture:** One defect, two subjects, one shared corpus. The authority (`guard3-reference.sh`) is patched first and alone, per the ruled gate; the port (`pre-tool-use.mjs`) follows with the corpus rows that arbitrate both. Mechanism 2, the pattern checks reading quoted text as code, is out of scope and files as BUG-043.

**Tech Stack:** bash (the frozen authority), Node ESM (the shipped hook), vitest (both harnesses).

**Spec:** `docs/superpowers/specs/2026-09-28-bug041-guard3-refinement-design.md` (14 ACs, approved 2026-09-28 at `c016199`)

## Global Constraints

- Baseline is **857 passed, 12 skipped**, confirmed by the pre-commit run at `c016199`.
- The corpus is **111 CORPUS rows plus 7 DIALECT rows = 118**, driven by **both** harnesses. `EXCEPTIONS` has exactly **1** member and `tests/hooks/guard3-port.test.js:64` asserts it.
- The authority edit lands **alone, in its own commit, ahead of every other change**, with its header prohibition amended in the same commit. Precedent `cbe9a26`.
- **No acceptance criterion may be satisfied by adding an allowlist entry or setting `CC_GUARD3_WARN`.** Every measured flip must occur with `.claude/memory/bash-scan-allowlist.txt` absent.
- Both controls stay denied: the `for id in T-100 ...; do` batch loop and the `until [ "$(gh pr view ...)" = "APPROVED" ]; do sleep 30; done` poller.
- Ship as **1.31.2**. `VERSION`, `package.json`, `package-lock.json` (both `version` and `packages[""].version`) and `CHANGELOG.md` must agree.
- Stage by tracked-ness: `git add -u <path>` for tracked, `git add -f <path>` for new under an ignored directory, plain `git add <path>` otherwise, **always an explicit path**. Commit with `git commit -F <file>`.
- All plan state updates are surgical single-line edits (BUG-003 invariant). No em-dashes in authored output.
- Every commit message ends with the `Co-Authored-By` and `Claude-Session` trailers.

---

## Two rulings required before Task 2 runs

Both were discovered while mapping the code, and both change what the plan does. Neither is a judgment call the plan should make alone.

### Ruling 1: one commit in this plan cannot pass the pre-commit test gate

`.git/hooks/pre-commit` runs `npm test` and blocks on failure. The corpus is shared, so for any row, green requires **both** subjects to agree with the row's recorded verdict. That leaves exactly two green states:

- **A.** neither subject fixed, rows say `deny` (today)
- **D.** both subjects fixed, rows say `allow` (the goal)

Every intermediate state is red. AC1 requires the authority edit to land alone, which puts a commit between A and D by construction. **Isolation and greenness cannot both hold here**; AC1 chose isolation, and the approval asked for the red state to be declared rather than avoided.

**AUTHORIZED**, as a sanctioned exception with its full ritual, in the approval message of 2026-09-28 that accepted this plan's two rulings. The conditions below are **binding**, not advisory:

1. The suite is run manually **first**, at T-002-D, and its result read before anything is staged.
2. The verbatim failure list goes in the commit body, so git archaeology finds the declared red where it happened rather than in a plan file that may move.
3. Scope is **one commit in this plan only**. A second bypass halts the plan and returns to the developer.
4. The halt conditions stand: any third failure, or any red in the port suite, stops the plan cold.
5. **The exception belongs to the commit, never to the hook.** `.git/hooks/pre-commit` is not weakened, edited or disabled at any point.

The fallback of collapsing Tasks 2 and 3 was considered and **rejected**: it buys a green checkmark by giving up the property the checkmark exists to protect. AC1's isolation is what makes the authority patch auditable as its own act, and a bypass that is declared, evidenced and bounded is more honest than a merge that hides the disagreement. Green is restored at the very next commit, T-003-N.

**The one red commit, declared in full:**

| | |
|---|---|
| commit | T-002-E, the authority edit alone |
| red suite | `tests/hooks/guard3.test.js` only |
| red tests | `corpus: KNOWN-FP P7-1: grep then sed with a quoted echo between` and `corpus: KNOWN-FP P7-2: multi-line cleanup piping into tail` |
| count | 855 passed, **2 failed**, 12 skipped |
| green suite | `tests/hooks/guard3-port.test.js`, all 120, because the port is untouched at that commit |
| why | the corpus records the pre-fix verdict and arbitrates both subjects; one subject has moved. This is declared disagreement, the same honesty the BUG-037 differential carried at its one sanctioned divergence |
| restored | T-003-N, at 869 passed |

Any third failure, or a failure in the port suite, means the edit did something other than what was measured. Halt and report rather than committing.

### Ruling 2: AC10 as written is not observable, and the plan substitutes for it

AC10 asks for a test asserting "exactly two loop iterations." That number cannot be observed from outside the hook:

- `pre-tool-use.mjs` exports nothing and calls `main()` at module load (`:509`), which reads fd 0. It cannot be imported by a test.
- Iteration count is invisible behaviorally. `g3Scan('glob', after)` scans the **entire** after-text, so the loop only ever continues when no glob was found anywhere in it. A second iteration therefore cannot change the verdict by finding a glob the first pass missed, except through the very quote-parity defect this item does not fix.

Writing a test that claims to count iterations would be a test asserting something it cannot see. **The substitute keeps the property and drops the fiction:** two textual contract assertions, one per subject, in the style the repository already uses for the character-class trap (`tests/installer/templates.test.js`), plus two termination assertions that guard the bash form's no-progress risk. Four tests, specified verbatim in Task 4.

**ACCEPTED**, with the obligation it carries: **the plan does not get to outvote the spec silently, even when the plan is right.** AC10 is reworded in the spec itself, and the spec's gate-1 diff and error-case paragraph are updated to the chosen `%%` offset form, before Task 1 runs. Task 0 carries both edits in one spec-truth commit that lands ahead of everything else.

---

## File Structure

| file | responsibility in this item |
|---|---|
| `tests/fixtures/guard3-reference.sh` | the frozen authority. Two walk functions change, `:157-163` and `:230-236`, plus the header's sanctioned-exception list |
| `.claude/hooks/pre-tool-use.mjs` | the shipped port. One expression at `:244`, plus the comment block at `:196-202` that currently instructs readers not to fix it |
| `project-template/.claude/hooks/pre-tool-use.mjs` | **the other member of the pair**, and the copy the installer deploys. `tests/installer/templates.test.js:96-98` asserts byte identity. A change to one member alone reaches no user |
| `tests/fixtures/guard3-corpus.js` | the shared oracle. Two rows flip, six rows are added, two comment blocks are rewritten |
| `tests/hooks/guard3.test.js` | drives the authority over CORPUS + DIALECT. Gains one termination test |
| `tests/hooks/guard3-port.test.js` | drives the port, plus EXCEPTIONS. Gains two contract tests and one termination test |
| `AGENT-READABLE BACKLOG.md` | closes BUG-041, files BUG-043 and BUG-044 |
| `VERSION`, `package.json`, `package-lock.json`, `CHANGELOG.md` | the 1.31.2 release |
| `.claude/memory/project.md` | the implementation record |

## Predicted boundaries

| after | passed | failed | why |
|---|---|---|---|
| baseline | 857 | 0 | confirmed at `c016199` |
| T-002-D, committed at T-002-E | 855 | **2** | the two KNOWN-FP rows, authority suite only. **Declared red state 1**, the bypassed commit |
| T-003-B | 856 | **3** | +2 tests for the new P4 row: green in the authority suite, red in the port suite. **Declared red state 2**, observed and not committed |
| T-003-E | 855 | 4 | the port is fixed, so the P4 row goes green in both and the two KNOWN-FP rows go red in both |
| T-003-M, committed at T-003-N | 869 | 0 | +12, six new rows across two suites |
| T-004 (AC10 substitute) | 873 | 0 | +4 |
| T-005 (filings) | 873 | 0 | documentation only |
| T-006 (release) | 873 | 0 | version files only |

Tripwire protocol stands: if an actual count differs from a prediction, stop before the next step and report the difference with its cause.

---

## Ordered Steps

### Task 0: the spec-truth commit, then the plan commit

**Files:**
- Modify: `docs/superpowers/specs/2026-09-28-bug041-guard3-refinement-design.md`
- Create: `docs/superpowers/plans/2026-09-28-bug041-guard3-refinement.md`

The spec edits are already applied on disk, made at plan approval rather than during execution. These steps commit them, and they land **before** the plan so history reads in the order the argument does.

- [X] [T-000-A] Verify the three spec-truth edits are present before committing them. Read the spec and confirm: AC10 now opens `The corrected walk is pinned where it can actually be seen`; the gate-1 diff block shows `local pre="${rest%%"${BASH_REMATCH[0]}"*}"`; and the error case is titled `The bash substitution cannot find the needle`. Any missing edit halts, because a spec-truth commit that does not carry the truth is worse than none.
- [X] [T-000-B] Stage and commit the spec. `docs/` is ignored by `.gitignore:8` and this file is untracked, so it is the new-file-under-an-ignored-directory branch: `git add -f "docs/superpowers/specs/2026-09-28-bug041-guard3-refinement-design.md"`. This also restores the convention that held through BUG-039, where spec files were tracked; BUG-040's spec is the only one that is not, and that gap is a direct casualty of the staging defect BUG-040 itself fixed. Commit with subject `docs: correct AC10 and the bash walk form in the BUG-041 spec` and a body naming both corrections and why each was made before implementation rather than during it.
- [X] [T-000-C] Stage this plan file. `docs/` is ignored by `.gitignore:8`, so this is the new-file-under-an-ignored-directory branch of the staging convention and takes `-f` with an explicit path. Run: `git add -f "docs/superpowers/plans/2026-09-28-bug041-guard3-refinement.md"` and confirm `add_rc=0`. This is the convention implementing itself on the plan that will use it four more times.
- [X] [T-000-D] Write the commit message to `<scratchpad>/msg-t000.txt` with subject `docs: add the BUG-041 Guard 3 refinement implementation plan` and the two trailers, then run `git commit -F <scratchpad>/msg-t000.txt`. The gate runs green on both Task 0 commits; no source has changed yet.

---

### Task 1: premise gates

Run every step before a character of either subject changes. Each one re-opens the plan if it fails.

**Files:**
- Read only: `tests/fixtures/guard3-reference.sh:153-165,226-238`, `.claude/hooks/pre-tool-use.mjs:239-252`

- [X] [T-001-A] Confirm the authority's two walk bodies are byte-for-byte what this plan expects. Read `tests/fixtures/guard3-reference.sh` at `offset: 152, limit: 14` and at `offset: 225, limit: 14`. Both must contain `local mlen=${#BASH_REMATCH[0]}` followed by `local after="${rest:mlen}"`. If either differs, halt: the plan's edits were written against a different file.
- [X] [T-001-B] Confirm the port's walk is what this plan expects. Read `.claude/hooks/pre-tool-use.mjs` at `offset: 238, limit: 15`. Line `:244` must read `    const after = rest.slice(m[0].length); // authority quirk: slice by length, not index`. If it differs, halt.
- [X] [T-001-C] Prove the bash index form works before editing the frozen file. Write `<scratchpad>/probe-bash-index.mjs` that writes a throwaway copy of `guard3-reference.sh` with both walk bodies replaced by the Task 2 form, then runs five commands through the copy with `LC_ALL=C LANG=C` and prints each verdict:

  | command | expected |
  |---|---|
  | corpus P7-1 | allow |
  | corpus P7-2 | allow |
  | the AC13 P4 row's command | **allow** |
  | `cat *.md` | deny |
  | `/usr/bin/less *.ts` | deny |

  The P4 row is in this probe because T-003-B predicts it GREEN in the authority suite and RED in the port suite. If the patched authority denies it, that prediction is wrong and the three-red observation would arrive as a four-red one. If any of the five disagrees, halt and report before touching the real file.

  The form under test, and why it is preferred over `${rest#*"${BASH_REMATCH[0]}"}`:

  ```sh
  local pre="${rest%%"${BASH_REMATCH[0]}"*}"
  local after="${rest:${#pre}+${#BASH_REMATCH[0]}}"
  ```

  `%%` strips the longest trailing part after the first literal occurrence of the matched text, so `${#pre}` **is** the match index. POSIX ERE matching is leftmost, so an identical literal occurrence earlier in the string is impossible: the regex would have matched there. Quoting the needle keeps glob metacharacters literal. When the needle is somehow not found, `%%` returns `$rest` unchanged, `${#pre}` equals the whole length, `after` becomes empty, and the existing `[[ -z "$rest" ]] && break` ends the loop. **The form fails safe by terminating**, which is why it is chosen over the `#*` strip form that would loop forever on the same input and need an extra progress guard.

- [X] [T-001-D] Confirm the measured flip set still holds at this commit. Run `<scratchpad>/measure-walk-fix.mjs`. Expected, unchanged from the spec: `deny->allow=20` over the session denials, and `verdict_moved=2` over the 118 corpus rows, naming P7-1 and P7-2. A different corpus count halts the plan; a different denial count is reported but does not halt, because the denial population grows as this session produces more of them.
- [X] [T-001-E] Record the corpus-length assertion and its consequence. `tests/hooks/guard3.test.js:82-84` asserts `expect(CORPUS).toHaveLength(111)`. It is one test, in the authority suite only; `guard3-port.test.js` has no equivalent. **Every step that adds corpus rows must move that number in the same step**, or each suite run lands exactly one failure above the declared boundary table. Confirm the number currently reads `111` and that the port suite has no matching assertion, then proceed. This was found while running T-001-C, before any prediction was tested, so the table's numbers stand unchanged; what changed is the steps that make them true.
- [X] [T-001-F] Record the pre-edit test count. Run `npx vitest run --reporter=basic` and capture the summary line. Expected: `857 passed | 12 skipped`. Any other number replaces the baseline in the boundary table before Task 2 begins.

---

### Task 2: the authority edit, alone

**Files:**
- Modify: `tests/fixtures/guard3-reference.sh:158-159`, `:231-232`, `:10-19`

**Interfaces:**
- Produces: an authority in which `_g3_p4_cat_glob` and `_g3_p7_pager_glob` pass `_g3_scan "glob"` the text that follows the match, not a front-truncated string.

- [X] [T-002-A] In `_g3_p4_cat_glob`, replace the two-line slice. Old:

  ```sh
      local mlen=${#BASH_REMATCH[0]}
      local after="${rest:mlen}"
  ```

  New:

  ```sh
      local pre="${rest%%"${BASH_REMATCH[0]}"*}"
      local after="${rest:${#pre}+${#BASH_REMATCH[0]}}"
  ```

  Leave the `_g3_scan` line, the `rest="$after"` line and the empty-string break untouched, including the non-ASCII arrow in the existing trailing comment.

- [X] [T-002-B] Apply the identical replacement in `_g3_p7_pager_glob`. The two functions are the same loop over different regexes, so the same two lines change. Because the old text is identical in both places, construct each `Edit` with enough surrounding context to be unique, or perform them as one `replace_all` only after confirming the count is exactly 2.
- [X] [T-002-C] Amend the header's sanctioned-exception list. The file currently says two exceptions exist and closes with `# Nothing else in this file moves.` Insert a third entry before that line:

  ```
  #   3. The P4 and P7 walks slice from the END of the match rather than by the
  #      match LENGTH from position 0. The original form shaved len(match) bytes
  #      off the FRONT and re-scanned, walking leftward until the cut landed inside
  #      a quoted region, where _g3_scan's fail-closed clause reported a glob that
  #      was never in the command. bash's [[ =~ ]] reports no index, so the length
  #      slice was the only form available to the original author; it was never
  #      intended behavior. Corrected in both subjects under [BUG-041], recorded in
  #      docs/superpowers/specs/2026-09-28-bug041-guard3-refinement-design.md.
  ```

  Keep `# Nothing else in this file moves.` as the closing line.

- [X] [T-002-D] Run the full suite and record the result verbatim: `npx vitest run --reporter=basic`. **Expected: 855 passed, 2 failed, 12 skipped**, both failures in `tests/hooks/guard3.test.js`, labelled `corpus: KNOWN-FP P7-1: grep then sed with a quoted echo between` and `corpus: KNOWN-FP P7-2: multi-line cleanup piping into tail`. Any other failure count, or any failure in `tests/hooks/guard3-port.test.js`, halts the task.
- [X] [T-002-E] Stage and commit with the gate bypassed **once**, under the authorization Ruling 1 requests. `guard3-reference.sh` is tracked, so staging is `git add -u "tests/fixtures/guard3-reference.sh"`. Write `<scratchpad>/msg-t002.txt` with subject `fix: slice the Guard 3 walk from the end of the match [BUG-041]`, a body that names the defect, states the third sanctioned exception, and **pastes the two failing test names verbatim with the sentence that the port is deliberately one commit behind**, then run `git commit --no-verify -F <scratchpad>/msg-t002.txt`. Confirm `commit_rc=0` and that `git log --oneline -1` shows the subject.

---

### Task 3: the port edit and the corpus rows

**Files:**
- Modify: `.claude/hooks/pre-tool-use.mjs:196-202`, `:244`
- Modify: `project-template/.claude/hooks/pre-tool-use.mjs` (the identical change; the two ship as a byte-identical pair)
- Modify: `tests/fixtures/guard3-corpus.js:162-185`
- Modify: `tests/hooks/guard3.test.js:83` (the corpus-length assertion, moved three times: 112, 114, 117)

**Interfaces:**
- Consumes: the authority from Task 2, which now allows P7-1 and P7-2.
- Produces: a corpus in which both subjects agree on every row, and six new rows.

- [X] [T-003-A] Add the AC13 P4 row FIRST, before either subject fix reaches the port, and in the SAME step change `tests/hooks/guard3.test.js:83` from `toHaveLength(111)` to `toHaveLength(112)`, per T-001-E. It goes immediately below the KNOWN-FP block, verbatim from the session:

  ```js
  // P4 carried ZERO specimens when [BUG-041] was filed and five by the time its spec
  // was written. Both flipping rows above are P7, so without this row the corpus would
  // arbitrate the walk fix on only one of the two patterns it broke. This command denied
  // under P4 before the fix and allows after it, measured. The unquoted globs EARLIER in
  // the command are load-bearing: the text after `cat VERSION` has none, so the row pins
  // that `after` begins at the END of the match. A later "fix" that scans the whole
  // command for globs turns this row red, which is the point.
  { label: 'P4 walk: glob before the reader, none after it', command: 'wc -l tests/installer/*.js lib/installer/*.mjs && echo "--- VERSION ---" && cat VERSION && echo "--- node/test runner ---" && node -e \'const p=require("./package.json");console.log(JSON.stringify(p.scripts));console.log(p.version)\'', verdict: 'allow' },
  ```

- [X] [T-003-B] Run the full suite and record the **three-red observation**, the second of this plan's two declared red states. Run: `npx vitest run --reporter=basic`. **Expected: 856 passed, 3 failed, 12 skipped.** The three, by suite:

  | suite | test | why it is red |
  |---|---|---|
  | `guard3.test.js` | `corpus: KNOWN-FP P7-1: ...` | authority fixed, row still records `deny` |
  | `guard3.test.js` | `corpus: KNOWN-FP P7-2: ...` | authority fixed, row still records `deny` |
  | `guard3-port.test.js` | `corpus: P4 walk: glob before the reader, none after it` | **port not yet fixed**, so it still denies while the row records `allow` |

  A fourth red here means T-003-A did not bump the corpus-length assertion. The new P4 row is GREEN in the authority suite at this moment and RED in the port suite, which is the whole point: it discriminates the walk fix on the pattern with no history, and it does so in the real harness rather than in a scratch script. Do not commit here. If the P4 row is red in BOTH suites, Task 2 did not take on the authority side; halt.

- [X] [T-003-C] Replace the walk expression at `:244`. Old:

  ```js
    const after = rest.slice(m[0].length); // authority quirk: slice by length, not index
  ```

  New:

  ```js
    const after = rest.slice(m.index + m[0].length);
  ```

- [X] [T-003-D] Replace the comment block at `:196-202`, which currently tells future readers the defect is not a bug. Old block, verbatim:

  ```js
  // Each check returns true when it FIRES (the authority's shell functions returned 1).
  //
  // A quirk worth naming, because it looks like a bug and is not: the authority walks
  // with `after="${rest:mlen}"`, slicing by the match LENGTH from position 0 rather
  // than from the match index. For `ls; cat *.ts` the match is `; cat ` and bash's
  // `after` is `at *.ts`, not `*.ts`. P4 and P7 reproduce that exactly. "Fixing" it
  // would make the port disagree with the corpus.
  ```

  New block:

  ```js
  // Each check returns true when it FIRES (the authority's shell functions returned 1).
  //
  // The walk's contract, corrected in both subjects under [BUG-041]: `after` is the
  // text that FOLLOWS the match, sliced from `m.index + m[0].length`. The original
  // form sliced by the match LENGTH from position 0, which for a match at index N
  // shaved N bytes of real command off the front and re-scanned, walking leftward
  // until the cut landed inside a quoted region; g3Scan's fail-closed clause then
  // reported a glob that was never in the command. It cost 20 of 41 denials measured
  // in one session. The authority carries the same correction, recorded as its third
  // sanctioned exception, so the corpus still arbitrates both subjects.
  ```

- [X] [T-003-C2] **Tripwire repair, authorized 2026-09-28.** The first T-003-E run came back 854/5 instead of 855/4. The fifth failure was `tests/installer/templates.test.js > pre-tool-use wiring > ships the front door as one byte-identical mirrored pair`. The port is not one file: BUG-037 shipped it as a mirrored pair with a byte-identity parity test so the deployed copy could never drift, and this plan then reasoned about "the port" as a single file. **The parity test did its job; the file list did not.** Apply the identical two edits to `project-template/.claude/hooks/pre-tool-use.mjs`, the slice and the comment block, restoring byte identity. No new test is added: the parity assertion IS the contract guard, which is also why T-004-A stays as written. Verify with a byte comparison of the two members before re-running T-003-E.
- [X] [T-003-E] Run the suite and record the intermediate state before any row moves: `npx vitest run --reporter=basic`. **Expected: 855 passed, 4 failed** - the same two labels, now failing in **both** suites, because both subjects allow while the rows still record `deny`. The P4 row added at T-003-A is now GREEN in both, which is the port fix proving itself on the pattern with no history. This is the boundary the approval asked to see before the rows flip. Do not commit here.
- [X] [T-003-F] Flip P7-1. In `tests/fixtures/guard3-corpus.js`, change that row's `verdict: 'deny'` to `verdict: 'allow'`. The row's command text does not change.
- [X] [T-003-G] Flip P7-2 the same way.
- [X] [T-003-H] Rewrite the KNOWN-FP comment block above them (`:162-176`). It currently says the rows assert the current verdict because the authority arbitrates until a refinement flips them, and explains the preserved quirk. Replace with a block that states: the walk was corrected in both subjects under BUG-041; these two rows are the flip it was measured to produce; P7-1 needed 8 leftward iterations and P7-2 needed 23 under the old form; and the rows now pin the corrected contract rather than a known defect.
- [X] [T-003-I] Amend the P9-1 comment block (`:179-184`) so the row is visibly a pre-written acceptance rather than an oversight. Keep `verdict: 'deny'`. Add that P9-1 is **mechanism 2**, the pattern checks reading quoted text as code, that it is filed as `[BUG-043]`, and that BUG-041 deliberately left it denying.
- [X] [T-003-J] Add the two control rows, and in the SAME step change `tests/hooks/guard3.test.js:83` to `toHaveLength(114)`, per T-001-E. quoted verbatim from this session, with the comment that makes their status unambiguous:

  ```js
  // CONTROLS, not false positives. Both are genuine shell loops this repository's own
  // agent wrote, and P9 denies them by its own rule working correctly. They are here so
  // that a later refinement which silences either one is recognized as a RECALL
  // regression rather than a precision win. Whether P9 should deny a loop that dumps
  // nothing is a rule question, deliberately not answered by [BUG-041].
  { label: 'control P9: genuine for loop over task ids', command: 'cd /Users/yeison/Projects/code-conductor\nP="docs/superpowers/plans/2026-09-27-bug039-installer-host-owned-state.md"\nfor id in T-100 T-101 T-102 T-103 T-104 T-105 T-106 T-107; do\n  node scripts/conductor-db.mjs record "$P" "$id" "X" || printf \'FAILED %s\\n\' "$id"\ndone\nprintf \'batch_rc=%s\\n\' "$?"', verdict: 'deny' },
  { label: 'control P9: genuine until loop polling a PR', command: 'until [ "$(gh pr view 32 --json reviewDecision --jq .reviewDecision)" = "APPROVED" ]; do sleep 30; done; echo "APPROVED"', verdict: 'deny' },
  ```

- [X] [T-003-K] Add the three mechanism-2 KNOWN-FP rows, and in the SAME step change `tests/hooks/guard3.test.js:83` to `toHaveLength(117)`, its final value, per T-001-E. each `verdict: 'deny'`, under one comment block naming `[BUG-043]` and stating that they are pre-written acceptances inherited by that item exactly as P7-1 and P7-2 were inherited by this one:

  ```js
  { label: 'KNOWN-FP OBF: escape run inside a single-quoted grep pattern, pending [BUG-043]', command: 'grep -n -m 3 -E \'\\[ \\] \\[T-[0-9]{3,}(-[A-Z0-9]+)*\\]\' "docs/superpowers/plans/2026-09-27-bug038-handoff-contract.md"', verdict: 'deny' },
  { label: 'KNOWN-FP P5: escaped backtick inside a double-quoted grep pattern, pending [BUG-043]', command: 'grep -n "Components Affected:\\*\\* \\`.claude/hooks/pre-tool-use.mjs\\`" "AGENT-READABLE BACKLOG.md"', verdict: 'deny' },
  { label: 'KNOWN-FP P9: for-of inside a quoted node program, pending [BUG-043]', command: 'node -e "\nconst t=require(\'fs\').readFileSync(\'tests/fixtures/guard3-reference.sh\',\'utf8\');\nfor (const fn of [\'_g3_p3_xargs_reader\',\'_g3_p8_ls_recursive\',\'_g3_p12_alias\']) {\n  const i=t.indexOf(fn+\'()\');\n  const j=t.indexOf(\'\\n}\\n\', i);\n  console.log(\'=== \'+fn); console.log(t.slice(i, j+2));\n}"', verdict: 'deny' },
  ```

  Escaping in this file is load-bearing and easy to get wrong. After adding all six rows, run `node -e "import('./tests/fixtures/guard3-corpus.js').then(m => console.log('rows', m.CORPUS.length, m.DIALECT.length, m.EXCEPTIONS.length))"` from the repo root and confirm `rows 117 7 1`.

- [X] [T-003-L] Confirm the new rows say what they are meant to say, before trusting the suite. Write `<scratchpad>/verify-new-rows.mjs` that imports the corpus, selects the six new rows by label, runs each through the **stock** hook at `HEAD~1` (a copy saved before Task 2) and through the current port, and prints both verdicts. Expected: the P4 row reads `deny` then `allow`; the five others read `deny` then `deny`. A control that already allows would mean the control is not a control.
- [X] [T-003-M] Run the full suite: `npx vitest run --reporter=basic`. **Expected: 869 passed, 12 skipped, 0 failed.** 857 plus six rows across two suites.
- [X] [T-003-N] Stage and commit. Both files are tracked, so: `git add -u ".claude/hooks/pre-tool-use.mjs" "tests/fixtures/guard3-corpus.js"`. Write `<scratchpad>/msg-t003.txt` with subject `fix: carry the corrected walk into the port and the corpus [BUG-041]`, a body naming the 20-of-41 measured flip, the two rows that moved, the six added, and the restoration of green. Run `git commit -F <scratchpad>/msg-t003.txt`. The gate runs and must pass.
- [>] [T-003-O] Commit the spec-truth and plan corrections the mirror repair obligated. This lands AFTER T-003-N rather than before the repair, because the suite is red by design across the whole crossover and the single authorized bypass is spent; the first green point is the earliest a commit can carry them. The documents were corrected on disk before the work resumed, which is what the rule protects. Both files are tracked: `git add -u "docs/superpowers/specs/2026-09-28-bug041-guard3-refinement-design.md" "docs/superpowers/plans/2026-09-28-bug041-guard3-refinement.md"`. Subject `docs: name the port mirror in the BUG-041 spec and plan`, with the finding in the body: BUG-037 shipped the port as a mirrored pair with a parity test so the deployed copy could never drift; the plan then reasoned about "the port" as one file; the parity test did its job and the file list did not.

---

### Task 4: the AC10 substitute tests

**Files:**
- Modify: `tests/hooks/guard3-port.test.js`
- Modify: `tests/hooks/guard3.test.js`

**Interfaces:**
- Consumes: both fixed subjects from Tasks 2 and 3.

- [ ] [T-004-A] Add the port's contract assertion to `tests/hooks/guard3-port.test.js`, inside the existing `describe('Guard 3 port', ...)` block:

  ```js
  // The walk's correctness is not observable from a verdict: g3Scan scans the WHOLE
  // after-text, so a second iteration can never find a glob the first pass missed.
  // The contract is therefore asserted where it lives, in the source, the same way
  // tests/installer/templates.test.js pins the character-class trap.
  it('slices the glob walk from the end of the match, not by its length', () => {
    const src = readFileSync(HOOK, 'utf8');
    expect(src).toContain('rest.slice(m.index + m[0].length)');
    expect(src).not.toContain('rest.slice(m[0].length)');
  });
  ```

  `readFileSync` is already imported in this file; `HOOK` is already defined at `:10`.

- [ ] [T-004-B] Add the authority's contract assertion to the same file, so one test file holds the differential's two halves:

  ```js
  it('keeps the authority on the same corrected walk', () => {
    const ref = join(REPO_ROOT, 'tests/fixtures/guard3-reference.sh');
    const src = readFileSync(ref, 'utf8');
    expect(src).not.toContain('${rest:mlen}');
    expect(src.match(/\$\{rest:\$\{#pre\}\+\$\{#BASH_REMATCH\[0\]\}\}/g) ?? []).toHaveLength(2);
  });
  ```

  The count of 2 is load-bearing: P4 and P7 are separate functions and a regression that fixes one is the failure mode this item exists to prevent.

- [ ] [T-004-C] Add the port's termination assertion to `tests/hooks/guard3-port.test.js`:

  ```js
  // A walk that fails to advance hangs the hook, which a verdict assertion would never
  // catch: the harness would time out and report a spawn failure instead. This row is
  // built to maximize iterations, 40 pager matches with a quoted span after each.
  it('terminates on a command built to maximize walk iterations', () => {
    const command = Array.from({ length: 40 }, (_, i) => `head -1 "file ${i}.txt"`).join('; ');
    const r = runRow({ command });
    expect(r.status).toBe(0);
    expect(r.decision).toBeNull();
  });
  ```

- [ ] [T-004-D] Add the same shape to `tests/hooks/guard3.test.js`, where the bash strip form's no-progress risk actually lives, using that file's own `runRow` and its `LC_ALL=C` environment. Assert the exit status the bash harness returns for an allow, matching the convention the file's existing `assert` helper uses; read `tests/hooks/guard3.test.js:60-95` first to copy that convention exactly rather than guessing it.
- [ ] [T-004-E] Run the full suite: `npx vitest run --reporter=basic`. **Expected: 873 passed, 12 skipped, 0 failed.**
- [ ] [T-004-F] Stage and commit both tracked test files: `git add -u "tests/hooks/guard3-port.test.js" "tests/hooks/guard3.test.js"`, then `git commit -F <scratchpad>/msg-t004.txt` with subject `test: pin the corrected walk contract in both subjects [BUG-041]`.

---

### Task 5: the filings

**Files:**
- Modify: `AGENT-READABLE BACKLOG.md`

- [ ] [T-005-A] Run `node <scratchpad>/id-ceiling.mjs` and confirm both legs report. Expected: `CEILING {"BUG":42,...}` and `next BUG = BUG-043`. The script exits non-zero rather than printing a ceiling if the `origin/main` leg fails; if it does, fix that before filing anything.
- [ ] [T-005-B] File `[BUG-043]` for mechanism 2. The entry carries: the four affected checks with a verbatim specimen each (P9 commit-message prose, P9 quoted JS program, OBF escape run, P5 escaped backtick); the blanket-mask measurement and **the seven true positives it breaks** (four P6 rows, the P6 dialect row, two P12 alias rows), with the sentence that P6 and P12 inspect quoted content by design; the targeted-mask result of 36 of 43 denials with 3 of 118 corpus rows moving; the cost of a second five-state scanner in bash; and the **P7/P4 fragment quote-parity residual** recorded as the same root cause in a different check, with its `sed 's|^origin/||'` specimen.
- [ ] [T-005-C] File `[BUG-044]` for the deny-message defect. The entry carries: 47 denials with zero allowlist entries and zero `CC_GUARD3_WARN` traces; that `.claude/memory/bash-scan-allowlist.txt` exists in no installation while `pre-tool-use.mjs:433` names it as the remedy; the three candidate shapes (seed the file with its commented header at install time, which lands in BUG-039's host-owned policy table as a `seed` row; state in the message how to create it; or both); and the discoverability question as its second concern. Decision reserved for its own spec.
- [ ] [T-005-D] Close the `[BUG-041]` entry, naming what shipped and what was deliberately left: mechanism 1 fixed in both subjects, six corpus rows added, mechanism 2 and the heredoc class filed.
- [ ] [T-005-E] Stage and commit. The backlog is tracked: `git add -u "AGENT-READABLE BACKLOG.md"`, then `git commit -F <scratchpad>/msg-t005.txt` with subject `docs: close BUG-041 and file BUG-043 and BUG-044`.

---

### Task 6: release 1.31.2

**Files:**
- Modify: `VERSION`, `package.json`, `package-lock.json`, `CHANGELOG.md`, `.claude/memory/project.md`

- [ ] [T-006-A] Run `npm version 1.31.2 --no-git-tag-version`, which updates `package.json` and both `version` fields in `package-lock.json`.
- [ ] [T-006-B] Write the bare version into the `VERSION` file: `printf '1.31.2\n' > VERSION`. `lib/installer/config.mjs:38` compares against the bare file, so no decoration.
- [ ] [T-006-C] Add the `CHANGELOG.md` entry under a `## 1.31.2` heading: the walk fix in both subjects, the 20-of-41 measured flip, the six corpus rows, and the two filings.
- [ ] [T-006-D] Verify all four agree, mechanically rather than by eye. Write `<scratchpad>/version-gate.mjs` that reads `VERSION`, `package.json`, `package-lock.json` (`version` and `packages[""].version`) and the first `## ` heading in `CHANGELOG.md`, prints all five values, and exits non-zero unless every one is `1.31.2`. This is the step whose absence shipped 1.31.0 with `VERSION` still reading 1.30.0.
- [ ] [T-006-E] Run the full suite: `npx vitest run --reporter=basic`. **Expected: 873 passed, 12 skipped, 0 failed.**
- [ ] [T-006-F] Append the implementation record to `.claude/memory/project.md` under `## Implementation: BUG-041 [2026-09-28]`: every boundary hit against its prediction, whether the tripwire fired, the one bypassed gate with its authorization, the AC10 substitution with its reason, and any deviation with its classification.
- [ ] [T-006-G] Stage and commit. All five are tracked: `git add -u VERSION package.json package-lock.json CHANGELOG.md ".claude/memory/project.md"`, then `git commit -F <scratchpad>/msg-t006.txt` with subject `chore: release 1.31.2 [BUG-041]`.

---

## Test List

- [ ] [T-100] Corpus row: P7-1 flips to allow, arbitrated in both suites (T-003-F)
- [ ] [T-101] Corpus row: P7-2 flips to allow, arbitrated in both suites (T-003-G)
- [ ] [T-102] Corpus row: the P4 walk row allows, with globs before the reader and none after (T-003-A)
- [ ] [T-103] Corpus rows: both genuine loops still deny (T-003-J)
- [ ] [T-104] Corpus rows: the three mechanism-2 specimens still deny (T-003-K)
- [ ] [T-105] Contract: the port slices from the match end (T-004-A)
- [ ] [T-106] Contract: the authority carries the corrected form in both walk functions (T-004-B)
- [ ] [T-107] Termination: the port returns a verdict on a 40-pager command (T-004-C)
- [ ] [T-108] Termination: the authority returns a verdict on the same shape (T-004-D)
- [ ] [T-109] Unchanged: `EXCEPTIONS` still has exactly one member (existing test, must stay green throughout)

## Commit Order

1. **T-000-B** the plan. Green.
2. **T-002-E** the authority alone, header amended. **Red by design: 2 failures, authority suite only, gate bypassed once under Ruling 1.**
3. **T-003-N** the port and the corpus rows. Green at 869.
4. **T-004-F** the contract and termination tests. Green at 873.
5. **T-005-E** the filings. Green.
6. **T-006-G** the release. Green.

## Identified Risks

**Risk 1. The bash substitution behaves differently from the prototype inside the real file.** `set -euo pipefail` is active and the walk runs inside a `local` scope. T-001-C runs the form in a full copy of the real file, not in a fragment, so the prototype and the target are the same program.

**Risk 2. The two walk bodies are byte-identical, so an `Edit` hits the wrong one or both.** T-002-A and T-002-B require either unique surrounding context per edit or an explicit count assertion before a `replace_all`. T-004-B's count of 2 catches a half-applied fix permanently.

**Risk 3. The bypassed gate becomes a habit.** The bypass at T-002-E was **authorized explicitly in the approval message of 2026-09-28**, as a sanctioned exception with five binding conditions recorded under Ruling 1: manual suite run first, verbatim failure list in the commit body, one commit only, the halt conditions standing, and the exception belonging to the commit rather than to the hook. `.git/hooks/pre-commit` is never weakened, edited or disabled. The very next commit runs the gate normally, and any second bypass halts the plan and returns to the developer.

**Risk 4. Escaping in the new corpus rows silently changes the command under test.** Five of the six new rows contain nested quotes, backslashes or newlines. T-003-L runs every new row through both the pre-fix and post-fix hooks and asserts the verdict pair, so a mangled command shows up as a wrong verdict rather than as a row that quietly tests something else.

**Risk 5. A control row stops being a control.** If `for id in ...; do` or the `until` poller ever allows, precision was bought with recall. T-003-L asserts `deny` on both against the current port before the suite ever runs.

**Risk 6. The release ships with the version files disagreeing, again.** T-006-D is a script that exits non-zero, not a visual check. It reads all five locations, including `packages[""].version`, which is the field `npm version` updates separately.

**Risk 7. The plan's predicted counts drift because this session keeps generating denials.** The corpus predictions (855, 869, 873) are independent of the session; only T-001-D's denial count can move. That step reports a difference without halting, and the corpus count halts.
