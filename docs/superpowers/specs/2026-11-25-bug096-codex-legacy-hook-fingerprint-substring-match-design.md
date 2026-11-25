# BUG-096 — Codex legacy hook fingerprint substring match replaces user-owned PreToolUse entries

**Status:** Draft (pending independent review)

**Item:** `[BUG-096]` (intake of issue #325, follow-up of `[BUG-094]`). Pillar 5: infrastructure, ecosystem and
quality assurance.

## Problem

`[BUG-094]` moved the Codex `PreToolUse` entry from `node .claude/hooks/pre-tool-use.mjs` to a `node -e` bootstrap
and taught the merger to replace the old entry in place. It did that with a *legacy fingerprint*:
`lib/installer/deploy.mjs:323` declares `CODEX_LEGACY_FINGERPRINTS = { 'conductor-guard.mjs': ['pre-tool-use.mjs'] }`,
and `upsertEntry` (`lib/installer/settings-merge.mjs:41`) treats a host entry as ours when any of its commands
**contains** a legacy fingerprint (`entryMatches`, `settings-merge.mjs:17-20`, is `command.includes(fp)`).

So any user-owned `PreToolUse` entry in `.codex/hooks.json` whose command merely contains the text
`pre-tool-use.mjs` is captured as the old conductor entry:

- `node tools/my-pre-tool-use.mjs` (a user's own guard with a similar name);
- `bash scripts/run.sh --then other/pre-tool-use.mjs`;
- `node .claude/hooks/pre-tool-use.mjs --log` (the user wrapped or extended the old line).

On `--project --codex` the first such entry is overwritten by the shipped bootstrap entry and every later one is
dropped (`settings-merge.mjs:45-47`). The installer then prints the generic
"replaced the old Codex guard hook in .codex/hooks.json" line (`deploy.mjs:332`), which reads as the conductor
upgrading its own entry. A user's own guard disappears silently.

The only command the conductor ever shipped for that entry is the exact string
`node .claude/hooks/pre-tool-use.mjs` (the `[FEAT-063]` template, `project-template/.codex/hooks.json` before
`[BUG-094]`). The installer wrote it verbatim from the template, and a JSON re-serialization does not change a string
value, so an unmodified old install carries exactly that string.

## Solution

Replace the legacy *substring* list with a legacy *exact-command* list. The merger option becomes
`legacyCommands`: a map from the current fingerprint to the full command strings an older release shipped for that
entry. A host entry is the old conductor entry only when one of its `hooks[].command` values is strictly equal
(`===`) to one of those strings. The Codex installer passes
`{ 'conductor-guard.mjs': ['node .claude/hooks/pre-tool-use.mjs'] }`. Matching against the current fingerprint
(`conductor-guard.mjs`) is unchanged. A host entry whose command only resembles the old one is host-owned, is kept
where it is, and the shipped entry is appended after it with status `merged`, not `legacy-replaced`.

## Choices made

1. **Exact equality, no normalization.** The backlog's fix shape names "the exact legacy command that was shipped".
   No trim, no whitespace collapsing, no case folding: the installer wrote the string verbatim, so an untouched old
   install still matches, and any text the user changed makes the entry theirs. Cost of a hand-edited old entry
   (for example extra spaces): it is kept beside the new entry instead of replaced. That stale entry still runs the
   old guard from the cwd, which can only add a verdict, never remove the new one; dropping a line the user edited
   is the defect this item fixes, so the conservative side wins.
2. **Ownership stays entry-level.** As with the current fingerprint (`settings-merge.mjs:10-13`), an entry is ours
   when *any* of its commands matches. The `[FEAT-063]` entry held one command, so an entry holding the exact legacy
   command is the shipped entry, possibly with a command the user added inside it; that case is replaced as today,
   which keeps `[BUG-094]`'s guarantee that the old fail-open entry does not survive next to the new one.
3. **Rename the option and the constant.** `legacyFingerprints` becomes `legacyCommands` and
   `CODEX_LEGACY_FINGERPRINTS` becomes `CODEX_LEGACY_COMMANDS`. In this module "fingerprint" means a substring;
   keeping the name for an exact-match list would invite the next caller to pass a file name again and silently
   match nothing. The only callers are `deploy.mjs` and `tests/installer/settings-merge.test.js`; the option is not
   part of the CLI or of any documented interface.
4. **A separate predicate, `entryHasCommand(entry, command)`,** beside `entryMatches` in `settings-merge.mjs`, with the
   same shape guards (`entry` is an object, `hooks` an array, `command` a string). `entryMatches` is not given a
   mode flag: one function per matching rule.
5. **The report line is unchanged.** With the capture narrowed to the exact shipped command, "replaced the old Codex
   guard hook" is now true whenever it is printed.

## Behavior

### Main path

1. A project installed with `[FEAT-063]` has `.codex/hooks.json` with the entry
   `{ matcher: '.*', hooks: [{ type: 'command', command: 'node .claude/hooks/pre-tool-use.mjs' }] }` and possibly
   host entries.
2. `--project --codex` runs `installCodexHook`, which calls `mergeHarnessHooks(..., 'conductor-guard.mjs', warn,
   CODEX_LEGACY_COMMANDS)`, which calls `mergeSettingsFile(..., ['conductor-guard.mjs'], { legacyCommands })`.
3. `upsertEntry` finds the first entry that matches the fingerprint by substring or carries a legacy command
   exactly, replaces it in place with the shipped entry, drops later such entries, and reports `legacyHit` when one of
   them matched only through a legacy command. Status `legacy-replaced`; the installer prints the re-trust line.

### Alternative paths

- Host entry `node tools/my-pre-tool-use.mjs` (no conductor entry present): kept untouched; the shipped entry is
  appended; status `merged`; the installer prints the "installed ... trust it once" line.
- Host entry `node tools/my-pre-tool-use.mjs` **and** the exact legacy entry: the legacy entry is replaced in place,
  the user's entry is kept at its position; status `legacy-replaced`.
- Host entry `node .claude/hooks/pre-tool-use.mjs --log` (a near copy): host-owned, kept; shipped entry appended;
  status `merged`.
- Host file already equal to the merged result: `unchanged`, as today.
- Duplicate exact legacy entries, or a legacy entry after the current one: collapsed to one shipped entry,
  `legacy-replaced`, as today.
- A call without `legacyCommands` (Claude Code settings, Antigravity): byte-identical to today.

### Error cases

- A hook item without a string `command`, or an entry without a `hooks` array: never matches a legacy command (same
  guards as `entryMatches`).
- Malformed JSON, a directory or a dangling symlink at `.codex/hooks.json`: unchanged handling
  (`malformed-replaced`, `skipped-dir`, `skipped-dangling`).

## Acceptance Criteria

- [ ] `lib/installer/deploy.mjs` declares the Codex legacy entry as the exact command
      `node .claude/hooks/pre-tool-use.mjs` (constant `CODEX_LEGACY_COMMANDS`), not the substring `pre-tool-use.mjs`.
- [ ] `mergeSettingsFile` accepts `legacyCommands` and `upsertEntry` treats a host entry as a legacy conductor entry
      only when one of its `hooks[].command` values is strictly equal to a listed command; the option
      `legacyFingerprints` no longer exists in `lib/`.
- [ ] Merge test in `tests/installer/settings-merge.test.js`: a host entry `node tools/my-pre-tool-use.mjs` survives
      the merge in place, the shipped entry is appended, and the status is `merged` (the backlog's required test).
- [ ] Merge test: a host entry whose command contains the legacy command plus more text
      (`node .claude/hooks/pre-tool-use.mjs --log`) survives, status `merged`.
- [ ] Merge test: with both a similar-named host entry and the exact legacy entry, the legacy entry is replaced in
      place, the host entry keeps its position, status `legacy-replaced`.
- [ ] The existing `mergeSettingsFile: legacy fingerprints (BUG-094)` cases keep passing with the option renamed
      (replace in place, unchanged re-run, both-fingerprint entry, duplicate collapse, trailing legacy entry, create,
      no-list append, empty-map byte identity).
- [ ] Deploy test in `tests/installer/deploy.test.js` (`deployProject: Codex hook (FEAT-048, BUG-094)`): a
      `.codex/hooks.json` holding only `node tools/my-pre-tool-use.mjs` keeps that entry after `--codex`, gains the
      bootstrap entry, and the report is the "installed" line, not the "replaced the old Codex guard hook" line.
- [ ] The comments at `deploy.mjs:292-295` and `settings-merge.mjs:35-39` describe legacy matching as exact
      command equality.
- [ ] `npm test` passes.

## Out of Scope

- The current fingerprints stay substring matches: `conductor-guard.mjs` on `.codex/hooks.json` and
  `.agents/hooks.json`, and the Claude Code `settings.json` fingerprints. A host command that merely contains
  `conductor-guard.mjs` is still captured as owned; that is the general limitation recorded at
  `settings-merge.mjs:13-16`, and narrowing it needs an ownership marker in every existing install. Not named by this
  entry; a candidate follow-up.
- Restoring entries a previous install already removed (including any captured by the `[FEAT-063]` merge, whose
  fingerprint was the same substring).
- Changing the installer's report wording, the bootstrap command or the Codex adapter.
- Records (`VERSION`, `CHANGELOG.md`, backlog, memory), README "Known limits".

## System Impact

- `lib/installer/deploy.mjs:292-296, 323, 330` (protected surface: installer): constant renamed and set to the exact
  command; `mergeHarnessHooks` parameter and forwarded option renamed; comment updated.
- `lib/installer/settings-merge.mjs:35-49, 53, 66, 79, 121`: new `entryHasCommand`; `upsertEntry` uses it for the
  legacy list; `legacyFingerprints` renamed to `legacyCommands` through `mergeHookTree` and `mergeSettingsFile`;
  comment updated. Status values unchanged.
- `tests/installer/settings-merge.test.js:208-260`: option and `LEGACY` map renamed to the exact command; three new
  cases.
- `tests/installer/deploy.test.js:887+`: one new case; the existing `LEGACY` fixture already uses the exact command.
- No change to hooks, templates, CLI flags, dependencies or workflows.

### Files Requiring Full Read (deferred to /cc-plan)

- `tests/installer/deploy.test.js` (the `deployProject: Codex hook (FEAT-048, BUG-094)` block, for the fixture and
  report helpers the new case reuses).

## Complexity Estimate

S — one predicate and a renamed option in the merger, a one-line constant in the installer, and four tests.
