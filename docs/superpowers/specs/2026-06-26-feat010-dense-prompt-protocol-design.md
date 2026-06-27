# FEAT-010 Dense Prompt Protocol Standard — Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Define and implement SNAP v1 — a minified JSON schema for all agent handoff messages in code-conductor — achieving ≥30% character reduction over the current markdown snapshot format while retaining 100% parse reliability.

**Architecture:** A single-line JSON envelope (`session-snapshot.json`) replaces the current markdown `session-snapshot.md`. A standalone validator script (`scripts/snap-validate.mjs`) enforces schema invariants. The `cc-compact` skill writes SNAP; `cc-implement` reads and deletes it. A `v` version field gates schema evolution for future Pillar 3 agents.

**Tech Stack:** Node.js ≥ 18 (JSON.parse, fs), Vitest ^3 (test suite), markdown (skill definitions).

---

## Problem

The current `session-snapshot.md` written by `/cc-compact` uses verbose markdown syntax — headers, bold labels, bullet prefixes — that consumes ~880 characters for a typical mid-session handoff. Every token in the snapshot occupies context budget in the receiving `/cc-implement` session. There is no schema version, no field validation, and no extension point for the role-based agents planned in Pillar 3 (FEAT-009, FEAT-011, FEAT-012).

## Solution

Replace the markdown snapshot with **SNAP v1**: a minified single-line JSON object with three named blocks (`sys`, `ops`, `mem`) and a top-level version field. Field keys are 1–2 characters. Values are typed strings or arrays with explicit length caps. A Node.js validator enforces required keys, enum values, and array bounds. The format is forward-compatible: adding a `v:2` block for role-agent fields requires no changes to v1 readers beyond a version check.

## Behavior

### Main path

1. `/cc-compact` collects session state (phase, commit, decisions, pending steps, files, constraints, spec reference).
2. It serializes the state into a SNAP v1 JSON object and writes it as a single line to `.claude/memory/session-snapshot.json`. It also idempotently appends `.claude/memory/session-snapshot.json` to the project `.gitignore` if not already present: before appending, it checks whether the last byte of `.gitignore` is `\n`; if not, it prepends a newline before the entry to prevent corrupting the last un-terminated line (same pattern as `turn-count.txt` — no manual step required). If `.gitignore` cannot be read or written due to a filesystem permission or lock error, `/cc-compact` logs a non-fatal warning to stderr and continues — snapshot serialization is not blocked by `.gitignore` failures.
3. If `.claude/memory/session-snapshot.md` exists (legacy), it is deleted as part of the write step.
4. The user runs `/compact` to clear chat history.
5. `/cc-implement` starts in a fresh session, finds `session-snapshot.json`, and reads it via `JSON.parse()`. The file is NOT deleted yet.
6. `/cc-implement` resolves the repository root via `git rev-parse --show-toplevel`. If that command exits non-zero (detached HEAD with no repo, or not inside a git repo), `/cc-implement` halts immediately with `REPO_ROOT_FAILED — cannot determine repository root` and exits with code 3. On success it invokes `node "<repo-root>/scripts/snap-validate.mjs" "<repo-root>/.claude/memory/session-snapshot.json"` with both paths wrapped in double quotes to prevent shell parsing failures on directory names containing spaces. The validator child process inherits the CWD of `/cc-implement` (typically the repo root); since both arguments are absolute paths, the inherited CWD has no effect on path resolution within the validator. If `node` cannot be found or fails to launch, `/cc-implement` halts with `NODE_NOT_FOUND — node binary not found in PATH` and exits with code 2 (distinct from SNAP_INVALID exit code 1). Exit codes 2 and 3 are returned by `/cc-implement` itself, never by the validator script — the validator exits only 0 (valid) or 1 (schema violation). On any validation violation the validator exits 1 with the error message written exclusively to stderr, `/cc-implement` halts with `SNAP_INVALID`, and the file is left on disk for manual inspection and correction.
7. `/cc-implement` binds all context variables from the parsed object: phase → `sys.ph`, commit → `sys.c`, decisions → `mem.d`, constraints → `mem.x`, next steps → `ops.n`, files → `ops.f`, spec stem → `sys.s`.
8. Only after all context variables are fully bound does `/cc-implement` delete `session-snapshot.json`. If deletion fails due to a filesystem permission or lock error, `/cc-implement` logs a non-fatal warning to stderr and continues — context is already bound and the session proceeds normally; the stale file will be overwritten on the next `/cc-compact` run.
9. Implementation proceeds.

