# BUG-071 Block an OpenCode `bash` call that carries an argument outside a closed set: implementation plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Update one checkbox per edit (BUG-003 invariant). Execute in file order.

**Goal:** the OpenCode plugin's `bash` mapping checks the call's arguments against the closed set `command`, `description`, `timeout`. A call with any other own key whose value is not `undefined` (a working directory under any name included) is blocked before the guard runs, with a reason that names every such key, sorted. A call with only known arguments maps to the same `Bash { command }` payload as today. The README's OpenCode status table gains one row saying so.

**Spec:** `docs/superpowers/specs/2026-11-20-bug071-opencode-guard-evaluates-bash-commands-without-design.md` (sha256 `9adffc06f4470241be380c7c43224f21757077eb7e25519290f3c737d0915887`). Issue #162.

**Test command:** `npm test`. Filtered runs use `npx vitest run <file>` and `-t '<pattern>'`.

## Global Constraints

- No release records: `VERSION`, the `package.json` / `package-lock.json` version, `CHANGELOG.md`, `AGENT-READABLE BACKLOG.md`, `.claude/memory/**` and the README "Known limits" lines (including the `[BUG-071]` line at `README.md:500`) stay untouched (spec, Out of Scope).
- **Three files change, plus this plan and its `.gitignore` leaf:** `project-template/.opencode/plugin/conductor-guard.js`, `tests/hooks/opencode-guard.test.js`, `README.md`. The hook `.claude/hooks/pre-tool-use.mjs`, its template copy, `tests/fixtures/guard3-reference.sh`, the installer and `tools/skip-baseline.json` are not changed (spec, Out of Scope and System Impact).
- The plugin keeps importing only `node:` builtins, and `package.json` gains no dependency (spec, AC7; today it has no `dependencies` key, which is the empty set). The change only narrows what passes: no new network access, installed permission or written path.
- Every file this plan edits after Task 0 is already tracked and none sits under an ignored directory, except this plan. It is under the ignored `docs/superpowers/plans/`, is new in Task 0 (so `git add -f`), and is tracked afterwards and re-included by its leaf (so `git add -u`).
- The existing 213 rows of `tests/hooks/opencode-guard.test.js` are not edited and must pass as they are (spec, AC5).

## Files read for this plan

The spec defers no full read. Read for this plan:

- `project-template/.opencode/plugin/conductor-guard.js:1-157` (the whole plugin: header `:1-8`, `blocked`/`badArg`/`one` `:25-29`, `patchTool` `:83-86`, `MAPPED` `:89-109`, the `bash` entry `:90-91`, the caller `:147-148`).
- `tests/hooks/opencode-guard.test.js:1-58` (imports, `scaffold`, `call`, hooks), `:118-211` (`STUB`, `stubProject`, `payloads`, `NOT_RUN`, the AC6 argument checks including `bash without command`). The Guard 3 corpus rows at `:70-78` pass `{ command, description: 'probe' }`.
- `README.md:398-414` (the `### OpenCode` section and its `On OpenCode | Status` table, rows `:406-412`).
- The installer tests that name the plugin, by grep (spec, System Impact): `tests/installer/cli.test.js:216` asserts the file exists; `tests/installer/templates.test.js:124` asserts the template's `.opencode` tree lists only `plugin/conductor-guard.js`; `tests/installer/deploy.test.js:657-` writes its own `SHIPPED` stub (`'export const ConductorGuard = 1;\n'`), never the template's bytes. `tests/scripts/orchestrate.test.js:3998-3999` lists the path for a scope escalation. None reads the plugin's contents, so none needs an edit.
- `tools/skip-baseline.json`: no `opencode-guard` row (grep), and the new rows skip on no leg.

## Plan decisions

