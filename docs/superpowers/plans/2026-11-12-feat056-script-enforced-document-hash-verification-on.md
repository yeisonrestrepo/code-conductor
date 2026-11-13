# FEAT-056 script-enforced document hash verification implementation plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Update one checkbox per edit (BUG-003 invariant). Execute in file order.

**Goal:** `approve spec` and `approve plan` take the document path and the sha256 shown to the owner and refuse a stale one; a new read-only `hash` verb prints that value; every `install` after `define_approved` re-hashes both approved documents and halts when either text changed, while plan checkbox ticks never count as a change.

**Spec:** `docs/superpowers/specs/2026-11-12-feat056-script-enforced-document-hash-verification-on-design.md` (approved 2026-11-12, sha256 `145cd62e84ff2252f7bfbd6278251038728869818f78d4e8f9f19d42d5138e54`). Issue #184.

**Test command:** `npm test`. Filtered runs use `npx vitest run <file>`.

## Global Constraints

- No release records: `VERSION`, the `package.json` / `package-lock.json` version, `CHANGELOG.md`, `AGENT-READABLE BACKLOG.md`, `.claude/memory/**` and the README "Known limits" lines stay untouched.
- No new dependency (`node:crypto` is a builtin), no network, no installer, hook, settings or workflow change. `.github/wiki/pages/` is documentation, not `.github/workflows/` or `.github/actions/`.
- `scripts/orchestrate.mjs` is the router, not one of the protected surfaces CONTRIBUTING names (hooks, installer, SNAP scripts, settings); no ritual applies. Guard 6, `pre-tool-use.mjs` and the band envelopes do not change (spec, Out of Scope).
- Functions of 30 lines or fewer, guard clauses, comments say why.
- Mirrors stay byte-identical: `.claude/commands/cc-orchestrate.md` = `project-template/.claude/commands/cc-orchestrate.md`. Every edit to one is made identically to the other in the same task.
- Tests are added, none skipped and none conditional, so `tools/skip-baseline.json` is untouched on every CI leg.
- Every file this plan edits is already tracked, so every staging step is `git add -u <path>` with an explicit path; only Task 0 stages a new file.

## Baseline (measured on this branch, HEAD dccb66c, before Task 1)

`npx vitest run tests/scripts/orchestrate.test.js tests/installer/commands-parity.test.js tests/wiki/wiki-gen.test.js`: 3 files, 254 passed (orchestrate 165, commands-parity 67, wiki-gen 22). Under vitest's transform a named import the module does not export reads as `undefined` and the file still collects (measured in FEAT-060), so the red steps below fail per test, not per file.

Line numbers below are from HEAD dccb66c; locate by the quoted text if they move.

---

### Task 0: Commit this plan

**Files:**
- Create: `docs/superpowers/plans/2026-11-12-feat056-script-enforced-document-hash-verification-on.md`
- Modify: `.gitignore`

- [X] [T-001] Create this plan file. No dependency.
- [X] [T-002] `.gitignore`: add the leaf `!/docs/superpowers/plans/2026-11-12-feat056-script-enforced-document-hash-verification-on.md` in sorted position, right after `!/docs/superpowers/plans/2026-11-11-feat040-adopt-claude-md.md` and before `!/docs/superpowers/plans/2026-11-12-feat060-audit-verdict-line-and-severities-that-can.md`. Depends on T-001.
- [X] [T-003] Stage: `git add -u .gitignore` and `git add -f docs/superpowers/plans/2026-11-12-feat056-script-enforced-document-hash-verification-on.md` (new file at a tracked surface; `-f` on one explicit path, per the CLAUDE.md staging convention). Depends on T-002.
- [X] [T-004] Commit: `docs: plan for script-enforced document hash verification on approve [FEAT-056]`. Depends on T-003.

---

### Task 1: The router hashes, verifies and re-checks the approved documents

**Files:**
- Modify: `tests/scripts/orchestrate.test.js`
- Modify: `scripts/orchestrate.mjs`

- [X] [T-101] `tests/scripts/orchestrate.test.js`, imports and helpers. No dependency.
  - Add `documentHash` to the import list from `../../scripts/orchestrate.mjs` (line 13). `createHash` is already imported (line 7).
  - After `const PLAN = 'docs/plans/demo.md';` (line 20) add:
    ```js
    const SPEC = 'docs/specs/demo-design.md';
    ```
  - After `const envelope = …` (line 48) add:
    ```js
    // Raw-byte sha256: the hash approve takes for a spec, and for a plan with no box ticked (FEAT-056).
    const sha = (rel) => createHash('sha256').update(readFileSync(join(root, rel))).digest('hex');
    // The spec fixture is written at approval, after start, so FEAT-047 discovery at start never sees it.
    function approveArgs(kind) {
      const rel = kind === 'spec' ? SPEC : PLAN;
      if (kind === 'spec' && !existsSync(join(root, rel))) {
        mkdirSync(dirname(join(root, rel)), { recursive: true });
        writeFileSync(join(root, rel), '# Demo spec\n');
      }
      return ['approve', kind, rel, sha(rel)];
    }
    ```
    `TWO_TASKS` has no ticked box, so `sha(PLAN)` is its normalized hash too; D3 below pins that equality.
