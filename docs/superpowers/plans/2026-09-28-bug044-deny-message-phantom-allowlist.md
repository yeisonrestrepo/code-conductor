# BUG-044 Deny-Message Phantom Allowlist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every sentence Guard 3's denial prints actionable by someone, and make the file it names exist.

**Architecture:** Three changes, message-first. `g3Blocked` gains one parameter so the allowlist sentence rides only on a pattern denial, where the allowlist is actually consulted. `memory/bash-scan-allowlist.txt` flips from `skip` to `seed` in the BUG-039 policy table and ships as a comment-only template. The two records the seed makes false, `templates.test.js:143` and `README.md:189`, are restated rather than deleted.

**Tech Stack:** Node 22+, vitest, zero runtime dependencies. No new dependency.

**Spec:** `docs/superpowers/specs/2026-09-28-bug044-deny-message-phantom-allowlist-design.md` (21 ACs, approved at `2f59b68`)

**Target release:** `1.32.0`

## Global Constraints

- **The frozen authority `tests/fixtures/guard3-reference.sh` is NOT modified.** The deny message is port-only. The sanctioned exception count in its header stays at **four** and `EXCEPTIONS` stays at exactly **one** member. Verified: the authority prints `BASH SCAN BLOCKED` plus a one-line detail at `:440`, `:456` and `:497` and names no allowlist.
- **No verdict changes.** Zero corpus rows move. `tests/fixtures/guard3-corpus.js` is untouched and `guard3.test.js`'s `CORPUS` length assertion stays at 127.
- **The port ships as a byte-identical mirrored pair.** Any step touching `.claude/hooks/pre-tool-use.mjs` touches `project-template/.claude/hooks/pre-tool-use.mjs` in the same step. Pinned by `tests/installer/templates.test.js:96-98`.
- **Success is truthfulness, not uptake.** Uptake remaining at zero is the design working. No acceptance criterion may be satisfied by making the allowlist easier to self-serve.
- **Staging by tracked-ness, always with an explicit path.** `git add -u <path>` for tracked, `git add -f <path>` for a new file under an ignored directory, plain `git add <path>` otherwise. `docs/` and `.claude/` are both ignored.
- **All plan and tracking state updates are surgical single-line edits** (BUG-003 invariant).
- **No em-dashes in authored output.**
- **Amending any commit requires an explicit go-ahead.** Default is folding into the next commit.
- **The pre-commit hook is never weakened, edited or disabled.**
- **Owner-scoped record commits on `main` are pushed in the same action that creates them.**

## Measured Baseline (before Task 0, at `50795a7`)

| suite | tests |
|---|---|
| `tests/hooks/pre-tool-use-contract.test.js` | 16 |
| `tests/installer/templates.test.js` | 34 |
| `tests/installer/deploy.test.js` | 45 |
| `tests/installer/host-owned.test.js` | 9 |
| **whole suite** | **897 passed / 12 skipped, 33 files** |

All five version locations read `1.31.3`: `VERSION`, `package.json`, `package-lock.json` (two places), `CHANGELOG.md` first heading.

## Predicted Boundaries, with suites named

Any deviation in **count OR suite** is a tripwire: halt, do not patch forward.

| after | whole suite | suites that move |
|---|---|---|
| T-000 | 897 | none (plan file only) |
| T-001 | **900** | `pre-tool-use-contract.test.js` 16 to 19 |
| T-002 | **902** | `templates.test.js` 34 to 35, `deploy.test.js` 45 to 46 |
| T-003 | 902 | none (docs and backlog only) |
| T-004 | 902 | none (version and changelog only) |
| T-005 | 902 | none (plan state and record only) |

`host-owned.test.js` stays at **9 and green throughout**, including across T-002's policy flip. Verified reason: its fixture writes only `memory/project.md` and `memory/context-threshold.txt` into `src`, and `seedHostOwned` skips a seed entry whose source is absent (`lib/installer/host-owned.mjs:88`), so the asserted return list at `:62` is unchanged. **It therefore provides no coverage that the allowlist is seeded; T-002's new `deploy.test.js` case is that coverage.**

## File Structure

| file | responsibility | action |
|---|---|---|
| `.claude/hooks/pre-tool-use.mjs` | the shipped guard; `g3Blocked` builds every denial's reason | modify `:432-440`, `:470` |
| `project-template/.claude/hooks/pre-tool-use.mjs` | **byte-identical mirror**, moved in the same step, never alone | modify identically |
| `project-template/.claude/memory/bash-scan-allowlist.txt` | the comment-only seed template that teaches the entry format | **create** |
| `lib/installer/host-owned.mjs` | the BUG-039 policy table | modify one row |
| `tests/hooks/pre-tool-use-contract.test.js` | one case per denial kind, presence and absence | modify |
| `tests/installer/templates.test.js` | retire `:143`, assert the live mechanism and the template's inertness | modify |
| `tests/installer/deploy.test.js` | the create-when-absent half of AC15 | modify |
| `README.md` | the documented allowlist contract | modify `:189` |
| `AGENT-READABLE BACKLOG.md` | BUG-044 amendment note, BUG-045 filing | modify |
| `CHANGELOG.md`, `VERSION`, `package.json`, `package-lock.json` | the release | modify |

