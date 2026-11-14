# FEAT-053 per-role model selection for role agents, with escalation on repeated returns: implementation plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Update one checkbox per edit (BUG-003 invariant). Execute in file order.

**Goal:** a project opts in with one `CLAUDE.md` line, `- Role models: <value>`. `orchestrate.mjs start` parses it, resolves a model for each of the seven roles (the shipped `default-model:` of each profile, or single-role tokens), freezes the map in the run file as `models`, and every dispatch the run makes carries the model the script prints: `install` prints `model: <alias>` and records `dispatch_model`, `handback` copies it into the entry, `review` appends `; model <alias>` to the lines that trigger a dispatch. When an audit returns a plan task that an earlier audit of the run already returned, the fix round's `code` dispatch runs on `opus`, recorded on the audit entry's `fix` object. With no line, stdout and the run file stay byte-identical to today's.

**Spec:** `docs/superpowers/specs/2026-11-14-feat053-per-role-model-selection-for-role-agents-with-design.md` (approved 2026-11-14, sha256 `908e1f943808792ae8d566ee03269490048a9549596c7a002b7dcf173b7fa8b9`). Issue #187.

**Test command:** `npm test`. Filtered runs use `npx vitest run <file>` and `-t "<name>"`.

## Global Constraints

- No release records: `VERSION`, the `package.json` / `package-lock.json` version, `CHANGELOG.md`, `AGENT-READABLE BACKLOG.md`, `.claude/memory/**` and the README "Known limits" lines stay untouched. The README edit in Task 5 is in the `/cc-orchestrate` walkthrough's "Useful variations" list, not in Known limits.
- No new dependency, no network, no workflow change. `.claude/hooks/pre-tool-use.mjs` and its `project-template/` copy are not touched (owner decision 2). The installer is not touched: it copies `project-template/` as it does today (`bin/code-conductor.mjs`, `assertAssets(... 'project-template')`), and `tests/installer/templates.test.js` stays green unchanged.
- `scripts/orchestrate.mjs` is the router, not one of the protected surfaces CONTRIBUTING names (hooks, installer, SNAP scripts, settings); no ritual applies. `snap-contract.mjs`, `snap-build.mjs` and `snap-validate.mjs` do not change: the model travels as its own stdout line, like the fix-round line.
- Functions of 30 lines or fewer, guard clauses, comments say why.
- Mirrors stay byte-identical: each `.claude/agents/<role>.md` = `project-template/.claude/agents/<role>.md`, and `.claude/commands/cc-orchestrate.md` = `project-template/.claude/commands/cc-orchestrate.md`. Every edit to one is made identically to the other in the same task. Files under `.claude/` are edited with the Edit tool (Bash cannot write there in the build sandbox).
- `scripts/orchestrate.mjs` never writes `CLAUDE.md`: the existing test `[AC10] never writes CLAUDE.md` (`tests/scripts/orchestrate.test.js:1095`) forbids a write call on any line that names it, and the new reader only calls `readFileSync`.
- Tests are added, none skipped and none conditional, so `tools/skip-baseline.json` is untouched on every CI leg.
- Every file this plan edits is already tracked, so every staging step is `git add -u <path>` with an explicit path; only Task 0 stages a new file.

## Plan decisions

The spec leaves these to the plan, or they follow from reading the code it cites.

1. **The parser lives in `scripts/orchestrate.mjs`**, as three small functions next to `findAgent` (`roleModelsValue`, `parseRoleModels`, `profileDefault`) and one resolver (`resolveRoleModels`). `default` needs `findAgent`, which `orchestrate.mjs` owns; putting the parser in `doc-locations.mjs` would make that module import the router. The reader follows `doc-locations.mjs`'s `readText` (`scripts/doc-locations.mjs:78-80`): `readFileSync(join(root, 'CLAUDE.md'), 'utf8')` with `\r\n` normalized to `\n`, and an unreadable or absent file is the no-configuration path.
2. **Line recognition.** Every line that starts with `- Role models:` counts toward "more than one line". The single line must then match the spec's `^- Role models: (.+)$`; a line that starts with the prefix but does not match (for example `- Role models:` with no value) halts instead of silently inheriting. Tokens are `value.split(',')`, each trimmed.
3. **The exact halt reasons**, each printed as `ORCH_ROLE_MODELS_INVALID: <reason>`, checked per token in this order (empty, `default`, shape, role, model, duplicate):
   - two or more lines: `CLAUDE.md has <n> "- Role models:" lines; keep one`
   - no value: `"<the line>" has no value; write default or <role>=<model> tokens`
   - empty token: `empty token in "- Role models: <value>"`
   - `default` twice: `"default" appears twice`
   - not `default` and not exactly one `=`: `token "<token>" is neither default nor <role>=<model>`
   - unknown role: `unknown role "<role>" in "<token>"; the roles are spec, plan, code, audit, security, qa, define-review`
   - model outside the allow-list: `model "<model>" in "<token>" is not one of opus, sonnet, haiku, inherit`
   - a role set twice: `role "<role>" is set twice`
   - a profile's bad default: `<absolute profile path> sets default-model: <value>, not one of opus, sonnet, haiku, inherit`
4. **A role with no profile, or a profile without `default-model:`, resolves to `inherit` under `default`.** The spec names the home-profile case; a missing profile is the same answer, and `install` still halts `ORCH_AGENT_MISSING` for it at dispatch, as today.
5. **The constants.** `export const MODEL_ALIASES = ['opus', 'sonnet', 'haiku', 'inherit'];` is the one allow-list `start`, `profileDefault` and `isValidRun` read (owner decision 3). `export const MODEL_ROLES = ['spec', 'plan', 'code', 'audit', 'security', 'qa', 'define-review'];` fixes the key set and the print order of the start segment. `const ESCALATION_MODEL = 'opus';` is not exported.
6. **Segment placement.** The start line's existing text ends with the security note (`securityNote`), and the FEAT-047 parity test (`tests/installer/commands-parity.test.js:219-226`) pins the sentence describing it. The `; role models: …` segment is appended at the very end of the line, after the security note, which keeps every existing prefix and test intact while staying "after the audit rounds". The note `; note: audit and code share <alias>` follows the segment.
7. **`dispatch_model`.** `install <role>` without `--check` writes it for every dispatch of a configured run, `inherit` included, in the same `saveRun` that records `role`. `handback` does not clear it: a hand-back needs an installed role, and every install overwrites it. `resume` keeps `models` and `dispatch_model` by its existing `...run` spread (`scripts/orchestrate.mjs:900-903`) and sets `role: null`, so the next hand-back always follows a fresh install; `resume` needs no code change.
8. **The entry's `model` is written in `recordHandback`**, from `run.dispatch_model`, only when `run.models` is an object and `dispatch_model` is in the allow-list. `securityHandback` also goes through `recordHandback`, so the security entry gets it too. A run without `models` gets no key, so the FEAT-059 test that pins the security entry's keys (`['role', 'gate', 'at', 'security']`) still passes.
9. **The fix round's model at install** is `fixDue(run).model ?? run.models.code`. The fallback covers a run file edited to drop `fix.model`, which `isValidRun` lets through as an absent key.
10. **Returned tasks.** `fixModel(root, run, paths)` re-reads the approved plan with `extractTasks` (the same read `fixScope` makes; `checkApprovedDocs` has just checked its hash) and keeps, in plan order, every task whose `files` include one of the verdict's blocker or major paths (`verdict.paths`, already normalized by `findingPath`). The earlier set is the union of `fix.tasks` arrays on every audit entry before the current one. `escalated` is the returned tasks found in that set, in plan order. The `fix` object becomes `{ round, files, review, sha256, tasks, model }`, plus `escalated` only when it is non-empty. `fixModel` runs after `fixScope`, so a scope halt still records no `fix`.
11. **The `handback audit` line** ends with `; model <models.code>`, or `; model opus (escalated: <ids joined with ", "> returned twice)`.
12. **`review`.** A helper `modelSegment(run, role)` returns `; model <run.models[role]>`, or `''` without `models`. `review` passes `modelSegment(run, 'define-review')` to `openRound`, which appends it only to the `round <n> of 3` line, and `modelSegment(run, role)` to `recordRound`, which appends it only to the `OPEN <k>; revise …` line. The `closed …` lines trigger no dispatch and stay as they are.
13. **`isValidRun`** gains `isModelRecord(run)`: `models` absent, or a plain object whose sorted keys equal the sorted `MODEL_ROLES` and whose every value is in `MODEL_ALIASES`; `dispatch_model` absent or in the allow-list; every hand-back's `fix`, when an object, has `model` absent or in the allow-list.
14. **Profiles.** Each of the 14 files gains one frontmatter line, `default-model: <alias>`, directly after its `tools:` line. The largest profile (`security.md`, 3548 bytes) stays far under the 999-token ceiling (`ceil(3570 / 4) = 893`); `define-review.md` (1568 bytes) likewise.
15. **Test fixture.** The `agents()` helper in `tests/scripts/orchestrate.test.js` (line 74) writes `default-model: <alias>` from a fixture map with the shipped values, for the roles the map names. No existing test reads that key or compares the fixture's bytes (`grep -n "description: fixture"` finds only the helper), and a run without the `CLAUDE.md` line never reads it. `define-review` is not added to `ROLES` (used across the file); the new tests write its profile with `agents(['define-review'])`.
16. **Wiki and installer.** `.github/wiki/wiki-gen.mjs` reads only `tools` from the profiles' frontmatter (line 67), and no page under `.github/wiki/pages/` says that roles inherit the session's model (`grep -n "model" .github/wiki/pages/*.md` finds only the C4 model and token-use sentences), so no wiki page changes.

