# FEAT-047: Spec and Plan Location Discovery, Defaults and Backlog Grouping, Implementation Plan

> **For agentic workers:** each task below is one code dispatch. Touch only the files its **Files:** block names. Write the tests first, watch them fail for the stated reason, then implement until `npm test` is green. Do not stage or commit; the orchestrator commits after the run.

**Spec:** `docs/superpowers/specs/2026-11-07-feat047-spec-plan-locations-design.md` (approved; its Rulings 1-7 are binding).
**Baseline:** `5fc234a` on `feat/feat-047-spec-plan-locations`.
**Goal:** `/cc-orchestrate` resolves the spec and plan folders per run (recorded in `CLAUDE.md`, else discovered, else `docs/specs` + `docs/plans`), pins them in the run file, derives the spec and plan envelope scopes from them, and groups a run's documents under `<kind>-<n|slug>/` when the backlog places the item unambiguously in one phase, epic or pillar.
**Architecture:** one new zero-dependency resolver, `scripts/doc-locations.mjs` (library plus CLI). `orchestrate.mjs start` calls it once and stores `run.docs`. `envelopeFields` reads `run.docs.scopes`. The prose surfaces (role profiles, `/cc-orchestrate`, `/cc-resume`, `/cc-stack`, the review-loop settings) stop naming a literal path.
**Tech:** Node >= 20, `node:` builtins only, vitest. The run's test command is `npm test`.

## Ground rules for every task

- **TDD.** Write or update the task's tests first. Run `npm test` and confirm the new cases fail for the reason named under "Failure point". Then implement. Finish with `npm test` green; the task's report states the exit status and summary line.
- **Mirrors.** Every `.claude/` mirror of a `project-template/.claude/` file changes in the same task as its source, and stays byte-identical.
- **No skipped tests.** No `it.skip`, `it.skipIf` or `describe.skipIf` in new cases. The CI skip baseline (`tools/skip-baseline.mjs`) pins the skipped set, so a new skip drifts it.
- **Windows and POSIX.** Use `realpathSync(mkdtempSync(...))` roots, normalize `\r\n` before matching text, and compare paths as `/`-joined strings.
- **Zero dependencies.** `package.json` is not touched by any task.
- **Not in this plan:** the root `CLAUDE.md` `- Specs:` / `- Plans:` lines. The spec does not call for them. It says this repository resolves `docs/superpowers/*` by discovery, and `/cc-stack` records the same pair when the owner next runs it. AC3 holds either way.
- **This plan's own location.** This plan, like the spec, sits flat under `docs/superpowers/plans/`, because the router that wrote it predates grouping. No document of this PR creates a grouped subfolder, so AC15 needs no ancestor re-include lines. Only the two leaf lines in Task 1 are needed.

---

### Task 1: Tracked-surface leaf lines for this PR's spec and plan

**Files:**
- Modify: `.gitignore`
- Test: `tests/unit/gitignore-block-parity.test.js`

**Precondition (orchestrator, before dispatch).** The parity test compares the block with `git ls-files`. A leaf line for a file that is not yet in the index fails it. Code agents have no git, so before dispatching this task the orchestrator stages both documents with `git add -f docs/superpowers/specs/2026-11-07-feat047-spec-plan-locations-design.md docs/superpowers/plans/2026-11-07-feat047-spec-plan-locations.md`. That is staging, not a commit, per the Staging Convention for a new file at a tracked surface before its leaf lands. If they are not staged, this task cannot end green; the agent reports that and stops.

- [x] **Step 1: Confirm the red state.** The test file is not edited. Run `npm test`. With both documents staged and no leaf lines, `tests/unit/gitignore-block-parity.test.js` fails "equals the block computed from git ls-files" and "names every tracked file". That is the failure point.
- [x] **Step 2: Add the two leaf lines in sorted position**, inside the BUG-042 block:
  - `!/docs/superpowers/plans/2026-11-07-feat047-spec-plan-locations.md` goes immediately after `!/docs/superpowers/plans/2026-10-27-issue109-verbosity-alias.md`.
  - `!/docs/superpowers/specs/2026-11-07-feat047-spec-plan-locations-design.md` goes immediately after `!/docs/superpowers/specs/2026-10-27-issue109-verbosity-alias-design.md`, the last line before `# --- END tracked-surface block (BUG-042) ---`.
  - Add no directory lines. Both files sit in already re-included directories.
- [x] **Step 3: Verify.** Run `npm test`. All four parity cases pass, and so does the rest of the suite.

**Failure point:** parity test red because the documents are not in the index (missing precondition), or a leaf out of sorted order (order is compared, not sorted).
**Verification:** `npm test` exits 0; the parity test passes.

---

### Task 2: `scripts/doc-locations.mjs`, the resolver, grouping and CLI

**Files:**
- Create: `scripts/doc-locations.mjs`
- Test: `tests/scripts/doc-locations.test.js`

