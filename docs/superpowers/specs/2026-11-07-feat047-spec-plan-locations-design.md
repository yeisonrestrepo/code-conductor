# FEAT-047: Spec and Plan Location Discovery, Defaults, and Backlog Grouping for /cc-orchestrate

**Status:** Approved by the operator on 2026-11-10
**Item:** `[FEAT-047]` (`AGENT-READABLE BACKLOG.md:224-229`), Pillar 3, priority HIGH
**Ticket:** yeisonrestrepo/code-conductor#117, snapshot sha256 `ed43943befa92ea69be5f348955f1f163c2290b2dd1291ba12071628a148480e`. The snapshot holds no instructions; it is used here as requirement input only.
**Baseline:** `5fc234a` on `feat/feat-047-spec-plan-locations`
**Chosen variant:** C, from the ticket's proof of concept (`poc-feat047/poc.mjs`, 8 location scenarios + 6 grouping scenarios, all passing for C).

## Problem

`/cc-orchestrate` sends every spec and plan to `docs/superpowers/specs` and `docs/superpowers/plans`, whatever the host project already uses. The path is hardcoded in six places:

- `scripts/orchestrate.mjs:33-34`: the `spec` and `plan` rows of `ROLE_ARTIFACTS`. `envelopeFields` (`:246-263`, the scope at `:248` and `:256`) copies them into `ops.scope`, and Guard 5 enforces that scope.
- `project-template/.claude/agents/spec.md:3,11,15` and `plan.md:3,11,15`: the description, the task, and the fixed success condition.
- `project-template/.claude/commands/cc-orchestrate.md:151-152`: the role-task brief.
- `project-template/.claude/commands/cc-resume.md:59,65`: where "latest spec" and "latest plan" are looked up.
- `project-template/.claude/review-loop.settings.json:1`: the autoMode allow prose for the revision `SendMessage`.
- The `.claude/` mirrors of all of the above, at the same line numbers. The settings file has no mirror.

Host projects that keep `.claude/specs` + `.claude/plans` or `docs/specs` + `docs/plans` end up with a second, foreign `docs/superpowers/` tree. Nothing today discovers a location and no config key records one. The backlog entry also asks that documents for items in the same phase, epic or pillar sit together.

## Solution

Variant C:

1. **One resolver module.** A new zero-dependency file, `scripts/doc-locations.mjs`, uses `node:` builtins only. Importing it has no side effects, under the same import-safety rule as `ticket.mjs`. It holds:
   - `readRecordedPair(root)`
   - `discoverPair(root)`
   - `checkDocDir(rel)`
   - `backlogGroup(root, item)`
   - `resolveDocLocations(root, item)`

   Run as a CLI (`node doc-locations.mjs [root]`), it prints `{"specs":..,"plans":..,"source":..}` as JSON. `/cc-stack` and `/cc-resume` read that output.
2. **Recorded once per project, in a file the owner already owns.** `/cc-stack` writes two lines under `## Development Commands` in the root `CLAUDE.md`, next to the commands it already writes:
   ```
   - Specs: <dir>
   - Plans: <dir>
   ```
   It writes them only when both are absent, and fills them from the CLI's discovered or default pair. A half-recorded state is reported, not filled. It never overwrites a recorded value, so an owner's hand edit always wins. The orchestrator writes no tracked file. `/cc-stack` runs in the main session, outside any run, as the owner's command.
3. **Pinned once per run.** `orchestrate.mjs start` calls `resolveDocLocations(root, item)` before it clears a stale run or writes anything, which is the same position `resolveTestCommand` holds at `:395-396`. It also computes both role scopes and checks each against `V3_CAPS['ops.scope']` there, before any write. It stores the result in the run file as `docs: { specs, plans, group, source, scopes: { spec, plan } }`. Every later `install` reads `run.docs`, so every role in the run agrees on the location even if `CLAUDE.md` or the tree changes mid-run.
4. **Scopes follow the resolved location.** `ROLE_ARTIFACTS.spec.scope` and `.plan.scope` become `null`. `envelopeFields` copies the scope `start` computed and checked into `run.docs.scopes`: `["<specs>[/<group>]/**"]` for spec and `["<plans>[/<group>]/**"]` for plan (Ruling 7). Guard 5 is unchanged, because it already matches any glob it is given (`pre-tool-use.mjs:199-208`).
5. **Prose follows the scope, not a path.** Each role profile names "the folder your envelope's `ops.scope` names" in place of the literal path. The orchestrator's brief names the concrete folder it read from `start`'s stdout.

