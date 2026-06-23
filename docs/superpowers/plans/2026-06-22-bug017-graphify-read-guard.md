# BUG-017: Graphify Read Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Block `Read` tool calls on `graphify-out/` and `node_modules/` paths via Guard 4 in `pre-tool-use.sh`; make the hook download idempotent in both installers; update `CLAUDE.md` Session Initialization to mandate Glob-only checks.

**Architecture:** Guard 4 is a 20-line bash block inserted between Guard 3 and Guard 2 in `pre-tool-use.sh`. It delegates path-component matching to an inline python3 one-liner (fail-open on absence). Both the live hook and the project-template mirror receive an identical block. The installer idempotency fix is a one-argument change to the download call. CLAUDE.md changes are surgical 3-line replacements.

**Tech Stack:** bash 3.2+, python3 (stdlib: json, sys, posixpath), Node.js 20 + Vitest 3 (tests), PowerShell 5.1 (installer)

## Global Constraints

- `set -euo pipefail` is active in `install.sh`; bash errors are fatal automatically — no extra `|| exit 1` needed.
- `install.ps1` targets PS 5.1: no `Join-Path` mixing, no `Write-Error`, literal backslash paths only.
- Guard 4 block is word-for-word identical in both hook files.
- All CLAUDE.md Session Initialization text must be word-for-word identical in both CLAUDE.md files.
- Pre-commit gate is live: `npm test` must exit 0 before every commit (currently 126 pass, 2 skip).
- `.claude/` and `docs/` are in `.gitignore` — use `git add -f` for files in those paths.
- BUG-003 invariant: all plan/backlog checkbox edits are surgical single-line Edits; never bulk-overwrite.
- Block message in Guard 4 writes to **stdout** (`echo`), not stderr — consistent with Guard 1 and Guard 2 patterns in this file. Tests must assert on `result.stdout`.

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `tests/hooks/guard4.test.js` | Create | 17 Vitest tests for Guard 4 |
| `.claude/hooks/pre-tool-use.sh` | Modify | Insert Guard 4 block (lines 465→467) |
| `project-template/.claude/hooks/pre-tool-use.sh` | Modify | Identical Guard 4 insertion |
| `install.sh` | Modify | Root sentinel + parent-dir warning + idempotency for hook download |
| `install.ps1` | Modify | Same three changes for Windows |
| `CLAUDE.md` | Modify | Session Initialization section (3-line replacement) |
| `project-template/CLAUDE.md` | Modify | Identical replacement |
| `CONTRIBUTING.md` | Modify | Add `### Resetting the Pre-Commit Hook to Upstream` subsection |
| `README.md` | Modify | Add parent-dir constraint note under Install section |
| `AGENT-READABLE BACKLOG.md` | Modify | BUG-017 `[ ]` → `[X]` |
| `VERSION` | Modify | 1.12.0 → 1.13.0 |
| `package.json` | Modify | Add `"version": "1.13.0"` field |
| `CHANGELOG.md` | Modify | Add `[1.13.0]` entry |

---

### Task 1: Write failing guard4 tests

**Files:**
- Create: `tests/hooks/guard4.test.js`

**Interfaces:**
- Consumes: `BASH` availability (spawnSync bash --version), `BASH_PATH` (which bash), `HOOK` path resolved to `.claude/hooks/pre-tool-use.sh`
- Produces: 17 test cases that will FAIL until Guard 4 is implemented

- [X] [T-001-A] Create `tests/hooks/guard4.test.js` with the complete content below:

```js
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join, resolve } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = resolve(__dirname, '../..')
const HOOK = join(REPO_ROOT, '.claude/hooks/pre-tool-use.sh')

// Tests bash executability, not just PATH presence (returns false on Windows without Git Bash)
const BASH_AVAILABLE = spawnSync('bash', ['--version'], { encoding: 'utf8' }).status === 0

// Absolute bash path for the no-python3 test where PATH is cleared
// || '' guard prevents .trim() from throwing when stdout is null on Windows
const BASH_PATH = (spawnSync('which', ['bash'], { encoding: 'utf8' }).stdout || '').trim() || '/bin/bash'

function runRead(filePath, { toolName = 'Read', input = null } = {}) {
  const finalInput = input ?? JSON.stringify({ file_path: filePath })
  const result = spawnSync('bash', [HOOK], {
    stdio: 'pipe',
    cwd: REPO_ROOT,
    timeout: 15000,
    env: { ...process.env, CLAUDE_TOOL_NAME: toolName, CLAUDE_TOOL_INPUT: finalInput },
  })
  if (result.error) throw new Error(`bash spawn failed: ${result.error.message}`)
  const strip = s => s.replace(/\r\n|\r/g, '\n').replace(/\x1b\[[0-9;]*m/g, '')
  return {
    status: result.status ?? -1,
    stdout: strip((result.stdout ?? Buffer.alloc(0)).toString()),
    stderr: strip((result.stderr ?? Buffer.alloc(0)).toString()),
  }
}

describe.skipIf(!BASH_AVAILABLE)('Guard 4 — Read blocker for graphify-out/ and node_modules/', () => {
  // ── Blocked paths (exit 1, JSON block on stdout) ─────────────────────────────

  it('row1: blocks graphify-out/graph.json', () => {
    const r = runRead('graphify-out/graph.json')
    expect(r.status).toBe(1)
    const p = JSON.parse(r.stdout.trim())
    expect(p.decision).toBe('block')
    expect(p.reason).toMatch(/Guard 4/)
  })

  it('row2: blocks graphify-out/cache/ast/abc.json', () => {
    const r = runRead('graphify-out/cache/ast/abc.json')
    expect(r.status).toBe(1)
    const p = JSON.parse(r.stdout.trim())
    expect(p.decision).toBe('block')
    expect(p.reason).toMatch(/Guard 4/)
  })

  it('row3: blocks node_modules/vitest/dist/index.js', () => {
    const r = runRead('node_modules/vitest/dist/index.js')
    expect(r.status).toBe(1)
    const p = JSON.parse(r.stdout.trim())
    expect(p.decision).toBe('block')
    expect(p.reason).toMatch(/Guard 4/)
  })

  it('row4: blocks absolute path /abs/path/graphify-out/file.json', () => {
    const r = runRead('/abs/path/graphify-out/file.json')
    expect(r.status).toBe(1)
    const p = JSON.parse(r.stdout.trim())
    expect(p.decision).toBe('block')
    expect(p.reason).toMatch(/Guard 4/)
  })

  it('row5: blocks Windows backslash path graphify-out\\cache\\file.json', () => {
    const r = runRead('graphify-out\\cache\\file.json')
    expect(r.status).toBe(1)
    const p = JSON.parse(r.stdout.trim())
    expect(p.decision).toBe('block')
    expect(p.reason).toMatch(/Guard 4/)
  })

  it('row6: blocks case variant Graphify-Out/graph.json', () => {
    const r = runRead('Graphify-Out/graph.json')
    expect(r.status).toBe(1)
    const p = JSON.parse(r.stdout.trim())
    expect(p.decision).toBe('block')
    expect(p.reason).toMatch(/Guard 4/)
  })

  it('row7: blocks NODE_MODULES/pkg/index.js (uppercase)', () => {
    const r = runRead('NODE_MODULES/pkg/index.js')
    expect(r.status).toBe(1)
    const p = JSON.parse(r.stdout.trim())
    expect(p.decision).toBe('block')
    expect(p.reason).toMatch(/Guard 4/)
  })

  it('row8: allows graphify-out/../src/main.js (normpath resolves to src/main.js)', () => {
    const r = runRead('graphify-out/../src/main.js')
    expect(r.status).toBe(0)
  })

  it('row9: blocks graphify-out/ (trailing slash — normpath yields graphify-out, component matched)', () => {
    const r = runRead('graphify-out/')
    expect(r.status).toBe(1)
    const p = JSON.parse(r.stdout.trim())
    expect(p.decision).toBe('block')
    expect(p.reason).toMatch(/Guard 4/)
  })

  it('row10: blocks "  graphify-out/graph.json" (leading spaces stripped by .strip())', () => {
    const r = runRead('  graphify-out/graph.json')
    expect(r.status).toBe(1)
    const p = JSON.parse(r.stdout.trim())
    expect(p.decision).toBe('block')
    expect(p.reason).toMatch(/Guard 4/)
  })

  it('row11: allows graphify-out-backup/file.json (not an exact component match)', () => {
    const r = runRead('graphify-out-backup/file.json')
    expect(r.status).toBe(0)
  })

  it('row12: allows src/utils/graphify-out-helper.js (no blocked component)', () => {
    const r = runRead('src/utils/graphify-out-helper.js')
    expect(r.status).toBe(0)
  })

  it('row13: allows src/index.js (normal file)', () => {
    const r = runRead('src/index.js')
    expect(r.status).toBe(0)
  })

  // ── Fail-open cases (exit 0) ──────────────────────────────────────────────────

  it('row14: fail-open on malformed JSON input {invalid json}', () => {
    const r = runRead('', { input: '{invalid json}' })
    expect(r.status).toBe(0)
  })

  it('row15: fail-open on missing file_path key (empty object {})', () => {
    const r = runRead('', { input: '{}' })
    expect(r.status).toBe(0)
  })

  it('row16: fail-open when python3 absent (PATH cleared — bash spawned via BASH_PATH)', () => {
    const result = spawnSync(BASH_PATH, [HOOK], {
      stdio: 'pipe',
      cwd: REPO_ROOT,
      timeout: 15000,
      env: {
        ...process.env,
        PATH: '',
        CLAUDE_TOOL_NAME: 'Read',
        CLAUDE_TOOL_INPUT: JSON.stringify({ file_path: 'graphify-out/graph.json' }),
      },
    })
    if (result.error) throw new Error(`bash spawn failed: ${result.error.message}`)
    expect(result.status ?? -1).toBe(0)
  })

  // ── Non-Read tool — Guard 4 skipped ──────────────────────────────────────────

  it('row17: does NOT fire Guard 4 when CLAUDE_TOOL_NAME is Bash (Guard 3 handles; exits 0)', () => {
    // Input has no "command" key → Guard 3 extracts empty command → exits 0 immediately
    const r = runRead('graphify-out/graph.json', { toolName: 'Bash' })
    expect(r.status).toBe(0)
  })
})
```

