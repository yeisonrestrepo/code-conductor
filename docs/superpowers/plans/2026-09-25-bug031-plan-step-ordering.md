# BUG-031 Plan Step Ordering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teach `/cc-plan` that a staging step must come after every step in the same commit group that edits the file it stages, so a generated plan never commits a tracking file in its pre-edit state.

**Architecture:** One prose bullet appended to the `## Ordered Steps` generation rules in `.claude/commands/cc-plan.md`; the `project-template/` mirror regenerated from it with the existing two-expression `sed`; the rule pinned in both mirrors by an occurrence-counted, whitespace-normalized, literal-split anchor in the existing `cc-plan mirrors` describe of `tests/installer/commands-parity.test.js`. No runtime code changes and no behavior change to any script.

**Tech Stack:** Markdown command files, `sed` (BSD/macOS and GNU compatible as written), Node 20+, vitest 3.

**Spec:** `docs/superpowers/specs/2026-09-24-bug031-plan-step-ordering-design.md`

## Global Constraints

- The rule text lands **byte for byte** as written in the spec's `## Rule Text (verbatim)` block, reproduced verbatim in T-001-D below. That block is the single source of the rule's wording.
- Hyphens, never em dashes, in every file this plan writes (`global/memory/personal.md:9`, `project.md:44`).
- The template mirror is **regenerated, never hand-edited**. Both `sed -e` expressions are live for `cc-plan.md` (line 7 uses the second); neither may be dropped.
- Relocate every edit target by heading grep, never by line number.
- All plan and backlog state updates are surgical single-line `Edit` calls, one checkbox or field at a time (BUG-003 invariant).
- Every task that edits a file and commits it orders its steps **edit, then stage, then commit** - this plan is the first one written to obey the rule it installs.
- `docs/` is gitignored (`.gitignore:8`): the plan file is force-added, the spec file stays untracked, matching the last three cycles.
- Commit messages follow Conventional Commits (`CONTRIBUTING.md:37`) and end with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- `npm test` baseline before this plan: **583 passed / 12 skipped**.

---

### Task 0: Branch, then save the plan

**Files:**
- Add (forced): `docs/superpowers/plans/2026-09-25-bug031-plan-step-ordering.md`
- Modify (forced): `.claude/memory/project.md` (the uncommitted BUG-031 spec summary from the spec phase)
- Modify: `AGENT-READABLE BACKLOG.md`

**Interfaces:**
- Consumes: nothing.
- Produces: the branch `fix/bug-031-plan-step-ordering`; the committed plan file the `cc-implement` locator greps; the `[>]` backlog state T-002-D flips to `[X]`.

- [X] [T-000-A] Resolve the branch gate before any write below

The `## Phase exit` branch gate of `/cc-plan` runs to completion - warning, offer, and either a
confirmed `git switch` or an explicit decline - **before** T-000-B stages anything. HEAD is on
`main` (the default branch), so the gate must warn and offer. Derived name:
`fix/bug-031-plan-step-ordering` (spec stem `2026-09-24-bug031-plan-step-ordering-design`, id
token `bug031` to `BUG-031`, prefix `fix/` per `CONTRIBUTING.md:23`). Validated Task 0 subject:
the T-000-C subject below (`docs:`, id inline - both pass `CONTRIBUTING.md:37`).

- [X] [T-000-B] Flip the backlog checkbox to in-progress

Re-locate by heading, never by line number:

```bash
grep -n '^### \[ \] `\[BUG-031\]`' "AGENT-READABLE BACKLOG.md"
```

Expect **exactly one** match. Zero or more than one: halt and report - never guess which line is
meant. Then one surgical `Edit` on that line, `### [ ]` to `### [>]`, every byte after the
checkbox unchanged. The edit must land **before** T-000-C stages it, or the flip never reaches
the commit. This ordering is the defect BUG-031 exists to prevent; it is deliberate here.

- [X] [T-000-C] Commit the plan, the spec memory, and the flipped backlog

`.claude/` and `docs/` are both gitignored, so both need `-f`. `git add` under `.claude/` exits 1
while still staging - keep `git commit` on its own line, never chained.

```bash
git branch --show-current   # expect: fix/bug-031-plan-step-ordering
git add -f docs/superpowers/plans/2026-09-25-bug031-plan-step-ordering.md
git add -f .claude/memory/project.md
git add "AGENT-READABLE BACKLOG.md"
git status --short          # expect: the plan, project.md, and the backlog - nothing else
```

