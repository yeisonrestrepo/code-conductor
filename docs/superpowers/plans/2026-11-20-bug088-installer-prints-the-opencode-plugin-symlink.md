# BUG-088 Escape control characters in the OpenCode plugin symlink warning: implementation plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Update one checkbox per edit (BUG-003 invariant). Execute in file order.

**Goal:** when `removePluginSymlink` replaces a symlink at `.opencode/plugin/conductor-guard.js`, the link text it prints on stderr has every character in U+0000–U+001F, U+007F and U+0080–U+009F rendered as a visible `\xHH` escape, so a crafted link target cannot move the cursor, erase lines or forge output. Every other character, and so every ordinary target, prints exactly as BUG-087 prints it today.

**Spec:** `docs/superpowers/specs/2026-11-20-bug088-installer-prints-the-opencode-plugin-symlink-design.md` (sha256 `d5d1ef036140031bb7a340863e085a32ef4b8429af5620c1651e4ef30dade52d`). Issue #265. Follow-up of BUG-087.

**Test command:** `npm test`. Filtered runs use `npx vitest run <file>` and `-t '<pattern>'`.

## Global Constraints

- No release records: `VERSION`, the `package.json` / `package-lock.json` version, `CHANGELOG.md`, `AGENT-READABLE BACKLOG.md`, `.claude/memory/**` and the README "Known limits" lines stay untouched.
- **Three files change, plus this plan and its `.gitignore` leaf:** `lib/installer/deploy.mjs`, `tests/installer/deploy.test.js`, `tools/skip-baseline.json`. No hook, SNAP script, settings file, workflow, plugin code or dependency changes (spec, System Impact).
- `lib/installer/deploy.mjs` is protected installer surface. The change is one module-local pure function and one changed interpolation inside `removePluginSymlink`. It adds no network access, no installed permission, no written path and no new export; flags, files written and exit codes are unchanged. The installer is never run on this repository (CONTRIBUTING); it is exercised only through its tests, which run in temp directories.
- Every file this plan edits after Task 0 is already tracked and none sits under an ignored directory, except this plan. It is under the ignored `docs/superpowers/plans/`, is new in Task 0 (so `git add -f`), and is tracked afterwards and re-included by its leaf (so `git add -u`).
- Existing output stays byte-identical for ordinary targets: the three `[BUG-087]` rows (`tests/installer/deploy.test.js:723`, `:743`, `:755`) and the other rows of the block are not edited and must pass as they are (spec, AC4).

## Files read in full (spec, Files Requiring Full Read)

- `lib/installer/deploy.mjs:1` (the `node:fs` import; no new import is needed), `:43-44` (`toStdout`, `toStderr`: `toStderr` appends one `\n`), `:237-262` (`OPENCODE_PLUGIN`, `replaceWithTemplate`, `removePluginSymlink`). A repository-wide grep for `linkText` and `it pointed to` finds the one interpolation at `:260` and the two BUG-087 test assertions (`tests/installer/deploy.test.js:737`, `:752`); there is no other use of the link text. The skip warning at `:257` interpolates only `err.code`.
- `tests/installer/deploy.test.js:1-11` (imports: `CAN_SYMLINK`, `symlinkSync`, `readlinkSync`, `lstatSync` present), `:49` (`POSIX_NON_ROOT`), and the FEAT-048 block `:655-779` (`PLUGIN_REL`, `PLUGIN_DIR`, `SHIPPED`, `INSTALLED`, `capture()`, the three `[BUG-087]` rows, `ships the real plugin in the template` last).
- `tools/skip-baseline.json:139-160` (`ci-windows-node24`, sorted; the `[BUG-069]` and `[BUG-087]` cannot-write rows at `:144-145`, followed by `tests/installer/heal.test.js` rows). `tools/skip-baseline.mjs` compares sets (`:49`, `:89-90`), so order is convention, kept sorted.

## Plan decisions