## Baseline (measured on this branch, HEAD 1b60643, before Task 1)

`npx vitest run tests/scripts/orchestrate.test.js tests/unit/role-profiles.test.js tests/installer/commands-parity.test.js tests/installer/templates.test.js`: 4 files, 684 passed (orchestrate 463, role-profiles 95, commands-parity 87, templates 39).

`npm test` (full suite): 2810 tests, 2794 passed, 12 skipped; see "Baseline, full suite" at the end for the 4 non-product failures.

Line numbers below are from HEAD 1b60643; locate by the quoted text if they move.

---

### Task 0: Commit this plan

**Files:**
- Create: `docs/superpowers/plans/2026-11-14-feat053-per-role-model-selection-for-role-agents-with.md`
- Modify: `.gitignore`

- [X] [T-001] Create this plan file. No dependency.
- [X] [T-002] `.gitignore`: add the leaf `!/docs/superpowers/plans/2026-11-14-feat053-per-role-model-selection-for-role-agents-with.md` in sorted position, right after `!/docs/superpowers/plans/2026-11-13-feat061-role-agents-dispatched-by-phase-commands.md` and before `!/docs/superpowers/specs/2026-06-09-bug001-cc-compact-design.md`. Depends on T-001.
- [X] [T-003] Stage: `git add -u .gitignore` and `git add -f docs/superpowers/plans/2026-11-14-feat053-per-role-model-selection-for-role-agents-with.md` (new file at a tracked surface; `-f` on one explicit path, per the CLAUDE.md staging convention). Depends on T-002.
- [X] [T-004] Commit: `docs: plan for per-role model selection with escalation on repeated returns [FEAT-053]`. Depends on T-003.

---

### Task 1: Ship `default-model:` in both mirrors (AC2)

**Files:**
- Modify: `tests/unit/role-profiles.test.js`
- Modify: `.claude/agents/spec.md`
- Modify: `.claude/agents/plan.md`
- Modify: `.claude/agents/code.md`
- Modify: `.claude/agents/audit.md`
- Modify: `.claude/agents/security.md`
- Modify: `.claude/agents/qa.md`
- Modify: `.claude/agents/define-review.md`
- Modify: `project-template/.claude/agents/spec.md`
- Modify: `project-template/.claude/agents/plan.md`
- Modify: `project-template/.claude/agents/code.md`
- Modify: `project-template/.claude/agents/audit.md`
- Modify: `project-template/.claude/agents/security.md`
- Modify: `project-template/.claude/agents/qa.md`
- Modify: `project-template/.claude/agents/define-review.md`

Failure point: a profile edited in one mirror only, or a `model:` key that Claude Code would read. Verification: the byte-identity rows, the new no-`model:` rows and the updated hash rows.

- [ ] [T-101] `tests/unit/role-profiles.test.js`: append at the end of the file. Depends on T-004.
  ```js
  // FEAT-053: the shipped defaults, read only through `- Role models: default`; no profile carries the model key Claude Code reads.
  const DEFAULT_MODELS = { spec: 'opus', plan: 'opus', code: 'sonnet', audit: 'opus', security: 'opus', qa: 'haiku', 'define-review': 'opus' };

  describe('per-role default models [FEAT-053 AC2]', () => {
    const rows = [TEMPLATE, MIRROR].flatMap((d) => Object.keys(DEFAULT_MODELS).map((r) => [d, r]));

    it.each(rows)('%s/%s.md carries its default-model: and no model: key', (dir, role) => {
      const text = read(`${dir}/${role}.md`);
      expect(field(text, 'default-model')).toBe(DEFAULT_MODELS[role]);
      expect(field(text, 'model')).toBeUndefined();
    });

    it('covers every shipped profile, and the auditor defaults to another model than the code author', () => {
      expect(Object.keys(DEFAULT_MODELS).sort()).toEqual([...ROLES, 'define-review'].sort());
      expect(DEFAULT_MODELS.audit).not.toBe(DEFAULT_MODELS.code);
    });
  });
  ```
  `field()` anchors its key at the start of a frontmatter line (`^${key}:`, `m` flag), so `field(text, 'model')` never matches `default-model:`.
- [ ] [T-102] Red step: `npx vitest run tests/unit/role-profiles.test.js -t "FEAT-053"`. Predicted full match set, 15 tests: the 14 `carries its default-model:` rows **red** (`field` answers `undefined`), the `covers every shipped profile` test **green**. Every other test is filtered out. Depends on T-101.
- [ ] [T-103] The 14 profiles: with the Edit tool, add one line directly after the `tools:` line of each file's frontmatter, the same line in both mirrors. Depends on T-102.
  - `spec.md`, `plan.md`, `audit.md`, `security.md`, `define-review.md`: `default-model: opus`
  - `code.md`: `default-model: sonnet`
  - `qa.md`: `default-model: haiku`
- [ ] [T-104] Check: `for r in spec plan code audit security qa define-review; do cmp .claude/agents/$r.md project-template/.claude/agents/$r.md || echo DIFF $r; done` prints nothing, and `grep -n "^model:" .claude/agents/*.md project-template/.claude/agents/*.md` prints nothing. Then `npx vitest run tests/unit/role-profiles.test.js`. Predicted: 110 tests, 98 passed, 12 **red**: the `profiles unchanged since 1.37.0` rows for `audit`, `code`, `plan`, `qa`, `security`, `spec` in both directories (their bytes changed on purpose). The 15 FEAT-053 tests, the byte-identity rows and both 999-token ceilings are green. Depends on T-103.
- [ ] [T-105] `tests/unit/role-profiles.test.js`, `PROFILE_SHA256_1_37_0` (lines 165-176): replace the six hashes with the values `sha256sum project-template/.claude/agents/{audit,code,plan,qa,security,spec}.md` prints (the mirror files hash the same, T-104), and add one comment line as the first line inside the object, above the FEAT-061 line: `// FEAT-053 changed every profile on purpose: each one carries a default-model: line, read only by orchestrate.mjs start through - Role models: default.` (owner decision 4). Depends on T-104.
- [ ] [T-106] Green step: `npx vitest run tests/unit/role-profiles.test.js`. Predicted: 110 passed (95 + 15). Depends on T-105.
- [ ] [T-107] Stage: `git add -u tests/unit/role-profiles.test.js`, then `git add -u` with each of the 14 profile paths listed in **Files:**, one explicit path each, then `git add -u docs/superpowers/plans/2026-11-14-feat053-per-role-model-selection-for-role-agents-with.md`. Depends on T-106.
- [ ] [T-108] Commit: `feat: ship a default-model in every role profile, read only on opt-in [FEAT-053]`. Depends on T-107.

