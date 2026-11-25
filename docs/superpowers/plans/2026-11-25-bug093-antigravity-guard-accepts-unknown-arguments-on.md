# BUG-093: Antigravity guard accepts unknown arguments on read_file, write_file and edit_file, implementation plan

**Goal:** Every tool the Antigravity adapter maps (`run_command`, `read_file`, `write_file`, `edit_file`) blocks a
call that carries an argument outside that tool's known set, naming the argument, instead of silently dropping it.

**Architecture:** `MAPPED` in `project-template/.agents/hooks/conductor-guard.mjs` becomes a table of
`{ args, map }` per tool. `mapToolCall` lists the call's unknown argument names against the tool's `args` and
blocks with today's `run_command` reason before any mapper runs; `runCommand` keeps only its `CommandLine` check.
The guard `pre-tool-use.mjs` is not touched.

**Tech stack:** Node ESM, `node:` builtins only, vitest. Test command: `npm test`.

**Spec:** `docs/superpowers/specs/2026-11-25-bug093-antigravity-guard-accepts-unknown-arguments-on-design.md`
(sha256 `fffb5b5ff41c395bb1c9461ebdfe49543614a935ab25c3551e7adcb30a57d6a3`).

## Global constraints

- `project-template/.claude/hooks/pre-tool-use.mjs`, `.claude/hooks/pre-tool-use.mjs` and
  `tests/fixtures/guard3-reference.sh` are not edited, so no Guard 3 ruling or corpus change is needed.
- No new dependency; `dependencies` stays `{}`. No `.github/` change.
- Records are not touched: `VERSION`, `package.json`/`package-lock.json` versions, `CHANGELOG.md`, the backlog,
  `.claude/memory/**`, and the README "Known limits" `[BUG-093]` line (`README.md:536`), which the release removes.
- `tests/fixtures/antigravity-payloads.js` is not edited (spec, System Impact): new cases pass extra keys through
  `readFile`'s `range` parameter or build the event inline.
- `lib/installer/deploy.mjs` is not edited: it copies the adapter from `project-template/`.
- Protected surface touched: hooks (`project-template/.agents/hooks/conductor-guard.mjs`). The change only adds
  blocks; no existing block is removed or weakened.
- Never bare `git add -u`; every staging step names its paths.

## Decisions this plan takes (technical, inside the spec)

1. **Helper shape.** Two small helpers replace the inline lines of `runCommand`:
   `unknownArgs(a, known)` returns `Object.keys(a).filter((k) => a[k] !== undefined && !known.has(k)).sort()`, and
   `notCovered(tool, names)` returns the `{ block }` with the exact reason of spec choice 4 (singular `argument`
   for one name, plural `arguments` for several, names quoted and joined with `, `). The reason bytes for
   `run_command` are therefore unchanged.
2. **Table layout.** Each `MAPPED` entry is `{ args: new Set([...]), map }`. `RUN_COMMAND_ARGS` is removed (its set
   becomes `MAPPED.run_command.args`); nothing else in the repository imports it (grep: only the adapter and the
   backlog text name it). The `write_file` and `edit_file` arrow mappers keep their current bodies. The comment
   above the table says why the lists exist: measured on agy 1.5.15; an argument outside a tool's list may change
   what runs or which file is touched, so it blocks until the guard learns it (BUG-071 rule, extended by BUG-093);
   `toolSummary` is free text every agy tool may carry.
3. **Order in `mapToolCall`.** Unchanged up to the `args` normalization (no `toolCall` → block; unmapped → block;
   non-object `args` → `{}`); then the unknown-argument check; then `MAPPED[tool].map(args, tool)` (spec choice 3).
4. **Exact assertions.** The new fail-closed tests assert the full reason with `toBe`, so the wording of spec
   choice 4 is pinned for the file tools and not only the argument name. The existing `run_command` tests keep
   their `toMatch` form unchanged (acceptance criterion: "existing tests unchanged").
5. **Stand-in arguments.** `Paths` on `read_file`, `Append` on `write_file`, `AllowMultiple` on `edit_file`, and
   `AllowMultiple` plus `Paths` on `edit_file` for the plural case: the stand-ins the spec's Error cases name. The
   plural case uses a file tool so that it is red before the fix.

## Predicted skips per environment

None. No new test is gated by platform, and no existing skip changes; `tools/skip-baseline.json` is not edited.

---

- [X] [T-000] Task 0: commit the plan (done by the runner at the end of the plan session)
  - [X] [T-000-A] Add the leaf `!/docs/superpowers/plans/2026-11-25-bug093-antigravity-guard-accepts-unknown-arguments-on.md` to the `.gitignore` tracked-surface block in sorted position (after `2026-11-23-feat048-harness-commands.md`, before `2026-11-25-bug094-codex-guard-hook-fails-open-when-codex-starts.md`).
  - [X] [T-000-B] `git add -f docs/superpowers/plans/2026-11-25-bug093-antigravity-guard-accepts-unknown-arguments-on.md` then `git add -u .gitignore`.
  - [X] [T-000-C] `git commit -m "docs: add the BUG-093 Antigravity argument allowlist implementation plan [BUG-093]"`

