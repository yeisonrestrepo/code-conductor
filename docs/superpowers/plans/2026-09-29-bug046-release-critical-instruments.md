# [BUG-046] Release-Critical Instruments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn three release-critical checks into tracked repository infrastructure with tests that pin their semantics, and give the closeout ritual a document and a merge gate instead of a memory.

**Architecture:** A repo-only `tools/` directory holds each instrument as a pure function over text plus a thin CLI. `tests/tools/` drives those functions against fixtures, and one live-repo suite asserts the same invariants against this repository so CI enforces them at the merge gate. `docs/RELEASE-CLOSEOUT.md` names the instruments as ordered steps and states which are CI-backed.

**Tech Stack:** Node 20+ ESM, vitest 3, `git` CLI. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-29-bug046-release-critical-instruments-design.md` (31 ACs)

## Global Constraints

- **Version: PATCH `1.32.2`**, across five locations in one commit: `VERSION`, `package.json` `version`, `package-lock.json` `version`, `package-lock.json` `packages[""].version`, `CHANGELOG.md` first heading.
- **`tools/` is repo-only.** It must never appear in `package.json` `files`, and `lib/installer/deploy.mjs` must never copy it.
- **`fetch-depth: 0` is declined.** `.github/workflows/test.yml` is not modified by any task.
- **No em-dashes in any authored output.**
- **BUG-003 invariant:** plan and tracking state updates are surgical single-line edits, one checkbox or field at a time.
- **Staging form.** `git add -u <path>` for a tracked file, `git add -f <path>` for a new file under a genuinely ignored directory, plain `git add <path>` otherwise, always with an explicit path. Never bare `git add -u`.
- **Leaf-first for `docs/` documents.** Add the `!` leaf to the tracked-surface block **before** staging a new `docs/` file. Measured 2026-09-29: with the leaf present, plain `git add` exits 0 and the commit never passes through a red `gitignore-block-parity`. Force-staging first produces a real red (2 of 4 cases) that then has to be cleared.
- **Guard 3.** Write `.mjs` files with the Write tool, never a `cat` heredoc. Commit messages go through `git commit -F <file>`.
- **Ceiling before any filing:** heading-scoped, both legs. Currently `BUG-047`, next mintable `BUG-048`. This plan mints nothing.

## Review Focus

Five input classes the spec implies and no task's tests would otherwise exercise. Each line's test is added to the task that owns the code.

1. **CRLF line endings in a record file.** This project ships Windows support and normalizes `\r\n` elsewhere (`tests/installer/templates.test.js` uses a `readText` that strips it). A heading or bullet read with a trailing `\r` fails every regex here, so an instrument would silently report zero headings or zero claims, which is the vacuous pass in a new costume. Owned by T-001 and T-003.
2. **`package-lock.json` at lockfileVersion 1**, which has no `packages` object. `lock.packages[''].version` throws a `TypeError` rather than reporting a location it could not read, so the gate would crash where it should fail with a name. Owned by T-002.
3. **`## [Unreleased]` as the first `CHANGELOG` heading.** The version regex does not match it, and a naive "first heading" resolver would silently take the second heading as the current version, comparing `VERSION` against the previous release and reporting agreement that does not exist. Owned by T-002 and T-003.
4. **A backlog heading with trailing whitespace** after its closing backtick. A `$`-anchored pattern would miss the heading entirely, dropping it from both the ceiling count and the parity map, so an id could be minted twice. Owned by T-001.
5. **Two `CHANGELOG` headings naming the same version.** The record is wrong, and a resolver keyed on first match reports the first one and never says the record disagrees with itself. Owned by T-003.

## File Structure

| Path | Responsibility |
|---|---|
| `tools/id-ceiling.mjs` | Pure `scanHeadings(text)` plus a two-leg CLI. Query, not gate. |
| `tools/version-gate.mjs` | Pure `compare(found)` plus a CLI reading the five locations. |
| `tools/record-parity.mjs` | Pure `parseChangelog`, `parseBacklog`, `checkParity` plus a CLI. |
| `tools/README.md` | The four-entry retired-instruments registry and the external-writers note. |
| `tests/tools/id-ceiling.test.js` | Fixtures including the forward-reference decoy. |
| `tests/tools/version-gate.test.js` | Both directions, one fail case per location. |
| `tests/tools/record-parity.test.js` | The `[BUG-044]` state, its reverse, the `### Filed` control. |
| `tests/tools/repo-invariants.test.js` | The three live-repository assertions CI enforces. |
| `tests/tools/tools-not-shipped.test.js` | Manifest and deploy assertions with their discriminator. |
| `docs/RELEASE-CLOSEOUT.md` | The ordered closeout checklist. |

Each instrument exports its pure function **and** runs a CLI when invoked directly, using the `import.meta.url` entry check, so one file serves the test and the closeout without a second wrapper.

---

## Task 0: Commit the plan

**Files:**
- Create: `docs/superpowers/plans/2026-09-29-bug046-release-critical-instruments.md` (this file)
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nothing.
- Produces: the plan file tracked, and the tracked-surface block naming it, so every later task starts from a green `gitignore-block-parity`.

**Why this task is first and why the leaf precedes the staging.** This plan lives under `docs/`, a surface the tracked-surface block enumerates leaf by leaf, so the plan is subject to the rule it is planning around. Adding the leaf first is the only ordering that never passes through a state where this item's own artifacts violate this repository's own rule.

- [ ] **[T-000-A] Add the plan's leaf line to the tracked-surface block**

Modify `.gitignore`. Insert in sorted position among the `!/docs/superpowers/plans/` leaves, which sort by full path, so `2026-09-29-...` follows `2026-09-28-...`:

```
!/docs/superpowers/plans/2026-09-29-bug046-release-critical-instruments.md
```

- [ ] **[T-000-B] Stage the plan with plain `git add` and confirm rc 0**

```bash
git add "docs/superpowers/plans/2026-09-29-bug046-release-critical-instruments.md"
echo "rc=$?"
```

Expected: `rc=0`. A non-zero exit means the leaf from T-000-A is missing or misspelled; fix the leaf rather than reaching for `-f`.

- [ ] **[T-000-C] Run the block parity suite**

Run: `npx vitest run tests/unit/gitignore-block-parity.test.js`
Expected: PASS, 4 of 4.

- [ ] **[T-000-D] Stage `.gitignore` and commit**

```bash
git add -u ".gitignore"
git commit -F <scratchpad>/msg-t000.txt
```

Message subject, written to `<scratchpad>/msg-t000.txt` before the commit step runs:

```
docs: add the BUG-046 release-critical instruments implementation plan
```

---

## Task 1: `tools/id-ceiling.mjs`, the query

**Files:**
- Create: `tools/id-ceiling.mjs`
- Create: `tests/tools/id-ceiling.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `scanHeadings(text) -> { headings: number, max: { BUG?: number, FEAT?: number, ARCH?: number }, duplicates: Array<{ id: string, count: number }> }`. T-004 imports `scanHeadings` for the live duplicate-freedom assertion.

- [ ] **[T-001-A] Write the failing test file**

Create `tests/tools/id-ceiling.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { scanHeadings } from '../../tools/id-ceiling.mjs';

// The forward-reference decoy. This fixture IS the [BUG-044] failure, frozen: the
// retired max-scan counted id-shaped tokens anywhere, including a plan line stating
// the ceiling it expected to read after minting, and so read its own predicted
// output back as evidence. Only the filed heading may count.
const DECOY = [
  '### [ ] `[BUG-010]` A filed item',
  '',
  'Prose naming `[BUG-042]` as a forward reference.',
  'A scope fence mentioning `[BUG-099]`.',
  'The ceiling this check expects to read after minting is `[BUG-500]`.',
  '',
].join('\n');

