# BUG-055: detect-stack Fails Whole, or Emits Garbage, on a Non-String package.json Field

**Status:** APPROVED 2026-10-07. **Target:** `1.39.2`, patch. **Branch:** `fix/bug-055-non-string-manifest-fields`. **Baseline:** `2374ab6`.

**Provenance.** This spec answers the dossier *detect-stack Fails Whole on a Non-String package.json Script* (`AGENT-READABLE BACKLOG.md`, opened 2026-10-02). The dossier's symptom at `scripts/detect-stack.mjs:598-601` was re-verified at `2374ab6`. This spec widens coverage to the whole class, by owner scope ruling of 2026-10-07. It does not amend the dossier, which stays cited as written.

## Problem

`scripts/detect-stack.mjs` reads six `package.json` string fields after at most a truthiness check: `name`, `description`, and `scripts.build`, `scripts.test`, `scripts.lint` and `scripts.format`. A value of any other JSON type (number, boolean, object or array) produces one of two wrong outcomes. Every exit is still 0. All rows below were measured at `2374ab6` with `node scripts/detect-stack.mjs <fixture-dir>`.

| Class | Input `package.json` | Observed |
|---|---|---|
| a. Crash, no detector match | `{"scripts":{"build":42,"test":"vitest"}}` | stdout `{}`; stderr `{"error":"s.build.trim is not a function","code":"UNKNOWN"}`. Same for an object `test`, an array `lint`, and `format: true`. |
| b. Pass-through, detector match | `{"name":"x","scripts":{"build":42,"test":"vitest"}}` | Full output carrying `"build": 42` |
| b. Pass-through, detector match | `{"name":"x","dependencies":{"next":"14"},"scripts":{"test":42}}` | Full output carrying `"test": 42` |
| b. Pass-through, falsy | `{"name":"x","dependencies":{"next":"14"},"scripts":{"test":0}}` | Full output carrying `"test": 0` |
| b. Pass-through, name | `{"name":42,"scripts":{"test":"vitest"}}` | Full output carrying `"name": 42` |
| c. Crash, description | `{"name":"x","description":42,"scripts":{"test":"vitest"}}` | stdout `{}`; stderr `{"error":"rootPkg.description.trim is not a function","code":"UNKNOWN"}` |

**Mechanism.**
- **Class a:** `:598-601` call `.trim()` behind a truthiness check only. The TypeError reaches `main().catch` at `:678-681`, which prints `{}` and exits 0, so every field is lost and not only the bad one.
- **Class b:** the detectors copy the raw value into their result: `detectAngular` `:245`, `detectNextjs` `:253`, `detectNestjs` `:259`, `detectReact` `:265`, `detectVue` `:271` and `detectTSNode` `:279`. Their `??` falls back only on `null` and `undefined`, and `:265`, `:271` and `:279` have no fallback at all. Three later steps then pass the value along:
  - the merge at `:585` accepts any defined value;
  - `!merged.<field>` at `:598-601` is then false, so the throwing `.trim()` is skipped;
  - the output filter at `:653-656` writes any non-string value unchanged.
  `name` goes the same way through `:614`.
- **Class c:** `:623` calls `.trim()` on a truthy `description`. The call runs whenever a root `package.json` exists, whatever detector matched.

**Paths disagree today.** In the no-detector path, a falsy non-string is skipped at `:598` (`"build": 0` measured: no `build` key). In a detector path, the same value survives `??` and is emitted (`"test": 0` measured).

**Who is exposed.** Consumers today:
- `/cc-stack` and `/cc-init` read `{}` as "no stack detected" (`global/commands/cc-stack.md:25-29`).
- `/cc-resume`'s auto-fill skips silently.
- In class b, a number or object reaches whatever consumes a command field as text.

`orchestrate.mjs start` is not exposed. `resolveTestCommand` (`scripts/orchestrate.mjs:210-221`) checks the test script itself before spawning detect-stack.

## Solution

There is one read rule for every `package.json`-sourced string field that detect-stack reads: **a value counts only when `typeof value === 'string'`. Any other value is treated as absent**, exactly as if the key were missing. A single helper applies the rule at every read site listed under System Impact, so that no two paths can disagree. A detector whose script is non-string therefore falls back to its own default, as it does for a missing script. For each ignored field, detect-stack writes one `WARN:` line to stderr through its existing `warn()` helper. Exit code, the JSON shape and the handling of every string value stay unchanged. The stale comment at `scripts/orchestrate.mjs:208` is reworded. That is a text-only change, and orchestrate's behavior does not change.

### Design answers