---

### Task 2: `start` reads `- Role models:` and freezes `models`; `isValidRun` guards the record

**Files:**
- Modify: `tests/scripts/orchestrate.test.js`
- Modify: `scripts/orchestrate.mjs`

Failure point: a parse error that writes or clears a run file, or a no-configuration start whose output moves. Verification: S6-S8 assert no run file is written or replaced; S9 and every existing start test assert the unconfigured output.

- [ ] [T-201] `tests/scripts/orchestrate.test.js`, the `agents()` helper (lines 74-77): add above it `const FIXTURE_MODELS = { spec: 'opus', plan: 'opus', code: 'sonnet', audit: 'opus', security: 'opus', qa: 'haiku', 'define-review': 'opus' };` with the comment `// The shipped default-model values (FEAT-053); read only by a run whose CLAUDE.md opts in.`, and change the write to `` `---\nname: ${r}\ndescription: fixture\n${FIXTURE_MODELS[r] ? `default-model: ${FIXTURE_MODELS[r]}\n` : ''}---\nfixture\n` ``. Depends on T-108.
- [ ] [T-202] `tests/scripts/orchestrate.test.js`: append at the end of the file a block of shared helpers and `describe('role models at start [FEAT-053]', …)`. Depends on T-201.
  ```js
  // FEAT-053 helpers, shared by the three role-model describes below.
  const DEFAULT_SEGMENT = 'spec=opus, plan=opus, code=sonnet, audit=opus, security=opus, qa=haiku, define-review=opus';
  const DEFAULT_MAP = { spec: 'opus', plan: 'opus', code: 'sonnet', audit: 'opus', security: 'opus', qa: 'haiku', 'define-review': 'opus' };
  const claudeMd = (text) => writeFileSync(join(root, 'CLAUDE.md'), `# P\n\n${text}`);
  const roleModels = (value) => claudeMd(`- Role models: ${value}\n`);
  // A driveTo prep: the reviewer's profile and the opt-in line, written before start reads them.
  const configured = (value = 'default') => () => { agents(['define-review']); roleModels(value); };
  const startConfigured = (value = 'default', sid = 'sess-1') => { agents(); configured(value)(); return orch(['start', 'FEAT-011'], { sid }); };
  const lastLine = (out) => out.split('\n').at(-1);
  const RUN_OK = { v: 1, session_id: 's', item: 'FEAT-011', gate: 'boundary_routed', approvals: { spec: null, plan: null }, handbacks: [], tasks: { ids: [], done: 0 } };
  ```
  Tests in `describe('role models at start [FEAT-053]')`:
  - S1 **"S1 default records the shipped defaults and ends the start line with the role models segment"**: `startConfigured()` has status 0, `out` ends with `` `${SEC_NONE}; role models: ${DEFAULT_SEGMENT}` ``, `runFile().models` `toEqual(DEFAULT_MAP)`.
  - S2 `it.each(['default, qa=sonnet', 'qa=sonnet, default', '  default ,qa=sonnet  '])` **"S2 a role=model token overrides default whatever its order: %j"**: status 0; `runFile().models` equals `{ ...DEFAULT_MAP, qa: 'sonnet' }`.
  - S3 **"S3 a partial configuration leaves every other role inherit"**: `startConfigured('code=sonnet')`; `out` ends with `; role models: spec=inherit, plan=inherit, code=sonnet, audit=inherit, security=inherit, qa=inherit, define-review=inherit`; no `; note:`.
  - S4 **"S4 default resolves a home profile without default-model: to inherit"**: `agents()`, then `rmSync(join(root, '.claude', 'agents', 'qa.md'))`, `mkdirSync(join(home, '.claude', 'agents'), { recursive: true })`, write `join(home, '.claude', 'agents', 'qa.md')` as `---\nname: qa\ndescription: home\n---\nhome\n`, `configured()()`, start; `runFile().models.qa` is `'inherit'` and `out` contains `qa=inherit`.
  - S5 `it.each([['audit=sonnet, code=sonnet', '; note: audit and code share sonnet'], ['audit=inherit, code=inherit', '']])` **"S5 %j notes a shared model only for a non-inherit alias"**: `out` ends with the expected note; for the second row `out` ends with `define-review=inherit` and does not contain `; note:`.
  - S6 `it.each` over `[name, claudeText, reason]`, **"S6 %s halts ORCH_ROLE_MODELS_INVALID and writes no run file"**: `agents()`, `agents(['define-review'])`, `claudeMd(claudeText)`, start; status 1, `err` `toBe(`ORCH_ROLE_MODELS_INVALID: ${reason}`)`, `existsSync(join(root, RUN_FILE))` false. Rows, with the reasons of plan decision 3:
    1. `'an unknown role'`, `'- Role models: default, coder=opus\n'`, `'unknown role "coder" in "coder=opus"; the roles are spec, plan, code, audit, security, qa, define-review'`
    2. `'a model outside the allow-list'`, `'- Role models: qa=gpt\n'`, `'model "gpt" in "qa=gpt" is not one of opus, sonnet, haiku, inherit'`
    3. `'a role set twice'`, `'- Role models: qa=opus, qa=haiku\n'`, `'role "qa" is set twice'`
    4. `'an empty token'`, `'- Role models: default,,qa=opus\n'`, `'empty token in "- Role models: default,,qa=opus"'`
    5. `'default twice'`, `'- Role models: default, default\n'`, `'"default" appears twice'`
    6. `'a bare role'`, `'- Role models: qa\n'`, `'token "qa" is neither default nor <role>=<model>'`
    7. `'two lines'`, `'- Role models: default\n- Role models: qa=haiku\n'`, `'CLAUDE.md has 2 "- Role models:" lines; keep one'`
    8. `'a line with no value'`, `'- Role models:\n'`, `'"- Role models:" has no value; write default or <role>=<model> tokens'`
  - S7 **"S7 default with a profile default-model outside the allow-list halts naming the path and the value"**: `agents()`, overwrite `join(root, '.claude', 'agents', 'qa.md')` with `---\nname: qa\ndescription: fixture\ndefault-model: gpt\n---\nfixture\n`, `configured()()`, start; status 1, `err` is `` `ORCH_ROLE_MODELS_INVALID: ${join(root, '.claude', 'agents', 'qa.md')} sets default-model: gpt, not one of opus, sonnet, haiku, inherit` ``, no run file.
  - S8 **"S8 a malformed line leaves another session's run file as it was"**: `expect(orch(['start', 'FEAT-011'], { sid: 'sess-0' }).status).toBe(0)`; `const before = readFileSync(join(root, RUN_FILE), 'utf8')`; `roleModels('qa=gpt')`; `orch(['start', 'FEAT-012'])` has status 1 and the `ORCH_ROLE_MODELS_INVALID` prefix; the run file's bytes equal `before`.
  - S9 `it.each([['no CLAUDE.md', null], ['a CLAUDE.md without the line', '- Specs: docs/specs\n- Plans: docs/plans\n']])` **"S9 with %s start records no models and prints no role models segment"**: write the text when not null; start; status 0; `out` does not contain `role models`; `runFile()` has no `models` and no `dispatch_model` property.
  - S10 **"S10 isValidRun accepts a run without models and with a valid models, dispatch_model and fix.model"**: `isValidRun(RUN_OK)` true; `isValidRun({ ...RUN_OK, models: DEFAULT_MAP, dispatch_model: 'inherit', handbacks: [{ role: 'audit', fix: { round: 1, model: 'opus' } }] })` true.
  - S11 `it.each` **"S11 isValidRun rejects %s"**, each `isValidRun(run)` false. With `const { 'define-review': _reviewer, ...six } = DEFAULT_MAP;` at the top of the describe, the rows are: `['models without define-review', { ...RUN_OK, models: six }]`, `['models with an extra role', { ...RUN_OK, models: { ...DEFAULT_MAP, review: 'opus' } }]`, `['a models value outside the allow-list', { ...RUN_OK, models: { ...DEFAULT_MAP, qa: 'gpt' } }]`, `['models as an array', { ...RUN_OK, models: [] }]`, `['a dispatch_model outside the allow-list', { ...RUN_OK, dispatch_model: 'gpt' }]`, `['a fix.model outside the allow-list', { ...RUN_OK, handbacks: [{ role: 'audit', fix: { round: 1, model: 'gpt' } }] }]`.
  - S12 **"S12 a run file edited to models.qa gpt halts ORCH_RUN_INVALID"**: `startConfigured()`; rewrite the run file with `models.qa = 'gpt'`; `orch(['install', 'spec', '--check'])` has status 1 and `err` matching `/^ORCH_RUN_INVALID: /`.
  - S13 **"S13 the allow-list and the role set are exported constants"**: `orchestrateModule.MODEL_ALIASES` equals `['opus', 'sonnet', 'haiku', 'inherit']`, `orchestrateModule.MODEL_ROLES` equals `['spec', 'plan', 'code', 'audit', 'security', 'qa', 'define-review']`. Read through the namespace import (line 11), so the file still loads before the export exists.
- [ ] [T-203] Red step: `npx vitest run tests/scripts/orchestrate.test.js -t "role models at start"`. Predicted full match set, 29 tests: **green** S9 (2 rows) and S10 (1); **red** the other 26: S1, S2 (3), S3, S4, S5 (2), S6 (8, start succeeds), S7, S8 (the stale run is replaced), S11 (6, extra keys pass today), S12, S13. Every other test is filtered out. Depends on T-202.
- [ ] [T-204] `scripts/orchestrate.mjs`, constants: after `const isAuditRounds = …` (line 36) add: Depends on T-203.
  ```js
  // FEAT-053: the Agent tool's model aliases plus inherit; the one list start, the profiles and isValidRun are checked against.
  export const MODEL_ALIASES = ['opus', 'sonnet', 'haiku', 'inherit'];
  export const MODEL_ROLES = ['spec', 'plan', 'code', 'audit', 'security', 'qa', 'define-review'];
  const ESCALATION_MODEL = 'opus';
  const ROLE_MODELS_PREFIX = '- Role models:';
  const ROLE_MODELS_LINE = /^- Role models: (.+)$/;
  const isModel = (m) => MODEL_ALIASES.includes(m);
  ```
- [ ] [T-205] `scripts/orchestrate.mjs`, `isValidRun` (lines 113-120): above it add `isModelRecord` (plan decision 13), and append `&& isModelRecord(run)` as the last term of `isValidRun`'s expression. Depends on T-204.
  ```js
  // FEAT-053: a hand-edited model would let the run file, not the project, choose what a dispatch runs on.
  function isModelRecord(run) {
    const m = run.models;
    const keys = isPlainObject(m) ? Object.keys(m).sort().join() : null;
    if (m !== undefined && (keys !== [...MODEL_ROLES].sort().join() || !MODEL_ROLES.every((r) => isModel(m[r])))) return false;
    if (run.dispatch_model !== undefined && !isModel(run.dispatch_model)) return false;
    return run.handbacks.every((h) => !isPlainObject(h?.fix) || h.fix.model === undefined || isModel(h.fix.model));
  }
  ```
  Add to the comment above `isValidRun`: `// FEAT-053: and models, dispatch_model and fix.model hold only the allow-list.`
