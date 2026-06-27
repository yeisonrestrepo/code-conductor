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
2. It serializes the state into a SNAP v1 JSON object and writes it as a single line to `.claude/memory/session-snapshot.json`. It also idempotently appends `.claude/memory/session-snapshot.json` to the project `.gitignore` if not already present: before appending, it checks whether the last byte of `.gitignore` is `\n`; if not, it prepends a newline before the entry to prevent corrupting the last un-terminated line (same pattern as `turn-count.txt` — no manual step required).
3. If `.claude/memory/session-snapshot.md` exists (legacy), it is deleted as part of the write step.
4. The user runs `/compact` to clear chat history.
5. `/cc-implement` starts in a fresh session, finds `session-snapshot.json`, and reads it via `JSON.parse()`. The file is NOT deleted yet.
6. `/cc-implement` resolves the repository root via `git rev-parse --show-toplevel`. If that command exits non-zero (detached HEAD with no repo, or not inside a git repo), `/cc-implement` halts immediately with `REPO_ROOT_FAILED — cannot determine repository root` and exits with code 3. On success it invokes `node "<repo-root>/scripts/snap-validate.mjs" "<repo-root>/.claude/memory/session-snapshot.json"` with both paths wrapped in double quotes to prevent shell parsing failures on directory names containing spaces. If `node` cannot be found or fails to launch, `/cc-implement` halts with `NODE_NOT_FOUND — node binary not found in PATH` and exits with code 2 (distinct from SNAP_INVALID exit code 1). On any validation violation the validator exits 1 with the error message written exclusively to stderr, `/cc-implement` halts with `SNAP_INVALID`, and the file is left on disk for manual inspection and correction.
7. `/cc-implement` binds all context variables from the parsed object: phase → `sys.ph`, commit → `sys.c`, decisions → `mem.d`, constraints → `mem.x`, next steps → `ops.n`, files → `ops.f`, spec stem → `sys.s`.
8. Only after all context variables are fully bound does `/cc-implement` delete `session-snapshot.json`. If deletion fails due to a filesystem permission or lock error, `/cc-implement` logs a non-fatal warning to stderr and continues — context is already bound and the session proceeds normally; the stale file will be overwritten on the next `/cc-compact` run.
9. Implementation proceeds.

### Alternative paths

- **Legacy `.md` snapshot present, no `.json`**: `/cc-implement` falls back to reading the `.md` file using the old markdown extraction logic (backward-compatible read path, one session only). This fallback is removed in v1.18.0 — the minor version immediately following FEAT-010 — making SNAP v1 JSON the exclusive handoff format.
- **Both files present**: `.json` takes precedence; `.md` is deleted without being read.
- **Unknown version (`v > 1`)**: reader emits `SNAP_UNKNOWN_VERSION` and halts; the agent must not attempt to parse fields it does not know.

### Error cases

- **File is empty or zero-byte**: halt with `SNAP_INVALID — empty file`; leave file on disk; do not attempt parsing.
- **`JSON.parse()` fails**: halt with `SNAP_INVALID — malformed JSON`; leave file on disk; do not attempt line-by-line extraction.
- **Parent block missing**: validator verifies `sys`, `ops`, `mem` are all present as plain objects before descending into sub-key checks; if any block is absent: `SNAP_INVALID — missing block: <sys|ops|mem>`; leave file on disk. This order prevents runtime errors on absent blocks.
- **Required sub-key missing**: halt with `SNAP_INVALID — missing: <key>`; list all missing keys; leave file on disk.
- **Extra top-level key**: validator enumerates exactly `{v, sys, ops, mem}`; any additional key at the top level is `SNAP_INVALID — unexpected key: <key>`; leave file on disk.
- **`v` not a primitive integer**: validator checks `typeof snap.v === 'number' && Number.isInteger(snap.v)`; floats (`1.0`) and numeric strings (`"1"`) are rejected with `SNAP_INVALID — v must be a primitive integer`; leave file on disk.
- **`ph` outside enum**: halt with `SNAP_INVALID — ph must be spec|plan|impl|rev`; leave file on disk.
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

Writer truncates elements that exceed their per-element cap to that cap length before serialization. Validator enforces element caps during read to guard against external modification. Elements that are empty or consist entirely of whitespace are rejected by the validator as `SNAP_INVALID — empty element in <key>`.

