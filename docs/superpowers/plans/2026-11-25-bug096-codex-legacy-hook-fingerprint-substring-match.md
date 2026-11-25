# BUG-096: Codex legacy hook entry matched by exact command, implementation plan

**Goal:** `--project --codex` replaces the old conductor `PreToolUse` entry in `.codex/hooks.json` only when one of
its commands is exactly `node .claude/hooks/pre-tool-use.mjs`; a host entry whose command merely contains
`pre-tool-use.mjs` is kept, and the shipped entry is appended after it with status `merged`.

**Architecture:** the settings merger's legacy option changes from a substring list (`legacyFingerprints`) to an
exact-command list (`legacyCommands`). `upsertEntry` keeps substring matching for the current fingerprint and uses a
new predicate, `entryHasCommand`, for the legacy list. The Codex installer passes
`CODEX_LEGACY_COMMANDS = { 'conductor-guard.mjs': ['node .claude/hooks/pre-tool-use.mjs'] }`. Statuses, report lines,
templates and hooks are unchanged.

**Tech stack:** Node ESM, `node:` builtins only, vitest. Test command: `npm test`.

**Spec:** `docs/superpowers/specs/2026-11-25-bug096-codex-legacy-hook-fingerprint-substring-match-design.md`
(approved by independent review, round 1; sha256 `5d52806e6ebe6d0aaaacea0c88a2f8ead118f5803b02afd1fe2b486c9d83174c`).

## Global constraints

- Records are not touched: `VERSION`, `package.json`/`package-lock.json` versions, `CHANGELOG.md`, the backlog,
  `.claude/memory/**`, the README "Known limits" lines.
- No new dependency; `dependencies` stays `{}`. No workflow file is touched.
- Protected surface touched: the installer (`lib/installer/deploy.mjs`, `lib/installer/settings-merge.mjs`). No hook,
  template, SNAP script or settings file changes.
- The installer is never run in this repository; it is exercised only through its tests in temp directories.
- Claude Code settings and Antigravity merges pass no legacy list; their output stays byte-identical.
- Never bare `git add -u`; every staging step names its paths.

## Decisions this plan takes (technical, inside the spec)

1. **One task, one commit group, for the merger and the installer.** Renaming the option in the merger alone would
   leave `deploy.mjs` passing `legacyFingerprints`, which the renamed merger ignores, so the existing BUG-094 deploy
   case (`replaces the FEAT-048 entry in place …`) would go red between two commits. Both files change in the same
   group, after every test edit.
2. **The regression red for the backlog's test lives in the deploy suite.** Before the fix, the merger ignores the
   unknown `legacyCommands` option, so the merger-level "similar name survives" case already passes once the tests use
   the new option name; it pins the post-fix behavior but cannot show the defect. The deploy case drives the real
   installer, which still passes the substring list today, so it fails red before the fix (the user's entry is
   replaced and `REPLACED` is printed) and turns green only with the fix. The merger case with both a similar-named
   host entry and the exact legacy entry fails red before the fix (the option is ignored, so the legacy entry is
   kept), which shows the renamed option is wired.
3. **`entryHasCommand` stays module-private.** Only `upsertEntry` calls it; `entryMatches` is exported because other
   modules use it, and nothing outside this module needs the exact predicate (spec choice 4; no speculative export).
4. **The existing describe keeps its name** (`mergeSettingsFile: legacy fingerprints (BUG-094)`), so the eight
   BUG-094 identities the spec's acceptance criteria name stay the same. The three new cases go in the same describe,
   each name ending `(BUG-096)`. The existing "both fingerprints" case keeps its command
   `node -e "conductor-guard.mjs" pre-tool-use.mjs`: it still matches the current fingerprint by substring and is not
   equal to the legacy command, so it stays `merged`.
5. **Fixture for the similar name:** `{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node tools/my-pre-tool-use.mjs' }] }`
   (named `SIMILAR`) in both suites; `{ matcher: '.*', hooks: [{ type: 'command', command: 'node .claude/hooks/pre-tool-use.mjs --log' }] }`
   (named `NEAR_COPY`) in the merger suite.

---

- [X] [T-000] Task 0: commit the plan (done by the runner at the end of the plan session)
  - [X] [T-000-A] Add the leaf `!/docs/superpowers/plans/2026-11-25-bug096-codex-legacy-hook-fingerprint-substring-match.md` to the `.gitignore` tracked-surface block in sorted position (after `2026-11-25-bug094-codex-guard-hook-fails-open-when-codex-starts.md`).
  - [X] [T-000-B] `git add -f docs/superpowers/plans/2026-11-25-bug096-codex-legacy-hook-fingerprint-substring-match.md` then `git add -u .gitignore`.
  - [X] [T-000-C] `git commit -m "docs: add the BUG-096 exact legacy command implementation plan [BUG-096]"`

### Task 1: exact legacy commands in the merger and the Codex installer