1. **The function (`lib/installer/deploy.mjs`), placed directly above the BUG-087 comment of `removePluginSymlink`, after `replaceWithTemplate`:**
   ```js
   // The link text comes from the checkout, so a raw control character in it could erase or
   // forge installer output; C1 is included because U+009B acts as CSI on some terminals (BUG-088).
   const escapeControlChars = (text) =>
     text.replace(/[\x00-\x1f\x7f-\x9f]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
   ```
   Every matched code point is below U+0100, so two lowercase hex digits always suffice (ESC → `\x1b`, CR → `\x0d`, LF → `\x0a`, U+009B → `\x9b`). Backslashes and printable non-ASCII are not in the class and pass through (spec, Solution). The function cannot throw on a string, and `readlinkSync` here always returns a string (spec, Error cases). The source uses `\x..` escapes inside the regex literal, so no raw control byte enters `deploy.mjs`.
2. **One interpolation changes.** `lib/installer/deploy.mjs:260`: `(it pointed to ${linkText})` becomes `(it pointed to ${escapeControlChars(linkText)})`. The fallback `an unreadable target` has no control characters and prints unchanged. The skip warning at `:257` does not change (spec, Error cases). `removePluginSymlink` stays at 15 lines.
3. **Two new tests in `describe('deployProject: OpenCode plugin (FEAT-048)')` (`tests/installer/deploy.test.js`),** after the `[BUG-087] leaves the symlink and its target alone…` case and before `ships the real plugin in the template`. The block gets two local helpers next to `OUTSIDE_TEXT`:
   ```js
   // Link targets with control bytes are a POSIX fact; win32 rejects them in paths (BUG-088).
   const POSIX_SYMLINK = process.platform !== 'win32' && CAN_SYMLINK;
   const replacedLine = (shown) => `code-conductor: replaced the symlink at .opencode/plugin/conductor-guard.js (it pointed to ${shown}) with the shipped plugin; the file it pointed to was not touched`;
   ```
   The existing BUG-087 rows keep their inline literal (AC4: unchanged). Each new row makes the plugin directory, creates a relative, dangling link with `symlinkSync(target, join(home, PLUGIN_REL))`, and first asserts `readlinkSync(join(home, PLUGIN_REL))` equals `target`, so a filesystem that rewrote the bytes fails loudly instead of testing nothing. Measured in this sandbox (Node v24.22.2, Linux): both targets below round-trip through `symlinkSync` / `readlinkSync` exactly.
   - **E1 `it.skipIf(!POSIX_SYMLINK)('[BUG-088] escapes control characters in the link text of the replaced-symlink warning')`.** Target: `'evil\x1b[2K\rcode-conductor: all good\n.js'` (ESC, CR, LF). Deploy with `opencode: true`. Expect: `out.warned` has length 1; `out.warned[0]` does not match `/[\x00-\x1f\x7f-\x9f]/` (AC1; `capture()` records the message before `toStderr` would append its newline); it contains the literal substrings `\\x1b`, `\\x0d` and `\\x0a` and equals `replacedLine('evil\\x1b[2K\\x0dcode-conductor: all good\\x0a.js')` (AC2); `lstatSync(join(home, PLUGIN_REL)).isSymbolicLink()` is `false`, the plugin holds `SHIPPED`, and `out.said` equals `[INSTALLED]` (AC3).
   - **E2 `it.skipIf(!POSIX_SYMLINK)('[BUG-088] escapes C1 control characters and keeps printable non-ASCII in the replaced-symlink warning')`.** Target: `'código\u009b2Kfin.js'`. Deploy with `opencode: true`. Expect: `out.warned` equals `[replacedLine('código\\x9b2Kfin.js')]`, so U+009B is escaped and `ó` is kept as is; `out.warned[0]` does not match `/[\x00-\x1f\x7f-\x9f]/`; `out.said` equals `[INSTALLED]` (AC5).
4. **Skip baseline (`tools/skip-baseline.json`).** Under `ci-windows-node24`, insert E2's then E1's full name directly after the `[BUG-087] leaves the symlink and its target alone…` line (`:145`), which is their sorted position (`[BUG-087]` < `[BUG-088] escapes C1…` < `[BUG-088] escapes control…` < `tests/installer/heal.test.js`, uppercase `C` sorting before lowercase `c`):
   - `"tests/installer/deploy.test.js > deployProject: OpenCode plugin (FEAT-048) [BUG-088] escapes C1 control characters and keeps printable non-ASCII in the replaced-symlink warning",`
   - `"tests/installer/deploy.test.js > deployProject: OpenCode plugin (FEAT-048) [BUG-088] escapes control characters in the link text of the replaced-symlink warning",`

   Predicted CI effect, per leg (CONTRIBUTING, test predictions): `ci-node20` and `ci-node24` skip sets unchanged, since E1 and E2 run there (Linux, symlinks available); `ci-windows-node24` gains exactly E1's and E2's names, skipped by the `win32` half of `POSIX_SYMLINK`.