describe('scanHeadings', () => {
  it('counts filed headings only, never a prose forward reference', () => {
    const r = scanHeadings(DECOY);
    expect(r.headings).toBe(1);
    expect(r.max).toEqual({ BUG: 10 });
  });

  it('sees a four-digit id, which an exact \\d{3} quantifier would hide forever', () => {
    const r = scanHeadings('### [ ] `[BUG-1000]` Beyond three digits');
    expect(r.max).toEqual({ BUG: 1000 });
  });

  it('reports duplicate ids with their counts', () => {
    const text = [
      '### [X] `[BUG-010]` First',
      '### [ ] `[BUG-010]` Second',
      '### [ ] `[FEAT-011]` Only once',
    ].join('\n');
    expect(scanHeadings(text).duplicates).toEqual([{ id: 'BUG-010', count: 2 }]);
  });

  it('counts a heading in any state, because the ceiling is about filing not state', () => {
    const text = ['[ ]', '[X]', '[~]', '[>]', '[!]']
      .map((s, i) => `### ${s} \`[BUG-0${10 + i}]\` Item`)
      .join('\n');
    const r = scanHeadings(text);
    expect(r.headings).toBe(5);
    expect(r.max).toEqual({ BUG: 14 });
  });

  // Review Focus 1: a CRLF record must not read as zero headings.
  it('reads CRLF line endings', () => {
    expect(scanHeadings('### [ ] `[BUG-010]` Item\r\n### [ ] `[BUG-011]` Item\r\n').headings).toBe(2);
  });

  // Review Focus 4: trailing whitespace must not hide a heading from the count.
  it('reads a heading with trailing whitespace after the closing backtick', () => {
    expect(scanHeadings('### [ ] `[BUG-010]` Item   ').headings).toBe(1);
  });
});
```

- [ ] **[T-001-B] Run the test to verify it fails for the right reason**

Run: `npx vitest run tests/tools/id-ceiling.test.js`
Expected: FAIL, all 6 cases, with a module resolution error naming `tools/id-ceiling.mjs`. A failure with any other cause means the test file itself is wrong; fix it before writing the instrument.

- [ ] **[T-001-C] Write `tools/id-ceiling.mjs`**

Create `tools/id-ceiling.mjs`:

```js
#!/usr/bin/env node
// Heading-scoped id ceiling over the working tree UNION origin/main.
//
// REPO-ONLY. This file must never be added to package.json `files` and must never
// be copied by lib/installer/deploy.mjs. tests/tools/tools-not-shipped.test.js pins
// both. A consumer installation has no AGENT-READABLE BACKLOG.md, so shipping this
// would put an inert file on every user's disk.
//
// This is a QUERY, not a gate: its output is read by whoever is deciding what id to
// mint. The assertable invariant that lives alongside it, duplicate-id freedom, is
// asserted live in tests/tools/repo-invariants.test.js.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const BACKLOG = 'AGENT-READABLE BACKLOG.md';

// \d{3,} and not \d{3}: an exact quantifier makes [BUG-1000] invisible forever,
// freezing the ceiling at 999 and minting a duplicate with zero diagnostics. This is
// the one thing worth carrying verbatim out of the retired survivor.
const HEADING = /^### \[.\] `\[(BUG|FEAT|ARCH)-(\d{3,})\]`/;

export function scanHeadings(text) {
  const max = {};
  const counts = new Map();
  let headings = 0;
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  for (const line of lines) {
    const m = line.match(HEADING);
    if (!m) continue;
    headings += 1;
    const id = `${m[1]}-${m[2]}`;
    counts.set(id, (counts.get(id) ?? 0) + 1);
    const n = Number(m[2]);
    if (max[m[1]] === undefined || n > max[m[1]]) max[m[1]] = n;
  }
  const duplicates = [];
  for (const [id, count] of counts) if (count > 1) duplicates.push({ id, count });
  return { headings, max, duplicates };
}

function remoteLeg() {
  const r = spawnSync('git', ['show', `origin/main:${BACKLOG}`], { encoding: 'utf8' });
  if (r.error) return { failed: `could not spawn git: ${r.error.message}` };
  if (r.status !== 0) {
    return { failed: `git show exited ${r.status}: ${String(r.stderr || '').trim()}` };
  }
  if (!String(r.stdout || '').trim()) {
    return { failed: 'git show exited 0 with empty output, which cannot be true for this repository' };
  }
  return { text: r.stdout };
}

