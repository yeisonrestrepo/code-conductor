# BUG-069 Back up an existing OpenCode guard plugin before overwriting it: implementation plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Update one checkbox per edit (BUG-003 invariant). Execute in file order.

**Goal:** with `opencode: true`, `deployProject` installs `.opencode/plugin/conductor-guard.js` through `mergeFileInto` instead of the bare `cpSync` of the root-entry loop. A host plugin whose bytes differ from the shipped one is backed up to `<file>.installer-backup.<stamp>` first and the backup path is reported. A byte-identical plugin is left alone. A failed backup leaves the host plugin untouched. The "installed" line prints only when the plugin is in place afterwards.

**Spec:** `docs/superpowers/specs/2026-11-19-bug069-installer-overwrites-an-existing-opencode-guard-design.md` (sha256 `49effac010ba2d5712dce826860d77ef93fc32682ccfc05b3917eeeef1c7af5c`). Issue #164.

**Test command:** `npm test`. Filtered runs use `npx vitest run <file>` and `-t '<pattern>'`.

## Global Constraints

- No release records: `VERSION`, the `package.json` / `package-lock.json` version, `CHANGELOG.md`, `AGENT-READABLE BACKLOG.md`, `.claude/memory/**` and the README "Known limits" line for BUG-069 (`README.md:499`) stay untouched (spec, Out of Scope).
- **Three files change, plus this plan and its `.gitignore` leaf:** `lib/installer/deploy.mjs`, `tests/installer/deploy.test.js`, `tests/installer/templates.test.js`. `lib/installer/file-merge.mjs` is used as is (spec, System Impact). No hook, SNAP script, settings file, workflow, plugin code or dependency changes.
- `lib/installer/deploy.mjs` is protected installer surface. The change adds no network access, no new installed permission, and no written path other than the backup file. The managed `.gitignore` block already ignores that file (`*.installer-backup.*`, `project-template/gitignore:3`). The installer is never run on this repository (CONTRIBUTING). It is exercised only through its tests.
- Every file this plan edits after Task 0 is already tracked and none sits under an ignored directory, except this plan. It is under the ignored `docs/superpowers/plans/` (`.gitignore:70`), but it is tracked after Task 0 and re-included by its leaf. So every staging step after Task 0 is `git add -u <path>` with an explicit path.
- Existing output stays byte-identical: the merged-file backup lines still end in `before merging` (spec, AC8). A fresh `--opencode` install prints the same single "installed" line as today (spec, AC4).

## Files read in full (spec, Files Requiring Full Read)

- `lib/installer/deploy.mjs` (309 lines), all of it. `backupReporter` is at `:34-42`, `OPENCODE_DIR` at `:28`, and `deployProject` at `:241-292`, with the root-entry loop at `:261-266` and the merged-files loop at `:267-272`.
- `lib/installer/file-merge.mjs` (110 lines), all of it. `mergeFileInto` returns `skipped-dir`, `skipped-dangling`, `skipped-missing`, `created`, `skipped-warning`, `unchanged`, `merged`, `skipped-backup-failed` or `write-failed`. The backup is skipped when `hostText.trim() === ''` (`:88`). `onBackup` fires the moment the copy exists (`:101`).
- `tests/installer/deploy.test.js`: the shared `beforeEach` (`:21-38`), `capture()` (`:43-47`), the BUG-049 block (`:559-618`) and the FEAT-048 block (`:656-683`).

## Plan decisions

1. **`backupReporter` gains an action word (`lib/installer/deploy.mjs:34-42`).** Add `action = 'merging'` to its destructured options and print `before ${action}` instead of the literal `before merging`. Its three existing callers pass no `action`, so their lines are unchanged (spec, AC8).
2. **The root-entry loop skips `.opencode` unconditionally (`:262-265`).** The skip line becomes `if (name === '.claude' || name === OPENCODE_DIR || MERGED_ROOT_FILES.has(name)) continue;`. The `if (name === OPENCODE_DIR && !opencode) continue;` line and the in-loop `report(...)` line are removed. So the loop no longer copies `.opencode` in either mode. The template's `.opencode/` holds one file (pinned by the test in plan decision 6), so nothing else is dropped.
3. **A new `installOpencodePlugin` installs the one file.** It goes directly above `deployProject`'s leading comment block (the `// \`home\` is where…` lines at `:237-240`), next to the constant it uses:
   ```js
   const OPENCODE_PLUGIN = '.opencode/plugin/conductor-guard.js';
   // A plugin is "in place" after these statuses; every other one leaves the host's file (or nothing) there.
   const PLUGIN_IN_PLACE = new Set(['created', 'merged', 'unchanged']);

   // The plugin is a managed asset, so the shipped bytes win. Going through mergeFileInto
   // still backs up a copy the host edited before replacing it (BUG-069).
   const replaceWithTemplate = (templateText, hostText) => ({ text: templateText, changed: hostText !== templateText });

   function installOpencodePlugin(templateRoot, cwd, { warn, report }) {
     const parts = OPENCODE_PLUGIN.split('/');
     mkdirSync(join(cwd, ...parts.slice(0, -1)), { recursive: true });
     const status = mergeFileInto(join(templateRoot, ...parts), join(cwd, ...parts), replaceWithTemplate, {
       warn,
       onBackup: backupReporter(report, { root: cwd, rootLabel: '', file: OPENCODE_PLUGIN, ignoredByDesign: true, action: 'replacing it' }),
     });
     if (PLUGIN_IN_PLACE.has(status)) report(`code-conductor: installed the OpenCode guard plugin at ${OPENCODE_PLUGIN}`);
   }
   ```
   `OPENCODE_DIR` (`:28`) then has a single use, the loop skip. It stays, because the loop skips the directory entry and not the file. The function is 10 lines, within the 30-line limit. `replaceWithTemplate` never returns a `warning`, so `skipped-warning` cannot occur. An empty or whitespace-only host plugin gets `changed: true` and no backup, through `mergeFileInto`'s existing rule (spec, Alternative paths).