`scripts/` and `tests/` are outside the tracked-surface block, so neither new file needs a `.gitignore` line. `deployProject` copies all of `scripts/` to `.claude/scripts/`, so the CLI ships with no installer change.

**Step 1: write `tests/scripts/doc-locations.test.js` first.** Each fixture is a fresh `realpathSync(mkdtempSync(join(tmpdir(), 'cc-docloc-')))` root, removed in `afterEach`. Small helpers: `md(rel)` writes an empty `.md` file, creating parents; `claudeMd(text)`; `backlog(name, text)`; and `cli(root)`, which spawns `process.execPath` on the script with `root` as argv and returns `{ status, stdout, stderr }`.

- [x] **Discovery (AC1, POC S2-S6):**
  - only `.claude/specs/a.md` → `.claude/*`;
  - only `docs/specs/` (empty dir) → `docs/specs` + `docs/plans`, a half pair is present;
  - `docs/plans/x.md` alone → `docs/specs` + `docs/plans`;
  - `.claude/specs` with 1 md vs `docs/superpowers/plans/a/b.md` + `docs/superpowers/specs/c.md` (2, nested, so recursive) → `docs/superpowers/*`;
  - tie: 1 md each in `.claude/plans` and `docs/specs` → `.claude/*`;
  - tie: 0 md in each of `docs/specs` and `docs/superpowers/specs` → `docs/*`;
  - a non-`.md` file is not counted.
- [x] **Default (AC2, S1):** an empty root → `{ specs: 'docs/specs', plans: 'docs/plans', group: null, source: 'default' }`. The test asserts that `docs/` was **not** created.
- [x] **Recorded:**
  - `CLAUDE.md` with `## Development Commands\n- Specs: documentation/rfcs\n- Plans: documentation/plans\n` → `source: 'claude-md'`;
  - the same with CRLF line endings;
  - a trailing `/` on a value is stripped;
  - recorded wins over a busier discovered pair (S7);
  - recorded wins when its folder does not exist (S8).
- [x] **Recorded errors:** each case throws `DocLocationError`, with `code === 'ORCH_DOC_LOCATION_INVALID'` and a reason naming the line:
  - only `- Specs:` present; only `- Plans:` present;
  - `- Specs: <command>`;
  - `- Specs: ../up`;
  - `- Plans: /abs`;
  - `- Plans: C:/x`;
  - `- Specs: a\b`;
  - `- Specs: docs/*`;
  - `- Specs: .claude/memory/x`;
  - `- Specs: .conductor`;
  - `- Plans: .git/x`;
  - equal values;
  - `- Specs: docs/a` with `- Plans: docs/a/plans` (nested, Ruling 6), and the reverse.
- [x] **`checkDocDir` boundary (AC9):**
  - `'a'.repeat(249)` passes; `'a'.repeat(250)` fails;
  - `DIR_MAX === V3_CAPS['ops.scope'][1] - 51` (imported from `scripts/snap-contract.mjs`);
  - each of the four fixed pairs (`CANDIDATE_PAIRS` plus `DEFAULT_PAIR`) passes, and each pair is disjoint;
  - `.claude`, `.`, `.claude/hooks`, `.claude/agents`, `.claude/commands`, `.claude/scripts`, `.github`, `scripts` and `.github/specs` each return a non-empty reason, as do `./.claude/hooks/`, `.claude/./hooks`, `.claude//hooks`, `.Claude/Hooks`, `SCRIPTS` and `.claude\hooks`; `.claude/specs`, `.claude/plans`, `docs/scripts` and `.claude/hooksx` pass (spec Ruling 8).
- [x] **Grouping (AC7, AC8, POC G1-G6):**
  - G6, fixture: a temp root holding a minimal `AGENT-READABLE BACKLOG.md` (`## PILLAR 3: MULTI-AGENT SOFTWARE FACTORY`, then `### [ ] \`[FEAT-047]\` Spec and Plan Location Discovery`) → `backlogGroup(fixtureRoot, 'FEAT-047') === 'pillar-3'`. No case reads this repository's backlog;
  - `## PILLAR 3: FACTORY` then `### [ ] \`[FEAT-900]\` x` → `pillar-3`;
  - `## Epic: User Auth` → `epic-user-auth` (G2);
  - `# Phase 2` → `phase-2`;
  - a slug over 40 characters is cut to 40, then trailing `-` trimmed;
  - `## Epic: !!!` (empty slug) → `null`;
  - no group heading → `null` (G3);
  - the item in two backlog files → `null` (G4);
  - no backlog file → `null` (G5);
  - the item twice in one file → `null`;
  - `## Pillar 2` then `## Bugs` then the item → `null` (closing heading);
  - `## Pillar 2` then `### Notes` then the item → `pillar-2`, because a deeper heading does not close;
  - a numbered heading whose name would exceed 47 characters (`## Pillar 1` followed by 45 digits) → `null`;
  - the id is matched whole: a heading for `FEAT-0470` or `FEAT-047-B` does not count for `FEAT-047`;
  - a regex metacharacter in the id is escaped;
  - a file named `notes.md` is not scanned, but `my-Backlog.md` is.
