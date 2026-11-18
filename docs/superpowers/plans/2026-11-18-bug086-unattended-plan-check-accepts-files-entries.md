# BUG-086 unattended plan check accepts Files entries with characters outside printable ASCII implementation plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Update one checkbox per edit (BUG-003 invariant). Execute in file order.

**Goal:** In `inSurface` (`scripts/orchestrate.mjs`), escalate with the write-surface reason any plan **Files:** entry that holds a character outside 0x20-0x7E, testing the entry before `taskGlob` strips `./` and lower-cases it. Add the U50 (escalate) and U51 (approve) rows for AC1-AC5.

**Spec:** `docs/superpowers/specs/2026-11-18-bug086-unattended-plan-check-accepts-files-entries-design.md` (sha256 `592cd0b69a192cdedec5d75db18ee28080b0532be52894d0004b68b99b87871d`). Issue #240.

**Test command:** `npm test`. Filtered runs use `npx vitest run <file>` and `-t <pattern>`.

## Global Constraints

- No release records: `VERSION`, the `package.json` / `package-lock.json` version, `CHANGELOG.md`, `AGENT-READABLE BACKLOG.md`, `.claude/memory/**` and the README "Known limits" lines stay untouched.
- **One predicate, one disjunct.** In `scripts/orchestrate.mjs`, the only code change is a new `nonAscii` predicate next to `ntfsAlias` and one more disjunct in `inSurface`. The only other edit is the comment above `inControlPlane`. `WRITE_SURFACE`, `CONTROL_PLANE`, `globToRegExp`, `reachesDir`, `reachesList`, `taskGlob`, `ntfsAlias`, `inControlPlane`'s body, `surfaceTask`, `extractTasks` and the reason text stay as shipped (spec, Solution and Out of Scope).
- **Hook untouched.** `.claude/hooks/pre-tool-use.mjs`, its `ORCH_WRITE_SURFACE` copy, `project-template/**` and the installer are not edited (spec, Out of Scope).
- **Existing rows unchanged.** U22 and U41-U49 and the `expectEscalation` helper are not edited (AC6). The test file only gets additions.
- **No workflow written.** `.github/workflows/` appears only as a string in a test row.
- No new dependency, no network, no settings, command or SNAP-script change; `tools/skip-baseline.json` untouched.
- Every file this plan edits after Task 0 (`scripts/orchestrate.mjs`, `tests/scripts/orchestrate.test.js`, this plan) is tracked, so every staging step is `git add -u <path>` with an explicit path.

## Plan decisions

1. **Code shape.** Read at `scripts/orchestrate.mjs:1077-1085` (HEAD `28482e3`). After the `ntfsAlias` line, add:

   ```js
   // Outside printable ASCII, no lexical test can tell which file a filesystem or tool resolves; tested before taskGlob
   // folds case, because toLowerCase maps some of these characters to ASCII (U+212A KELVIN SIGN to `k`).
   const nonAscii = (entry) => /[^\x20-\x7e]/.test(entry);
   ```

   and change `inSurface`'s return to `return nonAscii(entry) || ntfsAlias(glob) || reachesList(glob, WRITE_SURFACE);`. `const glob = taskGlob(entry);` stays the first line; `nonAscii` takes the `entry` parameter, not `glob`, which is what "before lower-casing" means here. The comment above `inControlPlane` becomes `// No alias or non-ASCII test: surfaceTask runs inSurface first, and it escalates every alias and every non-ASCII entry.`