## Behavior

### Main path

**Resolution order** (`resolveDocLocations`). The first rule that applies wins:

1. **Recorded.** `CLAUDE.md` at the run root holds both `^- Specs: (\S+)$` and `^- Plans: (\S+)$` (multiline, first match each), and both values pass `checkDocDir`. Result: `source: "claude-md"`.
2. **Discovered.** At least one candidate pair is present. Result: `source: "discovered"`.
3. **Default.** No candidate pair is present. The result is `docs/specs` + `docs/plans`, with `source: "default"`. The folders are not created; the role's Write creates them.

**Discovery and its tie-break** (`discoverPair`):

- The candidate pairs, in list order:
  1. `.claude/specs` + `.claude/plans`
  2. `docs/specs` + `docs/plans`
  3. `docs/superpowers/specs` + `docs/superpowers/plans`
- A pair is **present** when either half exists as a directory. A half pair resolves to its whole pair, so `docs/specs` alone resolves to `docs/specs` + `docs/plans`.
- The present pair holding the most `*.md` files, counted recursively across both halves, wins.
- On equal counts, the earlier pair in the list wins.
- The recursive count uses a hand-written walk rather than `readdirSync({ recursive: true })`, because `engines` is `node >=20` and that option arrived in 20.1. Symlinked directories are not followed.

**Grouping** (`backlogGroup`):

- **What is scanned.** Root-level files matching `/backlog/i` and ending in `.md`. In this repository that is `AGENT-READABLE BACKLOG.md`.
- **Group headings.** A group heading matches `^(#{1,5})\s+(phase|epic|pillar)\b[\s:#-]*(\d+)?[\s:.-]*(.*)$`, case-insensitive. The open group is replaced:
  - by the next group heading;
  - and, a refinement over the POC, cleared by any non-group heading at the same or a shallower level. For example, a `## Bugs` after `## PILLAR 2` closes Pillar 2.
- **Item headings.** An item heading is any `^#{1,6}\s` line that contains the item id as a whole word. The id is regex-escaped.
- **When the item is grouped.** Grouping applies only when exactly one item heading is found across all backlog files and a group was open above it. Otherwise the documents stay flat (`group: null`). Flat cases include:
  - no backlog file;
  - no heading for the item;
  - two or more item headings, in one file or across files;
  - no open group.
- **Folder-name format.** The folder is `<kind>-<n>` when the heading carries a number, where kind is `phase`, `epic` or `pillar`, lowercase. Otherwise it is `<kind>-<slug>`. The slug is the remainder lowercased, each run of characters outside `[a-z0-9]` replaced by one `-`, leading and trailing `-` trimmed, and the result cut to 40 characters. Examples:
  - `## PILLAR 3: FACTORY` gives `pillar-3`.
  - `## Epic: User Auth` gives `epic-user-auth`.
  - An empty slug means flat.
- **Application.** The group is computed once at `start`, applies to both spec and plan, and is stored in `run.docs.group`.

**Run file.** `start` adds `docs: { specs, plans, group, source, scopes: { spec, plan } }` to the record it writes at `:400-405`. `isValidRun` (`:81-85`) stays unchanged, so `end` can always clear any run.

**Envelope.** For spec and plan, `envelopeFields` sets `fields.scope` from `run.docs` as described in Solution step 4. Code's scope is unchanged: `taskScope` still adds `run.plan`, which `approve plan` records from its argument, wherever it lives.

**`start` stdout.** The output gains `docs: specs <dir>, plans <dir> (<source>)[; group <group>]` before `test command: …`, and `test command:` stays the last field because `cc-orchestrate.md:37` names it as the line's end. Step 1's run header prints this line. The step-2 brief for `spec` reads "under `<specs>[/<group>]/`" and for `plan` reads "under `<plans>[/<group>]/`", with the values taken from that stdout.

**The CLI's contract** (`node doc-locations.mjs [root]`; `root` defaults to cwd). It applies the same resolution and the same `checkDocDir` / overlap checks as `start`:

| Recorded state in `CLAUDE.md` | Exit | stdout | stderr |
|---|---|---|---|
| Both lines present and valid | 0 | `{"specs":<recorded>,"plans":<recorded>,"source":"claude-md"}` | empty |
| Neither line present | 0 | `{"specs":..,"plans":..,"source":"discovered"\|"default"}` | empty |
| Exactly one line present, or a recorded value fails `checkDocDir`, or the two overlap | 1 | empty | one line: `ORCH_DOC_LOCATION_INVALID: <reason naming the line>`, the same text `start` halts with |
| Any other exception | 1 | empty | one line naming the error |

The CLI prints no group, because grouping is per item and only `start` knows the item. A discovered or default pair is always one of the four fixed constant pairs. Those pairs pass `checkDocDir`, including its length cap, and are disjoint by construction, so every exit-0 output is a pair `start` accepts.

**`/cc-stack`.** This is `global/commands/cc-stack.md`, new sub-step 5a′. It runs on the write path after the five command fields. It also runs on the "nothing changed" path (`cc-stack.md:37`), where it is the only permitted edit (Ruling 1). It acts only when **both** `- Specs:` and `- Plans:` are absent under `## Development Commands`.

1. **Neither line present.** It resolves `L=.claude/scripts/doc-locations.mjs; [ -f "$L" ] || L=scripts/doc-locations.mjs` and runs `node "$L"` from the repository root.
2. **Success.** The output is accepted only when the exit code is 0 and stdout parses as a JSON object whose `specs` and `plans` are non-empty strings. Then:
   - each line is inserted after the last field line, one surgical edit per line (BUG-003);
   - when the header is absent, the two lines are appended together with the five fields;
   - the announcement names the recorded pair and its `source`.
3. **Failure.** In each of these cases 5a′ writes nothing:
   - `L` is missing at both paths;
   - the run exits non-zero;
   - stdout is empty, not JSON, or lacks either string.

   It announces one line (`Spec/plan folders not recorded: <cause>; start will discover them per run`), and the rest of `/cc-stack` (5b, 6) continues. Node being unavailable is already handled earlier: step 2 (`cc-stack.md:13`) stops the whole write path, so 5a′ never runs.
4. **Exactly one line present.** 5a′ writes nothing and does not run the CLI. It never fills the missing half from discovery, so it can never pair an owner's `Specs: documentation/rfcs` with a discovered `Plans: docs/plans`. It announces one line: `CLAUDE.md records - Specs: but not - Plans: (or the reverse); add the missing line by hand, or remove both and re-run /cc-stack. /cc-orchestrate start halts ORCH_DOC_LOCATION_INVALID until then.`
5. **Both lines present.** 5a′ does nothing, whatever the values. An invalid recorded value is the owner's to fix, and `start` names it.

Existing lines are never rewritten. Every value 5a′ writes is a CLI exit-0 value, so `/cc-stack` cannot record a pair that `start` rejects.

**`/cc-resume`.** Steps 5 and 6 work like this:

- **Which pair.**
  - When both `- Specs:` and `- Plans:` are present in `CLAUDE.md`, it uses them.
  - Otherwise it runs the CLI exactly as 5a′ does and uses its exit-0 output.
  - On any failure (Node unavailable, script missing, non-zero exit, invalid output, or exactly one line present) it falls back to `docs/superpowers/specs` and `docs/superpowers/plans`, and appends `(location fallback: <cause>)` to the summary line.
- **The search** runs **recursively**, so grouped documents are found, and picks the newest file by mtime as today.

### Alternative paths