1. **The helper (`project-template/.opencode/plugin/conductor-guard.js`), placed after `patchTool` and before the `MAPPED` comment:**
   ```js
   // The guard checks a command as if it runs in the project directory, so an argument that
   // could change where or how it runs is not trusted. The set is closed because OpenCode's
   // bash schema is not versioned with this guard (BUG-071). An empty command is the guard's
   // to judge (it allows it), so only the type of command is checked.
   const BASH_ARGS = new Set(['command', 'description', 'timeout']);
   const BASH_ARG_REASON = 'not supported; the guard checks a command as if it runs in the project directory, so drop the argument and put any cd in the command, where the guard sees it';

   function bashTool(a, _d, tool) {
     if (typeof a.command !== 'string') return badArg(tool, 'command', 'a string');
     const unknown = Object.keys(a).filter((k) => a[k] !== undefined && !BASH_ARGS.has(k)).sort();
     if (unknown.length === 0) return one('Bash', { command: a.command });
     const names = unknown.map((k) => `"${k}"`).join(', ');
     const which = unknown.length === 1 ? `argument ${names} is` : `arguments ${names} are`;
     return blocked(tool, `${which} ${BASH_ARG_REASON}`);
   }
   ```
   The `command` check runs first, so `bash without command` keeps its existing reason (spec, Main path step 2). `Object.keys` lists own enumerable string keys, the spec's "own keys". The `undefined` filter is AC4. The single-key reason is the spec's text byte for byte: `code-conductor guard blocked "bash": argument "workdir" is not supported; the guard checks a command as if it runs in the project directory, so drop the argument and put any cd in the command, where the guard sees it`. The two-key form is `arguments "cwd", "workdir" are not supported; …` (spec, Alternative paths). The function is 7 lines.
2. **`MAPPED.bash` becomes `bash: bashTool,`.** The old inline comment (`An empty command is the guard's to judge…`) moves into the helper's comment (decision 1), so it is not lost. The other entries are unchanged (spec, Out of Scope).
3. **Header sentence.** After `:7` (`…so an unknown tool is never trusted.`) add one line: `// An unknown argument of a mapped tool is not trusted either: bash blocks any argument outside the few it knows.` (spec, System Impact). `:8` (`Zero dependencies by design; node: builtins only.`) stays the last header line.
4. **Tests: a new `describe('OpenCode plugin: bash arguments outside the known set (BUG-071)')` in `tests/hooks/opencode-guard.test.js`,** placed after the `OpenCode plugin: argument checks (AC6)` block (ends `:193`) and before `OpenCode plugin: multiedit (AC2)`. Every row uses `stubProject()`, `call()`, `payloads()` and `NOT_RUN`, which already exist; no import changes. A local `const REASON_TAIL = 'not supported; the guard checks a command as if it runs in the project directory, so drop the argument and put any cd in the command, where the guard sees it';` holds the spec's fixed tail.
   - **B1 `it.each(['workdir', 'cwd', 'directory'])('blocks bash with a %s argument before the guard runs (AC1)')`.** `call(dir, 'bash', { command: 'git status', [k]: '/tmp' })`. Expect the reason `toBe` `` `code-conductor guard blocked "bash": argument "${k}" is ${REASON_TAIL}` `` (so it contains `"bash"` and the name), `not.toMatch(NOT_RUN)`, and `payloads(dir)` `toEqual([])`. Three rows.
   - **B2 `it('blocks bash with any other argument outside command, description and timeout (AC2)')`.** `{ command: 'ls', env: { X: '1' } }`. Expect the reason `toBe` `` `code-conductor guard blocked "bash": argument "env" is ${REASON_TAIL}` `` and no payload.
   - **B3 `it('names every unknown argument, sorted, in one reason (AC2)')`.** `{ command: 'ls', workdir: '/tmp', cwd: '/x' }` (keys given out of order on purpose). Expect the reason `toBe` `` `code-conductor guard blocked "bash": arguments "cwd", "workdir" are ${REASON_TAIL}` `` and no payload.
   - **B4 `it('sends a call with command, description and timeout to the guard as Bash { command } (AC3)')`.** `{ command: 'git status', description: 'd', timeout: 1000 }`. Expect `''` (the stub allows a payload with no `file_path`); `payloads(dir)` has length 1, `tool_name` `'Bash'`, and `tool_input` `toEqual({ command: 'git status' })`.
   - **B5 `it('treats an unknown argument whose value is undefined as absent (AC4)')`.** `{ command: 'git status', workdir: undefined }`. Expect `''` and exactly one payload with `tool_input` `toEqual({ command: 'git status' })`.
5. **README row (`README.md`, the `On OpenCode | Status` table).** Insert directly after the `` `patch`/`apply_patch`, `multiedit` `` row (`:409`), so the mapped-tool rows stay together:
   ```
   | `bash` with an argument other than `command`, `description` or `timeout`, a working directory included | Blocked: the guard checks a command as if it runs in the project directory, so put any `cd` in the command itself |
   ```
   This is AC6's statement. The section's prose at `:400` and the Known limits line at `:500` are not edited.