### Task 1: per-tool argument allowlists in the Antigravity adapter

**Files:**
- Modify: `project-template/.agents/hooks/conductor-guard.mjs` (lines 17-56: `RUN_COMMAND_ARGS`, `runCommand`,
  `MAPPED`, `mapToolCall`)
- Test: `tests/hooks/antigravity-guard.test.js`

**Interfaces:**
- `mapToolCall(toolCall)` (exported, signature unchanged) returns `{ block }` or `{ payload }`. For a mapped tool
  whose `args` carry a key outside `MAPPED[tool].args` (value not `undefined`), it returns
  `{ block: 'code-conductor guard blocked the Antigravity tool "<tool>": argument "<name>" not covered by the guard' }`,
  or `arguments "<a>", "<b>" not covered by the guard` for several names, sorted. Otherwise its result is
  byte-identical to today's.
- Known arguments (spec choice 1): `run_command` `CommandLine`, `toolSummary`, `WaitMsBeforeAsync`,
  `BypassSandbox`, `IsDaemon`; `read_file` `Path`, `StartLine`, `EndLine`, `toolSummary`; `write_file` `Path`,
  `Content`, `toolSummary`; `edit_file` `Path`, `Target`, `Replacement`, `toolSummary`.
- `runCommand(a, tool)`: only `if (typeof a.CommandLine !== 'string') return badArg(...)` then
  `return one('Bash', { command: a.CommandLine })`.
- Every function stays under 30 lines; the adapter stays near its current 101 lines.

- [X] [T-001] Adapter tests, then the adapter
  - [X] [T-001-A] Modify `tests/hooks/antigravity-guard.test.js`, describe `Antigravity adapter: recorded calls`: add `it('passes a recorded read_file carrying toolSummary to the guard (BUG-093)')`, reusing `big.txt` (write it again with `'line\n'.repeat(400)` so the case does not depend on test order): `readFile(project, 'big.txt', { toolSummary: 'read a file' })` matches `/Guard 1/`, and `readFile(project, 'big.txt', { StartLine: 10, EndLine: 20, toolSummary: 'read a file' })` is `''`.
  - [X] [T-001-B] Modify the same file, describe `Antigravity adapter: fails closed`, after the existing `run_command` unknown-argument case: add four cases, each asserting the full reason with `toBe` (decision 4):
    - `blocks read_file with an argument it does not know, naming it (BUG-093)`: write `small.txt` (`'hello\n'`); `readFile(project, 'small.txt', { Paths: [join(project, 'small.txt')] })` → `code-conductor guard blocked the Antigravity tool "read_file": argument "Paths" not covered by the guard`.
    - `blocks write_file with an argument it does not know, naming it (BUG-093)`: inline event `{ cwd: project, hookEventName: 'PreToolUse', toolCall: { name: 'write_file', args: { Path: join(project, 'fresh-append.txt'), Content: 'hello\n', toolSummary: 'write a file', Append: true } } }` → `... tool "write_file": argument "Append" not covered by the guard`.
    - `blocks edit_file with an argument it does not know, naming it (BUG-093)`: write `note-edit.txt` (`'hello\n'`); inline event for `edit_file` with `Path` (that file), `Target: 'hello'`, `Replacement: 'bye'`, `toolSummary: 'edit a file'`, `AllowMultiple: true` → `... tool "edit_file": argument "AllowMultiple" not covered by the guard`.
    - `names every unknown argument, sorted, with the plural wording (BUG-093)`: the same `edit_file` event with `Paths: ['x']` added before `AllowMultiple` in the object literal → `... tool "edit_file": arguments "AllowMultiple", "Paths" not covered by the guard`.
  - [X] [T-001-C] Run `npx vitest run tests/hooks/antigravity-guard.test.js`. Expected full match set (189 tests): the 173 Guard 3 corpus rows PASS; the 4 existing recorded-call cases PASS; the new `toolSummary` read case PASSES already (today the adapter drops `toolSummary` and maps the read unchanged); the 7 existing fail-closed cases PASS; the 4 new fail-closed cases FAIL (today the adapter drops the unknown key and the guard allows the call, so the reason is `''`). Any other result halts the task.
  - [X] [T-001-D] Modify `project-template/.agents/hooks/conductor-guard.mjs` per Interfaces and decisions 1-3: remove `RUN_COMMAND_ARGS`; add `unknownArgs` and `notCovered` beside `badArg`/`uncovered`; reduce `runCommand` to its `CommandLine` check and mapping; turn `MAPPED` into `{ args, map }` entries with the comment of decision 2; in `mapToolCall`, after the `args` line, block with `notCovered(tool, unknown)` when `unknownArgs(args, MAPPED[tool].args)` is non-empty, else return `MAPPED[tool].map(args, tool)`. Keep the file header (its "Fail closed" sentence is now true for every mapped tool).
  - [X] [T-001-E] Run `npx vitest run tests/hooks/antigravity-guard.test.js`. Expected: all 189 PASS (the existing `"Cwd"` and `"CommandLine"` cases included).
  - [X] [T-001-F] Run `npx vitest run tests/installer/deploy.test.js tests/installer/cli.test.js`. Expected: all PASS (they assert the adapter is copied, not its content).
  - [X] [T-001-G] `git add -u project-template/.agents/hooks/conductor-guard.mjs tests/hooks/antigravity-guard.test.js docs/superpowers/plans/2026-11-25-bug093-antigravity-guard-accepts-unknown-arguments-on.md`
  - [X] [T-001-H] `git commit -m "fix: block unknown arguments on every Antigravity tool the guard maps [BUG-093]"`