### Alternative paths

- **Legacy `.md` snapshot present, no `.json`**: `/cc-implement` falls back to reading the `.md` file using the old markdown extraction logic (backward-compatible read path, one session only). This fallback is removed in v1.18.0 — the minor version immediately following FEAT-010 — making SNAP v1 JSON the exclusive handoff format.
- **Both files present**: `.json` takes precedence; `.md` is deleted without being read.
- **Unknown version (`v > 1`)**: reader emits `SNAP_UNKNOWN_VERSION` and halts; the agent must not attempt to parse fields it does not know.

### Error cases

- **File is empty, zero-byte, or whitespace-only**: the validator applies `content.trim()` as the very first step after reading; if the trimmed result is an empty string (covers zero-byte files and files containing only spaces, tabs, or newlines), halt with `SNAP_INVALID — empty file`; leave file on disk; do not attempt parsing.
- **`JSON.parse()` fails**: halt with `SNAP_INVALID — malformed JSON`; leave file on disk; do not attempt line-by-line extraction.
- **JSON root is not a plain object**: immediately after `JSON.parse()` succeeds, validator checks `typeof snap === 'object' && snap !== null && !Array.isArray(snap)`; arrays, primitives, and `null` are rejected with `SNAP_INVALID — root must be a plain object`; leave file on disk. This check runs before any sub-key or block verification.
- **Parent block missing**: validator verifies `sys`, `ops`, `mem` are all present as plain objects before descending into sub-key checks; if any block is absent: `SNAP_INVALID — missing block: <sys|ops|mem>`; leave file on disk. This order prevents runtime errors on absent blocks.
- **Required sub-key missing**: the validator collects all missing required sub-keys before exiting; each missing key is emitted as a separate `SNAP_ERROR: missing: <key>` line to stderr in declared schema order (`v`, `sys.ph`, `sys.c`, `sys.s`, `ops.n`, `ops.f`, `mem.d`, `mem.x`) to guarantee deterministic test assertions; the validator exits 1 after reporting all of them. This is the only multi-error aggregation — all other checks are fail-fast: the validator emits one `SNAP_ERROR:` line and exits immediately on the first violation found.
- **Extra top-level key**: validator enumerates exactly `{v, sys, ops, mem}`; any additional key at the top level is `SNAP_INVALID — unexpected key: <key>`; leave file on disk.
- **Unexpected sub-key within a parent block**: validator enforces a strict allow-list per block: `sys` allows only `{ph, c, s}`; `ops` allows only `{n, f}`; `mem` allows only `{d, x}`; any additional key inside a block is `SNAP_INVALID — unexpected key: <block>.<key>`; leave file on disk. This seals v1 payloads against injected fields; v2+ sub-keys (`role`, `tk`, `scope`, `gate`, `p`) are unknown to the v1 validator and are rejected on the same basis.
- **`v` not a valid version integer**: validator checks `typeof snap.v === 'number' && Number.isInteger(snap.v) && snap.v >= 1`; floats (`1.0`), numeric strings (`"1"`), zero (`0`), and negative integers are all rejected with `SNAP_INVALID — v must be a positive integer`; leave file on disk.
- **`ph` outside enum or wrong case**: the `ph` enum is strictly case-sensitive; only the four exact lowercase values `spec`, `plan`, `impl`, `rev` are valid; `SPEC`, `Plan`, `IMPL`, and all other variations are rejected with `SNAP_INVALID — ph must be spec|plan|impl|rev`; leave file on disk.
- **Array exceeds cap**: writer drops from the **head** of the array (index 0 = oldest appended entry) so the most recently added items survive. Reader re-validates all caps on every read. All four required array fields (`ops.n`, `ops.f`, `mem.d`, `mem.x`) accept `[]` — minimum cardinality is 0; an empty array passes validation.
- **Empty or whitespace-only array element**: `SNAP_INVALID — empty element in <key>`; leave file on disk.
- **ops.f path segment before last `:` is empty**: `SNAP_INVALID — empty path in ops.f[<i>]`; leave file on disk. Triggered when an entry is `:C`, `:M`, or `:D` (no path prefix).
- **Element exceeds per-element cap**: writer truncates silently; validator rejects with `SNAP_INVALID — element too long in <key>[<i>]`.
- **File absent (no snapshot)**: reader skips destructive-read block entirely and proceeds with no prior context (existing fallback behavior, unchanged).

