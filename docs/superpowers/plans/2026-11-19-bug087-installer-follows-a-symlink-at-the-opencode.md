# BUG-087 Replace a symlink at the OpenCode guard plugin path instead of writing through it: implementation plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Update one checkbox per edit (BUG-003 invariant). Execute in file order.

**Goal:** with `opencode: true`, `installOpencodePlugin` `lstat`s `.opencode/plugin/conductor-guard.js` before calling `mergeFileInto`. A symbolic link there (live, dangling, or to a directory) is removed with `unlinkSync`, a stderr line names its old link text, and `mergeFileInto` then writes the shipped plugin as a regular file. The file the link pointed to is never opened, backed up or written. A link that cannot be removed is left as it is, with a stderr line and no "installed" line. A destination that is not a link keeps BUG-069's behavior byte for byte.

**Spec:** `docs/superpowers/specs/2026-11-19-bug087-installer-follows-a-symlink-at-the-opencode-design.md` (sha256 `22686c8fcafed884a948028afb1a27355d760c158d508978aea70fc8547afb14`). Issue #260. Regression of BUG-069.

**Test command:** `npm test`. Filtered runs use `npx vitest run <file>` and `-t '<pattern>'`.

## Global Constraints

- No release records: `VERSION`, the `package.json` / `package-lock.json` version, `CHANGELOG.md`, `AGENT-READABLE BACKLOG.md`, `.claude/memory/**` and the README "Known limits" lines stay untouched (spec, Out of Scope).
- **Three files change, plus this plan and its `.gitignore` leaf:** `lib/installer/deploy.mjs`, `tests/installer/deploy.test.js`, `tools/skip-baseline.json`. `lib/installer/file-merge.mjs` (`mergeFileInto`, `resolveRealTarget`, `writeAtomic`) is not changed (spec, Out of Scope and AC5). No hook, SNAP script, settings file, workflow, plugin code or dependency changes.
- `lib/installer/deploy.mjs` is protected installer surface. The change is confined to `installOpencodePlugin` and one new helper next to it. It adds no network access, no installed permission and no written path: the only new filesystem mutation is removing a link at the plugin path itself. The installer is never run on this repository (CONTRIBUTING). It is exercised only through its tests, which run in temp directories.
- Every file this plan edits after Task 0 is already tracked and none sits under an ignored directory, except this plan. It is under the ignored `docs/superpowers/plans/`, is new in Task 0 (so `git add -f`), and is tracked afterwards and re-included by its leaf (so `git add -u`).
- Existing output stays byte-identical for every non-link destination: the three `[BUG-069]` rows and the other FEAT-048 rows are not edited and must pass as they are (spec, AC5).

## Files read in full (spec, Files Requiring Full Read)

The spec defers none. Read for this plan:

- `lib/installer/deploy.mjs:1` (the `node:fs` import: `lstatSync` and `unlinkSync` are there, `readlinkSync` is not) and `:237-251` (`OPENCODE_PLUGIN`, `PLUGIN_IN_PLACE`, `replaceWithTemplate`, `installOpencodePlugin`). The one caller is `:283`; it passes `warn: emit`, which is `deployProject`'s `warn` (stderr by default, `toStderr` at `:44`).
- `lib/installer/file-merge.mjs:17-23` (`resolveRealTarget`), `:43-51` (`writeAtomic`) and `:53-80` (`mergeFileInto` through its `created` branch). With no file at the path, `mergeFileInto` writes the template with `writeAtomic` and returns `created`, which is in `PLUGIN_IN_PLACE`.
- `tests/installer/deploy.test.js:1-49` (imports: `lstatSync`, `chmodSync`, `symlinkSync`, `CAN_SYMLINK` present, `readlinkSync` absent; the shared `beforeEach`; `capture()`; `POSIX_NON_ROOT` at `:49`) and the FEAT-048 block `:657-724`.
- `tools/skip-baseline.json:139-160` (`ci-windows-node24`, sorted, holding the BUG-069 backup-failure row at `:144`).

## Plan decisions