```bash
git commit -m "$(cat <<'MSG'
docs: add the BUG-031 plan step ordering implementation plan

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

The spec file stays **untracked**; do not add `docs/superpowers/specs/2026-09-24-bug031-plan-step-ordering-design.md`.

---

### Task 1: The ordering rule, the regenerated mirror, and the anchor

**Files:**
- Modify: `.claude/commands/cc-plan.md` (append one bullet to `## Ordered Steps`)
- Regenerate: `project-template/.claude/commands/cc-plan.md`
- Modify: `tests/installer/commands-parity.test.js` (one new `it.each` in the existing `cc-plan mirrors` describe)

**Interfaces:**
- Consumes: the branch and the committed plan from Task 0.
- Produces: the rule text in both mirrors; the test constants `NORM` (`(s) => s.replace(/\s+/g, ' ').trim()`) and `ORDERING_CLAUSE` (a single-quoted string) in `tests/installer/commands-parity.test.js`, both local to that file.

- [X] [T-001-A] Run the three preconditions

**(1) Mirror-`sed` hazard grep on the rule text.** The two live substitution patterns must not
appear in the text being inserted, or regeneration would rewrite the rule in the template only
and the anchor would match one mirror and not the other:

No temp file: the rule text is fed to `grep` on stdin, so this step leaves nothing behind and
works in any working directory. **Use the multi-`-e` form, never `\|` alternation**: `\|` is a
GNU BRE extension, and BSD `grep` (the default on macOS) reads it as a literal pipe character, so
an alternation guard matches nothing whatever the text contains and "expect 0" becomes a
guaranteed false pass. A guard that silently approves everything is the exact failure shape this
guard exists to catch.

```bash
grep -c -e 'node scripts/' -e 'running `scripts/' <<'RULE'
- **Step ordering within a task.** A step that stages a file - any form of `git add` (`-f`,
  `-A`, `-u`, `--all`, `.`, or an explicit path) - must come after every step in the same
  commit group that edits that file. A commit group is the contiguous run of steps ending at a
  `git commit` step; a task with two commits has two groups. A step that stages implicitly,
  such as `git commit -a`, counts as its own staging step, so every edit of a file it will
  commit must precede it. A task that mixes edits with a commit orders its steps edit, then
  stage, then commit. A staging step for a file the task never edits is unaffected by this
  rule; never invent an edit step to satisfy it. `cc-implement` executes checkbox lines in file
  order, so a staging step placed above its edit commits the file's previous content while
  every checkbox still reports `[X]`, and the divergence surfaces only at whatever later task
  asserts on that file's expected state, pointing at the wrong task.
RULE
```

Expect **`0`** (`grep -c` exits 1 on zero matches; that non-zero exit is the expected result,
not a failure). Any hit: halt and report - the rule must be reworded before regeneration.
If the mirror transform ever gains a third `-e` expression, this grep gains the matching pattern
in the same change.

**(2) Zero-count needle precheck.** Prove the anchor cannot collide with prose already in the
file:

The needle contains `file's`, so it must never travel inside a shell-quoted `node -e '...'`
string: the apostrophe would terminate the quote and leave the remaining backticks live. Feed the
script through a delimiter-quoted heredoc instead - the same inert-quoting trick T-000-C uses for
the commit message.

```bash
node --input-type=commonjs <<'JS'
const fs = require("fs");
const norm = (s) => s.replace(/\s+/g, " ").trim();
const needle =
  "a staging step placed above its edit commits the file's previous content " +
  "while every checkbox still reports `[X]`";
for (const f of [".claude/commands/cc-plan.md", "project-template/.claude/commands/cc-plan.md"]) {
  console.log(f, norm(fs.readFileSync(f, "utf8")).split(norm(needle)).length - 1);
}
JS
```

Expect `0` for **both** files. A non-zero count means existing prose collides after
normalization: halt and pick a different needle rather than shipping an anchor that counts 2.

**(3) Heading-grep uniqueness for the insertion point:**

```bash
grep -c '^## Ordered Steps$' .claude/commands/cc-plan.md
grep -c '^- Whether it has a dependency on a previous step$' .claude/commands/cc-plan.md
grep -c '^## Test List$' .claude/commands/cc-plan.md
```

Expect **`1` from each**. Anything else: halt - the insertion point is ambiguous.

