# FEAT-026 Implementation Plan — Guided branch creation and commit drafting at the plan gate

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one guarded branch/commit-message block to `cc-plan.md`'s `## Phase exit` and its `project-template/` mirror, so the plan commit can never silently land on the default branch again.

**Architecture:** The feature is instruction prose, not code. A `### Branch gate (runs before Task 0)` subsection is inserted at the top of `## Phase exit` in both `cc-plan.md` files; the existing "Plan complete. Run `/cc-compact`" instruction becomes the gate's last step and is otherwise unchanged. One new Vitest file locks the two invariants a test can actually reach: mirror parity (the two files differ only in `scripts/` vs `.claude/scripts/`) and block presence positioned before the exit line.

**Tech Stack:** Markdown command files; Vitest ^3.0.0 (`npm test` → `vitest run`); Node >= 20 ESM.

**Spec:** `docs/superpowers/specs/2026-09-24-feat026-guided-branch-and-commit-drafting-design.md` (revision 5, approved)

## Global Constraints

- The load-bearing guarantee is **execution order, not Markdown line position**: the block must resolve — warning, offer, confirmed `git switch` or explicit decline — before any step of the approved plan's Task 0 runs, force-add and commit included. The block's prose must say so as a precondition on Task 0.
- The two `cc-plan.md` files must continue to differ **only** in `scripts/` vs `.claude/scripts/`. The new block contains no script path, so it is byte-identical in both.
- The gate **validates** the Task 0 commit message that the approved plan already carries; it synthesizes one only when the plan carries none, and then writes the synthesis back into Task 0. A printed subject with no consumer does not satisfy the spec.
- Commit-type validation is anchored to what `CONTRIBUTING.md:37` literally says — `feat:`, `fix:`, `docs:`, `chore:` are the documented set; other shipped Conventional-Commits types pass with a note.
- The id must appear **somewhere in the subject**; bracketed suffix and inline prose both pass. A suffix-only rule would reject `docs: add the FEAT-025 retention purge implementation plan`.
- The default branch is resolved from `git symbolic-ref --short refs/remotes/origin/HEAD`, falling back to `{main, master}`. Never hardcode `main`.
- Detached HEAD (`--show-current` prints empty, exits 0) gets its own warning wording and is never read as "not on the default branch".
- Silence has exactly two conditions: exact match with the derived name, or a feature-shaped branch whose embedded id token matches the current item's id. Shape alone never buys silence; no fuzzy title matching.
- Sanitization is two rules plus one gate (lowercase/collapse, 60-char cap on a `-` boundary, then `git check-ref-format --branch`). **Do not** write per-character reject passes — rule one makes them unreachable code.
- No git write (`switch -c`, `switch`, `commit`) without explicit user confirmation. Declining is a no-op.
- `cc-spec.md` and its mirror are **not** touched. No installer or manifest edit (`deployProject` copies `project-template/.claude/` wholesale). No new script, schema, dependency, or version floor.
- Every commit must leave `npm test` green — the pre-commit hook runs the full suite and rejects otherwise. The red test in Task 1 is therefore **not** committed on its own.
- Use `git add` + plain `git commit`. Never `git commit <pathspec>`: the partial-commit temporary index makes `smoke.test.js > committed entry mode > is 100755 in git` fail falsely.
- Plan-state updates are surgical single-line checkbox edits only (BUG-003 invariant). Never rewrite this file in bulk.
- `docs/` is gitignored. Per the FEAT-005 / FEAT-024 ritual this plan file is force-added at approval (Task 0); the **spec** is not, and stays on disk only.
- The `[FEAT-026]` backlog checkbox travels `[ ]` → `[>]` at plan approval (Task 0) → `[X]` at closeout (T-003-D). The closeout edit therefore expects `[>]`, not `[ ]`.
- Commit messages end with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- VERBOSITY: MIN. Comments explain why, never what. No speculative abstractions.

## File Structure