- [ ] [T-206] `scripts/orchestrate.mjs`, the parser: after `findAgent` (ends line 279) add `roleModelsValue`, `parseRoleModels`, `profileDefault`, `resolveRoleModels` and `modelsNote`, with the reasons of plan decision 3 verbatim. Depends on T-205.
  ```js
  const modelsInvalid = (reason) => new Halt('ORCH_ROLE_MODELS_INVALID', reason);

  // FEAT-053: the one CLAUDE.md opt-in line, or null; a prefix without a value halts rather than inheriting silently.
  function roleModelsValue(root) {
    let text = '';
    try { text = readFileSync(join(root, 'CLAUDE.md'), 'utf8').replace(/\r\n/g, '\n'); } catch { return null; }
    const lines = text.split('\n').filter((l) => l.startsWith(ROLE_MODELS_PREFIX));
    if (lines.length === 0) return null;
    if (lines.length > 1) throw modelsInvalid(`CLAUDE.md has ${lines.length} "${ROLE_MODELS_PREFIX}" lines; keep one`);
    const m = ROLE_MODELS_LINE.exec(lines[0]);
    if (!m) throw modelsInvalid(`"${lines[0]}" has no value; write default or <role>=<model> tokens`);
    return m[1];
  }

  // An explicit token wins over default whatever the order, so the parse only collects.
  function parseRoleModels(value) {
    const explicit = {};
    let defaults = false;
    for (const token of value.split(',').map((t) => t.trim())) {
      if (token === '') throw modelsInvalid(`empty token in "${ROLE_MODELS_PREFIX} ${value}"`);
      if (token === 'default') {
        if (defaults) throw modelsInvalid('"default" appears twice');
        defaults = true;
        continue;
      }
      const parts = token.split('=');
      if (parts.length !== 2) throw modelsInvalid(`token "${token}" is neither default nor <role>=<model>`);
      const [role, model] = parts;
      if (!MODEL_ROLES.includes(role)) throw modelsInvalid(`unknown role "${role}" in "${token}"; the roles are ${MODEL_ROLES.join(', ')}`);
      if (!isModel(model)) throw modelsInvalid(`model "${model}" in "${token}" is not one of ${MODEL_ALIASES.join(', ')}`);
      if (role in explicit) throw modelsInvalid(`role "${role}" is set twice`);
      explicit[role] = model;
    }
    return { defaults, explicit };
  }

  // The shipped default sits under a key Claude Code does not read; no profile, or no key, inherits.
  function profileDefault(role, root) {
    const path = findAgent(role, root);
    if (!path) return 'inherit';
    const front = readFileSync(path, 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const value = front?.[1].match(/^default-model:[ \t]*(\S*)[ \t]*\r?$/m)?.[1];
    if (value === undefined) return 'inherit';
    if (!isModel(value)) throw modelsInvalid(`${path} sets default-model: ${value}, not one of ${MODEL_ALIASES.join(', ')}`);
    return value;
  }

  // Fixed at start, like audit_rounds; null keeps a run without the line exactly as it was before FEAT-053.
  function resolveRoleModels(root) {
    const value = roleModelsValue(root);
    if (value === null) return null;
    const { defaults, explicit } = parseRoleModels(value);
    return Object.fromEntries(MODEL_ROLES.map((r) => [r, explicit[r] ?? (defaults ? profileDefault(r, root) : 'inherit')]));
  }

  const shareNote = (m) => (m.audit === m.code && m.code !== 'inherit' ? `; note: audit and code share ${m.code}` : '');
  const modelsNote = (m) => (m ? `; role models: ${MODEL_ROLES.map((r) => `${r}=${m[r]}`).join(', ')}${shareNote(m)}` : '');
  ```
  `parseRoleModels` is 21 lines; every function stays under 30. `role in explicit` is safe because `role` already passed the `MODEL_ROLES` check.