1. **The helper (`lib/installer/deploy.mjs`), placed directly above `installOpencodePlugin`, after `replaceWithTemplate`:**
   ```js
   // The plugin is a managed asset, so a link at its path is removed, never followed:
   // writing through it would overwrite whatever file the checkout points it at (BUG-087).
   // Returns false when the link is still there, so nothing may be written.
   function removePluginSymlink(pluginPath, warn) {
     let st;
     try { st = lstatSync(pluginPath); } catch { return true; }
     if (!st.isSymbolicLink()) return true;
     let linkText = 'an unreadable target';
     try { linkText = readlinkSync(pluginPath); } catch { /* raced away; the unlink still decides */ }
     try {
       unlinkSync(pluginPath);
     } catch (err) {
       warn(`code-conductor: skipping ${OPENCODE_PLUGIN} — it is a symlink and could not be removed (${err.code}); nothing was written`);
       return false;
     }
     warn(`code-conductor: replaced the symlink at ${OPENCODE_PLUGIN} (it pointed to ${linkText}) with the shipped plugin; the file it pointed to was not touched`);
     return true;
   }
   ```
   The two warning texts are the spec's (Main path step 3, Error cases), with `linkText` defaulting to the spec's `an unreadable target` wording. An `lstat` failure (`ENOENT` on a fresh install) returns `true`, so `mergeFileInto` runs exactly as today. A regular file or a real directory is not a link and returns `true`, so BUG-069's paths and the `the target is a directory` skip are unchanged (spec, Alternative paths). A dangling link and a link to a directory take the link branch, because `lstat` does not follow. The function is 16 lines.
2. **`installOpencodePlugin` calls it.** After the `mkdirSync`, bind `const pluginPath = join(cwd, ...parts);`, add `if (!removePluginSymlink(pluginPath, warn)) return;`, and pass `pluginPath` to `mergeFileInto` in place of the inline `join(cwd, ...parts)`. The early return skips both `mergeFileInto` and the `installed` report (spec, Error cases). The function stays at 12 lines.
3. **Import.** `readlinkSync` joins the `node:fs` import at `lib/installer/deploy.mjs:1`. `lstatSync` and `unlinkSync` are already imported.
4. **Three new tests in `describe('deployProject: OpenCode plugin (FEAT-048)')` (`tests/installer/deploy.test.js`),** after the `[BUG-069] leaves the host plugin untouched…` case (ends at `:720`) and before `ships the real plugin in the template`. `readlinkSync` joins the `node:fs` import at `:3`. The block gets two local constants next to `SHIPPED`: `const INSTALLED = 'code-conductor: installed the OpenCode guard plugin at .opencode/plugin/conductor-guard.js';` and `const OUTSIDE_TEXT = '// a file outside the project\n';` (different from `SHIPPED`, so a write through the link is visible). Each row that needs an outside file makes it with `const outside = mkdtempSync(join(tmpdir(), 'cc-outside-'));` and `writeFileSync(join(outside, 'victim.js'), OUTSIDE_TEXT)`, and removes `outside` in a `finally`. That directory is a sibling temp dir, not under `home`, so it is outside the project root. The link is made with `mkdirSync(join(home, PLUGIN_DIR), { recursive: true })` then `symlinkSync(<target>, join(home, PLUGIN_REL))`, and the expected link text is read back with `readlinkSync` before deploying, so the assertion holds whatever form the platform returns.
   - **L1 `it.skipIf(!CAN_SYMLINK)('[BUG-087] replaces a symlinked plugin with a regular file and leaves the file it pointed to outside the project untouched')`.** Link to `join(outside, 'victim.js')`, deploy with `opencode: true`. Expect: `readFileSync(join(outside, 'victim.js'), 'utf8')` is `OUTSIDE_TEXT`; `readdirSync(outside)` equals `['victim.js']` (no `.installer-backup.` file there); `lstatSync(join(home, PLUGIN_REL)).isSymbolicLink()` is `false` and `.isFile()` is `true`; the plugin holds `SHIPPED`; `out.warned` contains exactly `` `code-conductor: replaced the symlink at .opencode/plugin/conductor-guard.js (it pointed to ${linkText}) with the shipped plugin; the file it pointed to was not touched` ``; `out.said` equals `[INSTALLED]`. Spec, AC1 and AC2.
   - **L2 `it.skipIf(!CAN_SYMLINK)('[BUG-087] replaces a dangling symlink at the plugin path and installs the plugin')`.** Link to `join(home, 'missing-target.js')`, which does not exist. Deploy with `opencode: true`. Expect: the plugin path is a regular file, not a link, holding `SHIPPED`; `existsSync(join(home, 'missing-target.js'))` is `false`; `out.warned` contains the `replaced the symlink` line with that link text; `out.said` equals `[INSTALLED]`. Spec, AC3. No outside directory is needed.
   - **L3 `it.skipIf(!POSIX_NON_ROOT || !CAN_SYMLINK)('[BUG-087] leaves the symlink and its target alone and says nothing installed when the link cannot be removed')`.** Link to `join(outside, 'victim.js')`, then `chmodSync(join(home, PLUGIN_DIR), 0o555)` and deploy with `opencode: true` inside `try`; the `finally` runs `chmodSync(..., 0o755)` and removes `outside`. Expect: `lstatSync(join(home, PLUGIN_REL)).isSymbolicLink()` is `true` and `readlinkSync` of it equals the link text read before the deploy; `victim.js` still holds `OUTSIDE_TEXT` and `readdirSync(outside)` equals `['victim.js']`; `out.warned` contains exactly `code-conductor: skipping .opencode/plugin/conductor-guard.js — it is a symlink and could not be removed (EACCES); nothing was written`; no `out.said` line matches `/OpenCode/`. Spec, AC4. `EACCES` is the measured code: on Node v24.22.2 as uid 1001, `unlinkSync` of a link in a 0o555 directory threw `EACCES`. A root runner can unlink there, so the row is skipped there, as BUG-069's backup-failure row is.
