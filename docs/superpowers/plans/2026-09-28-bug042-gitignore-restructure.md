# BUG-042 gitignore Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `.gitignore`'s two wholesale directory excludes with root-anchored, leaf-enumerated re-include blocks, so `git add` exits honestly in both directions at both sites, and pin the enumeration to the git index with a drift test.

**Architecture:** One delimited block in `.gitignore` holds every rule for the two tracked surfaces. It is deny-by-default: the root's contents are excluded, each directory holding tracked files is re-included then re-excluded, and every tracked file is named. Two new unit tests pin it: one computes the block from `git ls-files` and asserts exact equality including order, the other asserts an ignored-XOR-tracked invariant per `PROJECT_HOST_OWNED` row. Both carry deliberate-defect confirmations.

**Tech Stack:** git ignore semantics (last-match-wins), Node 22, vitest 3.2.6.

**Spec:** `docs/superpowers/specs/2026-09-28-bug042-gitignore-restructure-design.md`

## Global Constraints

- Version target: **1.32.1**, PATCH, ratified. Five locations: `VERSION`, `package.json`, `package-lock.json` (two fields), `CHANGELOG.md`.
- Staging convention (`CLAUDE.md`): `git add -u <path>` tracked, `git add -f <path>` new under an ignored directory, plain `git add <path>` otherwise. **Always an explicit path.**
- Never bypass the pre-commit hook. It runs the full suite on every commit, so **no commit may be made while any predicted red is outstanding**; reds are observed with `npx vitest run` inside a task and cleared before that task's commit step.
- BUG-003 invariant: plan and tracking state updates are surgical single-line edits.
- No em-dashes in authored output.
- Commit trailers: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` then `Claude-Session: https://claude.ai/code/session_01HLS5KAHkhpMChyqNTbqrhe`.
- Branch: `fix/bug-042-gitignore-restructure`, created by the branch gate before Task 0 runs.

## Baseline

Measured at `eaaa077` by the pre-commit hook on the spec commit: **902 passed / 12 skipped, 33 test files passed / 1 skipped (34 files, 914 tests).** Every boundary below is stated against this.

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `.gitignore` | modify | The two blocks, the comment header carrying the toll, the retained external-writer lines below the END marker |
| `tests/unit/gitignore-block-parity.test.js` | create | AC9, AC10: block equals `git ls-files`, in order, with the removed-leaf discriminator |
| `tests/unit/host-owned-ignore-xor.test.js` | create | AC11, AC12: ignored XOR tracked per row, with both flip discriminators |
| `CLAUDE.md` | modify | AC16, AC17: clause 1's justification rewritten, clauses 2 and 3 kept with live cases, the anchoring note |
| `docs/superpowers/specs/...-bug042-...-design.md` | modify | Two factual corrections folded in at Task 0 (see T-001) |
| `CHANGELOG.md`, `VERSION`, `package.json`, `package-lock.json` | modify | 1.32.1 |
| `AGENT-READABLE BACKLOG.md` | modify | AC19: close `[BUG-042]`, add the external-writer sibling concern to `[BUG-046]` |
| `.claude/memory/project.md` | modify | Implementation record and closeout |

**Files deliberately NOT touched:** `project-template/gitignore` (three lines, no `.claude/` or `docs/` rule; touching it would make this MINOR), `lib/installer/*`, `tests/unit/staging-convention.test.js` (AC18 asserts it passes unchanged).

## The self-reference, and why Task 0 must run first

The plan file lives at `docs/superpowers/plans/`, inside one of the two surfaces the block enumerates. **The block must be generated from an index that already contains the plan**, or the very first post-restructure commit would fail AC9 by omitting the plan's own leaf. Task 0 therefore commits the plan, and T-002 generates the block afterwards from `git ls-files`. This is the BUG-044 collision in a milder form: the ordering is not one of several that work, it is the only one that never passes through a state where the item's own artifacts violate the item's own rule.

The spec (`eaaa077`) is already in the index and needs no such handling.

---

### Task 0: Commit the plan

**Files:**
- Create: `docs/superpowers/plans/2026-09-28-bug042-gitignore-restructure.md`
- Modify: `docs/superpowers/specs/2026-09-28-bug042-gitignore-restructure-design.md`

**Interfaces:**
- Produces: the plan's own tracked path, which T-002's generator must pick up.