### Task 2: README row

**Files:**
- Modify: `README.md` (`### Antigravity CLI` table, line 431)

- [X] [T-002] Documentation
  - [X] [T-002-A] Replace the row at `README.md:431` with one row covering the four tools: first cell `` `run_command`, `read_file`, `write_file` or `edit_file` with an argument outside its known set, measured on agy 1.5.15 (`run_command`: `CommandLine`, `toolSummary`, `WaitMsBeforeAsync`, `BypassSandbox`, `IsDaemon`; `read_file`: `Path`, `StartLine`, `EndLine`, `toolSummary`; `write_file`: `Path`, `Content`, `toolSummary`; `edit_file`: `Path`, `Target`, `Replacement`, `toolSummary`) ``; second cell `Blocked, naming the argument. If a later agy adds an argument to one of these tools, that tool's calls block until the adapter learns it`. Do not touch the Known-limits line at 536.
  - [X] [T-002-B] Run `npx vitest run tests/scripts/doc-locations.test.js`. Expected: all PASS.
  - [X] [T-002-C] `git add -u README.md docs/superpowers/plans/2026-11-25-bug093-antigravity-guard-accepts-unknown-arguments-on.md`
  - [X] [T-002-D] `git commit -m "docs: list the known arguments of every Antigravity tool the guard maps [BUG-093]"`

### Task 3: closeout

- [X] [T-003] Full suite and scope check
  - [X] [T-003-A] Run `npm test`. Expected: exit 0, no new skips.
  - [X] [T-003-B] `git diff origin/main --stat` lists only: `.gitignore`, this plan, `README.md`, `project-template/.agents/hooks/conductor-guard.mjs`, `tests/hooks/antigravity-guard.test.js` (plus the spec and its leaf, already on the branch). No record, no `pre-tool-use.mjs`, no fixture, no `package.json`.
  - [X] [T-003-C] `git add -u docs/superpowers/plans/2026-11-25-bug093-antigravity-guard-accepts-unknown-arguments-on.md`
  - [X] [T-003-D] `git commit -m "docs: close out the BUG-093 plan [BUG-093]"`

## Test list

- [X] [T-004] `tests/hooks/antigravity-guard.test.js` (Task 1): recorded `read_file` with `toolSummary`, unbounded (Guard 1) and with a line range (allowed); `read_file` with `Paths` blocked naming it; `write_file` with `Append` blocked naming it; `edit_file` with `AllowMultiple` blocked naming it; `edit_file` with `AllowMultiple` and `Paths` blocked naming both, sorted, plural; existing `run_command` `"Cwd"` and `"CommandLine"` cases and recorded calls unchanged and green.

## Commit order

1. Task 0, plan (runner, end of the plan session).
2. Task 1, adapter and its tests together: the new tests are red without the adapter change.
3. Task 2, README row (describes Task 1's behavior).
4. Task 3, closeout.

In the build session the runner makes one commit of the whole tree; the commit steps above are its grouping guide
and are ticked when the runner's commit carries them.

## Identified risks

- **The recording trimmed a file-tool argument the real agy 1.5.15 sends.** The fixture header says the payloads
  were "trimmed to the fields the adapter reads"; `toolSummary` survived on `write_file`/`edit_file` but not on
  `read_file`. If real agy sends another key on a file tool, that tool blocks with the key named after this fix.
  This is the fail-closed direction the spec accepts (choice 5); the fix is adding the name to that tool's list,
  and the README row says so. No live re-measurement is in scope.
- **Reason bytes for `run_command` drift.** Moving the reason into `notCovered` could change spacing or quoting.
  The existing tests only match `/"Cwd"/`; the new `toBe` assertions on the file tools pin the shared wording, and
  the helper is shared, so `run_command` gets the same bytes.
- **A test-order dependency on `big.txt`.** The new recorded case rewrites `big.txt` itself (T-001-A) rather than
  relying on the earlier Guard 1 case.
- **README Known-limits line `[BUG-093]` (`README.md:536`)** stays until the release removes it; it is a record
  line under the role's rules and the spec's Out of Scope.