---

### Task 0: Commit the plan

**Files:**
- Create: `docs/superpowers/plans/2026-09-28-bug044-deny-message-phantom-allowlist.md` (this file)

- [ ] [T-000-A] Stage the plan file. It is new and under the ignored `docs/`, so the `-f` form is required.

```bash
git add -f "docs/superpowers/plans/2026-09-28-bug044-deny-message-phantom-allowlist.md"
```

- [ ] [T-000-B] Commit with this exact subject.

```bash
git commit -m "docs: add the BUG-044 deny-message implementation plan"
```

---

### Task 1: The conditional remedy (Gates 2 and 4)

Satisfies **AC1 through AC9**. Message-first per the Gate 1 sequencing ruling.

**Files:**
- Modify: `.claude/hooks/pre-tool-use.mjs:432-440` and `:470`
- Modify: `project-template/.claude/hooks/pre-tool-use.mjs` (identical)
- Test: `tests/hooks/pre-tool-use-contract.test.js`

**Interfaces:**
- Produces: `g3Blocked(detail, { allowlistApplies = false } = {})`. The options object is chosen over a bare positional boolean so the one call site that opts in reads as `{ allowlistApplies: true }` rather than an opaque `true`. Default `false` means a future call site omits the sentence rather than promising a remedy that may not apply.
- Produces: module-level constants `G3_ALTERNATIVES` and `G3_OPERATOR_POLICY`, declared immediately above `g3Blocked`.
- Consumes: nothing from other tasks.

- [ ] [T-001-A] Write the three failing tests in `tests/hooks/pre-tool-use-contract.test.js`. Insert them inside the existing top-level `describe` that holds the Guard 3 routing cases, immediately after the `it('leaves an ordinary Bash command alone', ...)` case. The `fire(payload, env?)` helper already exists in this file and returns `{ status, decision, stderr }`.

```js
  // [BUG-044] The allowlist sentence rides only on a pattern denial. g3AllowlistCovers runs
  // at the end of guard3BashScan; the length and malformed denials return before it, so on
  // those two the allowlist cannot lift the block. Each absence case asserts its positive
  // half in the same breath, so a denial that failed to fire cannot satisfy the absence
  // vacuously.
  it('a pattern denial names the allowlist as operator policy', () => {
    const r = fire({ tool_name: 'Bash', tool_input: { command: 'cat *.ts' } });
    expect(r.decision.permissionDecision).toBe('deny');
    expect(r.decision.permissionDecisionReason).toMatch(/BASH SCAN BLOCKED/);
    expect(r.decision.permissionDecisionReason).toMatch(/Pattern ids: P4/);
    expect(r.decision.permissionDecisionReason).toMatch(/Authorized alternatives/);
    expect(r.decision.permissionDecisionReason).toContain('.claude/memory/bash-scan-allowlist.txt');
    expect(r.decision.permissionDecisionReason).toMatch(/operator policy/);
    expect(r.decision.permissionDecisionReason).toMatch(/must not add it to clear its own denial/);
  });

  it('a length denial carries no allowlist sentence, because the allowlist is never consulted', () => {
    const r = fire({ tool_name: 'Bash', tool_input: { command: 'echo ' + 'x'.repeat(8193) } });
    expect(r.decision.permissionDecision).toBe('deny');
    expect(r.decision.permissionDecisionReason).toMatch(/exceeds the maximum scan length/);
    expect(r.decision.permissionDecisionReason).toMatch(/Authorized alternatives/);
    expect(r.decision.permissionDecisionReason).not.toContain('bash-scan-allowlist');
  });

  it('a malformed denial carries no allowlist sentence', () => {
    const r = fire({ tool_name: 'Bash', tool_input: { command: "echo 'unclosed" } });
    expect(r.decision.permissionDecision).toBe('deny');
    expect(r.decision.permissionDecisionReason).toMatch(/Malformed shell syntax/);
    expect(r.decision.permissionDecisionReason).toMatch(/Authorized alternatives/);
    expect(r.decision.permissionDecisionReason).not.toContain('bash-scan-allowlist');
  });
```

- [ ] [T-001-B] Run the suite and confirm the predicted red.

```bash
npx vitest run tests/hooks/pre-tool-use-contract.test.js
```