2. **Where the `./` strip happens.** `extractTasks` (`scripts/orchestrate.mjs:255`) already strips a leading `./` before `inSurface` sees the entry, so the reason names the entry without it. `nonAscii` does not depend on either strip (AC4), and the existing `expectEscalation` builds its reason from `path.replace(/^\.\//, '')`, so the `./` row needs no special helper.
3. **Every row measured before writing this plan.** A throwaway script (deleted) evaluated the shipped `extractTasks`, `globToRegExp` … `inControlPlane` source, with and without the new disjunct, for every row below. Today: 11 of the 14 U50 rows approve and 3 (`.claude/hooks/pre-tool-use\uFF0Emjs`, `.github/workflows/ci\t.yml`, `pac\u212Aage.json`) escalate with the control-plane reason. With the change, all 14 escalate with the write-surface reason, naming the entry exactly as declared (minus `./`). The 4 U51 rows approve both before and after.
4. **Test placement and escapes.** The two new `it.each` blocks go right after U49 (`tests/scripts/orchestrate.test.js:3759-3766`), inside the same `describe`. Every non-ASCII or control character is written as a `\u` escape (`\t` for TAB) in the test source, as the spec's System Impact asks. U50 calls `expectEscalation(path, 'orchestrator write surface')`; U51 repeats the four-line U43/U48 body, so no existing helper or row changes.
5. **No lone-surrogate row.** The spec's Error cases note that `[^\x20-\x7e]` matches a lone surrogate. A row cannot test that end to end: the test writes the plan with `writeFileSync` as UTF-8, which turns a lone surrogate into U+FFFD, so the reason would not name the declared literal. U+FFFD is still outside the range, so such a plan still escalates; the astral row (U+1F4E6, a surrogate pair) covers code points above the BMP.
6. **One commit.** Tests and code land together (Task 3): a tests-only commit would be red. The red run in T-104 happens in the working tree before the code edit.
7. **`.gitignore` leaf.** `!/docs/superpowers/plans/2026-11-18-bug086-unattended-plan-check-accepts-files-entries.md` goes after the `2026-11-18-bug084` plan leaf and before the first spec leaf, the sorted position; `tests/unit/gitignore-block-parity.test.js` checks it.

## Baseline (measured on this branch, HEAD 28482e3)

- `npx vitest run tests/scripts/orchestrate.test.js -t "U49 |U43 "`: **13 passed, 758 skipped (771)**. The file holds 771 tests; no test name contains `BUG-086`, `U50` or `U51`.

## Test rows

### U50 (AC1-AC4): escalate with the write-surface reason (14 rows)

Written exactly as below in the test source (JavaScript string escapes):

| Row | List it spells | Depth | Character |
|---|---|---|---|
| `'.conductor\u200B/x'` | `WRITE_SURFACE` | root | U+200B zero width space |
| `'.claude/memory/band-envelope.json\u200B'` | `WRITE_SURFACE` | nested | U+200B |
| `'.claude/memory/orchestrator-run\u00E9.json'` | `WRITE_SURFACE` | nested | U+00E9 Latin-1 letter |
| `'package.json\u200B'` | `CONTROL_PLANE` | root | U+200B |
| `'CLAUDE\u2024md'` | `CONTROL_PLANE` | root | U+2024 one dot leader |
| `'.npmrc\u001F'` | `CONTROL_PLANE` | root | 0x1F, top of C0 |
| `'opencode.json\u0080'` | `CONTROL_PLANE` | root | 0x80, first code point above DEL |
| `'.mcp\u{1F4E6}.json'` | `CONTROL_PLANE` | root | U+1F4E6, astral |
| `'.claude/hooks/pre-tool-use\uFF0Emjs'` | `CONTROL_PLANE` | nested | U+FF0E fullwidth full stop |
| `'.github/workflows/ci\t.yml'` | `CONTROL_PLANE` | nested | TAB, 0x09 |
| `'scripts/orchestrate\u007F.mjs'` | `CONTROL_PLANE` | nested | DEL, 0x7F |
| `'docs/r\u00E9sum\u00E9.md'` | none (AC2) | nested | U+00E9 |
| `'pac\u212Aage.json'` | `CONTROL_PLANE` once lower-cased (AC3) | root | U+212A kelvin sign |
| `'./package.json\u200B'` | `CONTROL_PLANE` (AC4) | root | U+200B, leading `./` |

### U51 (AC5): printable ASCII keeps the delegated APPROVE (4 rows)

`'src/a.js'`, `'docs/notes.md'`, `'docs/my notes.md'` (0x20 inside), `'docs/a!b.md'` (0x21).

---

### Task 0: Commit this plan

**Files:**
- Create: `docs/superpowers/plans/2026-11-18-bug086-unattended-plan-check-accepts-files-entries.md`
- Modify: `.gitignore`

