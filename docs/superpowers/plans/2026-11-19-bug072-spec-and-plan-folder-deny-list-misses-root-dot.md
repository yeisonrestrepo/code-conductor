# BUG-072 Reserve root dot-directories and bin, lib, tools as spec and plan folders: implementation plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Update one checkbox per edit (BUG-003 invariant). Execute in file order.

**Goal:** `checkDocDir` refuses a recorded `- Specs:` or `- Plans:` folder whose first segment is a root dot-directory other than `.claude` (with the reason ``sits in the root dot-directory `<segment>`; among root dot-directories only `.claude/specs` and `.claude/plans` may hold documents``), and refuses `bin`, `lib` and `tools` through `RESERVED` (``sits in the reserved `<entry>` ``). Every reason it gives today stays byte for byte, and ordinary folders (`docs/specs`, `design/plans`, `binx`, `docs/.vscode`) stay accepted.

**Spec:** `docs/superpowers/specs/2026-11-19-bug072-spec-and-plan-folder-deny-list-misses-root-dot-design.md` (sha256 `2ee231553014c800dda90122bcea490a660f0af66def6d3711c0830f0b63659b`). Issue #161.

**Test command:** `npm test`. Filtered runs use `npx vitest run <file>` and `-t '<pattern>'`.

## Global Constraints

- No release records: `VERSION`, the `package.json` / `package-lock.json` version, `CHANGELOG.md`, `AGENT-READABLE BACKLOG.md`, `.claude/memory/**` and the README "Known limits" line for BUG-072 (`README.md:501`) stay untouched (spec, Out of Scope).
- **Three files change, plus this plan and its `.gitignore` leaf:** `scripts/doc-locations.mjs`, `tests/scripts/doc-locations.test.js`, `tests/scripts/orchestrate.test.js`. No hook, installer file, SNAP script, settings file, workflow or dependency changes. The installer's script list (`scripts/orchestrate.mjs:39` and the matching test lists) already names `doc-locations.mjs` and does not change (spec, System Impact).
- `scripts/doc-locations.mjs` is in `CONTROL_PLANE` (`scripts/orchestrate.mjs`), so a delegated plan check of this plan escalates its tasks; that is the shipped behavior and needs nothing from this plan. The change only narrows what a recorded line may name: it adds no network access and widens no installed permission.
- The public exports of `scripts/doc-locations.mjs` (`CANDIDATE_PAIRS`, `DEFAULT_PAIR`, `GROUP_MAX`, `DIR_MAX`, `DocLocationError`, `checkDocDir`, `readRecordedPair`, `discoverPair`, `backlogGroup`, `resolveDocLocations`) keep their names and shapes. Its only importer is `scripts/orchestrate.mjs` (`resolveDocLocations`).
- Every file this plan edits after Task 0 is already tracked and none sits under an ignored directory, except this plan. It is under the ignored `docs/superpowers/plans/`, is new in Task 0 (so `git add -f`), and is tracked afterwards and re-included by its leaf (so `git add -u`).
- Existing assertions on reasons stay unchanged (spec, AC5): the `recorded errors [FEAT-047]` table (`tests/scripts/doc-locations.test.js:133-159`), `names the reserved folder a parent covers` (`:228-231`) and the review #120 case in `tests/scripts/orchestrate.test.js:1344-1350` are not edited. Only the two rows the spec names change on purpose (plan decision 5).

## Files read in full (spec, Files Requiring Full Read)

The spec defers none. Read for this plan:

- `scripts/doc-locations.mjs:1-90`: the `RESERVED` comment and list (`:26-31`), `CLAUDE_DOCS` (`:32`), `underRoot` / `overlaps` (`:46-47`), `reservedReason` (`:49-61`) and `checkDocDir` (`:63-76`). The syntax checks in `checkDocDir` run before `reservedReason`, so `.`, `..`, empty and `.` segments never reach the new rule.
- `tests/scripts/doc-locations.test.js:1-20` (imports; `checkDocDir`, `CANDIDATE_PAIRS`, `DEFAULT_PAIR` are imported) and `:133-238` (the `recorded errors`, `checkDocDir boundary` and `checkDocDir reserved folders` blocks).
- `tests/scripts/orchestrate.test.js:1255-1350`: the `recorded` and `halts` helpers (`:1264-1270`; `halts` runs `start FEAT-012`, expects exit 1 and a stderr starting with the code) and the `[AC9]` cases.

