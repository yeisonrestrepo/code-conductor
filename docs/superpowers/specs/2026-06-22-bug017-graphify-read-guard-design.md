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
- **Unrelated file with similar name:** `src/utils/graphify-out-helper.js` — component is
  `graphify-out-helper.js`, not `graphify-out`; passes through.
- **Non-Read tool with graphify-out path** (e.g., Bash): Guard 4 only fires on
  `CLAUDE_TOOL_NAME == "Read"`; other tools unaffected.

### Error cases

- **python3 absent:** `2>/dev/null` suppresses the error; `_g4_result` is empty (neither
  `"BLOCK"`); guard skips — fail-open. Hook does not crash.
- **Malformed JSON input:** python3 raises `json.JSONDecodeError`; `2>/dev/null` suppresses;
  same fail-open path.
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
    _g4_result=$(python3 -c "
import json, sys
d = json.load(sys.stdin)
fp = d.get('file_path', '')
parts = [p for p in fp.replace('\\\\', '/').split('/') if p]
blocked = {'graphify-out', 'node_modules'}
print('BLOCK' if any(p in blocked for p in parts) else 'OK')
" <<< "$CLAUDE_TOOL_INPUT" 2>/dev/null)
    if [ "$_g4_result" = "BLOCK" ]; then
        echo '{"decision":"block","reason":"Guard 4: direct reads of graphify-out/ and node_modules/ are forbidden. Use Glob for existence checks or the graphify skill: /graphify query \"<question>\"."}'
        exit 1
    fi
fi
```

### Installer idempotency — `install.sh`

Locate the hook download step. Wrap in existence check; ensure directory creation runs first:

```bash
mkdir -p ".claude/hooks"
# To reset hook to GitHub upstream: delete .claude/hooks/pre-tool-use.sh, then re-run.
if [ ! -f ".claude/hooks/pre-tool-use.sh" ]; then
    curl -fsSL "$BASE_URL/pre-tool-use.sh" -o ".claude/hooks/pre-tool-use.sh"
fi
```

Audit all subsequent installer steps for any `project-template` copy that targets
`.claude/hooks/pre-tool-use.sh`; wrap each with the same `[ ! -f ]` guard.

### Installer idempotency — `install.ps1`

```powershell
New-Item -ItemType Directory -Force ".claude\hooks" | Out-Null
# To reset hook to GitHub upstream: delete .claude\hooks\pre-tool-use.sh, then re-run.
if (-not (Test-Path ".claude\hooks\pre-tool-use.sh")) {
    Invoke-WebRequest -Uri "$BaseUrl/pre-tool-use.sh" -OutFile ".claude\hooks\pre-tool-use.sh"
}
```

Same audit for any subsequent project-template copy steps.

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
Resolve bash path once at setup for the fail-open test:

```js
const BASH_PATH = spawnSync('which', ['bash'], { encoding: 'utf8' }).stdout.trim() || '/bin/bash'
```

All exit-1 assertions use `JSON.parse(result.stderr.trim())` and verify
`payload.decision === 'block'` and `payload.reason` matches `/Guard 4/`.

**~10 test cases:**

| `file_path` input | `PATH` | `CLAUDE_TOOL_NAME` | Expected |
|---|---|---|---|
| `graphify-out/graph.json` | normal | `Read` | exit 1, JSON block |
| `graphify-out/cache/ast/abc.json` | normal | `Read` | exit 1, JSON block |
| `node_modules/vitest/dist/index.js` | normal | `Read` | exit 1, JSON block |
| `/abs/path/graphify-out/file.json` | normal | `Read` | exit 1, JSON block |
| `graphify-out\cache\file.json` (backslash) | normal | `Read` | exit 1, JSON block |
| `graphify-out-backup/file.json` | normal | `Read` | exit 0 |
| `src/utils/graphify-out-helper.js` | normal | `Read` | exit 0 |
| `src/index.js` | normal | `Read` | exit 0 |
| `graphify-out/graph.json` | `""` (no python3) | `Read` | exit 0 (fail-open), uses `BASH_PATH` |
| `graphify-out/graph.json` | normal | `Bash` | exit 0 (Guard 4 skipped) |

---

## Acceptance Criteria

- [ ] `Read` on any `graphify-out/**` path → hook exits 1; `JSON.parse(stderr.trim())` succeeds; `decision === "block"`, `reason` matches `Guard 4`
- [ ] `Read` on any `node_modules/**` path → same block behavior
- [ ] `Read` on `src/utils/graphify-out-helper.js` → exits 0 (no false positive)
- [ ] python3 absent → hook exits 0 (fail-open, no crash)
- [ ] `.claude/hooks/pre-tool-use.sh` NOT overwritten when file already exists on `install.sh` / `install.ps1 -Project` re-run
- [ ] `project-template/.claude/hooks/pre-tool-use.sh` copy step has same idempotency guard
- [ ] Session Init text in both `CLAUDE.md` files is word-for-word identical and contains `**Glob**`, `NEVER`, `/graphify query`
- [ ] All ~10 `guard4.test.js` tests pass; pre-commit gate (`npm test`) stays fully green before any commit lands
- [ ] `graphify-out/` confirmed present in `.gitignore` (already satisfied — no change needed)
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
- `tests/hooks/guard4.test.js` — new file (~60 lines)
- `AGENT-READABLE BACKLOG.md` — BUG-017 `[ ]` → `[X]`
- `VERSION` — 1.12.0 → 1.13.0
- `CHANGELOG.md` — `[1.13.0]` entry referencing `[BUG-017]`

### Files Requiring Full Read (deferred to /cc-plan)

- `install.sh` — need full read to locate exact hook download line and any project-template copy steps
- `install.ps1` — same
- `.claude/hooks/pre-tool-use.sh` — need to identify Guard 3 end-line for Guard 4 insertion point

---

## Complexity Estimate

**S** — All changes are additive and surgical; no new dependencies; existing test harness handles new test file automatically.
