# FEAT-021: Python-Free Removal of the Graph Rung

**Status:** APPROVED 2026-09-29 with refinements R1 (D1 ordering conditioned on `deployGlobal`'s measured settings treatment) and R2 (the hash pin is local-only, per the ceiling precedent); the multi-hook entry boundary was settled at approval
**Branch:** `feat/feat-021-python-free-removal`
**Backlog:** `[FEAT-021]`, RESOLVED IN DIRECTION at the Pillar 3 restructure (option (a)). This spec does not re-decide graph vs no graph. It turns the amendment's removal scope into acceptance criteria and an ordered surface.

## Problem

The graph rung of the lookup chain has never run. `graphify` was never installed on the developer machine, every cycle shipped on memory to grep, and `skills/memory-first/SKILL.md:37` documents the skip. Keeping the rung costs three things:

1. **The only Python in the package.** `global/hooks/graphify-ast-refresh.py` is deployed to every host, and the `.mjs` wrapper spawns it on every `UserPromptSubmit`. The package's defining constraints are zero dependencies and npm-native distribution.
2. **Instructions that point at a tool nobody has.** Both CLAUDE.md templates, `/cc-init`, the memory-first skill and both Guard 4 / Guard 1 deny messages tell the agent to query or build a graph. An agent that follows them either burns a turn on a missing command or skips a mandated step.
3. **Stale state on existing hosts.** Every install since the hook shipped carries a `graphify-ast-refresh` entry in `~/.claude/settings.json` and the hook files under `~/.claude/hooks/`. Deleting them from the package does not delete them from hosts: `deployGlobal` copies and never removes.

**Live specimen (this machine, measured 2026-09-29):** `~/.claude/settings.json:18` holds `python3 ~/.claude/hooks/graphify-ast-refresh.py`. That is the pre-wrapper generation, hand-edited from `python` to `python3` as the BUG-033 stopgap. Only the `.py` is deployed, and its SHA-256 `761199f1…9a800b` matches the shipped blob byte for byte.

## Solution

Remove every graph-rung surface from the repository, including all of its Python, and add a one-shot heal to the installer. The heal removes the stale settings entry on existing hosts first. It then deletes the two deployed hook files, but only when their content matches a version code-conductor actually shipped. A user-modified copy is left in place and named in the installer report. The lookup chain becomes memory, grep/glob, Explore sub-agent, targeted read.

## Decisions

### D1: Upgrade path is a HEAL with a content-match SWEEP, not leave-in-place

**Chosen:** a heal step, following the precedents in order: first the BUG-020 claude-mem purge (the installer removes what it put there), then the 1.24.0 stale-skill sweep (remove only on an exact content match, name what was kept).

**Why not leave-in-place.** The `.mjs` wrapper is harmless only because it spawns a Python payload that fails quietly. Leaving it means:
- Python stays deployed on every upgraded host, which defeats the item's own title.
- Node still spawns on every prompt for a tool that does not exist.
- The settings entry keeps pointing at a file whose owner has disowned it, so any later cleanup has to recognize it anyway.

The specimen above shows the entry also comes in a hand-edited pre-wrapper form. That form is exactly what a leave-in-place policy would carry forever.

**Why content-match is cheap and exact here.** Each file has exactly **one** shipped version:
- `.py`: one commit, `968dc6f`, SHA-256 `761199f1650b9a38273ce04b91fffdc8dcd5f73bd9adad957b7bbc1c3e9a800b`.
- `.mjs`: one commit, `5b4a1af`, SHA-256 `c78e4e5e6989731f8a8ef60e7039c0b17b8e5feaa8ac30ee595441c215282e36`.

The sweep therefore compares against two constants and needs no version table. The files are deleted from the package in the same change, so the constants are the only surviving record of the shipped content, and a test pins them to the blobs at those commits.

**Ordering: the settings entry goes first, the files second, and the files go only if the settings step succeeded.**

Whether this ordering is the load-bearing wall or defense in depth depends on a fact this spec has not measured. The BUG-033 plan records that `deployGlobal` force-copies the shipped `settings.json` over the host's before any merge runs, and the shipped `settings.json` since that release carries no `hooks` key.

- **If that still holds,** the standard upgrade clears the entry at deploy. The heal's settings half then reads `absent` on every normal upgrade and fires only on non-standard hosts: hand-edited entries like this machine's, partial installs, and settings restored from backup. The ordering is **defense in depth**.
- **If deploy does not clobber,** the stale entry survives into the heal. Deleting a file that the live entry still references would then turn a silent hook into a visible Claude Code hook error on every prompt, and the ordering is **load-bearing**.

`/cc-plan`'s full read of `deployGlobal` settles which of the two applies, and the plan records it. The heal is specified identically in both cases: it is the correct invariant guard in both and idempotent in both.

### D2: Guard 4 drops `graphify-out`, keeps `node_modules`

This follows the amendment's scope line "the `graphify-out/` guard references".

- **Residual risk:** a host that did once run graphify keeps a `graphify-out/graph.json` that becomes readable.
- **Mitigation:** Guard 1 (large-file `Read` with no `limit`) still covers it. A read with an explicit limit is a deliberate act and is not this guard's business.

### D3: `tests/verbosity-hook-test.sh` is deleted, not ported

It holds the repository's last `python3` invocation (`:235`–`:260`). No script, test runner or CI job invokes it. FEAT-024 ported its cases to `tests/hooks/verbosity-remind.test.js`, which `npm test` runs. It is a superseded artifact, not a surface with users.

## Behavior

### Main path (fresh install at the new version)

1. `deployGlobal` copies `global/`, which no longer contains `graphify-ast-refresh.*`.
2. `run()` merges the verbosity hook and no longer calls any graphify merge.
3. The heal step (below) finds no entry and no files and reports nothing.
4. The deployed CLAUDE.md managed blocks, `/cc-init`, memory-first and both hook deny messages contain no graph rung.

### Main path (upgrade of a host carrying the hook)

1. The heal reads `~/.claude/settings.json`. Within `UserPromptSubmit`, it removes every hook whose command contains the fingerprint `graphify-ast-refresh`, and drops an entry only when removing that hook leaves the entry empty. Other hooks in the same entry are code-conductor's to leave alone. This covers both the `python[3] …/.py` generation and the `node …/.mjs` generation. It writes a timestamped backup and uses the existing atomic write discipline. Every other entry is preserved in order.
2. Only if step 1 returned `removed` or `absent`: for each of `~/.claude/hooks/graphify-ast-refresh.py` and `.mjs` that exists, hash it.
   - **Matches its shipped constant:** delete it.
   - **Does not match:** leave it and emit one line naming the path, e.g. `code-conductor: kept ~/.claude/hooks/graphify-ast-refresh.py (modified since install); it is no longer used and can be deleted`.
3. The install exits with the same code it would have without the heal.

### Alternative paths

- **No `settings.json`:** status `absent`. The sweep still runs, since no entry can reference the files.
- **Settings present, no graphify entry:** status `absent`, and the sweep runs.
- **Entry removed, file already absent:** nothing to sweep and no line.
- **Second consecutive install:** status `absent`, files already gone, no output. The end state is identical (idempotent).
- **A graphify entry the user added by hand under `UserPromptSubmit`** carries the fingerprint and is removed. Accepted: the fingerprint is the filename code-conductor shipped, and the backup preserves the prior file.
- **`graphify-ast-refresh` entries under other events** are not touched. Code-conductor never wrote one there.

### Error cases (every path fails open)

- **Malformed `settings.json`:** reuse the existing `backupMalformed` path and return `malformed-skipped`. **The sweep does not run**, because the entry may still reference the files. One stderr line says so. Exit code unchanged.
- **Unlink fails** (`EACCES`, `EPERM`, `EBUSY`): one stderr line naming the path. Continue with the other file. Exit code unchanged.
- **Hashing fails** (read error): treat the file as modified, keep it, name it.
- **Any unexpected throw inside the heal** is caught at the heal boundary and reported as one line. It never converts a successful install into exit 2. This is the one deliberate exception to `run()`'s mid-copy failure policy: the heal is cleanup of our own leftovers, not deployment.

## Acceptance Criteria

### Removal (repository)

- [ ] `global/hooks/graphify-ast-refresh.py` and `global/hooks/graphify-ast-refresh.mjs` are deleted. `git ls-files '*.py'` returns nothing.
- [ ] `git grep -n python3` over tracked non-record files (excluding `docs/superpowers/`, `CHANGELOG.md`, `AGENT-READABLE BACKLOG.md`, `.claude/memory/`) returns only these out-of-scope lines: `tests/fixtures/guard3-corpus.js:320-321` (string data) and `scripts/detect-stack.mjs` host-project detection. A test pins the tracked-`.py` half. **Annotated 2026-09-29 (plan owner ruling 2):** measured, `scripts/detect-stack.mjs` carries no `python3` literal (it detects Python from manifests), so it is not a member, and the corpus hit is line 321 only. The shipped invariant (`tests/tools/repo-invariants.test.js`) pins the exact file set `tests/fixtures/guard3-corpus.js` and `tests/installer/heal.test.js`.
- [ ] `mergeGraphifyHook`, `graphifyHookCommand` and `GRAPHIFY_FINGERPRINT` are removed from `lib/installer/settings.mjs`, and the import and call site from `bin/code-conductor.mjs:7,98`.
- [ ] `tests/hooks/graphify-refresh.test.js` is deleted. The graphify cases in `tests/installer/settings.test.js` and `tests/installer/cli.test.js` are replaced by heal cases (below), not merely deleted.
- [ ] `tests/verbosity-hook-test.sh` is deleted (D3).
- [ ] Guard 4 in **both** `pre-tool-use.mjs` mirrors blocks `node_modules` only. Its deny message no longer names graphify. The Guard 1 deny message's lookup list no longer names a graph step. The `tests/hooks/guard4.test.js` and `pre-tool-use-contract.test.js` cases flip: `graphify-out/x` is allowed, and `node_modules/x` still denies.
- [ ] Orchestrator Protocol in `global/CLAUDE.md`: the Graph rung is removed and the rungs are renumbered 1–5 contiguously.
- [ ] `project-template/CLAUDE.md` **and** the repo's own `CLAUDE.md`, in the same commit:
  - Session Initialization checks `project.md` only.
  - "Do not accept implementation tasks without valid project memory" drops "and graph".
  - The `graphify-out/` NEVER-read bullet names `node_modules/` only.
  - `### Graph-First` becomes `### Search-First`, with grep for callers and dependents as step 1 and the existing Explore fallback and ranged-open rules kept.
  - The "Graph querying" delegation row is removed.
- [ ] `skills/memory-first/SKILL.md`: the Graphify step is removed and the steps are renumbered.
- [ ] `/cc-init` in **both** mirrors (`.claude/commands/` and `project-template/.claude/commands/`): the `/graphify .` step is removed. `commands-parity.test.js` stays green.
- [ ] README: remove the `graphify-ast-refresh` hook section, the Graphify rung in the lookup chain, the file-tree rows, and `graphify-out` from the Guard 4 description and the clone-location note.
- [ ] The root `.gitignore:2` `graphify-out/` line is removed. The historical BUG-017 doc leaf lines stay.

### Heal (installer)

- [ ] A new heal step runs after the global deploy and before `writeVersionFile`. It removes fingerprinted `UserPromptSubmit` entries and returns `removed | absent | malformed-skipped`.
- [ ] Both shipped SHA-256 constants live in one exported location. A test recomputes them from `git show 968dc6f:global/hooks/graphify-ast-refresh.py` and `git show 5b4a1af:global/hooks/graphify-ast-refresh.mjs` and asserts equality.

**This pin is a local instrument, not a merge gate**, following the id ceiling's `origin/main` leg precedent. Two environments lack the history:
- the npm tarball;
- CI, because `actions/checkout@v4` at its default depth does not fetch either commit, and `fetch-depth: 0` was declined for the ceiling.

In both, the test skips. The skip reason is written in the test itself, naming the shallow-clone condition and the ceiling ruling, so a green CI run is never read as having verified the hashes. Fetching the commits inside the test was considered and rejected: it adds a network dependency to the suite to guard constants that change only if history is rewritten.
- [ ] Test matrix, each against a temp `HOME`:
  - pre-wrapper `python3 …py` entry plus a matching `.py`: entry removed, file deleted;
  - wrapper `node …mjs` entry plus both matching files: both deleted;
  - modified `.py`: kept and named on stderr;
  - malformed settings: backup written, both files kept, exit 0;
  - no settings file: sweep runs;
  - unrelated `UserPromptSubmit` entries (including the verbosity hook), and non-graphify hooks sharing an entry with a graphify hook, are preserved byte-equal in order;
  - second run: no output, identical tree;
  - unlink failure (read-only hooks dir): named line, exit 0.
- [ ] `dependencies` in `package.json` stays `{}`.

### Release

- [ ] The version bumps to `1.34.0` per `docs/RELEASE-CLOSEOUT.md`. `node tools/version-gate.mjs` reports `VERSION_GATE_OK 1.34.0` and `node tools/record-parity.mjs` reports `RECORD_PARITY_OK` with `[FEAT-021]` at `[X]`. `npm test` is green, with the new total predicted in the plan and measured at each boundary.
- [ ] CHANGELOG names the heal, including that a modified hook file is kept and named, so an upgrading user reading the notes is not surprised by the removed settings entry.

## Out of Scope

- **Option (b) in its entirety:** any zero-dependency Node indexer, its schema, query surface and freshness lifecycle. It gets its own id only when a measured session shows memory-to-grep failing a structural question.
- Anything in `[FEAT-019]`'s superseded territory (graph consumption shields).
- Any TypeScript compiler API path.
- **Python support for host projects:** `scripts/detect-stack.mjs` Python detection, `/cc-docs` Python docstring guidance, and the `/cc-spec` manifest exemption list (`pyproject.toml`, `requirements.txt`, `Pipfile`). Those describe user projects, not code-conductor's runtime.
- The Guard 3 corpus row carrying `python3` as command text (`tests/fixtures/guard3-corpus.js:320`). It is scanner input data.
- Historical records (`docs/superpowers/**`, `CHANGELOG.md` past entries, `.claude/memory/project.md` history, the BUG-017 doc leaves in `.gitignore`). These are records, not surfaces.
- The developer's own `~/.claude/CLAUDE.md` outside managed sentinels. The heal touches `settings.json` and `hooks/` only.
- Removing `graphify-ast-refresh` entries from any event other than `UserPromptSubmit`.

## System Impact

| Surface | Change |
|---|---|
| `global/hooks/graphify-ast-refresh.{py,mjs}` | delete |
| `lib/installer/settings.mjs` | remove graphify merge; add fingerprint unmerge (reuses the `mergeHook` read, validate, backup and atomic-write path) |
| `lib/installer/` (heal home: `settings.mjs` or a new `heal.mjs`, decided in the plan after a full read) | shipped-hash constants, sweep |
| `bin/code-conductor.mjs:7,98` | swap the graphify merge for the heal call; heal throws never escalate the exit code |
| `.claude/hooks/pre-tool-use.mjs`, `project-template/.claude/hooks/pre-tool-use.mjs` | Guard 4 set and message, Guard 1 message |
| `global/CLAUDE.md`, `project-template/CLAUDE.md`, `CLAUDE.md` | rung, Session Initialization, Search-First, delegation row |
| `skills/memory-first/SKILL.md` | rung removal |
| `.claude/commands/cc-init.md`, `project-template/.claude/commands/cc-init.md` | step removal |
| `README.md` | hook section, chain, tree, Guard 4, clone note |
| `.gitignore` | line 2 |
| `tests/hooks/graphify-refresh.test.js`, `tests/verbosity-hook-test.sh` | delete |
| `tests/installer/settings.test.js`, `tests/installer/cli.test.js`, `tests/hooks/guard4.test.js`, `tests/hooks/pre-tool-use-contract.test.js` | rewrite affected cases |
| `VERSION`, `package.json`, `package-lock.json`, `CHANGELOG.md`, backlog heading | release surface |

**Pre-flight (critical-review Phase 1)**

- **Happy path:** an upgrade finds the fingerprinted entry, removes it with a backup, deletes both byte-identical hook files, and the install exits 0 with no heal output beyond what it removed.
- **Failure points:**
  - deleting a file while the entry survives, which produces a visible per-prompt hook error; prevented by the D1 ordering;
  - a heal throw escalating a good install to exit 2; caught at the boundary;
  - Windows path separators in the fingerprint match; the fingerprint is a basename substring, so it is separator-agnostic;
  - hashing CRLF-converted copies on Windows checkouts: a converted file would not match and would be kept and named. That fails safe, and the plan measures whether the npm tarball ever ships CRLF.
- **Boundary conditions:**
  - an empty `hooks` object or empty `UserPromptSubmit` array (no-op);
  - an entry carrying several hooks where only one is graphify: **settled at approval**, remove only the matching hook and drop the entry only when it empties. Removing the whole entry would delete hooks code-conductor never wrote, which contradicts the heal's charter. The byte-equal preservation case in the matrix pins it with a mixed entry;
  - a symlinked `settings.json` (existing `resolveRealTarget` handling);
  - a concurrent Claude Code session reading settings mid-write (existing atomic write).

### Files Requiring Full Read (deferred to /cc-plan)

- `lib/installer/settings.mjs` (`mergeHook` at `:69`–`:104`, to build the unmerge on the same read, validate and write path)
- `bin/code-conductor.mjs` (`run()` error policy at `:85`–`:120`, to place the heal boundary)
- `lib/installer/deploy.mjs`:
  - `sweepStaleFlatSkills` `:66` and `sweepStaleRootScripts` `:123`, the content-match precedents to mirror;
  - `deployGlobal` `:95`–`:115`, its treatment of `settings.json` (force-copy vs `GLOBAL_HOST_OWNED` filter vs merge), which settles whether D1's ordering is load-bearing or defense in depth.
- `.claude/hooks/pre-tool-use.mjs` (Guard 4 `:56`–`:68`, Guard 1 message `:84`)
- `tests/installer/settings.test.js`, `tests/installer/cli.test.js`, `tests/hooks/guard4.test.js`, `tests/hooks/pre-tool-use-contract.test.js` (the cases to flip)

## Complexity Estimate

**M.** Most of the change is deletion and text. The one piece of new logic is the heal, which is small, but its ordering and fail-open contract carry real risk and need the full test matrix.