## Plan decisions

1. **`RESERVED` (`scripts/doc-locations.mjs:31`).** Becomes:
   ```js
   const RESERVED = ['.claude/memory', '.claude/hooks', '.claude/agents', '.claude/commands', '.claude/scripts', '.conductor', '.git', '.github', '.opencode', 'bin', 'lib', 'scripts', 'tools'];
   ```
   `bin` and `lib` go before `scripts` and `tools` after it, keeping the non-dot tail sorted. Order does not change any reason: no new entry overlaps an existing one, and `find` returns the first overlap. The existing dot entries stay (spec, Solution: their more specific reasons are kept).
2. **The comment above `RESERVED` (`:26-30`).** Replaced by:
   ```js
   // A recorded folder becomes the spec and plan agents' Guard 5 write scope, so it may not cover
   // the orchestrator write surface, git internals, any folder that holds enforcement code
   // (`.opencode` holds the OpenCode guard), or a conventional code folder (`bin`, `lib`, `tools`).
   // Inside `.claude`, only specs and plans may hold documents: everything else there is agent
   // instructions or configuration (skills, settings, rules), so that rule is an allowlist, not
   // this deny list. Every other root dot-directory is refused as a class (BUG-072): tools run
   // what `.husky`, `.vscode` or `.devcontainer` hold on their own, and the class is open-ended,
   // so no list of names can close it.
   ```