6. **Red predictions, reasoned against the current code.** Today `MAPPED.bash` ignores every key but `command`, so B1 (3 rows), B2 and B3 reach the stub, which allows: the reason is `''` and a payload is recorded: **red**. B4 and B5 map to `Bash { command }` today: **green** before and after. No existing row changes outcome: the corpus rows pass only `command` and `description`, `bash without command` fails the `command` check first, and the `same decision as the hook` and `guard cannot run` rows pass only `command`.
7. **Skip baseline.** No change: B1-B5 have no `skipIf` and run on every leg (`ci-node20`, `ci-node24`, `ci-windows-node24`); each leg's skip set is unchanged.
8. **`.gitignore` leaf.** `!/docs/superpowers/plans/2026-11-20-bug071-opencode-guard-evaluates-bash-commands-without.md` goes directly after the `2026-11-19-bug087` plan leaf and before the `2026-11-20-bug078` plan leaf, the full-path sort order of the block (BUG-042).

## Baseline (measured on this branch, HEAD 1e966a3, Node v24.22.2, uid 1001)

- `npx vitest run tests/hooks/opencode-guard.test.js`: **213 passed (213)**.
- `npx vitest run tests/hooks/opencode-guard.test.js -t 'bash arguments outside the known set'`: **213 skipped (213)** (the filter matches no existing row).

---

### Task 0: Commit this plan

**Files:**
- Create: `docs/superpowers/plans/2026-11-20-bug071-opencode-guard-evaluates-bash-commands-without.md`
- Modify: `.gitignore`

- [X] [T-001] Create this plan file from the approved spec `9adffc06…`. No dependency.
- [X] [T-002] `.gitignore`: insert the leaf of plan decision 8 after the `2026-11-19-bug087` plan leaf. Depends on T-001.
- [X] [T-003] Stage: `git add -u .gitignore` (tracked) and `git add -f docs/superpowers/plans/2026-11-20-bug071-opencode-guard-evaluates-bash-commands-without.md` (new, under the ignored `docs/superpowers/plans/`). Depends on T-002.
- [X] [T-004] Commit: `docs: plan blocking OpenCode bash calls with arguments the guard cannot check [BUG-071]`. Depends on T-003.

---

### Task 1: Tests first (red)

**Files:**
- Modify: `tests/hooks/opencode-guard.test.js`