function main() {
  const working = scanHeadings(readFileSync(BACKLOG, 'utf8'));
  const remote = remoteLeg();

  // A number derived from half the evidence is worse than no number, and printing one
  // would itself be an instance of the archetype tools/README.md documents: success
  // semantics on a failure path.
  if (remote.failed) {
    console.error(`CEILING_ABORT: origin/main leg failed. ${remote.failed}`);
    console.error('No ceiling printed. Fix the leg and re-run; do not mint from the working tree alone.');
    process.exit(2);
  }

  const other = scanHeadings(remote.text);
  const report = (label, r) =>
    console.log(`${label}: headings=${r.headings} max=${JSON.stringify(r.max)} ` +
      `dupes=${r.duplicates.length ? JSON.stringify(r.duplicates) : 'none'}`);
  report('working tree', working);
  report('origin/main ', other);

  const union = {};
  for (const src of [working.max, other.max]) {
    for (const [prefix, n] of Object.entries(src)) {
      if (union[prefix] === undefined || n > union[prefix]) union[prefix] = n;
    }
  }
  console.log(`UNION ceiling ${JSON.stringify(union)}`);
  const bug = union.BUG ?? 0;
  console.log(`next mintable BUG-${String(bug + 1).padStart(3, '0')}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
```

- [ ] **[T-001-D] Run the test to verify it passes**

Run: `npx vitest run tests/tools/id-ceiling.test.js`
Expected: PASS, 6 of 6.

- [ ] **[T-001-E] Run the CLI against the live repository and record its output**

```bash
git fetch origin main --quiet
node tools/id-ceiling.mjs
echo "rc=$?"
```

Expected: `rc=0`, both legs reporting `headings=47`, `max={"BUG":47,"FEAT":30,"ARCH":8}`, `dupes=none`, and `next mintable BUG-048`. Any other number is a tripwire halt: report it and stop.

- [ ] **[T-001-F] Prove the abort path without breaking the repository**

```bash
node -e "process.argv[1]='x'" 2>/dev/null
git -c core.hooksPath=/dev/null show "origin/definitely-not-a-branch:AGENT-READABLE BACKLOG.md"
echo "control rc=$?"
```

Expected: a non-zero `control rc`, confirming `git show` fails loudly on a bad ref, which is the input `remoteLeg` translates into `CEILING_ABORT`. This is a control on the mechanism, not a mutation of any ref.

- [ ] **[T-001-G] Run the full suite and confirm the predicted move**

Run: `npm test`
Expected: **916 passed / 12 skipped, 36 files passed / 1 skipped** (baseline 910 / 12, 35 / 1, plus 6 tests in 1 file).

- [ ] **[T-001-H] Stage and commit**

```bash
git add "tools/id-ceiling.mjs" "tests/tools/id-ceiling.test.js"
git commit -F <scratchpad>/msg-t001.txt
```

Subject: `feat: track the heading-scoped id ceiling as repo infrastructure [BUG-046]`

---

## Task 2: `tools/version-gate.mjs`, the invariant

**Files:**
- Create: `tools/version-gate.mjs`
- Create: `tests/tools/version-gate.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `readLocations(root) -> Record<string, string|null>` and `compare(found) -> { ok: boolean, want?: string, authorityFailed?: boolean, reason?: string, rows: Array<{ name, value, ok }>, disagreements: string[] }`. T-004 imports both.

**The defect this replaces, named so it cannot return.** The retired gate read `process.argv[2] ?? '1.31.2'`, a literal frozen two releases back, and therefore reported `FAIL` on five locations that agreed. `compare` takes **no target parameter at all**: the authority is always `found['VERSION']`. There is nothing to default.

- [ ] **[T-002-A] Write the failing test file**

Create `tests/tools/version-gate.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { compare, LOCATIONS } from '../../tools/version-gate.mjs';

const agreeing = (v) => Object.fromEntries(LOCATIONS.map((n) => [n, v]));

describe('compare', () => {
  // The forbidden outcome, stated as the test's own subject. Failure on agreement is
  // the defect this gate replaced, and a gate that only ever says FAIL is
  // indistinguishable from a gate that works.
  it('reports five-way agreement as agreement, never as failure', () => {
    const r = compare(agreeing('1.32.2'));
    expect(r.ok).toBe(true);
    expect(r.want).toBe('1.32.2');
    expect(r.rows).toHaveLength(5);
    expect(r.rows.every((row) => row.ok)).toBe(true);
    expect(r.disagreements).toEqual([]);
  });

  // One case per checked location, so a gate that reads only the first two cannot pass.
  for (const name of LOCATIONS.filter((n) => n !== 'VERSION')) {
    it(`fails and names the location when ${name} disagrees`, () => {
      const found = agreeing('1.32.2');
      found[name] = '1.32.1';
      const r = compare(found);
      expect(r.ok).toBe(false);
      expect(r.disagreements).toEqual([name]);
    });
  }

  it('fails against the authority itself, not the four, when VERSION is malformed', () => {
    const found = agreeing('1.32.2');
    found['VERSION'] = 'v1.32.2-rc1';
    const r = compare(found);
    expect(r.ok).toBe(false);
    expect(r.authorityFailed).toBe(true);
    expect(r.reason).toMatch(/VERSION/);
    expect(r.disagreements).toEqual([]);
  });

  // Review Focus 2: lockfileVersion 1 has no `packages` object, so the reader hands
  // compare a null rather than throwing, and the gate names the location it could
  // not read instead of crashing.
  it('fails naming an unreadable location rather than throwing', () => {
    const found = agreeing('1.32.2');
    found['package-lock.json packages[""].version'] = null;
    const r = compare(found);
    expect(r.ok).toBe(false);
    expect(r.disagreements).toEqual(['package-lock.json packages[""].version']);
  });
});
```

- [ ] **[T-002-B] Run the test to verify it fails**

Run: `npx vitest run tests/tools/version-gate.test.js`
Expected: FAIL, all 7 cases, module resolution error naming `tools/version-gate.mjs`.

- [ ] **[T-002-C] Write `tools/version-gate.mjs`**

Create `tools/version-gate.mjs`:

```js
#!/usr/bin/env node
// VERSION is the authority. The other four locations are checked against it, and
// agreement is reported as agreement.
//
// REPO-ONLY. See the note in tools/id-ceiling.mjs; tools-not-shipped.test.js pins it.
//
// The retired form took `process.argv[2] ?? '1.31.2'`, a literal frozen two releases
// back, and so reported FAIL on five locations that agreed. There is deliberately no
// target parameter here and therefore nothing to default.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LOCATIONS = [
  'VERSION',
  'package.json version',
  'package-lock.json version',
  'package-lock.json packages[""].version',
  'CHANGELOG.md first heading',
];

const SEMVER = /^\d+\.\d+\.\d+$/;

// Review Focus 3: an `## [Unreleased]` heading does not match, and the reader must
// not silently fall through to the next heading, which would compare VERSION against
// the PREVIOUS release and report an agreement that does not exist. The first `## `
// line is the current version or the gate has nothing to compare.
export function firstChangelogVersion(text) {
  for (const line of String(text).replace(/\r\n/g, '\n').split('\n')) {
    if (!line.startsWith('## ')) continue;
    const m = line.match(/^## \[?(\d+\.\d+\.\d+)\]?/);
    return m ? m[1] : null;
  }
  return null;
}

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const readText = (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } };

export function readLocations(root) {
  const pkg = readJson(join(root, 'package.json'));
  const lock = readJson(join(root, 'package-lock.json'));
  const changelog = readText(join(root, 'CHANGELOG.md'));
  const version = readText(join(root, 'VERSION'));
  return {
    'VERSION': version === null ? null : version.trim(),
    'package.json version': pkg?.version ?? null,
    'package-lock.json version': lock?.version ?? null,
    'package-lock.json packages[""].version': lock?.packages?.['']?.version ?? null,
    'CHANGELOG.md first heading': changelog === null ? null : firstChangelogVersion(changelog),
  };
}

export function compare(found) {
  const authority = found['VERSION'];
  if (typeof authority !== 'string' || !SEMVER.test(authority)) {
    return {
      ok: false,
      authorityFailed: true,
      reason: `VERSION is unreadable or malformed: ${JSON.stringify(authority)}. ` +
        'The authority failed, so the other four locations are not at fault and are not reported.',
      rows: [],
      disagreements: [],
    };
  }
  const rows = LOCATIONS.map((name) => ({ name, value: found[name], ok: found[name] === authority }));
  const disagreements = rows.filter((r) => !r.ok).map((r) => r.name);
  return { ok: disagreements.length === 0, want: authority, rows, disagreements };
}

function main() {
  const r = compare(readLocations(process.cwd()));
  if (r.authorityFailed) {
    console.error(`VERSION_GATE_ABORT: ${r.reason}`);
    process.exit(2);
  }
  for (const row of r.rows) {
    console.log(`${row.ok ? 'ok   ' : 'FAIL '}${row.name.padEnd(38)} = ${JSON.stringify(row.value)}`);
  }
  console.log(r.ok
    ? `VERSION_GATE_OK ${r.want}`
    : `VERSION_GATE_FAILED (${r.disagreements.length} of ${r.rows.length} disagree with VERSION)`);
  process.exit(r.ok ? 0 : 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
```

- [ ] **[T-002-D] Run the test to verify it passes**

Run: `npx vitest run tests/tools/version-gate.test.js`
Expected: PASS, 7 of 7.

- [ ] **[T-002-E] Run the CLI against the live repository**

```bash
node tools/version-gate.mjs
echo "rc=$?"
```

Expected at this point in the plan: five `ok` lines reading `"1.32.1"`, `VERSION_GATE_OK 1.32.1`, `rc=0`. The bump to `1.32.2` happens in T-007, and this run proves the gate reports agreement **before** the version it will verify changes.

- [ ] **[T-002-F] Run the full suite**

Run: `npm test`
Expected: **923 passed / 12 skipped, 37 files passed / 1 skipped** (plus 7 tests in 1 file).

- [ ] **[T-002-G] Stage and commit**

```bash
git add "tools/version-gate.mjs" "tests/tools/version-gate.test.js"
git commit -F <scratchpad>/msg-t002.txt
```

Subject: `feat: track the VERSION-as-authority version gate as repo infrastructure [BUG-046]`

---

## Task 3: `tools/record-parity.mjs`, the third instrument

**Files:**
- Create: `tools/record-parity.mjs`
- Create: `tests/tools/record-parity.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `parseBacklog(text) -> Map<string, { state: string, body: string }>`, `parseChangelog(text) -> { versions: Array<{ version, claims: string[] }>, duplicates: string[] }`, and `checkParity({ backlogText, changelogText, versionFile }) -> { ok, violations: Array<{ direction, id, version, detail }> }`. T-004 imports `checkParity`.

**The discriminator is two-level, and one level is provably not enough.** A bullet-start rule alone reduces 72 id occurrences in this repository's `CHANGELOG.md` to 13 claims and leaves exactly one violation, `1.32.0 claims BUG-045`, which is a **false positive**: that bullet sits under `### Filed`, a section for minted-but-unshipped items. On first contact with real data the single-level form reproduced the retired max-scan's failure class. That false positive ships below as the control fixture.

- [ ] **[T-003-A] Write the failing test file**

Create `tests/tools/record-parity.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { checkParity, parseChangelog } from '../../tools/record-parity.mjs';

const run = (backlogText, changelogText, versionFile = '1.32.2') =>
  checkParity({ backlogText, changelogText, versionFile });

const CLAIMED = [
  '# Changelog', '',
  '## [1.32.2] - 2026-09-29', '',
  '### Fixed',
  '- **[BUG-046]** Release-critical instruments are tracked.', '',
].join('\n');

describe('checkParity', () => {
  it('passes when the claim, the heading, the DONE bullet and VERSION all agree', () => {
    const backlog = [
      '### [X] `[BUG-046]` Release-Critical Instruments Are Repo Infrastructure',
      '* **DONE, shipped as `1.32.2`** on 2026-09-29.',
    ].join('\n');
    expect(run(backlog, CLAIMED).ok).toBe(true);
  });

  // The [BUG-044] state itself, frozen as the deliberate-defect fixture: a heading
  // reading [ ] while the CHANGELOG claims the version shipped.
  it('fails and names the heading when a claimed id is still open', () => {
    const backlog = '### [ ] `[BUG-046]` Release-Critical Instruments Are Repo Infrastructure';
    const r = run(backlog, CLAIMED);
    expect(r.ok).toBe(false);
    expect(r.violations).toContainEqual(
      expect.objectContaining({ direction: 'A', id: 'BUG-046', version: '1.32.2' }),
    );
  });

  // The reverse direction, so the instrument reports on more than a missing flip.
  it('fails naming the disagreement when a DONE bullet names a version VERSION denies', () => {
    const backlog = [
      '### [X] `[BUG-046]` Release-Critical Instruments Are Repo Infrastructure',
      '* **DONE, shipped as `1.31.9`** on 2026-09-29.',
    ].join('\n');
    const r = run(backlog, CLAIMED, '1.32.2');
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => v.direction === 'B' && v.detail.includes('1.31.9'))).toBe(true);
  });

  // THE CONTROL. The single-level (bullet-start only) form reported exactly this as a
  // violation against the real CHANGELOG. It is not one: `### Filed` records a minted
  // item, not a shipped one.
  it('does not read a `### Filed` bullet as a claim', () => {
    const changelog = [
      '# Changelog', '',
      '## [1.32.2] - 2026-09-29', '',
      '### Fixed',
      '- **[BUG-046]** Shipped.', '',
      '### Filed',
      '- **[BUG-048]** Minted, not shipped.', '',
    ].join('\n');
    const backlog = [
      '### [X] `[BUG-046]` Shipped',
      '* **DONE, shipped as `1.32.2`**.',
      '### [ ] `[BUG-048]` Minted but open',
    ].join('\n');
    expect(run(backlog, changelog).ok).toBe(true);
  });

  it('accepts [~] as terminal beside [X]', () => {
    const changelog = [
      '# Changelog', '', '## [1.30.0] - 2026-09-01', '',
      '### Fixed', '- **[BUG-035]** Superseded work.', '',
    ].join('\n');
    const backlog = '### [~] `[BUG-035]` Superseded';
    expect(run(backlog, changelog, '1.30.0').ok).toBe(true);
  });

  it('reports a claim with no heading differently from a heading in the wrong state', () => {
    const r = run('', CLAIMED);
    expect(r.ok).toBe(false);
    expect(r.violations[0].detail).toMatch(/no backlog heading/i);
  });

  // Review Focus 5: a record that disagrees with itself must be reported, not
  // silently resolved to whichever heading came first.
  it('reports two CHANGELOG headings naming the same version', () => {
    const changelog = [
      '# Changelog', '', '## [1.32.2] - 2026-09-29', '', '### Fixed', '- **[BUG-046]** One.', '',
      '## [1.32.2] - 2026-09-28', '', '### Fixed', '- **[BUG-046]** Again.', '',
    ].join('\n');
    expect(parseChangelog(changelog).duplicates).toEqual(['1.32.2']);
  });

  // Vacuous-pass closure: zero claims because the file could not be parsed is a
  // failure, not a pass. This is the shape every retired instrument shared.
  it('fails rather than passing vacuously when the CHANGELOG has no version heading', () => {
    const r = run('### [X] `[BUG-046]` Item', '# Changelog\n\nNothing here.\n');
    expect(r.ok).toBe(false);
    expect(r.violations[0].detail).toMatch(/no version heading/i);
  });

  // Review Focus 1: CRLF must not read as zero claims.
  it('reads CRLF records', () => {
    const backlog = '### [X] `[BUG-046]` Item\r\n* **DONE, shipped as `1.32.2`**.\r\n';
    expect(run(backlog, CLAIMED.replace(/\n/g, '\r\n')).ok).toBe(true);
  });
});
```

- [ ] **[T-003-B] Run the test to verify it fails**

Run: `npx vitest run tests/tools/record-parity.test.js`
Expected: FAIL, all 9 cases, module resolution error naming `tools/record-parity.mjs`.

- [ ] **[T-003-C] Write `tools/record-parity.mjs`**

Create `tools/record-parity.mjs`:

```js
#!/usr/bin/env node
// Record parity between CHANGELOG.md, AGENT-READABLE BACKLOG.md and VERSION.
//
// REPO-ONLY. See the note in tools/id-ceiling.mjs.
//
// Why this exists: [BUG-044] shipped as 1.32.0 and was closed out in project.md, and
// its backlog heading read [ ] with no shipping record for an entire release. Two
// load-bearing documents disagreed about a shipped release and no instrument compared
// them. The heading flip had no owner. This is the owner.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// A claim is a bullet under a section that records a SHIPPED change. `Filed` and
// `Notes` are excluded by name, because a bullet under `### Filed` records a minted
// item and reading it as a claim is a false positive this repository's own CHANGELOG
// produced on the first run of the single-level form.
export const SHIPPED_SECTIONS = new Set(['Added', 'Fixed', 'Changed', 'Removed', 'Deprecated', 'Security']);

const HEADING = /^### \[(.)\] `\[([A-Z]+-\d{3,})\]`/;
const VERSION_HEADING = /^## \[?(\d+\.\d+\.\d+)\]?/;
const SECTION = /^### (.+?)\s*$/;
// Level two: the id marker must be the bullet's FIRST token.
const CLAIM = /^\s*[-*]\s+\*\*\[([A-Z]+-\d{3,})\]\*\*/;
const SHIPPED_AS = /shipped as `?(\d+\.\d+\.\d+)`?/;
const TERMINAL = new Set(['X', '~']);

const lines = (text) => String(text).replace(/\r\n/g, '\n').split('\n');

export function parseBacklog(text) {
  const entries = new Map();
  let cur = null;
  for (const line of lines(text)) {
    const m = line.match(HEADING);
    if (m) { cur = { state: m[1], body: [] }; entries.set(m[2], cur); continue; }
    if (cur) cur.body.push(line);
  }
  const out = new Map();
  for (const [id, e] of entries) out.set(id, { state: e.state, body: e.body.join('\n') });
  return out;
}

export function parseChangelog(text) {
  const versions = [];
  const seen = new Map();
  let cur = null;
  let section = null;
  for (const line of lines(text)) {
    const v = line.match(VERSION_HEADING);
    if (v) {
      cur = { version: v[1], claims: [] };
      versions.push(cur);
      seen.set(v[1], (seen.get(v[1]) ?? 0) + 1);
      section = null;
      continue;
    }
    const s = line.match(SECTION);
    if (s) { section = s[1]; continue; }
    if (!cur || !SHIPPED_SECTIONS.has(section)) continue;
    const c = line.match(CLAIM);
    if (c) cur.claims.push(c[1]);
  }
  const duplicates = [];
  for (const [version, count] of seen) if (count > 1) duplicates.push(version);
  return { versions, duplicates };
}

export function checkParity({ backlogText, changelogText, versionFile }) {
  const violations = [];
  const { versions, duplicates } = parseChangelog(changelogText);

  // Zero claims because nothing parsed is a failure, never a pass. Every instrument in
  // tools/README.md's registry could report success on evidence it had not read.
  if (versions.length === 0) {
    violations.push({ direction: 'PARSE', id: null, version: null, detail: 'CHANGELOG has no version heading' });
    return { ok: false, violations };
  }
  for (const version of duplicates) {
    violations.push({ direction: 'PARSE', id: null, version, detail: `CHANGELOG names version ${version} more than once` });
  }

  const backlog = parseBacklog(backlogText);
  const current = versions[0].version;

  // Direction A, unscoped: every claim maps to a heading in a terminal state.
  for (const { version, claims } of versions) {
    for (const id of claims) {
      const e = backlog.get(id);
      if (!e) {
        violations.push({ direction: 'A', id, version, detail: `${version} claims ${id} but there is no backlog heading for it` });
      } else if (!TERMINAL.has(e.state)) {
        violations.push({ direction: 'A', id, version, detail: `${version} claims ${id} but its heading reads [${e.state}]` });
      }
    }
  }

  // Direction B, scoped to the ids the CURRENT version claims. Unscoped it is red 28
  // times against this repository, because the DONE convention is recent: 34 closed
  // headings, 6 carrying a shipped version. A 28-entry grandfather list maintained
  // forever is a toll, priced out loud and declined. Tightening this is a one-line
  // scope change if the convention back-fills.
  for (const id of versions[0].claims) {
    const e = backlog.get(id);
    if (!e || !TERMINAL.has(e.state)) continue;
    const m = e.body.match(SHIPPED_AS);
    if (!m) {
      violations.push({ direction: 'B', id, version: current, detail: `${id} is closed but carries no bullet naming a shipped version` });
    } else if (versionFile && m[1] !== versionFile) {
      violations.push({ direction: 'B', id, version: current, detail: `${id} names shipped version ${m[1]}, but VERSION reads ${versionFile}` });
    }
  }

  // Direction C, unscoped: a DONE version must exist as a CHANGELOG heading.
  const known = new Set(versions.map((v) => v.version));
  for (const [id, e] of backlog) {
    if (!TERMINAL.has(e.state)) continue;
    const m = e.body.match(SHIPPED_AS);
    if (m && !known.has(m[1])) {
      violations.push({ direction: 'C', id, version: m[1], detail: `${id} names shipped version ${m[1]}, absent from CHANGELOG` });
    }
  }

  return { ok: violations.length === 0, violations };
}

function main() {
  const root = process.cwd();
  const r = checkParity({
    backlogText: readFileSync(join(root, 'AGENT-READABLE BACKLOG.md'), 'utf8'),
    changelogText: readFileSync(join(root, 'CHANGELOG.md'), 'utf8'),
    versionFile: readFileSync(join(root, 'VERSION'), 'utf8').trim(),
  });
  for (const v of r.violations) console.log(`FAIL [${v.direction}] ${v.detail}`);
  console.log(r.ok ? 'RECORD_PARITY_OK' : `RECORD_PARITY_FAILED (${r.violations.length} violations)`);
  process.exit(r.ok ? 0 : 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
```

- [ ] **[T-003-D] Run the test to verify it passes**

Run: `npx vitest run tests/tools/record-parity.test.js`
Expected: PASS, 9 of 9.

- [ ] **[T-003-E] Run the CLI against the live repository**

```bash
node tools/record-parity.mjs
echo "rc=$?"
```

Expected: `RECORD_PARITY_OK`, `rc=0`. This is an **honest green**: the three directions were measured green during the audit, so a green here is the predicted result and not an untested instrument. It is proved by inversion in T-004.

- [ ] **[T-003-F] Run the full suite**

Run: `npm test`
Expected: **932 passed / 12 skipped, 38 files passed / 1 skipped** (plus 9 tests in 1 file).

- [ ] **[T-003-G] Stage and commit**

```bash
git add "tools/record-parity.mjs" "tests/tools/record-parity.test.js"
git commit -F <scratchpad>/msg-t003.txt
```

Subject: `feat: give the backlog heading flip an owner with a record-parity instrument [BUG-046]`

---

## Task 4: The live-repository invariants

**Files:**
- Create: `tests/tools/repo-invariants.test.js`

**Interfaces:**
- Consumes: `scanHeadings` (T-001), `readLocations` and `compare` (T-002), `checkParity` (T-003).
- Produces: nothing importable. This is the suite CI runs, and it is where halt semantics come from.

**Predicted green, and proved anyway.** All three invariants were measured green during the audit, so predicting a red here would be dishonest. The instrument is proved in T-004-D by inverting each assertion and observing exactly the named cases go red.

- [ ] **[T-004-A] Write the live suite**

Create `tests/tools/repo-invariants.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanHeadings } from '../../tools/id-ceiling.mjs';
import { readLocations, compare } from '../../tools/version-gate.mjs';
import { checkParity } from '../../tools/record-parity.mjs';

// These assert about THIS repository, not about the instruments. They live in their
// own file for that reason, following tests/unit/gitignore-block-parity.test.js and
// tests/unit/host-owned-ignore-xor.test.js. CONTRIBUTING.md:50 states the CI gate is
// unconditional, so a red here blocks the merge. That is where halt semantics come
// from; no checklist line enforces anything.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

describe('this repository, at every commit', () => {
  it('agrees with VERSION at all five version locations', () => {
    const r = compare(readLocations(ROOT));
    expect(r.disagreements).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('keeps its CHANGELOG, backlog and VERSION in record parity', () => {
    const r = checkParity({
      backlogText: read('AGENT-READABLE BACKLOG.md'),
      changelogText: read('CHANGELOG.md'),
      versionFile: read('VERSION').trim(),
    });
    expect(r.violations.map((v) => v.detail)).toEqual([]);
    expect(r.ok).toBe(true);
  });

  // The ceiling itself is a query and is not asserted here: its remote leg needs a ref
  // actions/checkout@v4 does not fetch at its default depth, and fetch-depth: 0 was
  // declined because the both-legs filing rule already protects it. Duplicate-id
  // freedom is the assertable half, single leg, and it is the harm the ceiling exists
  // to prevent.
  it('files no id twice', () => {
    expect(scanHeadings(read('AGENT-READABLE BACKLOG.md')).duplicates).toEqual([]);
  });
});
```

- [ ] **[T-004-B] Run the suite**

Run: `npx vitest run tests/tools/repo-invariants.test.js`
Expected: **PASS, 3 of 3, on the first run.** A red here is a tripwire: it means one of the three invariants is genuinely violated in the working tree, and the run output names which.

- [ ] **[T-004-C] Run the full suite**

Run: `npm test`
Expected: **935 passed / 12 skipped, 39 files passed / 1 skipped** (plus 3 tests in 1 file).

- [ ] **[T-004-D] Prove the instrument by inversion, one assertion at a time, reporting case names before reverting**

For each of the three, make the single edit, run `npx vitest run tests/tools/repo-invariants.test.js`, record the failing case name verbatim, then revert the edit and confirm green again before moving to the next.

1. In `tests/tools/repo-invariants.test.js`, change `expect(r.ok).toBe(true)` to `toBe(false)` in the version case. Expected red: exactly `agrees with VERSION at all five version locations`.
2. Same inversion in the parity case. Expected red: exactly `keeps its CHANGELOG, backlog and VERSION in record parity`.
3. Change `toEqual([])` to `toEqual([{ id: 'BUG-001', count: 2 }])` in the duplicate case. Expected red: exactly `files no id twice`.

Each inversion turns **exactly one** named case red. Two or three going red means the assertions are coupled and the suite is not measuring what it claims; halt and report.

- [ ] **[T-004-E] Confirm the file is byte-identical to its pre-inversion state**

```bash
git diff --stat -- "tests/tools/repo-invariants.test.js"
```

Expected: empty output. A non-empty diff means an inversion was not reverted; restore it before committing.

- [ ] **[T-004-F] Stage and commit**

```bash
git add "tests/tools/repo-invariants.test.js"
git commit -F <scratchpad>/msg-t004.txt
```

Subject: `test: assert the version and record invariants against the live repository [BUG-046]`

---

## Task 5: Pin `tools/` as repo-only

**Files:**
- Create: `tests/tools/tools-not-shipped.test.js`

**Interfaces:**
- Consumes: `deployProject` from `lib/installer/deploy.mjs`.
- Produces: nothing importable.

**Why this task exists.** Gate 1 chose `tools/` over `scripts/` precisely because `scripts/` ships: `package.json` `files` lists it, `lib/installer/deploy.mjs:189` copies it to `<cwd>/.claude/scripts/`, and `tests/installer/templates.test.js:86` walks it as a shipped asset dir. That choice is only worth anything if something stops `tools/` drifting into the same state. An assertion that merely checks a string is absent passes for as long as nobody adds it, which is why T-005-A carries a discriminator.

- [ ] **[T-005-A] Write the test**

Create `tests/tools/tools-not-shipped.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deployProject } from '../../lib/installer/deploy.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// The assertion under test, extracted so the discriminator can drive it with a
// deliberately defective manifest. A check that cannot be made to fail is not a check.
export function shipsTools(manifest) {
  return (manifest.files ?? []).some((entry) => entry.replace(/\/$/, '') === 'tools');
}

describe('tools/ is repo-only', () => {
  it('is absent from package.json files', () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    expect(shipsTools(manifest)).toBe(false);
  });

  it('DISCRIMINATOR: the same assertion goes red on a manifest that does ship it', () => {
    expect(shipsTools({ files: ['bin/', 'lib/', 'scripts/', 'tools/'] })).toBe(true);
  });
});

let asset, home;
beforeEach(() => {
  asset = mkdtempSync(join(tmpdir(), 'cc-asset-'));
  home = mkdtempSync(join(tmpdir(), 'cc-home-'));
  mkdirSync(join(asset, 'project-template', '.claude', 'commands'), { recursive: true });
  mkdirSync(join(asset, 'scripts'), { recursive: true });
  mkdirSync(join(asset, 'tools'), { recursive: true });
  writeFileSync(join(asset, 'scripts', 'conductor-db.mjs'), 'db-engine');
  writeFileSync(join(asset, 'tools', 'id-ceiling.mjs'), 'repo-only');
  writeFileSync(join(asset, 'project-template', 'CLAUDE.md'), '# Project Claude Configuration\n');
  writeFileSync(join(asset, 'project-template', 'gitignore'), '.claude/memory/turn-count.txt\n');
  writeFileSync(join(asset, 'project-template', '.claude', 'commands', 'cc-spec.md'), 'spec');
});
afterEach(() => {
  rmSync(asset, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

describe('deployProject', () => {
  it('copies scripts/ but never tools/, at either destination', () => {
    deployProject(asset, home);
    expect(existsSync(join(home, '.claude', 'scripts', 'conductor-db.mjs'))).toBe(true);
    expect(existsSync(join(home, '.claude', 'tools'))).toBe(false);
    expect(existsSync(join(home, 'tools'))).toBe(false);
  });
});
```

- [ ] **[T-005-B] Run the test**

Run: `npx vitest run tests/tools/tools-not-shipped.test.js`
Expected: PASS, 3 of 3. These pass on the first run because they pin behavior that is already correct; the discriminator is what proves the first assertion can fail.

- [ ] **[T-005-C] Run the full suite**

Run: `npm test`
Expected: **938 passed / 12 skipped, 40 files passed / 1 skipped** (plus 3 tests in 1 file).

- [ ] **[T-005-D] Stage and commit**

```bash
git add "tests/tools/tools-not-shipped.test.js"
git commit -F <scratchpad>/msg-t005.txt
```

Subject: `test: pin tools/ as repo-only against the manifest and the installer [BUG-046]`

---

## Task 6: The registry and the closeout checklist

**Files:**
- Create: `tools/README.md`
- Create: `docs/RELEASE-CLOSEOUT.md`
- Modify: `CONTRIBUTING.md`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: the three CLIs from T-001, T-002, T-003.
- Produces: the document the closeout ritual reads, and the registry a maintainer meets before writing a fifth instrument.

- [ ] **[T-006-A] Write `tools/README.md`**

Create `tools/README.md` with these sections, in this order.

**Header.** One paragraph: these are repo-only instruments, `tests/tools/tools-not-shipped.test.js` pins that, and each ships with the test that pins its semantics because an instrument without one is how the registry below got four entries.

**The registry of retired instruments**, four entries, each with its failure mode and citation, copied from the spec's Problem section:

1. The whole-tree `git diff --numstat` superset check, retired at the `1.31.3` closeout. Worked in `1.31.2` by an accident of geometry; reported 71 deletions in `1.31.3` and read as "not a superset" when the truth was the opposite. Cited: `.claude/memory/project.md:1178-1180`.
2. The max-scan id ceiling, retired at the `1.32.0` closeout. Counted id-shaped tokens anywhere, so prose forward references counted as filings, including the plan line stating the ceiling it expected to read after minting. Reported `BUG:46` when the truth was `44`. Cited: `.claude/memory/project.md:1271`.
3. The version gate with a frozen literal target, retired at the `1.32.0` release. **Its failure mode is corrected here:** the record said it compared against "a target it had not been given", but it took `process.argv[2] ?? '1.31.2'`, a literal frozen two releases back. Quote the reproduction verbatim, five `FAIL` lines each reading `"1.32.1"` and `VERSION_GATE_FAILED (5 of 5 disagree)` at rc 1, and state that the archetype reproduces on demand rather than being a memory.
4. The commit-message files and the PR body, lost mid-release during `[BUG-044]`. A **custody** defect rather than a measurement one. Cited: `.claude/memory/project.md:927`, `:1227`, `:1295`.

**The custody correction.** The scratchpad was never withdrawn; it holds 316 files, and what survived are the **retired** forms while the shipped semantics were never written to any file. Recovering the instruments from it would restore three defects.

**The external-writers note (Gate 5).** The user-global `/cc-compact` appends `.claude/memory/session-snapshot.json` to `.gitignore` when absent, and `lib/installer/deploy.mjs:17` appends `.claude/memory/turn-count.txt` through the `project-template/gitignore` merge. Neither is under this repository's control. The convention: **a line kept for an external writer is kept with the writer's name and path in its comment.** The tolerance mechanism already ships: `tests/unit/gitignore-block-parity.test.js` compares only the lines between its markers, which is why it and `appendMissingLinesText` coexist in one file. No instrument here needs to tolerate a writer.

**The direction-B scope note.** 34 closed headings, 6 carrying a shipped-version bullet, 28 not, measured 2026-09-28. Unscoped it is red 28 times; scoped to the current release it is 3 ids and 0 violations. The grandfather list is declined, and tightening B is a one-line scope change if the convention back-fills.

- [ ] **[T-006-B] Write `docs/RELEASE-CLOSEOUT.md`**

Create `docs/RELEASE-CLOSEOUT.md`.

**Header, stated before the steps.** Halt semantics come from the merge gate, not from this document. `CONTRIBUTING.md` states the CI gate is unconditional, and `tests/tools/repo-invariants.test.js` asserts the version and record invariants against the live repository on every push and pull request, so steps 4 and 6 below are **CI-backed**: skipping them does not let a divergence through, it only delays finding it. Step 8 is **not** CI-backed, and the reason is named: the ceiling's `origin/main` leg needs a ref `actions/checkout@v4` does not fetch at its default depth, and `fetch-depth: 0` was declined because the both-legs filing rule already protects it.

**The ordered steps.**

1. Open the release PR from the item's branch.
2. **Bump all five version locations in one commit**, together with the `CHANGELOG` entry, the backlog heading flip and its DONE bullet. See the note below on why the flip lives here.
3. Run `node tools/version-gate.mjs`. Expect five `ok` lines and `VERSION_GATE_OK <version>` at rc 0.
4. Run `node tools/record-parity.mjs`. Expect `RECORD_PARITY_OK` at rc 0.
5. Merge on green.
6. Sync `main`, reporting `N ahead / M behind` before fast-forwarding. A clean sync is a measurement, not an absence.
7. Append the closeout record to `.claude/memory/project.md`, **stating the result of step 4 rather than asserting the records agree**.
8. Run `node tools/id-ceiling.mjs` before minting any id the closeout produces. Both legs must report, or it aborts and prints no number.
9. Push the record commit in the same action that creates it.

**Why the heading flip moved into the release commit, stated as the root-cause fix.** The flip previously happened at closeout, after merge. `[BUG-044]` shipped with its heading never flipped because **the flip had no owner**: plan tasks touch the backlog only when a task names it, and the closeout writes memory without reading the backlog. With record parity asserted live, a release commit whose `CHANGELOG` claims an item while its heading still reads `[ ]` is red on its own PR. **The release commit is now the owner.** Scoping direction A to exempt the in-flight version was rejected, because `[BUG-044]`'s defect lived in a shipped version, so the exemption would excuse exactly the case this exists to catch.

- [ ] **[T-006-C] Add one pointer line to `CONTRIBUTING.md`**

Modify `CONTRIBUTING.md`, directly below the paragraph at `:50` stating the CI gate is unconditional:

```markdown
Releases follow [the closeout checklist](docs/RELEASE-CLOSEOUT.md), whose version and record-parity steps are asserted by that same CI gate.
```

- [ ] **[T-006-D] Add the leaf for `docs/RELEASE-CLOSEOUT.md` BEFORE staging it**

Modify `.gitignore`. `docs/RELEASE-CLOSEOUT.md` sorts before `docs/superpowers/...`, so its leaf goes above the `!/docs/superpowers/` directory re-include, immediately after `/docs/*`:

```
!/docs/RELEASE-CLOSEOUT.md
```

Run `npx vitest run tests/unit/gitignore-block-parity.test.js` only after T-006-E stages the file; the block is compared against `git ls-files`, so the leaf and the staged file must both be present for the comparison to balance.

- [ ] **[T-006-E] Stage all four files with the correct form per file**

```bash
git add "tools/README.md"
git add "docs/RELEASE-CLOSEOUT.md"
echo "rc=$?"
git add -u "CONTRIBUTING.md"
git add -u ".gitignore"
```

Expected: `rc=0` on the `docs/` path. A rc of 1 means the T-006-D leaf is missing or misspelled; fix the leaf, do not reach for `-f`.

- [ ] **[T-006-F] Run the block parity suite and then the full suite**

Run: `npx vitest run tests/unit/gitignore-block-parity.test.js`
Expected: PASS, 4 of 4.

Run: `npm test`
Expected: **938 passed / 12 skipped, 40 files passed / 1 skipped**, unchanged from T-005-C, because this task adds documents and no tests.

- [ ] **[T-006-G] Commit**

```bash
git commit -F <scratchpad>/msg-t006.txt
```

Subject: `docs: record the retired-instruments registry and the release closeout checklist [BUG-046]`

---

## Task 7: The release commit

**Files:**
- Modify: `VERSION`, `package.json`, `package-lock.json` (two locations), `CHANGELOG.md`, `AGENT-READABLE BACKLOG.md`

**Interfaces:**
- Consumes: `tools/version-gate.mjs` and `tools/record-parity.mjs` CLIs.
- Produces: the `1.32.2` release state, and the first production run of both instruments.

**This is AC31's task.** The instruments' first production run is the release that ships them.

- [ ] **[T-007-A] Set `VERSION` to `1.32.2`**

Modify `VERSION`. Single line, replacing `1.32.1` with `1.32.2`.

- [ ] **[T-007-B] Set `package.json` `version` to `1.32.2`**

Modify `package.json:3`.

- [ ] **[T-007-C] Set both `package-lock.json` locations to `1.32.2`**

Modify `package-lock.json`: the top-level `"version"` and `packages[""].version`. npm updates these separately, which is why the gate reads both.

- [ ] **[T-007-D] Add the `CHANGELOG.md` entry above the `1.32.1` heading**

Modify `CHANGELOG.md`. The bullet must use the claim form, id marker first, under a shipped-change section, or record parity will not see it:

```markdown
## [1.32.2] - 2026-09-29

### Added
- **[BUG-046]** Three release-critical instruments are now tracked repository infrastructure under `tools/`, each with the test that pins its semantics: a heading-scoped id ceiling over the working tree union `origin/main`, a version gate taking `VERSION` as its authority, and a record-parity check comparing `CHANGELOG.md`, the backlog and `VERSION`. `tests/tools/repo-invariants.test.js` asserts the version and record invariants against the live repository, so CI enforces them at the merge gate. `docs/RELEASE-CLOSEOUT.md` names the steps in order and states which are CI-backed.
- `tools/README.md` records the four retired instruments with their failure modes, so a maintainer meets the registry before writing a fifth. It corrects the third entry: that gate failed on a hardcoded literal frozen two releases back, not on a missing target, and the defect reproduces on demand.

### Changed
- The backlog heading flip moves into the release commit. It previously happened at closeout and therefore had no owner, which is how `[BUG-044]` shipped with its heading never flipped. With record parity asserted live, a release claiming an item whose heading is still open is red on its own pull request.
```

Nothing under `project-template/` or `lib/` changed, so a fresh install produces byte-identical output to `1.32.1`. That is why this release is PATCH.

- [ ] **[T-007-E] Flip the `[BUG-046]` backlog heading and add its DONE bullet**

Modify `AGENT-READABLE BACKLOG.md`. Surgical single-line edit of the heading:

```
### [X] `[BUG-046]` Release-Critical Instruments Are Repo Infrastructure
```

Then insert, as the first bullet beneath it and above the 2026-09-28 amendment:

```markdown
* **DONE, shipped as `1.32.2` on 2026-09-29.** Three instruments tracked under `tools/` with their tests, the version and record invariants asserted live in CI, `tools/README.md` carrying the four-entry registry, and `docs/RELEASE-CLOSEOUT.md` created because the amendment's "named in the ritual's own checklist" presupposed a document this repository did not have. **The heading flip you are reading moved into the release commit, which is this item's root-cause fix stated structurally:** the flip now has an owner.
```

- [ ] **[T-007-F] Run the version gate, which is its first official act**

```bash
node tools/version-gate.mjs
echo "rc=$?"
```

Expected: five `ok` lines reading `"1.32.2"`, `VERSION_GATE_OK 1.32.2`, `rc=0`. A `FAIL` on any line names the location that did not move, and the fix is that location, not the gate.

- [ ] **[T-007-G] Run record parity against this item's own closeout (AC31)**

```bash
node tools/record-parity.mjs
echo "rc=$?"
```

Expected: `RECORD_PARITY_OK`, `rc=0`. This asserts, by tool rather than by eye, that `[BUG-046]`'s heading reads `[X]`, that its DONE bullet names `1.32.2`, and that `1.32.2` agrees with `VERSION` and the first `CHANGELOG` heading. Record the output verbatim for the closeout.

- [ ] **[T-007-H] Run the full suite**

Run: `npm test`
Expected: **938 passed / 12 skipped, 40 files passed / 1 skipped**, all green including `tests/tools/repo-invariants.test.js`, which now reads `1.32.2` at all five locations and sees the closed heading.

- [ ] **[T-007-I] Stage all five files and commit**

```bash
git add -u "VERSION"
git add -u "package.json"
git add -u "package-lock.json"
git add -u "CHANGELOG.md"
git add -u "AGENT-READABLE BACKLOG.md"
git commit -F <scratchpad>/msg-t007.txt
```

Subject: `1.32.2 - BUG-046: release-critical instruments as tracked repo infrastructure`

---

## Task 8: The pull request

- [ ] **[T-008-A] Push the branch**

```bash
git push -u origin "fix/bug-046-release-critical-instruments"
```

- [ ] **[T-008-B] Open the PR with a body written to a file, never a heredoc**

Write the body to `<scratchpad>/pr-body-046.md` with the Write tool, then:

```bash
gh pr create --title "1.32.2 - BUG-046: release-critical instruments as tracked repo infrastructure" --body-file <scratchpad>/pr-body-046.md
```

The body states: the four-entry registry as the problem; the three instruments and where they live; that `scripts/` was rejected because it ships and `tools/` is pinned repo-only with a discriminator; that CI enforces the version and record invariants at the merge gate; that the heading flip moved into the release commit as the root-cause fix; the boundary table with every predicted count met; and the inversion proof's three case names from T-004-D.

- [ ] **[T-008-C] Confirm CI green before requesting review**

```bash
gh pr checks --watch
```

Expected: the Test workflow passing. `tests/tools/repo-invariants.test.js` running green in CI is the first time this item's own gate operates on infrastructure other than a developer's laptop.

---

## Task 9: Closeout

Runs **after** the PR merges. The heading flip and DONE bullet are already in the release commit, so this task records rather than repairs.

- [ ] **[T-009-A] Sync `main` and report the measurement**

```bash
git switch main
git fetch origin main
echo "ahead: $(git rev-list --count origin/main..main)"
echo "behind: $(git rev-list --count main..origin/main)"
git merge --ff-only origin/main
```

Report the counts before fast-forwarding. `0 ahead / 1 behind` is a clean squash sync. Anything else is the stranding case and gets the rebase-and-skip ritual with upstream-superset evidence gathered first.

- [ ] **[T-009-B] Re-run both instruments on merged `main`**

```bash
node tools/version-gate.mjs
node tools/record-parity.mjs
node tools/id-ceiling.mjs
```

Expected: `VERSION_GATE_OK 1.32.2`, `RECORD_PARITY_OK`, and a ceiling of `BUG-047` with `next mintable BUG-048` from both legs.

- [ ] **[T-009-C] Append the closeout record to `.claude/memory/project.md`**

Modify `.claude/memory/project.md`. The record states the instruments' outputs verbatim rather than asserting the records agree, names every predicted boundary against what it measured, carries the three inversion case names from T-004-D, and records that the heading flip moved into the release commit and why.

- [ ] **[T-009-D] Stage and commit the closeout, then push in the same action**

```bash
git add -u ".claude/memory/project.md"
git commit -F <scratchpad>/msg-t009.txt
git push origin main
```

Subject: `docs: record the 1.32.2 closeout and the instruments' first production run [BUG-046]`

The push is in the same action that creates the commit: an owner-scoped record commit on `main` is never left local.

---

## Test List

- [ ] `tests/tools/id-ceiling.test.js` (6): the forward-reference decoy, a four-digit id, duplicate reporting, state-character agnosticism, CRLF, trailing whitespace.
- [ ] `tests/tools/version-gate.test.js` (7): five-way agreement, one disagreement per checked location (4), a malformed authority, an unreadable location.
- [ ] `tests/tools/record-parity.test.js` (9): the agreeing case, the `[BUG-044]` state, its reverse, the `### Filed` control, `[~]` terminal, a claim with no heading, duplicate version headings, the vacuous-pass guard, CRLF.
- [ ] `tests/tools/repo-invariants.test.js` (3, live): version agreement, record parity, duplicate-id freedom.
- [ ] `tests/tools/tools-not-shipped.test.js` (3): the manifest assertion, its discriminator, and the deploy assertion.

No integration seam is added and no UI is affected, so there is no E2E test.

## Commit Order

| Commit | Task | Contents |
|---|---|---|
| 1 | T-000 | plan file, `.gitignore` leaf |
| 2 | T-001 | `tools/id-ceiling.mjs`, its test |
| 3 | T-002 | `tools/version-gate.mjs`, its test |
| 4 | T-003 | `tools/record-parity.mjs`, its test |
| 5 | T-004 | `tests/tools/repo-invariants.test.js` |
| 6 | T-005 | `tests/tools/tools-not-shipped.test.js` |
| 7 | T-006 | `tools/README.md`, `docs/RELEASE-CLOSEOUT.md`, `CONTRIBUTING.md`, `.gitignore` leaf |
| 8 | T-007 | the five version locations, `CHANGELOG.md`, the backlog flip and DONE bullet |
| 9 | T-009 | `.claude/memory/project.md`, on `main`, after merge |

## Predicted Boundaries

| After | Tests | Files | Suite |
|---|---|---|---|
| baseline | 910 / 12 | 35 / 1 | all |
| T-000 | 910 / 12 | 35 / 1 | `gitignore-block-parity` green throughout, because the leaf precedes the staging |
| T-001 | 916 / 12 | 36 / 1 | `tests/tools/id-ceiling.test.js` |
| T-002 | 923 / 12 | 37 / 1 | `tests/tools/version-gate.test.js` |
| T-003 | 932 / 12 | 38 / 1 | `tests/tools/record-parity.test.js` |
| T-004 | 935 / 12 | 39 / 1 | `tests/tools/repo-invariants.test.js`, green on first run |
| T-005 | 938 / 12 | 40 / 1 | `tests/tools/tools-not-shipped.test.js` |
| T-006 | 938 / 12 | 40 / 1 | unchanged; documents only |
| T-007 | 938 / 12 | 40 / 1 | unchanged; `repo-invariants` now reads `1.32.2` |

**Predicted reds, named by suite and by case before they run.** Three, all in `T-00N-B` steps, all module resolution failures against a file the next step creates: `id-ceiling.test.js` all 6, `version-gate.test.js` all 7, `record-parity.test.js` all 9. A red with any other cause at those points means the test file is wrong, not the missing module.

**No `gitignore-block-parity` red is predicted anywhere in this plan.** The spec's boundary table predicted three, on the force-stage-then-regenerate ordering. Leaf-first removes all three, measured at the spec commit: with the leaf present, plain `git add` exits 0 and the commit never passes through a red state. Both orderings reach identical content verified by the same test.

**The one honest green:** `tests/tools/repo-invariants.test.js` at T-004-B. Predicted green because all three invariants were measured green during the audit, and proved anyway at T-004-D by three inversions, each turning exactly one named case red, with the case names reported before the revert.

## Identified Risks

1. **The release commit's size.** T-007 touches six files in one commit, which is against the usual grain. It is required: splitting the version bump from the `CHANGELOG` entry leaves the version invariant red between the two commits, and splitting the heading flip from the `CHANGELOG` claim leaves direction A red. **Caught early by** running T-007-F and T-007-G before staging anything in T-007-I.
2. **A `CHANGELOG` bullet that does not use the claim form.** If T-007-D's bullet leads with prose rather than the bolded id marker, record parity sees zero claims for `1.32.2` and passes vacuously on direction B. **Caught early by** T-007-G, which must report `RECORD_PARITY_OK` **and** by the fact that a claim-less version would leave the `[BUG-046]` DONE bullet unchecked. If in doubt, temporarily flip the heading to `[ ]` and confirm the run goes red naming `1.32.2/BUG-046`, then flip it back.
3. **The `docs/RELEASE-CLOSEOUT.md` leaf's sort position.** It sorts **before** `docs/superpowers/`, so it does not go at the end of the `docs` leaf run. Putting it in the wrong place leaves `gitignore-block-parity`'s exact-equality-in-order case red while the leaf-set-completeness case passes, which reads confusingly. **Caught early by** T-006-F, and the case split itself tells you it is an ordering problem rather than a missing leaf.
4. **An inversion left unreverted in T-004-D.** A suite whose assertion is inverted still passes, silently asserting the opposite of what it claims. **Caught early by** T-004-E's `git diff --stat`, which must print nothing.
5. **`origin/main` stale at T-001-E.** Without a fresh fetch, the remote leg reads an old backlog and the ceiling disagrees between legs for a reason that is not a defect. **Caught early by** the explicit `git fetch origin main --quiet` in that step.
6. **Guard 3 denying a heredoc.** Every `.mjs` and every commit-message file in this plan is written with the Write tool and committed with `git commit -F`, never `cat <<EOF`. A denial here is `[BUG-047]`'s family and is routed around, never bypassed.
7. **`sweepStaleRootScripts` and the new directory.** It compares the bundled `scripts/` set against a host's root `scripts/` set, both read at runtime, so adding `tools/` cannot affect it. Verified by reading `lib/installer/deploy.mjs:118-130`; T-005's deploy assertion covers the outcome regardless.
8. **A consumer install picking up `tools/`.** Only if someone adds it to `package.json` `files` or to `deploy.mjs`. **Caught early by** T-005-A, whose discriminator proves the manifest assertion can actually fail.
