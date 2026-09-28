# BUG-040 Staging Convention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `git add` exiting 1 on a tracked file under `.claude/` from breaking chained steps, by prescribing a staging form that branches on tracked-ness, and pin both the convention and the git contract it rests on with tests.

**Architecture:** Prose only. Four documents gain a rule; one new test file pins the git contract those rules depend on and asserts the rules are present. No source module changes, no installer surface, no shipped behavior change.

**Tech Stack:** Markdown agent instructions, vitest, `git` via `spawnSync`.

**Spec:** `docs/superpowers/specs/2026-09-28-bug040-staging-convention-design.md`

## Global Constraints

- **The branch is on tracked-ness, not on the ignore rule.** `git add -u` exits 128 on an untracked path with or without an ignore rule present.
- **Never prescribe an unconditional `-u` in a global command.** `/cc-checkpoint` runs in managed projects, which do not ignore `.claude/`, and whose `project.md` may be untracked on a fresh scaffold.
- **Never make `-f` the blanket form.** It overrides the ignore rule, so a typo naming a genuinely ignored file stages it silently.
- **Always pass an explicit path.** Bare `git add -u` stages every modified tracked file in the repository.
- No em-dashes in any authored output. Plain ASCII `[ ]` in every generated checkbox.
- Every commit ends with the two attribution lines.
- BUG-003 invariant: plan state updates are surgical single-line edits.
- `docs/` is gitignored, so Task 0 stages with `git add -f`.
- Commits use `git commit -F <file>`: Guard 3 denies a `cat` heredoc inside a compound command (P4).

**Measured baseline before Task 0: 849 passed, 12 skipped, 33 files (32 passed, 1 skipped).**

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `tests/unit/staging-convention.test.js` | create | The git contract (4 cases) and the prose anchors (4 cases) |
| `CLAUDE.md` | modify | The durable home of the rule and its reasons |
| `.claude/commands/cc-plan.md` | modify | Generated plans emit the correct staging form |
| `project-template/.claude/commands/cc-plan.md` | modify | Identical mirror, parity-enforced |
| `global/commands/cc-checkpoint.md` | modify | Branch-aware staging line where none exists today |
| `VERSION`, `package.json`, `CHANGELOG.md` | modify | Release 1.31.1, both version files together |
| `.claude/memory/project.md`, `AGENT-READABLE BACKLOG.md` | modify | Record and closure, on `main`, owner-scoped |

---

## Task 0: Commit the plan

- [X] [T-000-A] Stage the plan file

```bash
git add -f docs/superpowers/plans/2026-09-28-bug040-staging-convention.md
```

**Deliberate:** this step uses `git add -f` because `docs/` is ignored and the plan file is new, which is precisely the second branch of the convention this plan implements. The convention's first use is the plan's own first commit. Noted here so a reader sees it as dogfooding rather than as an exception to the rule being written.

- [X] [T-000-B] Commit

Message subject: `docs: add the BUG-040 staging-convention implementation plan`

---

## Task 1: Pin the git contract

**Files:**
- Create: `tests/unit/staging-convention.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `mkRepo(ignoreBody, { track })` and `add(dir, args)`, file-local helpers reused by Task 3's prose cases.

**These four cases pass on their first run, and that is correct.** They characterize `git`'s behavior, not this repository's code, so there is no red state to produce. Their value is as a tripwire: if a future git changes the contract, the convention's reason for existing fails loudly here instead of silently rotting in prose.

- [X] [T-001-A] Write the git-contract cases

Create `tests/unit/staging-convention.test.js`:

```js
// BUG-040. The convention in CLAUDE.md rests on four facts about `git add`.
// These cases pin those facts, so the rule cannot outlive its own justification.
import { describe, it, expect, afterEach } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8').replace(/\r\n/g, '\n')
const TARGET = 'box/memory/notes.md'

const trees = []
afterEach(() => { while (trees.length) { try { rmSync(trees.pop(), { recursive: true, force: true }) } catch {} } })

