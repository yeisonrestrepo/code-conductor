# BUG-049 Sentinel-Only Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (native) or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the installer's `CLAUDE.md` and `.gitignore` merges non-destructive. Ownership comes from the `cc:managed` sentinels alone, every backup is reported, and `.gitignore` gets one labelled block. Ship it as `1.34.4`.

**Architecture:**
- `merge-md.mjs` stays a pure string engine:
  - `mergeClaudeMdText` either appends the block to a sentinel-less host or refreshes a balanced block's interior. It never consults heading names.
  - The new `mergeGitignoreText` maintains a labelled block.
- `file-merge.mjs` orders backup → report → write. Each failure is caught and turned into a warning.
- `deploy.mjs` formats the report line and routes it to stdout through a new `report` option. `bin/` wires it.
- The AC7 fault injector is a vitest module mock in one test file. No production module carries a seam.

**Tech Stack:** Node ≥ 20 ESM, vitest, the `tools/` instruments.

**Spec:** `docs/superpowers/specs/2026-09-30-bug049-claude-md-clobber-design.md`, APPROVED 2026-09-30 (`4608543`) with six rulings.

## Global Constraints

- **Sentinels:** ownership is `<!-- cc:managed:start -->` … `<!-- cc:managed:end -->` alone, never heading names.
- **Sentinel-less host:** the result is `host + separator + block`. The separator is one blank line in the host's EOL, plus a terminating newline first if the host lacks one. Nothing else changes: no heading dedupe, no scaffold append, no repair.
- **Report line**, verbatim for a project file:
  ```
  code-conductor: backed up CLAUDE.md to CLAUDE.md.installer-backup.<UTC stamp> before merging (git-ignored by design)
  ```
- **Fresh install:** prints nothing. A byte-equal host is a no-op.
- **`.gitignore` header**, verbatim: `# Code Conductor (added by the installer; safe to keep)`.
- **Managed entries:** exactly the three that `project-template/gitignore` ships today.
- **Negation guard:** with any `!` line in the host, nothing moves.
- **Release:** `1.34.4`, a patch.
  - `tools/skip-baseline.json` does not change. New tests only add passing tests.
- **Staging:**
  - `git add -u <path>` for tracked files.
  - Plain `git add <path>` for new files under `tests/`.
  - The plan file goes in after its leaf lands.
  - Never a bare `git add -u`.
- **Owner-only actions:** the agent opens the PR and stops at green. The merge and the GitHub Release `v1.34.4` are the owner's.

## Predictions, per environment

Every new or changed test runs in all three environments, because none of the touched files carries a `skipIf`. Only the passed counts move.

| after | local | ci-node20 | ci-node24 |
|---|---|---|---|
| now (measured 2026-09-30 at `4608543`) | 1039 / 12 (1051) | 955 / 96 | 1038 / 13 |
| T-000 plan commit | 1039 / 12 | n/a | n/a |
| T-001 CLAUDE.md engine | **1045 / 12** (+6) | n/a | n/a |
| T-002 `.gitignore` block | **1052 / 12** (+7) | n/a | n/a |
| T-003 report and ordering | **1064 / 12** (+12) | n/a | n/a |
| T-004 README contract | 1064 / 12 | n/a | n/a |
| T-005 release | **1065 / 12 (1077)** (+1) | **981 / 96**, `SKIP_BASELINE_OK` | **1064 / 13**, `SKIP_BASELINE_OK` |

**Test files:** local goes from 41 passed | 1 skipped (42) to **42 passed | 1 skipped (43)**. The extra file is `tests/installer/merge-ordering.test.js`.

**Halt rule:** any count that differs from its row halts the task before the commit.

