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
2. It serializes the state into a SNAP v1 JSON object and writes it as a single line to `.claude/memory/session-snapshot.json`.
3. If `.claude/memory/session-snapshot.md` exists (legacy), it is deleted as part of the write step.
4. The user runs `/compact` to clear chat history.
5. `/cc-implement` starts in a fresh session, finds `session-snapshot.json`, and reads it via `JSON.parse()`. The file is NOT deleted yet.
6. `/cc-implement` calls `snap-validate.mjs` to assert structural correctness. On any violation it halts with `SNAP_INVALID` and leaves the file on disk so the payload can be inspected and corrected manually.
7. On successful validation, `/cc-implement` deletes `session-snapshot.json` (destructive read — validation gate replaces immediacy).
8. Implementation proceeds with decisions, constraints, and pending tasks populated from the parsed object.

### Alternative paths

- **Legacy `.md` snapshot present, no `.json`**: `/cc-implement` falls back to reading the `.md` file using the old markdown extraction logic (backward-compatible read path, one session only).
- **Both files present**: `.json` takes precedence; `.md` is deleted without being read.
- **Unknown version (`v > 1`)**: reader emits `SNAP_UNKNOWN_VERSION` and halts; the agent must not attempt to parse fields it does not know.

### Error cases

- **`JSON.parse()` fails**: halt with `SNAP_INVALID — malformed JSON`; leave file on disk; do not attempt line-by-line extraction.
- **Required key missing**: halt with `SNAP_INVALID — missing: <key>`; list all missing keys; leave file on disk.
- **`ph` outside enum**: halt with `SNAP_INVALID — ph must be spec|plan|impl|rev`; leave file on disk.
- **Array exceeds cap**: writer truncates silently (oldest items dropped); reader never sees oversized arrays.
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

| Key | Type | Required | Cap |
|-----|------|----------|-----|
| `v` | integer | yes | — |
| `sys.ph` | enum | yes | — |
| `sys.c` | string | yes | 7 chars |
| `sys.s` | string | yes | — |
| `ops.n` | string[] | yes | max 3 |
| `ops.f` | string[] | yes | max 20 |
| `mem.d` | string[] | yes | max 10 |
| `mem.x` | string[] | yes | max 5 |

**File action codes:** `C` = created, `M` = modified, `D` = deleted.

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

## Acceptance Criteria

- [ ] `scripts/snap-validate.mjs` exists; validates required keys, `ph` enum, array caps, and `v === 1`; exits 0 on valid, 1 on invalid with a message on stderr
- [ ] `/cc-compact` (user skill) updated to write SNAP v1 JSON to `session-snapshot.json`; deletes legacy `.md` if present
- [ ] `/cc-implement` (project command) updated to read `session-snapshot.json` with destructive-read; falls back to `.md` if only `.md` exists
- [ ] `tests/unit/snap-validate.test.js` added with ≥8 cases: valid v1, missing required key, ph outside enum, unknown version, array over cap, round-trip field equality, character-count assertion (SNAP v1 serialization must be ≤70% of a static frozen markdown fixture defined inline in the test — the fixture is the immutable baseline and must never be regenerated), SNAP_INVALID leaves file on disk
- [ ] All 216+ existing Vitest tests continue to pass
- [ ] `AGENT-READABLE BACKLOG.md` `[FEAT-010]` checkbox flipped to `[X]`
- [ ] `VERSION` bumped to `1.17.0`, `CHANGELOG.md` entry added
- [ ] `README.md` comparison table updated with SNAP v1 row

## Out of Scope

- SNAP v2 fields (`role`, `tk`, `scope`, `gate`, `p`) — schema defined here but not implemented until FEAT-011/FEAT-012
- Encryption or signing of the snapshot payload
- Binary serialization (MessagePack, CBOR, etc.)
- Migration tooling for existing `.md` snapshots older than one session
- Changes to any other file written by `/cc-compact` (e.g., `project.md` checkpoint entries)

## System Impact

- `.claude/memory/session-snapshot.md` — deprecated; deleted on first SNAP v1 write; `/cc-implement` retains one-session fallback read
- `.claude/memory/session-snapshot.json` — new canonical handoff file; must be added to `.gitignore`
- `scripts/snap-validate.mjs` — new file; ≤30 lines; CommonJS-safe (`.mjs` extension, ES module import only)
- `~/.claude/` user skill `cc-compact` — template updated to emit JSON
- `project-template/.claude/commands/cc-implement.md` — Phase entry destructive-read block updated for `.json`
- `package.json` — no new dependencies (Node.js `fs` + `JSON.parse` only)
- `tests/unit/snap-validate.test.js` — new test file

### Files Requiring Full Read (deferred to /cc-plan)

- `project-template/.claude/commands/cc-implement.md` — full read needed to locate and surgically update Phase entry block

## Complexity Estimate

**M** — schema and validator are trivial (≤30 lines each); the coordination cost is updating two skill definitions (one user-level, one project-level) and writing the test suite without breaking existing 216-case suite.