Expected: **19 tests, 3 failed, 16 passed.** The two absence cases fail on `not.toContain('bash-scan-allowlist')`; the presence case fails on `/operator policy/`. All three denial payloads are confirmed to deny already: pattern gives `Pattern ids: P4.`, length gives `exceeds the maximum scan length (8192 chars).`, malformed gives `Malformed shell syntax (unclosed quote), blocked as a precaution.` If any case instead fails on its **positive** half, the payload stopped denying and that is a tripwire, not a red.

- [ ] [T-001-C] Edit `.claude/hooks/pre-tool-use.mjs`. Replace the body of `g3Blocked` at `:432-440` and add the two constants directly above it, keeping the existing `CC_GUARD3_WARN` comment block in place.

```js
// The three alternatives are the only remedy every denial shares, so they are the
// message's constant part.
const G3_ALTERNATIVES =
  'Authorized alternatives: 1. Grep for targeted content search with file and pattern scope. ' +
  '2. Glob for path listing without file content. 3. Read with an explicit offset and limit.';

// The allowlist sentence rides ONLY on a pattern denial. g3AllowlistCovers runs at the end
// of guard3BashScan; the length and malformed denials return before it, so on those two the
// allowlist cannot lift the block and naming it would promise a remedy that provably does
// not apply. It is worded as operator policy because the agent reading it mid-denial is
// instructed never to bypass this hook: it may propose an entry, never self-serve one.
// Uptake staying at zero is that instruction working, not a discoverability failure.
// [BUG-044]
const G3_OPERATOR_POLICY =
  'A permanent exception is operator policy, not a self-serve step: entries live in ' +
  '.claude/memory/bash-scan-allowlist.txt, are reviewed in git, and an agent may propose ' +
  'one but must not add it to clear its own denial.';

function g3Blocked(detail, { allowlistApplies = false } = {}) {
  const decide = process.env.CC_GUARD3_WARN ? ask : deny;
  const policy = allowlistApplies ? ` ${G3_OPERATOR_POLICY}` : '';
  return decide(`BASH SCAN BLOCKED. ${detail} ${G3_ALTERNATIVES}${policy}`);
}
```

- [ ] [T-001-D] In the same file, opt the pattern denial in at `:470` (the line is the last statement of `guard3BashScan`). This is the only call site that passes the option.

```js
  return g3Blocked(`The command triggered a mass content-dump pattern. Pattern ids: ${ids.join(' ')}.`, { allowlistApplies: true });
```

- [ ] [T-001-E] Mirror both edits into `project-template/.claude/hooks/pre-tool-use.mjs`. The two files must be byte-identical. Verify before moving on:

```bash
diff .claude/hooks/pre-tool-use.mjs project-template/.claude/hooks/pre-tool-use.mjs && echo "MIRROR IDENTICAL"
```

Expected: `MIRROR IDENTICAL` with no diff output. **If `diff` prints anything, stop.** A one-sided edit is the BUG-041 crossover failure repeating.

- [ ] [T-001-F] Run the three affected suites and confirm green.

```bash
npx vitest run tests/hooks/pre-tool-use-contract.test.js tests/hooks/guard3-port.test.js tests/installer/templates.test.js
```

Expected: **all green.** `pre-tool-use-contract.test.js` at **19**, `guard3-port.test.js` unchanged at **143**, `templates.test.js` unchanged at **34**. `guard3-port.test.js:46` and `pre-tool-use-contract.test.js:99` match only `/BASH SCAN BLOCKED/` and are unmodified (AC8); `pre-tool-use-contract.test.js:174`'s warn-ask identity passes because both verdicts leave through the single `g3Blocked` construction site (AC7); `templates.test.js:96-98` proves the mirror (AC1) and `:130` proves the new constants introduced no regex shorthand.

- [ ] [T-001-G] Run the whole suite and confirm the predicted boundary.

```bash
npx vitest run 2>&1 | tail -6
```

Expected: **900 passed / 12 skipped, 33 files.** Deviation in count or suite is a tripwire.

- [ ] [T-001-H] Confirm the authority was not touched (AC9).

```bash
git status --short tests/fixtures/
```

Expected: no output. `tests/fixtures/guard3-reference.sh` and `guard3-corpus.js` are unmodified.

- [ ] [T-001-I] Stage the four files. All are tracked, so `-u` with explicit paths.

```bash
git add -u .claude/hooks/pre-tool-use.mjs project-template/.claude/hooks/pre-tool-use.mjs tests/hooks/pre-tool-use-contract.test.js
```

- [ ] [T-001-J] Commit.

```bash
git commit -m "fix: print the allowlist remedy only where it can apply [BUG-044]"
```

---

### Task 2: The seed and the collision (Gate 1)

Satisfies **AC10 through AC16**. The step order is load-bearing: **retire `:143` first, flip the policy second, ship the file third.** `:143` (the template must not exist) and `:172` (every seed row must have a source) are mutually unsatisfiable while the policy is `seed` and `:143` still stands, so retiring it first means no intermediate state is contradictory. Every intermediate red below is satisfiable by the next step.