- [X] [T-102] `tests/scripts/orchestrate.test.js`, existing `approve` call sites take the path and hash. Depends on T-101.
  - Line 72 (`driveTo` spec step): `orch(['approve', 'spec'])` → `orch(approveArgs('spec'))`.
  - Line 73 (`driveTo` plan step): `orch(['approve', 'plan', PLAN])` → `orch(approveArgs('plan'))`.
  - Lines 132 and 134 (`writes define_approved only through approve plan, and only once`): both `['approve', 'plan', PLAN]` → `approveArgs('plan')`. The expected refusal at line 136 stays: the step check still runs first.
  - Line 143 (`approving the spec records the approval and writes no gate`): `['approve', 'spec']` → `approveArgs('spec')`.
  - Line 181 (`halts with ORCH_EMPTY_SCOPE on a plan with zero tasks`): `['approve', 'plan', PLAN]` → `approveArgs('plan')`, so the hash matches the zero-task plan and the halt is still `ORCH_EMPTY_SCOPE`.
  - Line 405 (`[AC2] SNAP_GATE_MISMATCH halts install …`): `orch(['approve', 'spec'])` → `orch(approveArgs('spec'))`.
  - Lines 605-606 (ticket test `pass(...)`): `['approve', 'spec']` → `approveArgs('spec')`, `['approve', 'plan', PLAN]` → `approveArgs('plan')`.
  - Line 748 (`[AC4] approve ignores an open loop …`): `['approve', 'spec']` → `approveArgs('spec')`.
  - Line 794 (`names review in the usage line`): expected string becomes `'orchestrate: usage: orchestrate.mjs start|install|handback|approve|hash|review|end'`.
  - Line 812 (`approveSpec` in the FEAT-047 describe): `['approve', 'spec']` → `approveArgs('spec')`.
  - Then `grep -n "'approve'" tests/scripts/orchestrate.test.js` prints only the lines inside `approveArgs` and the new describe of T-103.