5. **Red predictions, reasoned against the current code.** E1: today `linkText` is interpolated raw, so the warning contains ESC, CR and LF: **red**. E2: today U+009B is printed raw, so the equality and the no-control-byte assertion fail: **red**. The 10 existing rows of the block are green before and after (no ordinary-target output changes).
6. **`.gitignore` leaf.** `!/docs/superpowers/plans/2026-11-20-bug088-installer-prints-the-opencode-plugin-symlink.md` goes directly after the `2026-11-19-bug087` plan leaf (`.gitignore:183`) and before the first `docs/superpowers/specs/` leaf, the full-path sort order of the block (BUG-042).

## Baseline (measured on this branch, HEAD 807cb3b, Node v24.22.2, uid 1001)

- `npx vitest run tests/installer/deploy.test.js -t 'OpenCode plugin'`: **10 passed | 64 skipped (74)**.
- `npx vitest run tests/installer/deploy.test.js tests/installer/file-merge.test.js`: **90 passed (90)**.
- The sandbox is Linux, non-root, and can make symlinks in tmp whose targets contain ESC, CR, LF and U+009B, so E1 and E2 run there.

---

### Task 0: Commit this plan

**Files:**
- Create: `docs/superpowers/plans/2026-11-20-bug088-installer-prints-the-opencode-plugin-symlink.md`
- Modify: `.gitignore`

- [X] [T-001] Create this plan file from the approved spec `d5d1ef03…`. No dependency.
- [X] [T-002] `.gitignore`: insert the leaf of plan decision 6 after the `2026-11-19-bug087` plan leaf. Depends on T-001.
- [X] [T-003] Stage: `git add -u .gitignore` (tracked) and `git add -f docs/superpowers/plans/2026-11-20-bug088-installer-prints-the-opencode-plugin-symlink.md` (new, under the ignored `docs/superpowers/plans/`). Depends on T-002.
- [X] [T-004] Commit: `docs: plan escaping control characters in the OpenCode plugin symlink warning [BUG-088]`. Depends on T-003.

---

### Task 1: Tests first (red)

**Files:**
- Modify: `tests/installer/deploy.test.js`

- [ ] [T-101] `tests/installer/deploy.test.js`, FEAT-048 block: add `POSIX_SYMLINK` and `replacedLine` next to `OUTSIDE_TEXT` (plan decision 3). Depends on T-004.
- [ ] [T-102] `tests/installer/deploy.test.js`, FEAT-048 block: insert E1 and E2 after the `[BUG-087] leaves the symlink and its target alone…` case and before `ships the real plugin in the template` (plan decision 3). Depends on T-101.
- [ ] [T-103] Red run: `npx vitest run tests/installer/deploy.test.js -t 'OpenCode plugin'`. Its full match set is the 10 existing FEAT-048 rows plus E1 and E2, because every row in the block carries the describe name; the other 64 rows of the file are skipped by the filter. Predicted: **2 failed | 10 passed | 64 skipped (76)**. Red: E1, E2. Green: `writes no .opencode/…`, `installs the plugin byte for byte…`, `keeps the host project's own .opencode/ files`, the 3 `[BUG-069]` rows, the 3 `[BUG-087]` rows and `ships the real plugin in the template` (plan decision 5). On a root runner the `[BUG-069]` backup-failure row and the `[BUG-087]` cannot-remove row are skipped: **2 failed | 8 passed | 66 skipped**. Any other split means a test is wrong: fix the test, not the prediction. Depends on T-102.

---

### Task 2: Escape the link text (green)

**Files:**
- Modify: `lib/installer/deploy.mjs`
- Modify: `tools/skip-baseline.json`

