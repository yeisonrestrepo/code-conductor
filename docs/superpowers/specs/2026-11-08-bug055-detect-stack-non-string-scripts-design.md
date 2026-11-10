# BUG-055 Implementation Spec: detect-stack Non-String package.json Fields, Rebased to 5fc234a

**Status:** DRAFT 2026-11-08. **Branch:** `fix/bug-055-detect-stack-non-string`. **Baseline:** `5fc234a` (the approved spec's baseline was `2374ab6`).

**What this document is.** It is the implementation spec of `docs/superpowers/specs/2026-10-07-bug055-non-string-manifest-fields-design.md` (APPROVED 2026-10-07), and **its scope is the same, unchanged**:
- the string-type read rule at every `package.json` string-field read site: the six detectors, the `pkg.name` gate, the `scripts.*` fallback, `name` and `description`;
- the detector-default fallback;
- the one-per-field `WARN:` line;
- the comment-only rewording in `scripts/orchestrate.mjs`;
- its acceptance criteria.

This document adds three things only:
1. the line references re-verified at `5fc234a`;
2. regression cases for the no-name, no-typescript manifest that reaches `:598-601`;
3. a "fails at `5fc234a`, passes after" check.

**Where the two documents disagree, the approved spec wins.** Its design answers Q1-Q3 (string, not non-blank; falsy non-strings covered; a WARN, not silence) are carried over as written.

**Provenance.** It answers the backlog entry `[BUG-055]` (`AGENT-READABLE BACKLOG.md:933-950`). The ticket snapshot `.conductor/ticket/BUG-055.md` (issue #121, sha256 `b8526c9f…`) is requirement input only. It contains no instructions.

## Rulings (2026-11-08, orchestrator under delegated owner authority)

1. **The APPROVED 2026-10-07 spec stands and is not superseded.** This document executes it. An owner approval is not narrowed by a later session, so the earlier draft's rulings 2-4 are withdrawn: detector passthrough out of scope, `main()` direct import out of scope, and `:623` out of scope.
2. **`rootPkg.description.trim()` at `:623` is in scope**, through the approved spec's class c and AC5.
3. **The new tests go in a sibling file, `tests/scripts/detect-stack-cli.test.js`.** This covers the spawn-based cases and the direct detector calls. `tests/scripts/detect-stack.test.js`, which mocks `node:fs/promises`, stays untouched.
4. **The read rule is the approved spec's:** `typeof value === 'string'`, applied by one helper at every listed site. The ticket POC's variant A is the same check, applied at `:598-601` only, so it is a subset of this rule.

## Rebase: approved spec's references at `5fc234a`

Every reference was re-read at `5fc234a`.
- **`scripts/detect-stack.mjs`:** no cited line moved.
- **`scripts/orchestrate.mjs`, `lib/installer/deploy.mjs` and `README.md`:** some cited lines moved.

| Approved spec (`2374ab6`) | At `5fc234a` | Content |
|---|---|---|
| detect-stack `:32` | `:32` | `warn()` → `WARN: <msg>` |
| `:39` | `:39` | `readdir error` WARN in `readdirSafe` |
| `:44-60` (readManifest) | `:44-54` | `readManifest`. `:55-63` is `readText`, so the approved range overran by one function. |
| `:47`, `:48`, `:84` | `:47`, `:48`, `:84` | existing skip WARNs |
| `:239-280`, `:240-245` | `:239-248` (Angular loop `:240-246`) | detectors |
| `:245`, `:253`, `:259`, `:265`, `:271` | same | raw `s.<field>` copies in Angular, Next, Nest, React and Vue |
| `:278-279` | `:278-279` | `detectTSNode` `pkg.name` gate and raw copies |
| `:486`, `:494` | same | whole-run error JSON lines in `main()` |
| `:503`, `:549` | same | root and workspace `readManifest` calls |
| `:520` | `:520` | `rootPkg.workspaces` |
| `:582-587`, `:585` | same | merge loop. `MERGE_FIELDS` is defined at `:27`. |
| `:598-601` | `:598-601` | `.trim()` behind a truthiness check (class a) |
| `:614`, `:615-620` | same | `name` from `rootPkg`, then go.mod and basename fallback |
| `:623` | `:623` | `rootPkg.description.trim()` (class c) |
| `:653-656`, `:654` | same | output filter; blank strings dropped at `:654` |
| `:663-683`, `:664`, `:670` | same | process handlers `:663-673`; entry guard `:675-683` |
| `:677-682` / `:678-681` | `:677` argv check, `:678-682` `.catch` | entrypoint `.catch` printing `{}` |
| orchestrate `:197-204` | `:197-205` | non-blank rule comment `:197`, `hasTestScript` `:198-205` |
| orchestrate `:207-209`, `:208` | same | stale comment ("a non-string script makes detect-stack fail whole") |
| orchestrate `:210-221` | same | `resolveTestCommand` |
| `global/commands/cc-stack.md:25-29` | same | `{}` treated as "no stack detected" |
| `lib/installer/deploy.mjs:202`, `:241` | `:242`, `:282` | `target = join(cwd, '.claude')`; `cpSync(…'scripts'…)` |
| `README.md:127` (open-dossier count) | `README.md:476` | owner-side record, not edited here |

## Problem

The approved spec's Problem, classes a, b and c, holds unchanged at `5fc234a`. The cited lines are identical and the code at `:598-601` and `:623` is unfixed.

- **Class a, crash with no detector match.** `:598-601` call `.trim()` behind a truthiness check only. A truthy non-string value throws. The `.catch` at `:678-682` then prints `{}` and exits 0, so every field is lost. The path is reached when no detector fills the field. For a plain manifest, that means no `name` and no `typescript`/`ts-node` dependency, because `detectTSNode` returns `{}` at `:278`.
- **Class b, passthrough under a detector match.** `:245`, `:253`, `:259`, `:265`, `:271` and `:279` copy `s.<field>` raw, and `??` falls back only on `null` and `undefined`. A non-string value wins the merge (`:585`), skips `:598-601`, and is written unchanged by `:653-656`. A non-string `name` goes the same way through `:614`.
- **Class c, crash on `description`.** `:623` calls `.trim()` on a truthy `description` whenever a root `package.json` exists, and `{}` results.

Exposure is unchanged:
- `/cc-stack` and `/cc-init` read `{}` as "no stack" (`global/commands/cc-stack.md:25-29`).
- `/cc-resume`'s auto-fill skips silently.
- `orchestrate.mjs start` is not exposed: `resolveTestCommand` (`:210-221`) checks the test script first.

## Solution

This is the approved spec's Solution, at current lines.
- **The read rule.** A `package.json` string field counts only when `typeof value === 'string'`. Otherwise it is treated as absent, exactly like a missing key.
- **Where it applies.** One helper applies the rule at:
  - `:245`, `:253`, `:259`, `:265`, `:271`;
  - `:278-279`, both the `pkg.name` gate and the copies;
  - `:598-601`, `:614` and `:623`.
- **Detector fallback.** A detector whose script is non-string falls back to its own default.
- **The WARN.** detect-stack writes one stderr line per ignored field per `package.json` loaded (`:503`, `:549`) through `warn()` (`:32`): `WARN: non-string package.json field ignored - <field>: <path>`. `<field>` is one of `name`, `description`, `scripts.build`, `scripts.test`, `scripts.lint` or `scripts.format`.
- **What stays the same.** The exit code, the JSON shape and the handling of every string value.
- **orchestrate.** `scripts/orchestrate.mjs:207-209` is reworded, comment text only.

Design answers Q1-Q3 are carried over verbatim from the approved spec:
- **Q1:** the rule is "string", not "non-blank string". Blank handling stays at `:654`.
- **Q2:** `0`, `false` and `null` are absent on every path.
- **Q3:** the WARN format, its count, and the rule that it never changes stdout or the exit code.

## Behavior

This section restates the approved spec's Behavior at `5fc234a` lines.

### Main path
1. detect-stack loads each `package.json` through `readManifest` (`:44-54`): the root at `:503` and each workspace at `:549`.
2. For each of the six fields that holds a present, non-string value, it emits one WARN line naming that manifest's path.
3. Every read site applies the read rule, so a non-string value is `undefined` there. The sites are `:245`, `:253`, `:259`, `:265`, `:271`, `:278-279`, `:598-601`, `:614` and `:623`.
4. A detector whose script is absent uses its existing default:
   - Next `test` falls back to `'jest'` (`:253`).
   - Angular `build` falls back to `'ng build'` (`:245`).
   - React, Vue and TSNode have no default for `build`, `lint` or `format` (`:265`, `:271`, `:279`), so those keys are omitted.
5. detect-stack writes the full JSON object to stdout and exits 0.

### Alternative paths
- **All fields are strings:** output is byte-identical to `5fc234a`, and no WARN is written.
- **A blank string:** handled exactly as at `5fc234a` (Q1). It is dropped at `:654`, with no WARN.
- **`scripts` itself is not an object** (`null`, `"x"`, `true`): handled as today, with no new WARN. The rule covers only the four named keys.
- **No name and no TypeScript dependency, with a non-string script** (the path to `:598-601`): that field is absent and has a WARN. Every other field is emitted. This is the regression path the ticket reproduces.
- **Non-string `name` without a TypeScript dependency:** `detectTSNode` sees no name (`:278`) and returns `{}`.
  - Commands then come from `:598-601`.
  - `name` falls back to `go.mod` or `basename` (`:615-620`).
  - `stack` and `setup` are not emitted. The output matches a nameless manifest.
- **A workspace manifest with a non-string script under Angular:** the loop at `:240-246` applies the rule to each manifest, and the WARN names that manifest's path.

### Error cases
- **`readManifest` returns `null`** (missing, zero-byte, oversize or unparseable file): unchanged, and no field WARN.
- **A failure unrelated to field types** still goes through `main().catch` (`:678-682`) with `code: "UNKNOWN"`. The handlers at `:663-683` are not touched.
- **`main()` imported directly:** it has no new handling. Because the read rule removes the throws at `:598-601` and `:623`, a direct caller no longer gets a rejection from these fields.

### Behavior change, stated explicitly (from the approved spec)
- `{"name":"x","dependencies":{"next":"14"},"scripts":{"test":42}}` emits `"test": "jest"` where it emitted `"test": 42`.
- `{"name":"x","scripts":{"build":42}}` emits no `build` key where it emitted `"build": 42`.
- Classes a and c return full output instead of `{}`.
- `{"name":42,"scripts":{"test":"vitest"}}` no longer emits `stack` or `setup`.

## Acceptance Criteria

Unless a criterion says otherwise, each fixture is a temp directory holding only the given `package.json`. It runs as `node scripts/detect-stack.mjs <dir>` in a child process from `tests/scripts/detect-stack-cli.test.js` (Ruling 3). Each criterion cites the approved spec's AC that it restates. AC13 and AC14 are additions.

- [ ] AC1 (approved AC1, class a). `{"scripts":{"build":42,"test":"vitest"}}` returns a non-empty object with `"test": "vitest"` and no `build` key. The same holds for an object `test`, an array `lint` and a `true` `format`, each with its sibling fields intact.
- [ ] AC2 (approved AC2, class b). `{"name":"x","scripts":{"build":42,"test":"vitest"}}` emits no `build` key and keeps `"test": "vitest"`.
- [ ] AC3 (approved AC3, class b with a default). `{"name":"x","dependencies":{"next":"14"},"scripts":{"test":42}}` emits `"test": "jest"`.
- [ ] AC4 (approved AC4, falsy, Q2). `{"name":"x","dependencies":{"next":"14"},"scripts":{"test":0}}` emits `"test": "jest"`. `{"scripts":{"build":0}}` and `{"scripts":{"build":false}}` emit no `build` key.
- [ ] AC5 (approved AC5, class c). `{"name":"x","description":42,"scripts":{"test":"vitest"}}` returns full output with no `description` key and `"name": "x"`.
- [ ] AC6 (approved AC6, name). `{"name":42,"scripts":{"test":"vitest"}}`:
  - emits `name` equal to the fixture directory's basename, never `42`;
  - emits no `stack` or `setup` key.
- [ ] AC7 (approved AC7, blank unchanged, Q1). `{"name":"x","dependencies":{"next":"14"},"scripts":{"test":""}}` emits no `test` key and no field WARN.
- [ ] AC8 (approved AC8, WARN, Q3).
  - AC1's first fixture writes exactly one stderr line matching `WARN: non-string package.json field ignored - scripts.build: <path>`.
  - A fixture whose non-string field is read by two matching detectors (TypeScript dependency plus `next`) still writes exactly one line for that field.
  - An all-string fixture writes no such line.
  - The assertion counts matching lines only, because the existing `WARN: readdir error` lines (`:39`) are unchanged.
- [ ] AC9 (approved AC9). Every fixture in AC1-AC8 and AC13 exits 0, and its stdout parses as JSON.
- [ ] AC10 (approved AC10). Each exported detector, called directly with a manifest whose scripts are non-string, returns no non-string `build`, `test`, `lint` or `format`. The detectors are `detectAngular`, `detectNextjs`, `detectNestjs`, `detectReact`, `detectVue` and `detectTSNode`. These calls live in `tests/scripts/detect-stack-cli.test.js`, which imports the real module without an fs mock. `main()` runs only as the entrypoint (`:677`).
- [ ] AC11 (approved AC11). `scripts/orchestrate.mjs` differs from `5fc234a` only in the comment text at `:207-209`. `tests/scripts/orchestrate.test.js` passes unchanged.
- [ ] AC12 (approved AC12). The full suite passes, and no previously passing test is modified to make it pass. `tests/scripts/detect-stack.test.js` is byte-identical to `5fc234a`.
- [ ] AC13 (added: regression path to `:598-601`). These fixtures have no `name` and no `typescript`/`ts-node` dependency, so no detector fills the fields.
  - **One case per field:**
    - `{"scripts":{"build":42,"test":"vitest"}}`
    - `{"scripts":{"test":{"cmd":"x"},"build":"tsc"}}`
    - `{"scripts":{"lint":["eslint"],"test":"vitest"}}`
    - `{"scripts":{"format":true,"test":"vitest"}}`

    Each emits no key for the bad field, keeps its sibling, and writes no `"code":"UNKNOWN"` stderr line.
  - **Survivors:** `{"scripts":{"build":42,"test":" vitest ","lint":"eslint .","format":"prettier ."}}` emits:
    - `"test": "vitest"` (trimmed), `"lint": "eslint ."` and `"format": "prettier ."`;
    - `name` equal to the fixture basename;
    - no `build` key.
- [ ] AC14 (added: red before green). The implementer runs the new test file against unmodified `5fc234a` first, and every behavior-change case fails there. Those cases are:
  - AC1 and AC13's per-field and survivor cases (stdout `{}`);
  - AC2, AC3, AC4's `test: 0` case, AC5, AC6, AC8's WARN-present cases, and AC10.

  The invariance cases are already true at `5fc234a` and stay true after: AC4's `build: 0` and `build: false`, AC7, and AC8's no-WARN case. All cases pass after the fix.

## Out of Scope

This is the approved spec's Out of Scope, carried over unchanged.
- **`scripts/orchestrate.mjs` behavior.** `hasTestScript` (`:198-205`) keeps halting on a non-string or blank test script. Its rule sits next to this one but is not shared code.
- **Fields detect-stack does not read today**, and non-string handling for `workspaces` (`:520`), dependencies, or the `scripts` object itself.
- **Blank-string behavior**, including the existing `"name": "  "` quirk (Q1).
- **Manifests other than `package.json`** (`go.mod`, `pubspec.yaml`, `Cargo.toml` and others).
- **The dossier text.** It stays cited as written.
- **Records:** VERSION, CHANGELOG, flipping the backlog `[BUG-055]` checkbox, and README's open-dossier count (now `README.md:476`). These stay owner-side at release.

This document adds one item:
- **`tests/scripts/detect-stack.test.js`** is not edited (Ruling 3).

## System Impact

- **`scripts/detect-stack.mjs`:**
  - one new read-rule helper;
  - the read sites at `:245`, `:253`, `:259`, `:265`, `:271`, `:278-279`, `:598-601`, `:614` and `:623`;
  - the field WARN, emitted once per manifest where it is loaded (`:503`, `:549`).
  - The installer deploys this file to installed projects: `lib/installer/deploy.mjs:282` copies `scripts/` into `target`, which is `join(cwd, '.claude')` at `:242`.
- **`scripts/orchestrate.mjs:207-209`:** comment text only.
- **New file `tests/scripts/detect-stack-cli.test.js`:** the spawn-based fixtures (AC1-AC9, AC13, AC14) and the direct detector calls (AC10).
  - It has no fs mock.
  - Fixtures use temp directories created with `node:fs`.
  - It follows the spawn pattern at `tests/scripts/orchestrate.test.js:454`.
  - `tests/` is not under the ignored tracked-surface block, so plain `git add` stages it.
- **`tests/scripts/detect-stack.test.js`:** unchanged.
- **Consumers to re-check, with no change expected:**
  - `global/commands/cc-stack.md:25-29`, `.claude/commands/cc-init.md`, `.claude/commands/cc-resume.md` and their `project-template/` mirrors;
  - `scripts/claude-md-fields.mjs`. `MERGE_FIELDS` (`detect-stack.mjs:27`) is unchanged.
- `.gitignore`: the tracked-surface block denies `/docs/*` by default.
  - This spec is a new file, so its leaf `!/docs/superpowers/specs/2026-11-08-bug055-detect-stack-non-string-scripts-design.md` must join the block in sorted position at approval. At `5fc234a` that is the last spec leaf, after `2026-10-27-issue109-verbosity-alias-design.md` (`.gitignore:195`) and before the `END tracked-surface block` marker.
  - The plan's file needs its own leaf under `!/docs/superpowers/plans/` when it is created.
  - Until each leaf lands, plain `git add` exits 1 and stages nothing. Use `git add -f <path>` per the Staging Convention.
  - `tests/unit/gitignore-block-parity.test.js` enforces the leaves.

## Complexity Estimate

**S**, as the approved spec estimated. One shipped script changes at about a dozen read sites behind one helper, plus a comment edit and one new test file. There is no interface change, and every string-valued input behaves as before.