**Files:**
- Modify: `tests/installer/templates.test.js:143-145`
- Modify: `lib/installer/host-owned.mjs:34`
- Create: `project-template/.claude/memory/bash-scan-allowlist.txt`
- Modify: `tests/installer/deploy.test.js`

**Interfaces:**
- Consumes: nothing from Task 1. This task is independent of the message change and could run first; it runs second only because Gate 1 ruled the sequencing message-first.
- Produces: `PROJECT_HOST_OWNED.get('memory/bash-scan-allowlist.txt') === 'seed'`, consumed by `templates.test.js:168` and `:172` and by `seedHostOwned`.

- [ ] [T-002-A] In `tests/installer/templates.test.js`, **replace** the `it('ships no allowlist file, so the installer can never overwrite one', ...)` case at `:143-145` together with its two-line comment above it. Do not delete it without a replacement. Then add the inertness case immediately after. Both go inside the same `describe` block the old case occupied.

```js
  // [BUG-044] replaces the assertion that no allowlist file is shipped. That test's stated
  // premise, "since deployProject copies the template wholesale", died with BUG-039:
  // deploy.mjs filters the copy through hostOwnedFilter, which excludes every table path
  // regardless of policy, and seedHostOwned then writes only when the target is absent. What
  // protects operator policy now is the row, not the file's absence, and deploy.test.js
  // proves a host file survives a re-run even when the template ships one.
  // Classification: ASSERTION-RETIREMENT, the BUG-039 shape. The assertion changed and got
  // stronger: it now pins the mechanism that carries the load instead of a proxy for it.
  it('declares the allowlist a seed row and ships its template, so a re-run cannot overwrite operator policy', () => {
    expect(PROJECT_HOST_OWNED.get('memory/bash-scan-allowlist.txt')).toBe('seed');
    expect(existsSync(join(root, 'project-template/.claude/memory/bash-scan-allowlist.txt'))).toBe(true);
  });

  // The seed must change no verdict. Parsed by g3ReadAllowlist's own rule: trim, drop
  // blanks, drop comments. A comment-only file is behaviorally identical to no file, which
  // is the honest limit of this remedy: its value is that the named path resolves and its
  // header teaches the format.
  it('ships an allowlist template that parses to zero entries', () => {
    const raw = readText('project-template/.claude/memory/bash-scan-allowlist.txt');
    const entries = raw.split('\n').map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('#'));
    expect(entries).toEqual([]);
  });
```

- [ ] [T-002-B] Run `templates.test.js` and confirm the first predicted red.

```bash
npx vitest run tests/installer/templates.test.js
```

Expected: **35 tests, 2 failed, 33 passed.** The seed-row case fails because the policy is still `skip`; the inertness case fails because `readText` cannot find the file. `:168` and `:172` both still **pass**, which is the proof that no contradictory state exists: nothing marked `skip` is shipped, and no `seed` row lacks a source.

- [ ] [T-002-C] Flip the one row in `lib/installer/host-owned.mjs`. The line currently reads `['memory/bash-scan-allowlist.txt', 'skip'],` inside `PROJECT_HOST_OWNED`. Change only the policy string and extend the block comment above the table so the row's reason travels with it.

```js
  ['memory/bash-scan-allowlist.txt', 'seed'],
```

Then amend the comment above `PROJECT_HOST_OWNED`, which currently says every `skip` below is a file the template must never start shipping. Append one sentence:

```js
// bash-scan-allowlist.txt is the exception and the reason the policy is a table: it is
// host-owned like the skips, but BUG-044 ships a comment-only template for it so the deny
// message names a path that resolves. hostOwnedFilter excludes it from the copy and
// seedHostOwned writes it only when absent, so shipping the filename cannot overwrite
// operator policy the way it could before BUG-039 filtered the copy.
```

- [ ] [T-002-D] Run `templates.test.js` and confirm the second predicted red.

```bash
npx vitest run tests/installer/templates.test.js
```

Expected: **35 tests, 3 failed, 32 passed.** The two new cases still fail on the missing file, and `:172` ("project has a template source for every seed and merge entry") now fails because the `seed` row has no source. `:168` still passes. **This is the only state where three fail, and the next step clears all three.**

- [ ] [T-002-E] Run `host-owned.test.js` and confirm it is unaffected by the flip.

```bash
npx vitest run tests/installer/host-owned.test.js
```

Expected: **9 passed.** Its `seedHostOwned` fixture writes only `memory/project.md` and `memory/context-threshold.txt` into `src`, and `seedHostOwned` skips a seed entry whose source is absent, so the asserted list at `:62` is unchanged. **If this suite goes red, the missing-source skip is not behaving as read and that is a tripwire.**