- [ ] [T-207] `scripts/orchestrate.mjs`, `start` (lines 1015-1039). Depends on T-206.
  - After `const docs = resolveDocs(root, item);` add `const models = resolveRoleModels(root);`. It runs before `if (old) clearRunFiles(root);` and before any write, so a halt leaves a stale run and every file as they were (S8).
  - In the `saveRun` object, after `security, docs,` add `...(models ? { models } : {}),` on its own line.
  - The return line: append `${modelsNote(models)}` after `${securityNote(security, root, stack())}`.
  - `start` stays in the `cli` list of verbs that record no halt (`['start', 'envelope', 'resume']`), so `ORCH_ROLE_MODELS_INVALID` writes nothing.
- [ ] [T-208] Green step: `npx vitest run tests/scripts/orchestrate.test.js -t "role models at start"`. Predicted: the same 29 tests, all **green**. Then `npx vitest run tests/scripts/orchestrate.test.js`: 492 passed (463 + 29), including `[AC10] never writes CLAUDE.md` (the new line naming `CLAUDE.md` calls only `readFileSync`). Depends on T-207.
- [ ] [T-209] Stage: `git add -u scripts/orchestrate.mjs`, `git add -u tests/scripts/orchestrate.test.js`, `git add -u docs/superpowers/plans/2026-11-14-feat053-per-role-model-selection-for-role-agents-with.md`. Depends on T-208.
- [ ] [T-210] Commit: `feat: read per-role models from CLAUDE.md at start and freeze them in the run file [FEAT-053]`. Depends on T-209.

---

### Task 3: Every dispatch prints its model; entries record it (AC1, AC4)

**Files:**
- Modify: `tests/scripts/orchestrate.test.js`
- Modify: `scripts/orchestrate.mjs`

Failure point: `--check` writing `dispatch_model`, or a model line leaking into an unconfigured run. Verification: D1 compares the run file's bytes around `--check`; D6 asserts no model text without the line.

- [ ] [T-301] `tests/scripts/orchestrate.test.js`: append `describe('role models at dispatch [FEAT-053]', …)` after the Task 2 describe. Depends on T-210.
  - D1 **"D1 install --check prints model: last and writes nothing; install records dispatch_model; handback copies it into the entry"**: `driveTo('spec', { prep: configured() })`; `const before = readFileSync(join(root, RUN_FILE), 'utf8')`; `const check = orch(['install', 'spec', '--check'])`: status 0, `lastLine(check.out)` is `model: opus`, `JSON.parse(check.out.split('\n')[0]).sys.role` is `spec`, the run file's bytes equal `before`; `orch(['install', 'spec'])` prints the same lines, and `runFile().dispatch_model` is `'opus'`; `orch(['handback', 'spec'], { input: say('spec', 'boundary_routed') })` has status 0, its `out` is `spec handed back boundary_routed`, and `runFile().handbacks[0].model` is `'opus'`.
  - D2 **"D2 every role dispatches on its configured model and each entry records it"**: `driveTo('security', { prep: configured() })`; `runFile().handbacks.map((h) => h.model)` equals `['opus', 'opus', 'sonnet', 'sonnet', 'opus']` (spec, plan, two code tasks, audit); `lastLine(orch(['install', 'security', '--check']).out)` is `model: opus`; `securityPass()` has status 0 and the security entry's `model` is `'opus'`; `lastLine(orch(['install', 'qa', '--check']).out)` is `model: haiku`; `orch(['install', 'qa'])`, then `orch(['handback', 'qa'], { input: say('qa', 'verify_pass') })` has status 0 and the qa entry's `model` is `'haiku'`.
  - D3 **"D3 a role=model token overrides default at dispatch"**: `driveTo('code', { prep: configured('default, code=haiku') })`; `lastLine(orch(['install', 'code', '--check']).out)` is `model: haiku`.
  - D4 **"D4 an uncovered role prints model: inherit, and the run records inherit"**: `driveTo('spec', { prep: configured('code=sonnet') })`; `lastLine(orch(['install', 'spec', '--check']).out)` is `model: inherit`; after `orch(['install', 'spec'])`, `runFile().dispatch_model` is `'inherit'`; after the spec hand-back, `runFile().handbacks[0].model` is `'inherit'`.
  - D5 **"D5 review --round names the define-review model and the OPEN line the author's model"**: `driveTo('spec', { prep: configured('default, spec=sonnet') })`; `orch(['install', 'spec'])`; `orch(['handback', 'spec'], { input: say('spec', 'boundary_routed') })`; `putDoc('spec', '# Demo spec\n')`; `orch(['review', 'spec', '--round', SPEC]).out` is `` `review spec round 1 of 3: ${SPEC} sha256 ${sha(SPEC)}; model opus` ``; `const r1 = writeReview('spec', 1, 'OPEN 1', [ROW])`; `orch(['review', 'spec', '--record']).out` is `` `review spec round 1: OPEN 1; revise ${SPEC} sha256 ${sha(SPEC)} from ${reviewPath('spec', 1)} sha256 ${r1}; model sonnet` ``.
  - D6 **"D6 without the line no install, handback or review output carries model text and no record holds a model"**: `driveTo('spec')`; `orch(['install', 'spec', '--check']).out` does not contain `model`; `orch(['install', 'spec'])`; the hand-back's `out` is `spec handed back boundary_routed`; `putDoc('spec', '# Demo spec\n')`; `orch(['review', 'spec', '--round', SPEC]).out` is `` `review spec round 1 of 3: ${SPEC} sha256 ${sha(SPEC)}` ``; `runFile()` has no `models` and no `dispatch_model`, and `runFile().handbacks[0]` has no `model`.
- [ ] [T-302] Red step: `npx vitest run tests/scripts/orchestrate.test.js -t "role models at dispatch"`. Predicted full match set, 6 tests: **red** D1-D5 (no `model:` line, no `dispatch_model`, no entry `model`, no `; model` segment), **green** D6. Every other test is filtered out. Depends on T-301.
- [ ] [T-303] `scripts/orchestrate.mjs`, `install` (lines 428-447). Depends on T-302.
  - Above `install` add:
    ```js
    // FEAT-053: what the script says this dispatch runs on, never the orchestrator's choice; null in a run without models.
    function dispatchModel(run, step) {
      if (!isPlainObject(run.models)) return null;
      return step.fix === undefined ? run.models[step.role] : fixDue(run).model ?? run.models.code;
    }
    ```
  - In `install`, replace `const out = built.out.trim() + (step.fix === undefined ? '' : `\n${fixNote(run)}`);` with `const model = dispatchModel(run, step);` and `const out = built.out.trim() + (step.fix === undefined ? '' : `\n${fixNote(run)}`) + (model ? `\nmodel: ${model}` : '');`.
  - Replace `saveRun(root, { ...run, band: ROLE_BAND[role], role });` with `saveRun(root, { ...run, band: ROLE_BAND[role], role, ...(model ? { dispatch_model: model } : {}) });`. The `if (check) return out;` line above it is unchanged, so `--check` writes nothing (owner decision 5).