| File | Responsibility |
|---|---|
| `.claude/commands/cc-plan.md` | Gains `### Branch gate (runs before Task 0)` as the first subsection of `## Phase exit` (currently lines 108-114). Nothing above `## Phase exit` changes. |
| `project-template/.claude/commands/cc-plan.md` | The identical block, mirrored byte-for-byte. Its three pre-existing `.claude/scripts/` lines stay as they are. |
| `tests/installer/commands-parity.test.js` | New. Asserts mirror parity by normalizing the template's script nesting, and asserts the gate's presence and position in both files. |
| `VERSION`, `package.json`, `package-lock.json`, `CHANGELOG.md`, `AGENT-READABLE BACKLOG.md` | Release closeout only (Task 3). |

**Why this test shape.** No test covers command-file *content* today — `tests/installer/templates.test.js` asserts only the `cc-stack:managed` marker on `CLAUDE.md`. Parity is the one property a test can prove mechanically; the gate's behavioral correctness lives in prose an agent executes, so the test asserts presence and ordering of the anchors that carry the behavior, and stops there rather than pretending to verify semantics.

**Branch base ruling.** `main` is at `3051ed6`; the current branch `chore/feat-025-state-closeout` holds one unpushed commit (`5a36baf`, FEAT-025 state closeout) plus an uncommitted `.claude/memory/project.md` (the FEAT-026 spec summary). That closeout **lands on `main` first**, on its own branch, before the FEAT-026 branch is opened — so a later revert of FEAT-026 can never also revert FEAT-025's closeout. The FEAT-026 branch is then cut from the current HEAD, which by that point carries the same content as `main`.

---

### Task 0: Land the FEAT-025 closeout, branch, then save the plan

**Files:**
- Modify: `.claude/memory/project.md` (already-modified, the FEAT-026 spec summary)
- Add (forced): `docs/superpowers/plans/2026-09-24-feat026-guided-branch-and-commit-drafting.md`
- Modify: `AGENT-READABLE BACKLOG.md`

**Interfaces:**
- Consumes: nothing.
- Produces: `main` carrying the FEAT-025 closeout; the branch `feat/feat-026-guided-branch-and-commit-drafting`; the committed plan file the `cc-implement` locator greps; and the `[>]` state T-003-D flips.

- [X] [T-000-A] Commit the pending session memory on the closeout branch

Two features' bookkeeping do not share one commit. The modified `.claude/memory/project.md`
is FEAT-025-session memory, so it lands on `chore/feat-025-state-closeout` beside `5a36baf`,
not on the FEAT-026 branch. `.claude/` is gitignored, so it needs `-f`.

```bash
git branch --show-current   # expect: chore/feat-025-state-closeout
git add -f .claude/memory/project.md
git commit -m "$(cat <<'MSG'
docs: checkpoint FEAT-025 session memory

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

- [X] [T-000-B] Land the closeout branch on `main`

This is an outward-facing write — **stop and confirm with the developer before running it**,
and ask which form they want. Either lands the closeout independently of FEAT-026.

```bash
# form A — PR (preferred when the repo's convention is review-per-branch)
git push -u origin chore/feat-025-state-closeout
gh pr create --base main --title "chore: close out FEAT-025 state" \
  --body "FEAT-025 plan-state closeout and session memory. No code change.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"