- **This repository.** `CLAUDE.md` has no `- Specs:` line. The only candidate present is `docs/superpowers/*` (POC S9), so discovery resolves `docs/superpowers/specs` + `docs/superpowers/plans`. No existing file moves. Once `/cc-stack` runs here it records that same pair. Grouping resolves FEAT-047 to `pillar-3` (POC G6), so new grouped documents land in `docs/superpowers/{specs,plans}/pillar-3/`. Grouping applies to new documents only (Ruling 3). A new subfolder needs its ancestor re-include lines (`!/docs/superpowers/specs/pillar-3/` and `/docs/superpowers/specs/pillar-3/*`, likewise for plans) plus each document's leaf line in the `.gitignore` tracked-surface block. The plan owns those lines, so `tests/unit/gitignore-block-parity.test.js` stays green.
- **Drift (POC S7).** After `/cc-stack` records a pair, a busier pair appearing later changes nothing, because the recorded lines win.
- **Recorded folder deleted (S8).** The recorded value still wins, and the role's Write recreates it.
- **Owner-chosen folder.** Any value passing `checkDocDir`, for example `documentation/rfcs`, is honoured. This is the escape hatch for layouts outside the three candidates.
- **`/cc-stack` "nothing changed" ("no" at `cc-stack.md:37`).** The path still makes no stack edit, but it runs 5a′, which is additive only: it writes both lines when both are absent and never rewrites them (Ruling 1). Every host that runs `/cc-stack` once therefore has its location recorded. A host that never runs it resolves by discovery on each `start`, pinned per run.

### Error cases

Every error below is a `start` halt raised before anything is written. Nothing is recorded, and the remedy is named.

To make that hold for the scope cap, `start` computes both role scopes (`<specs>[/<group>]/**` and `<plans>[/<group>]/**`) from the resolved pair. It checks each against `V3_CAPS['ops.scope']` at the same position as `resolveTestCommand` (`orchestrate.mjs:395-396`), before a stale run is cleared, the snapshot is written or the run file is saved. `envelopeFields` then copies the already-checked scope out of `run.docs`. `install` never raises `ORCH_SCOPE_OVER_CAP` for spec or plan.

| Condition | Halt | Remedy in the message |
|---|---|---|
| Exactly one of `- Specs:` / `- Plans:` present | `ORCH_DOC_LOCATION_INVALID` | Add the missing line, or remove both |
| A recorded value fails `checkDocDir` | `ORCH_DOC_LOCATION_INVALID` | Fix the named line |
| Recorded `Specs` equals `Plans`, or one is inside the other (Ruling 6) | `ORCH_DOC_LOCATION_INVALID` | Use two disjoint folders |
| A computed role scope exceeds `V3_CAPS['ops.scope']` (300 chars per element, `snap-contract.mjs:34`). `checkDocDir`'s length cap makes this unreachable for any accepted value; the check is kept as the last line | `ORCH_SCOPE_OVER_CAP` (existing code), raised by `start` | Shorten the folder |

`checkDocDir(rel)` rejects a value that is:
- empty, or the template placeholder `<command>`;
- absolute, or carrying a drive letter;
- containing a `..` segment, a backslash, or any of `* ? [ ] { }`, since Guard 5's glob would read these as wildcards;
- the repository root `.`, or carrying an empty or `.` segment (`./docs/specs`, `docs//specs`), so a reserved folder cannot be reached through a non-canonical spelling;
- equal to, inside, or a parent of a reserved folder, compared segment-wise and case-folded: the orchestrator write surface (`.claude/memory/`, `.conductor/`), `.git/`, and the enforcement folders `.claude/hooks/`, `.claude/agents/`, `.claude/commands/`, `.claude/scripts/`, `.github/` and `scripts/`. A parent such as `.claude` is rejected because its scope would cover them. `.claude/specs` and `.claude/plans` stay valid (Ruling 8);
- longer than **249 characters** after the trailing `/` is stripped. That is the V3_CAPS element cap of 300 minus the 51 characters of `/<group>/**` headroom: a group name is at most 47 characters (`pillar-` plus 40), plus `/` and `/**`. The cap is derived in code from `V3_CAPS['ops.scope'][1]`, never hardcoded.

A trailing `/` is stripped before every check. To keep the headroom true, `backlogGroup` treats a group name longer than 47 characters, which only a numbered heading can produce, as flat.

Other failures:

- **Unreadable files.** An unreadable `CLAUDE.md`, backlog file or candidate directory counts as absent. Grouping falls back to flat and discovery falls back to the next rule. It never halts.
- **A live run without `run.docs`.** This means a run started before upgrade. `install spec|plan` halts `ORCH_DOC_LOCATION_UNRESOLVED`, with the remedy `end`, then `start`.

## Acceptance Criteria