- [ ] [T-304] `scripts/orchestrate.mjs`, `recordHandback` (lines 469-475): after `const fields = entryFields(run, role);` add `const model = isPlainObject(run.models) && isModel(run.dispatch_model) ? { model: run.dispatch_model } : {};` and change the entry to `{ role, gate, at: new Date().toISOString(), ...fields, ...(verdict ? { verdict } : {}), ...model, ...extra }`. Add to the comment line above the function: `// FEAT-053: an entry carries the model install recorded, read from the run file and never from the report.` Depends on T-303.
- [ ] [T-305] `scripts/orchestrate.mjs`, the review lines (plan decision 12). Depends on T-304.
  - Above `review` add `const modelSegment = (run, role) => (isPlainObject(run.models) ? `; model ${run.models[role]}` : '');` with the comment `// FEAT-053: the two lines that trigger a dispatch name its model; a closing line triggers none.`
  - In `review`, the dispatch expression: `openRound(root, role, loop, arg)` → `openRound(root, role, loop, arg, modelSegment(run, 'define-review'))`, and `recordRound(root, role, loop)` → `recordRound(root, role, loop, modelSegment(run, role))`.
  - `openRound(root, role, loop, rel)` → `openRound(root, role, loop, rel, model)`; its last return's `say` becomes `` `review ${role} round ${round} of ${REVIEW_CAP}: ${rel} sha256 ${sha256}${model}` ``. The `closed unchanged` return is unchanged.
  - `recordRound(root, role, loop)` → `recordRound(root, role, loop, model)`; the `OPEN` `say` becomes `` `review ${role} round ${loop.round}: OPEN ${verdict.open}; revise ${loop.doc} sha256 ${loop.sha256} from ${path} sha256 ${reviewSha}${model}` ``. The `closed clean` and `closed cap` returns are unchanged.
  - `grep -n "openRound(\|recordRound(" scripts/orchestrate.mjs` prints the two definitions and the two calls in `review`.
- [ ] [T-306] Green step: `npx vitest run tests/scripts/orchestrate.test.js -t "role models at dispatch"`. Predicted: the same 6 tests, all **green**. Then `npx vitest run tests/scripts/orchestrate.test.js`: 498 passed (492 + 6), including every FEAT-058 review test and the FEAT-059 security-entry key test unchanged. Depends on T-305.
- [ ] [T-307] Stage: `git add -u scripts/orchestrate.mjs`, `git add -u tests/scripts/orchestrate.test.js`, `git add -u docs/superpowers/plans/2026-11-14-feat053-per-role-model-selection-for-role-agents-with.md`. Depends on T-306.
- [ ] [T-308] Commit: `feat: print and record the model of every dispatch in a configured run [FEAT-053]`. Depends on T-307.

---

### Task 4: Escalate a fix round when an audit returns the same task twice (AC3, AC4)

**Files:**
- Modify: `tests/scripts/orchestrate.test.js`
- Modify: `scripts/orchestrate.mjs`

Failure point: escalation written at the round cap, or `fix.tasks` leaking into an unconfigured run. Verification: E5 at `--audit-rounds 1`; E6 two returns without the line.

- [ ] [T-401] `tests/scripts/orchestrate.test.js`: append `describe('escalation on repeated returns [FEAT-053]', …)` after the Task 3 describe, with these local helpers (the FEAT-057 ones are scoped to their own describe): Depends on T-308.
  ```js
  const returned = (...findings) => auditReport('VERDICT: RETURN', findings);
  const pass = (input) => { orch(['install', 'audit']); return orch(['handback', 'audit'], { input }); };
  const fixPass = () => { orch(['install', 'code']); return orch(['handback', 'code'], { input: say('code', 'build_executed') }); };
  const BLOCKER_A = '- [blocker] src/a.js:10 — breaks AC1';
  const MAJOR_B = '- [major] src/b.js:2 — misses an edge';
  const lastFix = () => runFile().handbacks.at(-1).fix;
  const ESCALATED = '; model opus (escalated: Task 1 returned twice)';
  ```
  Tests:
  - E1 `it.each([['default', 'sonnet'], ['code=sonnet', 'sonnet'], ['default, code=opus', 'opus']])` **"E1 with %j a second return of Task 1 dispatches its fix on opus and records why"**: `driveTo('audit', { prep: configured(value) })`; `const r1 = pass(returned(BLOCKER_A))`: status 0, `r1.out` ends with `` `; model ${first}` ``; `lastFix()` matches `{ round: 1, tasks: ['Task 1'], model: first }` and has no `escalated`; `lastLine(orch(['install', 'code', '--check']).out)` is `` `model: ${first}` ``; `fixPass()` status 0 and its entry's `model` is `first`; `const r2 = pass(returned(BLOCKER_A))`: status 0, `r2.out` ends with `ESCALATED`; `lastFix()` equals the full object `{ round: 2, files: ['src/a.js'], review: '.conductor/handback/audit-2.txt', sha256: <its sha>, tasks: ['Task 1'], model: 'opus', escalated: ['Task 1'] }` (sha checked with `expect.any(String)`); `lastLine(orch(['install', 'code', '--check']).out)` is `model: opus`; `fixPass()` status 0, the code entry's `model` is `'opus'` and `runFile().dispatch_model` is `'opus'`.
  - E2 **"E2 a second return naming only new tasks keeps the code model"**: `driveTo('audit', { prep: configured() })`; `pass(returned(BLOCKER_A))`, `fixPass()`; `const r = pass(returned(MAJOR_B))`: `r.out` ends with `; model sonnet`; `lastFix()` matches `{ round: 2, tasks: ['Task 2'], model: 'sonnet' }` with no `escalated`; `install code --check` last line `model: sonnet`.
  - E3 **"E3 a path listed by two tasks returns both, and a later return of either escalates only the shared one"**: `driveTo('audit', { prep: configured(), planText: `# Demo Plan\n\n${task(1, ['src/a.js'])}\n${task(2, ['src/a.js', 'src/b.js'])}\n## Test List\n` })`; `pass(returned(BLOCKER_A))`: `lastFix().tasks` equals `['Task 1', 'Task 2']`; `fixPass()`; `pass(returned(MAJOR_B))`: `lastFix()` matches `{ tasks: ['Task 2'], model: 'opus', escalated: ['Task 2'] }` and the line ends with `; model opus (escalated: Task 2 returned twice)`.
  - E4 **"E4 a hand-edited fix.model halts the next verb ORCH_RUN_INVALID"**: `driveTo('audit', { prep: configured() })`; `pass(returned(BLOCKER_A))`; rewrite the run file with the last entry's `fix.model = 'gpt'`; `orch(['install', 'code', '--check'])` has status 1 and `err` matching `/^ORCH_RUN_INVALID: /`.
  - E5 **"E5 at --audit-rounds 1 a second return of the same task halts ORCH_AUDIT_RETURN and records no fix"**: `driveTo('audit', { start: ['--audit-rounds', '1'], prep: configured() })`; `pass(returned(BLOCKER_A))` status 0 and `lastFix()` matches `{ tasks: ['Task 1'], model: 'sonnet' }`; `fixPass()`; `const r = pass(returned(BLOCKER_A))`: status 1, `err` starts with `ORCH_AUDIT_RETURN: `; `runFile().handbacks.at(-1)` matches `{ role: 'audit', verdict: 'RETURN', round: 2 }` and has no `fix` (so no `fix.model`, `fix.tasks` or `fix.escalated`); `runFile().halt.code` is `ORCH_AUDIT_RETURN` (owner decision 6).
  - E6 **"E6 without the line two returns of the same task record no model, tasks or escalated"**: `driveTo('audit')`; `const r1 = pass(returned(BLOCKER_A))`, `fixPass()`, `const r2 = pass(returned(BLOCKER_A))`: both status 0 and neither `out` contains `; model`; for each audit entry's `fix`, `Object.keys(fix).sort()` equals `['files', 'review', 'round', 'sha256']`; `install code --check` prints exactly two lines (envelope and fix note); `JSON.stringify(runFile())` contains neither `"model"`, `"models"` nor `"dispatch_model"`.
  - E7 **"E7 resume keeps the recorded models"**: `driveTo('code', { prep: () => { configured()(); fixtureGit('init', '-q'); fixtureCommit(); } })`; `const models = runFile().models`; `rmSync(join(root, '.claude', 'agents', 'code.md'))`; `orch(['install', 'code']).err` matches `/^ORCH_AGENT_MISSING: /`; `agents()`; `orch(['resume'])` has status 0; `runFile().models` equals `models` and `runFile().halt` is `null`; `lastLine(orch(['install', 'code', '--check']).out)` is `model: sonnet`.