4. **The call site.** In `deployProject`, directly after the root-entry loop and before the `MERGED_ROOT_FILES` loop, add `if (opencode) installOpencodePlugin(templateRoot, cwd, { warn: emit, report });`. That position keeps today's line order: the OpenCode lines print before the merged files' backup lines, as the in-loop report did. The `opencode` comment above `deployProject` (`:238-239`) changes "the template's .opencode/ entry is skipped" to "the plugin is not installed". It is still true for both modes after plan decision 2.
5. **Three new tests in `describe('deployProject: OpenCode plugin (FEAT-048)')` (`tests/installer/deploy.test.js`).** They go after the `keeps the host project's own .opencode/ files` case (ends at `:679`) and before `ships the real plugin in the template`. `SHIPPED` is the block's existing template text `'export const ConductorGuard = 1;\n'`. A block-local `const PLUGIN_DIR = join('.opencode', 'plugin');` sits next to `PLUGIN_REL`. A file-level `const POSIX_NON_ROOT = process.platform !== 'win32' && process.getuid?.() !== 0;` goes after `capture` (`:47`), the same definition as `tests/installer/heal.test.js:25`.
   - **D1 `[BUG-069] backs up a host-edited plugin, installs the shipped one and reports the backup first`.** Write `'// my edits\n'` at `home/PLUGIN_REL`, then deploy with `opencode: true`. Expect exactly one `conductor-guard.js.installer-backup.` entry in `home/PLUGIN_DIR`, holding `'// my edits\n'`. The plugin holds `SHIPPED`. `out.said` equals exactly `[`code-conductor: backed up .opencode/plugin/conductor-guard.js to .opencode/plugin/${backup} before replacing it (git-ignored by design)`, 'code-conductor: installed the OpenCode guard plugin at .opencode/plugin/conductor-guard.js']`. Spec, AC1 and AC2. No other line prints here, because the shared fixture has no host `CLAUDE.md` / `.gitignore` and no `flow-status.mjs` (`:624-629` pins `said` as `[]` for that state).
   - **D2 `[BUG-069] leaves a byte-identical plugin alone, with no backup and no backup line`.** Write `SHIPPED` at the plugin path, then deploy with `opencode: true`. Expect no `.installer-backup.` entry in `home/PLUGIN_DIR`, and `out.said` equal to exactly the "installed" line. Spec, AC3.
   - **D3 `it.skipIf(!POSIX_NON_ROOT)('[BUG-069] leaves the host plugin untouched and says nothing installed when the backup fails')`.** Write `'// my edits\n'` at the plugin path. `chmodSync(join(home, PLUGIN_DIR), 0o555)`, then deploy with `opencode: true` inside `try`, with `chmodSync(..., 0o755)` in `finally`. Expect the plugin to still read `'// my edits\n'`, no `.installer-backup.` entry, `out.warned` to contain a line that matches `/could not back it up/`, and no `out.said` line that matches `/OpenCode/`. Spec, AC5. `chmodSync` joins the `node:fs` import at `:3`. A root runner can write into a 0o555 directory, so the case is skipped there, as in heal.test.js.