**File action codes:** `C` = created, `M` = modified, `D` = deleted (uppercase only — lowercase `c`, `m`, `d` are explicitly rejected). The action code is the single character after the **last** `:` in each `ops.f` string, extracted via `lastIndexOf(':')`. Relative paths never carry a drive-letter colon, so `lastIndexOf` is unambiguous on all platforms. The validator must verify the suffix is strictly `C`, `M`, or `D`; any other character (including lowercase) is `SNAP_INVALID — invalid action code in ops.f[<i>]`. The validator must also reject any `ops.f` entry containing a backslash character (`\`, U+005C) with `SNAP_INVALID — backslash in ops.f[<i>]` — forward-slash normalization is the writer's responsibility, not silently corrected during read. When the writer truncates an `ops.f` element to its 300-char cap, it must truncate only the path prefix and preserve the trailing `:C|M|D` suffix intact — e.g., `longpath.slice(0, 300 - 2) + ':' + code`.

**sys.c non-git fallback:** When `git rev-parse --short HEAD` exits non-zero (non-git workspace, bare repo, no commits yet), the writer uses `"0000000"` as the deterministic fallback value. When the command succeeds, the writer takes the trimmed stdout and (a) slices to 7 chars if output is longer than 7, or (b) pads with trailing zeros if output is shorter than 7 (e.g. `"abc"` → `"abc0000"`) — legacy git environments may return short SHAs. The validator enforces that `sys.c` matches `/^[0-9a-f]{7}$/` — exactly 7 lowercase hexadecimal characters; `"0000000"` satisfies this pattern and requires no special case.

**sys.s no-spec fallback:** When no active specification file exists at the time `/cc-compact` runs, the writer stores `"none"` as the `sys.s` value. The validator enforces that `sys.s` matches `/^[a-zA-Z0-9._-]+$/` — alphanumerics, dots, hyphens, and underscores only; platform-illegal or shell-sensitive characters (`*`, `|`, `<`, `>`, `:`, `"`, `/`, `\`, `?`, ` `) are rejected with `SNAP_INVALID — invalid chars in sys.s`. The value `"none"` satisfies this pattern.

**Deduplication:** The writer deduplicates elements in `mem.d`, `ops.f`, `ops.n`, and `mem.x` by exact string equality after element-capping but before serialization; first occurrence wins. Deduplication reduces redundant context in sessions with repeated decisions or file entries.

**String encoding:** All string values use native JSON string escaping per RFC 8259 §7 exclusively — no additional escaping layer. Backslashes in paths are encoded as `\\`. Unicode characters (e.g. `→`) are embedded as UTF-8 codepoints, not `\uXXXX` sequences, to minimize character count. Literal newline characters (`U+000A`) within decisions or constraints must be escaped as `\n` by the JSON serializer; this is required by the JSON spec and guarantees the final file remains a single line. The validator reads the file using explicit UTF-8 encoding (`fs.readFileSync(path, 'utf8')`); invalid UTF-8 byte sequences cause Node.js to throw and are treated as `SNAP_INVALID — encoding error`. The validator applies `content.trim()` before any structural checks (including the single-line assertion and `JSON.parse()`), so any number of leading or trailing whitespace characters — including multiple trailing newlines — are silently ignored during validation. The writer must assert a single trailing `\n` after the JSON line and no other trailing whitespace; this is a writer-side discipline rule, not a validator rejection criterion.

**Serialized example** (436 chars; equivalent markdown ~880 chars; reduction: 51%):
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

- [ ] `scripts/snap-validate.mjs` exists; reads file with explicit UTF-8 (`fs.readFileSync(path,'utf8')`); applies `content.trim()` before all checks; verifies `sys`/`ops`/`mem` parent blocks exist as objects before sub-key checks; validates required keys, `ph` enum, `ops.f` action code strictly in uppercase `{C,M,D}`, `ops.f` backslash absence, `sys.c` against `/^[0-9a-f]{7}$/`, `sys.s` against `/^[a-zA-Z0-9._-]+$/`, `v` as primitive integer (`typeof === 'number' && Number.isInteger`), all array caps (`ops.n ≤ 3`, `ops.f ≤ 20`, `mem.d ≤ 10`, `mem.x ≤ 5`) plus per-element caps, no extra top-level keys, no empty/whitespace-only array elements, non-empty ops.f path segments; re-validates all caps on every invocation; all error messages exclusively to stderr; exits 0 on valid, 1 on schema violation, 2 on NODE_NOT_FOUND, 3 on REPO_ROOT_FAILED — never writes to stdout
- [ ] `/cc-compact` (user skill) updated to write SNAP v1 JSON to `session-snapshot.json`; deduplicates array elements; deletes legacy `.md` if present
- [ ] `/cc-implement` (project command) updated to read `session-snapshot.json` with destructive-read; falls back to `.md` if only `.md` exists
- [ ] `tests/unit/snap-validate.test.js` added with ≥8 cases: valid v1, missing required key, missing parent block (`sys`/`ops`/`mem`), ph outside enum, unknown version, array over cap (each of the four arrays independently), invalid ops.f action code (invalid char, lowercase, backslash), empty array element, extra top-level key, v as float or string, sys.c non-hex, sys.s illegal char, round-trip field equality, character-count assertion (both the static frozen markdown fixture and the SNAP v1 serialization must encode an identical logical payload — same phase/commit/decisions/files/constraints/spec — so the size comparison is mathematically fair; `JSON.prototype.length` of SNAP must be ≤70% of fixture `.length`; character count not byte count; fixture is immutable), SNAP_INVALID leaves file on disk, validator errors go to stderr only
- [ ] All 216+ existing Vitest tests continue to pass
- [ ] `AGENT-READABLE BACKLOG.md` `[FEAT-010]` checkbox flipped to `[X]`
- [ ] `VERSION` bumped from `1.16.0` → `1.17.0` (sequential after BUG-015); `CHANGELOG.md` entry added
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