**(4) Adjacency of the three-line `old_string` sequence.** Uniqueness of each anchor does not
prove the bullet, one blank line and the heading are contiguous, which is what T-001-D's
`old_string` assumes. A mismatch fails the `Edit` loudly rather than corrupting the file, but
discovering it here is cheaper than mid-edit:

```bash
awk '/^- Whether it has a dependency on a previous step$/{a=NR} /^## Test List$/{if (NR==a+2) c++} END{print c+0}' \
  .claude/commands/cc-plan.md
```

Expect **`1`**. `0` means the two anchors are no longer separated by exactly one blank line:
halt and re-derive the `old_string` from the file rather than forcing the edit.

- [X] [T-001-B] Write the failing anchor test

Add to `tests/installer/commands-parity.test.js`, inside the existing `describe('cc-plan mirrors', ...)`
block, after the `pins the exact git invocations the gate depends on` test and before the
closing `});` of that describe:

```js
  // Whitespace-normalized so a rewrap of the hard-wrapped rule cannot break the anchor, and
  // counted with a literal `split` because the clause contains `[X]`, which `new RegExp` would
  // read as a character class and silently miscount. The constant is single-quoted, never a
  // template literal: it contains backticks.
  const NORM = (s) => s.replace(/\s+/g, ' ').trim();
  const ORDERING_CLAUSE =
    'a staging step placed above its edit commits the file\'s previous content ' +
    'while every checkbox still reports `[X]`';

  // Asserted on BOTH mirrors, not just the source. The `differ only in the script path nesting`
  // test already implies the mirror, but transform-equivalence is a relative property: if that
  // assertion is ever relaxed, or the transform gains an expression touching this text, the
  // two-sided anchor is what keeps the mirror honest. Do not remove either side as dead.
  it.each(MIRRORS)('%s carries the step-ordering rule exactly once', (rel) => {
    const count = NORM(read(rel)).split(NORM(ORDERING_CLAUSE)).length - 1;
    expect(count).toBe(1);
  });
```

- [X] [T-001-C] Run the new test to verify it fails

```bash
npx vitest run tests/installer/commands-parity.test.js
```

Expected: **FAIL**, two cases (`.claude/commands/cc-plan.md` and
`project-template/.claude/commands/cc-plan.md`) reporting `expected +0 to be 1`. Every other
assertion in the file still passes. A failure of any other test means something unrelated broke:
halt and report.

- [X] [T-001-D] Insert the rule as the last bullet of `## Ordered Steps`

One `Edit` on `.claude/commands/cc-plan.md`. `old_string` is the located bullet plus the blank
line and heading that follow it:

```markdown
- Whether it has a dependency on a previous step

## Test List
```

`new_string`:

```markdown
- Whether it has a dependency on a previous step
- **Step ordering within a task.** A step that stages a file - any form of `git add` (`-f`,
  `-A`, `-u`, `--all`, `.`, or an explicit path) - must come after every step in the same
  commit group that edits that file. A commit group is the contiguous run of steps ending at a
  `git commit` step; a task with two commits has two groups. A step that stages implicitly,
  such as `git commit -a`, counts as its own staging step, so every edit of a file it will
  commit must precede it. A task that mixes edits with a commit orders its steps edit, then
  stage, then commit. A staging step for a file the task never edits is unaffected by this
  rule; never invent an edit step to satisfy it. `cc-implement` executes checkbox lines in file
  order, so a staging step placed above its edit commits the file's previous content while
  every checkbox still reports `[X]`, and the divergence surfaces only at whatever later task
  asserts on that file's expected state, pointing at the wrong task.

## Test List
```

Byte-for-byte from the spec's `## Rule Text (verbatim)` block: a `- ` bullet matching the rest
of the section, hyphens not em dashes, two-space continuation indent.

- [X] [T-001-E] Regenerate the template mirror

Never hand-edit the template. Run from the repository root:

```bash
sed -e 's|node scripts/|node .claude/scripts/|g' \
    -e 's|running `scripts/|running `.claude/scripts/|g' \
    .claude/commands/cc-plan.md > project-template/.claude/commands/cc-plan.md
```

Both `-e` expressions are live for this file - line 7 contains ``running `scripts/resume-read.mjs` ``.
Dropping either one corrupts the mirror. Sanity check:

```bash
grep -c -e 'node .claude/scripts/' -e 'running `.claude/scripts/' project-template/.claude/commands/cc-plan.md
```

Expect a **non-zero** count: the nested paths are present. Then the residual half, which the
multi-`-e` form makes portable (see T-001-A on why `\|` is not):

```bash
grep -c -e 'node scripts/' -e 'running `scripts/' project-template/.claude/commands/cc-plan.md
```

Expect **`0`**: no un-nested path survived the transform. A non-zero count here also fires if
`cc-plan.md` ever mentions those strings outside a substitutable position, which is exactly the
halt-and-look this check is for - investigate before proceeding, do not edit the template to
silence it.

- [X] [T-001-F] Run the parity suite immediately

```bash
npx vitest run tests/installer/commands-parity.test.js
```

Expected: **PASS**, including `differ only in the script path nesting` and both new
`carries the step-ordering rule exactly once` cases. Running it here rather than waiting for the
commit gate means a dropped `sed -e` is reported against the step that caused it, not against a
wall of release-gate output.

- [X] [T-001-G] Run the full suite

```bash
npm test
```

Expected: **585 passed / 12 skipped** (the 583 baseline plus the two new `it.each` cases).

- [X] [T-001-H] Commit

```bash
git add tests/installer/commands-parity.test.js project-template/.claude/commands/cc-plan.md
git add -f .claude/commands/cc-plan.md
git status --short   # expect exactly those three files
```

```bash
git commit -m "$(cat <<'MSG'
fix: order a task's staging step after the edits it captures [BUG-031]

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 2: Release closeout

**Files:**
- Modify: `VERSION`, `package.json`, `package-lock.json`, `CHANGELOG.md`
- Modify: `AGENT-READABLE BACKLOG.md`
- Modify (forced): `.claude/memory/project.md`

**Interfaces:**
- Consumes: the rule, mirror and anchor from Task 1.
- Produces: release `1.27.1`; the `[X]` backlog state.

`README.md` is **deliberately omitted**: BUG-031 changes no user-facing behavior, so the closeout
chore commit does not touch it. The omission is intentional, not an oversight.

- [X] [T-002-A] Bump the version to 1.27.1

Patch bump (a fix, no new surface). Three files, surgical edits:

```bash
printf '1.27.1\n' > VERSION
```

`package.json`: `"version": "1.27.0",` to `"version": "1.27.1",` (one occurrence, line 3).

`package-lock.json`: **two** occurrences of `"version": "1.27.0",` - the root object and the `""`
package entry. Locate them with `grep -n`, never by remembered line number (this cycle reads 3
and 9; the last cycle recorded 3 and 8). Edit both; a lockfile left at the old version fails
`npm ci --dry-run` parity in a later cycle. Verify:

```bash
grep -c '"version": "1.27.1"' package-lock.json   # expect 2
grep -c '"version": "1.27.0"' package-lock.json   # expect 0
```

- [X] [T-002-B] Add the CHANGELOG entry

Insert directly below the `# Changelog` heading, above `## [1.27.0] - 2026-09-24`:

```markdown
## [1.27.1] - 2026-09-25

### Fixed

- **[BUG-031]** `/cc-plan`'s generation rules said nothing about where a staging step belongs relative to the edits it captures, so a generated task could `git add` a tracking file before the step that flips it. `cc-implement` walks checkbox lines in file order, so such a plan commits the file's previous content while every checkbox still reports `[X]`, and the divergence surfaces only at whatever later task asserts on that file's state, pointing at the wrong task. The `## Ordered Steps` rules now carry an explicit step-ordering bullet that defines its own terms (a commit group is the contiguous run of steps ending at a `git commit`), covers any form of `git add` and the implicit stage of `git commit -a`, exempts staging a file the task never edits without inviting dummy edit steps, and names the consequence. The rule ships in both `cc-plan.md` mirrors and is pinned by an occurrence-counted anchor in the parity suite.
```

- [X] [T-002-C] Append the closeout summary to `.claude/memory/project.md`

One append at the end of the file, under a new heading:

```markdown
## Closeout: BUG-031 Plan Step Ordering 2026-09-25