**Amended 2026-09-30, after the whole-branch review and before measurement** (FEAT-021 rule: amended before measured, never absorbed).
- **The fix-pass commit:** `fix: close code fences by CommonMark length and indentation rules [BUG-049]` adds 4 passing tests:
  - 2 for the fence fix (Important #1);
  - 1 for Low 1 (the `.gitignore` BOM pin);
  - 1 for Low 5 (the prune-failure report, through a third injection switch).
- **The merge gate moves to:**
  - local **1069 / 12 (1081)**;
  - ci-node20 **985 / 96**;
  - ci-node24 **1068 / 13**.

  Totals are 1081 on both legs, both print `SKIP_BASELINE_OK`, and the `tools/skip-baseline.json` diff is empty.
- **Low 2, ruled by the owner: output accompanies writes.** A run that writes nothing prints nothing, on the first run or the fifteenth. AC10e's notice fires only on the run that writes the block while leaving host entries in place.

## Review Focus

1. **Re-derived tests can pass for the wrong reason (the owner's precision).**
   - **The danger.** A negated destructive assertion can pass for the wrong reason. Take `expect(text).not.toContain('stale conductor text')` flipped to `toContain`: it still passes if the host line survives but is moved, duplicated, or has its neighbours eaten.
   - **The rule for each test listed below.** The new assertion is written from the spec's contract: `host + separator + block`, byte-exact with `toBe`, never derived from the old assertion's text. The test's title states the AC it pins.
   - **The guard.** Each re-derived test is run **red against the unchanged engine** before the implementation lands (T-001-E), with its expected failure listed. A re-derived test that passes on the old code is a finding about the test, and halts the task.
   - **The re-derived set:**
     - `merge-md.test.js` :49, :59, :84 (inverted, AC11), :112, :117, :123, :132, :138 and :162;
     - `file-merge.test.js` :71 and :79;
     - `deploy.test.js` :182, :191 and :214.
   - **Tests that stay untouched**, because they encode no destructive semantics and still pass on the old code: :65, :75, :95, :146, :155.
2. **A sentinel-less host that ends inside an unclosed code fence.**
   - **The problem.** A block appended there sits inside the fence. The next run cannot see its sentinels and appends a second block, on every run.
   - **Expected behaviour.** Warn `CLAUDE_MD_UNCLOSED_FENCE` and write nothing. That is ruling R3, and T-001's re-derived :117 test pins it.
3. **A mixed-EOL host** (some lines CRLF, some LF).
   - **The problem.** The old engine rejoined every line with one EOL, rewriting host bytes it did not own.
   - **Expected behaviour.** Host bytes are untouched, and the appended block uses the detected EOL. Pinned by T-001's mixed-EOL test.
4. **A symlinked target whose backup lands outside the project root**, such as a dotfiles checkout.
   - **The problem.** A relative report path would point at a file that does not exist, and "(git-ignored by design)" would claim an ignore rule that may not cover that repository.
   - **Expected behaviour.** The absolute backup path, with no ignore claim. That is ruling R2, pinned by T-003's symlink report test.
5. **A host line written directly under the `.gitignore` block**, which the block absorbs, since the block ends only at a blank line.
   - **Expected behaviour.** The installer never moves or removes it, and a re-run is a no-op. Pinned by T-002's RF5 test.
6. **A `.gitignore` that already has the block, missing one entry.**
   - **Expected behaviour.** The entry goes at the block's end, including when the block runs to EOF with no final newline, with no second header. Pinned by T-002's case (h).

## Rulings in this plan (each one is the owner's to overturn)

- **R1, the AC7 seam: there is none in production.**
  - **Where the injector lives.** It exists only in `tests/installer/merge-ordering.test.js`, as `vi.mock('node:fs', …)`. The mock wraps `copyFileSync` (which `backupFile` calls) and `renameSync` (which `writeAtomic` calls) behind two test-local switches. Both are off by default, and every call they do not fail delegates to the real function.
  - **Why it cannot fire in production, on three grounds:**
    1. `vi.mock` is a rewrite of vitest's own module graph and does not exist outside the vitest runner.
    2. `tests/` is outside `package.json` `files`, and `smoke.test.js` "excludes dev-only trees" already asserts it is absent from the packed tarball.
    3. A new `smoke.test.js` assertion (T-003) scans every packed `.mjs`/`.js` file for `vi.mock(`, `vi.hoisted(` and `from 'vitest'` and requires zero hits. So the injector cannot ship even if someone later moves it into `lib/`.
  - **Cost if wrong:** one test-only file.
- **R2, report paths.**
  - A project backup inside the cwd prints the spec's exact line, relative.
  - A global backup prints `~/.claude/…` and drops "(git-ignored by design)", because `~/.claude` is not a repository that the managed `.gitignore` covers.
  - A backup outside its root, from a symlinked target, prints the absolute path with no ignore claim.
  - **Cost if wrong:** a string format in one function.
- **R3, an unclosed fence on a sentinel-less host writes nothing and warns.**
  - The spec is silent on this input. Appending would be non-idempotent: see Review Focus 2.
  - The warning names the fix: close the fence and re-run.
  - **Cost if wrong:** such a host gets no block until the fence is closed.
- **R4, `scanLines` keeps its heading index.**
  - `templates.test.js` pins the templates' structure through it: Active Stack Profiles outside the block, and the conductor-owned half inside.
  - The merge no longer reads headings at all.
  - The `normalizeHeading` test stays, so the count is unchanged.
- **R5, stream routing.** Half of this is settled by the spec: AC8 puts the backup report on stdout. The other half is this plan's choice, because the spec names no stream for the negation notice.
  - The negation notice is a warning-class line and goes through `warn` (stderr).
  - The backup report goes through `report` (stdout).
  - `cli.test.js`'s "silent on stdout" stays true for a fresh install.
- **R6, a write failure after a successful backup warns and the install continues, exiting 0.**
  - That matches the spec's backup-failure ruling. The spec named no exit code for this case.
  - **Cost if wrong:** one `return` becomes a `throw`.
- **R7, the report fires the moment the backup exists, before the write.**
  - If the write then fails, the person still learns where the backup is.
- **R8, defaults.** When a caller omits `report`, `deployGlobal` and `deployProject` default it to stdout, as `warn` defaults to stderr, so a future caller cannot silently lose the mandatory report.

---

- [ ] [T-000] **Plan commit** (runs after the branch gate, which is silent here: the current branch equals the derived `fix/bug-049-claude-md-clobber`)
  - [ ] [T-000-A] Modify `.gitignore`: add `!/docs/superpowers/plans/2026-09-30-bug049-claude-md-clobber.md` immediately after `!/docs/superpowers/plans/2026-09-29-feat038-discoverability-metadata.md` (:95), in sorted position.
  - [ ] [T-000-B] `git add -u .gitignore .claude/memory/project.md` (the owner's plan precisions, appended uncommitted at `/cc-compact`), then `git add docs/superpowers/plans/2026-09-30-bug049-claude-md-clobber.md`.
  - [ ] [T-000-C] Commit `docs: add the BUG-049 implementation plan [BUG-049]`. Expected: the hook suite passes at **1039 / 12**.

- [ ] [T-001] **CLAUDE.md engine: sentinel-only ownership** (AC1, AC2, AC3, AC4, AC6, AC9b, AC11, Review Focus 1–3). Depends on T-000.
  - [ ] [T-001-A] Create the AC9b fixtures. Run these as a scratchpad script, because Guard 3 denies redirections combined with chains:
    ```sh
    mkdir -p tests/installer/fixtures
    git show 2a3a811:project-template/CLAUDE.md > "$S/t2a3.md"
    shasum "$S/t2a3.md"                     # expected: 3d0ee6dfc962… (the 1.23.0–1.23.3 tarball template)
    sed -n '16,$p' "$S/t2a3.md" > tests/installer/fixtures/bug049-2a3a811-tail.md
    head -1 tests/installer/fixtures/bug049-2a3a811-tail.md   # expected: - Setup: <command>
    ```
    Then create `tests/installer/fixtures/bug049-field-head.md` with the Write tool. These are the exact bytes the owner supplied, as LF with one trailing newline:
    ```
    # Project Claude Configuration
    Extends global CLAUDE.md. Project-specific rules take precedence over global ones.
    ## Project Identity

    * - me:
    * - scription:
    * - ack:
    * - nguage: en
    * ## Development Commands
    * - Bld: <command>
    * - Tt: <command>
    * - Lt: <command>
    * - Fmat: <command>
    ```
    If the `shasum` prefix differs, halt: the reconstruction would not be the template the spec names.
  - [ ] [T-001-B] Modify `tests/installer/merge-md.test.js` lines 1–169. Leave the `appendMissingLinesText` describe (:171–191) untouched until T-002. Replace the imports and the `TPL` fixture (:1–30) with:
    ```js
    import { describe, it, expect } from 'vitest';
    import { readFileSync } from 'node:fs';
    import { join, dirname } from 'node:path';
    import { fileURLToPath } from 'node:url';
    import {
      SENTINEL_START, SENTINEL_END, detectEol, normalizeHeading,
      mergeClaudeMdText, appendMissingLinesText,
    } from '../../lib/installer/merge-md.mjs';

    const HERE = dirname(fileURLToPath(import.meta.url));
    const ROOT = join(HERE, '..', '..');

    // The contract, written out rather than computed by the code under test: the block is
    // the sentinel lines and everything between them, plus one terminating newline.
    const INTERIOR = ['## Agent Identity', '', 'You are an orchestrator.', '', '## Hard Constraints', '', '- Never hardcode secrets.'];
    const BLOCK = [SENTINEL_START, ...INTERIOR, SENTINEL_END, ''].join('\n');
    const TPL = ['# Project Claude Configuration', '', '## Project Identity', '', '- Name: TBD', '', '## Conventions', '', '- TBD', '', BLOCK].join('\n');

    const crlf = (s) => s.replace(/\n/g, '\r\n');
    const lf = (s) => s.replace(/\r\n/g, '\n');
    const realTemplate = (rel) => lf(readFileSync(join(ROOT, rel), 'utf8'));
    const blockOf = (tpl) => tpl.slice(tpl.indexOf(SENTINEL_START), tpl.indexOf(SENTINEL_END) + SENTINEL_END.length) + '\n';
    // A conductor-shaped host with no sentinels: the template's own lines, one host line
    // under every `## ` heading, so a lost section is a lost line.
    const withHostLines = (tpl) => tpl.split('\n')
      .filter((l) => l !== SENTINEL_START && l !== SENTINEL_END)
      .flatMap((l) => (l.startsWith('## ') ? [l, `host line under ${l.slice(3)}`] : [l]))
      .join('\n');
    ```
    The `detectEol` and `normalizeHeading` describes (:32–46) stay as they are. Replace :48–169 with:
    ```js
    describe('mergeClaudeMdText — host preservation', () => {
      it('[AC3, LF] keeps every host byte and appends the managed block alone', () => {
        const host = ['# My Project', '', '## Project Identity', '', '- Name: acme', ''].join('\n');
        const { text, changed } = mergeClaudeMdText(TPL, host);
        expect(changed).toBe(true);
        expect(text).toBe(host + '\n' + BLOCK);
      });
      it('[AC3] never removes, rewrites, reorders or adds to a host section, known or not', () => {
        const host = ['# My Project', '', '## Deployment', '', 'kubectl apply', ''].join('\n');
        expect(mergeClaudeMdText(TPL, host).text).toBe(host + '\n' + BLOCK);
      });
      it('is idempotent — a second merge appends nothing and changes nothing', () => {
        const host = ['# My Project', '', '## Project Identity', '', '- Name: acme', ''].join('\n');
        const once = mergeClaudeMdText(TPL, host).text;
        const twice = mergeClaudeMdText(TPL, once);
        expect(twice.changed).toBe(false);
        expect(twice.text).toBe(once);
      });
    });

    describe('mergeClaudeMdText — managed block', () => {
      it('replaces the block interior and leaves content outside untouched', () => {
        const host = mergeClaudeMdText(TPL, '# My Project\n\n## Project Identity\n\n- Name: acme\n').text;
        const next = TPL.replace('You are an orchestrator.', 'You are a senior architect.');
        const { text, changed } = mergeClaudeMdText(next, host);
        expect(changed).toBe(true);
        expect(text).toContain('You are a senior architect.');
        expect(text).not.toContain('You are an orchestrator.');
        expect(text).toContain('- Name: acme');
      });
      it('[AC4] refreshes only the interior: every byte outside the sentinels is identical, in LF and CRLF', () => {
        const before = '# Mine  \n\n\n## X\ttab\n';
        const after = 'trailing  \n\n';
        const host = `${before}${SENTINEL_START}\nold interior\n${SENTINEL_END}\n${after}`;
        expect(mergeClaudeMdText(TPL, host).text).toBe(`${before}${BLOCK}${after}`);
        expect(mergeClaudeMdText(TPL, crlf(host)).text).toBe(crlf(`${before}${BLOCK}${after}`));
      });
      it('[AC11, AC1] keeps a sentinel-less host\'s managed-name sections and appends the block beside them', () => {
        const host = [
          '# My Project', '', '## Project Identity', '', '- Name: acme', '',
          '## Agent Identity', '', 'stale conductor text', '',
        ].join('\n');
        expect(mergeClaudeMdText(TPL, host).text).toBe(host + '\n' + BLOCK);
      });
      it('leaves the file entirely untouched on every malformed sentinel count', () => {
        for (const bad of [
          `# H\n\n${SENTINEL_END}\n`,
          `# H\n\n${SENTINEL_START}\n`,
          `# H\n\n${SENTINEL_START}\n${SENTINEL_START}\n${SENTINEL_END}\n`,
          `# H\n\n${SENTINEL_START}\nA\n${SENTINEL_END}\n${SENTINEL_START}\nB\n${SENTINEL_END}\n`,
          `# H\n\n${SENTINEL_END}\nX\n${SENTINEL_START}\n`,
        ]) {
          const r = mergeClaudeMdText(TPL, bad);
          expect(r.changed).toBe(false);
          expect(r.text).toBe(bad);
          expect(r.warning).toBe('CLAUDE_MD_SENTINEL_UNBALANCED');
        }
      });
    });

    describe('mergeClaudeMdText — parsing', () => {
      it('[AC3] does not treat sentinels inside a ``` fence as sentinels, so the host is sentinel-less', () => {
        const host = ['# H', '', '```md', SENTINEL_START, '## Agent Identity', SENTINEL_END, '```', ''].join('\n');
        expect(mergeClaudeMdText(TPL, host).text).toBe(host + '\n' + BLOCK);
      });
      it('[AC3] handles ~~~ fences with an info string the same way', () => {
        const host = ['# H', '', '~~~text title', SENTINEL_START, '~~~', ''].join('\n');
        expect(mergeClaudeMdText(TPL, host).text).toBe(host + '\n' + BLOCK);
      });
      it('[AC6, Review Focus 2] writes nothing to a sentinel-less host that ends inside an unclosed fence', () => {
        const host = ['# H', '', '```js', '## Project Identity'].join('\n');
        const r = mergeClaudeMdText(TPL, host);
        expect(r.changed).toBe(false);
        expect(r.text).toBe(host);
        expect(r.warning).toBe('CLAUDE_MD_UNCLOSED_FENCE');
      });
    });

    describe('mergeClaudeMdText — EOL', () => {
      it('[AC3] adds the missing trailing newline, then one blank line, before the block', () => {
        const host = '# H\n\n## Project Identity\n\n- Name: acme';
        expect(mergeClaudeMdText(TPL, host).text).toBe(host + '\n\n' + BLOCK);
      });
      it('[AC3, CRLF] writes the block in CRLF for a CRLF host and in LF for an LF host', () => {
        const host = '# H\n\n## Project Identity\n\n- Name: acme\n';
        expect(mergeClaudeMdText(TPL, crlf(host)).text).toBe(crlf(host) + '\r\n' + crlf(BLOCK));
        expect(mergeClaudeMdText(TPL, host).text).toBe(host + '\n' + BLOCK);
      });
      it('converges on a CRLF host — the second merge is a no-op', () => {
        const once = mergeClaudeMdText(TPL, crlf('# H\n\n## Project Identity\n\n- Name: acme\n')).text;
        const twice = mergeClaudeMdText(TPL, once);
        expect(twice.changed).toBe(false);
        expect(twice.text).toBe(once);
      });
      it('[AC3, BOM] keeps the byte-order mark as the first bytes', () => {
        const host = '﻿# H\n\nprose\n';
        expect(mergeClaudeMdText(TPL, host).text).toBe(host + '\n' + BLOCK);
      });
      it('[AC3, Review Focus 3] leaves a mixed-EOL host\'s bytes alone and appends in the detected EOL', () => {
        const host = '# H\r\nlf line\ncrlf line\r\n';
        expect(mergeClaudeMdText(TPL, host).text).toBe(host + '\r\n' + crlf(BLOCK));
      });
    });

    describe('mergeClaudeMdText — whole copy', () => {
      it('writes the whole template for an empty or whitespace-only host', () => {
        for (const host of ['', '   \n\n\t\n']) {
          const { text, changed } = mergeClaudeMdText(TPL, host);
          expect(changed).toBe(true);
          expect(text).toBe(TPL);
        }
      });
      it('[AC3] appends the block alone to a host with no ## headings', () => {
        const host = '# H\n\nJust prose.\n';
        expect(mergeClaudeMdText(TPL, host).text).toBe(host + '\n' + BLOCK);
      });
    });

    describe('mergeClaudeMdText — BUG-049 red cases, on the shipped templates', () => {
      it('[AC1, AC6] keeps all 15 host lines of a sentinel-less conductor-shaped file and appends the block alone', () => {
        const tpl = realTemplate('project-template/CLAUDE.md');
        const host = withHostLines(tpl) + '## Migration Skills\nhost line under Migration Skills\n';
        expect(host.match(/^host line under /gm)).toHaveLength(15);
        const once = mergeClaudeMdText(tpl, host);
        expect(once.text).toBe(host + '\n' + blockOf(tpl));
        expect(mergeClaudeMdText(tpl, once.text).changed).toBe(false);
      });
      it('[AC9b, AC6] preserves field-damaged input byte for byte: no repair, no relabelling', () => {
        // Field-verbatim: the head of the nymbl backup, supplied by the owner 2026-09-30.
        const fieldHead = readFileSync(join(HERE, 'fixtures', 'bug049-field-head.md'), 'utf8');
        // Reconstruction: lines 16 onward of project-template/CLAUDE.md at 2a3a811, the
        // template byte-identical to the 1.23.0-1.23.3 tarballs (sha1 3d0ee6dfc962).
        const reconstruction = readFileSync(join(HERE, 'fixtures', 'bug049-2a3a811-tail.md'), 'utf8');
        const host = fieldHead + reconstruction;
        const tpl = realTemplate('project-template/CLAUDE.md');
        const once = mergeClaudeMdText(tpl, host);
        expect(once.text).toBe(host + '\n' + blockOf(tpl));
        expect(mergeClaudeMdText(tpl, once.text).changed).toBe(false);
      });
    });
    ```
  - [ ] [T-001-C] Modify `tests/installer/file-merge.test.js`. After `const TPL` (:8), add:
    ```js
    const FM_BLOCK = [SENTINEL_START, '## Hard Constraints', '', '- No secrets.', SENTINEL_END, ''].join('\n');
    ```
    Replace the test at :71–78 with:
    ```js
      it('[AC9, AC1] keeps the pre-merge file in the backup and every host byte in the target', () => {
        const before = '# Mine\n\n## Hard Constraints\n\n- my own rule\n';
        writeFileSync(target, before);
        mergeFileInto(tplPath, target, mergeClaudeMdText, { warn });
        const backup = readdirSync(dir).find(n => n.includes('.installer-backup.'));
        expect(readFileSync(join(dir, backup), 'utf8')).toBe(before);
        expect(readFileSync(target, 'utf8')).toBe(before + '\n' + FM_BLOCK);
      });
    ```
    In the test at :79, replace `expect(readFileSync(real, 'utf8')).toContain('## Project Identity');` (:85) with:
    ```js
        expect(readFileSync(real, 'utf8')).toBe('# Mine\n\n## Deployment\n\nkubectl\n' + '\n' + FM_BLOCK);
    ```
    Retitle :79 to `'[AC3] merges through a symlink and leaves the link intact'`.
  - [ ] [T-001-D] Modify `tests/installer/deploy.test.js`.
    - Change the `node:path` import to `import { join, dirname } from 'node:path';` and add `import { fileURLToPath } from 'node:url';`.
    - Replace the `TPL_GLOBAL` and `TPL_PROJECT` constants (:8–24) with these. The values are byte-identical to today's:
      ```js
      const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
      const GLOBAL_BLOCK = [SENTINEL_START, '## Workflow', '', 'Spec, then plan, then implement.', '', '## Safety', '', 'Confirm before writes.', SENTINEL_END, ''].join('\n');
      const TPL_GLOBAL = ['# Global Claude Configuration', '', GLOBAL_BLOCK].join('\n');
      const PROJECT_BLOCK = [SENTINEL_START, '## Agent Identity', '', 'You are an orchestrator.', '', '## Hard Constraints', '', '- Never hardcode secrets.', SENTINEL_END, ''].join('\n');
      const TPL_PROJECT = ['# Project Claude Configuration', '', '## Project Identity', '', '- Name: TBD', '', '## Conventions', '', '- TBD', '', PROJECT_BLOCK].join('\n');
      ```
    - Replace the test at :182–190 with:
      ```js
        it('[AC3] preserves a host CLAUDE.md byte for byte and appends the block alone', () => {
          const host = '# Acme\n\n## Project Identity\n\n- Name: acme\n';
          writeFileSync(join(home, 'CLAUDE.md'), host);
          deployProject(asset, home);
          expect(readFileSync(join(home, 'CLAUDE.md'), 'utf8')).toBe(host + '\n' + PROJECT_BLOCK);
        });
      ```
    - Append inside `describe('deployGlobal — CLAUDE.md merge')`:
      ```js
        it('[AC2] keeps all 12 host lines of a sentinel-less ~/.claude/CLAUDE.md and appends the block alone', () => {
          const tpl = readFileSync(join(ROOT, 'global', 'CLAUDE.md'), 'utf8').replace(/\r\n/g, '\n');
          writeFileSync(join(asset, 'global', 'CLAUDE.md'), tpl);
          const host = tpl.split('\n')
            .filter((l) => l !== SENTINEL_START && l !== SENTINEL_END)
            .flatMap((l) => (l.startsWith('## ') ? [l, `host line under ${l.slice(3)}`] : [l]))
            .join('\n');
          expect(host.match(/^host line under /gm)).toHaveLength(12);
          const dir = join(home, '.claude');
          mkdirSync(dir, { recursive: true });
          writeFileSync(join(dir, 'CLAUDE.md'), host);
          deployGlobal(asset, home);
          const block = tpl.slice(tpl.indexOf(SENTINEL_START), tpl.indexOf(SENTINEL_END) + SENTINEL_END.length) + '\n';
          expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toBe(host + '\n' + block);
        });
      ```
  - [ ] [T-001-E] **Red against the unchanged engine.** Run:
    ```
    npx vitest run tests/installer/merge-md.test.js tests/installer/file-merge.test.js tests/installer/deploy.test.js
    ```
    Expected, exactly:
    - `merge-md.test.js`: **14 failed, 11 passed**. The failures are the `[AC3, LF]` and `[AC3]` host-preservation tests, `[AC4]`, `[AC11, AC1]`, the three parsing tests, `[AC3]` trailing newline, `[AC3, CRLF]`, `[AC3, BOM]`, mixed EOL, `[AC3]` no headings, `[AC1, AC6]`, and `[AC9b, AC6]`.
    - `file-merge.test.js`: **2 failed** (`[AC9, AC1]` and `[AC3]` symlink).
    - `deploy.test.js`: **2 failed** (`[AC3]` host CLAUDE.md and `[AC2]`).

    Every failure must be a `toBe` mismatch showing host content lost or scaffold sections appended, except the unclosed-fence test, whose failure must be the warning mismatch. A re-derived test that passes here halts the task (Review Focus 1).
  - [ ] [T-001-F] Modify `lib/installer/merge-md.mjs`.
    - Replace `scanLines` (:31–60) with:
      ```js
      // One fence-aware pass. Takes raw text: each element of `lines` keeps its own CR,
      // so a caller that splices `lines` and rejoins on '\n' reproduces every untouched
      // byte. Returns line INDICES only. A fence opens on ``` or ~~~ at column 0 (info
      // string allowed) and closes on a bare run of the SAME marker char. An unclosed
      // fence runs to EOF, so everything after it is body text — never a heading, never
      // a sentinel — and `openFence` says so.
      export function scanLines(text) {
        const lines = text.split('\n');
        const headings = [];
        const starts = [];
        const ends = [];
        let fence = null;
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].replace(/\r$/, '');
          const marker = line.match(/^(`{3,}|~{3,})/);
          if (fence) {
            if (marker && marker[1][0] === fence && /^(`{3,}|~{3,})\s*$/.test(line)) fence = null;
            continue;
          }
          if (marker) { fence = marker[1][0]; continue; }
          const trimmed = line.trim();
          if (trimmed === SENTINEL_START) { starts.push(i); continue; }
          if (trimmed === SENTINEL_END) { ends.push(i); continue; }
          if (/^## /.test(line)) headings.push({ index: i, key: normalizeHeading(line) });
        }
        const status =
          starts.length === 0 && ends.length === 0 ? 'none'
            : starts.length === 1 && ends.length === 1 && starts[0] < ends[0] ? 'balanced'
              : 'unbalanced';
        return { lines, headings, start: starts[0], end: ends[0], status, openFence: fence !== null };
      }
      ```
    - Replace `sectionRange`, `appendBlock` and `mergeClaudeMdText` (:62–143) with:
      ```js
      const unchanged = (hostText, warning) => ({ text: hostText, changed: false, warning });

      // The host's bytes, one blank separator line, then `added` in the host's EOL. A host
      // with no final newline gets one first, so its last line never fuses with ours.
      function appendLines(hostText, added, eol) {
        if (hostText === '') return added.join(eol) + eol;
        const separator = hostText.endsWith('\n') ? eol : eol + eol;
        return hostText + separator + added.join(eol) + eol;
      }

      // Only the lines strictly between the sentinels are replaced. The sentinel lines and
      // every byte outside them are the host's raw lines, rejoined exactly as they were split.
      function refreshInterior(host, interior, eol) {
        const current = host.lines.slice(host.start + 1, host.end).map((l) => l.replace(/\r$/, ''));
        if (current.join('\n') === interior.join('\n')) return host.lines.join('\n');
        const cr = eol === '\r\n' ? '\r' : '';
        return [
          ...host.lines.slice(0, host.start + 1),
          ...interior.map((l) => l + cr),
          ...host.lines.slice(host.end),
        ].join('\n');
      }

      // Ownership is the sentinels' alone (BUG-049). A heading's name decides nothing: a
      // sentinel-less host keeps every byte and gets the block appended, and a balanced
      // host has only its block interior refreshed.
      export function mergeClaudeMdText(templateText, hostText) {
        const tpl = scanLines(toLf(templateText));
        // Never mutate host content on the authority of a broken shipped template.
        if (tpl.status !== 'balanced') return unchanged(hostText, 'TEMPLATE_SENTINEL_UNBALANCED');
        if (hostText.trim() === '') {
          return { text: templateText, changed: templateText !== hostText, warning: null };
        }
        const host = scanLines(hostText);
        // Guessing the intended block risks eating host content, so every malformed
        // count takes the same path: touch nothing at all.
        if (host.status === 'unbalanced') return unchanged(hostText, 'CLAUDE_MD_SENTINEL_UNBALANCED');
        // A block appended after an unclosed fence would sit inside it, invisible to the
        // next run, which would append another. Writing nothing is the only idempotent move.
        if (host.status === 'none' && host.openFence) return unchanged(hostText, 'CLAUDE_MD_UNCLOSED_FENCE');
        const eol = detectEol(hostText);
        const text = host.status === 'balanced'
          ? refreshInterior(host, tpl.lines.slice(tpl.start + 1, tpl.end), eol)
          : appendLines(hostText, tpl.lines.slice(tpl.start, tpl.end + 1), eol);
        return { text, changed: text !== hostText, warning: null };
      }
      ```
  - [ ] [T-001-G] Modify `lib/installer/file-merge.mjs` so the new warning gives the right advice.
    - After `MAX_BACKUPS` (:8), add:
      ```js
      // Advice per warning code; the default fits every sentinel-count warning.
      const WARNING_ADVICE = {
        CLAUDE_MD_UNCLOSED_FENCE: 'close the code fence that runs to the end of the file and re-run',
      };
      ```
    - Replace :78 with:
      ```js
          emit(`code-conductor: skipping ${targetPath} — ${warning}; ${WARNING_ADVICE[warning] || 'fix the cc:managed markers and re-run'}`);
      ```
  - [ ] [T-001-H] Modify the comment at `tests/installer/templates.test.js:28–30`. Its stated reason, that the engine skips headings after the block, no longer exists. It becomes:
    ```js
      // A fresh install writes the template whole and a merge appends the block at EOF,
      // so a template with content after the block would give fresh and merged hosts two
      // different shapes. Lock the block-last invariant both paths share.
    ```
  - [ ] [T-001-I] Run the three files again. Expected: **all pass**, with `merge-md.test.js` at **25 passed**. Then run the full suite: **1045 / 12 (1057)**. On any other count, halt.
  - [ ] [T-001-J] Stage and commit:
    ```
    git add -u lib/installer/merge-md.mjs lib/installer/file-merge.mjs tests/installer/merge-md.test.js tests/installer/file-merge.test.js tests/installer/deploy.test.js tests/installer/templates.test.js
    git add tests/installer/fixtures/bug049-field-head.md tests/installer/fixtures/bug049-2a3a811-tail.md
    ```
    Commit `fix: decide CLAUDE.md ownership by the cc:managed sentinels alone [BUG-049]`. Expected: the hook suite passes at **1045 / 12**.

- [ ] [T-002] **`.gitignore` labelled block** (AC10 a–f, Review Focus 5–6). Depends on T-001.
  - [ ] [T-002-A] Modify `tests/installer/merge-md.test.js`.
    - The import list replaces `appendMissingLinesText` with `mergeGitignoreText, GITIGNORE_HEADER`.
    - Replace the whole `appendMissingLinesText` describe with:
    ```js
    describe('mergeGitignoreText', () => {
      // The shipped template is exactly the block: header, then the three managed entries.
      const IGNORE_TPL = [GITIGNORE_HEADER, '.claude/memory/turn-count.txt', '*.installer-backup.*', '*.installer-tmp.*', ''].join('\n');
      const HOSTS = {
        b: 'dist\nnode_modules\n',
        c: 'dist\n.claude/memory/turn-count.txt\nbuild/\n*.installer-backup.*\n',
        d: 'dist\n/.claude/memory/turn-count.txt\n.installer-backup.\n',
        e: '.claude/memory/turn-count.txt\n!keep.log\n',
        g: 'dist\r\n.claude/memory/turn-count.txt\r\n',
        h: `dist\n\n${GITIGNORE_HEADER}\n.claude/memory/turn-count.txt\n*.installer-backup.*\n`,
        rf5: `dist\n\n${IGNORE_TPL}my-own.log\n`,
      };

      it('[AC10a] writes the template whole for an empty or whitespace-only host', () => {
        for (const host of ['', '  \n']) {
          const r = mergeGitignoreText(IGNORE_TPL, host);
          expect(r.changed).toBe(true);
          expect(r.text).toBe(IGNORE_TPL);
        }
      });
      it('[AC10b] leaves host lines untouched and appends the block after one blank line', () => {
        const r = mergeGitignoreText(IGNORE_TPL, HOSTS.b);
        expect(r.text).toBe(HOSTS.b + '\n' + IGNORE_TPL);
        expect(r.notice).toBe(null);
      });
      it('[AC10c] gathers scattered exact entries into the block, once each', () => {
        expect(mergeGitignoreText(IGNORE_TPL, HOSTS.c).text).toBe('dist\nbuild/\n' + '\n' + IGNORE_TPL);
      });
      it('[AC10d] never touches a host-modified variant; the block carries all three', () => {
        expect(mergeGitignoreText(IGNORE_TPL, HOSTS.d).text).toBe(HOSTS.d + '\n' + IGNORE_TPL);
      });
      it('[AC10e] moves nothing when any ! line exists, adds only the absent entries, and says so', () => {
        const r = mergeGitignoreText(IGNORE_TPL, HOSTS.e);
        expect(r.text).toBe(HOSTS.e + '\n' + [GITIGNORE_HEADER, '*.installer-backup.*', '*.installer-tmp.*', ''].join('\n'));
        expect(r.notice).toMatch(/left the existing Code Conductor entries in \.gitignore where they are/);
      });
      it('[AC10f, AC6] is byte-identical, silent and unchanged on a second run of every case', () => {
        for (const host of Object.values(HOSTS)) {
          const once = mergeGitignoreText(IGNORE_TPL, host).text;
          const twice = mergeGitignoreText(IGNORE_TPL, once);
          expect(twice).toEqual({ text: once, changed: false, warning: null, notice: null });
        }
      });
      it('[AC10b, CRLF] removes and appends in the host EOL', () => {
        expect(mergeGitignoreText(IGNORE_TPL, HOSTS.g).text).toBe('dist\r\n' + '\r\n' + crlf(IGNORE_TPL));
      });
      it('[Review Focus 6] adds a missing entry at the end of an existing block, with no second header', () => {
        expect(mergeGitignoreText(IGNORE_TPL, HOSTS.h).text).toBe(`dist\n\n${IGNORE_TPL}`);
        const noFinalNewline = `${GITIGNORE_HEADER}\n.claude/memory/turn-count.txt`;
        expect(mergeGitignoreText(IGNORE_TPL, noFinalNewline).text).toBe(IGNORE_TPL);
      });
      it('[Review Focus 5] never moves or removes a host line written under the block', () => {
        const r = mergeGitignoreText(IGNORE_TPL, HOSTS.rf5);
        expect(r.changed).toBe(false);
        expect(r.text).toBe(HOSTS.rf5);
      });
    });
    ```
  - [ ] [T-002-B] Modify `tests/installer/templates.test.js`.
    - Add `GITIGNORE_HEADER` to the `merge-md.mjs` import at :5.
    - Inside `describe('project-template/gitignore')`, append:
      ```js
        it('opens with the header the .gitignore merge finds its block by', () => {
          const text = readFileSync(join(root, 'project-template/gitignore'), 'utf8');
          expect(text.split('\n')[0]).toBe(GITIGNORE_HEADER);
        });
      ```
  - [ ] [T-002-C] Modify `tests/installer/deploy.test.js`.
    - Add `GITIGNORE_HEADER` to the `merge-md.mjs` import.
    - Make the fixture (:26) `const TPL_GITIGNORE = `${GITIGNORE_HEADER}\n.claude/memory/turn-count.txt\n*.installer-backup.*\n*.installer-tmp.*\n`;`.
    - Replace the test at :191–196 with:
      ```js
        it('[AC10b] keeps host .gitignore lines and appends the labelled block after a blank line', () => {
          writeFileSync(join(home, '.gitignore'), 'dist\n');
          deployProject(asset, home);
          expect(readFileSync(join(home, '.gitignore'), 'utf8')).toBe('dist\n\n' + TPL_GITIGNORE);
        });
      ```
    - In the symlinked `.gitignore` test, the `:220` expectation becomes `.toBe('dist\n\n' + TPL_GITIGNORE)`.
  - [ ] [T-002-D] Run `npx vitest run tests/installer/merge-md.test.js tests/installer/templates.test.js tests/installer/deploy.test.js`. Expected: **red**. `merge-md.test.js` fails to import `mergeGitignoreText`, and every test in that file errors. `templates.test.js` fails its new header test. `deploy.test.js` fails `[AC10b]` and the symlink `.gitignore` test.
  - [ ] [T-002-E] Modify `project-template/gitignore`: insert `# Code Conductor (added by the installer; safe to keep)` as line 1, above the three entries.
  - [ ] [T-002-F] Modify `lib/installer/merge-md.mjs`.
    - After `SENTINEL_END` (:7), add:
      ```js
      // Opens the installer's labelled block in a host .gitignore. The shipped template
      // starts with it (templates.test.js) and the merge finds the block by it.
      export const GITIGNORE_HEADER = '# Code Conductor (added by the installer; safe to keep)';
      const NEGATION_NOTICE = 'left the existing Code Conductor entries in .gitignore where they are, because the file has a "!" line and moving them could change what it ignores';
      ```
    - Replace the `appendMissingLinesText` block (from the comment above it to EOF) with:
      ```js
      const keyOf = (line) => line.replace(/\r$/, '').trim();

      // The installer's own entries are the template's non-blank, non-comment lines.
      function managedEntries(templateText) {
        return toLf(templateText).split('\n').map(keyOf).filter((k) => k && !k.startsWith('#'));
      }

      // The block runs from the header to the first blank line or EOF; `end` is exclusive.
      function findBlock(lines) {
        const header = lines.findIndex((l) => keyOf(l) === GITIGNORE_HEADER);
        if (header === -1) return null;
        let end = header + 1;
        while (end < lines.length && keyOf(lines[end]) !== '') end++;
        return { header, end };
      }

      // Exact copies of a managed entry outside the block: the lines gathering would move.
      function strayEntryIndices(lines, block, entries) {
        const inBlock = (i) => block !== null && i > block.header && i < block.end;
        return lines.flatMap((l, i) => (!inBlock(i) && entries.includes(keyOf(l)) ? [i] : []));
      }

      // Missing entries go at the end of an existing block, or into a new block appended
      // after one blank line. Every other host line keeps its bytes and its place.
      function insertEntries(lines, block, missing, eol) {
        if (!block) return appendLines(lines.join('\n'), [GITIGNORE_HEADER, ...missing], eol);
        const cr = eol === '\r\n' ? '\r' : '';
        const out = lines.slice();
        if (block.end === out.length) {
          out[out.length - 1] = out[out.length - 1].replace(/\r$/, '') + cr;
          out.push('');
        }
        out.splice(block.end, 0, ...missing.map((e) => e + cr));
        return out.join('\n');
      }

      export function mergeGitignoreText(templateText, hostText) {
        if (hostText.trim() === '') {
          return { text: templateText, changed: templateText !== hostText, warning: null, notice: null };
        }
        const entries = managedEntries(templateText);
        const lines = hostText.split('\n');
        const strays = strayEntryIndices(lines, findBlock(lines), entries);
        // Moving an ignore line past a later `!` re-include can change what the file
        // ignores, so a host with any negation keeps every line exactly where it is.
        const negated = lines.some((l) => keyOf(l).startsWith('!'));
        const kept = negated || !strays.length ? lines : lines.filter((_, i) => !strays.includes(i));
        const present = new Set(kept.map(keyOf));
        const missing = entries.filter((e) => !present.has(e));
        if (kept === lines && !missing.length) return { text: hostText, changed: false, warning: null, notice: null };
        const text = insertEntries(kept, findBlock(kept), missing, detectEol(hostText));
        const notice = negated && strays.length ? NEGATION_NOTICE : null;
        return { text, changed: text !== hostText, warning: null, notice };
      }
      ```
  - [ ] [T-002-G] Modify `lib/installer/deploy.mjs`.
    - :4 becomes `import { mergeClaudeMdText, mergeGitignoreText } from './merge-md.mjs';`.
    - :17 becomes `['gitignore', { target: '.gitignore', merge: mergeGitignoreText }],`.
  - [ ] [T-002-H] Rename the two references to the retired function so they name the new one.
    - **`tools/README.md:108`:** `the installer's \`appendMissingLinesText\` merge` becomes `the installer's \`mergeGitignoreText\` merge, whose negation guard moves nothing in a file with \`!\` lines,`.
    - **`tests/unit/gitignore-block-parity.test.js:41–43`:** becomes
      ```js
      // free too. That scope is what lets this test and the installer's
      // mergeGitignoreText merge share one file forever: this file's ! lines trip its
      // negation guard, so its block is appended below the END marker and nothing moves.
      ```
    - Then `grep -rn appendMissingLinesText lib bin scripts tests tools`. Expected: no output (`[DEPS]`).
  - [ ] [T-002-I] Run the three files: all pass, with `merge-md.test.js` at **31 passed**. Then run the full suite: **1052 / 12 (1064)**. On any other count, halt.
  - [ ] [T-002-J] Stage with `git add -u lib/installer/merge-md.mjs lib/installer/deploy.mjs project-template/gitignore tests/installer/merge-md.test.js tests/installer/templates.test.js tests/installer/deploy.test.js tools/README.md tests/unit/gitignore-block-parity.test.js`. Commit `fix: keep the installer's .gitignore entries in one labelled block [BUG-049]`. Expected: the hook suite passes at **1052 / 12**.

- [ ] [T-003] **Backup report and provable ordering** (AC5, AC7, AC8, AC9, AC10e notice, Review Focus 4, R1). Depends on T-002.
  - [ ] [T-003-A] Create `tests/installer/merge-ordering.test.js`:
    ```js
    import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
    import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
    import { tmpdir } from 'node:os';
    import { join } from 'node:path';
    import { mergeFileInto } from '../../lib/installer/file-merge.mjs';
    import { mergeClaudeMdText, SENTINEL_START, SENTINEL_END } from '../../lib/installer/merge-md.mjs';

    // AC7's fault injector, and the only one. It lives here, as a vitest module mock: no
    // production module carries a seam, flag or environment variable for it. vi.mock
    // exists only inside vitest's module graph, tests/ is outside package.json `files`,
    // and smoke.test.js requires that no packed file names vitest. Each switch is off by
    // default, and every call it does not fail goes to the real function.
    const faults = vi.hoisted(() => ({ copyFileSync: false, renameSync: false }));
    vi.mock('node:fs', async (importOriginal) => {
      const fs = await importOriginal();
      const injectable = (name) => (...args) => {
        if (faults[name]) throw Object.assign(new Error(`injected ${name} fault`), { code: 'EIO' });
        return fs[name](...args);
      };
      const mocked = { ...fs, copyFileSync: injectable('copyFileSync'), renameSync: injectable('renameSync') };
      return { ...mocked, default: mocked };
    });

    const TPL = ['# T', '', SENTINEL_START, '## Hard Constraints', '', '- No secrets.', SENTINEL_END, ''].join('\n');
    const HOST = '# Mine\n\n## Deployment\n\nkubectl\n';
    let dir, tplPath, target, warnings, reported;
    const opts = () => ({ warn: (m) => warnings.push(m), onBackup: (p) => reported.push(p) });
    const named = (part) => readdirSync(dir).filter((n) => n.includes(part));
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'cc-order-'));
      tplPath = join(dir, 'template.md');
      target = join(dir, 'CLAUDE.md');
      writeFileSync(tplPath, TPL);
      writeFileSync(target, HOST);
      warnings = [];
      reported = [];
      faults.copyFileSync = false;
      faults.renameSync = false;
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    describe('mergeFileInto — backup ordering under injected faults (AC7)', () => {
      it('[AC7] keeps the backup and leaves the target byte-unchanged when the write throws', () => {
        faults.renameSync = true;
        expect(mergeFileInto(tplPath, target, mergeClaudeMdText, opts())).toBe('write-failed');
        expect(readFileSync(target, 'utf8')).toBe(HOST);
        const [backup] = named('.installer-backup.');
        expect(readFileSync(join(dir, backup), 'utf8')).toBe(HOST);
        expect(reported).toEqual([join(dir, backup)]);
        expect(named('.installer-tmp.')).toEqual([]);
        expect(warnings.join('\n')).toContain(target);
        expect(warnings.join('\n')).toContain(join(dir, backup));
      });
      it('[AC7] writes nothing when the backup throws', () => {
        faults.copyFileSync = true;
        expect(mergeFileInto(tplPath, target, mergeClaudeMdText, opts())).toBe('skipped-backup-failed');
        expect(readFileSync(target, 'utf8')).toBe(HOST);
        expect(named('.installer-backup.')).toEqual([]);
        expect(named('.installer-tmp.')).toEqual([]);
        expect(reported).toEqual([]);
        expect(warnings.join('\n')).toMatch(/could not back it up/);
      });
    });
    ```
  - [ ] [T-003-B] Modify `tests/installer/file-merge.test.js`. Append inside `describe('mergeFileInto')`:
    ```js
      it('[AC8] reports the backup path through onBackup once, and never when nothing changes', () => {
        writeFileSync(target, '# Mine\n');
        const reported = [];
        mergeFileInto(tplPath, target, mergeClaudeMdText, { warn, onBackup: (p) => reported.push(p) });
        const backup = readdirSync(dir).find(n => n.includes('.installer-backup.'));
        expect(reported).toEqual([join(dir, backup)]);
        mergeFileInto(tplPath, target, mergeClaudeMdText, { warn, onBackup: (p) => reported.push(p) });
        expect(reported).toHaveLength(1);
      });
      it('[AC10e] emits a merge notice once the write has succeeded', () => {
        writeFileSync(target, 'old\n');
        const noticing = () => ({ text: 'new\n', changed: true, warning: null, notice: 'a notice' });
        expect(mergeFileInto(tplPath, target, noticing, { warn })).toBe('merged');
        expect(warnings).toEqual(['code-conductor: a notice']);
      });
    ```
  - [ ] [T-003-C] Modify `tests/installer/deploy.test.js`.
    - Add `realpathSync` to the `node:fs` import.
    - Add a module-level helper after `afterEach`:
      ```js
      const capture = () => {
        const out = { warned: [], said: [] };
        out.opts = { warn: (m) => out.warned.push(m), report: (m) => out.said.push(m) };
        return out;
      };
      ```
    - Append a new describe at the end of the file:
    ```js
    describe('backup report (BUG-049)', () => {
      it('[AC5] leaves files equal to the shipped templates untouched, with no backup and no report', () => {
        writeFileSync(join(home, 'CLAUDE.md'), TPL_PROJECT);
        writeFileSync(join(home, '.gitignore'), TPL_GITIGNORE);
        const c = capture();
        deployProject(asset, home, c.opts);
        expect(readFileSync(join(home, 'CLAUDE.md'), 'utf8')).toBe(TPL_PROJECT);
        expect(readFileSync(join(home, '.gitignore'), 'utf8')).toBe(TPL_GITIGNORE);
        expect(readdirSync(home).filter(n => n.includes('.installer-backup.'))).toEqual([]);
        expect(c.said).toEqual([]);
      });
      it('[AC8] reports each project backup with the exact line, and nothing on a re-run', () => {
        writeFileSync(join(home, 'CLAUDE.md'), '# Acme\n');
        writeFileSync(join(home, '.gitignore'), 'dist\n');
        const c = capture();
        deployProject(asset, home, c.opts);
        const claude = readdirSync(home).find(n => n.startsWith('CLAUDE.md.installer-backup.'));
        const ignore = readdirSync(home).find(n => n.startsWith('.gitignore.installer-backup.'));
        expect(c.said).toEqual([
          `code-conductor: backed up CLAUDE.md to ${claude} before merging (git-ignored by design)`,
          `code-conductor: backed up .gitignore to ${ignore} before merging (git-ignored by design)`,
        ]);
        c.said.length = 0;
        deployProject(asset, home, c.opts);
        expect(c.said).toEqual([]);
      });
      it('[AC8, R2] reports a global backup by its ~/.claude path, without the project ignore claim', () => {
        const dir = join(home, '.claude');
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'CLAUDE.md'), '# Mine\n');
        const c = capture();
        deployGlobal(asset, home, c.opts);
        const backup = readdirSync(dir).find(n => n.includes('.installer-backup.'));
        expect(c.said).toEqual([`code-conductor: backed up ~/.claude/CLAUDE.md to ~/.claude/${backup} before merging`]);
      });
      it('[Review Focus 4, R2] reports a symlinked target\'s backup by its absolute path, without the ignore claim', () => {
        const real = join(asset, 'dotfiles-CLAUDE.md');
        writeFileSync(real, '# Acme\n');
        symlinkSync(real, join(home, 'CLAUDE.md'));
        const c = capture();
        deployProject(asset, home, c.opts);
        const backup = readdirSync(asset).find(n => n.startsWith('dotfiles-CLAUDE.md.installer-backup.'));
        expect(c.said).toEqual([`code-conductor: backed up CLAUDE.md to ${join(realpathSync(asset), backup)} before merging`]);
      });
      it('[AC9] keeps a backup byte-equal to the original across consecutive runs', () => {
        const original = '# Acme\n\n## Hard Constraints\n\n- our own rule\n';
        writeFileSync(join(home, 'CLAUDE.md'), original);
        for (let i = 0; i < 3; i++) deployProject(asset, home, capture().opts);
        const backups = readdirSync(home).filter(n => n.startsWith('CLAUDE.md.installer-backup.'));
        expect(backups.map(n => readFileSync(join(home, n), 'utf8'))).toContain(original);
        expect(readFileSync(join(home, 'CLAUDE.md'), 'utf8')).toBe(original + '\n' + PROJECT_BLOCK);
      });
      it('[AC10e] says once, on the warning channel, that existing entries stayed in place', () => {
        writeFileSync(join(home, '.gitignore'), '.claude/memory/turn-count.txt\n!keep.log\n');
        const c = capture();
        deployProject(asset, home, c.opts);
        deployProject(asset, home, c.opts);
        expect(c.warned.filter(m => m.includes('left the existing Code Conductor entries'))).toHaveLength(1);
      });
    });
    ```
    - In the existing `'says nothing on a fresh scaffold, whose stub it just wrote'` test (:439), change the call to `deployProject(asset, home, { warn, report: (m) => warned.push(m) })`, so the fresh-scaffold silence covers the report channel too (AC5). The count is unchanged.
  - [ ] [T-003-D] Modify `tests/installer/cli.test.js`. Append inside `describe('run')`:
    ```js
      it('[AC8] prints the backup report on stdout when --project merges an existing CLAUDE.md', () => {
        writeFileSync(join(cwd, 'CLAUDE.md'), '# Acme\n');
        expect(run(['--project'], { HOME: home }, { cwd, log })).toBe(0);
        const backup = readdirSync(cwd).find(n => n.startsWith('CLAUDE.md.installer-backup.'));
        expect(logs).toContain(`stdout:code-conductor: backed up CLAUDE.md to ${backup} before merging (git-ignored by design)`);
      });
    ```
  - [ ] [T-003-E] Modify `tests/installer/smoke.test.js`. Append inside `describe('packed tarball')`:
    ```js
      // R1: AC7's fault injector lives only in tests/installer/merge-ordering.test.js, as a
      // vitest module mock. Nothing that ships may import or mock through vitest.
      it('ships no test seam: no packed script imports vitest or calls its mock API', () => {
        const scripts = readdirSync(pkgDir, { recursive: true }).filter(p => /\.(mjs|js)$/.test(p));
        expect(scripts.length).toBeGreaterThan(0);
        const seam = /\bvi\.(mock|hoisted|spyOn)\(|from ['"]vitest['"]/;
        expect(scripts.filter(p => seam.test(readFileSync(join(pkgDir, p), 'utf8')))).toEqual([]);
      });
    ```
  - [ ] [T-003-F] Run `npx vitest run tests/installer/merge-ordering.test.js tests/installer/file-merge.test.js tests/installer/deploy.test.js tests/installer/cli.test.js tests/installer/smoke.test.js`. Expected: **red**:
    - both `[AC7]` tests fail on a thrown `injected … fault`, because today's code lets it propagate;
    - `file-merge.test.js` `[AC8]` fails (`reported` is `[]`), and so does `[AC10e]` (`warnings` is `[]`);
    - in `deploy.test.js`, `[AC8]`, `[AC8, R2]`, `[Review Focus 4, R2]` and `[AC10e]` fail, while `[AC5]` and `[AC9]` pass, because they pin behaviour T-001 and T-002 already produce;
    - `cli.test.js` `[AC8]` fails;
    - `smoke.test.js`'s new test passes, because it is a guard and not a red case.

    If the `[AC7]` write-throws test fails on anything but `injected renameSync fault`, the mock is not reaching `file-merge.mjs`: halt.
  - [ ] [T-003-G] Modify `lib/installer/file-merge.mjs`. Replace the doc comment and body of `mergeFileInto` from `:75` (`const hostText = …`) to the end with:
    ```js
      const hostText = readFileSync(target.realPath, 'utf8');
      const { text, changed, warning, notice } = mergeFn(templateText, hostText);
      if (warning) {
        emit(`code-conductor: skipping ${targetPath} — ${warning}; ${WARNING_ADVICE[warning] || 'fix the cc:managed markers and re-run'}`);
        return 'skipped-warning';
      }
      if (!changed) return 'unchanged';
      const status = backupThenWrite(target.realPath, targetPath, text, hostText.trim() !== '', { now, emit, onBackup });
      if (status === 'merged' && notice) emit(`code-conductor: ${notice}`);
      return status;
    }

    // Backup first, and a failed backup stops the write: an unrecoverable overwrite is
    // worse than a skipped file. The path is reported the moment the copy exists, so the
    // person running the installer learns where it is even if the write then fails.
    function backupThenWrite(realPath, targetPath, text, needsBackup, { now, emit, onBackup }) {
      let backup = null;
      if (needsBackup) {
        try { backup = backupFile(realPath, now); } catch (err) {
          emit(`code-conductor: skipping ${targetPath} — could not back it up (${err.code || err.message}); nothing was written`);
          return 'skipped-backup-failed';
        }
        if (onBackup) onBackup(backup);
      }
      try { writeAtomic(realPath, text); } catch (err) {
        emit(`code-conductor: could not write ${targetPath} (${err.code || err.message}); it is unchanged${backup ? `, and its backup is ${backup}` : ''}`);
        return 'write-failed';
      }
      return 'merged';
    }
    ```
    Change the signature at :47 to `export function mergeFileInto(templatePath, targetPath, mergeFn, { now = new Date(), warn, onBackup } = {}) {`.
  - [ ] [T-003-H] Modify `lib/installer/deploy.mjs`.
    - :2 becomes `import { join, relative, isAbsolute, sep } from 'node:path';`.
    - After `CP_OPTS` (:25), add:
      ```js
      // One stdout line per backup, because the backup is git-ignored by the managed
      // block and would otherwise be invisible (BUG-049). A backup outside `root` (a
      // symlinked target resolved into a dotfiles checkout) prints absolute, and only a
      // backup inside a --project root claims the ignore rule covers it.
      function backupReporter(report, { root, rootLabel, file, ignoredByDesign }) {
        return (backupPath) => {
          const rel = relative(root, backupPath);
          const inside = rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
          const shown = inside ? rootLabel + rel.split(sep).join('/') : backupPath;
          const suffix = inside && ignoredByDesign ? ' (git-ignored by design)' : '';
          report(`code-conductor: backed up ${rootLabel}${file} to ${shown} before merging${suffix}`);
        };
      }
      const toStdout = (m) => process.stdout.write(`${m}\n`);
      const toStderr = (m) => process.stderr.write(`${m}\n`);
      ```
    - `deployGlobal` changes:
      - :95 becomes `export function deployGlobal(assetRoot, home, { warn = toStderr, report = toStdout } = {}) {`.
      - :100 becomes:
        ```js
          mergeFileInto(join(globalDir, 'CLAUDE.md'), join(target, 'CLAUDE.md'), mergeClaudeMdText, {
            warn,
            onBackup: backupReporter(report, { root: target, rootLabel: '~/.claude/', file: 'CLAUDE.md', ignoredByDesign: false }),
          });
        ```
    - `deployProject` changes:
      - :152 becomes `export function deployProject(assetRoot, cwd, { warn = toStderr, report = toStdout } = {}) {`.
      - :153 becomes `const emit = warn;`.
      - The merge loop at :174–176 becomes:
        ```js
          for (const [source, { target: dest, merge }] of MERGED_ROOT_FILES) {
            mergeFileInto(join(templateRoot, source), join(cwd, dest), merge, {
              warn: emit,
              onBackup: backupReporter(report, { root: cwd, rootLabel: '', file: dest, ignoredByDesign: true }),
            });
          }
        ```
  - [ ] [T-003-I] Modify `bin/code-conductor.mjs`.
    - :94 becomes `const claudeDir = deployGlobal(assetRoot, home, { warn: (m) => emit('stderr', m), report: (m) => emit('stdout', m) });`.
    - :104 becomes `if (opts.project) deployProject(assetRoot, cwd, { warn: (m) => emit('stderr', m), report: (m) => emit('stdout', m) });`.
  - [ ] [T-003-J] Run `grep -rn "deployGlobal(\|deployProject(\|mergeFileInto(" lib bin tests` and confirm every caller passes either no options or `{ warn, report }` / `{ warn, onBackup }` (`[DEPS]`). Then run the T-003-F files: all pass. Then the full suite: **1064 / 12 (1076)**, with test files **42 passed | 1 skipped (43)**. On any other count, halt.
  - [ ] [T-003-K] Stage and commit:
    ```
    git add -u lib/installer/file-merge.mjs lib/installer/deploy.mjs bin/code-conductor.mjs tests/installer/file-merge.test.js tests/installer/deploy.test.js tests/installer/cli.test.js tests/installer/smoke.test.js
    git add tests/installer/merge-ordering.test.js
    ```
    Commit `fix: report every installer backup and prove it precedes the write [BUG-049]`. Expected: the hook suite passes at **1064 / 12**.

- [ ] [T-004] **README contract** (AC12, without the Known-limits bullet, which leaves in T-005). Depends on T-003. No test pins this prose. The pairing pin lands in T-005.
  - [ ] [T-004-A] Modify `README.md` "How the installer treats your CLAUDE.md" (:441–473). Replace everything from the three bullets through the "cosmetic wart" blockquote (:447–468) with the text below. The intro paragraph (:443–444) and the damaged-markers paragraph (:470–472) stay.
    ````markdown
    - **Code Conductor owns one block and nothing else.** Its content lives between
      `<!-- cc:managed:start -->` and `<!-- cc:managed:end -->`, and those two markers alone
      decide ownership; a heading's name never does. Every upgrade replaces the block's
      contents wholesale, so released improvements reach existing installs. Edits inside the
      block are lost, and recoverable from the backup.
    - **Everything outside the block is yours, byte for byte.** Nothing outside it is
      removed, rewritten, reordered or added.
    - **A file without the markers gets the block appended at the end**, after one blank
      line and in your file's line endings, and nothing else changes. If your file already
      has sections named like the block's (`## Agent Identity`, `## Hard Constraints`, …),
      you will see both: yours above, Code Conductor's inside the block. That is deliberate.
      The installer never decides which of your sections are really its own; reconciling
      them is planned for `/cc-stack` as `[FEAT-040]`.
    - **Before any change, the installer copies your file to
      `CLAUDE.md.installer-backup.<UTC timestamp>`**, keeps the five most recent, and prints
      where it put it:

      ```
      code-conductor: backed up CLAUDE.md to CLAUDE.md.installer-backup.20260930T120000Z before merging (git-ignored by design)
      ```

      Backups are git-ignored so nobody commits one by accident and they stay out of every
      teammate's `git status`; the printed line is how you find yours. A fresh install, and a
      re-run that changes nothing, print nothing.

    The same rules apply to `~/.claude/CLAUDE.md`, whose backup line names the `~/.claude/`
    path. If your file ends inside a code fence that is never closed, the installer leaves it
    untouched with a warning, because a block appended there would be hidden inside the fence.
    ````
  - [ ] [T-004-B] Modify `README.md` ".gitignore Note" (:422–437). Replace :424–431, the intro sentence and the code block, with:
    ````markdown
    When installed with `--project`, the installer keeps its rules in one labelled block in
    your project's `.gitignore`:

    ```
    # Code Conductor (added by the installer; safe to keep)
    .claude/memory/turn-count.txt
    *.installer-backup.*
    *.installer-tmp.*
    ```

    The block ends at the first blank line. Your own lines are never edited. A line that is
    exactly one of these three rules (earlier versions appended them one at a time) is moved
    into the block, so each rule appears once; a line you changed, such as
    `/.claude/memory/turn-count.txt`, is not an exact match and stays where it is. If your
    `.gitignore` has any `!` line, nothing is moved, because moving a rule past a `!` can
    change what is ignored: the block then holds only the rules you lack, and the installer
    says so. A change to `.gitignore` is backed up and reported exactly as for `CLAUDE.md`.
    ````
    The paragraph beginning "The last two keep" (:433) stays.
  - [ ] [T-004-C] Run the full suite: **1064 / 12**. Stage with `git add -u README.md`. Commit `docs: describe the sentinel-only CLAUDE.md contract and the .gitignore block [BUG-049]`. Expected: the hook suite passes at **1064 / 12**.

- [ ] [T-005] **Release 1.34.4** (AC12's bullet, AC13, AC14; `docs/RELEASE-CLOSEOUT.md` steps 1–5). Depends on T-004.
  - [ ] [T-005-A] Modify `tests/tools/repo-invariants.test.js`. Append inside the `describe`:
    ```js
      // 1.34.4, BUG-049 AC13: the README names the oldest release that neither overwrites nor
      // silently strips a host CLAUDE.md, where installs are described. The floor can only
      // name a release that exists, so it may never run ahead of VERSION.
      it('states one minimum safe version where installs are described, never above VERSION', () => {
        const FLOOR = /\*\*Minimum safe version: `(\d+\.\d+\.\d+)`\.\*\*/;
        const floors = ['Quickstart', 'Install'].map((h) => section(read('README.md'), h).match(FLOOR)?.[1]);
        expect(floors[0]).toBeDefined();
        expect(floors[1]).toBe(floors[0]);
        const [f, v] = [floors[0], read('VERSION').trim()].map((s) => s.split('.').map(Number));
        const firstDiff = f.findIndex((n, i) => n !== v[i]);
        expect(firstDiff === -1 || f[firstDiff] < v[firstDiff]).toBe(true);
        for (const h of ['Quickstart', 'Install']) expect(section(read('README.md'), h)).toContain('code-conductor@latest');
      });
    ```
  - [ ] [T-005-B] Run `npx vitest run tests/tools/repo-invariants.test.js`. Expected: **1 failed**: `floors[0]` is undefined.
  - [ ] [T-005-C] Modify `README.md`.
    - **Quickstart.**
      - Insert above its first code block (:15):
        ```markdown
        **Minimum safe version: `1.34.4`.** Older versions can strip or damage an existing `CLAUDE.md`: every release before `1.24` overwrote it with no backup, `1.24` through `1.34.3` silently removed your sections whose headings matched the managed block's, and an older pre-sentinel version left at least one field file with damaged lines. Install with `@latest`, as below.
        ```
      - :17 becomes `npx @yeison.restrepo.r/code-conductor@latest --project`.
    - **Install.** Insert the same paragraph above its code block. Make the global line `npx @yeison.restrepo.r/code-conductor@latest            # one-shot global setup`.
    - **Known limits.** Delete the `[BUG-049]` bullet (:99).
  - [ ] [T-005-D] Run `npx vitest run tests/tools/repo-invariants.test.js`. Expected: **2 failed**, both clearing in T-005-E/F:
    - the floor test, now on the `VERSION` comparison, because `1.34.4` is above `1.34.3`. This is the pin biting;
    - the open-defect test, because Known limits no longer lists `BUG-049` while its backlog heading is still `[ ]`.
  - [ ] [T-005-E] Run `npm version 1.34.4 --no-git-tag-version`, then write `1.34.4` into `VERSION`.
  - [ ] [T-005-F] Modify the records.
    - **`AGENT-READABLE BACKLOG.md:674`:** `### [ ] \`[BUG-049]\`` becomes `### [X] \`[BUG-049]\``. Insert as its first bullet:
      ```markdown
      * **DONE, shipped as `1.34.4` on 2026-09-30.** `CLAUDE.md` ownership is decided by the `cc:managed` sentinels alone: a sentinel-less host keeps every byte and gets the block appended, a balanced host has only its interior refreshed, and a host ending inside an unclosed fence is left untouched with a warning. Every backup is reported on stdout. A failed backup skips the file, proven by injected faults whose injector exists only as a vitest module mock, and the packed tarball is asserted to contain none. `.gitignore` entries live in one labelled block with exact-line gathering and a negation guard. The README names `1.34.4` as the minimum safe version. Out of scope, as specified: field restoration, the mangling mechanism (unknown), and reconciling duplicate headings (`[FEAT-040]`).
      ```
      If the release commit lands on another date, use that date.
    - **`CHANGELOG.md`:** insert above `## [1.34.3]`:
      ```markdown
      ## [1.34.4] - 2026-09-30

      ### Fixed
      - **[BUG-049]** The installer silently removed your own sections from an existing `CLAUDE.md` when their headings matched the managed block's (`## Agent Identity`, `## Hard Constraints` and six more), on every version from `1.24` to `1.34.3`; under `--global`, that was every section of `~/.claude/CLAUDE.md`. Ownership is now decided by the `cc:managed` markers alone. A file without them gets the block appended at the end and nothing else changes, and a file with them has only the block's interior refreshed. Damaged input is preserved as it is, never repaired.
      - **[BUG-049]** Every backup the installer writes is reported on stdout with its path. Backups stay git-ignored by design, and the line is how you find them. A failed backup now skips that file with a warning instead of aborting the install, and nothing is written without one.

      ### Changed
      - **[BUG-049]** The installer's `.gitignore` rules live in one labelled block, `# Code Conductor (added by the installer; safe to keep)`. Rules an earlier version appended one at a time are gathered into it by exact match. A file with any `!` line keeps every line where it is.
      - **[BUG-049]** The README names `1.34.4` as the minimum safe version and installs with `@latest`.

      `project-template/gitignore` gains its header line, so a fresh install's `.gitignore` differs by that one line.
      ```
  - [ ] [T-005-G] Run the release checks:
    - `node tools/version-gate.mjs`, expected `VERSION_GATE_OK 1.34.4`;
    - `node tools/record-parity.mjs`, expected `RECORD_PARITY_OK`, reading the `1.34.4` claims of `BUG-049` against an `[X]` heading.

    Per the closeout's discriminator rule, confirm parity is reading the claims: flip the heading back to `[ ]`, expect a red run naming `1.34.4` and `BUG-049`, then restore `[X]` and re-run green.
  - [ ] [T-005-H] Run `npx vitest run tests/tools/repo-invariants.test.js`. Expected: **13 passed**. Run the full suite: **1065 / 12 (1077)**.
  - [ ] [T-005-I] Stage with `git add -u VERSION package.json package-lock.json CHANGELOG.md "AGENT-READABLE BACKLOG.md" README.md tests/tools/repo-invariants.test.js`. Commit `chore: release 1.34.4 [BUG-049]`. Expected: the hook suite passes at **1065 / 12**.
  - [ ] [T-005-J] Push the branch and open the PR against `main`. Expected CI:
    - ci-node20 **985 / 96** and ci-node24 **1068 / 13** (amended from 981 / 1064; see the amendment under Predictions), both printing `SKIP_BASELINE_OK`;
    - `git diff main -- tools/skip-baseline.json` empty.
  - [ ] [T-005-K] **Stop at the green PR.** Report both `SKIP_BASELINE_OK` lines and the PR URL. The owner merges and publishes the GitHub Release `v1.34.4`.

## Test List

- [ ] Unit, `merge-md.test.js`:
  - sentinel-only merge: AC1, AC3 in LF/CRLF/BOM/mixed, AC4, AC6, AC9b, AC11;
  - fence handling, including the unclosed-fence warning;
  - `mergeGitignoreText`: AC10 a–f, CRLF, Review Focus 5–6.
- [ ] Unit, `file-merge.test.js`: AC9 backup content, symlink byte-exactness, the `onBackup` report (AC8), the notice after write.
- [ ] Unit with fault injection, `merge-ordering.test.js`: AC7, both directions.
- [ ] Integration, `deploy.test.js`:
  - AC2 on the real global template, AC3 via `deployProject`;
  - AC5 no-op and fresh silence on both channels;
  - AC8 for project, global and symlink paths;
  - AC9 across three runs;
  - AC10b and AC10e end to end.
- [ ] CLI, `cli.test.js`: the report reaches stdout (AC8). The existing fresh-install stdout silence stays green.
- [ ] Package, `smoke.test.js`: no shipped script references vitest's mock API (R1).
- [ ] Repository, `repo-invariants.test.js`: the minimum safe version is stated in Quickstart and Install, equal in both, and ≤ `VERSION` (AC13). The existing open-BUG test enforces the Known-limits pairing (AC12).
- No E2E: no UI is affected.

## Commit Order

1. T-000: `docs: add the BUG-049 implementation plan [BUG-049]`, at 1039 / 12.
2. T-001: `fix: decide CLAUDE.md ownership by the cc:managed sentinels alone [BUG-049]`, at 1045 / 12.
3. T-002: `fix: keep the installer's .gitignore entries in one labelled block [BUG-049]`, at 1052 / 12.
4. T-003: `fix: report every installer backup and prove it precedes the write [BUG-049]`, at 1064 / 12.
5. T-004: `docs: describe the sentinel-only CLAUDE.md contract and the .gitignore block [BUG-049]`, at 1064 / 12.
6. T-005: `chore: release 1.34.4 [BUG-049]`, at 1065 / 12. CI: 981 / 96 and 1064 / 13.

## Identified Risks

- **`vi.mock('node:fs')` not reaching `file-merge.mjs`.**
  - **How it shows:** the `[AC7]` write-throws test returns `merged` instead of failing on the injected fault.
  - **Caught by:** T-003-F's failure-message check, which halts.
  - **If it happens:** rule on `vi.doMock` plus a dynamic import inside the file. Still test-only, and R1 is unchanged.
- **The commit hook runs the full suite**, so an unpredicted count surfaces at commit time.
  - **Response:** every task measures the full suite before staging, and halts on any difference.
- **`deployGlobal` and `deployProject` now default `report` to stdout.**
  - **How it shows:** the existing tests that call them without options will print report lines into vitest's output.
  - **Why it stands:** this is cosmetic, and it is the price of R8. No assertion reads `process.stdout`.
- **`readdirSync(…, { recursive: true })` in the smoke test** needs Node ≥ 20.1. CI's floor leg is Node 20 latest, so this is safe there. A local Node 20.0 would throw, which is loud, not silent.
- **This repository's own `.gitignore`.**
  - **What a dogfood installer run would do:** append a labelled block below the BUG-042 END marker and move nothing, because the file has `!` lines. `gitignore-block-parity` compares only between its markers.
  - **What else stays correct:** the comment at `.gitignore:129–131`, "appending absent lines", still describes that case.
- **The snap-build hang dossier** (specimen 1). If a commit hook hangs, kill only the idle snap-build child, re-run that file alone, and record a second specimen. That meets its minting condition, which needs a ceiling run on both legs and the owner's ruling.

## Handoff (not plan tasks)

After the owner merges and releases, run `RELEASE-CLOSEOUT` steps 6–10:
- `npm view` shows `1.34.4`;
- the rendered README shows the floor line and no `[BUG-049]` bullet;
- write the closeout record;
- delete the branch.

Then `[ARCH-009]` resumes at Q1 (band fields as v3, recommended, or widen v2), and `[FEAT-040]` queues behind it.