- [X] [T-001-B] Run `npm test` and confirm 17 new guard4 tests FAIL (Guard 4 not yet implemented):

```
npm test
```

Expected: test run shows guard4 suite with 17 failures, overall exit 1.

---

### Task 2: Add Guard 4 to live `.claude/hooks/pre-tool-use.sh`

**Files:**
- Modify: `.claude/hooks/pre-tool-use.sh` between lines 464–467

**Interfaces:**
- Consumes: `CLAUDE_TOOL_NAME`, `CLAUDE_TOOL_INPUT` env vars (same as Guard 1 and Guard 3)
- Produces: exits 1 with JSON block on stdout for blocked paths; exits 0 for allowed paths

- [X] [T-002-A] Insert Guard 4 block in `.claude/hooks/pre-tool-use.sh`. The insertion point is between the Guard 3 closing `fi` (line 465) and the Guard 2 comment header (line 467). Use Edit with:

`old_string`:
```
  unset _G3_PRE _G3_HIT _G3_IDS
fi

# ── Guard 2: Duplicate file creation ──────────────────────────────────────
```

`new_string`:
```
  unset _G3_PRE _G3_HIT _G3_IDS
fi

# ── Guard 4 — block Read on graphify-out/ and node_modules/ (BUG-017) ─────────────────────
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
    # Debug: set CC_GUARD4_DEBUG=1 to log fail-open events to stderr for diagnostics.
    if [ -n "${CC_GUARD4_DEBUG:-}" ] && [ "$_g4_result" != "OK" ]; then
        printf '[Guard 4 debug] fail-open: _g4_result="%s"\n' "$_g4_result" >&2
    fi
fi

# ── Guard 2: Duplicate file creation ──────────────────────────────────────
```

- [X] [T-002-B] Run `npm test` and confirm 17 guard4 tests now pass, other tests unchanged:

```
npm test
```

Expected: summary shows all guard4 tests pass; total count increases by 17; `2 skipped` unchanged; exit 0.

---

### Task 3: Mirror Guard 4 to `project-template/.claude/hooks/pre-tool-use.sh`

**Files:**
- Modify: `project-template/.claude/hooks/pre-tool-use.sh`

- [X] [T-003-A] Confirm the project-template hook has the same Guard 3 / Guard 2 boundary. Read lines 460–470 of `project-template/.claude/hooks/pre-tool-use.sh` with `limit: 15, offset: 459`.