1. **AC1 Discovery order declared.** `discoverPair` returns the candidate holding the most `.md` files; on a tie, the earlier of `.claude/*`, `docs/*`, `docs/superpowers/*` wins; a half pair counts as present. Tests reproduce POC S2-S6 as fixtures.
2. **AC2 Default.** In a project with no candidate and no recorded lines, `resolveDocLocations` returns `docs/specs` + `docs/plans` with `source: "default"` (S1).
3. **AC3 This repository unchanged.** Run against this repository's root, `resolveDocLocations` returns `docs/superpowers/specs` + `docs/superpowers/plans`. No file under `docs/superpowers/` is moved, renamed or edited by the change. The `git diff --stat` of the implementation shows no rename and no delete under `docs/superpowers/`.
4. **AC4 Scopes follow the location.** `ROLE_ARTIFACTS.spec.scope` and `.plan.scope` are `null`. An envelope built for a run started with the pair `.claude/specs` + `.claude/plans` and no group carries `ops.scope` `[".claude/specs/**"]` for spec and `[".claude/plans/**"]` for plan. With `group: "pillar-3"` it carries `[".claude/specs/pillar-3/**"]`. The string `docs/superpowers` no longer appears in `scripts/orchestrate.mjs`.
5. **AC5 Guard 5 agrees.** In a hook test, a `spec` agent writing `.claude/specs/x.md` under the AC4 envelope is allowed, and one writing `docs/superpowers/specs/x.md` is denied `BAND_SCOPE_VIOLATION`.
6. **AC6 Recorded once per project.** `/cc-stack`'s prose runs 5a′ on both the write path and the "nothing changed" path. 5a′ inserts `- Specs:` / `- Plans:` only when both are absent and never rewrites an existing value. `start` prefers recorded lines over discovery (S7 passes). `run.docs` is written once at `start` and read unchanged by every `install`. Changing `CLAUDE.md` after `start` does not change the next envelope's scope.
7. **AC7 Grouping only when unambiguous.** `backlogGroup` returns `pillar-3` for this repository's FEAT-047. It returns `epic-user-auth` for G2, and `null` for G3 (no group), G4 (item in two files), G5 (no backlog file), an item listed twice in one file, a `## Bugs` heading closing an earlier `## Pillar`, and a numbered heading whose group name would exceed 47 characters. Exactly one heading line for the item across all backlog files groups it; any other count is flat (Ruling 5).
8. **AC8 Folder-name format.** The format is `<kind>-<number>`, else `<kind>-<slug>` (lowercase, `[a-z0-9-]`, at most 40 characters), and an empty slug means flat. Each branch has a unit test.
9. **AC9 Error cases.**
   - Each row of the error table halts at `start` with its code, and no run file or snapshot is written (assert the absence of `RUN_FILE`).
   - The over-cap row is tested by calling the scope check directly with an over-long pair, since `checkDocDir` rejects such a pair first.
   - `checkDocDir` rejects a 250-character value and accepts a 249-character one.
   - `checkDocDir` rejects `.claude`, `.`, `.claude/hooks`, `.claude/agents`, `.claude/commands`, `.claude/scripts`, `.github` and `scripts` with a non-empty reason, plus their non-canonical and case variants, and still accepts `.claude/specs` and `.claude/plans`; `start` halts `ORCH_DOC_LOCATION_INVALID` on a recorded `- Specs: .claude/hooks` (Ruling 8).
   - Every exit-0 CLI pair passes `start`'s scope check.
   - `install spec` and `install plan` contain no path to `ORCH_SCOPE_OVER_CAP`.
10. **AC10 No tracked write by the orchestrator.** `doc-locations.mjs` and `orchestrate.mjs` contain no write to `CLAUDE.md` or any path outside `WRITE_SURFACE`. `WRITE_SURFACE` and Guard 6's pinned copy are unchanged.
11. **AC11 Zero dependencies.** `doc-locations.mjs` imports only `node:` modules. `package.json` `dependencies` is unchanged. Importing the module has no side effects (a test imports it and asserts no process handlers and no output).
12. **AC12 Prose surfaces.**
    - The spec and plan profiles in `project-template/.claude/agents/` and `.claude/agents/` name the scope folder rather than a literal path, stay byte-identical across mirrors and stay at 999 tokens or fewer.
    - `cc-orchestrate.md:151-152` (both copies) brief the resolved folder.
    - `cc-resume.md:59,65` (both copies) read the recorded or discovered pair recursively.
    - `review-loop.settings.json` no longer names `docs/superpowers`. It names "the project's resolved specs or plans folder", reworded minimally with the rest of the prose unchanged (Ruling 4).