- [X] [T-103] `tests/scripts/orchestrate.test.js`: append `describe('document hash [FEAT-056]', …)` at the end of the file. Depends on T-102. Test names are the filter set predicted in T-104.
  ```js
  describe('document hash [FEAT-056]', () => {
    const UNTICKED = '# P\n\n### Task 1: a\n\n**Files:**\n- Modify: `src/a.js`\n\n- [ ] [S-1] step one\n  - [ ] [S-1-A] nested\n1. [ ] ordered\n* [ ] star\n+ [ ] plus\n';
    const tick = (text, box) => text.replaceAll('[ ]', box);
    const put = (rel, text) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text); };
    const edited = () => TWO_TASKS.replace('thing 1', 'thing one');
    const tickPlan = (box) => plan(TWO_TASKS.replaceAll('- [ ] **Step 1', `- ${box} **Step 1`));
    const runText = () => readFileSync(join(root, RUN_FILE), 'utf8');
    const raw = (text) => createHash('sha256').update(text).digest('hex');
    const HASH_USAGE = 'orchestrate: usage: orchestrate.mjs hash <spec|plan> <path relative to the run root>';
    const APPROVE_USAGE = 'orchestrate: usage: orchestrate.mjs approve <spec|plan> <path relative to the run root> <sha256>';
  ```
  Unit tests of `documentHash`:
  - D1 **"D1 hashes a spec over its raw bytes"**: `const bytes = Buffer.from([0x23, 0x20, 0xff, 0xfe, 0x0a]);` (not valid UTF-8) → `expect(documentHash('spec', bytes)).toBe(raw(bytes))`.
  - D2 `it.each(['[>]', '[X]', '[x]', '[!]'])` **"D2 a plan box ticked to %s keeps the plan hash"**: `expect(documentHash('plan', tick(UNTICKED, box))).toBe(documentHash('plan', UNTICKED))` (spec AC2; covers `-`, `*`, `+`, ordered and nested items).
  - D3 **"D3 an unticked plan hashes to its raw sha256, and ticks on CRLF lines are normalized"**: `documentHash('plan', UNTICKED)` is `raw(UNTICKED)`; `documentHash('plan', tick(UNTICKED, '[X]').replaceAll('\n', '\r\n'))` is `documentHash('plan', UNTICKED.replaceAll('\n', '\r\n'))`, and differs from `documentHash('plan', UNTICKED)` (line endings still count).
  - D4 `it.each` **"D4 the plan hash changes when %s"**, each `expect(documentHash('plan', after)).not.toBe(documentHash('plan', before))` (spec AC3, AC7):
    - `one character of a task line changes` → `UNTICKED`, `UNTICKED.replace('step one', 'step One')`
    - `a box in prose is ticked` → `'See [ ] here.\n'`, `'See [x] here.\n'`
    - `a box in a table cell is ticked` → `'| a | [ ] |\n'`, `'| a | [x] |\n'`
    - `a box after list-item text is ticked` → `'- item [ ] done\n'`, `'- item [x] done\n'`

  CLI tests of `hash`:
  - H1 **"H1 hash spec prints the sha256sum of the raw bytes with no run file, and writes nothing"**: `put(SPEC, '# Spec\r\né\n')`; `orch(['hash', 'spec', SPEC])` toEqual `{ status: 0, out: \`${sha(SPEC)}  ${SPEC}\`, err: '' }`; `existsSync(join(root, RUN_FILE))` is false (spec AC6).
  - H2 **"H2 hash plan prints the normalized hash in a live run and leaves the run file byte-identical"**: `awaiting('plan')`; `tickPlan('[X]')`; `before = runText()`; `orch(['hash', 'plan', PLAN])` has status 0 and `out` `` `${documentHash('plan', TWO_TASKS)}  ${PLAN}` ``; `runText()` is `before` (spec AC6).
  - H3 `it.each` **"H3 hash refuses %s with exit 2"**, rows `[name, () => args, err]`, each with `put(SPEC, '# Spec\n')` first, then `expect(orch(args())).toMatchObject({ status: 2, err })`:
    - `no path` → `['hash', 'spec']`, `HASH_USAGE`
    - `an absolute path` → `['hash', 'spec', join(root, SPEC)]`, `HASH_USAGE`
    - `a path with ..` → `['hash', 'spec', '../x.md']`, `HASH_USAGE`
    - `an unknown kind` → `['hash', 'ticket', SPEC]`, `HASH_USAGE`
    - `a missing file` → `['hash', 'spec', 'docs/none.md']`, `'orchestrate: cannot read docs/none.md'`

  CLI tests of `approve`:
  - A1 `it.each(['spec', 'plan'])` **"A1 approve %s against a stale hash refuses ORCH_DOC_HASH_STALE and writes nothing"** (spec AC1; the plan row is AC3 at approve): `awaiting(kind)`; `const [, , rel, shown] = approveArgs(kind)`; then `kind === 'spec' ? put(SPEC, '# Demo spec, revised\n') : plan(edited())`; `before = runText()`; `r = orch(['approve', kind, rel, shown])`; `r.status` is 2; `r.err` is `` `orchestrate: ORCH_DOC_HASH_STALE: ${kind} ${rel} hashes ${sha(rel)}, not the ${shown} that was shown; show the document again` ``; `runText()` is `before`.
  - A2 `it.each` **"A2 approve refuses %s with the usage line and writes nothing"**, rows `[name, () => args]`, each after `awaiting('spec')` and `put(SPEC, '# Demo spec\n')`, with `before = runText()`, `expect(orch(args())).toMatchObject({ status: 2, err: APPROVE_USAGE })` and `runText()` equal to `before`:
    - `no path and no hash` → `['approve', 'spec']`
    - `no hash` → `['approve', 'spec', SPEC]`
    - `a hash that is not 64 hex characters` → `['approve', 'spec', SPEC, 'abc123']`
    - `an absolute path` → `['approve', 'spec', join(root, SPEC), sha(SPEC)]`
    - `a path with ..` → `['approve', 'spec', '../demo-design.md', sha(SPEC)]`
  - A3 **"A3 both approvals record exactly at, by, path and a lower-case sha256, from an upper-case argument"** (spec AC5): `awaiting('spec')`; `const specSha = approveArgs('spec')[3]`; `orch(['approve', 'spec', SPEC, specSha.toUpperCase()])` matches `{ status: 0, out: \`spec approved: sha256 ${specSha}\` }`; `orch(['install', 'plan'])`; `orch(['handback', 'plan'], { input: say('plan', 'boundary_routed') })`; `orch(approveArgs('plan')).out` is `` `plan approved: define_approved, 2 task(s); sha256 ${sha(PLAN)}` ``; then for each of `[runFile().approvals.spec, SPEC]` and `[runFile().approvals.plan, PLAN]`: `Object.keys(a).sort()` is `['at', 'by', 'path', 'sha256']`, `a` matches `{ path: rel, sha256: sha(rel), by: expect.any(String) }`, `a.sha256` matches `/^[0-9a-f]{64}$/`.
  - A4 **"A4 a plan whose boxes were ticked between hash and approve still approves"** (spec, Alternative paths): `awaiting('plan')`; `shown = sha(PLAN)`; `tickPlan('[X]')`; `orch(['approve', 'plan', PLAN, shown]).status` is 0; `runFile().approvals.plan.sha256` is `shown`.

  CLI tests of the Build check:
  - B1 **"B1 ticking boxes after approval keeps every later install passing"** (spec AC2): `driveTo('code')`; for `box` of `['[>]', '[X]']`: `install code` exits 0, `tickPlan(box)`, `handback code` with `say('code', 'build_executed')` exits 0; then `tickPlan('[x]')`, `install audit` exits 0, `handback audit` with `say('audit', 'build_executed')` exits 0; `tickPlan('[!]')`, `install qa` exits 0; `runFile().halt` is null.
  - B2 `it.each(['code', 'audit', 'qa'])` **"B2 a plan line edited after approval halts install %s with ORCH_APPROVED_DOC_CHANGED"** (spec AC3): `driveTo(role)`; `recorded = runFile().approvals.plan.sha256`; `plan(edited())`; `r = orch(['install', role])`; `r.status` is 1; `r.err` is `` `ORCH_APPROVED_DOC_CHANGED: plan ${PLAN} was approved at sha256 ${recorded} and now hashes ${sha(PLAN)}` ``; `runFile().halt.code` is `ORCH_APPROVED_DOC_CHANGED`.
  - B3 **"B3 a spec edited after approval halts the next install after define_approved"** (spec AC4): `driveTo('code')`; `recorded = runFile().approvals.spec.sha256`; `put(SPEC, '# Demo spec, edited after approval\n')`; `install code` exits 1 with `` `ORCH_APPROVED_DOC_CHANGED: spec ${SPEC} was approved at sha256 ${recorded} and now hashes ${sha(SPEC)}` ``; `runFile().halt.code` is `ORCH_APPROVED_DOC_CHANGED`.
  - B4 **"B4 install --check halts the same way and leaves the envelope as it was"**: `driveTo('code')`; `before = envelopeText()`; `plan(edited())`; `orch(['install', 'code', '--check'])` exits 1, `err` matches `/^ORCH_APPROVED_DOC_CHANGED: plan /`; `envelopeText()` is `before`.
  - B5 **"B5 an approved plan that can no longer be read halts with ORCH_APPROVED_DOC_CHANGED"**: `driveTo('code')`; `recorded = runFile().approvals.plan.sha256`; `rmSync(join(root, PLAN))`; `install code` exits 1 with `` `ORCH_APPROVED_DOC_CHANGED: plan ${PLAN} was approved at sha256 ${recorded} and can no longer be read` ``.
  - B6 **"B6 approvals without a hash halt the first install after define_approved with ORCH_APPROVAL_UNHASHED"** (spec AC8): `driveTo('code')`; `run = runFile()`; `old = { at: run.approvals.spec.at, by: run.approvals.spec.by }`; `runFileText(JSON.stringify({ ...run, approvals: { spec: old, plan: old } }))`; `install code` exits 1 with `'ORCH_APPROVAL_UNHASHED: run FEAT-011 records an approval without a document hash (started before FEAT-056); run end, then start'`; `runFile().halt.code` is `ORCH_APPROVAL_UNHASHED`.