- [X] [T-001] Create this plan file from the approved spec `592cd0b6…`. No dependency.
- [X] [T-002] `.gitignore`: insert the leaf `!/docs/superpowers/plans/2026-11-18-bug086-unattended-plan-check-accepts-files-entries.md` after the `2026-11-18-bug084` plan leaf (plan decision 7). Depends on T-001.
- [X] [T-003] Stage: `git add -u .gitignore` (tracked) and `git add docs/superpowers/plans/2026-11-18-bug086-unattended-plan-check-accepts-files-entries.md` (new; re-included by its leaf, so no ignored ancestor applies). Depends on T-002.
- [X] [T-004] Commit: `docs: plan the non-ASCII escalation for the unattended plan check [BUG-086]`. Depends on T-003.

---

### Task 1: Tests first (red)

**Files:**
- Modify: `tests/scripts/orchestrate.test.js`

- [X] [T-101] Add a one-line comment after U49 (ends near line 3766): `// BUG-086: an entry outside printable ASCII escalates with the write-surface reason, whatever list it spells; characters are \u escapes.` Depends on T-004.
- [X] [T-102] Add after that comment `it.each([...U50 rows])('U50 [BUG-086 AC1-AC4] delegate plan over an APPROVE report escalates the entry outside printable ASCII %j with the write-surface reason', (path) => { expectEscalation(path, 'orchestrator write surface'); });` with the 14 U50 rows in table order. `%j` prints the row JSON-escaped, so the test name shows the invisible character. Depends on T-101.
- [X] [T-103] Add after U50 `it.each([...U51 rows])('U51 [BUG-086 AC5] delegate plan over an APPROVE report approves the printable-ASCII entry %s', (path) => { … })` with the 4 U51 rows and the U43 body verbatim: `atPlan();`, `plan(\`# Demo Plan\n\n${task(1, ['src/a.js'])}\n${task(2, [path])}\n## Test List\n\`);`, `expect(delegateDoc('plan')).toEqual({ status: 0, out: \`plan approved by delegated review: define_approved, 2 task(s); sha256 ${sha(PLAN)}\`, err: '' });`, `expect(runFile().approvals.plan.by).toBe('define-review');`. Depends on T-102.
- [X] [T-104] Red run: `npx vitest run tests/scripts/orchestrate.test.js -t "BUG-086"`. Predicted for the filter's full match set: **14 failed, 4 passed, 771 skipped (789)**. Failing: all 14 U50 rows (11 approved, 3 escalated with the control-plane reason, plan decision 3). Passing: the 4 U51 rows. No existing test name contains `BUG-086`, so nothing else matches. Any other count means a row is mistyped: fix the row, not the prediction. Depends on T-103.

---

### Task 2: The non-ASCII disjunct (green)

**Files:**
- Modify: `scripts/orchestrate.mjs`

- [X] [T-201] Modify `scripts/orchestrate.mjs`: after the `const ntfsAlias = …` line, add the two comment lines and the `nonAscii` predicate of plan decision 1. Depends on T-104.
- [X] [T-202] Modify `inSurface`: its return becomes `return nonAscii(entry) || ntfsAlias(glob) || reachesList(glob, WRITE_SURFACE);`. Depends on T-201.
- [X] [T-203] Modify the comment above `inControlPlane` to the text of plan decision 1. Depends on T-202.
- [X] [T-204] Green run: the T-104 command. Predicted: **18 passed, 771 skipped (789)**, no failure. Depends on T-203.
- [X] [T-205] AC6 run: `npx vitest run tests/scripts/orchestrate.test.js -t "BUG-080|BUG-081|U22 |write surface"`. Predicted: **165 passed, 624 skipped (789)**, the BUG-081 green count with 18 more skipped tests. Depends on T-204.

---

### Task 3: Full suite, scope check and commit

**Files:**
- Modify: `scripts/orchestrate.mjs`, `tests/scripts/orchestrate.test.js` (staged), this plan (checkboxes)