// `track: true` commits the target and then modifies it, which is the shape of
// every real reproduction: a TRACKED, MODIFIED file under an ignored ancestor.
function mkRepo(ignoreBody, { track }) {
  const dir = mkdtempSync(join(tmpdir(), 'staging-'))
  trees.push(dir)
  const g = (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  g(['init', '-q'])
  g(['config', 'user.email', 't@t.t'])
  g(['config', 'user.name', 'T'])
  mkdirSync(join(dir, 'box', 'memory'), { recursive: true })
  writeFileSync(join(dir, '.gitignore'), ignoreBody, 'utf8')
  writeFileSync(join(dir, 'seed.txt'), 'seed\n', 'utf8')
  writeFileSync(join(dir, TARGET), 'v1\n', 'utf8')
  g(['add', '.gitignore', 'seed.txt'])
  if (track) g(['add', '-f', TARGET])
  g(['commit', '-q', '-m', 'init'])
  if (track) writeFileSync(join(dir, TARGET), 'v2\n', 'utf8')
  return dir
}

function add(dir, args) {
  const r = spawnSync('git', ['add', ...args], { cwd: dir, encoding: 'utf8' })
  const s = spawnSync('git', ['diff', '--cached', '--name-only'], { cwd: dir, encoding: 'utf8' })
  return {
    status: r.status,
    stderr: r.stderr || '',
    staged: (s.stdout || '').trim().split('\n').filter(Boolean),
  }
}

describe('the git contract the staging convention rests on', () => {
  it('AC5: -u on a tracked file under an ignored ancestor exits 0 and stages it', () => {
    // The five reproductions' scenario, end to end.
    const r = add(mkRepo('box/\n', { track: true }), ['-u', TARGET])
    expect(r.status).toBe(0)
    expect(r.staged).toEqual([TARGET])
  })

  it('AC6: plain add on the same file exits 1 AND stages it, which is the defect', () => {
    // Pins the disease, not only the cure: if a future git stops lying here, this
    // fails and the convention's reason for existing is re-examined deliberately.
    const r = add(mkRepo('box/\n', { track: true }), [TARGET])
    expect(r.status).toBe(1)
    expect(r.staged).toEqual([TARGET])
    expect(r.stderr).toContain('ignored by one of your .gitignore files')
  })

  it('AC7: -u on an untracked path exits 128 and stages nothing', () => {
    const r = add(mkRepo('box/\n', { track: false }), ['-u', TARGET])
    expect(r.status).toBe(128)
    expect(r.staged).toEqual([])
    expect(r.stderr).toContain('did not match any file(s) known to git')
  })

  it('AC8: -u on an untracked path exits 128 with NO ignore rule too, so the branch is tracked-ness', () => {
    const clean = mkRepo('unrelated/\n', { track: false })
    const viaU = add(clean, ['-u', TARGET])
    expect(viaU.status).toBe(128)
    expect(viaU.staged).toEqual([])
    // ...and plain add is the CORRECT command there, which is why a global
    // command must never prescribe an unconditional -u.
    const plain = add(mkRepo('unrelated/\n', { track: false }), [TARGET])
    expect(plain.status).toBe(0)
    expect(plain.staged).toEqual([TARGET])
  })
})
```

- [X] [T-001-B] Run the new file

Run: `npx vitest run tests/unit/staging-convention.test.js`
Expected: PASS, 4 cases. If AC6 fails, git's contract has changed and the spec is re-opened before any prose is written.

- [X] [T-001-C] Run the full suite

Run: `npx vitest run`
Expected: **853 passed, 12 skipped**, 34 files.

- [X] [T-001-D] Commit

Message subject: `test: pin the git add contract the staging convention rests on [BUG-040]`

**Predicted state at the T-001 boundary: 853 passed, 12 skipped, 34 files.**

---

## Task 2: The convention prose

**Files:**
- Modify: `CLAUDE.md`, `.claude/commands/cc-plan.md`, `project-template/.claude/commands/cc-plan.md`, `global/commands/cc-checkpoint.md`

**Interfaces:**
- Consumes: the four facts Task 1 pinned.
- Produces: the anchor strings Task 3 asserts on.

- [X] [T-002-A] Add the rule to `CLAUDE.md`

Insert a new section immediately after `## Hard Constraints`:

```markdown
## Staging Convention

`.gitignore:7` excludes `.claude/` wholesale, and `git add` exits 1 whenever a pathspec matches an ignored ancestor, whether or not the file itself staged correctly. The exit code describes the warning, never the outcome. Stage by tracked-ness, always with an explicit path:

- **Tracked file: `git add -u <path>`.** `-u` operates only on paths already in the index, so it never consults the ignore rule and exits 0. It fails loudly with rc 128 when the path is not tracked, which is exactly the signal the ignore rule exists to give.
- **New file under an ignored directory: `git add -f <path>`.** `-u` cannot stage a file git has never seen, and `-f` is a deliberate assertion about one specific path.
- **New file anywhere else: plain `git add <path>`.** Correct and sufficient; there is no ignored ancestor to trip over.

Never make `-f` the blanket form: it overrides the ignore rule, so a typo naming a genuinely ignored file stages it silently. Never omit the path from `-u`: bare `git add -u` stages every modified tracked file in the repository. `tests/unit/staging-convention.test.js` pins all four facts this rule rests on.
```

- [X] [T-002-B] Add the staging-form clause to `.claude/commands/cc-plan.md`

Insert as a sibling bullet directly after the `**Step ordering within a task.**` bullet that ends `...pointing at the wrong task.` (currently `:100`), inside the same `## Ordered Steps` list:

```markdown
- **Staging form within a step.** Where a staged path sits under a directory the repository
  ignores, plain `git add <path>` exits 1 even when a tracked file staged correctly, because
  the pathspec matched the ignored ancestor. Generate `git add -u <path>` when the file is
  already tracked, `git add -f <path>` when it is new and under an ignored directory, and
  plain `git add <path>` otherwise. Always generate an explicit path: bare `git add -u`
  stages every modified tracked file in the repository. The branch is on tracked-ness, never
  on habit, because `-u` exits 128 on an untracked path whether or not an ignore rule exists.
```

This is a sibling of the ordering rule, not a replacement: that bullet governs *where* a staging step sits, this one governs *which form* it takes. The ordering bullet already enumerates `-f` and `-u` among the forms it covers, so the two do not contradict.

- [X] [T-002-C] Correct the branch gate's form enumeration in `.claude/commands/cc-plan.md`

In the Task 0 precondition paragraph (currently `:128-129`), replace:

```
**before any step of the approved plan's Task 0 executes**, including its `git add` /
`git add -f` and its `git commit`.
```

with:

```
**before any step of the approved plan's Task 0 executes**, including its `git add`,
`git add -u` or `git add -f` and its `git commit`.
```

Accuracy only: the gate enumerates the forms a Task 0 might run, and `-u` is now one of them. Leaving it would imply plans only ever use the two older forms.

- [X] [T-002-D] Mirror both edits into `project-template/.claude/commands/cc-plan.md`

Apply T-002-B and T-002-C verbatim. The mirror carries no `node .claude/scripts/` path in either inserted block, so the `unnest` transform is a no-op on them and the two files stay transform-equivalent.

- [X] [T-002-E] Add the branch-aware staging line to `global/commands/cc-checkpoint.md`

Insert directly after the `**Update `.claude/memory/project.md`** (append only, never delete)` bullet list (currently ending `:15`), before the `**Update `.claude/memory/personal.md`**` block:

```markdown
**Staging that update, where the workflow commits it:** stage by tracked-ness, with an explicit path. A `project.md` that is already tracked takes `git add -u ".claude/memory/project.md"`; one that is not yet tracked takes plain `git add ".claude/memory/project.md"`, or `git add -f` where the project ignores `.claude/`. **Never an unconditional `-u` here.** This command is global and also runs in freshly scaffolded projects, which do not ignore `.claude/` and whose `project.md` is not yet tracked: there `-u` exits 128 and would halt the checkpoint before its DB tail, trading a defect those projects never had for one they would.
```

`personal.md` is local-only and never committed, so the line deliberately covers `project.md` alone.

- [X] [T-002-F] Verify the cc-plan mirrors still agree

Run: `npx vitest run tests/installer/commands-parity.test.js -t "cc-plan mirrors"`
Expected: PASS. A failure here means T-002-D diverged from T-002-B or T-002-C.

- [X] [T-002-G] Run the full suite

Run: `npx vitest run`
Expected: **853 passed, 12 skipped**, 34 files. Unchanged from T-001: this task adds prose only.

- [X] [T-002-H] Commit

Message subject: `docs: stage by tracked-ness, not by habit [BUG-040]`

**Predicted state at the T-002 boundary: 853 passed, 12 skipped, 34 files.**

---

## Task 3: Pin the prose

**Files:**
- Modify: `tests/unit/staging-convention.test.js`

**Interfaces:**
- Consumes: `read` from Task 1, and the anchor strings Task 2 wrote.
- Produces: nothing.

- [X] [T-003-A] Append the prose-anchor cases

Append to `tests/unit/staging-convention.test.js`, after the existing `describe` block:

```js
describe('the convention is documented where it is needed', () => {
  it('AC1: CLAUDE.md carries both branches, each with its reason', () => {
    const t = read('CLAUDE.md')
    expect(t).toContain('git add -u <path>')
    expect(t).toContain('git add -f <path>')
    expect(t).toContain('never consults the ignore rule')      // the -u reason
    expect(t).toContain('cannot stage a file git has never seen') // the -f reason
    expect(t).toContain('Never make `-f` the blanket form')
    expect(t).toContain('bare `git add -u` stages every modified tracked file')
  })

  it.each([
    '.claude/commands/cc-plan.md',
    'project-template/.claude/commands/cc-plan.md',
  ])('AC2/AC3: %s tells generated plans which form to emit', (rel) => {
    const t = read(rel)
    expect(t).toContain('**Staging form within a step.**')
    expect(t).toContain('`git add -u <path>` when the file is')
    expect(t).toContain('The branch is on tracked-ness')
    // The ordering rule it sits beside must survive intact.
    expect(t).toContain('**Step ordering within a task.**')
  })

  it('AC4: cc-checkpoint branches, and forbids the unconditional form by name', () => {
    const t = read('global/commands/cc-checkpoint.md')
    expect(t).toContain('git add -u ".claude/memory/project.md"')
    expect(t).toContain('Never an unconditional `-u` here')
    expect(t).toContain('freshly scaffolded projects')
    // A global command must not prescribe -u for the untracked case.
    expect(t).toContain('takes plain `git add ".claude/memory/project.md"`')
  })
})
```

- [X] [T-003-B] Run the file

Run: `npx vitest run tests/unit/staging-convention.test.js`
Expected: PASS, 8 cases (4 contract plus 4 prose).

- [X] [T-003-C] Run the full suite

Run: `npx vitest run`
Expected: **857 passed, 12 skipped**, 34 files.

- [X] [T-003-D] Commit

Message subject: `test: pin the staging convention's prose in all four homes [BUG-040]`

**Predicted state at the T-003 boundary: 857 passed, 12 skipped, 34 files.**

---

## Task 4: Release 1.31.1

**Files:**
- Modify: `VERSION`, `package.json`, `CHANGELOG.md`

**Both version files move together.** `1.31.0` shipped with `VERSION` still reading `1.30.0` because a plan step named only `package.json`. That is why this task has two separate edit steps and a step that asserts they agree.

- [X] [T-004-A] Edit `VERSION` to `1.31.1` (single line plus trailing newline)

- [X] [T-004-B] Edit `"version"` in `package.json:3` to `1.31.1`

- [X] [T-004-C] Verify the two agree

Run: `node -e "const v=require('fs').readFileSync('VERSION','utf8').trim(); const p=require('./package.json').version; console.log(v, p, v===p)"`
Expected: `1.31.1 1.31.1 true`. A `false` here is the 1.31.0 defect repeating and halts the task.

- [X] [T-004-D] Add the CHANGELOG entry above the `## [1.31.0]` heading

```markdown
## [1.31.1] - 2026-09-28

### Fixed
- `[BUG-040]` Staging convention: `git add` exits 1 whenever a pathspec matches an ignored ancestor, whether or not the file staged correctly, so a tracked file under `.claude/` broke every `&&` chain that followed it. The convention now branches on tracked-ness: `git add -u <path>` for a tracked file, `git add -f <path>` for a new one under an ignored directory, plain `git add <path>` otherwise, always with an explicit path. Recorded in `CLAUDE.md`, applied in `/cc-plan`'s generation rules and `/cc-checkpoint`. No shipped behavior changes: managed projects do not ignore `.claude/` and never had the defect.

### Added
- `[BUG-040]` `tests/unit/staging-convention.test.js`: pins the four facts about `git add` the convention rests on, including the defect itself, so the rule cannot outlive its justification.
```

- [X] [T-004-E] Run the full suite

Run: `npx vitest run`
Expected: **857 passed, 12 skipped**, 34 files.

- [X] [T-004-F] Commit

Message subject: `chore: release 1.31.1 [BUG-040]`

**Predicted state at the T-004 boundary: 857 passed, 12 skipped, 34 files.**

---

## Task 5: Record and close, on `main`

Both steps land on `main` under the owner-scoped memory-and-backlog exception, never on the feature branch. Per the rule recorded at the `[BUG-038]` closeout, this task needs the plan's checkbox state committed before the switch, and a rebase with a content gate after the merge.

- [X] [T-005-A] Commit the plan's checkbox state on the feature branch

Stage with `git add -f` (the plan file is tracked in this branch but `docs/` is ignored, so `-u` also works; `-f` matches Task 0 and is what the branch gate expects). Subject: `docs: record the executed BUG-040 plan state`.

- [X] [T-005-B] Append the implementation record to `.claude/memory/project.md`

Cover: the measured boundaries against their predictions; the pre-flight finding that bare `git add -u` stages every modified tracked file, which is why the convention requires an explicit path; and the confirmation that AC6 passed, meaning git still lies.

- [X] [T-005-C] Flip `[BUG-040]` to `[X]` in `AGENT-READABLE BACKLOG.md` and add a DONE bullet naming the release, the plan path and the task count

- [X] [T-005-D] Stage and commit both, on `main`

Stage with `git add -u ".claude/memory/project.md" "AGENT-READABLE BACKLOG.md"`. Both files are tracked, so this is the convention's first real use after it is written, and it must exit **0**. If it exits 1, the convention is wrong and the task halts.

**Predicted state at the T-005 boundary: 857 passed, 12 skipped, 34 files.**

---

## Test List

- [ ] `tests/unit/staging-convention.test.js` +4 (new file): `-u` on a tracked file under an ignored ancestor exits 0; plain add exits 1 and still stages; `-u` on an untracked path exits 128; `-u` exits 128 with no ignore rule while plain add exits 0.
- [ ] `tests/unit/staging-convention.test.js` +4: `CLAUDE.md` carries both branches with reasons; both `cc-plan` mirrors carry the staging-form clause beside the surviving ordering rule; `cc-checkpoint` branches and forbids the unconditional form by name.
- [ ] `tests/installer/commands-parity.test.js` 0 new, must continue to pass unchanged.

Integration seam: T-005-D is the live integration test. The convention stages its own closing commit.

## Commit Order

| Commit | Steps | Subject |
|---|---|---|
| 1 | T-000-A..B | `docs: add the BUG-040 staging-convention implementation plan` |
| 2 | T-001-A..D | `test: pin the git add contract the staging convention rests on [BUG-040]` |
| 3 | T-002-A..H | `docs: stage by tracked-ness, not by habit [BUG-040]` |
| 4 | T-003-A..D | `test: pin the staging convention's prose in all four homes [BUG-040]` |
| 5 | T-004-A..F | `chore: release 1.31.1 [BUG-040]` |
| 6 | T-005-A | `docs: record the executed BUG-040 plan state` |
| 7 | T-005-B..D | record and closure, on `main`, owner-scoped |

Every staging step follows every edit step in its own commit group.

## Identified Risks

**Risk 1. The mirrors drift.** T-002-B and T-002-C edit `.claude/commands/cc-plan.md`; T-002-D must reproduce both verbatim. Detection: T-002-F runs the mirror case alone before the full suite, so a divergence surfaces before anything else can mask it.

**Risk 2. An anchor string in Task 3 does not match the prose Task 2 wrote.** The prose cases assert on exact substrings. Detection: T-003-B. Remedy is to correct the *anchor* to the prose, never to loosen the assertion, unless the prose itself is wrong.

**Risk 3. AC6 fails because git's contract changed.** This is the tripwire working. It halts Task 1 and re-opens the spec rather than being patched around: if plain `git add` no longer lies, the convention needs a different justification, not a weaker test.

**Risk 4. The cc-checkpoint line lands in the wrong place relative to the DB tail.** The tail derives `c` from `git rev-parse HEAD` and runs after the `project.md` append. If a checkpoint commit is introduced before the tail, `c` becomes the checkpoint commit rather than its parent. **This plan does not introduce a commit step**, only the staging form for one the workflow already performs, so the ordering is unchanged. Recorded because the full read surfaced it and the next person to add a commit step there needs to decide it deliberately.

**Risk 5. Bare `git add -u` in a future generated step.** It stages every modified tracked file in the repository, quietly widening a commit. The convention requires an explicit path in all three homes, and the `CLAUDE.md` anchor asserts that sentence is present.

**Risk 6. `1.31.1` ships with the version files disagreeing again.** T-004-C asserts equality between `VERSION` and `package.json` and halts the task on a mismatch. A test asserting the same thing permanently is named as a follow-up on PR #33 and is out of scope here.

**Tripwire convention.** Every boundary above states a predicted count: 849, 853, 853, 857, 857, 857. Any off-by-one reconciles before the next line of prose is written.