**Q1. The rule is "string", not "non-blank string".**
- **Anchor:** blank handling already belongs to the output filter at `scripts/detect-stack.mjs:654`, which drops any string whose `trim()` is empty.
- **Measured at `2374ab6`:** `{"name":"x","dependencies":{"next":"14"},"scripts":{"test":""}}` emits no `test` key. The blank survives `??` at `:253`, wins the merge at `:585`, and is dropped at `:654`. Next's `'jest'` default is not applied.
- **Why not "non-blank":** that rule would turn this case into `"test": "jest"`, which changes behavior for valid string input. That is outside a type bug.
- **Orchestrate's non-blank rule:** `scripts/orchestrate.mjs:197-204` is a halt decision about whether a run may proceed. It stays where it is, and the two rules agree on every non-string value.
- **Existing blank quirks stay as they are.** For example, `"name": "  "` currently yields no `name` key. Measured: it beats the `basename` fallback at `:614` and is dropped at `:654`.

**Q2. Falsy non-strings are covered.** `typeof 0`, `typeof false` and `typeof null` are not `'string'`, so `0`, `false` and `null` are absent on every path. The detector path then falls back to its default, and the `:598-601` path skips the field, so both paths now agree.

**Q3. A WARN line, not silence.** detect-stack's convention for an input it skips is one line through `warn()` (`scripts/detect-stack.mjs:32`, `WARN: <msg>`). Examples: `zero-byte manifest skipped` (`:47`), `manifest too large (>512KB), skipped` (`:48`), `symlink target outside project root — skipped` (`:84`). `/cc-stack` already treats stderr as non-fatal and shows it to the user (`global/commands/cc-stack.md:25`).
- **Format:** `WARN: non-string package.json field ignored - <field>: <path>`, where `<field>` is one of `name`, `description`, `scripts.build`, `scripts.test`, `scripts.lint` or `scripts.format`.
- **Count:** one line per offending field per `package.json` loaded. The root manifest is loaded at `:503` and workspace manifests at `:549`. A field read by several detectors still warns once.
- **What it is not:** the JSON `{"error":...}` line stays reserved for whole-run failures (`:486`, `:494`, `:664`, `:670`, `:679`). A WARN never changes stdout or the exit code.

## Behavior

### Main path
1. detect-stack loads each `package.json` (root and workspaces) through `readManifest`.
2. For each of the six fields holding a present, non-string value, it emits one WARN line.
3. Every read site (the six detectors, `:598-601`, `:614`, `:623`, and the `pkg.name` gate at `:278`) applies the read rule. A non-string value is `undefined` at that site.
4. A detector whose script is absent uses its existing default. Examples: Next `test` falls back to `'jest'` and Angular `build` to `'ng build'`. React, Vue and TSNode have no default for `build`, `lint` or `format`, so those keys are omitted.
5. detect-stack writes the full JSON object to stdout and exits 0.

### Alternative paths
- **All fields are strings:** output is byte-identical to `2374ab6` and no WARN is written.
- **A blank string:** handled exactly as at `2374ab6` (Q1). No WARN, because a blank string is still a string.
- **`scripts` itself is non-object** (`null`, `"x"`, `true`): handled as today, with no new WARN. Measured `"scripts": null` gives full output without command keys. The rule covers the four named keys only.
- **Non-string `name` without a TypeScript dependency:** `detectTSNode` now sees no name (`:278`) and returns `{}`. Commands then come from the `:598-601` path, and `name` falls back to `go.mod` or `basename` (`:615-620`). `stack` and `setup` are no longer emitted, because `detectTSNode` was their only source here. The output then matches a nameless manifest at `2374ab6`: `{"scripts":{"test":"vitest"}}` measured `name` (basename), `test`, `projectType` and `layeredArchitecture`, with no `stack` or `setup`.
- **A workspace manifest has a non-string script under Angular:** the `detectAngular` loop at `:240-245` applies the rule to each manifest it reads, and the WARN names that manifest's path.

### Error cases
- `readManifest` returning `null` (missing, zero-byte, oversize or unparseable file) is unchanged, and no field WARN is emitted.
- A failure unrelated to field types still goes through `main().catch` with `code: "UNKNOWN"`. This spec does not touch the `:663-683` handlers.

### Behavior change, stated explicitly
A non-string script under a detector match **no longer appears in the output as its raw value. The detector's default appears instead, or the key is omitted when the detector has no default.**
- `{"name":"x","dependencies":{"next":"14"},"scripts":{"test":42}}` emits `"test": "jest"` where it emitted `"test": 42`.
- `{"name":"x","scripts":{"build":42}}` emits no `build` key where it emitted `"build": 42`.
- Classes a and c now return full output instead of `{}`.
- `{"name":42,"scripts":{"test":"vitest"}}` no longer emits `"stack": "typescript"` or `"setup": "npm install"`, since `detectTSNode` no longer matches (`:278`). It emits what a nameless manifest emits.