- [x] **AC3, this repository's layout, as a fixture:** a temp root shaped like this repository: a `CLAUDE.md` with no `- Specs:` / `- Plans:` lines, `docs/superpowers/specs/a-design.md`, `docs/superpowers/plans/a.md`, and the G6 minimal `AGENT-READABLE BACKLOG.md`. `resolveDocLocations(fixtureRoot, 'FEAT-047')` equals `{ specs: 'docs/superpowers/specs', plans: 'docs/superpowers/plans', group: 'pillar-3', source: 'discovered' }`. No case reads `REPO_ROOT`'s backlog or tree, so the suite never depends on this repository's backlog wording. The "no file moved" half of AC3 is checked by the orchestrator after the build band (Task 5, Step 4).
- [x] **CLI contract table (AC14):**
  - both lines valid → 0, stdout `{"specs":..,"plans":..,"source":"claude-md"}`, stderr empty;
  - neither line, with `docs/plans/` present → 0, `source: "discovered"`;
  - an empty root → 0, `source: "default"`;
  - in every exit-0 case stdout has no `group` key;
  - half-recorded → 1, stdout empty, stderr one line starting `ORCH_DOC_LOCATION_INVALID: `;
  - invalid value → same shape;
  - overlap → same shape;
  - root is a regular file, not a directory → 1, stdout empty, stderr one non-empty line not starting `ORCH_`.
- [x] **Import safety (AC11), copying `tests/scripts/ticket.test.js:57-71`:** importing the module adds no `uncaughtException`, `unhandledRejection` or `exit` listener, writes nothing to stdout, and leaves `process.exitCode` null.
- [x] **Imports (AC11):** the source's `import ... from '<x>'` specifiers are each `node:*` or exactly `./snap-contract.mjs`.
- [x] **No write (AC10):** the source contains none of `writeFileSync`, `appendFileSync`, `mkdirSync`, `rmSync`, `renameSync`, `createWriteStream`.

Run `npm test`. **Failure point:** every case fails with a module-not-found error for `scripts/doc-locations.mjs`.

**Step 2: implement `scripts/doc-locations.mjs`.** Keep functions under 30 lines, use guard clauses, and comment only on why.

- [x] **Header and imports.** A header comment as in `ticket.mjs`. The imports are `node:fs` (`readFileSync`, `readdirSync`, `statSync`, `realpathSync`), `node:path` (`join`, `resolve`), `node:url` (`pathToFileURL`), and `V3_CAPS` from `./snap-contract.mjs`. Put a comment on why the cap is imported and not hardcoded: the spec derives it, and `snap-contract.mjs` is itself zero-dependency.
- [x] **Exports:**
  - `CANDIDATE_PAIRS`: the three pairs in spec order;
  - `DEFAULT_PAIR = { specs: 'docs/specs', plans: 'docs/plans' }`;
  - `GROUP_MAX = 47`;
  - `DIR_MAX = V3_CAPS['ops.scope'][1] - (GROUP_MAX + '/'.length + '/**'.length)`;
  - `class DocLocationError extends Error`, with `code = 'ORCH_DOC_LOCATION_INVALID'` and `reason`, whose message is `${code}: ${reason}`.