# form B — fast-forward main directly
git switch main && git merge --ff-only chore/feat-025-state-closeout && git push origin main
```

**Form A must not be squashed.** Merge the closeout PR fast-forward or with a merge commit.
A squash rewrites `5a36baf` and the checkpoint commit into one new hash, so the
`--contains` gate below — which matches on hashes — would report `origin/main` missing even
though the content landed.

Do not proceed to T-000-C until `main` contains both commits. Verify:

```bash
git fetch origin && git branch --contains HEAD -r
```

Expected: `origin/main` listed. If it is **not** listed and the PR was squashed anyway,
do not cut the branch from the current HEAD — the two chore commits are not on `main` and
would ride along in the FEAT-026 PR. Cut from refreshed `origin/main` instead, and note the
squash in the task report:

```bash
git log --oneline origin/main -3   # confirm the squashed closeout is there
git switch -c "feat/feat-026-guided-branch-and-commit-drafting" origin/main
```

**T-000-C is satisfied by this command; skip its `git switch -c` and continue at T-000-D.**
Running T-000-C literally afterwards would fail on the already-existing branch — safe, but a
confusing halt.

- [X] [T-000-C] Create the FEAT-026 branch before any FEAT-026 write

This is the manual execution of the very gate this plan builds: the branch resolves
**before** the force-add and the commit below. The derived name follows the spec's own rule —
stem `2026-09-24-feat026-guided-branch-and-commit-drafting-design`, date and `-design`
stripped, id token `feat026` → `feat-026`, `FEAT` → `feat/` prefix.

```bash
git switch -c "feat/feat-026-guided-branch-and-commit-drafting"
```

Expected: `Switched to a new branch 'feat/feat-026-guided-branch-and-commit-drafting'`, cut
from a HEAD whose content now matches `main`, with a clean working tree.

- [X] [T-000-D] Mark the backlog entry in progress

Re-locate by heading, never by line number. Pre-check uniqueness first:

```bash
grep -n '^### \[.\] `\[FEAT-026\]`' "AGENT-READABLE BACKLOG.md"
```

Expected: exactly one match, reading `[ ]`. Then the surgical single-line edit (BUG-003
invariant): `[ ]` becomes `[>]` on that heading, changing nothing else on the line. If the
grep returns zero or more than one match, stop and report rather than guessing.

- [>] [T-000-E] Commit the plan and the in-progress mark

`docs/` is gitignored, so the plan needs `-f`. The spec is deliberately left uncommitted.

```bash
git add -f docs/superpowers/plans/2026-09-24-feat026-guided-branch-and-commit-drafting.md
git add "AGENT-READABLE BACKLOG.md"
git commit -m "$(cat <<'MSG'
docs: add the FEAT-026 guided branch gate implementation plan

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

The subject is inline-id form, matching the only historical Task 0 precedent. The pre-commit
hook runs the full suite; it must pass before this commit lands.

---

### Task 1: The failing parity and presence test

**Files:**
- Create: `tests/installer/commands-parity.test.js`

**Interfaces:**
- Consumes: nothing from Task 0 beyond the committed plan file.
- Produces: the `cc-plan mirrors` describe block that Task 2 turns green. No exported symbols.

- [ ] [T-001-A] Write the failing test

Create `tests/installer/commands-parity.test.js` with exactly this content:

```js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8').replace(/\r\n/g, '\n');

// `deployProject` nests scripts under `.claude/scripts/` in a scaffolded project, so the
// template mirror rewrites the script paths. These two targeted substitutions are the exact
// inverse of the regeneration step, and the only sanctioned divergence between the files.
// A blanket `.claude/scripts/` rewrite would also hit prose that legitimately mentions the
// deployed layout in BOTH mirrors, and false-fail this test.
const unnest = (text) =>
  text
    .split('node .claude/scripts/').join('node scripts/')
    .split('running `.claude/scripts/').join('running `scripts/');

const MIRRORS = ['.claude/commands/cc-plan.md', 'project-template/.claude/commands/cc-plan.md'];

describe('cc-plan mirrors', () => {
  it('differ only in the script path nesting', () => {
    expect(unnest(read(MIRRORS[1]))).toBe(read(MIRRORS[0]));
  });

  it.each(MIRRORS)('%s carries the branch gate before its exit line', (rel) => {
    const text = read(rel);
    const gate = text.indexOf('### Branch gate (runs before Task 0)');
    const exit = text.indexOf('Plan complete. Run `/cc-compact`');
    expect(gate).toBeGreaterThan(-1);
    expect(exit).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(exit);
  });

  it.each(MIRRORS)('%s states the Task 0 ordering precondition', (rel) => {
    expect(read(rel)).toContain(
      "before any step of the approved plan's Task 0 executes",
    );
  });

  it.each(MIRRORS)('%s pins the exact git invocations the gate depends on', (rel) => {
    const text = read(rel);
    for (const cmd of [
      'git branch --show-current',
      'git symbolic-ref --short refs/remotes/origin/HEAD',
      'git check-ref-format --branch',
      'git rev-parse --verify --quiet',
      'git switch -c',
    ]) {
      expect(text).toContain(cmd);
    }
  });
});
```