- [X] [T-104] Red step: `npx vitest run tests/scripts/orchestrate.test.js`. Depends on T-103. Predicted full match set of that filter, 199 tests:
  - 164 of the 165 pre-existing tests: **green**. Today's `approve` ignores the extra hash argument (`cli` destructures only `verb, a, b`), and `approve plan` still reads the plan from `b`;
  - `names review in the usage line` (modified in T-102): **red**, today's usage line has no `hash`;
  - D1, D2 (4), D3, D4 (4) (10): **red**, `documentHash` is `undefined`, so each call throws `TypeError`;
  - H1, H2, H3 (5) (7): **red**, `hash` is an unknown verb today (exit 2 with the verb usage line);
  - A1 (2), A2 (5), A3, A4 (9): **red**, today's `approve` checks no hash, so it exits 0 and records no `path`/`sha256`;
  - B2 (3), B3, B4, B6 (6): **red**, today's `install` exits 0; B5 (1): **red**, today's `install code` refuses with exit 2 (`cannot read`) rather than halting;
  - B1 (1): **green** on today's code; it pins behavior that must survive.
  - Total: 165 passed, 34 failed.
- [X] [T-105] `scripts/orchestrate.mjs`, imports and the hash definition. Depends on T-104.
  - After line 7 (`import { spawnSync } from 'node:child_process';`) add `import { createHash } from 'node:crypto';`.
  - Replace `readPlan` (lines 192-197) with the shared definitions and reader:
    ```js
    const DOC_PATH = '<path relative to the run root>';
    const APPROVE_USAGE = `usage: orchestrate.mjs approve <spec|plan> ${DOC_PATH} <sha256>`;
    const HASH_USAGE = `usage: orchestrate.mjs hash <spec|plan> ${DOC_PATH}`;
    const SHA256_HEX = /^[0-9a-f]{64}$/i;
    // FEAT-056: progress ticks are not text changes, so only a list item's leading box reads as [ ].
    const PLAN_CHECKBOX = /^(\s*(?:[-*+]|\d+[.)])\s+)\[[ xX>!]\](?=\s|$)/;

    // One definition for hash, approve and the Build check. Applied per line, so \s never spans two lines.
    export function documentHash(kind, content) {
      const text = kind === 'plan' ? String(content).split('\n').map((l) => l.replace(PLAN_CHECKBOX, '$1[ ]')).join('\n') : content;
      return createHash('sha256').update(text).digest('hex');
    }

    // Raw bytes, so a spec hashes exactly as sha256sum does.
    function readDoc(root, rel, usage) {
      if (!rel || isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) throw new Refusal(usage);
      try { return readFileSync(join(root, rel)); } catch { throw new Refusal(`cannot read ${rel}`); }
    }
    ```
    The pattern is the spec's, verbatim (spec, The document hash). `String(buffer)` decodes UTF-8, as the spec requires for the plan.
  - `envelopeFields` (line 283): `extractTasks(readPlan(root, run.plan))` → `extractTasks(readDoc(root, run.plan, APPROVE_USAGE).toString('utf8'))`.
  - `grep -n readPlan scripts/orchestrate.mjs` prints nothing afterwards.