## SNAP v1 Schema

```json
{
  "v":   1,
  "sys": {
    "ph": "spec | plan | impl | rev",
    "c":  "<7-char git SHA>",
    "s":  "<spec filename stem — no path, no .md extension>"
  },
  "ops": {
    "n": ["<next step>"],
    "f": ["<relpath>:C|M|D"]
  },
  "mem": {
    "d": ["<decision>"],
    "x": ["<hard constraint>"]
  }
}
```

**Field constraints:**

| Key | Type | Required | Array cap | Element max |
|-----|------|----------|-----------|------------|
| `v` | integer | yes | — | — |
| `sys.ph` | enum | yes | — | — |
| `sys.c` | string | yes | — | 7 chars |
| `sys.s` | string | yes | — | 200 chars |
| `ops.n` | string[] | yes | max 3 | 200 chars |
| `ops.f` | string[] | yes | max 20 | 300 chars |
| `mem.d` | string[] | yes | max 10 | 300 chars |
| `mem.x` | string[] | yes | max 5 | 200 chars |

Writer truncates elements that exceed their per-element cap to that cap length before serialization. Character length is measured on the JSON-serialized form of each string value — specifically `JSON.stringify(value).slice(1, -1).length` (serialized string minus the surrounding quotes). This applies uniformly to all RFC 8259 §7 escape sequences: a raw newline (`U+000A`) → `\n` = 2 chars; a literal double-quote (`"`) → `\"` = 2 chars; a literal backslash (`\`) → `\\` = 2 chars. Characters that require no escaping count as 1 regardless of byte width in UTF-8. Validator enforces element caps during read to guard against external modification. Elements that are empty or consist entirely of whitespace are rejected by the validator as `SNAP_INVALID — empty element in <key>`.

**File action codes:** `C` = created, `M` = modified, `D` = deleted (uppercase only — lowercase `c`, `m`, `d` are explicitly rejected). The action code is the single character after the **last** `:` in each `ops.f` string, extracted via `lastIndexOf(':')`. Windows drive-letter colons cannot appear in relative paths, but Unix filenames may legally contain `:` characters; the writer must percent-encode any literal `:` in the path component as `%3A` before appending the `:C|M|D` suffix, ensuring `lastIndexOf(':')` always unambiguously identifies the action separator. The validator treats the path portion as opaque and does not decode percent-encoding. The validator must verify the suffix is strictly `C`, `M`, or `D`; any other character (including lowercase) is `SNAP_INVALID — invalid action code in ops.f[<i>]`. The validator must also reject any `ops.f` entry containing a literal backslash character (`\`, U+005C) with `SNAP_INVALID — backslash in ops.f[<i>]` — forward-slash normalization is the writer's responsibility, not silently corrected during read. A percent-encoded backslash (`%5C`) is three ASCII characters (`%`, `5`, `C`) and is NOT considered a backslash; the validator does not decode percent-encoding and does not flag `%5C`. When the writer truncates an `ops.f` element to its 300-char cap, it must truncate only the path prefix and preserve the trailing `:C|M|D` suffix intact. Path truncation must be Unicode-safe: use `Array.from(longpath).slice(0, 298).join('') + ':' + code` (or equivalent) so that surrogate pairs are never split mid-codepoint; `String.prototype.slice` operates on UTF-16 code units and may split a surrogate pair when the path contains characters outside the Basic Multilingual Plane.

**sys.c non-git fallback:** When `git rev-parse --short HEAD` exits non-zero (non-git workspace, bare repo, no commits yet), the writer uses `"0000000"` as the deterministic fallback value. When the command succeeds, the writer lowercases the trimmed stdout, then (a) slices to 7 chars if output is longer than 7, or (b) pads with trailing zeros if output is shorter than 7 (e.g. `"abc"` → `"abc0000"`) — legacy git environments may return short SHAs. Lowercasing before serialization prevents uppercase hex from failing the `/^[0-9a-f]{7}$/` validator check. After all processing (trim, lowercase, slice/pad), the writer validates the result against `/^[0-9a-f]{7}$/`; if it still does not match (e.g., git returned an unexpected non-hexadecimal string due to exotic configuration), the writer substitutes `"0000000"` as a safe fallback rather than serializing an invalid value. The validator enforces that `sys.c` matches `/^[0-9a-f]{7}$/` — exactly 7 lowercase hexadecimal characters; `"0000000"` satisfies this pattern and requires no special case.

**sys.s extraction and no-spec fallback:** The writer derives `sys.s` from the active specification's file path by (a) splitting on both `/` and `\` and taking the last segment, then (b) stripping the `.md` extension (if present). Directory components are fully discarded before regex validation — `docs/superpowers/specs/2026-06-24-feat010-design.md` produces `"2026-06-24-feat010-design"`. When no active specification file exists at the time `/cc-compact` runs, the writer stores `"none"` as the `sys.s` value. The validator enforces that `sys.s` matches `/^[a-zA-Z0-9._-]+$/` — alphanumerics, dots, hyphens, and underscores only; platform-illegal or shell-sensitive characters (`*`, `|`, `<`, `>`, `:`, `"`, `/`, `\`, `?`, ` `) are rejected with `SNAP_INVALID — invalid chars in sys.s`. The value `"none"` satisfies this pattern. `"none"` is not a reserved keyword — it receives no special-case handling by the validator and is treated identically to any other valid stem that matches the regex; no special casing required.

**Deduplication and element filtering:** The writer (a) filters out empty strings and whitespace-only strings from all arrays, (b) deduplicates remaining elements by exact string equality (case-sensitive — `foo/Bar.ts:M` and `foo/bar.ts:M` are distinct and not merged), and (c) applies array and per-element caps — all before serialization; first occurrence wins for deduplication. Case-sensitive comparison avoids platform-specific discrepancies between case-insensitive filesystems (Windows, macOS) and case-sensitive ones (Linux); the writer records paths exactly as reported by git status and preserves that casing. Writer-side filtering of empty/whitespace elements prevents self-induced `SNAP_INVALID — empty element in <key>` failures. The validator does NOT enforce array element uniqueness — deduplication is the writer's responsibility only; the validator is silent on duplicate values.

**String encoding:** All string values use native JSON string escaping per RFC 8259 §7 exclusively — no additional escaping layer. Backslashes in paths are encoded as `\\`. Unicode characters (e.g. `→`) are embedded as UTF-8 codepoints, not `\uXXXX` sequences, to minimize character count. Literal newline characters (`U+000A`) within decisions or constraints must be escaped as `\n` by the JSON serializer; this is required by the JSON spec and guarantees the final file remains a single line. The validator reads the file using explicit UTF-8 encoding (`fs.readFileSync(path, 'utf8')`). **Encoding anomaly caveat:** Node.js does NOT throw on invalid UTF-8 byte sequences when using this API — it silently substitutes the Unicode replacement character `U+FFFD` (`�`) instead. To detect encoding corruption, the validator must explicitly check `content.includes('�')` after reading; if true, halt with `SNAP_INVALID — encoding error`; leave file on disk. The validator applies `content.trim()` before any structural checks; the single-line assertion (trimmed content must not contain internal `\n` characters — any such character is `SNAP_INVALID — internal newline in payload`) is applied to the trimmed result before `JSON.parse()`, so any number of leading or trailing whitespace characters — including multiple trailing newlines — are silently ignored during validation. The writer must assert a single trailing `\n` after the JSON line and no other trailing whitespace; this is a writer-side discipline rule, not a validator rejection criterion.

**JSON key order:** The writer may serialize JSON keys in any insertion order; `JSON.stringify()` uses object property insertion order, but the validator accesses all fields by key name via property lookup, never by positional index, so serialization key order has no effect on correctness or interoperability. No canonical order is mandated.

**Serialized example and canonical test baseline** (436 chars; equivalent markdown ~880 chars; reduction: 51%): The following example is also the **fixed baseline payload** for the character-count comparison assertion in the test suite — both the SNAP JSON fixture and the markdown fixture in the test must encode this exact logical payload (same phase, commit, spec stem, ops.n, ops.f, mem.d, mem.x values) to guarantee a fair and deterministic cross-environment comparison.
```json
{"v":1,"sys":{"ph":"impl","c":"4a6bc93","s":"2026-06-24-bug015-auto-claude-md-design"},"ops":{"n":["run /cc-implement bug015"],"f":["tests/scripts/_fill_helper.cjs:M","tests/scripts/_fill_helper.ps1:C","tests/scripts/installer-fill.test.ps1:M"]},"mem":{"d":["_fill_helper.cjs dual-mode argv[2]: {→JSON else filepath","PS5.1 strips exe quotes→write tempfile","test harness wraps _fill_helper.ps1"],"x":["BUG-003 surgical single-line edits","PS5.1 dblquote strip"]}}
```

## Extension Model (v2+)

Future Pillar 3 agents add fields under existing blocks. The `v` field gates consumption:

```json
{
  "v": 2,
  "sys": { "ph": "impl", "c": "abc1234", "s": "feat012-design",
           "role": "code", "tk": "RW" },
  "ops": { "n": [...], "f": [...], "scope": ["tests/scripts/**"], "gate": "plan_complete" },
  "mem": { "d": [...], "x": [...], "p": {} }
}
```

| Key | Block | Purpose | Feature |
|-----|-------|---------|---------|
| `role` | sys | agent role: `spec\|plan\|code\|audit\|qa` | FEAT-012 |
| `tk` | sys | tool access mask: `R\|RW\|X` | FEAT-012 |
| `scope` | ops | authorized write paths array | FEAT-012 |
| `gate` | ops | phase completion state string | FEAT-011 |
| `p` | mem | orchestrator payload (free JSON object) | FEAT-011 |

**Version compatibility rule:** a reader encountering `v > supported_version` must halt with `SNAP_UNKNOWN_VERSION`. It must never silently consume unknown fields.

**v1 → v2 forward compatibility:** A v2+ reader encountering a v1 snapshot (`v === 1`) must accept it by treating absent v2 fields (`role`, `tk`, `scope`, `gate`, `p`) as not provided — no error, no default substitution. A v1 reader encountering `v === 2` halts with `SNAP_UNKNOWN_VERSION`. Rule: readers must accept all snapshots where `v ≤ supported_version`; reject all where `v > supported_version`.

## Acceptance Criteria

- [ ] `scripts/snap-validate.mjs` exists; reads file with explicit UTF-8 (`fs.readFileSync(path,'utf8')`); applies `content.trim()` before all checks; verifies `sys`/`ops`/`mem` parent blocks exist as objects before sub-key checks; validates required keys, `ph` enum, `ops.f` action code strictly in uppercase `{C,M,D}`, `ops.f` backslash absence, `sys.c` against `/^[0-9a-f]{7}$/`, `sys.s` against `/^[a-zA-Z0-9._-]+$/`, `v` as positive integer (`typeof === 'number' && Number.isInteger && v >= 1`), all array caps (`ops.n ≤ 3`, `ops.f ≤ 20`, `mem.d ≤ 10`, `mem.x ≤ 5`) plus per-element caps, no extra top-level keys (enumerated as `{v, sys, ops, mem}`), no unexpected sub-keys within blocks (`sys` → `{ph,c,s}`; `ops` → `{n,f}`; `mem` → `{d,x}`), no empty/whitespace-only array elements, non-empty ops.f path segments; re-validates all caps on every invocation; verifies parsed JSON root is a non-null plain object (`typeof === 'object' && snap !== null && !Array.isArray(snap)`) before sub-key checks; all error messages exclusively to stderr; every stderr error line is prefixed with `SNAP_ERROR:` (e.g., `SNAP_ERROR: missing block: sys`, `SNAP_ERROR: ph must be spec|plan|impl|rev`) for automated log parsing; exits 0 on valid, 1 on any schema violation — never writes to stdout; exit codes 2 (NODE_NOT_FOUND) and 3 (REPO_ROOT_FAILED) are returned by `/cc-implement`, not by this script
- [ ] `/cc-compact` (user skill) updated to write SNAP v1 JSON to `session-snapshot.json`; deduplicates array elements; deletes legacy `.md` if present
- [ ] `/cc-implement` (project command) updated to read `session-snapshot.json` with destructive-read; falls back to `.md` if only `.md` exists
- [ ] `tests/unit/snap-validate.test.js` added with ≥15 cases: valid v1, missing required key, missing parent block (`sys`/`ops`/`mem`), ph outside enum, unknown version, array over cap (each of the four arrays independently), invalid ops.f action code (invalid char, lowercase, backslash), empty array element, extra top-level key, v as float or string, sys.c non-hex, sys.s illegal char, round-trip field equality, character-count assertion (both the static frozen markdown fixture and the SNAP v1 serialization must encode an identical logical payload — same phase/commit/decisions/files/constraints/spec — so the size comparison is mathematically fair; the serialized JSON string `.length` of SNAP must be ≤70% of fixture `.length`; character count not byte count; both fixtures must use consistent formatting: SNAP side uses `JSON.stringify()` with no pretty-printing or extra spaces; markdown fixture is a raw string constant with no extra padding beyond what `/cc-compact` actually generates; both fixtures must normalize line endings to LF (`\n`) before measuring `.length` — CRLF endings inflate counts and break the ≤70% comparison on Windows; fixture is immutable), SNAP_INVALID leaves file on disk, validator errors go to stderr only
- [ ] All 216+ existing Vitest tests continue to pass
- [ ] `AGENT-READABLE BACKLOG.md` `[FEAT-010]` checkbox flipped to `[X]`
- [ ] `VERSION` file bumped from `1.16.0` → `1.17.0` (sequential after BUG-015); `CHANGELOG.md` entry added; `package.json` `"version"` field bumped to `1.17.0` in the same commit — the two files must remain synchronized, consistent with all prior code-conductor releases
- [ ] `README.md` comparison table updated with SNAP v1 row

## Out of Scope

- SNAP v2 fields (`role`, `tk`, `scope`, `gate`, `p`) — schema defined here but not implemented until FEAT-011/FEAT-012
- Encryption or signing of the snapshot payload
- Binary serialization (MessagePack, CBOR, etc.)
- Migration tooling for existing `.md` snapshots older than one session
- Changes to any other file written by `/cc-compact` (e.g., `project.md` checkpoint entries)

## System Impact

- `.claude/memory/session-snapshot.md` — deprecated; deleted on first SNAP v1 write; `/cc-implement` retains one-session fallback read
- `.claude/memory/session-snapshot.json` — new canonical handoff file; added to `.gitignore` automatically by `/cc-compact` on first write (idempotent append, same pattern as `turn-count.txt`)
- `scripts/snap-validate.mjs` — new file; ≤30 lines; executed as a standalone native ES module CLI process (`node scripts/snap-validate.mjs`) — the `.mjs` extension forces ES module parsing independent of the host project's `package.json` `"type"` field; no `require()` or CommonJS globals
- `~/.claude/` user skill `cc-compact` — template updated to emit JSON
- `project-template/.claude/commands/cc-implement.md` — Phase entry destructive-read block updated for `.json`
- `package.json` — no new dependencies (Node.js `fs` + `JSON.parse` only)
- `tests/unit/snap-validate.test.js` — new test file

### Files Requiring Full Read (deferred to /cc-plan)

- `project-template/.claude/commands/cc-implement.md` — full read needed to locate and surgically update Phase entry block

## Complexity Estimate

**M** — schema and validator are trivial (≤30 lines each); the coordination cost is updating two skill definitions (one user-level, one project-level) and writing the test suite without breaking existing 216-case suite.