- Shipped in `1.27.1`: one prose bullet appended to `## Ordered Steps` in both `cc-plan.md` mirrors, pinned by an occurrence-counted anchor in `tests/installer/commands-parity.test.js`.
- Convention reinforced: the template mirror is regenerated with the two-expression `sed` and the parity suite runs immediately after regeneration, not at the commit gate.
- Convention reinforced: a generation rule defines its own terms, because the generator reads only `cc-plan.md`.
- Anchor discipline: whitespace-normalize both sides, count literally with `split`, hold a backtick-bearing needle in a quoted string, never build a regex from prose.
- Open debt (unfiled): nothing in the documented lookup chain points at `~/.claude/memory/personal.md`, so `global/memory/personal.md` is a rule the executing agent may never read. Needs a backlog id via the two-stage ceiling pipeline.
- Rejected under YAGNI: a mechanical validator that parses generated plan markdown and rejects a `git add` preceding an edit of the same path.
```

- [X] [T-002-D] Flip the backlog checkbox to done

Re-locate by heading, expecting the `[>]` state T-000-B wrote:

```bash
grep -n '^### \[>\] `\[BUG-031\]`' "AGENT-READABLE BACKLOG.md"
```

**Exactly one** match, else halt - a `[ ]` here means T-000-B never ran. Then one surgical
`Edit`, `### [>]` to `### [X]`, every byte after the checkbox unchanged. This edit lands
**before** T-002-E stages the file.

- [X] [T-002-E] Commit

```bash
npm test
git add VERSION package.json package-lock.json CHANGELOG.md "AGENT-READABLE BACKLOG.md"
git add -f .claude/memory/project.md
git add -f docs/superpowers/plans/2026-09-25-bug031-plan-step-ordering.md
git status --short   # expect exactly those seven paths
```

```bash
git commit -m "$(cat <<'MSG'
chore: release 1.27.1 [BUG-031]

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

## Test List

- [ ] Parity: the step-ordering clause appears exactly once in `.claude/commands/cc-plan.md`, counted on whitespace-normalized text with a literal `split` - Task 1
- [ ] Parity: the same clause appears exactly once in `project-template/.claude/commands/cc-plan.md` - Task 1
- [ ] Regression: the existing `differ only in the script path nesting` assertion still passes after regeneration - Task 1 (T-001-F)
- [ ] Regression: the whole `npm test` suite green at every commit (baseline 583 passed / 12 skipped, 585 after Task 1)
- [ ] Unit: none - this change adds no runtime code
- [ ] E2E: not applicable - no UI and no executable surface; the rule is prose read by the generator

## Commit Order

| Commit | Tasks | Subject |
|---|---|---|
| 1 | T-000 | `docs: add the BUG-031 plan step ordering implementation plan` |
| 2 | T-001 | `fix: order a task's staging step after the edits it captures [BUG-031]` |
| 3 | T-002 | `chore: release 1.27.1 [BUG-031]` |

Test and implementation land together - the pre-commit hook rejects a red tree, so the anchor
test is never its own commit.

## Identified Risks

| Risk | Catch |
|---|---|
| The inserted text contains a mirror-`sed` pattern, desynchronizing the anchor across mirrors. | T-001-A precondition (1) greps for both live patterns and halts on a hit. |
| The needle collides with prose already in `cc-plan.md`, producing a count of 2. | T-001-A precondition (2) counts the normalized needle before the edit, expecting 0 in both mirrors. |
| A dropped `sed -e` expression corrupts line 7 of the mirror. | T-001-E sanity grep plus T-001-F running the parity suite immediately, before any other work. |
| The template is hand-edited instead of regenerated. | The existing `differ only in the script path nesting` assertion fails. |
| A rewrap of the hard-wrapped rule breaks a verbatim anchor. | The anchor normalizes whitespace on both sides before counting. |
| `[X]` in the clause is read as a character class. | Literal `split` counting; no regex is constructed from the prose. The needle constant is single-quoted, so its backticks cannot terminate it. |
| Prose is advisory to a model, so the generator can still violate the rule. | Accepted and stated in the spec: this narrows the probability, not the possibility. Downstream detection is unchanged - a later task asserting on expected file state halts with the mismatch. |
| A future cleanup removes one side of the two-sided anchor as dead. | The test carries an inline comment saying why the redundancy is deliberate; the spec's Design Notes say the same. |
| This plan's own file quotes the needle, and plans are force-added to the repo. | No collision: the parity suite reads only the two `cc-plan.md` mirrors. Do not widen the test's file set without revisiting this. |
| The lockfile is left at the old version. | T-002-A verifies two `1.27.1` occurrences and zero `1.27.0`. |