- [X] [T-106] `scripts/orchestrate.mjs`, the `hash` verb, placed right after `readDoc`. Depends on T-105.
  ```js
  // Read-only and run-free: prints the exact value approve checks, so the hash shown is the script's own.
  function hashDoc(root, kind, rel) {
    if (kind !== 'spec' && kind !== 'plan') throw new Refusal(HASH_USAGE);
    return `${documentHash(kind, readDoc(root, rel, HASH_USAGE))}  ${rel}`;
  }
  ```
- [X] [T-107] `scripts/orchestrate.mjs`, `approve` (lines 395-413) replaced by `approve` and `approvePlan`. Depends on T-106.
  ```js
  // Two human approvals, one gate write (A4): only an approved plan writes define_approved.
  // FEAT-056: each approval binds the bytes the owner was shown; a stale hash writes nothing.
  function approve(root, sessionId, what, rel, shown) {
    const run = liveRun(root, sessionId);
    const step = nextStep(run);
    if (step.await !== what) throw new Refusal(`approve ${what}: the next step is ${describeStep(step)}`);
    if (!SHA256_HEX.test(shown ?? '')) throw new Refusal(APPROVE_USAGE);
    const content = readDoc(root, rel, APPROVE_USAGE);
    const sha256 = documentHash(what, content);
    if (sha256 !== shown.toLowerCase()) {
      throw new Refusal(`ORCH_DOC_HASH_STALE: ${what} ${rel} hashes ${sha256}, not the ${shown} that was shown; show the document again`);
    }
    const approval = { at: new Date().toISOString(), by: gitValue(root, ['config', 'user.name'], 'unknown'), path: rel, sha256 };
    if (what === 'plan') return approvePlan(root, run, content.toString('utf8'), approval);
    saveRun(root, { ...run, approvals: { ...run.approvals, spec: approval } });
    return `spec approved: sha256 ${sha256}`;
  }

  function approvePlan(root, run, text, approval) {
    const tasks = extractTasks(text);
    if (tasks.length === 0) throw new Halt('ORCH_EMPTY_SCOPE', `${approval.path} holds no "### Task N" section`);
    for (const t of tasks) taskScope(t, approval.path);
    saveRun(root, {
      ...run, gate: 'define_approved', plan: approval.path, tasks: { ids: tasks.map((t) => t.id), done: 0 },
      approvals: { ...run.approvals, plan: approval },
    });
    return `plan approved: define_approved, ${tasks.length} task(s); sha256 ${approval.sha256}`;
  }
  ```
  The step check stays first, so `approve plan` on a run past the plan still refuses with the next step (test at line 127). The hash is compared before the plan checks (spec, Main path step 5), so a stale plan never reaches `ORCH_EMPTY_SCOPE`.
- [X] [T-108] `scripts/orchestrate.mjs`, the Build check, placed right before `install` (line 300), and its call. Depends on T-107.
  ```js
  const currentHash = (root, kind, rel) => { try { return documentHash(kind, readFileSync(join(root, rel))); } catch { return null; } };

  // FEAT-056: after define_approved, a changed spec or plan means the run would execute text nobody approved.
  function checkApprovedDocs(root, run) {
    for (const kind of ['spec', 'plan']) {
      const { path, sha256 } = run.approvals[kind] ?? {};
      if (typeof path !== 'string' || typeof sha256 !== 'string') {
        throw new Halt('ORCH_APPROVAL_UNHASHED', `run ${run.item} records an approval without a document hash (started before FEAT-056); run end, then start`);
      }
      const now = currentHash(root, kind, path);
      if (now === sha256) continue;
      throw new Halt('ORCH_APPROVED_DOC_CHANGED', `${kind} ${path} was approved at sha256 ${sha256} and ${now ? `now hashes ${now}` : 'can no longer be read'}`);
    }
  }
  ```
  In `install`, right after the `if (step.role !== role) throw new Refusal(…)` line, add `if (run.approvals.plan) checkApprovedDocs(root, run);`. `nextStep` reaches `code`, `audit` and `qa` only once `approvals.plan` is set, so this is exactly "every install after `define_approved`", for `--check` too (the check runs before the `check` branch). A run at `install plan` is not checked (spec, Main path step 6 names the Build band).