- [ ] [T-402] Red step: `npx vitest run tests/scripts/orchestrate.test.js -t "escalation on repeated returns"`. Predicted full match set, 9 tests: **red** E1 (3 rows, no `; model` on the audit line, no `fix.tasks`), E2, E3, E5 (the first `fix` has no `tasks`); **green** E4 (Task 2's `isValidRun` already rejects it), E6 (nothing records a model yet) and E7 (`resume` already keeps `models`). Every other test is filtered out. Depends on T-401.
- [ ] [T-403] `scripts/orchestrate.mjs`, above `auditFix` (line 501) add `fixModel` (plan decisions 10 and 11): Depends on T-402.
  ```js
  // FEAT-053: a plan task the audit returns a second time goes to the most capable model, and the record names the trigger.
  function fixModel(root, run, paths) {
    if (!isPlainObject(run.models)) return { fields: {}, note: '' };
    const tasks = extractTasks(readDoc(root, run.plan, `cannot read ${run.plan}`).toString('utf8'))
      .filter((t) => t.files.some((f) => paths.includes(f))).map((t) => t.id);
    const earlier = new Set(run.handbacks.slice(0, -1).flatMap((h) => (h.role === 'audit' && Array.isArray(h.fix?.tasks) ? h.fix.tasks : [])));
    const escalated = tasks.filter((id) => earlier.has(id));
    if (escalated.length === 0) return { fields: { tasks, model: run.models.code }, note: `; model ${run.models.code}` };
    return {
      fields: { tasks, model: ESCALATION_MODEL, escalated },
      note: `; model ${ESCALATION_MODEL} (escalated: ${escalated.join(', ')} returned twice)`,
    };
  }
  ```
- [ ] [T-404] `scripts/orchestrate.mjs`, `auditFix` (lines 501-511). Depends on T-403.
  - After `const scope = fixScope(root, run, fix.files, fix.round);` add `const { fields, note } = fixModel(root, run, verdict.paths);`.
  - `saveRun(root, { ...run, handbacks: [...run.handbacks.slice(0, -1), { ...entry, fix }] });` → `saveRun(root, { ...run, handbacks: [...run.handbacks.slice(0, -1), { ...entry, fix: { ...fix, ...fields } }] });`.
  - The return line: append `${note}` after `; scope ${scope.join(', ')}`.
  - The cap check (`if (verdict.verdict === 'ESCALATE' || used >= cap) throw auditStop(…)`) stays first, so a return at the cap writes no `fix` and no escalation (E5).
- [ ] [T-405] Green step: `npx vitest run tests/scripts/orchestrate.test.js -t "escalation on repeated returns"`. Predicted: the same 9 tests, all **green**. Then `npx vitest run tests/scripts/orchestrate.test.js`: 507 passed (498 + 9), including the FEAT-057 tests `[E1]` (exact audit line and `fix` shape, unconfigured) and `[E2]` unchanged. Depends on T-404.
- [ ] [T-406] Stage: `git add -u scripts/orchestrate.mjs`, `git add -u tests/scripts/orchestrate.test.js`, `git add -u docs/superpowers/plans/2026-11-14-feat053-per-role-model-selection-for-role-agents-with.md`. Depends on T-405.
- [ ] [T-407] Commit: `feat: escalate a fix round to the most capable model when an audit returns the same task twice [FEAT-053]`. Depends on T-406.

---

### Task 5: The orchestrator passes the printed model; README walkthrough

**Files:**
- Modify: `tests/installer/commands-parity.test.js`
- Modify: `.claude/commands/cc-orchestrate.md`
- Modify: `project-template/.claude/commands/cc-orchestrate.md`
- Modify: `README.md`

Failure point: an edit that breaks a phrase another parity test pins, or a mirror left behind. Verification: the whole `commands-parity` file, whose first test is byte-identity.

- [ ] [T-501] `tests/installer/commands-parity.test.js`: inside `describe('cc-orchestrate mirrors [FEAT-011 AC10]', …)`, after the FEAT-055 test (ends line 297), add: Depends on T-407.
  ```js
  it('passes the model the script prints, never its own, and reports escalations [FEAT-053]', () => {
    const text = read(ORCH_MIRRORS[0]);
    for (const phrase of [
      '; role models: spec=<m>, plan=<m>, code=<m>, audit=<m>, security=<m>, qa=<m>, define-review=<m>',
      'On `ORCH_ROLE_MODELS_INVALID`, report it and stop.',
      'pass that alias as the `Agent` call\'s `model` parameter',
      'on `model: inherit`, or when `install` printed no `model:` line, pass no `model`',
      'never choose a model yourself',
      '; model opus (escalated: <tasks> returned twice)',
      'When the round line ends `; model <alias>`',
      'When the `OPEN` line ends `; model <alias>`',
      'each entry\'s `model`',
    ]) expect(text).toContain(phrase);
    const readme = read('README.md');
    for (const phrase of ['`- Role models: default`', '`default-model:`', 'a second time', 'inherits the session\'s model']) expect(readme).toContain(phrase);
  });
  ```
- [ ] [T-502] Red step: `npx vitest run tests/installer/commands-parity.test.js -t "FEAT-053"`. Predicted full match set, 1 test, **red**. Every other test is filtered out. Depends on T-501.
- [ ] [T-503] `.claude/commands/cc-orchestrate.md` and `project-template/.claude/commands/cc-orchestrate.md`, the same edits in both, with the Edit tool. No pinned phrase is altered: each edit appends a sentence or a bullet, or inserts a clause where no test pins the text. Depends on T-502.
  1. Step 1 (line 45): after the sentence that ends `disabled (--no-dependency-audit)>`.` append ` With a `- Role models:` line in the project `CLAUDE.md`, it then ends with `; role models: spec=<m>, plan=<m>, code=<m>, audit=<m>, security=<m>, qa=<m>, define-review=<m>`, each `<m>` one of `opus`, `sonnet`, `haiku` or `inherit`, followed by `; note: audit and code share <m>` when both name the same model (FEAT-053).`
  2. Step 1: after the bullet that starts `   - On `ORCH_DOC_LOCATION_INVALID`` (line 50) add the bullet `   - On `ORCH_ROLE_MODELS_INVALID`, report it and stop. No run file was written. The owner fixes or removes the `- Role models:` line in `CLAUDE.md` that the reason names (an unknown role, a model outside `opus`, `sonnet`, `haiku` and `inherit`, a role set twice, an empty token, `default` twice, more than one line, or a profile's `default-model:` outside that list) before a fresh `start`.`
  3. Step 1's header sentence (line 54): `the spec and plan folders (and group) from `docs:`,` → `the spec and plan folders (and group) from `docs:`, the role models and their note from `role models:` when the start line has them,`.
  4. Step 2.4 (line 60): after `Dispatch one agent at a time, never in parallel (D8).` append ` **Model (FEAT-053).** When `install` printed a last line `model: <alias>`, pass that alias as the `Agent` call's `model` parameter; on `model: inherit`, or when `install` printed no `model:` line, pass no `model`. Take the model from that line only: never choose a model yourself, and never retry a failed dispatch on another one.`
  5. Step 5 (line 75): after `take the brief's values from that line, never from your own reading of the report.` insert ` In a run with role models, `install code` then ends with `model: <alias>`, as every dispatch does; it reads `model: opus` when `handback audit` ended its line with `; model opus (escalated: <tasks> returned twice)`, because the audit returned one of those plan tasks a second time.`
  6. Step 6: after the bullet `   - each audit round's verdict, from the audit entries' `round` and `verdict`, and each fix round with its files, from their `fix`;` add the bullet `   - each entry's `model`, and each fix round whose `fix.escalated` names tasks, with those task ids (FEAT-053);`.
  7. The review loop, step 2 (line 92): after `Never revive an earlier reviewer, and never pass it an earlier round's findings. Wait for its completion notice.` append ` When the round line ends `; model <alias>`, pass that model to the reviewer's dispatch by the rule of step 2.4.`
  8. The review loop, step 4 (line 94): after `On `done`, go back to 1: the script decides whether the revision changed the document.` append ` When the `OPEN` line ends `; model <alias>`, pass that model to the author's dispatch by the rule of step 2.4.`
  Then `cmp .claude/commands/cc-orchestrate.md project-template/.claude/commands/cc-orchestrate.md` prints nothing.
- [ ] [T-504] `README.md`, the `/cc-orchestrate` walkthrough's "Useful variations" list: after the `--ticket 42` bullet (line 143), add the bullet: Depends on T-503.
  `- `- Role models: default` in the project `CLAUDE.md` puts each role on the model its profile ships as `default-model:` (`opus` for `spec`, `plan`, `audit`, `security` and the `define-review` reviewer, `sonnet` for `code`, `haiku` for `qa`), so the auditor reviews on another model than the author. `<role>=<opus|sonnet|haiku|inherit>` tokens override single roles (`- Role models: default, qa=sonnet`) or set only some. `start` freezes the map in the run file and every dispatch carries the model the script prints. When an audit returns a plan task a second time, that fix round runs on `opus`, and the audit entry records why. Without the line, every role inherits the session's model, as before.`
- [ ] [T-505] Green step: `npx vitest run tests/installer/commands-parity.test.js`. Predicted: 88 passed (87 + 1), including the mirror byte-identity test and the FEAT-047, FEAT-057, FEAT-058 phrase tests unchanged. Depends on T-504.
- [ ] [T-506] Stage: `git add -u tests/installer/commands-parity.test.js`, `git add -u .claude/commands/cc-orchestrate.md`, `git add -u project-template/.claude/commands/cc-orchestrate.md`, `git add -u README.md`, `git add -u docs/superpowers/plans/2026-11-14-feat053-per-role-model-selection-for-role-agents-with.md`. Depends on T-505.
- [ ] [T-507] Commit: `docs: the orchestrator passes the model the script prints [FEAT-053]`. Depends on T-506.

---

### Task 6: Full suite and closeout

**Files:**
- Modify: `docs/superpowers/plans/2026-11-14-feat053-per-role-model-selection-for-role-agents-with.md`

- [ ] [T-601] `npm test`. Predicted: 2870 tests, 2856 passed (the baseline's 2794, the 2 `gitignore-block-parity` tests green since Task 0, and 60 new: 15 role-profiles, 29 + 6 + 9 orchestrate, 1 commands-parity), 12 skipped, the same skipped set as the baseline; exit 0. A test that fails only because of the sandbox (network, tmp permissions, the two `staging-convention` git-exit tests) is reported as ENV with its name. Depends on T-507.
- [ ] [T-602] `git status --short` lists only this plan file (the ticks since T-507), and no temporary file is left in the tree. Depends on T-601.
- [ ] [T-603] Stage: `git add -u docs/superpowers/plans/2026-11-14-feat053-per-role-model-selection-for-role-agents-with.md`. Depends on T-602.
- [ ] [T-604] Commit: `docs: close out the per-role model selection plan [FEAT-053]`. Depends on T-603.

---

## Test List

- [ ] Unit (`tests/unit/role-profiles.test.js`): `default-model:` in all 14 profiles with the table's values and no `model:` key; the auditor's default differs from the author's; the six `PROFILE_SHA256_1_37_0` rows re-pinned (AC2).
- [ ] CLI (`tests/scripts/orchestrate.test.js`, "role models at start"): parse, override order, partial configuration, home profile without the key, the shared-model note, the eight malformed-line halts and the bad profile default with no run file written, a stale run left in place, `isValidRun` accepts and rejects, the exported constants, and the unconfigured start (AC1 start, AC4 start, Error cases).
- [ ] CLI ("role models at dispatch"): `model:` line on `--check` with the run file byte-identical, `dispatch_model` on install, the entry's `model` for every role (security and qa included), override and `inherit` at dispatch, the two review segments, and the unconfigured outputs (AC1, AC4).
- [ ] CLI ("escalation on repeated returns"): escalation under three configurations, new tasks only, a path two tasks share, a hand-edited `fix.model`, the round cap at `--audit-rounds 1`, two returns unconfigured, and `resume` keeping `models` (AC3, AC4).
- [ ] Parity (`tests/installer/commands-parity.test.js`): the command's model rule in both mirrors, its halt, its report line and the README bullet (AC1's documented rule).
- [ ] No E2E: no UI is affected.

## Commit Order

1. Task 0: the plan and its `.gitignore` leaf, committed with this plan (already ticked).
2. Task 1: the 14 profiles with the role-profiles test and its re-pinned hashes, in one commit (owner decision 4).
3. Task 2: the start parser, the constants and `isValidRun`, with their tests.
4. Task 3: the `install`, `handback` and `review` model output, with their tests.
5. Task 4: the escalation in `auditFix`, with its tests.
6. Task 5: `cc-orchestrate.md` in both mirrors, the README bullet and the parity test.
7. Task 6: the closeout tick commit.

Each commit leaves `npm test` green: Task 1 changes only profiles and their test, and Tasks 2-4 are additive behind the opt-in line.

## Identified Risks

- **A no-configuration output moves (AC4).** Every new print and record is gated on `isPlainObject(run.models)` or a non-null `models`; the whole existing `orchestrate.test.js` (463 tests, many with exact `toBe` lines) runs at every green step, plus D6 and E6.
- **`--check` writes.** `dispatch_model` is added only to the `saveRun` after `if (check) return out;`; D1 compares the run file's bytes around `--check`.
- **Hash rows.** Task 1 re-pins six rows from the edited bytes; T-104 predicts exactly those 12 rows red before T-105, so any other red row points at an unintended profile change.
- **Pinned command phrases.** The FEAT-047 test pins the start-line sentence and the FEAT-057 test the band-order sentence; T-503 only appends to them. T-505 runs the whole parity file.
- **The define-review profile is absent from the fixture `ROLES`.** Under `default` it would resolve to `inherit` silently; `configured()` writes it, and S1 asserts `define-review=opus`, so a missing write shows as a red S1.
- **Security seat in D2.** `driveTo('security')` copies the scripts and commits the fixture before `prep` writes `CLAUDE.md` and `define-review.md`, so those two files are untracked in the fixture repository. The seat's local scan reports credentials and guard-denied `package.json` scripts, neither of which those files hold; if the scan still counts them, D2 moves its `configured()` writes into a `prep` that commits again with `fixtureCommit()`.
- **Escalation reads the plan a second time.** `fixModel` re-reads the approved plan after `checkApprovedDocs` and `fixScope` have passed on the same bytes in the same call, so the task map cannot differ from the scope check's.
- **Slow suite.** `orchestrate.test.js` takes about 5 minutes; each red step uses a `-t` filter, and each green step runs the file once.

## Baseline, full suite

`npm test` on HEAD 1b60643 before Task 1, measured in this plan session's sandbox: 66 files, 2810 tests: 2794 passed, 12 skipped, 4 failed, exit 1. The 4 failures are not product failures:

- `tests/unit/gitignore-block-parity.test.js`, 2 tests (`equals the block computed from git ls-files, in order`, `names every tracked file at both sites and nothing else`): this plan's `.gitignore` leaf was in the tree while the plan file was not yet in the index. They pass once Task 0's commit lands, which is the toll the CLAUDE.md staging convention describes.
- `tests/unit/staging-convention.test.js`, 2 tests (`AC7`, `AC8`: `-u on an untracked path exits 128`): ENV. The sandbox's git exits 0 where these tests expect 128; they do not touch any file this plan edits.

T-601's prediction, against this baseline: 2870 tests, 2856 passed (2794 + 2 parity + 60 new), 12 skipped. In a sandbox like this one the two `staging-convention` tests still fail as ENV (exit 1, 2854 passed); on a developer machine and on CI, exit 0.