- [ ] [T-002-F] Create `project-template/.claude/memory/bash-scan-allowlist.txt` with exactly this content. Every line is a comment or blank, so it parses to zero entries. The header carries the BUG-037 allowlist contract verbatim (AC12).

```
# Guard 3 bash-scan allowlist. OPERATOR POLICY, reviewed in git.
#
# This file is empty on purpose. It disarms nothing until you add a line.
#
# Format:
#   One entry per line. Blank lines and lines starting with # are ignored, and
#   surrounding whitespace is trimmed.
#
#   An entry ending in / covers paths under that prefix, and rejects any suffix
#   that walks up the tree with .. so an entry cannot become a traversal gift.
#   Any other entry matches a whole command token.
#
#   Entries match LITERALLY. Regex metacharacters carry no special meaning, so
#   file.ts matches file.ts and nothing else.
#
# Review rule:
#   Every line here disarms Guard 3 patterns for matching commands, so give each
#   entry a comment saying why it exists and ideally the issue it came from. An
#   uncommented entry is a review smell.
#
# Example, shown commented out so this file stays inert:
#   # docs/ is a small hand-written tree; bulk reads there are intended [BUG-000]
#   docs/
#
# An agent that hits a Guard 3 denial may propose an entry here. It must not add
# one to clear its own denial: that is the bypass the project forbids. Permanent
# exceptions are the operator's call, which is why they are reviewed in git.
#
# The installer creates this file only when it is absent and never overwrites it.
```

- [ ] [T-002-G] Run `templates.test.js` and confirm green.

```bash
npx vitest run tests/installer/templates.test.js
```

Expected: **35 passed.** All three previously failing cases clear together: the seed-row case, the inertness case, and `:172`. `:168` never moved.

- [ ] [T-002-H] Add the create-when-absent case to `tests/installer/deploy.test.js`, immediately **before** the existing `it('leaves a host-created bash-scan-allowlist.txt byte-identical even when the template ships one', ...)` at `:347`, so the pair reads create-then-preserve in file order. Use the same `asset`, `home` and `claude` fixtures the neighbouring cases use.

```js
  // [BUG-044] The other half of the contract: the message names a path, so a fresh deploy
  // must make that path exist. The case below this one proves a re-run cannot overwrite it.
  it('creates the allowlist from the template when the host has none', () => {
    const p = join(claude, 'memory', 'bash-scan-allowlist.txt');
    writeFileSync(join(asset, 'project-template', '.claude', 'memory', 'bash-scan-allowlist.txt'), '# SEED HEADER\n');
    deployProject(asset, home);
    expect(readFileSync(p, 'utf8')).toBe('# SEED HEADER\n');
  });
```

- [ ] [T-002-I] Run `deploy.test.js` and confirm green.

```bash
npx vitest run tests/installer/deploy.test.js
```

Expected: **46 passed.** The new case passes because the row is now `seed`; the existing `:347` case still passes because `hostOwnedFilter` excludes the path from the copy and `seedHostOwned` skips a present target.

- [ ] [T-002-J] Run the whole suite and confirm the predicted boundary.

```bash
npx vitest run 2>&1 | tail -6
```

Expected: **902 passed / 12 skipped, 33 files.** Deviation in count or suite is a tripwire.

- [ ] [T-002-K] Stage the four paths. Three are tracked; the new template is under the ignored `.claude` directory name inside `project-template/`, so it needs `-f`.

```bash
git add -u lib/installer/host-owned.mjs tests/installer/templates.test.js tests/installer/deploy.test.js
git add -f "project-template/.claude/memory/bash-scan-allowlist.txt"
```

- [ ] [T-002-L] Commit. The body must name the classification, per AC14.

```bash
git commit -m "fix: seed the allowlist so the deny message names a real file [BUG-044]" \
  -m "The row flips from skip to seed and a comment-only template ships with it.

templates.test.js's 'ships no allowlist file' assertion is RETIRED AND REPLACED,
not deleted. Classification: ASSERTION-RETIREMENT, the BUG-039 shape, where an
assertion encoding retired behavior is updated to the specified one and gets
stronger. Its stated premise, that deployProject copies the template wholesale,
died with BUG-039: the copy is filtered through hostOwnedFilter, which excludes
every table path regardless of policy. The replacement pins the row's policy and
the template's presence, which is the mechanism that carries the load now.

deploy.test.js:347 already proved a host allowlist survives a re-run even when
the template ships one. This task adds the other half: a fresh deploy creates it.

The seed is behaviorally inert by design. A comment-only file parses to zero
entries, so no verdict changes; its value is that the named path resolves and
its header teaches the format and the review rule."
```

---

### Task 3: The records (Gates 2 and 3)

Satisfies **AC17, AC19, AC20, AC21**. AC18 is already satisfied by the spec landed at `2f59b68`.