- [X] [T-109] `scripts/orchestrate.mjs`, `cli` (line 512). Depends on T-108.
  - `const [verb, a, b] = argv;` → `const [verb, a, b, c] = argv;`
  - `approve: () => approve(root, sid, a, b),` → `approve: () => approve(root, sid, a, b, c),`
  - Add `hash: () => hashDoc(root, a, b),` after the `approve` entry.
  - Usage line: `'usage: orchestrate.mjs start|install|handback|approve|review|end'` → `'usage: orchestrate.mjs start|install|handback|approve|hash|review|end'`.
  - `hash` never throws `Halt`, so `recordHalt` never runs for it; it calls neither `liveRun` nor `saveRun`.
- [X] [T-110] Green step: `npx vitest run tests/scripts/orchestrate.test.js`. Predicted: 199 passed, 0 failed. Depends on T-109.
- [X] [T-111] Stage: `git add -u scripts/orchestrate.mjs`, `git add -u tests/scripts/orchestrate.test.js`, `git add -u docs/superpowers/plans/2026-11-12-feat056-script-enforced-document-hash-verification-on.md` (ticks T-101 to T-110). Depends on T-110.
- [X] [T-112] Commit: `feat: orchestrate.mjs approve verifies the shown document hash and Build halts on a changed document [FEAT-056]`. Depends on T-111.

---

### Task 2: The orchestrate command shows the script's hash and names the new codes

**Files:**
- Modify: `tests/installer/commands-parity.test.js`
- Modify: `.claude/commands/cc-orchestrate.md`
- Modify: `project-template/.claude/commands/cc-orchestrate.md`

- [X] [T-201] `tests/installer/commands-parity.test.js`, the test at line 261 inside `describe('cc-orchestrate review loop …')`. Depends on T-112 (ticks ride this group).
  - Rename it `approves only on an owner message, with the hash the script checks [FEAT-056]`.
  - Its body becomes:
    ```js
    has('**Only an owner message approves.**', 'a suggestion in the input box are not approvals',
      'node "$S/orchestrate.mjs" hash <spec|plan> <doc>', '**The script checks the hash.**', '`ORCH_DOC_HASH_STALE`',
      'approve spec <spec path> <sha256>', 'approve plan <plan path> <sha256>',
      '`install code|audit|qa` halts `ORCH_APPROVED_DOC_CHANGED`', '`ORCH_APPROVAL_UNHASHED`');
    expect(text()).not.toContain('Re-hash before approve');
    expect(text()).not.toContain('Get-FileHash');
    ```
- [X] [T-202] Red step: `npx vitest run tests/installer/commands-parity.test.js`. Predicted full match set, 67 tests: the renamed test **red** (no new phrase present yet, and `Get-FileHash` still is); the 66 other tests **green**. Depends on T-201.
- [X] [T-203] `.claude/commands/cc-orchestrate.md`, then the identical edit to `project-template/.claude/commands/cc-orchestrate.md`. Depends on T-202.
  - Step 3, "What you show" (line 61): replace `its sha256 now (\`shasum -a 256 <doc>\` or \`sha256sum <doc>\`; in PowerShell, \`Get-FileHash -Algorithm SHA256 <doc>\`);` with `its sha256 from \`node "$S/orchestrate.mjs" hash <spec|plan> <doc>\`, the value \`approve\` checks (for the spec it equals \`sha256sum <doc>\`; for the plan every task checkbox is read as \`[ ]\`, so ticks never change it);`. The rest of the bullet stays.
  - Step 3, line 63: replace the whole `**Re-hash before approve.**` bullet with:
    > `   - **The script checks the hash.** Pass the path and hash you showed to \`approve\`. On \`ORCH_DOC_HASH_STALE\`, a refusal that writes nothing, the document changed after you showed it: show it again with its new hash and wait for a new owner approval.`
  - Step 3, line 64: `run \`node "$S/orchestrate.mjs" approve spec\`.` → `run \`node "$S/orchestrate.mjs" approve spec <spec path> <sha256>\` with the path and hash you showed.`
  - Step 3, line 65: `run \`node "$S/orchestrate.mjs" approve plan <plan path>\`.` → `run \`node "$S/orchestrate.mjs" approve plan <plan path> <sha256>\` with the path and hash you showed.` The sentence `This writes \`define_approved\`, …` after it stays.
  - "On any halt": after the `ORCH_DOC_LOCATION_UNRESOLVED` paragraph (line 33) and before the FEAT-060 `handback audit` paragraph, add:
    > `` `install code|audit|qa` halts `ORCH_APPROVED_DOC_CHANGED` when the approved spec or plan changed after its approval (a ticked plan checkbox is not a change), and `ORCH_APPROVAL_UNHASHED` on a run whose approvals were recorded before FEAT-056. Recovery for both is `end`, then `start`. ``
  - The FMT row (line 106) says `approve plan` halts with `ORCH_EMPTY_SCOPE` on a plan without `### Task N` sections. That stays true under T-107 (the hash is checked first, then the same plan checks run), so the row is read and left as it is; the spec lists it only as a place to check.