- [X] [T-003-B] Apply the identical Guard 4 block insertion to `project-template/.claude/hooks/pre-tool-use.sh` using the same `old_string` / `new_string` from T-002-A.

- [X] [T-003-C] Commit guard and tests together:

```bash
git add -f .claude/hooks/pre-tool-use.sh
git add -f docs/superpowers/plans/2026-06-22-bug017-graphify-read-guard.md
git add project-template/.claude/hooks/pre-tool-use.sh
git add tests/hooks/guard4.test.js
git commit -m "fix(BUG-017): add Guard 4 Read blocker for graphify-out/ and node_modules/"
```

Expected: pre-commit hook fires, `npm test` passes (17 new tests + existing), commit succeeds.

---

### Task 4: Fix `install.sh` — root sentinel, parent-dir warning, idempotency

**Files:**
- Modify: `install.sh`

The project install block starts at line 1067. Three surgical changes:

**Change A — Root sentinel** (insert after `mkdir -p "${PROJ_DIR}/commands"...` line, line 1073):

- [X] [T-004-A] Insert root sentinel using Edit:

`old_string`:
```
  PROJ_DIR=".claude"
  mkdir -p "${PROJ_DIR}/commands" "${PROJ_DIR}/hooks" "${PROJ_DIR}/memory"

  download "project-template/CLAUDE.md"
```

`new_string`:
```
  PROJ_DIR=".claude"
  mkdir -p "${PROJ_DIR}/commands" "${PROJ_DIR}/hooks" "${PROJ_DIR}/memory"

  if [ ! -f "CLAUDE.md" ]; then
      echo "Error: install.sh must be run from the repository root (CLAUDE.md not found)." >&2
      exit 1
  fi

  # Parent-directory warning: Guard 4 blocks absolute Read paths if repo is cloned inside
  # a directory named graphify-out or node_modules. Non-fatal — install proceeds.
  _oifs="$IFS"; IFS='/'
  for _component in $PWD; do
      case "$_component" in
          graphify-out|node_modules)
              echo "Warning: repository is cloned inside a directory named '$_component'. Guard 4 may produce false positives on absolute Read paths. See README for details." >&2
              break
              ;;
      esac
  done
  IFS="$_oifs"; unset _component _oifs

  download "project-template/CLAUDE.md"
```

**Change B — Idempotency for pre-tool-use.sh download** (line 1083):

- [X] [T-004-B] Change the hook download call to use `false` as 3rd arg (skip if file exists). Use Edit:

`old_string`:
```
  download "project-template/.claude/hooks/pre-tool-use.sh"  "${PROJ_DIR}/hooks/pre-tool-use.sh"
  download "project-template/.claude/hooks/post-compact.sh"  "${PROJ_DIR}/hooks/post-compact.sh"

  chmod +x "${PROJ_DIR}/hooks/pre-tool-use.sh" "${PROJ_DIR}/hooks/post-compact.sh"
```

`new_string`:
```
  # To reset hook to GitHub upstream: delete .claude/hooks/pre-tool-use.sh, then re-run.
  download "project-template/.claude/hooks/pre-tool-use.sh"  "${PROJ_DIR}/hooks/pre-tool-use.sh" false
  download "project-template/.claude/hooks/post-compact.sh"  "${PROJ_DIR}/hooks/post-compact.sh"

  chmod +x "${PROJ_DIR}/hooks/pre-tool-use.sh" "${PROJ_DIR}/hooks/post-compact.sh"
```

Note: `chmod +x` stays outside the download guard — it applies the execute bit whether the file was just downloaded or pre-existed (the `download` function with `false` skips the download but the chmod still runs on the existing file).

- [X] [T-004-C] Commit install.sh changes:

```bash
git add install.sh
git commit -m "fix(BUG-017): idempotent hook install + root sentinel in install.sh"
```

Expected: pre-commit fires, npm test passes, commit succeeds.

---

### Task 5: Fix `install.ps1` — root sentinel, parent-dir warning, idempotency

**Files:**
- Modify: `install.ps1`

The project block starts at line 420 (`if ($Project)`). Three surgical changes matching install.sh logic.

**Change A — Root sentinel + parent-dir warning** (insert after `foreach ($sub in ...) { New-Item ... }` block, before the `Save-RemoteFile "project-template/CLAUDE.md"` call):

- [X] [T-005-A] Insert root sentinel and parent-dir warning using Edit:

`old_string`:
```
  $projDir = ".claude"
  foreach ($sub in "commands", "hooks", "memory") {
    New-Item -ItemType Directory -Path "$projDir\$sub" -Force | Out-Null
  }

  Save-RemoteFile "project-template/CLAUDE.md"
```

`new_string`:
```
  $projDir = ".claude"
  foreach ($sub in "commands", "hooks", "memory") {
    New-Item -ItemType Directory -Path "$projDir\$sub" -Force | Out-Null
  }

  if (-not (Test-Path "CLAUDE.md")) {
      Write-Host -ForegroundColor Red "Error: install.ps1 must be run from the repository root (CLAUDE.md not found)."
      exit 1
  }

  # Parent-directory warning: Guard 4 blocks absolute Read paths if repo is cloned inside
  # a directory named graphify-out or node_modules. Non-fatal -- install proceeds.
  $pwdParts = ($pwd.Path -split '[/\\]') | Where-Object { $_ -ne '' }
  foreach ($part in $pwdParts) {
      if ($part -eq 'graphify-out' -or $part -eq 'node_modules') {
          Write-Host "Warning: repository is cloned inside a directory named '$part'. Guard 4 may produce false positives on absolute Read paths. See README for details." -ForegroundColor Yellow
          break
      }
  }
  Remove-Variable -Name pwdParts, part -ErrorAction SilentlyContinue

  Save-RemoteFile "project-template/CLAUDE.md"
```

**Change B — Idempotency for pre-tool-use.sh download** (line 438):

- [X] [T-005-B] Change download call to pass `$false` as overwrite arg. Use Edit:

`old_string`:
```
  Save-RemoteFile "project-template/.claude/hooks/pre-tool-use.sh"  "$projDir\hooks\pre-tool-use.sh"
  Save-RemoteFile "project-template/.claude/hooks/post-compact.sh"  "$projDir\hooks\post-compact.sh"
```

`new_string`:
```
  # To reset hook to GitHub upstream: delete .claude\hooks\pre-tool-use.sh, then re-run.
  Save-RemoteFile "project-template/.claude/hooks/pre-tool-use.sh"  "$projDir\hooks\pre-tool-use.sh" $false
  Save-RemoteFile "project-template/.claude/hooks/post-compact.sh"  "$projDir\hooks\post-compact.sh"
```

Note: `Save-RemoteFile` already has `if (-not $Overwrite -and (Test-Path $Dest)) { Write-Info "Skipped"; return }` — the `$false` arg activates that guard.

- [X] [T-005-C] Commit install.ps1 changes:

```bash
git add install.ps1
git commit -m "fix(BUG-017): idempotent hook install + root sentinel in install.ps1"
```

Expected: pre-commit fires, npm test passes, commit succeeds.

---

### Task 6: Update CLAUDE.md Session Initialization (both files)

**Files:**
- Modify: `CLAUDE.md` (lines 35–37)
- Modify: `project-template/CLAUDE.md` (lines 35–37)

Both files currently have:
```
## Session Initialization
- At session start: verify project.md and graphify-out/graph.json exist; run /cc-init if absent.
- Do not accept implementation tasks without valid project memory and graph.
```

Replace with (word-for-word identical in both):
```
## Session Initialization
- At session start: use **Glob** (NEVER use Read) to check that `project.md` and
  `graphify-out/graph.json` exist; run `/cc-init` if absent.
- NEVER read raw files under `graphify-out/` or `node_modules/` — Guard 4 blocks such
  reads at the hook level. For graph queries, invoke the graphify skill:
  `/graphify query "<question>"`.
- Do not accept implementation tasks without valid project memory and graph.
```

- [X] [T-006-A] Edit `CLAUDE.md` Session Initialization section:

`old_string`:
```
## Session Initialization
- At session start: verify project.md and graphify-out/graph.json exist; run /cc-init if absent.
- Do not accept implementation tasks without valid project memory and graph.
```

`new_string`:
```
## Session Initialization
- At session start: use **Glob** (NEVER use Read) to check that `project.md` and
  `graphify-out/graph.json` exist; run `/cc-init` if absent.
- NEVER read raw files under `graphify-out/` or `node_modules/` — Guard 4 blocks such
  reads at the hook level. For graph queries, invoke the graphify skill:
  `/graphify query "<question>"`.
- Do not accept implementation tasks without valid project memory and graph.
```

