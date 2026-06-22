# BUG-017: Graphify Initialization Bloat — Read Guard Design

**Date:** 2026-06-22
**Status:** Approved
**Backlog ID:** BUG-017
**Version target:** 1.13.0

---

## Problem

The agent attempts to read raw structural metadata files (`graphify-out/graph.json`,
`graphify-out/cache/ast/*.json`) straight into context during session start or graph queries.
`node_modules/**` files share the same risk. Both directories are already gitignored but there
is no tool-level enforcement preventing a `Read` call from ingesting them.

The CLAUDE.md Session Initialization instruction uses the ambiguous word "verify", which the
agent may resolve with a `Read` call instead of a `Glob` existence check.

Additionally, `install.sh` and `install.ps1 -Project` unconditionally re-download
`.claude/hooks/pre-tool-use.sh` from GitHub on every run, overwriting any locally applied
guard extensions (Guard 3 was wiped twice by this mechanism).

---

## Solution

Three targeted changes: (1) add Guard 4 to the pre-tool-use hook — a Read-tool interceptor
that blocks any file whose path contains `graphify-out` or `node_modules` as an exact path
component; (2) make the hook download step idempotent in both installers so local
customizations are preserved on re-runs; (3) update the Session Initialization instruction
in both CLAUDE.md files to make the Glob-only constraint explicit and machine-scannable.

---

## Behavior

### Main path

1. Agent issues a `Read` tool call with any file path.
2. `pre-tool-use.sh` fires; `CLAUDE_TOOL_NAME` is `Read`.
3. Guard 4 invokes python3 to parse `$CLAUDE_TOOL_INPUT` JSON and extract `file_path`.
4. Path is split into components (backslashes normalized to `/`); empty components stripped.
5. If any component equals `graphify-out` or `node_modules` → hook exits 1 with structured
   JSON block message; Claude Code surfaces the reason to the agent.
6. Agent uses `/graphify query "<question>"` or `Glob` instead.

### Alternative paths

- **Absolute path:** `/home/user/project/graphify-out/graph.json` — component split still
  isolates `graphify-out`; blocked.
- **Windows backslash:** `graphify-out\cache\file.json` — `replace('\\', '/')` normalizes
  before split; blocked.
- **Case variants (case-insensitive FS):** `Graphify-Out/graph.json` or `NODE_MODULES/x.js`
  — components are lowercased before comparison; blocked.
- **Traversal escape (false-positive fix):** `graphify-out/../src/main.js` — raw split would
  yield `graphify-out` as a component and incorrectly block a safe file. `posixpath.normpath`
  resolves this to `src/main.js` before splitting → components `['src', 'main.js']` → not
  blocked.
- **Traversal into blocked dir (correctly blocked):** `src/../../graphify-out/file.json` —
  `posixpath.normpath` resolves to `../graphify-out/file.json` → components include
  `graphify-out` → blocked.
- **Unrelated file with similar name:** `src/utils/graphify-out-helper.js` — component is
  `graphify-out-helper.js`, not `graphify-out`; passes through.
- **Symbolic links / directory junctions:** Guard 4 checks path components as written by the
  caller, not the resolved symlink target. A symlink named `data` pointing to `graphify-out/`
  would NOT be caught via `data/file.json`. This is a known limitation — symlink resolution
  in bash adds complexity not justified by the current threat model; defer to FEAT-019.
- **Non-Read tool with graphify-out path** (e.g., Bash): Guard 4 only fires on
  `CLAUDE_TOOL_NAME == "Read"`; other tools unaffected.

### Error cases

- **python3 absent:** `2>/dev/null` suppresses the error; `_g4_result` is empty (neither
  `"BLOCK"`); guard skips — fail-open. Hook does not crash.
- **python3 present but throws any exception** (import error, env error, permission error,
  `json.JSONDecodeError`, `KeyError`, `OSError`): all exceptions write to stderr which
  `2>/dev/null` swallows regardless of error type; `_g4_result` is empty → fail-open.
- **Malformed or unparseable JSON input** (`{invalid}`, empty string, non-JSON payload):
  `json.load()` raises `json.JSONDecodeError`; caught by `2>/dev/null`; fail-open.
- **Missing, null, or empty `file_path`:** `d.get('file_path', '')` returns `''`; split
  produces `[]` after empty-component filter; `any(...)` is `False` → 'OK' → fail-open.
- **Installer re-run with existing hook:** `[ ! -f ]` / `Test-Path` check prevents download;
  existing file untouched.

---

## Implementation

### Guard 4 — `pre-tool-use.sh` and `project-template/.claude/hooks/pre-tool-use.sh`

Both files receive an identical block appended after Guard 3:

```bash
# Guard 4 — block Read on graphify-out/ and node_modules/ (BUG-017)
# To reset to GitHub upstream: delete .claude/hooks/pre-tool-use.sh, then re-run installer.
if [ "$CLAUDE_TOOL_NAME" = "Read" ]; then
    _g4_result=$(printf '%s' "$CLAUDE_TOOL_INPUT" | python3 -c '
import json, sys, posixpath
raw = sys.stdin.buffer.read().decode("utf-8", errors="replace")
d = json.loads(raw)
fp = d.get("file_path", "").strip()
fp_n = posixpath.normpath(fp.replace("\\", "/"))
parts = [p.lower() for p in fp_n.split("/") if p and p != "."]
blocked = {"graphify-out", "node_modules"}
print("BLOCK" if any(p in blocked for p in parts) else "OK")
' 2>/dev/null)
    if [ "$_g4_result" = "BLOCK" ]; then
        echo '{"decision":"block","reason":"Guard 4: direct reads of graphify-out/ and node_modules/ are forbidden. Use Glob for existence checks or the graphify skill: /graphify query \"<question>\"."}'
        exit 1
    fi
fi
```

**Key implementation decisions:**
- `printf '%s'` pipes input to python3 instead of bash herestring `<<<`; single-quoted
  python block prevents bash from interpreting `$` or `\` inside the script.
- `sys.stdin.buffer.read().decode('utf-8', errors='replace')` + `json.loads()` reads raw
  bytes and decodes as UTF-8 with replacement; avoids `UnicodeDecodeError` when the system
  locale is non-UTF-8 (e.g., `LANG=C`) and a file path contains non-ASCII characters.
  `errors='replace'` preserves ASCII components (`graphify-out`) even if surroundings are
  garbled → block decision remains correct.
- `.strip()` on `file_path` removes leading/trailing whitespace injected by the caller;
  prevents `" graphify-out/graph.json"` from producing ` graphify-out` as a component and
  bypassing the block.
- `posixpath.normpath` resolves `..` segments before component split, eliminating the
  `graphify-out/../src/main.js` false-positive (resolves to `src/main.js` → not blocked).
- `p != "."` filter drops current-dir segments that `normpath` may leave in dot-relative paths.
- `2>/dev/null` catches ALL python3 failure modes: absent binary, import errors,
  `JSONDecodeError`, `OSError`, env errors. Any exception → empty result → fail-open.

### Installer idempotency — `install.sh`

Locate the hook download step. Wrap in existence check; ensure directory creation runs first:

```bash
mkdir -p ".claude/hooks"
# To reset hook to GitHub upstream: delete .claude/hooks/pre-tool-use.sh, then re-run.
if [ ! -f ".claude/hooks/pre-tool-use.sh" ]; then
    curl -fsSL "$BASE_URL/pre-tool-use.sh" -o ".claude/hooks/pre-tool-use.sh"