**Files:**
- Modify: `README.md:189`
- Modify: `AGENT-READABLE BACKLOG.md`

**Interfaces:**
- Consumes: `PROJECT_HOST_OWNED`'s `seed` row from Task 2, which is what makes the current README sentence false.

- [ ] [T-003-A] In `README.md:189`, replace the sentence **"The installer never ships or overwrites this file."** with the true contract. Leave the rest of the paragraph, which documents the entry format, unchanged.

```
The installer ships this file once as a commented template and creates it only when it is absent; it never overwrites an existing one.
```

- [ ] [T-003-B] Re-run the id ceiling with both legs before any filing (AC21). The next mintable must read `BUG-045`.

```bash
node /private/tmp/claude-501/-Users-yeison-Projects-code-conductor/f7218b10-9217-4e9b-b140-a428add61d43/scratchpad/id-ceiling.mjs
```

Expected: `CEILING {"BUG":44,...}` and `next BUG = BUG-045` before the filing. **If it reads anything else, stop and reconcile before minting.**

- [ ] [T-003-C] Add an amendment note to the `[BUG-044]` backlog entry, placed **above** its original bullet list, directly under the heading. The original wording is preserved intact (AC20).

```markdown
* **AMENDED 2026-09-28 at spec approval. Two corrections, recorded above the original text rather than edited into it.** First, **the line references below are stale**: BUG-043 shifted them, and `g3Blocked` now spans `:432-440` with the remedy sentence at `:438` and its three call sites at `:448`, `:452` and `:470`. Second, **the success measure below is a premise error**. It sets uptake moving off zero as the target. The reader at the moment of friction is the agent, and `CLAUDE.md` instructs it never to bypass the hook, so adding an entry to clear its own denial is that bypass. **Uptake remaining at zero is the design working: the agent adapts or reports, the operator legislates.** The measure is truthfulness instead, which the spec states so this cannot be re-filed as a defect without answering the argument. A third finding the entry does not carry: the remedy is **inert on two of the three denials it prints on**, because the length and malformed denials return before `g3AllowlistCovers` is ever consulted.
```

- [ ] [T-003-D] File `[BUG-045]` at the end of Pillar 5, after the `[BUG-044]` entry and before the two dossier sections.

```markdown
### [ ] `[BUG-045]` The Guard 3 Allowlist Cannot Cover a Quoted Path

* **Measured while auditing `[BUG-044]`, verified by reading, not inferred.** `G3_BD` is `(^|[ \t\n\r\f\v|;()])` at `pre-tool-use.mjs:397` and `G3_AD` is its mirror at `:398`. Neither set contains a quote character, so the entry `docs/` does not cover `cat "docs/x.md" *.md`: the character before `docs/` is `"`, which is not a boundary, so the match fails and the command denies.
* **Unchanged by `[BUG-043]`, deliberately.** The dispatch passes the **unmasked** string to `g3AllowlistCovers` at `:469`, because the allowlist matches paths as the operator wrote them. The mask exists for the code-reading checks and must not reach the allowlist.
* **Why it travels from `[BUG-044]` rather than living in it.** `[BUG-044]`'s entry recorded this finding "beside the zero-uptake measurement rather than in a separate item". That wording is read as **placement of the finding, not of the fix**, and the reading is recorded here so it is not re-litigated. The escape hatch nobody reached for would not have worked for a quoted path either, which is why the measurement and the finding belong together; the remedy is a different kind of change.
* **The ritual this item must pay, named at filing so it is priced honestly.** Widening the boundary sets is a behavioral change to the guard's **allow** path, not to its message. It touches `_g3_allowlist_covers` in the frozen authority `tests/fixtures/guard3-reference.sh`, which means a **fifth sanctioned exception** with its own ruling, landing alone, amending the header in the same commit. It needs corpus rows for the quoted-path shapes and a predicted red table with suites named. `[BUG-044]` was kept clear of it so a documentation item did not carry allow-path freight.
* **The open design question.** Whether to add `"` and `'` to `G3_BD` and `G3_AD`, or to match the allowlist against a quote-stripped view of the command. The second is not obviously safe: stripping quotes changes token boundaries, and the allowlist's job is to match what the operator wrote.
* **Components Affected:** `tests/fixtures/guard3-reference.sh` (`_g3_allowlist_covers`), `.claude/hooks/pre-tool-use.mjs:397-416` (`G3_BD`, `G3_AD`, `g3AllowlistCovers`), its byte-identical mirror, `tests/fixtures/guard3-corpus.js`.
* **Acceptance Criteria:** an allowlist entry covers its path whether or not the path is quoted; no unquoted behavior changes; the `EXCEPTIONS` row still arbitrates the authority-versus-port divergence; both subjects move together; every corpus row that denies today and should still deny is asserted before the change.
```

- [ ] [T-003-E] Re-run the id ceiling and confirm the filing moved it.

```bash
node /private/tmp/claude-501/-Users-yeison-Projects-code-conductor/f7218b10-9217-4e9b-b140-a428add61d43/scratchpad/id-ceiling.mjs
```

Expected: `CEILING {"BUG":45,...}` and `next BUG = BUG-046`.

- [ ] [T-003-F] Run the whole suite. Documentation only, so nothing moves.

```bash
npx vitest run 2>&1 | tail -6
```

Expected: **902 passed / 12 skipped, 33 files.**

- [ ] [T-003-G] Stage both tracked files.

```bash
git add -u README.md "AGENT-READABLE BACKLOG.md"
```

- [ ] [T-003-H] Commit.

```bash
git commit -m "docs: restate the allowlist contract, amend BUG-044, file BUG-045"
```

---

### Task 4: Release 1.32.0

Satisfies the version ruling. **Minor, not patch**, under the rule this release establishes: a release that adds a file to the shipped inventory or changes a documented installer contract is observable new behavior on every install; one that repairs behavior without changing what ships is a patch.

**Files:**
- Modify: `VERSION`, `package.json`, `package-lock.json` (two places), `CHANGELOG.md`

- [ ] [T-004-A] Set all five version locations to `1.32.0`. `VERSION` holds the bare string; `package.json` has one `version` field; `package-lock.json` has `version` at the top level and again at `packages[""].version`; `CHANGELOG.md` gains a new first heading. All five currently read `1.31.3`.

- [ ] [T-004-B] Add the `CHANGELOG.md` entry as the new first version heading, above `1.31.3`.

```markdown
## 1.32.0