6. **The one-file pin (`tests/installer/templates.test.js`).** A new `it('[BUG-069] ships exactly one file under project-template/.opencode/')` goes inside `describe('shipped asset dirs')` (`:102-114`), after its existing case. It walks `project-template/.opencode` with the same recursive `readdirSync(..., { withFileTypes: true })` walk as the case above it, collects relative file paths joined with `/`, and expects `['plugin/conductor-guard.js']`. Spec, AC9. The imports already cover it (`readdirSync`, `join`).
7. **Red predictions, measured against the current tree.** `cpSync` with `force` overwrites a file inside a 0o555 directory: measured on Node v24.22.2 in a scratch dir, it exited 0 and the file was replaced. So D3 is red before the fix (the plugin is replaced), not green by accident. D1 is red because there is no backup. D2 is green before and after, because today's copy of identical bytes leaves no backup and prints only the "installed" line. The pin is green before and after.
8. **`.gitignore` leaf.** `!/docs/superpowers/plans/2026-11-19-bug069-installer-overwrites-an-existing-opencode-guard.md` goes directly before the `2026-11-19-bug077` plan leaf (`.gitignore:178`), the full-path sort order of the block (BUG-042).

## Baseline (measured on this branch, HEAD 9a07e79)

- `npx vitest run tests/installer/deploy.test.js -t 'OpenCode plugin'`: **4 passed | 64 skipped (68)**.
- `npx vitest run tests/installer/deploy.test.js tests/installer/templates.test.js`: **107 passed (107)**. That is 68 in deploy.test.js and 39 in templates.test.js.
- The sandbox runs as uid 1001 (non-root), so D3 runs there and is not skipped.

---

### Task 0: Commit this plan

**Files:**
- Create: `docs/superpowers/plans/2026-11-19-bug069-installer-overwrites-an-existing-opencode-guard.md`
- Modify: `.gitignore`

- [X] [T-001] Create this plan file from the approved spec `49effac0…`. No dependency.
- [X] [T-002] `.gitignore`: insert the leaf of plan decision 8 before the `2026-11-19-bug077` plan leaf. Depends on T-001.
- [X] [T-003] Stage: `git add -u .gitignore` (tracked) and `git add -f docs/superpowers/plans/2026-11-19-bug069-installer-overwrites-an-existing-opencode-guard.md` (new, under the ignored `docs/superpowers/plans/`). Depends on T-002.
- [X] [T-004] Commit: `docs: plan backing up an existing OpenCode guard plugin before overwrite [BUG-069]`. Depends on T-003.

---

### Task 1: Tests first (red)

**Files:**
- Modify: `tests/installer/deploy.test.js`
- Modify: `tests/installer/templates.test.js`

- [ ] [T-101] `tests/installer/deploy.test.js:3`: add `chmodSync` to the `node:fs` import. After `capture` (`:47`), add the `POSIX_NON_ROOT` constant (plan decision 5). Depends on T-004.
- [ ] [T-102] `tests/installer/deploy.test.js`, FEAT-048 block: add `PLUGIN_DIR` next to `PLUGIN_REL`, and insert D1, D2 and D3 after the `keeps the host project's own .opencode/ files` case (plan decision 5). Depends on T-101.
- [ ] [T-103] `tests/installer/templates.test.js`, `describe('shipped asset dirs')`: add the one-file pin (plan decision 6). Depends on T-102.
- [ ] [T-104] Red run: `npx vitest run tests/installer/deploy.test.js -t 'OpenCode plugin'`. Its full match set is the 4 existing FEAT-048 tests plus D1, D2 and D3, because every test in the block carries the describe name. Predicted: **2 failed | 5 passed | 64 skipped (71)**. Red: D1 and D3. Green: D2 and the 4 existing tests (plan decision 7). On a root runner, D3 is skipped: **1 failed | 5 passed | 65 skipped**. Any other split means a test is wrong. Fix the test, not the prediction. Depends on T-103.
- [ ] [T-105] Run: `npx vitest run tests/installer/templates.test.js -t 'BUG-069'`. Predicted: **1 passed**, every other test skipped (the pin is green already, plan decision 7). Depends on T-104.

---

### Task 2: Install the plugin through the backup path (green)

**Files:**
- Modify: `lib/installer/deploy.mjs`

- [ ] [T-201] `lib/installer/deploy.mjs:34-42`: give `backupReporter` its `action` option (plan decision 1). Depends on T-105.
- [ ] [T-202] `lib/installer/deploy.mjs`: add `OPENCODE_PLUGIN`, `PLUGIN_IN_PLACE`, `replaceWithTemplate` and `installOpencodePlugin` above `deployProject`'s comment block, and reword its `opencode` comment line (plan decisions 3 and 4). Depends on T-201.
- [ ] [T-203] `lib/installer/deploy.mjs:262-265`: change the loop skip and remove the opencode skip and the in-loop report (plan decision 2). Add the `if (opencode) installOpencodePlugin(...)` call after the loop (plan decision 4). Depends on T-202.
- [ ] [T-204] Green run: the T-104 command. Predicted: **7 passed | 64 skipped (71)**. Depends on T-203.
- [ ] [T-205] `npx vitest run tests/installer/deploy.test.js tests/installer/templates.test.js tests/installer/cli.test.js`. Predicted: every test passes, 111 of them in the first two files (107 baseline + 4 new). This includes the BUG-049 `before merging` assertions (spec, AC8) and the FEAT-048 CLI cases (spec, AC4 and AC6). Depends on T-204.