fi
chmod +x ".claude/hooks/pre-tool-use.sh"
```

`chmod +x` runs unconditionally — outside the download guard — so it applies both to freshly
downloaded files and to pre-existing ones that may have lost the execute bit (e.g., via
filesystem copy, tar extraction, or certain Git operations).

Audit all subsequent installer steps for any `project-template` copy that targets
`.claude/hooks/pre-tool-use.sh`; wrap each with the same `[ ! -f ]` guard.

### Installer idempotency — `install.ps1`

```powershell
try {
    New-Item -ItemType Directory -Force ".claude\hooks" -ErrorAction Stop | Out-Null
} catch {
    Write-Error "Guard: failed to create .claude\hooks directory: $_"
    exit 1
}
# To reset hook to GitHub upstream: delete .claude\hooks\pre-tool-use.sh, then re-run.
if (-not (Test-Path ".claude\hooks\pre-tool-use.sh")) {
    try {
        Invoke-WebRequest -UseBasicParsing -Uri "$BaseUrl/pre-tool-use.sh" `
            -OutFile ".claude\hooks\pre-tool-use.sh" -ErrorAction Stop
    } catch {
        Write-Error "Guard: failed to download pre-tool-use.sh: $_"
        exit 1
    }
}
```

**install.ps1 conventions:**
- All hook and template paths use backslashes consistently (`".claude\hooks\..."`) — no mixed
  forward slashes in PowerShell path arguments.
- `-UseBasicParsing` required for PS 5.1 on systems without Internet Explorer COM object
  (Server Core, most CI images).
- `-ErrorAction Stop` converts `Invoke-WebRequest` network failure from a non-terminating
  error (silent in PS 5.1) to a terminating error caught by `try/catch`; ensures clear
  diagnostic output and non-zero exit on download failure.

Same audit for any subsequent project-template copy steps.

**Propagation trade-off:** Once a user has a local `.claude/hooks/pre-tool-use.sh`, the
idempotency check means upstream updates to the project-template hook file will NOT propagate
automatically on reinstall. This is intentional (preserves local guards) but must be
documented in `CONTRIBUTING.md` or installer output: users who want to pull a fresh upstream
hook must manually delete the local file before re-running the installer.

### CLAUDE.md session init — both `CLAUDE.md` and `project-template/CLAUDE.md`

Replace the Session Initialization section with (word-for-word identical in both files):

```markdown
## Session Initialization
- At session start: use **Glob** (NEVER use Read) to check that `project.md` and
  `graphify-out/graph.json` exist; run `/cc-init` if absent.
- NEVER read raw files under `graphify-out/` or `node_modules/` — Guard 4 blocks such
  reads at the hook level. For graph queries, invoke the graphify skill:
  `/graphify query "<question>"`.
- Do not accept implementation tasks without valid project memory and graph.
```

### Tests — `tests/hooks/guard4.test.js`

New file following the `guard3.test.js` pattern (`spawnSync`, `BASH_AVAILABLE` skip guard).

**Hook isolation:** Tests resolve the hook path relative to the project root
(`new URL('../../.claude/hooks/pre-tool-use.sh', import.meta.url)`), not from the developer's
home directory. This ensures tests run against the project-committed hook, not a user-modified
live copy.

**`BASH_AVAILABLE` definition:**
```js
const BASH_AVAILABLE = spawnSync('bash', ['--version'], { encoding: 'utf8' }).status === 0
```
Uses `bash --version` (not `which bash`) so it tests actual bash executability, not just
presence in PATH. Returns `false` on native Windows without Git Bash; all guarded test suites
call `describe.skipIf(!BASH_AVAILABLE)`.

**Bash path resolution for fail-open test (Windows-safe):**
```js
const BASH_PATH = (spawnSync('which', ['bash'], { encoding: 'utf8' }).stdout || '').trim() || '/bin/bash'
```
`|| ''` guard prevents `.trim()` from throwing if `stdout` is `null` on native Windows
environments where `which` is unavailable.

All exit-1 assertions use `JSON.parse(result.stderr.trim())` and verify
`payload.decision === 'block'` and `payload.reason` matches `/Guard 4/`.

**~15 test cases:**

| `file_path` input | `CLAUDE_TOOL_INPUT` | `PATH` | `CLAUDE_TOOL_NAME` | Expected |
|---|---|---|---|---|
| `graphify-out/graph.json` | valid JSON | normal | `Read` | exit 1, JSON block |
| `graphify-out/cache/ast/abc.json` | valid JSON | normal | `Read` | exit 1, JSON block |
| `node_modules/vitest/dist/index.js` | valid JSON | normal | `Read` | exit 1, JSON block |
| `/abs/path/graphify-out/file.json` | valid JSON | normal | `Read` | exit 1, JSON block |
| `graphify-out\cache\file.json` (backslash) | valid JSON | normal | `Read` | exit 1, JSON block |
| `Graphify-Out/graph.json` (case variant) | valid JSON | normal | `Read` | exit 1, JSON block |
| `NODE_MODULES/pkg/index.js` (uppercase) | valid JSON | normal | `Read` | exit 1, JSON block |
| `graphify-out/../src/main.js` (traversal escape) | valid JSON | normal | `Read` | exit 0 (resolves to `src/main.js`) |
| `graphify-out/` (trailing slash) | valid JSON | normal | `Read` | exit 1 (`normpath` strips slash; component `graphify-out` matched) |
| `  graphify-out/graph.json` (leading spaces) | valid JSON | normal | `Read` | exit 1 (`.strip()` removes whitespace before split) |
| `graphify-out-backup/file.json` | valid JSON | normal | `Read` | exit 0 |
| `src/utils/graphify-out-helper.js` | valid JSON | normal | `Read` | exit 0 |
| `src/index.js` | valid JSON | normal | `Read` | exit 0 |
| `graphify-out/graph.json` | `{invalid json}` (malformed) | normal | `Read` | exit 0 (fail-open) |
| `graphify-out/graph.json` | `{}` (missing file_path) | normal | `Read` | exit 0 (fail-open) |
| `graphify-out/graph.json` | valid JSON | `""` (no python3) | `Read` | exit 0 (fail-open), uses `BASH_PATH` |
| `graphify-out/graph.json` | valid JSON | normal | `Bash` | exit 0 (Guard 4 skipped) |

**Latency note:** Guard 4 spawns a python3 subprocess for every `Read` tool call, adding
~50-100ms python3 startup overhead per invocation. For high-frequency sequential reads (e.g.,
agent reading 10+ files in a plan phase), this compounds to 0.5-1s of latency. This is
acceptable given Guard 4 only fires on `Read`, not on `Glob`/`Grep`. **Caching threshold:**
implement temp-file result caching (keyed on `file_path` hash) only if `npm test` total
duration exceeds 120 seconds OR if manual profiling shows Guard 4 adds >500ms per agent
session. Do not optimise speculatively.

**Pre-commit gate behavior:** `npm test` exits 0 only when all non-skipped tests pass. The
2 Windows-skipped verbosity tests (`BASH_AVAILABLE = false`) produce `2 skipped` in output
but do NOT cause exit 1. If the entire test suite is absent (e.g., `node_modules/` deleted),
`npm test` exits 1 with a "no test files found" error — commit is rejected. Verification
step: after implementation, run `npm test` manually and confirm the summary line reads
`X passed | 2 skipped` with no errors before committing.

---

## Acceptance Criteria

- [ ] `Read` on any `graphify-out/**` path → hook exits 1; `JSON.parse(stderr.trim())` succeeds; `decision === "block"`, `reason` matches `Guard 4`
- [ ] `Read` on any `node_modules/**` path → same block behavior
- [ ] `Read` on case variants (`Graphify-Out/`, `NODE_MODULES/`) → same block behavior (case-insensitive)
- [ ] `Read` on `src/utils/graphify-out-helper.js` → exits 0 (no false positive)
- [ ] Malformed JSON input (`{invalid}`) → hook exits 0 (fail-open)
- [ ] Missing `file_path` key in input (`{}`) → hook exits 0 (fail-open)
- [ ] python3 absent → hook exits 0 (fail-open, no crash)
- [ ] `.claude/hooks/pre-tool-use.sh` NOT overwritten when file already exists on `install.sh` / `install.ps1 -Project` re-run
- [ ] `project-template/.claude/hooks/pre-tool-use.sh` copy step has same idempotency guard
- [ ] Session Init text in both `CLAUDE.md` files is word-for-word identical and contains `**Glob**`, `NEVER`, `/graphify query`
- [ ] `graphify-out/../src/main.js` → exits 0 (traversal escape correctly passes; `posixpath.normpath` resolves to `src/main.js`)
- [ ] All ~15 `guard4.test.js` tests pass; manual `npm test` run shows `X passed | 2 skipped`, exit 0, before any commit
- [ ] `graphify-out/` confirmed present in `.gitignore` (already satisfied — no change needed)
- [ ] `package.json` version bumped to `1.13.0` in sync with `VERSION` file
- [ ] `AGENT-READABLE BACKLOG.md` BUG-017 marked `[X]`

---

## Out of Scope

- Blocking `Read` on `.vitest-cache/` or other gitignored directories
- Graphify skill internals or graph rebuild logic
- Any changes to `graphify-ast-refresh.py`
- FEAT-019 (Graph Dependency Shield middleware layer)

---

## System Impact

- `.claude/hooks/pre-tool-use.sh` — Guard 4 block appended (~15 lines)
- `project-template/.claude/hooks/pre-tool-use.sh` — identical change
- `install.sh` — hook download step wrapped; directory creation added
- `install.ps1` — same idempotency fix
- `CLAUDE.md` — Session Initialization section updated
- `project-template/CLAUDE.md` — identical update
- `tests/hooks/guard4.test.js` — new file (~80 lines, 15 tests)
- `CONTRIBUTING.md` — add propagation trade-off note (hook reset procedure)
- `AGENT-READABLE BACKLOG.md` — BUG-017 `[ ]` → `[X]`
- `VERSION` — 1.12.0 → 1.13.0
- `package.json` — `"version"` field 1.12.0 → 1.13.0 (kept in sync with `VERSION`)
- `CHANGELOG.md` — `[1.13.0]` entry; format follows existing template:
  ```
  ## [1.13.0] - 2026-06-22

  ### Added
  - `[BUG-017]` Guard 4 in `.claude/hooks/pre-tool-use.sh` ...
  - `[BUG-017]` `tests/hooks/guard4.test.js` ...

  ### Changed
  - `[BUG-017]` `install.sh` / `install.ps1` — hook download now idempotent ...
  - `[BUG-017]` `CLAUDE.md` / `project-template/CLAUDE.md` — Session Init ...
  ```

### Files Requiring Full Read (deferred to /cc-plan)

- `install.sh` — need full read to locate exact hook download line and any project-template copy steps
- `install.ps1` — same
- `.claude/hooks/pre-tool-use.sh` — need to identify Guard 3 end-line for Guard 4 insertion point

---

## Complexity Estimate

**S** — All changes are additive and surgical; no new dependencies; existing test harness handles new test file automatically.