5. **Skip baseline (`tools/skip-baseline.json`).** Under `ci-windows-node24`, insert `"tests/installer/deploy.test.js > deployProject: OpenCode plugin (FEAT-048) [BUG-087] leaves the symlink and its target alone and says nothing installed when the link cannot be removed",` directly after the `[BUG-069] leaves the host plugin untouched…` line (`:144`), which is its sorted position (`[BUG-069]` < `[BUG-087]` < `tests/installer/heal.test.js`). Predicted CI effect, per leg (CONTRIBUTING, test predictions): `ci-node20` and `ci-node24` skip sets unchanged, since L1-L3 all run there (Linux, non-root, symlinks available); `ci-windows-node24` gains exactly L3's name, and L1 and L2 run there as the existing `CAN_SYMLINK` rows of this file do (none of them is in that key). If a Windows runner turned out unable to symlink, the skip check names L1 and L2 as added; that is a measured fact to record, not to predict away.
6. **Red predictions, reasoned against the current code.** L1: today `mergeFileInto` resolves the link to `victim.js`, backs it up next to it and overwrites it, so `victim.js` no longer holds `OUTSIDE_TEXT`: **red**. L2: today `resolveRealTarget` reports `dangling` and `mergeFileInto` returns `skipped-dangling`, so the plugin path is still a link: **red**. L3: today the 0o555 plugin directory does not matter, because the write goes to `victim.js` in the writable outside directory; it is overwritten and the `installed` line prints: **red**. The 7 existing rows of the block are green before and after (no non-link path changes).
7. **`.gitignore` leaf.** `!/docs/superpowers/plans/2026-11-19-bug087-installer-follows-a-symlink-at-the-opencode.md` goes directly after the `2026-11-19-bug083` plan leaf and before the first `docs/superpowers/specs/` leaf, the full-path sort order of the block (BUG-042).

## Baseline (measured on this branch, HEAD 2d98348, Node v24.22.2, uid 1001)

- `npx vitest run tests/installer/deploy.test.js -t 'OpenCode plugin'`: **7 passed | 64 skipped (71)**.
- `npx vitest run tests/installer/deploy.test.js tests/installer/file-merge.test.js`: **87 passed (87)**, of which 71 in `deploy.test.js`.
- The sandbox runs as uid 1001 (non-root) and can make symlinks in tmp, so L1, L2 and L3 all run there.