- [X] **[T-000-A] Step 1: Fold the two spec corrections into this commit**

Both are already applied in the working tree and ride here rather than amending `eaaa077`, per the standing rule that amending requires an explicit go-ahead.
1. The `.claude/` block header said "21 rule lines"; it is **19** (1 root exclusion + 3 directories x 2 lines + 12 leaves).
2. The `docs/` block said "44 in total"; the count is whatever `git ls-files docs` reports at generation time and is now stated as such, because any number written into the spec is stale before implementation starts.

- [X] **[T-000-B] Step 2: Stage both files**

```bash
git add -f docs/superpowers/plans/2026-09-28-bug042-gitignore-restructure.md
git add -f docs/superpowers/specs/2026-09-28-bug042-gitignore-restructure-design.md
```

Both paths sit under `docs/`, which is still wholesale-ignored at this point, so `-f` is correct for the new plan and, because the spec is already tracked, `-u` would also work for it; `-f` is used for both here to keep one form while the ignore rule is still the broken one. **This is the last task in which `-f` is needed for a file that is already tracked**, which is the item's own epitaph and is recorded at closeout.

- [X] **[T-000-C] Step 3: Commit**

```bash
git commit -m "docs: add the BUG-042 gitignore restructure implementation plan [BUG-042]" \
  -m "Task 0 must precede the block generation: the plan file lives under docs/superpowers/plans/, one of the two surfaces the block enumerates, so the block has to be computed from an index that already contains it." \
  -m "Two spec corrections ride along rather than amending eaaa077: the .claude block is 19 rule lines not 21, and the docs leaf count is whatever git ls-files reports at generation time rather than a fixed 44." \
  -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HLS5KAHkhpMChyqNTbqrhe"
```

Expected: the pre-commit hook runs the suite and reports **902 passed / 12 skipped**, unchanged from baseline. A different number here is a tripwire: nothing in this task touches code.

---

### Task 1: The block and its parity test

**Files:**
- Create: `tests/unit/gitignore-block-parity.test.js`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: the index state after Task 0.
- Produces: `expectedBlock(sites)` and `readBlock()`, exported from the test file so the discriminator cases can call them with mutated input.

- [X] **[T-001-A] Step 1: Write the parity test**