- [ ] [T-001-B] Run it and confirm it fails

Run: `npx vitest run tests/installer/commands-parity.test.js`

Expected: the parity test **passes** (the mirrors are already in sync), and the three `it.each` blocks **fail** — six failures, the first reporting `expected -1 to be greater than -1` for `### Branch gate (runs before Task 0)`.

Do not commit here. The pre-commit hook runs the full suite and would reject a red tree.

---

### Task 2: The branch gate in both mirrors

**Files:**
- Modify: `.claude/commands/cc-plan.md` (`## Phase exit`, currently lines 108-114)
- Modify: `project-template/.claude/commands/cc-plan.md` (same section)
- Test: `tests/installer/commands-parity.test.js`

**Interfaces:**
- Consumes: the test from Task 1.
- Produces: the `### Branch gate (runs before Task 0)` subsection, byte-identical in both files.

- [ ] [T-002-A] Replace the `## Phase exit` section in `.claude/commands/cc-plan.md`

Replace these seven lines (108-114):

```markdown
## Phase exit

Once the plan is approved and saved, instruct the user:

> "Plan complete. Run `/cc-compact` now before starting implementation."

Do not proceed to implementation without user confirmation that `/cc-compact` has been run.
```

with exactly this:

```markdown
## Phase exit

### Branch gate (runs before Task 0)

Once the plan is approved and saved, work through this gate, then print the exit
instruction in step 7.

**Precondition on Task 0.** This gate runs to completion — the warning, the offer, and
either the confirmed `git switch` or an explicit decline — **before any step of the
approved plan's Task 0 executes**, including its `git add` / `git add -f` and its
`git commit`. Its position in this file is not the guarantee; the execution order is.
Under the plan-commit ritual, Task 0 runs at approval, which is exactly when a plan commit
lands on the wrong branch.

Skip the whole gate silently when `git rev-parse --git-dir` fails or `git` is absent. The
gate is advisory: it must never block a completed plan from exiting its phase.

**1. Read the current branch** — `git branch --show-current`.

Empty output with exit 0 means **detached HEAD**. Warn with its own wording — "HEAD is
detached at `<short sha>`; a commit here belongs to no branch" — and never read empty as
"not on the default branch".

**2. Resolve the default branch** — `git symbolic-ref --short refs/remotes/origin/HEAD`,
stripping the leading `origin/`. On any non-zero exit, fall back to the literal set
`{main, master}`. Never hardcode `main`. When the current branch equals it, warn: "You are
on the default branch `<name>`; the plan commit would land there."

**3. Derive the proposed branch name** from the active spec stem already in phase context
(the same value `/cc-compact` writes as `sys.s`):

- strip the leading `YYYY-MM-DD-` and the trailing `-design`;
- read the leading id token — `feat025` → `FEAT-025`, `bug029` → `BUG-029`, `arch008` → `ARCH-008`;
- prefix: `FEAT`/`ARCH` → `feat/`, `BUG` → `fix/` (`CONTRIBUTING.md:23`);
- body: the rest of the stem, with the id token re-spelled `feat-025`;
- `2026-09-22-feat025-conductor-db-retention-purge-design` → `feat/feat-025-conductor-db-retention-purge`.

If the stem is missing or `none`, fall back to a root `AGENT-READABLE BACKLOG.md`: grep it
for the id under discussion and derive from that heading's title. If neither source yields
a name, still run steps 1-2 and their warnings, then ask the developer for a name rather
than proposing one.

**Sanitize before interpolating:** lowercase; collapse non-alphanumerics to a single `-`;
trim leading and trailing `-`; cap the part after the prefix at 60 characters, truncated on
a `-` boundary; always interpolate double-quoted. Then `git check-ref-format --branch
"<name>"` is the authority — if it fails, or the sanitized name is empty, ask the developer
for a name. **Do not write per-character reject passes** for `..`, `@{`, `~`, `^`, `\`, or a
trailing `.lock`: the collapse rule already removes every one of them, so such passes are
unreachable code.

**4. Decide whether to stay silent.** Silence requires one of exactly two conditions:

- (a) the current branch equals the derived name; or
- (b) the current branch is feature-shaped (`feat/`, `fix/`, `chore/`, `docs/`) **and** the
  id token embedded in its name matches the current item's id — `feat/feat-026-…` while
  planning `FEAT-026`.

Only then: no warning, no offer — go to step 7, because firing on every plan run is noise.
In every other case, report both the current branch and the derived one and ask which to
use; never switch silently. That explicitly includes a feature-shaped branch carrying a
**different** id (`feat/feat-025-…` while planning `FEAT-026`) — shape never wins over id,
or the new plan commit lands on the previous feature's branch. A feature-shaped branch with
no extractable id token (a hand-made `feat/retention-purge`) fails (b) by design and falls
through to report-and-ask; do not substitute fuzzy title matching.

**5. Validate the Task 0 commit message from the approved plan.** The plan is the single
source of truth for that message and Task 0 runs it verbatim, so this gate **validates** —
it does not duplicate. Check the subject for:

- **Conventional-Commits shape**, anchored to what `CONTRIBUTING.md:37` literally says:
  "Commit messages follow Conventional Commits: `feat:`, `fix:`, `docs:`, `chore:`". Those
  four are the documented set; another Conventional-Commits type this repository has shipped
  (`test:`, `ci:`, `refactor:`) passes with a note, since `CONTRIBUTING.md` neither lists nor
  forbids it.
- **The id appears somewhere in the subject.** Bracketed suffix (`feat: bound raw_history
  with the shared retention purge [FEAT-025]`) and inline prose (`docs: add the FEAT-025
  retention purge implementation plan`) both pass. Do not demand the suffix.

Report a malformed or absent message **before Task 0 begins**, proposing the corrected
subject, so the plan is fixed at its source rather than patched at commit time.

**Synthesize a message only when the plan carries none:** `<type>: <imperative summary>
[<ID>]` — the suffix form, chosen for synthesis because it is unambiguous to generate; `type`
is `docs` for a plan commit, since the plan file is documentation. On confirmation, write the
synthesized message into the plan's Task 0 commit step; never hold it only in this gate.

**6. Ask once, then act.** Present a single confirmation covering the current branch, the
warning if one applies, the proposed branch name, and the validated or corrected Task 0
subject.

- Pre-check with `git rev-parse --verify --quiet "refs/heads/<name>"` before offering `-c`.
  If the ref already exists, offer `git switch "<name>"` without `-c` instead, and name the
  distinction in the prompt.
- On **yes**: run `git switch -c "<name>"` (or the plain `git switch "<name>"`) and report
  the resulting branch.
- On **no**: print nothing further and continue. Declining is a no-op and the workflow
  proceeds exactly as it did before this gate existed.
- No git write — `switch -c`, `switch`, or `commit` — happens without this explicit
  confirmation.
- If `git switch` refuses because a tracked file would be overwritten, report git's own
  message verbatim and stop. Do not stash, do not force, do not retry.
- Any other git failure: warn once and continue to step 7.

**7. Exit.** Only now instruct the user:

> "Plan complete. Run `/cc-compact` now before starting implementation."

Do not proceed to implementation without user confirmation that `/cc-compact` has been run.
```

- [ ] [T-002-B] Mirror the same block into the template

Apply the identical replacement to `project-template/.claude/commands/cc-plan.md`. The block
contains no script path, so it is byte-identical; do not adjust anything inside it. The
file's three pre-existing `.claude/scripts/` references live above `## Phase exit` and are
untouched.

Fastest safe form — copy the repo file and re-nest the script paths, which is exactly the
invariant the parity test encodes:

```bash
node -e '
const fs=require("node:fs");
const src=fs.readFileSync(".claude/commands/cc-plan.md","utf8");
fs.writeFileSync("project-template/.claude/commands/cc-plan.md",
  src.split("node scripts/").join("node .claude/scripts/")
     .split("running `scripts/").join("running `.claude/scripts/"));
'
git diff --stat project-template/.claude/commands/cc-plan.md
```

Then verify the divergence is still exactly the three known lines:

```bash
diff .claude/commands/cc-plan.md project-template/.claude/commands/cc-plan.md
```

Expected: three changed lines, all `scripts/resume-read.mjs` → `.claude/scripts/resume-read.mjs`.

- [ ] [T-002-C] Run the new test and confirm it passes

Run: `npx vitest run tests/installer/commands-parity.test.js`

Expected: PASS, 7 tests.

- [ ] [T-002-D] Run the full suite

Run: `npm test`

Expected: the pre-existing 522 passed / 12 skipped, plus the 7 new tests — 529 passed / 12 skipped.

- [ ] [T-002-E] Commit

```bash
git add .claude/commands/cc-plan.md project-template/.claude/commands/cc-plan.md tests/installer/commands-parity.test.js
git commit -m "$(cat <<'MSG'
feat: gate the plan commit behind a branch and commit-message check [FEAT-026]

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 3: Release closeout

**Files:**
- Modify: `VERSION`, `package.json`, `package-lock.json`, `CHANGELOG.md`, `AGENT-READABLE BACKLOG.md`

**Interfaces:**
- Consumes: the merged behavior from Task 2.
- Produces: version `1.26.0` and the `[X]` backlog state.

- [ ] [T-003-A] Bump the version

`VERSION` → `1.26.0`. `package.json` `"version"` → `1.26.0`. Then regenerate the lockfile's
two self-referential version fields:

```bash
npm install --package-lock-only --ignore-scripts
```

- [ ] [T-003-B] Add the changelog entry

Insert directly under `# Changelog`, above `## [1.25.0] - 2026-09-24`:

```markdown
## [1.26.0] - 2026-09-24

### Added

- **[FEAT-026]** A branch gate at the `/cc-plan` phase exit. Before any step of the approved plan's Task 0 runs — force-add and commit included — the agent reads `git branch --show-current`, resolves the default branch from `refs/remotes/origin/HEAD` (falling back to `{main, master}`, never hardcoded), and warns when HEAD sits on it or is detached. It derives a conventional branch name from the active spec stem (`2026-09-22-feat025-…-design` → `feat/feat-025-conductor-db-retention-purge`), sanitizes it and defers to `git check-ref-format`, and validates the commit message the plan's own Task 0 already carries against `CONTRIBUTING.md`'s Conventional-Commits rule, synthesizing one only when the plan has none. Staying silent requires an exact branch-name match or a feature-shaped branch whose embedded id matches the current item — shape alone is not enough. Every git write stays behind an explicit confirmation; declining is a no-op, and an absent repository or any git failure skips the gate without blocking the phase exit.
```

- [ ] [T-003-C] Run the full suite

Run: `npm test`

Expected: 529 passed / 12 skipped.

- [ ] [T-003-D] Flip the backlog entry to complete

Re-locate by heading, never by line number. Pre-check uniqueness first:

```bash
grep -n '^### \[.\] `\[FEAT-026\]`' "AGENT-READABLE BACKLOG.md"
```

Expected: exactly one match, reading `[>]`. Then the surgical single-line edit (BUG-003
invariant): `[>]` → `[X]` on that heading, changing nothing else on the line. The entry was
left at `[>]` by **T-000-D**; if it still reads `[ ]`, stop — the plan-approval step did not
run. If the grep returns zero or more than one match, stop and report rather than guessing.

- [ ] [T-003-E] Commit the release

```bash
git add VERSION package.json package-lock.json CHANGELOG.md "AGENT-READABLE BACKLOG.md"
git commit -m "$(cat <<'MSG'
chore: release 1.26.0

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

## Test List

- [ ] [T-T01] Unit: the two `cc-plan.md` files differ only in `scripts/` vs `.claude/scripts/` (`tests/installer/commands-parity.test.js`).
- [ ] [T-T02] Unit: both files contain `### Branch gate (runs before Task 0)` positioned before the `Plan complete. Run /cc-compact` line.
- [ ] [T-T03] Unit: both files contain the Task 0 ordering precondition sentence.
- [ ] [T-T04] Unit: both files pin the five exact git invocations the gate depends on.
- [ ] [T-T05] Integration: none. The gate has no code seam — it is prose the agent executes.
- [ ] [T-T06] E2E: none. No UI.
- [ ] [T-T07] Live verification (recorded in the task report, not automated): the gate's first real execution is **the next `/cc-plan` approval after this plan ships** — no throwaway rehearsal. On that run, confirm the branch offer is reached before Task 0's force-add and commit, and that declining still precedes them; record the observed order, the derived name, and the validated subject in the task report. This is the only check that exercises the load-bearing acceptance criterion.

## Commit Order

1. **T-000-A** — `docs: checkpoint FEAT-025 session memory` (the pending `project.md`), on `chore/feat-025-state-closeout`; landed on `main` by T-000-B before FEAT-026 opens.
2. **T-000-E** — `docs: add the FEAT-026 guided branch gate implementation plan` (plan file, backlog `[>]`), on the branch created by T-000-C.
3. **T-002-E** — `feat: gate the plan commit behind a branch and commit-message check [FEAT-026]` (both mirrors + the new test, committed together because the pre-commit hook rejects a red tree).
4. **T-003-E** — `chore: release 1.26.0` (version, lockfile, changelog, backlog `[X]`).

## Identified Risks

- **The block satisfies the letter and misses the intent.** An implementer can place the block before the exit line and still write prose that reads as "print this at phase exit", which would fire after Task 0 has already committed. T-002-A's precondition paragraph is the mitigation, and T-T03 asserts the sentence survives. Neither proves execution order — T-T07's live verification on the next real plan approval is the only real check. Catch it early by reading the inserted block top-to-bottom before running the suite.
- **Mirror drift.** Hand-editing the template instead of regenerating it from the repo copy is how the three-line divergence grows to four. T-002-B regenerates rather than re-types, and T-T01 fails the build if it drifts.
- **The parity test can pass vacuously.** If both files lost the gate, T-T01 would still be green. T-T02/T-T03/T-T04 are the presence anchors that keep parity from being the only assertion.
- **Ordering of T-000-B.** If the closeout is not on `main` before the FEAT-026 branch opens, the FEAT-026 PR silently carries `5a36baf` and a revert of FEAT-026 would also revert FEAT-025's closeout. T-000-B's `git branch --contains HEAD -r` check is the gate; do not skip it because the push "looked fine".
- **T-000-B is an outward-facing write.** Push and PR creation both leave this machine. Confirm the form with the developer before running either; never force-push.
- **`package-lock.json` churn.** `npm install --package-lock-only` can touch more than the two version fields if the registry has moved. Review `git diff package-lock.json` before T-003-E and revert anything beyond the version bump.
- **Line-number anchors.** `## Phase exit` is at line 108 today. Re-locate it by heading, never by line number.