- [X] [T-301] Run `npm test`. Predicted locally: exit 0, every file green (AC6). CI legs run 18 more tests each, none skipped, so `tools/skip-baseline.json` stays untouched. A failure that comes from the sandbox (network, tmp permissions) is reported as ENV with the test's name; any other red is fixed. Depends on T-205.
- [X] [T-302] Scope check: `git status --porcelain` lists exactly `scripts/orchestrate.mjs`, `tests/scripts/orchestrate.test.js` and this plan as modified; `git diff -U0 HEAD -- tests/scripts/orchestrate.test.js | grep '^-[^-]'` is empty (no existing row or helper changed); `git diff -U0 HEAD -- scripts/orchestrate.mjs | grep '^-[^-]'` shows exactly two lines, the old `inSurface` return and the old `inControlPlane` comment; `git diff --quiet HEAD -- VERSION CHANGELOG.md package.json package-lock.json README.md "AGENT-READABLE BACKLOG.md" .claude .github project-template tools` exits 0. Depends on T-301.
- [X] [T-303] Stage: `git add -u scripts/orchestrate.mjs tests/scripts/orchestrate.test.js` (both tracked). Depends on T-302.
- [X] [T-304] Stage: `git add -u docs/superpowers/plans/2026-11-18-bug086-unattended-plan-check-accepts-files-entries.md` (ticks T-101 to T-303). Depends on T-303.
- [X] [T-305] Commit: `fix: escalate unattended plan entries outside printable ASCII [BUG-086]`. Depends on T-304.

---

## Test List

- [X] Integration, AC1: U50 rows at the root and nested, spelled from `WRITE_SURFACE` and `CONTROL_PLANE` entries, escalate with the write-surface reason; `approvals.plan` stays `null`, `delegated.plan` records the verdict and reason, and the owner's `approve plan` exits 0 (`expectEscalation`; T-102).
- [X] Integration, AC2: U50 covers TAB, 0x1F, DEL, 0x80, U+00E9, U+200B, U+FF0E, an astral character, and `docs/r\u00E9sum\u00E9.md`, which matches no list (T-102).
- [X] Integration, AC3: U50 row `pac\u212Aage.json` names the write surface, not the control plane (T-102).
- [X] Integration, AC4: U50 row `./package.json\u200B` escalates and the reason names the entry without `./` (T-102).
- [X] Integration, AC5: U51, 4 printable-ASCII rows keep the delegated APPROVE (T-103).
- [X] AC6: U22 and U41-U49 unchanged and green (T-205, T-302); `npm test` green (T-301).
- [ ] No E2E/UI test: there is no UI.

## Commit Order

0. Task 0: this plan and its `.gitignore` leaf (done by this session's commit).
1. Tasks 1-3: one commit, T-305, carrying the predicate, the tests and the ticks T-101 to T-303 (plan decision 6). Tasks 1 and 2 have no commit of their own: a tests-only commit would be red. The ticks of T-304 and T-305 are made after the last commit and ride whichever commit next stages this plan.

## Identified Risks

- **A mistyped escape reads as a matcher bug.** T-104 predicts the exact red count; every row was evaluated against the shipped parser and matcher (plan decision 3). A row typed as the literal character instead of its escape still works but breaks the spec's readability rule; T-302's diff review catches it.
- **The test runs on `glob` instead of `entry`.** Then `pac\u212Aage.json` lower-cases to `package.json` and escalates with the control-plane reason; the AC3 row fails in T-204.
- **Control characters in the reason.** The reason carries TAB, DEL and 0x1F into stdout and the run file. `toEqual` compares exact strings, and `JSON.stringify` escapes them in the run file, so the run file stays valid JSON (spec, Error cases).
- **Line-terminator characters.** `extractTasks` splits on `\r?\n`, and its entry regex `(.*)` does not cross U+2028/U+2029, so an entry holding them is cut there. No row uses them; the cut remainder is still checked as typed, and the spec does not ask for them.
- **Friction on later items.** Any unattended plan that declares an honest non-ASCII path (for example `docs/r\u00E9sum\u00E9.md`) now waits for the owner. The spec accepts that cost (Choices, "Which entries").
- **This item's own plan.** `scripts/orchestrate.mjs` is a `CONTROL_PLANE` entry, so an unattended review of this plan escalates; that is expected (spec, System Impact).
- **Line numbers drift.** References are from HEAD `28482e3`; locate by the quoted text if they move.