- [X] [T-204] Green step: `npx vitest run tests/installer/commands-parity.test.js`. Predicted: 67 passed (the byte-identical mirror test included). Depends on T-203.
- [X] [T-205] Stage: `git add -u .claude/commands/cc-orchestrate.md`, `git add -u project-template/.claude/commands/cc-orchestrate.md`, `git add -u tests/installer/commands-parity.test.js`, `git add -u docs/superpowers/plans/2026-11-12-feat056-script-enforced-document-hash-verification-on.md`. Depends on T-204.
- [X] [T-206] Commit: `docs: cc-orchestrate shows the script's document hash and passes it to approve [FEAT-056]`. Depends on T-205.

---

### Task 3: The wiki pages stop describing approvals as `{at, by}`

**Files:**
- Modify: `.github/wiki/pages/Orchestrator-Guide.md`
- Modify: `.github/wiki/pages/C4-Components.md`

- [X] [T-301] `.github/wiki/pages/Orchestrator-Guide.md`. Depends on T-206 (ticks ride this group).
  - Line 35 becomes: `| Approve | **You approve** — the document is shown with the hash \`orchestrate.mjs hash spec\` prints; \`approve spec <path> <sha256>\` refuses a stale hash and records \`{at, by, path, sha256}\` |`
  - Line 38 becomes: `| Approve | **You approve again** — \`approve plan <path> <sha256>\` checks the plan's hash (checkboxes read as \`[ ]\`) and moves the gate to \`define_approved\` |`
- [X] [T-302] `.github/wiki/pages/C4-Components.md`. No dependency on T-301.
  - Line 78: `ap1(["Owner approves the spec<br/>hash shown, re-hashed"])` → `ap1(["Owner approves the spec<br/>hash checked by the script"])`.
  - Line 139: replace `Approvals are \`orchestrate.mjs approve spec\` and \`approve plan\`, recorded in the run file as \`{at, by}\`. Only \`approve plan\` moves the gate to \`define_approved\`.` with `Approvals are \`orchestrate.mjs approve spec\` and \`approve plan\`, each given the document path and the sha256 shown to the owner and recorded in the run file as \`{at, by, path, sha256}\`; a stale hash is refused. Only \`approve plan\` moves the gate to \`define_approved\`. Every \`install\` after it re-hashes both documents and halts \`ORCH_APPROVED_DOC_CHANGED\` when either text changed; plan checkbox ticks do not count.`, and `The verbs are \`start\`, \`install\`, \`handback\`, \`approve\`, \`review\` and \`end\`.` with `The verbs are \`start\`, \`install\`, \`handback\`, \`approve\`, \`hash\`, \`review\` and \`end\`.` The rest of the line stays.
- [X] [T-303] Run `npx vitest run tests/wiki/wiki-gen.test.js`. Predicted: 22 passed (the edited lines are prose outside every generated block). Depends on T-301, T-302.
- [X] [T-304] Stage: `git add -u .github/wiki/pages/Orchestrator-Guide.md`, `git add -u .github/wiki/pages/C4-Components.md`, `git add -u docs/superpowers/plans/2026-11-12-feat056-script-enforced-document-hash-verification-on.md`. Depends on T-303.
- [X] [T-305] Commit: `docs: the wiki describes hash-bound approvals and the hash verb [FEAT-056]`. Depends on T-304.

---

### Task 4: Full suite and closeout

**Files:**
- Modify: `docs/superpowers/plans/2026-11-12-feat056-script-enforced-document-hash-verification-on.md`

- [X] [T-401] Run `npm test`. Predicted locally: exit 0, every file green, 34 tests more than the pre-change suite (all 34 in `orchestrate.test.js`; the parity test is renamed, not added), no new skip. CI legs: each leg's skipped set equals its `tools/skip-baseline.json` key, unchanged, because no added test is conditional. Depends on T-305.
- [X] [T-402] Grep checks: `git grep -n "Re-hash before approve\|Get-FileHash" -- .claude/commands project-template/.claude/commands` prints nothing; `git grep -n "{at, by}" -- .github/wiki` prints nothing; `git grep -n "readPlan" -- scripts` prints nothing. Depends on T-401.
- [X] [T-403] Stage: `git add -u docs/superpowers/plans/2026-11-12-feat056-script-enforced-document-hash-verification-on.md` (ticks T-305 to T-402). Depends on T-402.
- [X] [T-404] Commit: `docs: close out the FEAT-056 plan [FEAT-056]`. Depends on T-403.