---

### Task 3: Full suite, scope check and commit

**Files:**
- Modify: `docs/superpowers/plans/2026-11-19-bug069-installer-overwrites-an-existing-opencode-guard.md` (ticks)

- [ ] [T-301] Run `npm test`. Predicted: exit 0 (spec, AC10). A red is called ENV only if the sandbox caused it (network, tmp permissions) and its file is not one this plan touches. Report it with its name. Any other red is fixed. Depends on T-205.
- [ ] [T-302] Scope check: `git status --short` lists exactly `lib/installer/deploy.mjs`, `tests/installer/deploy.test.js`, `tests/installer/templates.test.js` and this plan. No temporary file is left in the tree. `git diff lib/installer/file-merge.mjs` is empty. Depends on T-301.
- [ ] [T-303] Stage: `git add -u lib/installer/deploy.mjs tests/installer/deploy.test.js tests/installer/templates.test.js` (all tracked). Depends on T-302.
- [ ] [T-304] Stage: `git add -u docs/superpowers/plans/2026-11-19-bug069-installer-overwrites-an-existing-opencode-guard.md` (carries the ticks for T-101 to T-303). Depends on T-303.
- [ ] [T-305] Commit: `fix: back up an existing OpenCode guard plugin before overwriting it [BUG-069]`. Depends on T-304.

---

## Test List

- [ ] Unit, AC1 and AC2: D1. A host-edited plugin is backed up with its original bytes and replaced with the shipped bytes. The backup line prints exactly, before the "installed" line.
- [ ] Unit, AC3: D2. A byte-identical plugin gets no backup and no backup line, and the "installed" line still prints.
- [ ] Unit, AC4: the existing FEAT-048 cases in `deploy.test.js` (`installs the plugin byte for byte…`) and `cli.test.js` (`installs the OpenCode plugin with --project --opencode`), unchanged.
- [ ] Unit, AC5: D3. A failed backup leaves the plugin byte for byte, warns on stderr, and prints no "installed" line.
- [ ] Unit, AC6: the existing `writes no .opencode/ without the opencode option` cases in `deploy.test.js` and `cli.test.js`, unchanged.
- [ ] Unit, AC7: the existing `keeps the host project's own .opencode/ files` case, unchanged.
- [ ] Unit, AC8: the existing BUG-049 `before merging` assertions (`deploy.test.js:578-601`), unchanged.
- [ ] Unit, AC9: the one-file pin in `templates.test.js`.
- [ ] AC10: `npm test` (T-301).
- [ ] No integration or E2E/UI test: the CLI already drives `deployProject` end to end in `cli.test.js`, and there is no UI.

## Commit Order

1. Task 0 (T-004): this plan and its `.gitignore` leaf.
2. Task 3 (T-305): the tests, the installer change and the plan ticks for T-101 to T-303, in one commit, so no commit has a red suite. The red run in T-104 happens in the working tree before the fix. The ticks for T-304, T-305 and the Test List ride the closeout commit.

## Identified Risks

- **Line order drift.** If the call site lands after the `MERGED_ROOT_FILES` loop instead of before it, a host with an edited `CLAUDE.md` would see the OpenCode lines after the merge lines. Plan decision 4 fixes the position. D1 pins the two OpenCode lines' relative order.
- **A second shipped `.opencode/` file being silently dropped** now that the directory is not force-copied. Caught by the one-file pin (plan decision 6). A future second file fails it and has to be routed on purpose.
- **File mode.** `writeAtomic` creates the plugin with the default mode (0666 minus umask) where `cpSync` copied the template's mode. The plugin is a `.js` module that OpenCode imports and never executes directly, and the merged files already behave this way. So no behavior changes. Out of this item's scope.
- **Text decoding.** `mergeFileInto` compares the files as UTF-8 text, not raw bytes. A host plugin with CRLF line endings or a BOM counts as different and is backed up before it is replaced. That is the safe direction: an extra backup, never a lost edit.
- **`.opencode` or `.opencode/plugin` existing as a regular file.** `mkdirSync` throws, as `cpSync` did before (spec, Out of Scope). No test is added, and the behavior is unchanged.
- **The read-only-directory test on a root runner or Windows.** It is skipped by `POSIX_NON_ROOT`. The backup-failure logic itself is also covered by `tests/installer/merge-ordering.test.js:68-76`, through a fault-injected `copyFileSync`.