13. **AC13 Pinning tests updated, not deleted.**
    - `tests/scripts/orchestrate.test.js:19,105-106`
    - `tests/unit/role-profiles.test.js:40-41`
    - `tests/installer/review-loop-settings.test.js:12`

    Each asserts the new shape. `tests/unit/snap-validate.test.js:280`, `tests/fixtures/guard3-*` and `tests/fixtures/legacy-project-memory-stub.md` use the path only as data and stay unchanged.
14. **AC14 CLI and `/cc-stack` failure handling.**
    - `doc-locations.test.js` covers each row of the CLI contract table (exit code, stdout, stderr), including the half-recorded state, which exits 1 with empty stdout.
    - `cc-stack.md`'s sub-step 5a′ states:
      - it writes only when both lines are absent;
      - it writes nothing and names the cause when the script is missing, the exit is non-zero, or the output is invalid;
      - it writes nothing on a half-recorded state and tells the owner to fix it by hand;
      - it never fills one half from discovery.
    - `cc-resume.md`'s fallback names its cause.
15. **AC15 Tracked-surface block.** Any grouped subfolder created by the implementation's own documents in this repository has its ancestor re-include lines and leaf lines in `.gitignore`, and `tests/unit/gitignore-block-parity.test.js` passes (Ruling 3).
16. **AC16 Suite green.** `npm test` passes on Windows and POSIX. The new tests add to the measured baseline at `5fc234a`.

## Out of Scope

- Moving, renaming or regrouping any existing spec or plan, in this repository or a host.
- The manual `/cc-spec` and `/cc-plan` commands, which name no output folder today (`cc-plan.md` has no path). Whether they consume `doc-locations.mjs` is a follow-up.
- Adding `specs` / `plans` to `FIELDS` in `scripts/claude-md-fields.mjs`. That would make `/cc-init` and `init-wizard.mjs` prompt for them (Ruling 2).
- Adding `- Specs:` / `- Plans:` placeholders to `project-template/CLAUDE.md`.
- Backlog files outside the repository root, and any grouping key other than phase, epic or pillar.
- Any change to Guard 5, Guard 6, `WRITE_SURFACE`, the SNAP contract, `V3_CAPS`, `ROLES` or the gates.
- Configuring discovery candidates beyond the three named pairs. The recorded lines already cover any other folder.

## System Impact

| File | Change |
|---|---|
| `scripts/doc-locations.mjs` | **New.** Resolver, discovery, grouping, `checkDocDir`, CLI |
| `scripts/orchestrate.mjs:31-38` | `ROLE_ARTIFACTS` spec and plan `scope: null` |
| `scripts/orchestrate.mjs:246-263` | `envelopeFields` derives the spec and plan scope from `run.docs`; halts `ORCH_DOC_LOCATION_UNRESOLVED` when `run.docs` is absent; raises no cap halt, because `start` has already checked the scope |
| `scripts/orchestrate.mjs:390-408` | `start` resolves before clearing (next to `:396`), computes and cap-checks both role scopes before any write, records `docs` (with the checked scopes), and extends stdout |
| `project-template/.claude/agents/spec.md:3,11,15` and `plan.md:3,11,15`, plus `.claude/agents/` mirrors | Path becomes "the folder your envelope's `ops.scope` names" |
| `project-template/.claude/commands/cc-orchestrate.md:37,44,151-152`, plus `.claude/commands/` mirror | Header line; brief rows use the resolved folder |
| `project-template/.claude/commands/cc-resume.md:57-67`, plus mirror | Recorded or discovered pair, recursive search |
| `global/commands/cc-stack.md:37,45-47` | New sub-step 5a′ recording `- Specs:` / `- Plans:` when both are absent, run on the write path and on the "nothing changed" path |
| `project-template/.claude/review-loop.settings.json:1` | Minimal rewording: "the project's resolved specs or plans folder" replaces `docs/superpowers/specs/ or docs/superpowers/plans/`. **The owner should re-take the FEAT-041 zero-wake measurement under the reworded file before release.** This PR takes no new measurement (Ruling 4) |
| `tests/scripts/orchestrate.test.js` | `ROLE_ARTIFACTS` pin, `PLAN` constant, new `start`/`install` cases for `run.docs`, error table |
| `tests/scripts/doc-locations.test.js` | **New.** S1-S8, G1-G6 plus the closing-heading case, `checkDocDir`, import safety |
| `tests/unit/role-profiles.test.js:40-41` | `CLAIM` strings |
| `tests/installer/review-loop-settings.test.js:12` | Pinned prose |
| `tests/hooks/guard5.test.js` | AC5 case, if not covered by an existing table |
| `.gitignore` | Leaf line for this spec at approval time, per the staging convention. The plan adds the ancestor re-include lines and leaf lines for any grouped subfolder (for example `pillar-3/`) that new documents create, keeping `tests/unit/gitignore-block-parity.test.js` green (Ruling 3) |