3. **The root dot-directory rule (`reservedReason`, after the `.claude` allowlist `if` and before `return '';`):**
   ```js
     const rootSegment = folded.split('/')[0];
     if (rootSegment.startsWith('.') && rootSegment !== '.claude') {
       return `sits in the root dot-directory \`${rootSegment}\`; among root dot-directories only \`.claude/specs\` and \`.claude/plans\` may hold documents`;
     }
   ```
   It runs on the case-folded value, so the reason quotes the folded segment (spec, Alternative paths). It runs last, so a `RESERVED` or `.claude` refusal keeps its reason (AC5). A value under `.claude/specs` or `.claude/plans` passes both earlier rules and is skipped here because its segment is `.claude` (AC3). `reservedReason` grows from 12 to 16 lines.
4. **New `checkDocDir` rows (`tests/scripts/doc-locations.test.js`),** inside `describe('checkDocDir reserved folders [FEAT-047 AC9, review #120]')`, after the trailing `'still accepts %s'` table (ends `:237`) and before the block's closing `});` (`:238`). Two local helpers sit at the top of the inserted rows, so every assertion compares the whole reason:
   ```js
   const dotReason = (seg) => `sits in the root dot-directory \`${seg}\`; among root dot-directories only \`.claude/specs\` and \`.claude/plans\` may hold documents`;
   const reservedText = (entry) => `sits in the reserved \`${entry}\``;
   ```
   - **R1 (AC1), 9 rows:** `it.each([['.husky', '.husky'], ['.vscode', '.vscode'], ['.devcontainer', '.devcontainer'], ['.husky/specs', '.husky'], ['.vscode/plans/x', '.vscode'], ['.circleci', '.circleci'], ['.idea', '.idea'], ['.Husky', '.husky'], ['.VSCode/specs', '.vscode']])('[BUG-072] rejects %s in the root dot-directory %s', (value, seg) => expect(checkDocDir(value)).toBe(dotReason(seg)))`.
   - **R2 (AC2), 8 rows:** `it.each([['bin', 'bin'], ['lib', 'lib'], ['tools', 'tools'], ['bin/specs', 'bin'], ['lib/plans', 'lib'], ['tools/x', 'tools'], ['BIN', 'bin'], ['Tools', 'tools']])('[BUG-072] rejects %s in the reserved %s', (value, entry) => expect(checkDocDir(value)).toBe(reservedText(entry)))`.
   - **R3 (AC4), 11 rows:** `it.each(['docs/specs', 'design/plans', 'binx', 'libraries', 'toolsx', 'scriptsx', 'docs/bin', 'docs/lib', 'docs/tools', 'docs/scripts', 'docs/.vscode'])('[BUG-072] still accepts the ordinary folder %s', (value) => expect(checkDocDir(value)).toBe(''))`.
   - **R4 (AC5), 1 row:** `it('[BUG-072] keeps the reserved and .claude reasons for folders the new rule also covers', …)` asserting, by `toBe`: `.git/x` → ``sits in the reserved `.git` ``; `.github` → ``sits in the reserved `.github` ``; `.conductor` → ``sits in the reserved `.conductor` ``; `.opencode` → ``sits in the reserved `.opencode` ``; `.claude/hooks` → ``sits in the reserved `.claude/hooks` ``; `.claude` → ``covers the reserved `.claude/memory` `` (the first `RESERVED` entry it covers); `.claude/skills` → ``sits in `.claude`, where only `.claude/specs` and `.claude/plans` may hold documents``.
   - **R5 (AC6), 3 rows:** `it.each(['.conductorx', '.githubx', '.opencodex'])('[BUG-072] rejects the look-alike root dot-directory %s', (value) => expect(checkDocDir(value)).toBe(dotReason(value)))`.
   - **AC3** is already pinned and needs no new row: `accepts every fixed pair, each disjoint` (`:172-180`, every `CANDIDATE_PAIRS` entry and `DEFAULT_PAIR`) and the `'still accepts %s'` table at `:218-222` (`.claude/specs`, `.claude/plans`, `.claude/specs/pillar-1`, `.Claude/Specs`, `.CLAUDE/plans/x`, `docs/specs`). Both stay green unedited, which is the AC.
5. **The two rows that change on purpose (spec, AC6).**
   - `'compares reserved roots segment-wise'` (`:182-189`): the comment (`:183-184`) becomes `// .conductorx is a root dot-directory, refused since BUG-072, so the segment-wise acceptance of a reserved root is pinned on scriptsx and binx, and of a root-only rule on docs/.vscode.`; `expect(checkDocDir('.conductorx')).toBe('');` (`:185`) becomes `expect(checkDocDir('.conductorx')).toMatch(/root dot-directory `\.conductorx`/);`, followed by three new lines `expect(checkDocDir('scriptsx')).toBe('');`, `expect(checkDocDir('binx')).toBe('');` and `expect(checkDocDir('docs/.vscode')).toBe('');`. The other three expectations stay.
   - The trailing `'still accepts %s'` table (`:233`): `'.githubx', '.opencodex'` are replaced by `'binx', 'docs/.vscode'`, so it reads `['.claude/specs', '.claude/plans', 'docs/scripts', 'scriptsx', 'binx', 'docs/.vscode', 'docs/specs/']`. Its row count stays 7; `.githubx` and `.opencodex` move to R5.
6. **End-to-end rows (`tests/scripts/orchestrate.test.js`, AC7),** directly after the review #120 case (ends `:1350`), using the block's `recorded` and `halts` helpers:
   ```js
   it.each([
     ['root dot-directory', '.husky', 'rec/plans', '`- Specs: .husky`', '`.husky`'],
     ['tools folder', 'rec/specs', 'tools', '`- Plans: tools`', 'reserved `tools`'],
   ])('[BUG-072] halts start on a recorded %s and records no run', (_, specs, plans, line, folder) => {
     recorded(specs, plans);
     const r = halts('ORCH_DOC_LOCATION_INVALID');
     expect(r.err).toContain(line);
     expect(r.err).toContain(folder);
     expect(existsSync(join(root, RUN_FILE))).toBe(false);
   });
   ```
7. **Red predictions, reasoned against the current code.** Today `reservedReason` returns `''` for every R1, R2 and R5 value (none overlaps a `RESERVED` entry and none is under `.claude`), so those 20 rows are **red**, and so is the edited `'compares reserved roots segment-wise'` (`.conductorx` is accepted today). R3, R4, the edited trailing table (`binx` and `docs/.vscode` are accepted today) and every other row are **green**. In `orchestrate.test.js`, both AC7 rows are **red**: `.husky` and `tools` are accepted, so `start` does not exit 1 with `ORCH_DOC_LOCATION_INVALID`.
8. **`.gitignore` leaf.** `!/docs/superpowers/plans/2026-11-19-bug072-spec-and-plan-folder-deny-list-misses-root-dot.md` goes directly after the `2026-11-19-bug069` plan leaf and before the `2026-11-19-bug075` plan leaf, the full-path sort order of the block (BUG-042).

