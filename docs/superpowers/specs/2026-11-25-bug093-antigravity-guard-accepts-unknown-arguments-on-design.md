# BUG-093 — Antigravity guard accepts unknown arguments on read_file, write_file and edit_file

**Status:** Approved 2026-11-25 by independent review (round 1)

**Item:** `[BUG-093]` (intake of issue #316, follow-up of `[FEAT-063]`). Pillar 5: infrastructure, ecosystem and
quality assurance.

## Problem

The Antigravity CLI (`agy`) adapter, `project-template/.agents/hooks/conductor-guard.mjs`, maps four agy tools to
Claude Code's payload shape and runs the unchanged `.claude/hooks/pre-tool-use.mjs` on the result. Only one of the
four mappers checks the call's argument names:

- `run_command` (`conductor-guard.mjs:26-32`) blocks any key outside `RUN_COMMAND_ARGS`
  (`conductor-guard.mjs:19`), naming it (the BUG-071 rule: an argument the guard has not learned may change what
  runs, so it blocks until the guard learns it).
- `read_file` (`conductor-guard.mjs:35-41`), `write_file` (`:46`) and `edit_file` (`:47`) read `Path`, `StartLine`,
  `EndLine`, `Content`, `Target` and `Replacement` and silently drop every other key.

With the argument set measured on agy 1.5.15 (`docs/superpowers/plans/2026-11-23-feat048-codex-antigravity-guards.md`,
"Measured agy 1.5.15 contract") this is not a bypass: Guards 1, 2 and 4 judge the target path, and `Path` is
validated. But if a later agy release adds an argument to one of these tools that changes the effective target (a
path alias, a directory flag, a multi-file edit), the adapter would hand the guard `Path` while agy acts on
something else, and Guards 1, 2 and 4 would be silently weakened. The adapter's own header promises the opposite
("Fail closed: an unmapped tool, a malformed argument or a guard that did not run blocks"), and `run_command`
already keeps that promise.

## Solution

Every mapped tool gets its own allowlist of known argument names, measured on agy 1.5.15, and the adapter blocks a
call to any mapped tool that carries an argument outside its tool's list, naming the argument(s) with the same
reason text `run_command` uses today. The check moves out of `runCommand` into one place, `mapToolCall`, which runs
it before the tool's mapper, so a tool added to the map later cannot be mapped without an allowlist. One test per
tool pins the block; the existing recorded-payload tests pin that today's real calls still pass.

### Choices this spec makes

1. **The allowlists.** Taken from the measured agy 1.5.15 contract, plus `toolSummary`, which the same measurement
   records as an argument "every tool may carry" and the recorded `write_file` and `edit_file` payloads
   (`tests/fixtures/antigravity-payloads.js:14,17`) actually carry:

   | Tool | Known arguments |
   |---|---|
   | `run_command` | `CommandLine`, `toolSummary`, `WaitMsBeforeAsync`, `BypassSandbox`, `IsDaemon` (unchanged) |
   | `read_file` | `Path`, `StartLine`, `EndLine`, `toolSummary` |
   | `write_file` | `Path`, `Content`, `toolSummary` |
   | `edit_file` | `Path`, `Target`, `Replacement`, `toolSummary` |

   Why not leave `toolSummary` out of the file tools: it is measured on every tool, it is free text the guard never
   needs, and blocking it would block every recorded `write_file` and `edit_file` call.

2. **One table, one check.** `MAPPED` becomes a table of `{ args, map }` per tool, and `mapToolCall` checks the
   argument names against `args` before calling `map`. The issue's shape ("an allowlist per tool, like
   `RUN_COMMAND_ARGS`") is met; a central check is chosen over four copies so the rule cannot be forgotten by a
   fifth mapper. `runCommand` loses its own unknown-argument lines and keeps only its `CommandLine` check.

3. **Order of checks.** The unknown-argument check runs before each tool's required-argument check. Either order
   blocks; checking names first means a call with an unknown argument is always reported as that, whatever else is
   wrong with it. The only observable change for `run_command` is a call that has both a non-string `CommandLine`
   and an unknown argument: it now names the unknown argument instead of `CommandLine`. Both remain blocks.

4. **Reason text.** Unchanged from today's `run_command` reason and shared by all four tools:
   `code-conductor guard blocked the Antigravity tool "<tool>": argument "<name>" not covered by the guard`, or
   `arguments "<a>", "<b>" not covered by the guard` for several, names sorted. A key whose value is `undefined`
   is ignored, as today (it cannot occur in JSON stdin, but `mapToolCall` is exported).

5. **No live re-measurement.** This item tightens the adapter to the already-recorded contract; it does not
   re-probe agy. The consequence is stated under Error cases and in the README row: if the real 1.5.15 sends a
   file-tool argument the recording trimmed away, that tool's calls block with the argument named, which is the
   fail-closed direction the adapter promises and is fixed by adding the name to that tool's list.

## Behavior

### Main path

1. agy runs `node hooks/conductor-guard.mjs` with a `PreToolUse` payload on stdin.
2. `mapToolCall` finds the tool in the table. Unmapped tools still block with the uncovered reason.
3. It lists the keys of `toolCall.args` whose value is not `undefined` and that are not in the tool's `args`, sorted.
   None: the tool's mapper runs exactly as today (same `Read`/`Write`/`Edit`/`Bash` payload) and the guard decides.
4. One or more: the adapter replies `{"decision":"deny","reason":…}` with the reason in choice 4, without running
   the guard.

### Alternative paths

- `read_file` with only `Path`, or with `StartLine`/`EndLine`, with or without `toolSummary`: mapped as today
  (Guard 1 still judges an unbounded read).
- `write_file` / `edit_file` exactly as recorded (with `toolSummary`): mapped as today and allowed by the guard for
  a new file and a plain edit.
- `toolCall.args` missing or not an object: treated as `{}` as today, so no unknown keys; the required-argument
  check then blocks (`Path` or `CommandLine` named).

### Error cases

- `read_file` with `Paths`, `write_file` with `Append`, `edit_file` with `AllowMultiple` (stand-ins for a future
  agy argument): blocked, naming that argument; the guard is not run.
- Two unknown arguments on one call: blocked, both named in sorted order, plural wording.
- `run_command` with `Cwd`: blocked naming `"Cwd"`, as today.
- A real agy release that sends a file-tool argument not in the table: every call to that tool blocks with the
  argument named until the table learns it. This is intended (fail closed), and the README row says so.

## Acceptance Criteria

Answering the entry's fix shape ("give each mapped tool an allowlist of known arguments, like `RUN_COMMAND_ARGS`,
and block with the argument's name when an unknown one is present; add one test per tool"):

- [ ] `read_file` with an argument outside `Path`, `StartLine`, `EndLine`, `toolSummary` is denied, and the reason
      names the argument (test in `tests/hooks/antigravity-guard.test.js`, "fails closed" block).
- [ ] `write_file` with an argument outside `Path`, `Content`, `toolSummary` is denied, naming it (test).
- [ ] `edit_file` with an argument outside `Path`, `Target`, `Replacement`, `toolSummary` is denied, naming it (test).
- [ ] A call with two unknown arguments names both, sorted, with the plural wording (test).
- [ ] `run_command` with `Cwd` is still denied naming `"Cwd"`, and `CommandLine: 5` alone still names
      `"CommandLine"` (existing tests unchanged and green).
- [ ] The recorded `read_file` (with and without a line range, and with `toolSummary` added), `write_file` and
      `edit_file` payloads still reach the guard and get the same verdicts as today (existing "recorded calls" tests
      green, plus one `read_file` case carrying `toolSummary`).
- [ ] Every entry of the adapter's tool table has an argument list, and the unknown-argument check lives in
      `mapToolCall`, not in individual mappers (review; enforced by structure: a mapper cannot be registered without
      its `args`).
- [ ] README `### Antigravity CLI` table: the `run_command`-only row becomes one row covering the four tools and
      their known arguments, still "Blocked, naming the argument".
- [ ] `npm test` green.

## Out of Scope

- Re-measuring agy's argument set live, or adding arguments a newer agy may already send (choice 5).
- Validating argument values beyond what the mappers check today (`Content`, `Target`, `Replacement` types, line
  numbers): the entry is about unknown names.
- New agy tools; unmapped tools already block.
- The OpenCode plugin and the Codex adapter (their payloads come in Claude Code's or OpenCode's shape; BUG-071 and
  BUG-094 cover them).
- `CHANGELOG.md`, `VERSION`, the backlog and memory (written at release), and README "Known limits".

## System Impact

- `project-template/.agents/hooks/conductor-guard.mjs` — `RUN_COMMAND_ARGS` folds into a per-tool table; `MAPPED`
  entries become `{ args, map }`; the unknown-argument filter and reason move from `runCommand` into
  `mapToolCall`; `write_file`/`edit_file` mappers unchanged in output. Protected surface (hooks): the change only
  adds blocks, never removes one, and the guard `pre-tool-use.mjs` is not touched, so no Guard 3 reference or
  corpus change.
- `tests/hooks/antigravity-guard.test.js` — new cases in "fails closed" (one per file tool, one plural) and one
  in "recorded calls" (`read_file` with `toolSummary`).
- `tests/fixtures/antigravity-payloads.js` — unchanged; the new cases pass extra keys through the existing
  `range` parameter of `readFile` or build the event inline as the unknown-tool test does.
- `README.md` `### Antigravity CLI` table row (line 431). Not the Known-limits section.
- `lib/installer/deploy.mjs` — no change: it copies the adapter from `project-template/` (`ANTIGRAVITY_GUARD`,
  line 290), so a re-run of `--project --antigravity` delivers the fix. `tests/installer/*` assert the file exists,
  not its content.
- `.gitignore` — this spec's leaf in the tracked-surface block, in sorted position. `project-template/` files need
  no leaf.

### Files Requiring Full Read (deferred to /cc-plan)

_None. The adapter (101 lines), its test (109 lines) and its fixture (17 lines) were read in full for this spec._

## Complexity Estimate

S — one 101-line adapter gains a per-tool argument table and moves one existing check into its dispatcher, plus
five tests and one README row.