- [X] [T-006-B] Apply identical edit to `project-template/CLAUDE.md` using the same `old_string` and `new_string`.

- [X] [T-006-C] Commit CLAUDE.md changes:

```bash
git add -f CLAUDE.md
git add project-template/CLAUDE.md
git commit -m "fix(BUG-017): restrict Session Init to Glob-only; ban Read on graphify-out/"
```

---

### Task 7: Update CONTRIBUTING.md and README.md

**Files:**
- Modify: `CONTRIBUTING.md` (after `### Manual Validation Protocol`, before closing `---`)
- Modify: `README.md` (after `### Update` section, before `---`)

- [X] [T-007-A] Add propagation note subsection to `CONTRIBUTING.md`. Insert new `### Resetting the Pre-Commit Hook to Upstream` subsection immediately after the `### Manual Validation Protocol` checklist (after item 6), before the closing `---`:

`old_string`:
```
6. **Verify LF line endings in the written hook**: `node --input-type=commonjs -e "const f=require('fs').readFileSync('.git/hooks/pre-commit','utf8');if(f.includes('\r'))throw new Error('CRLF');console.log('LF only - OK')"` — a CRLF result means Git for Windows bash will fail to parse the shebang; re-run `install.ps1` to normalize.

---
```

`new_string`:
```
6. **Verify LF line endings in the written hook**: `node --input-type=commonjs -e "const f=require('fs').readFileSync('.git/hooks/pre-commit','utf8');if(f.includes('\r'))throw new Error('CRLF');console.log('LF only - OK')"` — a CRLF result means Git for Windows bash will fail to parse the shebang; re-run `install.ps1` to normalize.

### Resetting the Pre-Commit Hook to Upstream

The hook installer is idempotent: if `.claude/hooks/pre-tool-use.sh` already exists it will not be overwritten on re-runs. To reset the hook to the current GitHub upstream version, delete the local file and re-run the installer:

```bash
# macOS / Linux
rm .claude/hooks/pre-tool-use.sh
bash install.sh --project

# Windows (PowerShell)
Remove-Item .claude\hooks\pre-tool-use.sh
.\install.ps1 -Project
```

---
```

- [X] [T-007-B] Add parent-dir warning note to `README.md`. Insert after the `### Update` section content, before the closing `---`:

`old_string`:
```
### Update

Re-run the same install command. User-configured files are never overwritten; agent-managed files are always updated.

---
```

`new_string`:
```
### Update

Re-run the same install command. User-configured files are never overwritten; agent-managed files are always updated.

> **Note:** Do not clone this repository into a parent directory named `graphify-out` or `node_modules`. Guard 4 checks path components and will block agent `Read` calls on source files if the repository root is nested inside such a directory. Use relative paths if this layout is unavoidable.

---
```

- [X] [T-007-C] Commit docs:

```bash
git add CONTRIBUTING.md README.md
git commit -m "docs(BUG-017): document hook reset procedure and parent-dir constraint"
```

---

### Task 8: Bump version, update CHANGELOG, mark BACKLOG

**Files:**
- Modify: `VERSION`
- Modify: `package.json`
- Modify: `CHANGELOG.md`
- Modify: `AGENT-READABLE BACKLOG.md`

- [X] [T-008-A] Update `VERSION` from `1.12.0` to `1.13.0`:

`old_string`: `1.12.0`
`new_string`: `1.13.0`

- [X] [T-008-B] Add `"version"` field to `package.json` (field is currently absent):

`old_string`:
```
{
  "private": true,
  "type": "module",
```

`new_string`:
```
{
  "private": true,
  "version": "1.13.0",
  "type": "module",
```

- [X] [T-008-C] Prepend `[1.13.0]` entry to `CHANGELOG.md`. Insert before the existing `## [1.12.0]` block:

`old_string`:
```
# Changelog


## [1.12.0] - 2026-06-22
```