## Baseline (measured on this branch, HEAD ad40394, Node v24.22.2)

- `npx vitest run tests/scripts/doc-locations.test.js`: **103 passed (103)**.
- `npx vitest run tests/scripts/doc-locations.test.js -t 'checkDocDir'`: **47 passed | 56 skipped (103)**.
- `npx vitest run tests/scripts/orchestrate.test.js -t 'halts start on'`: **4 passed | 1119 skipped (1123)** (the three `[AC9] halts start on %s` rows and the review #120 case).

---

### Task 0: Commit this plan

**Files:**
- Create: `docs/superpowers/plans/2026-11-19-bug072-spec-and-plan-folder-deny-list-misses-root-dot.md`
- Modify: `.gitignore`

- [X] [T-001] Create this plan file from the approved spec `2ee23155…`. No dependency.
- [X] [T-002] `.gitignore`: insert the leaf of plan decision 8 after the `2026-11-19-bug069` plan leaf. Depends on T-001.
- [X] [T-003] Stage: `git add -u .gitignore` (tracked) and `git add -f docs/superpowers/plans/2026-11-19-bug072-spec-and-plan-folder-deny-list-misses-root-dot.md` (new, under the ignored `docs/superpowers/plans/`). Depends on T-002.
- [X] [T-004] Commit: `docs: plan reserving root dot-directories and bin, lib, tools as doc folders [BUG-072]`. Depends on T-003.

---

### Task 1: Tests first (red)

**Files:**
- Modify: `tests/scripts/doc-locations.test.js`
- Modify: `tests/scripts/orchestrate.test.js`

- [X] [T-101] `tests/scripts/doc-locations.test.js:182-189`: edit `'compares reserved roots segment-wise'` as plan decision 5 says (comment, `.conductorx` refused, `scriptsx`, `binx` and `docs/.vscode` accepted). Depends on T-004.
- [X] [T-102] `tests/scripts/doc-locations.test.js:233`: replace `'.githubx', '.opencodex'` with `'binx', 'docs/.vscode'` in the trailing `'still accepts %s'` table (plan decision 5). Depends on T-101.
- [X] [T-103] `tests/scripts/doc-locations.test.js`: insert `dotReason`, `reservedText` and rows R1 to R5 after the trailing table, inside `checkDocDir reserved folders` (plan decision 4). Depends on T-102.
- [X] [T-104] `tests/scripts/orchestrate.test.js`: insert the AC7 `it.each` after the review #120 case (plan decision 6). Depends on T-103.
- [X] [T-105] Red run: `npx vitest run tests/scripts/doc-locations.test.js -t 'checkDocDir'`. Its full match set is every row of the `checkDocDir boundary` and `checkDocDir reserved folders` blocks: the 47 baseline rows (one of them edited) plus the 32 new rows (R1 9, R2 8, R3 11, R4 1, R5 3). Predicted: **21 failed | 58 passed | 56 skipped (135)**. Red: R1 (9), R2 (8), R5 (3) and `compares reserved roots segment-wise`. Green: the other 46 baseline rows (including the edited trailing table), R3 (11) and R4 (plan decision 7). Any other split means a test is wrong: fix the test, not the prediction. Depends on T-104.
- [X] [T-106] Red run: `npx vitest run tests/scripts/orchestrate.test.js -t 'halts start on'`. Its full match set is the 4 baseline rows plus the 2 AC7 rows. Predicted: **2 failed | 4 passed | 1119 skipped (1125)**. Red: both `[BUG-072] halts start on a recorded …` rows. Green: the three `[AC9] halts start on %s` rows and the review #120 case. Depends on T-105.

---

### Task 2: Reserve the folders (green)

**Files:**
- Modify: `scripts/doc-locations.mjs`

- [X] [T-201] `scripts/doc-locations.mjs:26-30`: replace the comment above `RESERVED` (plan decision 2). Depends on T-106.
- [X] [T-202] `scripts/doc-locations.mjs`, `RESERVED`: add `bin`, `lib` and `tools` (plan decision 1). Depends on T-201.
- [X] [T-203] `scripts/doc-locations.mjs`, `reservedReason`: add the root dot-directory rule after the `.claude` allowlist (plan decision 3). Depends on T-202.
- [X] [T-204] Green run: the T-105 command. Predicted: **79 passed | 56 skipped (135)**. Depends on T-203.
- [X] [T-205] Green run: the T-106 command. Predicted: **6 passed | 1119 skipped (1125)**. Depends on T-204.
- [X] [T-206] Run: `npx vitest run tests/scripts/doc-locations.test.js`. Predicted: **135 passed (135)**; this includes the unedited `recorded errors [FEAT-047]` table and the `names the reserved folder a parent covers` case (AC5). Depends on T-205.

---

### Task 3: Full suite, scope check and commit

**Files:**
- Modify: `docs/superpowers/plans/2026-11-19-bug072-spec-and-plan-folder-deny-list-misses-root-dot.md` (ticks)

- [X] [T-301] Run `npm test`. Predicted: exit 0 (spec, AC8). A red is called ENV only if the sandbox caused it (network, tmp permissions) and its file is not one this plan touches; report it with its name. Any other red is fixed. Depends on T-206.
- [X] [T-302] Scope check: `git status --short` lists exactly `scripts/doc-locations.mjs`, `tests/scripts/doc-locations.test.js`, `tests/scripts/orchestrate.test.js` and this plan, and no temporary file is left in the tree. Depends on T-301.
- [X] [T-303] Stage: `git add -u scripts/doc-locations.mjs tests/scripts/doc-locations.test.js tests/scripts/orchestrate.test.js` (all tracked). Depends on T-302.
- [X] [T-304] Stage: `git add -u docs/superpowers/plans/2026-11-19-bug072-spec-and-plan-folder-deny-list-misses-root-dot.md` (carries the ticks for T-101 to T-303). Depends on T-303.
- [X] [T-305] Commit: `fix: reserve root dot-directories and bin, lib, tools as spec and plan folders [BUG-072]`. Depends on T-304.

---

## Test List

- [ ] Unit: `checkDocDir` refuses root dot-directories other than `.claude`, with the folded segment in the reason (R1, R5; AC1, AC6).
- [ ] Unit: `checkDocDir` refuses `bin`, `lib`, `tools` and their case variants and subfolders as reserved (R2; AC2).
- [ ] Unit: `.claude/specs`, `.claude/plans`, every fixed pair and `DEFAULT_PAIR` stay accepted (existing rows; AC3).
- [ ] Unit: ordinary and look-alike folders stay accepted (R3, edited rows; AC4, AC6).
- [ ] Unit: existing `RESERVED` and `.claude` reasons are unchanged (R4 and the unedited rows; AC5).
- [ ] Integration: `orchestrate.mjs start` halts with `ORCH_DOC_LOCATION_INVALID` and writes no run for `- Specs: .husky` and `- Plans: tools` (AC7).
- [ ] Full suite: `npm test` exit 0 (AC8).
- No E2E: no UI.

## Commit Order

1. Task 0: this plan and its `.gitignore` leaf (done by this session's commit).
2. Tasks 1 to 3: one `fix:` commit with the source change, both test files and this plan's ticks. The red runs of Task 1 are observed, not committed separately, so no commit leaves the suite red.

## Identified Risks

- **A caller or fixture somewhere records a root dot-directory or a `bin`/`lib`/`tools` folder.** Searched: no test outside the two edited files writes a `- Specs:` or `- Plans:` line, and no shipped `.md` holds one. T-301's full run is the check; a red there in an unedited file means a fixture depended on the old acceptance and is fixed in its file, with the reason in the report.
- **A reason drifts for an already-reserved folder.** The new rule runs last and only on values the earlier rules accepted; R4 and the unedited reason assertions catch any drift.
- **Row counts in the filtered predictions.** The `-t 'checkDocDir'` filter matches by describe name, so every row of the two `checkDocDir` blocks counts; a different count means a row was misplaced outside the block or the table sizes differ from plan decision 4.
- **Guard 5 and discovered pairs.** Discovery and the default only yield `CANDIDATE_PAIRS`, all of which stay accepted (`accepts every fixed pair, each disjoint`), so a project with no recorded lines resolves as before.