---

### Task 0: Commit this plan

**Files:**
- Create: `docs/superpowers/plans/2026-11-19-bug087-installer-follows-a-symlink-at-the-opencode.md`
- Modify: `.gitignore`

- [X] [T-001] Create this plan file from the approved spec `22686c8f…`. No dependency.
- [X] [T-002] `.gitignore`: insert the leaf of plan decision 7 after the `2026-11-19-bug083` plan leaf. Depends on T-001.
- [X] [T-003] Stage: `git add -u .gitignore` (tracked) and `git add -f docs/superpowers/plans/2026-11-19-bug087-installer-follows-a-symlink-at-the-opencode.md` (new, under the ignored `docs/superpowers/plans/`). Depends on T-002.
- [X] [T-004] Commit: `docs: plan replacing a symlink at the OpenCode guard plugin path [BUG-087]`. Depends on T-003.

---

### Task 1: Tests first (red)

**Files:**
- Modify: `tests/installer/deploy.test.js`

- [X] [T-101] `tests/installer/deploy.test.js:3`: add `readlinkSync` to the `node:fs` import. Depends on T-004.
- [X] [T-102] `tests/installer/deploy.test.js`, FEAT-048 block: add `INSTALLED` and `OUTSIDE_TEXT` next to `SHIPPED` (plan decision 4). Depends on T-101.
- [X] [T-103] `tests/installer/deploy.test.js`, FEAT-048 block: insert L1, L2 and L3 after the `[BUG-069] leaves the host plugin untouched…` case and before `ships the real plugin in the template` (plan decision 4). Depends on T-102.
- [X] [T-104] Red run: `npx vitest run tests/installer/deploy.test.js -t 'OpenCode plugin'`. Its full match set is the 7 existing FEAT-048 rows plus L1, L2 and L3, because every row in the block carries the describe name; the other 64 rows of the file are skipped by the filter. Predicted: **3 failed | 7 passed | 64 skipped (74)**. Red: L1, L2, L3. Green: the 3 `[BUG-069]` rows, `writes no .opencode/…`, `installs the plugin byte for byte…`, `keeps the host project's own .opencode/ files` and `ships the real plugin in the template` (plan decision 6). On a root runner L3 is skipped: **2 failed | 7 passed | 65 skipped**. Any other split means a test is wrong: fix the test, not the prediction. Depends on T-103.

---

### Task 2: Remove the link before writing (green)

**Files:**
- Modify: `lib/installer/deploy.mjs`
- Modify: `tools/skip-baseline.json`

- [X] [T-201] `lib/installer/deploy.mjs:1`: add `readlinkSync` to the `node:fs` import (plan decision 3). Depends on T-104.
- [X] [T-202] `lib/installer/deploy.mjs`: add `removePluginSymlink` between `replaceWithTemplate` and `installOpencodePlugin` (plan decision 1). Depends on T-201.
- [X] [T-203] `lib/installer/deploy.mjs`, `installOpencodePlugin`: bind `pluginPath`, add the early return, and pass `pluginPath` to `mergeFileInto` (plan decision 2). Depends on T-202.
- [X] [T-204] `tools/skip-baseline.json`, `ci-windows-node24`: insert L3's full name after the `[BUG-069] leaves the host plugin untouched…` line (plan decision 5). Depends on T-203.
- [X] [T-205] Green run: the T-104 command. Predicted: **10 passed | 64 skipped (74)** (root runner: **9 passed | 65 skipped**). Depends on T-204.
- [X] [T-206] Run: `npx vitest run tests/installer/deploy.test.js tests/installer/file-merge.test.js tests/installer/cli.test.js tests/tools/skip-baseline.test.js`. Predicted: every test passes, 90 of them in the first two files (87 baseline + 3 new). This covers the `through realpath and keeps the link` rows and `file-merge.test.js` unchanged (spec, AC5), the FEAT-048 CLI cases, and the baseline file still parsing. Depends on T-205.

---

### Task 3: Full suite, scope check and commit

**Files:**
- Modify: `docs/superpowers/plans/2026-11-19-bug087-installer-follows-a-symlink-at-the-opencode.md` (ticks)