`new_string`:
```
# Changelog


## [1.13.0] - 2026-06-22

### Added
- `[BUG-017]` Guard 4 in `.claude/hooks/pre-tool-use.sh` and `project-template/.claude/hooks/pre-tool-use.sh` — blocks `Read` tool on paths containing `graphify-out` or `node_modules` as exact path components; python3 component-match with normpath traversal fix; fail-open on python3 absence
- `[BUG-017]` `tests/hooks/guard4.test.js` — 17 Vitest tests covering blocked paths, case variants, traversal escape, fail-open scenarios, and non-Read tool skip

### Changed
- `[BUG-017]` `install.sh` / `install.ps1` — hook download is now idempotent (skips if `.claude/hooks/pre-tool-use.sh` already exists); added repository-root sentinel guard and parent-directory warning
- `[BUG-017]` `CLAUDE.md` / `project-template/CLAUDE.md` — Session Initialization mandates `Glob` (NEVER `Read`) for existence checks; explicit Guard 4 constraint documented


## [1.12.0] - 2026-06-22
```

- [X] [T-008-D] Mark BUG-017 as complete in `AGENT-READABLE BACKLOG.md`. Use Grep first to confirm uniqueness:

```
Grep pattern: \[ \] `\[BUG-017\]`
path: AGENT-READABLE BACKLOG.md
```

Expected count: 1. Then Edit:

`old_string`: `### [ ] \`[BUG-017]\` Graphify Initialization Bloat (AST Graph Overload)`
`new_string`: `### [X] \`[BUG-017]\` Graphify Initialization Bloat (AST Graph Overload)`

- [X] [T-008-E] Run `npm test` one final time to confirm all tests still pass before the release commit:

```
npm test
```

Expected: `X passed | 2 skipped`, exit 0.

- [X] [T-008-F] Commit version bump and backlog:

```bash
git add VERSION package.json CHANGELOG.md "AGENT-READABLE BACKLOG.md"
git commit -m "chore(BUG-017): bump to v1.13.0; mark BUG-017 complete"
```

---

## Test List

- [x] 17 unit tests in `tests/hooks/guard4.test.js` — Guard 4 path blocking, traversal, fail-open, tool-name skip
- [x] Existing 126 tests remain green (no regressions)
- [ ] Manual AC checklist (run after all commits):
  - `npm test` — `X passed | 2 skipped` on Linux/Mac; guard4 suite skipped on Windows without Git Bash
  - `bash .claude/hooks/pre-tool-use.sh` with `CLAUDE_TOOL_NAME=Read CLAUDE_TOOL_INPUT='{"file_path":"graphify-out/graph.json"}'` → exit 1, JSON block on stdout
  - `bash .claude/hooks/pre-tool-use.sh` with `CLAUDE_TOOL_NAME=Read CLAUDE_TOOL_INPUT='{"file_path":"src/index.js"}'` → exit 0
  - Re-run `bash install.sh --project` → pre-tool-use.sh NOT overwritten (idempotent)

## Commit Order

| Commit | Tasks | Message |
|--------|-------|---------|
| 1 | T-001 + T-002 + T-003 | `fix(BUG-017): add Guard 4 Read blocker for graphify-out/ and node_modules/` |
| 2 | T-004 | `fix(BUG-017): idempotent hook install + root sentinel in install.sh` |
| 3 | T-005 | `fix(BUG-017): idempotent hook install + root sentinel in install.ps1` |
| 4 | T-006 | `fix(BUG-017): restrict Session Init to Glob-only; ban Read on graphify-out/` |
| 5 | T-007 | `docs(BUG-017): document hook reset procedure and parent-dir constraint` |
| 6 | T-008 | `chore(BUG-017): bump to v1.13.0; mark BUG-017 complete` |

## Identified Risks

1. **project-template hook line drift** — if `project-template/.claude/hooks/pre-tool-use.sh` has diverged from the live hook, the `old_string` in T-003-B may not match. Mitigation: T-003-A reads lines 460–470 first to verify boundary.

2. **Guard 4 stdout vs stderr** — the block message uses `echo` (stdout). Tests assert on `r.stdout`. Do NOT change to `>&2` — Claude Code reads hook stdout as the block reason.

3. **`set -euo pipefail` + IFS modification in install.sh** — resetting `IFS` back via `_oifs` and `unset` prevents leaking modified IFS into downstream commands under `set -u`.

4. **CONTRIBUTING.md triple-backtick fence** — the new subsection contains a fenced code block. The `old_string` ends at `---` which must be unique in the file; verify with Grep before Edit.

5. **package.json has no existing `"version"` field** — T-008-B adds it fresh; there's no risk of duplicate. The `"private": true` line is unique in the file, making the `old_string` safe.