- [X] [T-101] `tests/hooks/opencode-guard.test.js`: insert the `bash arguments outside the known set (BUG-071)` block with `REASON_TAIL` and rows B1-B5 after the `argument checks (AC6)` block and before `multiedit (AC2)` (plan decision 4). Depends on T-004.
- [X] [T-102] Red run: `npx vitest run tests/hooks/opencode-guard.test.js -t 'bash arguments outside the known set'`. Its full match set is exactly the 7 new rows (B1's three, B2, B3, B4, B5), since the describe name is new; the other 213 rows are skipped by the filter. Predicted: **5 failed | 2 passed | 213 skipped (220)**. Red: B1 `workdir`, B1 `cwd`, B1 `directory`, B2, B3. Green: B4, B5 (plan decision 6). Any other split means a test is wrong: fix the test, not the prediction. Depends on T-101.

---

### Task 2: Block unknown bash arguments (green) and document it

**Files:**
- Modify: `project-template/.opencode/plugin/conductor-guard.js`
- Modify: `README.md`

- [X] [T-201] `project-template/.opencode/plugin/conductor-guard.js`: add `BASH_ARGS`, `BASH_ARG_REASON` and `bashTool` after `patchTool` (plan decision 1). Depends on T-102.
- [X] [T-202] `project-template/.opencode/plugin/conductor-guard.js`, `MAPPED`: replace the `bash` entry and its comment with `bash: bashTool,` (plan decision 2). Depends on T-201.
- [X] [T-203] `project-template/.opencode/plugin/conductor-guard.js`: add the header sentence after `:7` (plan decision 3). Depends on T-202.
- [X] [T-204] Green run: the T-102 command. Predicted: **7 passed | 213 skipped (220)**. Depends on T-203.
- [X] [T-205] Run: `npx vitest run tests/hooks/opencode-guard.test.js`. Predicted: **220 passed (220)** (213 baseline + 7 new; spec, AC5). Depends on T-204.
- [X] [T-206] AC7 check: `grep -n "^import" project-template/.opencode/plugin/conductor-guard.js` lists only `node:child_process` and `node:path`, and `git diff --quiet package.json package-lock.json` exits 0 (today `package.json` has no `dependencies` key at all, so there is none to add to). Depends on T-205.
- [X] [T-207] `README.md`: insert the row of plan decision 5 after the `` `patch`/`apply_patch`, `multiedit` `` row of the `On OpenCode | Status` table. Depends on T-206.

---

### Task 3: Full suite, scope check and commit

**Files:**
- Modify: `docs/superpowers/plans/2026-11-20-bug071-opencode-guard-evaluates-bash-commands-without.md` (ticks)

- [X] [T-301] Run `npm test`. Predicted: exit 0. A red is called ENV only if the sandbox caused it (network, tmp permissions) and its file is not one this plan touches; report it with its name. Any other red is fixed. Depends on T-207.
- [X] [T-302] Scope check: `git status --short` lists exactly `README.md`, `project-template/.opencode/plugin/conductor-guard.js`, `tests/hooks/opencode-guard.test.js` and this plan. No temporary file is left in the tree. `git diff --stat .claude/hooks project-template/.claude/hooks tests/fixtures tools/skip-baseline.json` is empty, and the `git diff README.md` hunk touches only the OpenCode table. Depends on T-301.
- [X] [T-303] Stage: `git add -u README.md project-template/.opencode/plugin/conductor-guard.js tests/hooks/opencode-guard.test.js` (all tracked; `project-template/.opencode/` is not ignored). Depends on T-302.
- [X] [T-304] Stage: `git add -u docs/superpowers/plans/2026-11-20-bug071-opencode-guard-evaluates-bash-commands-without.md` (carries the ticks for T-101 to T-303). Depends on T-303.
- [X] [T-305] Commit: `fix: block OpenCode bash calls with arguments the guard cannot check [BUG-071]`. Depends on T-304.

---

## Test List

- [X] Unit, AC1: B1 (`workdir`, `cwd`, `directory`). Blocked before the guard runs: no payload recorded, exact reason naming `"bash"` and the key, not a `could not run` reason.
- [X] Unit, AC2: B2 (an unrelated unknown key) and B3 (two unknown keys, named sorted in one reason).
- [X] Unit, AC3: B4. `command`, `description`, `timeout` reach the guard as exactly `tool_input` `{ command }`, one payload, allowed.
- [X] Unit, AC4: B5. An `undefined`-valued unknown key does not block.
- [X] Unit, AC5: the 213 existing rows of `tests/hooks/opencode-guard.test.js`, unchanged, including the Guard 3 corpus through `bash` and `bash without command` (T-205).
- [X] AC6: the README row (T-207), checked by reading the diff in T-302; no test reads the README table.
- [X] AC7: T-206.
- [X] No integration or E2E/UI test: the rows drive the plugin the way OpenCode does (`tool.execute.before`), and there is no UI.

## Commit Order

1. Task 0 (T-004): this plan and its `.gitignore` leaf.
2. Task 3 (T-305): the tests, the plugin change, the README row and the plan ticks for T-101 to T-303, in one commit, so no commit has a red suite. The red run in T-102 happens in the working tree before the fix. The ticks for T-304, T-305 and the Test List ride the closeout commit.

## Identified Risks

- **Breaking calls OpenCode makes today.** If OpenCode's `bash` sends a key beyond `command`, `description`, `timeout` on every call, every `bash` call is blocked. That is the fail-closed cost the spec accepts (The choice, point 3); the reason names the key, so a report shows exactly what to add. Not measurable without a live OpenCode.
- **Reason text drift.** B1-B3 compare the whole reason against the spec's text through `REASON_TAIL`; a reworded constant in the plugin fails them.
- **The `command` check order.** The helper checks `command` before the unknown keys, so a call missing `command` keeps the existing `argument "command" is missing or not a string` reason whatever else it carries (spec, Main path step 2). The `bash without command` row guards it (T-205).
- **Sort order.** `Array.prototype.sort` with no comparator sorts by UTF-16 code units, which is what B3 asserts for lowercase ASCII keys; no locale is involved.
- **Installed copies.** Projects get the new plugin on their next `--project --opencode`; the installer and its overwrite rules (BUG-069, BUG-087) are untouched and their tests do not read the plugin's bytes (Files read for this plan).