**Files:**
- Modify: `lib/installer/settings-merge.mjs` (new `entryHasCommand`; `upsertEntry`, `mergeHookTree`, `mergeSettingsFile`; the comment at 35-39)
- Modify: `lib/installer/deploy.mjs` (comment at 292-295, `mergeHarnessHooks` at 296-299, constant at 323, call at 330)
- Test: `tests/installer/settings-merge.test.js` (describe `mergeSettingsFile: legacy fingerprints (BUG-094)`, 208-259)
- Test: `tests/installer/deploy.test.js` (describe `deployProject: Codex hook (FEAT-048, BUG-094)`, 887-978)

**Interfaces:**
- `entryHasCommand(entry, command)`: `false` unless `entry` is an object with a `hooks` array; then `true` when some
  hook item is truthy, has a string `command`, and that `command === command`. No trim, no case folding (spec choice 1).
- `upsertEntry(arr, tplEntry, fingerprint, legacy = [])`: `ours(e)` is
  `entryMatches(e, fingerprint) || legacy.some((cmd) => entryHasCommand(e, cmd))`; the rest of the body (in-place
  replace, drop later copies, `legacyHit` when a replaced or dropped entry is ours but does not match `fingerprint`)
  is unchanged. Stays under 30 lines.
- `mergeHookTree(hostHooks, tplHooks, fingerprints, legacyCommands)`; it passes `legacyCommands[fps[0]]` to
  `upsertEntry`.
- `mergeSettingsFile(templatePath, settingsPath, fingerprints, { now = new Date(), legacyCommands = {} } = {})`; it
  forwards `legacyCommands` to `mergeHookTree`. Only the name changes in this function.
- `mergeHarnessHooks(templateRoot, cwd, dir, fingerprint, warn, legacyCommands = {})` forwards `{ legacyCommands }`.
- `const CODEX_LEGACY_COMMANDS = { 'conductor-guard.mjs': ['node .claude/hooks/pre-tool-use.mjs'] };` replaces
  `CODEX_LEGACY_FINGERPRINTS`; `installCodexHook` passes it. Report lines unchanged (spec choice 5).
- Comments say why: the comment above `upsertEntry` says `legacy` lists the exact commands an older release shipped
  for this entry, matched by equality so a host command that only resembles one stays host-owned (BUG-096); the
  comment above `mergeHarnessHooks` says `legacyCommands` names the exact old commands of our entry, so that entry is
  replaced instead of left beside ours, and nothing else is.

- [ ] [T-001] Tests, then the merger and the installer
  - [ ] [T-001-A] Modify `tests/installer/settings-merge.test.js`, describe `mergeSettingsFile: legacy fingerprints (BUG-094)`: set `LEGACY` to `{ 'conductor-guard.mjs': ['node .claude/hooks/pre-tool-use.mjs'] }`; rename every `legacyFingerprints:` option key in the describe to `legacyCommands:` (seven uses at 222, 226, 230, 234, 238, 243, 256); add the fixtures `SIMILAR` and `NEAR_COPY` (decision 5); add three cases: (A) `keeps a host entry whose command only contains the legacy file name (BUG-096)`: `run([SIMILAR], { legacyCommands: LEGACY })` is `merged` and `PreToolUse` equals `[SIMILAR, SHIPPED]`; (B) `keeps a host entry that extends the legacy command (BUG-096)`: `run([NEAR_COPY], { legacyCommands: LEGACY })` is `merged` and `PreToolUse` equals `[NEAR_COPY, SHIPPED]`; (C) `replaces the exact legacy entry and keeps a similar-named one in place (BUG-096)`: `run([SIMILAR, OLD, HOST_ENTRY2], { legacyCommands: LEGACY })` is `legacy-replaced` and `PreToolUse` equals `[SIMILAR, SHIPPED, HOST_ENTRY2]`.
  - [ ] [T-001-B] Modify `tests/installer/deploy.test.js`, describe `deployProject: Codex hook (FEAT-048, BUG-094)`: add `SIMILAR` (decision 5) beside `host`, and the case `keeps a host entry whose command only contains pre-tool-use.mjs (BUG-096)`: `writeHostHooks([SIMILAR])`, deploy with `codex: true`; `PreToolUse` equals `[SIMILAR, OURS]`; `said` contains `INSTALLED` and not `REPLACED`. Place it after the `replaces the FEAT-048 entry in place …` case.
  - [ ] [T-001-C] Run `npx vitest run tests/installer/settings-merge.test.js tests/installer/deploy.test.js`. Expected (red, full match set of both files): `settings-merge.test.js` 32 tests, 4 FAIL: `replaces a legacy-only entry in place and reports legacy-replaced`, `collapses duplicate legacy entries into one shipped entry`, `drops a legacy entry that trails the current one` and new (C), because today's merger ignores `legacyCommands` and keeps the old entry; 28 PASS: the 21 tests outside the describe, the other five BUG-094 cases (`unchanged`, both fingerprints, `created`, no list, empty-map bytes) and new (A) and (B) (decision 2). `deploy.test.js` 95 tests, 1 FAIL: the new BUG-096 case, because the installer still passes the substring list, so `SIMILAR` is replaced and `REPLACED` is printed; 94 PASS (the symlink case runs on Linux). Any other result halts the task.
  - [ ] [T-001-D] Modify `lib/installer/settings-merge.mjs` per Interfaces: add `entryHasCommand` after `entryMatches`; change `upsertEntry`'s `ours`; rename `legacyFingerprints` to `legacyCommands` in `mergeHookTree` (53, 66) and `mergeSettingsFile` (79, 121); rewrite the comment at 35-39.
  - [ ] [T-001-E] Modify `lib/installer/deploy.mjs` per Interfaces: rename the parameter and forwarded option in `mergeHarnessHooks` (296, 299) and rewrite its comment (292-295); replace the constant at 323 with `CODEX_LEGACY_COMMANDS`; pass it at 330.
  - [ ] [T-001-F] Run `grep -rn "legacyFingerprints\|LEGACY_FINGERPRINTS" lib tests`. Expected: no output (spec AC: the option no longer exists in `lib/`; the tests use the new name too).
  - [ ] [T-001-G] Run `npx vitest run tests/installer`. Expected: all PASS (`settings-merge.test.js` 32, `deploy.test.js` 95, and every other installer suite unchanged; `cli.test.js` installs Codex fresh, which is `created`).
  - [ ] [T-001-H] `git add -u lib/installer/settings-merge.mjs lib/installer/deploy.mjs tests/installer/settings-merge.test.js tests/installer/deploy.test.js docs/superpowers/plans/2026-11-25-bug096-codex-legacy-hook-fingerprint-substring-match.md`
  - [ ] [T-001-I] `git commit -m "fix: match the old Codex hook entry by its exact command, not a file name [BUG-096]"`