- [ ] [T-201] `lib/installer/deploy.mjs`: add `escapeControlChars` between `replaceWithTemplate` and the BUG-087 comment of `removePluginSymlink` (plan decision 1). Depends on T-103.
- [ ] [T-202] `lib/installer/deploy.mjs:260`: interpolate `escapeControlChars(linkText)` in place of `linkText` (plan decision 2). Depends on T-201.
- [ ] [T-203] `tools/skip-baseline.json`, `ci-windows-node24`: insert E2's then E1's full name after the `[BUG-087] leaves the symlink and its target alone…` line (plan decision 4). Depends on T-202.
- [ ] [T-204] Green run: the T-103 command. Predicted: **12 passed | 64 skipped (76)** (root runner: **10 passed | 66 skipped**). Depends on T-203.
- [ ] [T-205] Run: `npx vitest run tests/installer/deploy.test.js tests/installer/file-merge.test.js tests/installer/cli.test.js tests/tools/skip-baseline.test.js`. Predicted: every test passes, 92 of them in the first two files (90 baseline + 2 new). This covers the BUG-087 rows unchanged (AC4), the FEAT-048 CLI cases, and the baseline file still parsing. Depends on T-204.

---

### Task 3: Full suite, scope check and commit

**Files:**
- Modify: `docs/superpowers/plans/2026-11-20-bug088-installer-prints-the-opencode-plugin-symlink.md` (ticks)

- [ ] [T-301] Run `npm test`. Predicted: exit 0 (spec, AC6). A red is called ENV only if the sandbox caused it (network, tmp permissions) and its file is not one this plan touches; report it with its name. Any other red is fixed. Depends on T-205.
- [ ] [T-302] Scope check: `git status --short` lists exactly `lib/installer/deploy.mjs`, `tests/installer/deploy.test.js`, `tools/skip-baseline.json` and this plan; no temporary file is left in the tree. `grep -nP '[\x00-\x08\x0b-\x1f\x7f]' lib/installer/deploy.mjs tests/installer/deploy.test.js` prints nothing (no raw control byte was written into source). Depends on T-301.
- [ ] [T-303] Stage: `git add -u lib/installer/deploy.mjs tests/installer/deploy.test.js tools/skip-baseline.json` (all tracked). Depends on T-302.
- [ ] [T-304] Stage: `git add -u docs/superpowers/plans/2026-11-20-bug088-installer-prints-the-opencode-plugin-symlink.md` (carries the ticks for T-101 to T-303). Depends on T-303.
- [ ] [T-305] Commit: `fix: escape control characters in the OpenCode plugin symlink warning [BUG-088]`. Depends on T-304.

---

## Test List

- [ ] Unit, AC1, AC2 and AC3: E1. A link whose target holds ESC, CR and LF is replaced by a regular file with the shipped bytes; the single stderr warning has no raw C0/DEL/C1 character and shows `\x1b`, `\x0d`, `\x0a` literally in the BUG-087 message; stdout is exactly the `installed` line.
- [ ] Unit, AC5: E2. U+009B in the target is shown as `\x9b`; the printable `ó` is kept.
- [ ] Unit, AC4: the three `[BUG-087]` rows and the other FEAT-048 rows, unchanged and green; `tests/installer/file-merge.test.js` unchanged.
- [ ] AC6: `npm test` (T-301).
- [ ] No integration or E2E/UI test: the change is one message string on a path `cli.test.js` already drives end to end with `--opencode`, and there is no UI.

## Commit Order

1. Task 0 (T-004): this plan and its `.gitignore` leaf.
2. Task 3 (T-305): the tests, the installer change, the skip-baseline lines and the plan ticks for T-101 to T-303, in one commit, so no commit has a red suite. The red run in T-103 happens in the working tree before the fix. The ticks for T-304, T-305 and the Test List ride the closeout commit.

## Identified Risks

- **Changing ordinary output.** Escaping backslashes or quoting the text would change the BUG-087 message for every user. Caught by the unchanged BUG-087 rows at `:737` and `:752` (T-204, T-205).
- **A raw control byte written into source.** Typing the test targets or the regex with literal bytes instead of `\x..` / `\u....` escapes would make the files themselves unsafe to print and fragile in review. T-302 greps both files for raw control bytes (tab and LF excluded).
- **The filesystem rewriting the target.** If a platform normalized or rejected the bytes, E1/E2 would pass or fail for the wrong reason. Each row first asserts `readlinkSync` returns the exact target; win32 is skipped by `POSIX_SYMLINK` and recorded in `ci-windows-node24` (plan decision 4).
- **A Windows runner whose skip set changes differently.** The skip check names any difference as added or removed; that is a measured fact to record, not to predict away.
- **Unicode format characters (bidi overrides).** Not escaped (spec, Out of Scope).