- [x] **`checkDocDir(rel)`** returns `''` when the value is valid, otherwise a reason string. It is applied to the value with trailing `/` stripped. It rejects:
  - an empty value or `<command>`;
  - `isAbsolute`, `^[A-Za-z]:` or a leading `/`;
  - a `..` segment, `\`, or any of `*?[]{}`;
  - the value `.`, or any empty or `.` segment;
  - a value equal to, under, or a parent of `.claude/memory`, `.claude/hooks`, `.claude/agents`, `.claude/commands`, `.claude/scripts`, `.conductor`, `.git`, `.github` or `scripts`, compared segment-wise and case-folded (spec Ruling 8);
  - a value longer than `DIR_MAX`.
- [x] **`readRecordedPair(root)`:**
  - Read `CLAUDE.md`. Unreadable means absent, so return `null`.
  - Normalize `\r\n`, then match `/^- Specs: (\S+)$/m` and `/^- Plans: (\S+)$/m`.
  - Neither line → `null`.
  - Exactly one → throw "CLAUDE.md records `- Specs:` but not `- Plans:` (or the reverse); add the missing line, or remove both".
  - Then `checkDocDir` each value. On failure, throw "`- Specs: <value>` <reason>; fix that line".
  - Then reject overlap (`a === b || a.startsWith(b + '/') || b.startsWith(a + '/')`): "`- Specs:` and `- Plans:` overlap; use two disjoint folders".
- [x] **`discoverPair(root)`:**
  - A pair is present when `isDir(join(root, half))` holds for either half. `isDir` wraps `statSync` in try/catch.
  - Count `.md` files across both halves with a hand-written walk: `readdirSync(dir, { withFileTypes: true })`; recurse on `dirent.isDirectory()`, which is false for a symlink, so symlinks are not followed; count `isFile() && name.endsWith('.md')`; an unreadable directory counts 0.
  - The highest count wins, with a strict `>` so the earliest pair wins a tie.
  - Return `{ specs, plans }`, or `null` when no pair is present.
  - Comment on why there is no `readdirSync({ recursive: true })`: `engines` is `>=20` and the option arrived in 20.1.
- [x] **`backlogGroup(root, item)`:**
  - Scan root entries whose name matches `/backlog/i` and ends in `.md`, sorted. An unreadable file or root counts as absent.
  - Per file, track `open = { level, name } | null`. For each `^(#{1,6})\s` line:
    1. If it matches the group regex `^(#{1,5})\s+(phase|epic|pillar)\b[\s:#-]*(\d+)?[\s:.-]*(.*)$` (flag `i`), set `open` to that level and the `groupName` result, which may be `null`, and continue.
    2. Otherwise, if `open` exists and this heading's level is at most `open.level`, set `open = null`. Closing happens before the item check, so an item heading at the group's own level is flat.
    3. If the line matches the item, record `open?.name ?? null` as a hit.
  - The item regex is `(?<![A-Za-z0-9_-])<escaped id>(?![A-Za-z0-9_-])`.
  - Return the single hit's name when there is exactly one hit across all files, else `null` (Ruling 5).
  - `groupName(kind, n, rest)`:
    - `<kind lowercased>-<n>` when `n` is present;
    - else the slug: `rest.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)`, then trailing `-` trimmed again;
    - an empty slug → `null`;
    - a result longer than `GROUP_MAX` → `null`.
- [x] **`resolveDocLocations(root, item)`:** recorded, then discovered, then `DEFAULT_PAIR`, with `source` set to `claude-md`, `discovered` or `default`. `group` is `item ? backlogGroup(root, item) : null`. Returns `{ specs, plans, group, source }`.
- [x] **CLI:** `cli(argv)`:
  - Resolve `root = resolve(argv[0] ?? process.cwd())`. Throw when root is not a directory; that is the "any other exception" row.
  - Print `JSON.stringify({ specs, plans, source })` and return 0.
  - On a `DocLocationError`, write `e.message` plus a newline to stderr and return 1.
  - On any other error, write `doc-locations: ${e.message}` to stderr and return 1.
  - Guard the CLI with the `invokedDirectly()` pattern from `scripts/ticket.mjs:277-280`, setting `process.exitCode`, never `process.exit`.

**Step 3: verify.** Run `npm test`.

**Failure point:** discovery off by one on ties (`>=` instead of `>`); a CRLF `CLAUDE.md` defeating the `$` anchor; the CLI printing a `group` key; or a backlog heading for `FEAT-047-B` being counted for `FEAT-047`. The whole-id boundary prevents the last.
**Verification:** `npm test` exits 0, and every case listed above passes.

---

### Task 3: `orchestrate.mjs`: pin `run.docs` at `start`, derive spec and plan scopes from it

**Files:**
- Modify: `scripts/orchestrate.mjs`
- Test: `tests/scripts/orchestrate.test.js`
- Test: `tests/hooks/guard5.test.js`

**Step 1: tests first.**

- [x] **Edits to `tests/scripts/orchestrate.test.js` (AC13; update, never delete):**
  - `:19`: `PLAN = 'docs/plans/demo.md'`;
  - `:54`: `plan()` creates `dirname(join(root, PLAN))`;
  - `:103-111`: the `ROLE_ARTIFACTS` pin now has `spec: { tk: 'RW', scope: null }, plan: { tk: 'RW', scope: null }`;
  - the exact-stdout assertions at `:238`, `:442`, `:447` and `:554` gain `docs: specs <s>, plans <p> (<source>); ` before `test command:`. A bare temp root reads `docs: specs docs/specs, plans docs/plans (default)`. Where `driveTo`/`plan()` created `docs/plans` before `start`, it reads `(discovered)`. Read each fixture to pick the right one;
  - any `toEqual` on the whole run file gains its `docs` key.
- [x] **New `describe('doc locations [FEAT-047]')` in the same file:**
  - **AC4:** `ROLE_ARTIFACTS.spec.scope` and `.plan.scope` are `null`, and `readFileSync(SCRIPT)` does not contain `docs/superpowers`.
  - **`run.docs` at `start`:**
    - in a root with `.claude/specs/a.md`, `start` writes `run.docs` equal to `{ specs: '.claude/specs', plans: '.claude/plans', group: null, source: 'discovered', scopes: { spec: ['.claude/specs/**'], plan: ['.claude/plans/**'] } }`;
    - `install spec --check` prints an envelope whose `ops.scope` is `[".claude/specs/**"]`;
    - after driving spec through approval, `install plan --check` gives `[".claude/plans/**"]`.
  - **Group, one pinned fixture root:** the root holds `.claude/specs/a.md` and `.claude/plans/b.md` (so discovery resolves `.claude/*`), and `BACKLOG.md` with `## Pillar 3: X` and `### [ ] \`[FEAT-011]\` y`. Use the default `plan()` helper only after `start`, or point `PLAN` at `.claude/plans/demo.md` for this case, so no other candidate pair exists at `start`:
    - `run.docs` equals `{ specs: '.claude/specs', plans: '.claude/plans', group: 'pillar-3', source: 'discovered', scopes: { spec: ['.claude/specs/pillar-3/**'], plan: ['.claude/plans/pillar-3/**'] } }`;
    - the spec envelope's `ops.scope` is exactly `[".claude/specs/pillar-3/**"]`;
    - after spec approval, the plan envelope's `ops.scope` is exactly `[".claude/plans/pillar-3/**"]`;
    - stdout ends exactly `docs: specs .claude/specs, plans .claude/plans (discovered); group pillar-3; test command: npm test`.
  - **AC10, source checks:**
    - the text of `scripts/orchestrate.mjs` has no line matching `/(writeFileSync|writeAtomic|appendFileSync|renameSync|rmSync)\([^)]*CLAUDE\.md/`, and no line containing both `CLAUDE.md` and any of those call names;
    - `WRITE_SURFACE` still equals `[RUN_FILE, ENVELOPE_FILE, '.claude/memory/session-snapshot.json', '.conductor/**']`, i.e. `['.claude/memory/orchestrator-run.json', '.claude/memory/band-envelope.json', '.claude/memory/session-snapshot.json', '.conductor/**']`. The existing Guard 6 pinned-copy test stays green unchanged.
  - **AC6, pinned per run:** after `start`, write a `CLAUDE.md` recording `- Specs: other/specs` / `- Plans: other/plans`. `install spec --check` still prints the scope from `start`, and the run file's `docs` is unchanged.
  - **AC6, recorded wins at `start`:** with `CLAUDE.md` recording `rec/specs` + `rec/plans` and a busier `docs/superpowers/specs/` present, `run.docs.source === 'claude-md'`.
  - **AC9 error table:** each row halts `start` with status 1 and stderr starting with its code, and `existsSync(join(root, RUN_FILE))` is false:
    - half-recorded → `ORCH_DOC_LOCATION_INVALID`;
    - invalid value `../x` → `ORCH_DOC_LOCATION_INVALID`;
    - overlap `docs/a` / `docs/a/b` → `ORCH_DOC_LOCATION_INVALID`;
    - recorded enforcement folder `- Specs: .claude/hooks` → `ORCH_DOC_LOCATION_INVALID`, stderr naming the line and the reserved folder (spec Ruling 8).

    Also: a stale run from another session is left in place, not cleared, when `start` halts on one of these. Assert its `item` is unchanged.
  - **AC9 over-cap:** the exported `docScopes({ specs: 'a'.repeat(300), plans: 'p', group: null })` throws a `Halt` with `code === 'ORCH_SCOPE_OVER_CAP'`. For every pair in `[...CANDIDATE_PAIRS, DEFAULT_PAIR]` (imported from `scripts/doc-locations.mjs`) with `group: 'x'.repeat(47)`, `docScopes` does not throw.
  - **AC9, install never raises the cap:** after `start`, rewrite the run file's `docs.scopes.spec` to `['x'.repeat(301)]`. `install spec --check`'s stderr does not contain `ORCH_SCOPE_OVER_CAP`. It fails in snap validation instead, which shows the router does not re-check.
  - **Upgrade:** write a valid run file without `docs`, for example by deleting the key after `start`. `install spec` exits 1 with stderr starting `ORCH_DOC_LOCATION_UNRESOLVED:` and naming `end` then `start`. `end` still clears it (`isValidRun` unchanged).
  - **Code unchanged:** a code envelope's scope is still the task files plus `run.plan`, already covered by existing cases, which stay green.
- [x] **New case in `tests/hooks/guard5.test.js` (AC5):**
  - write `envelope({ sys: { role: 'spec', ph: 'spec', tk: 'RW' }, ops: { scope: ['.claude/specs/**'], gate: 'boundary_routed' } })`;
  - a `spec` agent writing `<root>/.claude/specs/x.md` is allowed (`null`);
  - writing `<root>/docs/superpowers/specs/x.md` returns `violation('docs/superpowers/specs/x.md', '.claude/specs/**')`;
  - follow the file's existing `payload`/`fire` helpers and its `agent` option.

Run `npm test`. **Failure point:** the `ROLE_ARTIFACTS` pin, the stdout strings and every `run.docs` case fail, because `start` writes no `docs` and the scopes are still the literal `docs/superpowers` globs. The Guard 5 case should pass already, since Guard 5 is unchanged. It is a regression pin, not a red-first case.

**Step 2: implement in `scripts/orchestrate.mjs`.**

- [x] **`:31-34`:** `spec: { tk: 'RW', scope: null }, plan: { tk: 'RW', scope: null }`. Comment on why: spec and plan scopes come from `run.docs`, pinned at `start` (FEAT-047).
- [x] **Import** `{ DocLocationError, resolveDocLocations } from './doc-locations.mjs'`.
- [x] **New exported `docScopes({ specs, plans, group })`:** builds `[\`${dir}${group ? \`/${group}\` : ''}/**\`]` for each role. If an element's length is over `V3_CAPS['ops.scope'][1]`, it throws `new Halt('ORCH_SCOPE_OVER_CAP', \`${role} scope is ${n} characters; the cap is ${cap}; shorten the folder\`)`. It returns `{ spec: [...], plan: [...] }`.
- [x] **New `resolveDocs(root, item)`:** calls `resolveDocLocations` and returns `{ ...docs, scopes: docScopes(docs) }`. It maps a `DocLocationError` to `new Halt(e.code, e.reason)` and rethrows anything else, the `ticketIntake` pattern.
- [x] **`start` (`:395-407`):**
  - Call `const docs = resolveDocs(root, item);` right after `checkTestCommand(resolveTestCommand(root))`, which is before ticket intake, before `clearRunFiles` and before any write.
  - Add `docs` to the saved record after `test_command`.
  - Return `${begun}; ${ticketNote ?? ''}${docsNote(docs)}test command: ${testCommand}`, where `docsNote = (d) => \`docs: specs ${d.specs}, plans ${d.plans} (${d.source})${d.group ? \`; group ${d.group}\` : ''}; \``.
- [x] **`envelopeFields` (`:246-256`):** add a branch for `step.role === 'spec' || step.role === 'plan'`.
  - If `!isPlainObject(run.docs?.scopes) || !Array.isArray(run.docs.scopes[step.role])`, throw `new Halt('ORCH_DOC_LOCATION_UNRESOLVED', \`run ${run.item} records no docs location (started before FEAT-047); run end, then start\`)`.
  - Otherwise `fields.scope = run.docs.scopes[step.role]`.
  - Keep the code branch and the Ruling 2 ticket rider unchanged.
- [x] **Leave alone:** `isValidRun`, `WRITE_SURFACE` and `taskScope`.

**Step 3: verify.** Run `npm test`.

**Failure point:**
- `resolveDocs` placed after `clearRunFiles` (the stale-run case catches it);
- stdout field order (`test command:` must stay last);
- a fixture-dependent `(default)` vs `(discovered)` in the updated strings;
- `tests/hooks/guard7.test.js:144`, which starts a run in a temp root, must stay green with the new `docs` field.

**Verification:** `npm test` exits 0, and `scripts/orchestrate.mjs` contains no `docs/superpowers`.

---

### Task 4: Role profiles and the `/cc-orchestrate` brief name the resolved folder

**Files:**
- Modify: `project-template/.claude/agents/spec.md`
- Modify: `.claude/agents/spec.md`
- Modify: `project-template/.claude/agents/plan.md`
- Modify: `.claude/agents/plan.md`
- Modify: `project-template/.claude/commands/cc-orchestrate.md`
- Modify: `.claude/commands/cc-orchestrate.md`
- Test: `tests/unit/role-profiles.test.js`
- Test: `tests/installer/commands-parity.test.js`

**Step 1: tests first.**

- [x] **`tests/unit/role-profiles.test.js:40-41` (AC13):**
  - `CLAIM.spec = 'a spec file that answers the item was written under the folder your envelope\'s \`ops.scope\` names'`;
  - `CLAIM.plan = 'a plan file was written under the folder your envelope\'s \`ops.scope\` names, from the approved spec, and each task names its files'`;
  - add one case: for `spec` and `plan`, the profile does not contain `docs/superpowers`.
- [x] **`tests/installer/commands-parity.test.js`, inside `describe('cc-orchestrate mirrors ...')`, add a FEAT-047 case asserting `ORCH_MIRRORS[0]` contains:**
  - `its stdout ends with \`docs: specs <dir>, plans <dir> (<source>)[; group <group>]; test command: <command>\``;
  - `On \`ORCH_DOC_LOCATION_INVALID\`, report it and stop.`;
  - `` `ORCH_DOC_LOCATION_UNRESOLVED` ``;
  - the brief rows `Write the spec for \`<ITEM>\` under \`<specs>[/<group>]/\`` and `Write the plan under \`<plans>[/<group>]/\``;
  - and that it does not contain `docs/superpowers`.

Run `npm test`. **Failure point:** `[AC5]` fails for spec and plan (the old claim text), and the new parity case fails on every phrase.

**Step 2: edit the prose.** Apply each change to the template first, then copy it byte-for-byte to the mirror.

- [x] **`spec.md`:**
  - `:3` description: "Writes the spec for one backlog item under the folder its envelope's `ops.scope` names and hands back boundary_routed." The rest is unchanged.
  - `:11`: "as one new file under the folder your envelope's `ops.scope` names (the orchestrator's brief names it too), named `YYYY-MM-DD-<topic>-design.md`."
  - `:15`: the new `CLAIM.spec` sentence.
- [x] **`plan.md`:** the same three lines, with "the implementation plan for the approved spec" and the new `CLAIM.plan`. The `ops.f` instruction becomes "List the plan file in the hand-back's `ops.f` as `<path>:C`".
- [x] **`cc-orchestrate.md`:**
  - `:37`: "It resolves the run's test command and its spec and plan folders before it writes anything, and its stdout ends with `docs: specs <dir>, plans <dir> (<source>)[; group <group>]; test command: <command>`."
  - Add a bullet after `:40`: "On `ORCH_DOC_LOCATION_INVALID`, report it and stop. No run file was written. The owner fixes the named `- Specs:` / `- Plans:` line in `CLAUDE.md` (add the missing one, fix the value, or use two disjoint folders) before a fresh `start`."
  - `:44` run header: add "the spec and plan folders (and group) from `docs:`".
  - Add one sentence in the halt section near `:33`: "`install spec|plan` halts `ORCH_DOC_LOCATION_UNRESOLVED` on a run started before FEAT-047; recovery is `end`, then `start`."
  - `:151` brief: "Write the spec for `<ITEM>` under `<specs>[/<group>]/`, using the folder and group `start` printed."
  - `:152` brief: "Write the plan under `<plans>[/<group>]/`, using the folder and group `start` printed, in the writing-plans format: ...". The rest of the row is unchanged.

**Step 3: verify.** Run `npm test`.

**Failure point:**
- a mirror byte drift (`[AC2]`, and "are byte-identical");
- a profile over 999 tokens (`[AC3]`);
- the D5 pinned phrases accidentally reworded (`[AC4]`);
- the FEAT-031 and FEAT-041 pinned phrases in `commands-parity.test.js:200-251` broken by the edit.

**Verification:** `npm test` exits 0. `Grep docs/superpowers` over the six files returns nothing.

---

### Task 5: `/cc-resume`, `/cc-stack` 5a′ and the review-loop settings follow the resolved pair

**Files:**
- Modify: `project-template/.claude/commands/cc-resume.md`
- Modify: `.claude/commands/cc-resume.md`
- Modify: `global/commands/cc-stack.md`
- Modify: `project-template/.claude/review-loop.settings.json`
- Test: `tests/installer/review-loop-settings.test.js`
- Test: `tests/installer/commands-parity.test.js`

**Step 1: tests first.**

- [x] **`tests/installer/review-loop-settings.test.js:12` (AC13, Ruling 4).** In `EXCEPTION`, replace `under docs/superpowers/specs/ or docs/superpowers/plans/` with `under the project's resolved specs or plans folder`, and change nothing else. `SHA256` (`:13`) becomes the hash of the reworded file. The agent has no hash tool, so take it from the `[AC7] is pinned by its sha256` failure's received value, and only after `[AC7] holds exactly $defaults and the approved exception` passes against the edited file. Report the new hash in the hand-back. Update the owner-decision comment at `:11` to name FEAT-047 Ruling 4 and the pending FEAT-041 zero-wake re-measurement.
- [x] **`tests/installer/commands-parity.test.js`:**
  - **(a) In `describe('cc-resume mirrors ...')`, a FEAT-047 `it.each(RESUME_MIRRORS)` case.** Each copy contains:
    - `L=.claude/scripts/doc-locations.mjs; [ -f "$L" ] || L=scripts/doc-locations.mjs`;
    - `(location fallback: <cause>)`;
    - `recursively`.

    Neither copy contains `List files in \`docs/superpowers/`.
  - **(b) A new `describe('cc-stack 5a′ [FEAT-047 AC6, AC14]')` over `global/commands/cc-stack.md`.** It contains:
    - the same `L=` probe line;
    - `### 5a′.`;
    - `only when both`;
    - `Spec/plan folders not recorded: <cause>; start will discover them per run`;
    - `never fills the missing half from discovery`;
    - the half-recorded announcement sentence from the spec (`CLAUDE.md records - Specs: but not - Plans: (or the reverse); add the missing line by hand, or remove both and re-run /cc-stack. /cc-orchestrate start halts ORCH_DOC_LOCATION_INVALID until then.`);
    - and the `no` branch text runs 5a′: `run sub-step 5a′`.
  - **(c) In the `shipped detector path` describe, after its `deployProject` `beforeAll`:** `existsSync(join(cwd, '.claude/scripts/doc-locations.mjs'))` is true. This pins the `L=` probe's deployed target.

Run `npm test`. **Failure point:** the settings `toEqual` and the sha pin fail, and so do the cc-resume and cc-stack phrase cases. Case (c) passes already, since Task 2 created the script; it is a regression pin.

**Step 2: edit.**

- [x] **`review-loop.settings.json`:** the one-phrase rewording above. The file stays a single line with the same key order and the same trailing-newline state. Do not hand-format it.
- [x] **`cc-resume.md` Steps 5-6 (`:57-67`).** Edit the template, then mirror it byte-for-byte. Insert a "Step 4a: Resolve the spec and plan folders" before Step 5:
  - If `CLAUDE.md` holds both `- Specs:` and `- Plans:` lines, use them.
  - Otherwise resolve `L=.claude/scripts/doc-locations.mjs; [ -f "$L" ] || L=scripts/doc-locations.mjs`, run `node "$L"` from the repository root, and use `specs`/`plans` from its exit-0 JSON.
  - On any failure (Node unavailable, script missing, non-zero exit, output that is not JSON or lacks either string, or exactly one line recorded), use `docs/superpowers/specs` and `docs/superpowers/plans`, and append `(location fallback: <cause>)` to the summary line.

  Steps 5 and 6 then read: "Search `<specs>` recursively (grouped documents sit in subfolders) for `*.md` files", and likewise for `<plans>`. "Absent or empty → `none`" is kept.
- [x] **`cc-stack.md`:**
  - `:37` `no` branch: "acknowledge in one line, run sub-step 5a′ (additive: the only edit this path may make, Ruling 1), and stop."
  - After 5a (`:47`), add `### 5a′. Spec and plan folders (FEAT-047)`, stating the spec's Behavior "/cc-stack" items 1-5 in that order:
    - it acts only when both `- Specs:` and `- Plans:` are absent under `## Development Commands`;
    - it resolves and runs the CLI with the `L=` line;
    - it accepts only exit 0 with a JSON object whose `specs` and `plans` are non-empty strings;
    - it inserts each line after the last field line, one surgical edit per line (BUG-003), or appends both with the five fields when the header is absent;
    - it announces the pair and its `source`;
    - on a missing script, a non-zero exit or invalid output, it writes nothing and announces `Spec/plan folders not recorded: <cause>; start will discover them per run`, and 5b and 6 continue;
    - on a half-recorded state it writes nothing, does not run the CLI, never fills the missing half from discovery, and announces the spec's sentence;
    - with both present it does nothing;
    - existing lines are never rewritten.

  Keep the EOL rule of step 5.

**Step 3: verify.** Run `npm test`.

**Failure point:**
- the sha pin, if the JSON is re-serialized rather than edited in place;
- cc-resume mirror drift;
- `tests/unit/feat013-no-stack-profiles.test.js` (the `detect-stack.mjs` mention and the ruleset caps text in `cc-stack.md`) or `tests/unit/bounded-project-memory.test.js` (cc-resume digest wording) broken by an over-broad edit.

**Verification:** `npm test` exits 0. `Grep docs/superpowers` over `project-template/.claude/review-loop.settings.json` returns nothing. In the two `cc-resume.md` copies it appears only in the fallback sentence.

- [ ] **Step 4 (orchestrator, after the build band; not a code-agent step, since code agents have no git): AC3.**
  - Run `git diff --stat origin/main -- docs/superpowers` and `git diff --name-status origin/main -- docs/superpowers`.
  - Expected: only additions, exactly `A docs/superpowers/plans/2026-11-07-feat047-spec-plan-locations.md` and `A docs/superpowers/specs/2026-11-07-feat047-spec-plan-locations-design.md`.
  - Any `M`, `D` or `R` line under `docs/superpowers/` fails AC3. Report it before the audit band.

---

## Acceptance map

| AC | Task |
|---|---|
| AC1, AC2, AC7, AC8, AC11, AC14 (CLI rows) | 2 |
| AC3 | 2 (resolver, on a fixture shaped like this repository); 5 Step 4 (orchestrator's `git diff` check: only the two new documents are added under `docs/superpowers/`) |
| AC4, AC5, AC6 (start/install), AC9, AC10 (orchestrate.mjs) | 3 |
| AC10 (doc-locations.mjs) | 2 |
| AC12 profiles + brief | 4 |
| AC12 resume + settings, AC6 and AC14 (`/cc-stack` prose) | 5 |
| AC13 | 3, 4, 5 |
| AC15 | 1 (flat documents, leaf lines only) |
| AC16 | every task ends with `npm test` green |

## Owner follow-ups outside this plan

- Re-take the FEAT-041 zero-wake measurement under the reworded `review-loop.settings.json` before release (Ruling 4).
- Release records: CHANGELOG, backlog checkbox, README/wiki halt-code tables (`ORCH_DOC_LOCATION_INVALID`, `ORCH_DOC_LOCATION_UNRESOLVED`), and the `.claude/memory/project.md` mention of the old settings sha. This is a minor release under the BUG-042 test.
