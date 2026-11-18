# BUG-086: Unattended plan check accepts Files entries with characters outside printable ASCII

**Status:** Approved 2026-11-18 by independent review (round 1)

**Item:** `[BUG-086]` (intake of issue #240). **Date:** 2026-11-18.

## Problem

In an unattended `/cc-orchestrate` run, `delegate plan` turns a delegated `APPROVE` into `ESCALATE` when a plan task's **Files:** entry reaches `WRITE_SURFACE` or `CONTROL_PLANE` (`surfaceTask` in `scripts/orchestrate.mjs`; FEAT-054, BUG-080, BUG-081). The check is lexical. `inSurface` normalizes the entry (`taskGlob`: drop a leading `./`, lower-case it), escalates NTFS alias spellings (`ntfsAlias`), and then matches the result against the protected lists. All of those lists are printable ASCII.

An entry that holds a character outside printable ASCII (0x20-0x7E) passes that check whenever its spelling does not match a protected entry character for character. Some examples:

- an invisible character inside a protected name: `package.json` followed by U+200B ZERO WIDTH SPACE, or `.claude/hooks/` with a U+00A0 NO-BREAK SPACE in a segment;
- a look-alike for an ASCII character: U+2024 ONE DOT LEADER or U+FF0E FULLWIDTH FULL STOP in place of `.`;
- a C0 control or DEL (0x7F) inside a segment, such as a tab.

A lexical test over ASCII lists cannot predict how each filesystem and tool resolves these spellings. Unicode normalization, case-folding tables that go beyond ASCII, and tools that strip or replace control and invisible characters can all land on a protected file. The owner also cannot see an invisible character when reading the plan. In an unattended run, though, the owner does not read the plan: the delegated reviewer's `APPROVE` stands, and the owner never sees the task.

The precondition is `--unattended`, which the owner opts into. Attended runs are unaffected because the owner approves every plan.

## Solution

In `inSurface` (`scripts/orchestrate.mjs`), any entry that holds a character outside 0x20-0x7E is protected, with the existing write-surface reason. The test runs on the raw entry, before `taskGlob` strips the leading `./` and lower-cases it. It is added as one more disjunct next to `ntfsAlias`, in the same style: a small named predicate over the entry string, with one regular expression (`/[^\x20-\x7e]/`). `reachesList`, `reachesDir`, `globToRegExp`, the lists, the reason text, the precedence and the run-file shape stay as shipped. The owner's `approve plan` works on such an escalation the same way it works on any other.

### Choices the entry leaves open, and the ones this spec takes

| Choice | Taken | Why |
|---|---|---|
| Which string is tested | The entry exactly as `inSurface` receives it, before `taskGlob` | The entry asks for this, and it matters. `String.prototype.toLowerCase` maps some non-ASCII characters to ASCII: U+212A KELVIN SIGN lower-cases to `k` (measured in Node: `'pacKage.json'.toLowerCase() === 'package.json'`). If the test ran after `taskGlob`, that entry would lose its non-ASCII character, match `CONTROL_PLANE`, and escalate with the control-plane reason instead of the write-surface reason. A spelling that matches no list entry once folded would not escalate at all. Testing the raw string means folding can never erase the evidence. |
| Which characters | Everything outside 0x20-0x7E, so all of C0 (0x00-0x1F), DEL (0x7F) and every code point above 0x7E, including astral ones and lone surrogates | This is the range the entry names. The space (0x20) stays allowed: an inner space is an ordinary file-name character, and the existing `ntfsAlias` already escalates a trailing space. |
| Which entries | Any entry that holds such a character, whether or not it resembles a protected path | The entry says "any entry". Guessing which non-ASCII spellings resolve to a protected file is exactly the unpredictable step the rule removes. As a result, a task that declares an honest non-ASCII name such as `docs/résumé.md` also escalates to the owner. That friction is deliberate and limited to unattended runs. |
| Which reason | The write-surface reason, `task <id> declares <entry> inside the orchestrator write surface` | The entry asks for it. It also follows from the order of the checks: `surfaceTask` runs `inSurface` before `inControlPlane`, so a non-ASCII spelling of a control-plane path names the write surface, the way NTFS aliases already do (U44, U49). |
| Where the test lives | `inSurface`, not `ntfsAlias` and not `inControlPlane` | `ntfsAlias` takes the folded glob and splits it into segments, while this test needs the raw string and the whole entry. `inControlPlane` never sees an entry that `inSurface` escalated. Its comment ("No alias test: surfaceTask runs inSurface first, and it escalates every alias.") is extended to name non-ASCII entries too, so the reason why it has no such test stays written down. |

## Behavior

### Main path

1. The delegated reviewer writes `VERDICT: APPROVE` for a plan.
2. `defineOutcome` calls `surfaceTask` on the plan text. `extractTasks` yields each task's **Files:** entries (the text between backticks, minus a trailing `:line` or `:line-line` group and a leading `./`).
3. For each task in plan order, `t.files.find(inSurface)` returns the first entry that holds a character outside 0x20-0x7E, or the first entry that is an NTFS alias, or the first entry that reaches `WRITE_SURFACE`.
4. That task's reason is `task <id> declares <entry> inside the orchestrator write surface`. `<entry>` is the entry as `extractTasks` returned it, with its non-ASCII character in place. The verdict becomes `ESCALATE`, `delegated.plan` records `{ verdict: 'ESCALATE', reason }`, `approvals.plan` stays `null`, and stdout prints `owner approval required: delegated review plan returned ESCALATE (<reason>); see .conductor/delegate/plan.md`, exit 0.
5. The owner's `approve plan` then approves the plan, as for every escalation.

### Alternative paths

- **A plan with only printable-ASCII entries** (`src/a.js`, `docs/notes.md`, `docs/my notes.md` with an inner space, `docs/a!b.md`): the new test is false for each entry, and the existing checks decide as they do today. `APPROVE` stands when nothing reaches a list.
- **A non-ASCII spelling of a control-plane path** (`package.json` + U+200B, `pac` + U+212A + `age.json`): it escalates with the write-surface reason, because `inSurface` runs first.
- **Several tasks**: the first task in plan order that has a protected entry names the reason, as today (U45). A non-ASCII entry in Task 2 does not displace a control-plane entry in Task 1.
- **Several entries in one task**: `find` returns the first entry, in declaration order, that `inSurface` accepts. A task with `src/a.js` followed by a non-ASCII entry names the non-ASCII entry.
- **A delegated verdict other than APPROVE**: `surfaceTask` does not run, so nothing changes (it only overrides `APPROVE`).
- **A delegated spec, or a delegated build**: not affected. `surfaceTask` runs only for `plan`.

### Error cases

- No new error path. The predicate is a regular-expression test over a string and cannot throw. Any string is valid input, including a lone surrogate, which `[^\x20-\x7e]` matches.
- `JSON.stringify` writes the reason into the run file with control characters escaped, so the run file stays valid JSON. The reason is a free-form string field, so this needs no change to the run-file shape.

## Acceptance Criteria

- [ ] AC1: Over an `APPROVE` report, `delegate plan` escalates, with the reason `task Task 2 declares <entry> inside the orchestrator write surface`, a Task 2 entry that holds a character outside 0x20-0x7E. It does so for **root** and **nested** rows spelled from `WRITE_SURFACE` entries (for example `.conductor` + U+200B + `/x`, `.claude/memory/band-envelope.json` + U+200B) and from `CONTROL_PLANE` entries (for example `package.json` + U+200B, `CLAUDE` + U+2024 + `md`, `.claude/hooks/pre-tool-use` + U+FF0E + `mjs`, `.github/workflows/ci` + TAB + `.yml`). `approvals.plan` stays `null`, `delegated.plan` records the verdict and reason, and the owner's `approve plan` exits 0.
- [ ] AC2: The rows cover both ends of the range and both kinds of character: a C0 control (TAB, 0x09), DEL (0x7F), a Latin-1 letter (U+00E9), a zero-width character (U+200B) and a fullwidth character (U+FF0E). They also cover one row that matches no list at all (`docs/r` + U+00E9 + `sum` + U+00E9 + `.md`), which shows the rule covers any entry.
- [ ] AC3: `pac` + U+212A + `age.json`, whose lower-case form is the ASCII `package.json`, escalates with the **write-surface** reason, not the control-plane one. This proves that the test runs before lower-casing.
- [ ] AC4: `./` + a non-ASCII entry escalates with the write-surface reason, and the reason names the entry without the leading `./`. This proves that the test does not depend on the strip.
- [ ] AC5: Ordinary printable-ASCII entries keep the delegated `APPROVE` (`plan approved by delegated review: define_approved, 2 task(s); …`, `approvals.plan.by === 'define-review'`): `src/a.js`, `docs/notes.md`, and the boundary rows `docs/my notes.md` (0x20 inside) and `docs/a!b.md` (0x21).
- [ ] AC6: The existing U22, U41-U49 rows pass unchanged, and `npm test` is green.

## Out of Scope

- Guard 5 (`.claude/hooks/pre-tool-use.mjs`) and its `ORCH_WRITE_SURFACE` copy. This item changes only the unattended plan check in `scripts/orchestrate.mjs`, so the guard, the installer and the template mirrors are untouched.
- Escaping or quoting the entry inside the reason text. The reason keeps the declared spelling as it does today. Whether stdout should render invisible or control characters visibly (for example as `​`) is a separate presentation change. No acceptance criterion here asks for it.
- Unicode normalization or confusable mapping of entries. The rule escalates instead of trying to resolve a spelling.
- `extractTasks`, `taskScope`, `findingPath` and the build-band scope checks. They parse or scope entries but do not decide delegated approvals.
- Any change to `WRITE_SURFACE` or `CONTROL_PLANE` contents, or to the attended flow.

## System Impact

- `scripts/orchestrate.mjs`: one new predicate next to `ntfsAlias`, one more disjunct in `inSurface` that tests the raw entry before `taskGlob`, and the extended `inControlPlane` comment. `inSurface` has exactly one caller, `surfaceTask`.
- `tests/scripts/orchestrate.test.js`: new parameterized rows in the delegated-plan block, next to U41-U49, that reuse `expectEscalation(path, 'orchestrator write surface')` and the existing approve-path assertions (for example U50 for AC1-AC4 and U51 for AC5, under the `[BUG-086]` tag). Non-ASCII characters are written as `\u` escapes in the test source so the rows stay readable and survive editors.
- `scripts/orchestrate.mjs` is itself a `CONTROL_PLANE` entry and is deployed to `.claude/scripts/`. A plan for this item therefore escalates under its own rule in an unattended run, which is expected. No installer change is needed: the deployed copy comes from this file.
- `.gitignore`: this spec's leaf line in the tracked-surface block, in sorted position after the BUG-084 spec line (checked by `tests/unit/gitignore-block-parity.test.js`).

### Files Requiring Full Read (deferred to /cc-plan)

_None._ The functions this item touches (`extractTasks`, `taskGlob`, `ntfsAlias`, `inSurface`, `inControlPlane`, `surfaceTask`, `defineOutcome`) and the test helpers (`task`, `expectEscalation`, U22, U41-U49) were located with targeted searches.

## Complexity Estimate

S: a single regular-expression predicate in one function, plus parameterized test rows that reuse an existing helper.