Create `tests/unit/gitignore-block-parity.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BEGIN = '# --- BEGIN tracked-surface block (BUG-042) ---';
const END = '# --- END tracked-surface block (BUG-042) ---';
const SITES = ['.claude', 'docs'];

const lsFiles = (site) =>
  execFileSync('git', ['ls-files', site], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);

// Order IS the contract. Git applies last-match-wins, so a directory's re-include has
// to precede the `/*` line that re-excludes its contents, and every leaf has to follow
// that line. Sorting the comparison would make a dead leaf pass, so nothing here
// normalizes order.
export function expectedBlock(sites) {
  const out = [];
  for (const [root, files] of sites) {
    out.push(`/${root}/*`);
    const dirs = new Set();
    for (const f of files) {
      let d = dirname(f);
      while (d !== '.' && d !== '' && d !== root) {
        dirs.add(d);
        d = dirname(d);
      }
    }
    for (const d of [...dirs].sort()) out.push(`!/${d}/`, `/${d}/*`);
    for (const f of [...files].sort()) out.push(`!/${f}`);
  }
  return out;
}

// Only the rules are compared. Comments and blank lines inside the markers are free,
// so the block can carry its own explanation, and everything OUTSIDE the markers is
// free too, which is what keeps the installer's appendMissingLinesText merge from
// ever breaking this test.
export function readBlock() {
  const raw = readFileSync(`${ROOT}/.gitignore`, 'utf8').split('\n').map((l) => l.trimEnd());
  const b = raw.indexOf(BEGIN);
  const e = raw.indexOf(END);
  if (b < 0 || e <= b) throw new Error(`block markers missing or inverted: begin=${b} end=${e}`);
  return raw.slice(b + 1, e).map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('#'));
}

describe('.gitignore tracked-surface block', () => {
  const sites = SITES.map((s) => [s, lsFiles(s)]);

  it('equals the block computed from git ls-files, in order', () => {
    expect(readBlock()).toEqual(expectedBlock(sites));
  });

  it('names every tracked file at both sites and nothing else', () => {
    const named = readBlock().filter((l) => l.startsWith('!') && !l.endsWith('/')).map((l) => l.slice(2));
    expect(named.sort()).toEqual(sites.flatMap(([, f]) => f).sort());
  });

  it('keeps every directory re-include above the exclusion it reopens', () => {
    const block = readBlock();
    for (const line of block.filter((l) => l.startsWith('!/') && l.endsWith('/'))) {
      const reExclude = `${line.slice(1)}*`;
      expect(block.indexOf(line)).toBeLessThan(block.indexOf(reExclude));
    }
  });

  // The discriminator. Without it, the equality assertion could be satisfied by a
  // comparison that never distinguishes anything, and no test would notice.
  it('fails when a single leaf is removed', () => {
    const full = expectedBlock(sites);
    const short = full.filter((l) => l !== '!/.claude/settings.json');
    expect(short.length).toBe(full.length - 1);
    expect(readBlock()).not.toEqual(short);
  });
});
```

- [X] **[T-001-B] Step 2: Run it and confirm the predicted red**

```bash
npx vitest run tests/unit/gitignore-block-parity.test.js
```

Expected: **4 failed**, all four, because `readBlock()` throws on the missing markers. Suite named: `tests/unit/gitignore-block-parity.test.js`.

Whole-suite boundary at this point, if run: **902 passed | 4 failed | 12 skipped (918)**, files **33 passed | 1 failed | 1 skipped (35)**. Any other count or any other failing suite is a tripwire: halt and report before editing `.gitignore`.

- [X] **[T-001-C] Step 3: Generate the block text**

Write the generator to a throwaway file outside the repository and run it, so no untracked helper lands at either site while the ignore rule is mid-change:

```js
// /Users/yeison/.claude/jobs/2dc6a6e3/tmp/genblock.mjs
import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';
const R = '/Users/yeison/Projects/code-conductor';
const ls = (s) => execFileSync('git', ['ls-files', s], { cwd: R, encoding: 'utf8' }).split('\n').filter(Boolean);
const out = [];
for (const root of ['.claude', 'docs']) {
  const files = ls(root);
  out.push(`/${root}/*`);
  const dirs = new Set();
  for (const f of files) { let d = dirname(f); while (d !== '.' && d !== '' && d !== root) { dirs.add(d); d = dirname(d); } }
  for (const d of [...dirs].sort()) out.push(`!/${d}/`, `/${d}/*`);
  for (const f of [...files].sort()) out.push(`!/${f}`);
}
console.log(out.join('\n'));
console.log('# lines:', out.length);
```

```bash
node /Users/yeison/.claude/jobs/2dc6a6e3/tmp/genblock.mjs
```

Expected shape: 19 lines for `.claude`, then `/docs/*` plus three directory pairs plus one leaf per tracked file under `docs/`. **Verify the `.claude/` half matches the spec's verbatim block character for character** before using the output; a mismatch means the generator and the spec disagree and the spec is the reviewed artifact.

- [X] **[T-001-D] Step 4: Rewrite `.gitignore`**

Retire lines `:3`, `:7`, `:8`, `:10`, `:11`. Relocate `:16` (`turn-count.txt`) and `:17` (`session-snapshot.json`) below the END marker as the two external-writer lines. Keep `:1`, `:2`, `:4`, `:5`, `:6`, `:9`, `:12`, `:13`, `:14`, `:15`, `:18` where they are. The result:

```
.worktrees/
graphify-out/
*.local
.DS_Store
Thumbs.db
initial_prompt.xml
node_modules/
.vitest-cache/
coverage/
tests/.tmp/
.conductor/

# --- BEGIN tracked-surface block (BUG-042) ---
# Deny by default at the two surfaces that hold tracked files. Every tracked file is
# named here and nothing else at either site is visible to git, so the exit code is
# honest in both directions: a tracked file stages and exits 0, an unnamed new file
# exits 1 and stages nothing.
#
# THE TOLL: a newly tracked asset costs one ! line in this block. Until it is written
# `git add <path>` exits 1 and stages nothing; `git add -f <path>` is the interim.
# tests/unit/gitignore-block-parity.test.js computes this block from `git ls-files`
# and fails on any drift, so the line cannot be forgotten, only paid.
#
# Order is load-bearing: git applies last-match-wins, so each directory re-include
# precedes the `/*` line that re-excludes its contents, and every leaf follows it.
#
# The rules are root-anchored with a leading slash. Before BUG-042 they were not, so
# `.claude/` and `docs/` matched at any depth and reached into project-template/,
# which needed `!project-template/*` to undo. That line is retired here.
<GENERATED BLOCK FROM STEP 3>
# --- END tracked-surface block (BUG-042) ---

# Kept for external writers. Both lines are redundant against the block above; each is
# kept because a process outside this file re-adds it when absent, and a line that
# reappears without explanation is a haunting.
#
# kept redundant: the user-global /cc-compact appends this line when absent; removing
# it means one re-append per compact
.claude/memory/session-snapshot.json
# kept redundant: lib/installer/deploy.mjs:17 merges project-template/gitignore by
# appending absent lines, and turn-count.txt is one of its three; removing it means one
# re-append per installer run against this repository
.claude/memory/turn-count.txt
```

`<GENERATED BLOCK FROM STEP 3>` is replaced by the generator's exact stdout, unmodified.

- [X] **[T-001-E] Step 5: Run the parity test and confirm green**

```bash
npx vitest run tests/unit/gitignore-block-parity.test.js
```

Expected: **4 passed**.

- [X] **[T-001-F] Step 6: Verify the six acceptance behaviors by hand**

```bash
git check-ignore -v .claude/settings.local.json
git check-ignore -v .claude/memory/personal.md
git check-ignore -q project-template/.claude/memory/bash-scan-allowlist.txt; echo "pt allowlist ignored rc=$?"
git ls-files --others --exclude-standard .claude docs
git add -u .claude/memory/project.md; echo "tracked add rc=$?"
```

Expected: the first two name a rule inside the block, never an ancestor exclude (AC5, AC6); `rc=1` for the project-template probe, meaning not ignored, with `!project-template/*` gone (AC7); **empty output** from `ls-files --others --exclude-standard` (AC8); `rc=0` for the tracked add (AC1, AC13).

- [X] **[T-001-G] Step 7: Run the whole suite**

```bash
npx vitest run
```

Expected: **906 passed | 12 skipped (918)**, files **34 passed | 1 skipped (35)**. `tests/unit/staging-convention.test.js` must be among the passing files, unchanged (AC18).

- [X] **[T-001-H] Step 8: Stage and commit**

```bash
git add -u .gitignore
git add tests/unit/gitignore-block-parity.test.js
git commit -m "fix: replace the two wholesale directory excludes with the root-anchored re-include form [BUG-042]" \
  -m "git add on a tracked file under .claude/ or docs/ exited 1 while staging it, so a tracked file that staged and a new file that did not were indistinguishable. The re-include form separates them: rc 0 and staged, or rc 1 and nothing staged." \
  -m "Root-anchoring retires !project-template/*, which existed only to undo the unanchored rules reaching into project-template/. The allowlist template shipped in 1.32.0 was trackable only because of that line." \
  -m "The block is pinned to the git index by tests/unit/gitignore-block-parity.test.js, which computes it from git ls-files and asserts exact equality including order, with a removed-leaf discriminator proving the assertion is load-bearing." \
  -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HLS5KAHkhpMChyqNTbqrhe"
```

`.gitignore` is tracked, so `-u`. The test file is new and at a path with no ignored ancestor, so plain `git add`.

---

### Task 2: The host-owned XOR invariant

**Files:**
- Create: `tests/unit/host-owned-ignore-xor.test.js`

**Interfaces:**
- Consumes: `PROJECT_HOST_OWNED` from `lib/installer/host-owned.mjs`.
- Produces: `xorViolations(rows, probes)`, exported so the discriminator cases can feed it synthetic probes.

**This task has no red state, and that is stated rather than discovered.** The invariant holds today and holds after Task 1, so all four cases pass on their first run. Its value is regression plus the two discriminators, which prove it can fail.

- [X] **[T-002-A] Step 1: Write the test**

Create `tests/unit/host-owned-ignore-xor.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROJECT_HOST_OWNED } from '../../lib/installer/host-owned.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const rc = (args) => {
  try {
    execFileSync('git', args, { cwd: ROOT, stdio: 'ignore' });
    return 0;
  } catch (e) {
    return e.status ?? -1;
  }
};

// A host-owned row must be exactly one of ignored or tracked, never both and never
// neither. Neither means the index can swallow a host file on the next bulk add.
// Both means git is tracking a file it has been told to hide, which is the state that
// makes a later ignore-rule edit silently stop mattering.
export function xorViolations(rows, { isIgnored, isTracked }) {
  return rows
    .filter(([rel]) => isIgnored(rel) === isTracked(rel))
    .map(([rel]) => rel);
}

const live = {
  isIgnored: (rel) => rc(['check-ignore', '-q', `.claude/${rel}`]) === 0,
  isTracked: (rel) => rc(['ls-files', '--error-unmatch', `.claude/${rel}`]) === 0,
};

describe('PROJECT_HOST_OWNED rows are ignored XOR tracked', () => {
  const rows = [...PROJECT_HOST_OWNED];

  it('holds for every row', () => {
    expect(xorViolations(rows, live)).toEqual([]);
  });

  it('tracks exactly project.md and settings.json', () => {
    const tracked = rows.filter(([rel]) => live.isTracked(rel)).map(([rel]) => rel);
    expect(tracked.sort()).toEqual(['memory/project.md', 'settings.json']);
  });

  it('reports a row that is both tracked and ignored', () => {
    const probes = { isIgnored: () => true, isTracked: (rel) => rel === 'settings.local.json' };
    expect(xorViolations(rows, probes)).toContain('settings.local.json');
  });

  it('reports a row that is neither tracked nor ignored', () => {
    const probes = { isIgnored: () => false, isTracked: () => false };
    expect(xorViolations(rows, probes)).toEqual(rows.map(([rel]) => rel));
  });
});
```

- [X] **[T-002-B] Step 2: Run it**

```bash
npx vitest run tests/unit/host-owned-ignore-xor.test.js
```

Expected: **4 passed**, first run, no red.

- [X] **[T-002-C] Step 3: Confirm the discriminators are load-bearing**

Temporarily change `xorViolations`'s filter from `===` to `!==`, re-run, confirm cases 1, 3 and 4 fail, then revert. This is a manual confirmation, not a committed change; report the three failing case names in the task report.

- [X] **[T-002-D] Step 4: Run the whole suite**

```bash
npx vitest run
```

Expected: **910 passed | 12 skipped (922)**, files **35 passed | 1 skipped (36)**.

- [X] **[T-002-E] Step 5: Stage and commit**

```bash
git add tests/unit/host-owned-ignore-xor.test.js
git commit -m "test: pin every PROJECT_HOST_OWNED row as ignored XOR tracked [BUG-042]" \
  -m "The BUG-042 audit expected to find PROJECT_HOST_OWNED duplicated in .gitignore syntax. The deny-by-default block names zero host-owned paths and leaks zero, so there is no duplication to remove. This invariant is what the relationship actually is: two tracked rows, seven ignored, and a future seed row that accidentally becomes trackable fails here." \
  -m "Both discriminators are cases, not comments: a row flipped to both and a row flipped to neither are each asserted to be reported." \
  -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HLS5KAHkhpMChyqNTbqrhe"
```

---

### Task 3: Partially retire the staging convention

**Files:**
- Modify: `CLAUDE.md` (the `## Staging Convention` section)

- [X] **[T-003-A] Step 1: Rewrite the section's opening premise**

The section currently opens by naming `.gitignore:7` as the cause. Replace that opening with the partial-retirement form. The three bullets keep their text; what changes is the premise paragraph above them and a new paragraph below.

Replacement opening paragraph:

```markdown
`git add` exits 1 whenever a pathspec matches an ignored ancestor, whether or not the
file itself staged correctly. **BUG-042 retired that condition for this repository's own
tracked surfaces:** `.claude/` and `docs/` are no longer excluded wholesale, and a
tracked file under either now exits 0 and stages (measured: rc 1 to rc 0, with the file
staging in both states). The rule below is kept because the condition still exists
wherever an ignored ancestor does, and because the branch it describes is correct
independently of any one ignore rule.
```

Replacement closing paragraph, replacing the sentence that names `:7`:

```markdown
Where each branch is still live: `-f` is required for a new file under a genuinely
ignored directory, `.conductor/` being the remaining one in this repository. The rule
against bare `git add -u` is independent of every ignore rule, since it is about
staging the whole worktree rather than one path. `tests/unit/staging-convention.test.js`
pins all four facts this rule rests on, and it builds its own fixture `.gitignore`, so
it asserts git's behavior rather than this repository's file and is unaffected by
BUG-042.
```

- [X] **[T-003-B] Step 2: Add the anchoring note**

Append immediately after the closing paragraph, as two sentences that do not erase each other:

```markdown
**On anchoring.** BUG-040's audit struck anchoring as a candidate fix and that verdict
stands for what it measured: `/foo/` and `foo/` report an excluded ancestor identically,
so anchoring never makes an exit code honest. BUG-042 measured a different question and
found anchoring load-bearing for which paths a rule matches at all: unanchored `.claude/`
and `docs/` reached into `project-template/`, which is why `!project-template/*` existed,
and root-anchoring is what retired it.
```

- [X] **[T-003-C] Step 3: Verify the convention test still passes**

```bash
npx vitest run tests/unit/staging-convention.test.js
```

Expected: **8 passed**. `AC1` asserts `CLAUDE.md` carries both branches and `AC4` asserts the `cc-checkpoint` wording; both must survive the rewrite. If either fails, the rewrite dropped a branch and must be repaired before committing, not after.

- [X] **[T-003-D] Step 4: Run the whole suite**

```bash
npx vitest run
```

Expected: **910 passed | 12 skipped (922)**, unchanged from T-002-D. A change here means the prose edit moved something a test reads.

- [X] **[T-003-E] Step 5: Stage and commit**

```bash
git add -u CLAUDE.md
git commit -m "docs: partially retire the BUG-040 staging convention with its measurement [BUG-042]" \
  -m "A rule that outlives its justification is the defect class this chain has hunted in deny messages, instruments and tests, and prose gets no exemption. Clause 1's premise named .gitignore:7, which BUG-042 removes, so the premise is rewritten to name what retired it and to quote the measurement: rc 1 to rc 0, with the file staging in both states." \
  -m "Clauses 2 and 3 are kept with their remaining live cases named: -f for a new file under .conductor/, and the ban on bare git add -u which is independent of every ignore rule." \
  -m "The anchoring note lands as two sentences that do not erase each other. BUG-040's strike stands for exit-code reporting; BUG-042 measured that anchoring is load-bearing for path matching." \
  -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HLS5KAHkhpMChyqNTbqrhe"
```

---

### Task 4: Release 1.32.1

**Files:**
- Modify: `VERSION`, `package.json`, `package-lock.json`, `CHANGELOG.md`

- [X] **[T-004-A] Step 1: Bump the five locations**

```bash
node -e "const f='VERSION';require('fs').writeFileSync(f,'1.32.1\n')"
```

Then surgical single-line edits: `package.json`'s `"version"`, `package-lock.json`'s top-level `"version"` and its `packages[""].version`. Verify all five agree:

```bash
node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json'));const l=JSON.parse(fs.readFileSync('package-lock.json'));console.log(fs.readFileSync('VERSION','utf8').trim(),p.version,l.version,l.packages[''].version)"
```

Expected: `1.32.1 1.32.1 1.32.1 1.32.1`. The fifth location is `CHANGELOG.md`, added in the next step.

- [X] **[T-004-B] Step 2: Add the CHANGELOG entry**

Insert above the `1.32.0` section:

```markdown
## 1.32.1 - 2026-09-28

### Fixed
- **BUG-042:** `.gitignore` excluded `.claude/` and `docs/` wholesale, so `git add` on a tracked file inside either exited 1 while staging the file. Both are now root-anchored re-include blocks: a tracked file exits 0 and stages, an unnamed new file exits 1 and stages nothing. `!project-template/*` is retired, since it existed only to undo the unanchored rules reaching into `project-template/`.
- `.claude/settings.local.json` was held ignored by the wholesale rule alone. `*.local` does not match it. It is now named by a rule inside the block.

### Added
- `tests/unit/gitignore-block-parity.test.js` computes the block from `git ls-files` and asserts exact equality including order, with a removed-leaf discriminator.
- `tests/unit/host-owned-ignore-xor.test.js` asserts every `PROJECT_HOST_OWNED` row is ignored XOR tracked, with both flip discriminators.

### Changed
- `CLAUDE.md`'s staging convention is partially retired: clause 1's justification names what retired it, clauses 2 and 3 keep their remaining live cases.

Nothing under `project-template/` or `lib/` changed, so a fresh install produces byte-identical output to 1.32.0. This is why the release is PATCH.
```

- [X] **[T-004-C] Step 3: Run the whole suite**

```bash
npx vitest run
```

Expected: **910 passed | 12 skipped (922)**. `tests/installer/cli.test.js` and `tests/installer/manifest.test.js` read the version; if either fails, a location disagrees and the fix is the location, not the test.

- [ ] **[T-004-D] Step 4: Stage and commit**

```bash
git add -u VERSION package.json package-lock.json CHANGELOG.md
git commit -m "chore: 1.32.1 [BUG-042]" \
  -m "PATCH: nothing under project-template/ or lib/ changed, so a fresh install observes byte-identical output to 1.32.0. Developer-facing behavior in this repository changes materially, which is why it is a release at all, but the ratified test is observability on a fresh install." \
  -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HLS5KAHkhpMChyqNTbqrhe"
```

---

### Task 5: Close the record

**Files:**
- Modify: `AGENT-READABLE BACKLOG.md`
- Modify: `.claude/memory/project.md`

- [ ] **[T-005-A] Step 1: Close `[BUG-042]`**

Flip the heading checkbox from `[ ]` to `[X]` as a surgical single-line edit, then add a `DONE` bullet directly under the heading recording: shipped as 1.32.1; the two sites with their measured case rows; the three premise corrections the audit made (the `*.local` gap, `:10`'s load-bearing role, and the enumeration being the git index rather than `PROJECT_HOST_OWNED`); and the supersession bookkeeping note that the second site was found by audit, same archetype, folded by ruling.

- [ ] **[T-005-B] Step 2: Add the sibling concern to `[BUG-046]`**

Append one bullet to the `[BUG-046]` entry carrying **both** specimens of external writers to repo files: the user-global `/cc-compact`, which appends `.claude/memory/session-snapshot.json` when absent, and `lib/installer/deploy.mjs:17`, which appends `turn-count.txt` through the `project-template/gitignore` merge. Both belong to the same "infrastructure the repo depends on but does not control" family as the release-critical instruments. Name the two kept lines and their comments as the current mitigation, and state the policy the pair produced: a line kept for an external writer is kept with the writer's name and path in its comment.

- [ ] **[T-005-C] Step 3: Append the implementation record to `.claude/memory/project.md`**

One section: the boundary table with suites named, the block's final line count, the six hand-verified acceptance behaviors from T-001-F with their measured results, the no-red statement for Task 2, and the epitaph sentence: **Task 0 was the last time `git add -f` was needed for a file that was already tracked in this repository.**

- [ ] **[T-005-D] Step 4: Stage and commit**

```bash
git add -u "AGENT-READABLE BACKLOG.md"
git add -u .claude/memory/project.md
git commit -m "docs: close BUG-042 and record the restructure [BUG-042]" \
  -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HLS5KAHkhpMChyqNTbqrhe"
```

Note the staging form change: `.claude/memory/project.md` now stages with `-u` and exits 0 because the block names it, where before this item the same command exited 0 only by avoiding the ignore check. Both work; only one is honest.

---

### Task 6: Push and open the PR

- [ ] **[T-006-A] Step 1: Push the branch**

```bash
git push -u origin fix/bug-042-gitignore-restructure
```

- [ ] **[T-006-B] Step 2: Open the PR**

Body carries: the six-for-six boundary table with suites named; both corpus runs; the three audit premise corrections with their measurements; the six hand-verified acceptance behaviors; the PATCH argument; and the three conventions landing with the release (the version rule's worked example, evidence-first applied to friction, and the self-enforcing toll).

Stage the body through gitignored `.conductor/` if a scratchpad file is needed, per the BUG-046 precedent.

---

## Test List

- [ ] `tests/unit/gitignore-block-parity.test.js`: 4 cases (equality in order, leaf set completeness, directory ordering, removed-leaf discriminator)
- [ ] `tests/unit/host-owned-ignore-xor.test.js`: 4 cases (invariant holds, the two tracked rows named, both-flip discriminator, neither-flip discriminator)
- [ ] `tests/unit/staging-convention.test.js`: verified unchanged and passing (AC18)
- [ ] Manual corpus in T-001-F: six acceptance behaviors probed directly against the live repository

No integration or E2E test: nothing shipped changes, and the installer surface is untouched.

## Commit Order

| # | Task | Subject |
|---|---|---|
| 1 | T-000 | `docs: add the BUG-042 gitignore restructure implementation plan [BUG-042]` |
| 2 | T-001 | `fix: replace the two wholesale directory excludes with the root-anchored re-include form [BUG-042]` |
| 3 | T-002 | `test: pin every PROJECT_HOST_OWNED row as ignored XOR tracked [BUG-042]` |
| 4 | T-003 | `docs: partially retire the BUG-040 staging convention with its measurement [BUG-042]` |
| 5 | T-004 | `chore: 1.32.1 [BUG-042]` |
| 6 | T-005 | `docs: close BUG-042 and record the restructure [BUG-042]` |

## Predicted boundaries, with suites named

| After | Tests | Files | Failing suite |
|---|---|---|---|
| baseline `eaaa077` | 902 passed / 12 skipped (914) | 33 passed / 1 skipped (34) | none |
| T-000-C | 902 / 12 | 33 / 1 | none |
| **T-001-B (predicted red)** | **902 passed, 4 failed, 12 skipped (918)** | **33 passed, 1 failed, 1 skipped (35)** | **`gitignore-block-parity`, all 4 cases, markers missing** |
| T-001-G | 906 passed / 12 skipped (918) | 34 passed / 1 skipped (35) | none |
| T-002-D | 910 passed / 12 skipped (922) | 35 passed / 1 skipped (36) | none |
| T-003-D | 910 / 12 | 35 / 1 | none |
| T-004-C | 910 / 12 | 35 / 1 | none |

**One predicted red, named by suite and by cause.** Any deviation in count or in suite is a tripwire: halt and report before proceeding.

## Identified Risks

1. **The self-reference.** The plan file is inside a surface the block enumerates. Mitigated by ordering: Task 0 commits it, T-001-C generates afterwards. If the generator is ever re-run at a different index state, the block changes and the test says so.
2. **Order normalization would silently gut the test.** Sorting the comparison would let a leaf sit above the `/*` line that kills it and still pass. The test asserts sequence and carries a separate directory-ordering case. Stated in the test's own comment so a future refactor meets the reason.
3. **The installer can append to `.gitignore`.** `lib/installer/deploy.mjs:17` merges `project-template/gitignore` by appending absent lines. After this change `.claude/memory/turn-count.txt` would no longer be a literal line, so an installer run against this repository would append it. The block-equality test compares only the lines **between the markers**, so an appended line lands outside and cannot break it, which is the single detail that lets the block test and `appendMissingLinesText` share one file forever. **RULED: extend Gate 5's treatment.** `turn-count.txt` is kept below the END marker with its own comment naming `deploy.mjs:17`, exactly parallel to the compact line's comment. The generalization now has two specimens and becomes policy at closeout: **a line kept for an external writer is kept with the writer's name and path in its comment.** Two hauntings prevented by documentation beat two mystery re-appends investigated later.
4. **`git` must be present for both new tests.** Both spawn `git` from the repository root. `tests/unit/staging-convention.test.js` already does, so this adds no new requirement, but a `git`-less environment now fails 8 tests rather than 8. No mitigation planned; recorded so the cause is obvious if it ever fires.
5. **A leaf needing escaping would break the block silently.** Verified now: of 57 tracked paths at the two sites, **zero** contain a space, `#`, `!`, `[`, `]`, `*`, `?` or backslash. Path depths present are 2, 3 and 4, all covered by the scaffold. If a future file needs escaping the equality test fails, which is the right failure, but the message will be confusing; recorded here as the first place to look.
6. **The 16 historical untracked specs and plans must stay invisible.** AC8 probes this directly in T-001-F with `ls-files --others --exclude-standard`, expecting empty output. This is the leak direction, and it is checked before the commit rather than after.
7. **Prose edits can break tests that read prose.** `tests/unit/staging-convention.test.js` AC1 and AC4 read `CLAUDE.md` and the `cc-checkpoint` command. T-003-C runs that suite alone before the whole-suite run, so a dropped branch is caught at the edit rather than at the commit.
8. **Closeout wording.** The epitaph sentence belongs in the record: Task 0 is the last time `git add -f` is needed for a file that is already tracked in this repository. It is a claim about this repository only, and it is true only for the two restructured surfaces; `.conductor/` still requires `-f` for genuinely new ignored files. Both halves get written, so the sentence cannot be quoted later as more than it is.