### Fixed
- **[BUG-044]** Guard 3's denial told every reader to add an entry to `.claude/memory/bash-scan-allowlist.txt`, a file that existed in no installation. Two defects, one item. The file now ships as a comment-only template that the installer creates when absent and never overwrites, so the path the message names resolves and its header teaches the entry format and the review rule. And the remedy sentence now rides only on a **pattern** denial: the length and malformed denials return before the allowlist is ever consulted, so on those two the advice was inert by construction. The sentence is reworded as operator policy, reviewed in git, which an agent may propose but must not self-serve, because the reader at the moment of friction is instructed never to bypass the hook.

### Changed
- `project-template/.claude/memory/bash-scan-allowlist.txt` is a new shipped file, and `memory/bash-scan-allowlist.txt` moves from `skip` to `seed` in the host-owned policy table. This is why the release is minor rather than a patch: it changes what ships and what the installer does on a fresh install. `README.md`'s allowlist paragraph restates to the true contract.
- The assertion that no allowlist file is shipped is retired and replaced by one pinning the mechanism that protects operator policy today: the `seed` row plus the filtered copy introduced in `1.30.0`. Behavior is unchanged for any host that already has an allowlist, which `tests/installer/deploy.test.js` asserts byte-for-byte.

### Filed
- **[BUG-045]** The allowlist cannot cover a quoted path: `G3_BD` and `G3_AD` contain no quote character, so the entry `docs/` does not cover `cat "docs/x.md" *.md`. Measured during this item's audit and deliberately left to its own change, because widening the boundary sets touches the frozen bash authority's allow path.
```

- [ ] [T-004-C] Verify all five locations agree.

```bash
node /private/tmp/claude-501/-Users-yeison-Projects-code-conductor/f7218b10-9217-4e9b-b140-a428add61d43/scratchpad/version-gate.mjs
```

Expected: all five read `1.32.0` and the gate reports agreement.

- [ ] [T-004-D] Run the whole suite.

```bash
npx vitest run 2>&1 | tail -6
```

Expected: **902 passed / 12 skipped, 33 files.**

- [ ] [T-004-E] Stage the four tracked files.

```bash
git add -u VERSION package.json package-lock.json CHANGELOG.md
```

- [ ] [T-004-F] Commit.

```bash
git commit -m "chore: release 1.32.0 [BUG-044]"
```

---

### Task 5: Close out

**Files:**
- Modify: `docs/superpowers/plans/2026-09-28-bug044-deny-message-phantom-allowlist.md` (this file, plan state)
- Modify: `.claude/memory/project.md`

- [ ] [T-005-A] Verify the final state before recording it.

```bash
npx vitest run 2>&1 | tail -6
diff .claude/hooks/pre-tool-use.mjs project-template/.claude/hooks/pre-tool-use.mjs && echo "MIRROR IDENTICAL"
git status --short tests/fixtures/
```

Expected: **902 passed / 12 skipped**; `MIRROR IDENTICAL`; no output from the fixtures check.

- [ ] [T-005-B] Confirm the live-population claim the release rests on: the allowlist now exists in this working copy only if a deploy ran, which it has not, so assert the **template** exists and the host file's absence is unchanged. This is the honest version of the claim.

```bash
ls -1 project-template/.claude/memory/
ls -1 .claude/memory/
```

Expected: the template appears under `project-template/.claude/memory/`; `.claude/memory/` still holds four files and no allowlist, because this repository is not an install target and no deploy ran. **Stating it this way avoids claiming the fix is observable here when it is observable on a fresh install.**

- [ ] [T-005-C] Append the implementation record to `.claude/memory/project.md` under `## Implementation: BUG-044 [2026-09-28]`, carrying: the six boundaries and whether each hit, the ASSERTION-RETIREMENT classification, the inert-remedy finding, the port-only discovery that spared a fifth authority exception, the corrected success measure, and the version rule.