## Acceptance Criteria
- [ ] AC1. Class a: `{"scripts":{"build":42,"test":"vitest"}}` returns a non-empty object with `"test": "vitest"` and no `build` key. The same holds for an object `test`, an array `lint` and a `true` `format`, each with its sibling fields intact.
- [ ] AC2. Class b: `{"name":"x","scripts":{"build":42,"test":"vitest"}}` emits no `build` key and keeps `"test": "vitest"`.
- [ ] AC3. Class b with a default: `{"name":"x","dependencies":{"next":"14"},"scripts":{"test":42}}` emits `"test": "jest"`.
- [ ] AC4. Falsy (Q2): `{"name":"x","dependencies":{"next":"14"},"scripts":{"test":0}}` emits `"test": "jest"`. `{"scripts":{"build":0}}` and `{"scripts":{"build":false}}` emit no `build` key.
- [ ] AC5. Class c: `{"name":"x","description":42,"scripts":{"test":"vitest"}}` returns full output with no `description` key and `"name": "x"`.
- [ ] AC6. Name: `{"name":42,"scripts":{"test":"vitest"}}` emits `name` equal to the fixture directory's basename, never `42`, and emits no `stack` or `setup` key (the nameless-manifest shape).
- [ ] AC7. Blank unchanged (Q1): `{"name":"x","dependencies":{"next":"14"},"scripts":{"test":""}}` emits no `test` key, as at `2374ab6`, and no WARN.
- [ ] AC8. WARN (Q3): AC1's first fixture writes exactly one stderr line matching `WARN: non-string package.json field ignored - scripts.build: <path>`. A fixture whose non-string field is read by two matching detectors (TypeScript dependency plus `next`) still writes exactly one line for that field. A fixture where every field is a string writes no such line. The assertion counts matching lines only: every fixture at `2374ab6` also writes `WARN: readdir error` lines for absent directories (`:39`), and those are unchanged.
- [ ] AC9. Every fixture in AC1-AC8 exits 0, and stdout parses as JSON.
- [ ] AC10. Each detector exported from `scripts/detect-stack.mjs` (`detectAngular`, `detectNextjs`, `detectNestjs`, `detectReact`, `detectVue` and `detectTSNode`), called directly with a manifest whose scripts are non-string, returns no non-string `build`, `test`, `lint` or `format`.
- [ ] AC11. `scripts/orchestrate.mjs` differs from `2374ab6` only in the comment text at `:207-209`. `git diff` shows no change to code lines, and `tests/scripts/orchestrate.test.js` passes unchanged.
- [ ] AC12. The full suite passes, with no previously passing test modified to pass.

## Out of Scope
- `scripts/orchestrate.mjs` behavior: `hasTestScript` keeps halting on a non-string or blank test script. Its rule sits next to this one but is not shared code.
- `package.json` fields detect-stack does not read today, and non-string handling for `workspaces` (`:520`), dependencies, or the `scripts` object itself.
- Blank-string behavior, including the existing `"name": "  "` quirk (Q1).
- Non-`package.json` manifests (`go.mod`, `pubspec.yaml`, `Cargo.toml` and others).
- The dossier text, which stays cited as written. The [BUG-055] heading was minted by the owner before this spec's approval; flipping it to [X] stays owner-side at release.
- Records (VERSION, CHANGELOG, backlog flip, README's open-dossier count at `README.md:127`). These are owner-side at release.

## System Impact
- `scripts/detect-stack.mjs`:
  - one new read-rule helper;
  - read sites at `:245`, `:253`, `:259`, `:265`, `:271`, `:278-279`, `:598-601`, `:614` and `:623`;
  - the field WARN, emitted once per manifest at the load point (`readManifest`, called at `:503` and `:549`).
  - This file is deployed to `.claude/scripts/detect-stack.mjs` in installed projects (`lib/installer/deploy.mjs:241` copies `scripts/` into `target`, which is `join(cwd, '.claude')` at `:202`), so the fix reaches users through the installer.
- `scripts/orchestrate.mjs:207-209`: comment text only.
- `tests/scripts/detect-stack.test.js`: detector unit cases (AC10). That file mocks `node:fs/promises`, so the end-to-end fixtures (AC1-AC9) need a spawn-based harness. The spawn tests in `tests/scripts/orchestrate.test.js` and `tests/scripts/init-wizard.test.js` are the pattern. The plan chooses the file.
- Consumers to re-check, with no change expected: `global/commands/cc-stack.md`, `.claude/commands/cc-init.md`, `.claude/commands/cc-resume.md` and their `project-template/` mirrors, plus `scripts/claude-md-fields.mjs` (`MERGE_FIELDS` keys are unchanged).
- Backlog: `[BUG-055]` heading minted 2026-10-07 before approval. The ceiling was run on both legs at `2374ab6`: `UNION ceiling {"BUG":54,"FEAT":41,"ARCH":10}`, next mintable `BUG-055`.

### Files Requiring Full Read (deferred to /cc-plan)
- `scripts/detect-stack.mjs` (683 lines): the merge loop `:582-587`, `readManifest` `:44-60`, and the six detectors. This spec cites lines seen during verification and probes. The plan reads each edit site in full before task breakdown.
- `tests/scripts/detect-stack.test.js`: existing detector-case structure, to place AC10.

## Complexity Estimate
**S.** It touches one shipped script at about a dozen read sites behind one helper, plus a comment edit and tests. There is no interface change, and every string-valued input behaves as before.