### Task 2: closeout

- [ ] [T-002] Full suite and scope check
  - [ ] [T-002-A] Run `npm test`. Expected: exit 0; no new skip (no test added here uses a skip gate).
  - [ ] [T-002-B] `git diff origin/main --stat` lists only: `.gitignore`, the spec, this plan, `lib/installer/deploy.mjs`, `lib/installer/settings-merge.mjs`, `tests/installer/deploy.test.js`, `tests/installer/settings-merge.test.js`. No record, no hook, no template, no `package.json`.
  - [ ] [T-002-C] `git add -u docs/superpowers/plans/2026-11-25-bug096-codex-legacy-hook-fingerprint-substring-match.md`
  - [ ] [T-002-D] `git commit -m "docs: close out the BUG-096 plan [BUG-096]"`

## Test list

- [ ] [T-003] `tests/installer/settings-merge.test.js` (Task 1): `legacyCommands` with the exact command replaces the old entry in place (`legacy-replaced`), leaves the merged result `unchanged`, treats an entry carrying the current fingerprint as current (`merged`), collapses duplicates, drops a trailing legacy entry, creates a missing file, appends without a list, writes identical bytes with an empty map; new: a similar-named host entry survives with `merged`; a host entry extending the legacy command survives with `merged`; a similar-named entry keeps its position while the exact legacy entry is replaced (`legacy-replaced`).
- [ ] [T-004] `tests/installer/deploy.test.js` (Task 1): a `.codex/hooks.json` holding only `node tools/my-pre-tool-use.mjs` keeps it after `--codex`, gains the bootstrap entry after it, and the report is `INSTALLED`, not `REPLACED`; the existing BUG-094 replace case still replaces the exact legacy entry.

## Commit order

1. Task 0, plan (runner, end of the plan session).
2. Task 1, tests then the merger and the installer together (decision 1).
3. Task 2, closeout.

In the build session the runner makes one commit of the whole tree; the commit steps above are its grouping guide and
are ticked when the runner's commit carries them.

## Identified risks

- **An old install whose legacy line was hand-edited** (spacing, an added flag) is now kept beside the new entry
  instead of replaced. Accepted by the spec (choice 1): the stale entry can add a verdict, never remove the new one.
  The merger case (B) pins this behavior so a later "normalize the command" change has to be deliberate.
- **A Windows-written host file** cannot differ in the command string: JSON re-serialization keeps string values,
  and the installer wrote the template's string verbatim, so path separators in the shipped command are always `/`.
- **The red prediction depends on today's merger ignoring an unknown option.** If T-001-C shows (A) or (B) failing,
  the merger already reads `legacyCommands` somewhere; halt and re-read `mergeSettingsFile`'s destructuring rather
  than adjusting the prediction.
- **Line numbers drift.** The cited lines are from `a22e8f39`; the build edits by the named functions and constants,
  not by line number.
- **Current fingerprints stay substring matches** (`conductor-guard.mjs` and the Claude settings fingerprints); a host
  command containing `conductor-guard.mjs` is still captured. Out of scope per the spec; not changed here.