- [ ] [T-005-D] Stage and commit the closeout.

```bash
git add -u .claude/memory/project.md
git add -f "docs/superpowers/plans/2026-09-28-bug044-deny-message-phantom-allowlist.md"
git commit -m "docs: record the BUG-044 implementation and executed plan state"
```

---

## Test List

- [ ] [T-L01] `tests/hooks/pre-tool-use-contract.test.js`: a pattern denial names the allowlist as operator policy (presence).
- [ ] [T-L02] `tests/hooks/pre-tool-use-contract.test.js`: a length denial carries no allowlist sentence (absence plus its positive half).
- [ ] [T-L03] `tests/hooks/pre-tool-use-contract.test.js`: a malformed denial carries no allowlist sentence (absence plus its positive half).
- [ ] [T-L04] `tests/installer/templates.test.js`: the allowlist row is `seed` and its template ships (the ASSERTION-RETIREMENT replacement).
- [ ] [T-L05] `tests/installer/templates.test.js`: the shipped template parses to zero entries.
- [ ] [T-L06] `tests/installer/deploy.test.js`: a deploy creates the allowlist from the template when the host has none.
- [ ] [T-L07] Unmodified and must stay green: `templates.test.js:96-98` mirror parity, `:130` no regex shorthands, `:168` ships nothing marked skip, `:172` template source for every seed; `deploy.test.js:347` host file survives a re-run; `host-owned.test.js:62` exact seeded list; `guard3-port.test.js:46` and `pre-tool-use-contract.test.js:99` and `:174`.

No E2E work: there is no UI. No new integration seam beyond the deploy case, which is the existing installer seam.

## Commit Order

| commit | task | contents |
|---|---|---|
| 1 | T-000 | the plan file |
| 2 | T-001 | `g3Blocked` in both mirrors, three contract cases |
| 3 | T-002 | the retirement, the policy flip, the template, the deploy case |
| 4 | T-003 | `README.md`, the BUG-044 amendment, the BUG-045 filing |
| 5 | T-004 | `1.32.0` in five locations, the changelog |
| 6 | T-005 | the implementation record and executed plan state |

Six commits, one per task, matching this chain's shape. Task 2's message carries the classification in its body.

## Identified Risks

1. **The mirror edited on one side.** Caught by `templates.test.js:96-98`, and T-001-E runs an explicit `diff` before the suite so it is caught at the edit rather than at the boundary. This is the BUG-041 crossover failure, where the parity test did its job and the plan's file list did not; here both members are named in one step and in File Structure.
2. **The two-test collision left in a contradictory state.** Removed by construction: T-002-A retires `:143` before T-002-C flips the policy, so `:168` and `:172` are satisfiable at every intermediate point. T-002-B and T-002-D predict the two intermediate reds exactly, 2 then 3, and name which cases fail.
3. **The retirement is weaker than what it retires.** Mitigated by asserting the row's policy **and** the template's presence, with the host-survival half already green at `deploy.test.js:347`. The classification is in the commit body so a reviewer reads it as a retirement, not a deletion.
4. **An absence assertion passing because the denial stopped firing.** Each of T-L02 and T-L03 asserts its positive half in the same case. T-001-B names the distinction explicitly: a failure on the positive half is a tripwire, not the expected red.
5. **The seeded template carrying a live entry.** Caught by T-L05, which parses the shipped file with `g3ReadAllowlist`'s own rule rather than eyeballing it.
6. **`host-owned.test.js` breaking on the flip.** Verified in advance that it does not, and why: the fixture lacks the template source and `seedHostOwned` skips absent sources. T-002-E asserts it as a checkpoint, and a red there means the missing-source skip is not behaving as read.
7. **The new constants tripping `templates.test.js:130`,** which forbids regex shorthands anywhere after the Guard 3 constants marker. Neither `G3_ALTERNATIVES` nor `G3_OPERATOR_POLICY` contains a backslash sequence. T-001-F runs that suite.
8. **Claiming the fix is observable in this repository.** It is not: no deploy runs here, so `.claude/memory/` will still hold no allowlist at closeout. T-005-B states the check in the form that is true rather than the form that sounds better.