**Constraints honoured.** The change adds zero dependencies. The orchestrator never writes a tracked file. Guard 5's scope cap is checked against `V3_CAPS` (20 entries, 300 characters each), and spec and plan use one entry each. FEAT-031's Ruling 2 ticket-identity rider in `envelopeFields` is untouched.

**Release.** A fresh install differs (agents, commands, settings and scripts all change), so by the ratified `[BUG-042]` test this is a minor release.

## Complexity Estimate

**M.** One new module of about 120 lines, two function changes in `orchestrate.mjs`, prose edits across five shipped files and their mirrors, and roughly 30 new test cases. The residual risk is the reworded review-loop settings prose, which Ruling 4 leaves to an owner re-measurement before release.

## Rulings

These were ruled 2026-11-07 by the orchestrator, under the owner's delegation for this session.

- **Ruling 1 (OQ-1): YES.** `/cc-stack`'s "nothing changed" path still runs 5a′, additively: it writes both lines only when both are absent and never rewrites them. Why: this makes "recorded once per project" hold for every host that runs `/cc-stack`.
- **Ruling 2 (OQ-2): NO.** `specs` and `plans` do not join `FIELDS` in `claude-md-fields.mjs`. Why: scope; `/cc-init` prompts are not in the backlog entry.
- **Ruling 3 (OQ-3): YES.** Grouping applies in this repository too, as the entry's AC reads, for new documents only; existing files never move. The plan handles the `.gitignore` tracked-surface block (leaf lines and any ancestor re-include a subfolder needs). Why: the AC applies to every project, and the parity test keeps the block honest.
- **Ruling 4 (OQ-4):** Reword `review-loop.settings.json` minimally, to "the project's resolved specs or plans folder". The owner re-takes the FEAT-041 zero-wake measurement before release; this PR takes no new measurement. Why: the literal path is wrong for hosts, and the measurement belongs to the owner's live-run rule.
- **Ruling 5 (OQ-5):** Exactly one heading line for the item across all backlog files; anything else is flat. Why: one definition of "unambiguous", with no guessing among duplicates.
- **Ruling 6 (OQ-6): HALT** with `ORCH_DOC_LOCATION_INVALID` when the recorded specs and plans folders are equal or one is nested in the other. Why: Guard 5 scopes must stay disjoint.
- **Ruling 7 (OQ-7):** The write scope includes the group subfolder (`<dir>/<group>/**`). Why: it is the tightest Guard 5 envelope.
- **Ruling 8 (PR #120 review):** `checkDocDir` reserves the enforcement folders listed under Error cases, rejects any parent of a reserved folder (`.claude`, `.`), rejects empty and `.` segments, and compares case-folded. Why: the recorded folder becomes the spec and plan agents' Guard 5 write scope, which on `main` was fixed to `docs/superpowers/*`; a document agent must never gain write access to hooks, agent profiles, commands, scripts or CI workflows. Case folding matches Windows and macOS file systems. The `plan.md` hand-back rule keeps "The owner approves that path."; dropping it was not intended.

Separately, two reviewer notes were folded into the body:
- `start` now computes and cap-checks both role scopes before writing anything, so every error-table row is a pre-write `start` halt.
- `checkDocDir` enforces the 249-character cap derived from `V3_CAPS`, so every exit-0 CLI pair is accepted by `start`.