- [X] [T-301] Run `npm test`. Predicted: exit 0 (spec, AC6). A red is called ENV only if the sandbox caused it (network, tmp permissions) and its file is not one this plan touches; report it with its name. Any other red is fixed. Depends on T-206.
- [X] [T-302] Scope check: `git status --short` lists exactly `lib/installer/deploy.mjs`, `tests/installer/deploy.test.js`, `tools/skip-baseline.json` and this plan. No temporary file is left in the tree, and no `cc-outside-` directory is left in the temp dir. `git diff lib/installer/file-merge.mjs` is empty. Depends on T-301.
- [X] [T-303] Stage: `git add -u lib/installer/deploy.mjs tests/installer/deploy.test.js tools/skip-baseline.json` (all tracked). Depends on T-302.
- [X] [T-304] Stage: `git add -u docs/superpowers/plans/2026-11-19-bug087-installer-follows-a-symlink-at-the-opencode.md` (carries the ticks for T-101 to T-303). Depends on T-303.
- [X] [T-305] Commit: `fix: replace a symlink at the OpenCode guard plugin path instead of writing through it [BUG-087]`. Depends on T-304.

---

## Test List

- [X] Unit, AC1 and AC2: L1. A link to a file outside the project root is replaced by a regular file with the shipped bytes; the outside file keeps its bytes and gets no backup; the stderr line names the link text; stdout is exactly the `installed` line.
- [X] Unit, AC3: L2. A dangling link is replaced and the plugin is installed; nothing is created at the link's target.
- [X] Unit, AC4: L3. A link that cannot be removed stays a link to the same text, its target is unchanged, stderr has the `could not be removed` line, and stdout has no `OpenCode` line. Its name is in `ci-windows-node24`.
- [X] Unit, AC5: the three `[BUG-069]` rows and the other FEAT-048 rows, `tests/installer/file-merge.test.js`, and the `through realpath and keeps the link` rows of `deploy.test.js`, all unchanged.
- [X] AC6: `npm test` (T-301).
- [X] No integration or E2E/UI test: `cli.test.js` already drives `deployProject` with `--opencode` end to end, and there is no UI.

## Commit Order

1. Task 0 (T-004): this plan and its `.gitignore` leaf.
2. Task 3 (T-305): the tests, the installer change, the skip-baseline line and the plan ticks for T-101 to T-303, in one commit, so no commit has a red suite. The red run in T-104 happens in the working tree before the fix. The ticks for T-304, T-305 and the Test List ride the closeout commit.

## Identified Risks

- **Fixing the shared merge path by mistake.** Putting the `lstat` in `mergeFileInto` or `resolveRealTarget` would detach a symlinked `CLAUDE.md` or `.gitignore`. Caught by the `through realpath and keeps the link` rows and `file-merge.test.js` `[AC3]` (T-206); T-302 checks `file-merge.mjs` has no diff.
- **A stray outside temp directory.** L1 and L3 create a sibling temp dir that the shared `afterEach` does not know about. Each removes it in its own `finally`, and L3 restores the directory mode first so the removal of `home` in `afterEach` also works. T-302 checks for leftovers.
- **Link text on Windows.** `readlinkSync` may return a form other than the string passed to `symlinkSync`. The rows read the text back before deploying and compare against that, never against the literal target.
- **Directory links on Windows.** `unlinkSync` of a directory symlink is the spec's Alternative path, not an acceptance criterion, and no row covers it; libuv removes a directory reparse point on `unlink`, so no failure is expected. Not tested here.
- **The "replaced" line printing before a later write failure.** If `mergeFileInto` then fails (`write-failed`), stderr has both the "replaced" line and the write failure, and no `installed` line, which is the order the spec fixes (Main path steps 3-4). The outside file is untouched in that case too.
- **Symlinked `.opencode/` or `.opencode/plugin/`, and a link planted at `writeAtomic`'s temp name.** Not fixed here (spec, Out of Scope); to be filed as separate issues.
- **The read-only-directory row on a root runner or Windows.** Skipped by `POSIX_NON_ROOT`; recorded in `ci-windows-node24` (plan decision 5).