---

## Test List

- [X] Unit: `documentHash` — spec over raw bytes, including non-UTF-8 (D1); each tick state `[>] [X] [x] [!]` keeps the plan hash over `-`, `*`, `+`, ordered and nested items (D2); an unticked plan equals its raw sha256, ticks on CRLF lines normalize, line endings still count (D3); a text change and a `[x]` in prose, a table cell or after list text change the hash (D4).
- [X] Integration (CLI, real argv/stdin/env contract): `hash` prints the `sha256sum` value with no run file and the normalized value in a live run, writing nothing (H1, H2); its five refusals (H3).
- [X] Integration: `approve` refuses a stale hash for spec and plan with `ORCH_DOC_HASH_STALE`, run file byte-identical (A1); its five usage refusals (A2); records exactly `{at, by, path, sha256}` lower-case from an upper-case argument (A3); a pre-ticked plan approves (A4).
- [X] Integration: the Build check passes through ticks to `qa` (B1); halts `ORCH_APPROVED_DOC_CHANGED` on a plan edit at `code`, `audit` and `qa` (B2), on a spec edit (B3), under `--check` without touching the envelope (B4), on an unreadable plan (B5); halts `ORCH_APPROVAL_UNHASHED` on pre-FEAT-056 approvals (B6).
- [X] Regression: every existing `approve` call passes the path and hash through `approveArgs`; the end-to-end `runs start to verify_pass on a two-task plan…` test stays green; the usage-line test names `hash`.
- [X] Command pin: `cc-orchestrate.md` names the `hash` verb, the two `approve` forms, `ORCH_DOC_HASH_STALE`, `ORCH_APPROVED_DOC_CHANGED` and `ORCH_APPROVAL_UNHASHED`, and no longer names `Re-hash before approve` or `Get-FileHash`; the mirrors stay byte-identical.
- [X] No E2E/UI test: there is no UI.

## Commit Order

0. Task 0 — the plan and its `.gitignore` leaf (done by this session's commit).
1. Task 1 — router and its tests, one commit: the new `approve` shape lands with every caller in the tests updated, so no commit has a red suite.
2. Task 2 — both `cc-orchestrate.md` copies and their pin, one commit, so the mirror test never sees one copy changed.
3. Task 3 — the two wiki pages.
4. Task 4 — closeout of the plan ticks. The ticks of T-403 and T-404 are made after the last commit and ride whichever commit next stages this plan.

## Identified Risks

- **The test oracle `sha()` is raw sha256.** It equals the plan hash only while the fixture plan has no ticked box. Every call that approves uses it before any tick; tests that tick (A4, H2, B1) either compute the shown hash before ticking or use `documentHash`. D3 pins the raw-equals-normalized property for an unticked plan, so a normalization that rewrote `[ ]` itself would fail there first.
- **`\s` in the pinned checkbox pattern.** Run with the `m` flag over the whole text, `^\s*` could start on a blank line and `\s+` could cross a newline, normalizing a `[x]` that begins a line after a lone `-`. T-105 applies the pattern one line at a time, which is what the spec's "a line that matches" says; D4's prose and table rows pin the non-list cases.
- **Checkbox-shaped lines inside a fenced code block** are list-item-shaped text and are normalized too. The spec exempts only prose, table cells and code spans; ticking one inside a fence changes nothing a reader sees. Accepted, not tested.
- **Spec bytes versus text.** `readDoc` returns a `Buffer`, so `hash spec` and the Build check hash raw bytes (D1, H1). Decoding the spec to a string first would break a non-UTF-8 spec silently; D1 uses invalid UTF-8 to catch that.
- **Refusal prefix.** `cli` prints a refusal as `orchestrate: <message>`, so the stale-hash stderr is `orchestrate: ORCH_DOC_HASH_STALE: …`, the same shape as `ORCH_REVIEW_CAP` (test at line 693). A1 pins the full string.
- **Existing tests that approve before writing a spec.** No spec file existed in the fixtures; `approveArgs('spec')` writes one at approval time. It is written after `start`, so FEAT-047's discovery at start, which reads existing folders, is unaffected; the FEAT-047 describe's `approveSpec` runs after `start` too.
- **Halt order in `install`.** The document check runs before `ORCH_AGENT_MISSING` and the envelope build. No existing test changes a document after approval, so no existing halt expectation moves; B4 pins that a `--check` halt leaves the envelope untouched.
- **Mirror drift.** Each `cc-orchestrate.md` edit is made twice; the byte-identical test fails on any difference.
- **Line numbers drift.** References are from HEAD dccb66c; locate by the quoted text if they move.
