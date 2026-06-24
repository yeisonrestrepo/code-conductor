# FEAT-007 Context Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a turn-counter hook (`context-guard.sh` / `context-guard.ps1`) that fires on every `UserPromptSubmit`, increments `.claude/memory/turn-count.txt` atomically, emits configurable threshold warnings, and resets automatically on `PostCompact`.

**Architecture:** Two new hook scripts (Unix + Windows) wire into `UserPromptSubmit` via the same upward-walk dispatcher pattern as `verbosity-remind`. A rewritten `post-compact.sh` and a new `post-compact.ps1` atomically reset the counter. The installer (`install.sh` / `install.ps1`) copies all hook files, applies `chmod +x`, patches `settings.json` via `node -e`, and idempotently appends eol rules to `.gitattributes`.

**Tech Stack:** bash 3.2+, PowerShell 5.1+, Node.js ≥ v16 (for settings.json patching), Vitest (tests).

## Global Constraints

- No jq — all `settings.json` manipulation via `node -e` inline scripts.
- No `set -e` / `set -u` / `set -o pipefail` in hook scripts (fail-open contract).
- Temp files must reside in same directory as target (EXDEV prevention).
- Exact `command` string equality for `appendIfAbsent` idempotency (not substring).
- PS 5.1: closing `'@` of all `@'...'@` here-strings at column 0, no leading whitespace.
- PS 5.1: no `??` null-coalescing operator — use `if ($env:X) { $env:X } else { '.' }`.
- Vitest: real filesystem, `mkdtempSync` per test, `CC_PROJECT_ROOT` per-spawn (not global mutation).

---

### Task 1 (T-001): Create `context-guard.sh`

**Files:**
- Create: `.claude/hooks/context-guard.sh`
- Create: `project-template/.claude/hooks/context-guard.sh` (identical copy)

**Interfaces:**
- Consumes: `CC_PROJECT_ROOT` env var (set by dispatcher; defaults to `.`)
- Consumes: `.claude/memory/context-threshold.txt` (positive integer, fallback 25)
- Consumes: `.claude/memory/turn-count.txt` (non-negative integer, fallback 0)
- Produces: stdout warning message (⚠ or 🚨) when count reaches threshold
- Produces: updated `.claude/memory/turn-count.txt` (atomic rename)
- Produces: stderr debug line when `CC_GUARD_DEBUG=1`

- [ ] **T-001-1: Write `.claude/hooks/context-guard.sh`**

```bash
#!/usr/bin/env bash
set +e
main() {
  _mem="${CC_PROJECT_ROOT:-.}/.claude/memory"
  if [ -e "$_mem" ] && [ ! -d "$_mem" ]; then exit 0; fi
  mkdir -p "$_mem" 2>/dev/null || exit 0

  # Read threshold
  _thresh=""
  IFS= read -r _thresh < "${_mem}/context-threshold.txt" 2>/dev/null || _thresh=""
  _thresh="${_thresh%$'\r'}"
  _thresh="${_thresh#$'\xef\xbb\xbf'}"
  [[ "$_thresh" =~ ^[1-9][0-9]*$ ]] || _thresh=25
  critical=$_thresh
  warning=$(( (critical * 80) / 100 ))

  # Read count
  _c=""
  IFS= read -r _c < "${_mem}/turn-count.txt" 2>/dev/null || _c=""
  _c="${_c%$'\r'}"
  _c="${_c#$'\xef\xbb\xbf'}"
  [[ "$_c" =~ ^[0-9]+$ ]] || _c=0
  count=$_c

  new_count=$(( count < 99999 ? count + 1 : 99999 ))

  _target="${_mem}/turn-count.txt"
  _tmp="${_mem}/turn-count.txt.tmp"
  printf '%d\n' "$new_count" > "$_tmp" && mv -f "$_tmp" "$_target" \
    || { rm -f "$_tmp" 2>/dev/null; exit 0; }

  [ -n "${CC_GUARD_DEBUG:-}" ] && printf '[context-guard] root=%s count=%d critical=%d warning=%d\n' \
    "${CC_PROJECT_ROOT:-.}" "$new_count" "$critical" "$warning" >&2

  if [ "$new_count" -ge 99999 ]; then
    printf '🚨 CONTEXT CRITICAL: Turn 99999/%d (counter saturated) — run /cc-compact NOW.\n' "$critical"
  elif [ "$new_count" -ge "$critical" ]; then
    printf '🚨 CONTEXT CRITICAL: Turn %d/%d — run /cc-compact NOW before context overflows.\n' "$new_count" "$critical"
  elif [ "$warning" -gt 0 ] && [ "$new_count" -ge "$warning" ]; then
    printf '⚠ CONTEXT WARNING: Turn %d/%d — consider running /cc-compact soon.\n' "$new_count" "$critical"
  fi
}
main || exit 0
```

- [ ] **T-001-2: Copy to project-template**

```bash
cp .claude/hooks/context-guard.sh project-template/.claude/hooks/context-guard.sh
```

- [ ] **T-001-3: Set execute bit on both**

```bash
chmod +x .claude/hooks/context-guard.sh
chmod +x project-template/.claude/hooks/context-guard.sh
```

- [ ] **T-001-4: Verify syntax**

```bash
bash -n .claude/hooks/context-guard.sh && echo PASS
```

Expected: `PASS`

- [ ] **T-001-5: Commit**

```bash
git add -f .claude/hooks/context-guard.sh project-template/.claude/hooks/context-guard.sh
git commit -m "feat(FEAT-007): add context-guard.sh hook (Unix turn counter)"
```

---

### Task 2 (T-002): Create `context-guard.ps1`

**Files:**
- Create: `.claude/hooks/context-guard.ps1`
- Create: `project-template/.claude/hooks/context-guard.ps1` (identical copy)

**Interfaces:**
- Consumes: `$env:CC_PROJECT_ROOT` (defaults to `.`)
- Consumes: `.claude\memory\context-threshold.txt`
- Consumes: `.claude\memory\turn-count.txt`
- Produces: stdout warning string, updated `turn-count.txt`

- [ ] **T-002-1: Write `.claude/hooks/context-guard.ps1`**

```powershell
try {
  $root = if ($env:CC_PROJECT_ROOT) { $env:CC_PROJECT_ROOT } else { '.' }
  $mem  = Join-Path $root '.claude\memory'
  if ((Test-Path $mem) -and -not (Test-Path $mem -PathType Container)) { exit 0 }
  New-Item -ItemType Directory -Force $mem -ErrorAction SilentlyContinue | Out-Null
  if (-not (Test-Path $mem -PathType Container)) { exit 0 }

  $critical = 25
  $threshFile = Join-Path $mem 'context-threshold.txt'
  try {
    $raw = [System.IO.File]::ReadAllText($threshFile, [System.Text.Encoding]::UTF8)
    $val = $raw.Split("`n")[0].TrimEnd("`r").Trim()
    if ($val -match '^[1-9][0-9]*$') { $critical = [int]$val }
  } catch { }

  $count = 0
  $countFile = Join-Path $mem 'turn-count.txt'
  try {
    $raw = [System.IO.File]::ReadAllText($countFile, [System.Text.Encoding]::UTF8)
    $val = $raw.Split("`n")[0].TrimEnd("`r").Trim()
    if ($val -match '^[0-9]+$') { $count = [int]$val }
  } catch { }

  $warning  = [Math]::Truncate($critical * 80 / 100)
  $newCount = [Math]::Min($count + 1, 99999)

  $target = Join-Path $mem 'turn-count.txt'
  $tmp    = Join-Path $mem 'turn-count.txt.tmp'
  $enc    = [System.Text.UTF8Encoding]::new($false)
  [System.IO.File]::WriteAllText($tmp, "$newCount`n", $enc)
  try {
    [System.IO.File]::Replace($tmp, $target, $null)
  } catch [System.IO.FileNotFoundException] {
    try {
      [System.IO.File]::Move($tmp, $target)
    } catch {
      Remove-Item $tmp -Force -ErrorAction SilentlyContinue
      exit 0
    }
  }

  if ($env:CC_GUARD_DEBUG) {
    Write-Host "[context-guard] root=$root count=$newCount critical=$critical warning=$warning"
  }

  if ($newCount -ge 99999) {
    "🚨 CONTEXT CRITICAL: Turn 99999/$critical (counter saturated) — run /cc-compact NOW."
  } elseif ($newCount -ge $critical) {
    "🚨 CONTEXT CRITICAL: Turn $newCount/$critical — run /cc-compact NOW before context overflows."
  } elseif ($warning -gt 0 -and $newCount -ge $warning) {
    "⚠ CONTEXT WARNING: Turn $newCount/$critical — consider running /cc-compact soon."
  }
} catch {
  exit 0
}
```

- [ ] **T-002-2: Copy to project-template**

```bash
cp .claude/hooks/context-guard.ps1 project-template/.claude/hooks/context-guard.ps1
```

- [ ] **T-002-3: Commit**

```bash
git add -f .claude/hooks/context-guard.ps1 project-template/.claude/hooks/context-guard.ps1
git commit -m "feat(FEAT-007): add context-guard.ps1 hook (Windows turn counter)"
```

---

### Task 3 (T-003): Rewrite `post-compact.sh` with atomic counter reset

**Files:**
- Modify: `.claude/hooks/post-compact.sh`
- Modify: `project-template/.claude/hooks/post-compact.sh` (identical)

**Interfaces:**
- Consumes: `CC_PROJECT_ROOT` env var (optional; `.` fallback)
- Produces: resets `.claude/memory/turn-count.txt` to `0\n` atomically
- Produces: stdout reminder message (preserved from original)

- [ ] **T-003-1: Rewrite `.claude/hooks/post-compact.sh`**

```bash
#!/usr/bin/env bash
set +e
main() {
  _mem="${CC_PROJECT_ROOT:-.}/.claude/memory"
  if [ -e "$_mem" ] && [ ! -d "$_mem" ]; then exit 0; fi
  mkdir -p "$_mem" 2>/dev/null || exit 0

  _target="${_mem}/turn-count.txt"
  _tmp="${_mem}/turn-count.txt.tmp"
  printf '0\n' > "$_tmp" && mv -f "$_tmp" "$_target" \
    || { rm -f "$_tmp" 2>/dev/null; exit 0; }

  echo ""
  echo "📦 Conversation compacted. Context counter reset to 0."

  _mem_file="${CC_PROJECT_ROOT:-.}/.claude/memory/project.md"
  if [ -f "$_mem_file" ]; then
    _last=$(grep "## Checkpoint" "$_mem_file" | tail -1 || true)
    [ -n "$_last" ] && echo "   Last checkpoint: $_last" \
      || echo "   No checkpoints recorded yet in project.md."
  else
    echo "   No project.md found."
  fi

  echo ""
  echo "   💡 If this session had important decisions, run /checkpoint before continuing."
  echo ""
}
main || exit 0
```

- [ ] **T-003-2: Copy to project-template**

```bash
cp .claude/hooks/post-compact.sh project-template/.claude/hooks/post-compact.sh
```

- [ ] **T-003-3: Set execute bit**

```bash
chmod +x .claude/hooks/post-compact.sh
chmod +x project-template/.claude/hooks/post-compact.sh
```

- [ ] **T-003-4: Verify syntax**

```bash
bash -n .claude/hooks/post-compact.sh && echo PASS
```

Expected: `PASS`

- [ ] **T-003-5: Commit**

```bash
git add -f .claude/hooks/post-compact.sh project-template/.claude/hooks/post-compact.sh
git commit -m "feat(FEAT-007): rewrite post-compact.sh with atomic counter reset"
```

---

### Task 4 (T-004): Create `post-compact.ps1`

**Files:**
- Create: `.claude/hooks/post-compact.ps1`
- Create: `project-template/.claude/hooks/post-compact.ps1` (identical)

**Interfaces:**
- Consumes: `$env:CC_PROJECT_ROOT`
- Produces: resets `turn-count.txt` to `0\n`; stdout reset confirmation

- [ ] **T-004-1: Write `.claude/hooks/post-compact.ps1`**

```powershell
try {
  $root = if ($env:CC_PROJECT_ROOT) { $env:CC_PROJECT_ROOT } else { '.' }
  $mem  = Join-Path $root '.claude\memory'
  if ((Test-Path $mem) -and -not (Test-Path $mem -PathType Container)) { exit 0 }
  New-Item -ItemType Directory -Force $mem -ErrorAction SilentlyContinue | Out-Null
  if (-not (Test-Path $mem -PathType Container)) { exit 0 }

  $target = Join-Path $mem 'turn-count.txt'
  $tmp    = Join-Path $mem 'turn-count.txt.tmp'
  $enc    = [System.Text.UTF8Encoding]::new($false)
  [System.IO.File]::WriteAllText($tmp, "0`n", $enc)
  try {
    [System.IO.File]::Replace($tmp, $target, $null)
  } catch [System.IO.FileNotFoundException] {
    try {
      [System.IO.File]::Move($tmp, $target)
    } catch {
      Remove-Item $tmp -Force -ErrorAction SilentlyContinue
      exit 0
    }
  }

  ""
  "📦 Conversation compacted. Context counter reset to 0."
  $projMd = Join-Path $root '.claude\memory\project.md'
  if (Test-Path $projMd) {
    $lastMatch = Select-String '## Checkpoint' $projMd | Select-Object -Last 1
    if ($lastMatch) { "   Last checkpoint: $($lastMatch.Line)" } else { "   No checkpoints recorded yet in project.md." }
  } else { "   No project.md found." }
  ""
  "   💡 If this session had important decisions, run /checkpoint before continuing."
  ""
} catch {
  exit 0
}
```

- [ ] **T-004-2: Copy to project-template**

```bash
cp .claude/hooks/post-compact.ps1 project-template/.claude/hooks/post-compact.ps1
```

- [ ] **T-004-3: Commit**

```bash
git add -f .claude/hooks/post-compact.ps1 project-template/.claude/hooks/post-compact.ps1
git commit -m "feat(FEAT-007): add post-compact.ps1 (Windows PostCompact counter reset)"
```

---

### Task 5 (T-005): Update project-template assets

**Files:**
- Modify: `project-template/.claude/settings.json`
- Create: `project-template/.claude/memory/context-threshold.txt`
- Create: `project-template/.gitignore`

**Interfaces:**
- Produces: pre-committed settings.json with context-guard hook entries for downstream project installs

- [ ] **T-005-1: Add context-guard entries to `project-template/.claude/settings.json`**

Add two entries to `UserPromptSubmit[0].hooks` and one to `PostCompact[0].hooks`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit|create_file|write_file",
        "hooks": [
          {
            "type": "command",
            "command": "bash -c 'h=\".claude/hooks/pre-tool-use.sh\"; [ -f \"$h\" ] && bash \"$h\" || { echo \"⚠ Hook missing — run /cc-init to repair\"; exit 0; }'"
          }
        ]
      }
    ],
    "PostCompact": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash -c 'h=\".claude/hooks/post-compact.sh\"; [ -f \"$h\" ] && bash \"$h\" || exit 0'"
          },
          {
            "type": "command",
            "command": "powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \".claude/hooks/post-compact.ps1\""
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "bash -c 'set +e; _dir=\"${PWD:-}\"; _prev=\"\"; _iters=0; while [ \"$_dir\" != \"$_prev\" ] && [ \"$_iters\" -lt 40 ]; do _h=\"$_dir/.claude/hooks/verbosity-remind.sh\"; [ -f \"$_h\" ] && [ -r \"$_h\" ] && { bash \"$_h\"; exit $?; }; _prev=\"$_dir\"; _dir=\"${_dir%/*}\"; [ -z \"$_dir\" ] && _dir=/; _iters=$((_iters+1)); done; exit 0'"
          },
          {
            "type": "command",
            "command": "bash -c 'set +e; _dir=\"${PWD:-}\"; _prev=\"\"; _i=0; while [ \"$_dir\" != \"$_prev\" ] && [ \"$_i\" -lt 40 ]; do _h=\"$_dir/.claude/hooks/context-guard.sh\"; [ -f \"$_h\" ] && [ -r \"$_h\" ] && { CC_PROJECT_ROOT=\"$_dir\" bash \"$_h\"; exit $?; }; _prev=\"$_dir\"; _dir=\"${_dir%/*}\"; [ -z \"$_dir\" ] && _dir=/; _i=$((_i+1)); done; exit 0'"
          },
          {
            "type": "command",
            "command": "powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \".claude/hooks/context-guard.ps1\""
          }
        ]
      }
    ]
  },
  "permissions": {
    "allow": [],
    "deny": []
  }
}
```

- [ ] **T-005-2: Create `project-template/.claude/memory/context-threshold.txt`**

Write exactly `25\n` (UTF-8 no BOM, LF):

```bash
printf '25\n' > project-template/.claude/memory/context-threshold.txt
```

- [ ] **T-005-3: Create `project-template/.gitignore`**

```bash
printf '.claude/memory/turn-count.txt\n' > project-template/.gitignore
```

- [ ] **T-005-4: Verify threshold file**

```bash
xxd project-template/.claude/memory/context-threshold.txt
```

Expected: `00000000: 3235 0a` (bytes: `2`, `5`, `\n`, no BOM)

- [ ] **T-005-5: Commit**

```bash
git add -f "project-template/.claude/settings.json" \
           "project-template/.claude/memory/context-threshold.txt" \
           "project-template/.gitignore"
git commit -m "feat(FEAT-007): update project-template with context-guard hook entries and threshold"
```

---

### Task 6 (T-006): Update live `.claude/settings.json`

**Files:**
- Modify: `.claude/settings.json`

**Interfaces:**
- Consumes: current `.claude/settings.json` (must be parseable JSON object)
- Produces: idempotently adds 3 new hook entries (bash UPS dispatcher, PS UPS dispatcher, PS PostCompact)

- [ ] **T-006-1: Run `node -e` patch**

```bash
node -e "
const fs = require('fs');
const f  = '.claude/settings.json';
let obj  = {};
if (fs.existsSync(f)) {
  const raw = fs.readFileSync(f, 'utf8');
  try {
    const p = JSON.parse(raw);
    if (p !== null && typeof p === 'object' && !Array.isArray(p)) { obj = p; }
  } catch(e) {}
}
if (!obj.hooks) obj.hooks = {};
['UserPromptSubmit','PostCompact'].forEach(k => {
  if (!Array.isArray(obj.hooks[k])) obj.hooks[k] = [{ hooks: [] }];
  if (!obj.hooks[k][0]) obj.hooks[k][0] = { hooks: [] };
  if (!Array.isArray(obj.hooks[k][0].hooks)) obj.hooks[k][0].hooks = [];
});
function appendIfAbsent(arr, cmd) {
  if (!arr.some(h => h.command === cmd)) arr.push({ type: 'command', command: cmd });
}
const UPS_BASH = \"bash -c 'set +e; _dir=\\\"\\\${PWD:-}\\\"; _prev=\\\"\\\"; _i=0; while [ \\\"\\\$_dir\\\" != \\\"\\\$_prev\\\" ] && [ \\\"\\\$_i\\\" -lt 40 ]; do _h=\\\"\\\$_dir/.claude/hooks/context-guard.sh\\\"; [ -f \\\"\\\$_h\\\" ] && [ -r \\\"\\\$_h\\\" ] && { CC_PROJECT_ROOT=\\\"\\\$_dir\\\" bash \\\"\\\$_h\\\"; exit \\\$?; }; _prev=\\\"\\\$_dir\\\"; _dir=\\\"\\\${_dir%/*}\\\"; [ -z \\\"\\\$_dir\\\" ] && _dir=/; _i=\\\$((\\\$_i+1)); done; exit 0'\";
const UPS_PS  = 'powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \".claude/hooks/context-guard.ps1\"';
const PC_PS   = 'powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \".claude/hooks/post-compact.ps1\"';
appendIfAbsent(obj.hooks.UserPromptSubmit[0].hooks, UPS_BASH);
appendIfAbsent(obj.hooks.UserPromptSubmit[0].hooks, UPS_PS);
appendIfAbsent(obj.hooks.PostCompact[0].hooks,      PC_PS);
const tmp = f + '.tmp';
fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', { encoding: 'utf8' });
fs.renameSync(tmp, f);
console.log('settings.json patched');
"
```

- [ ] **T-006-2: Verify the patch**

```bash
node -e "
const obj = JSON.parse(require('fs').readFileSync('.claude/settings.json','utf8'));
const ups = obj.hooks.UserPromptSubmit[0].hooks;
const pc  = obj.hooks.PostCompact[0].hooks;
console.log('UPS entries:', ups.length);
console.log('PC entries:', pc.length);
const hasGuardBash = ups.some(h => h.command && h.command.includes('context-guard.sh'));
const hasGuardPS   = ups.some(h => h.command && h.command.includes('context-guard.ps1'));
const hasPCPS      = pc.some(h => h.command && h.command.includes('post-compact.ps1'));
console.log('context-guard.sh in UPS:', hasGuardBash);
console.log('context-guard.ps1 in UPS:', hasGuardPS);
console.log('post-compact.ps1 in PC:', hasPCPS);
"
```

Expected: all three booleans print `true`.

- [ ] **T-006-3: Commit**

```bash
git add -f .claude/settings.json
git commit -m "feat(FEAT-007): wire context-guard dispatchers in live settings.json"
```

---

### Task 7 (T-007): Update `.gitignore` and create `.gitattributes`

**Files:**
- Modify: `.gitignore`
- Create: `.gitattributes`

- [ ] **T-007-1: Add `turn-count.txt` to `.gitignore`**

Append idempotently — only if not already present:

```bash
grep -qF '.claude/memory/turn-count.txt' .gitignore \
  || printf '.claude/memory/turn-count.txt\n' >> .gitignore
```

- [ ] **T-007-2: Create `.gitattributes` with eol rules**

```bash
grep -qF '*.sh text eol=lf'    .gitattributes 2>/dev/null \
  || printf '*.sh text eol=lf\n'   >> .gitattributes
grep -qF '*.ps1 text eol=crlf' .gitattributes 2>/dev/null \
  || printf '*.ps1 text eol=crlf\n' >> .gitattributes
```

- [ ] **T-007-3: Verify**

```bash
grep turn-count.txt .gitignore && echo PASS
grep eol=lf .gitattributes && grep eol=crlf .gitattributes && echo PASS
```

Expected: both print `PASS`.

- [ ] **T-007-4: Commit**

```bash
git add .gitignore .gitattributes
git commit -m "chore(FEAT-007): gitignore turn-count.txt; add .gitattributes eol rules"
```

---

### Task 8 (T-008): Update `install.sh`

**Files:**
- Modify: `install.sh`

**Changes:** In the `--project` block (near line 1213–1217), after the existing hook download/chmod lines, add: (a) downloads for `context-guard.sh`, `context-guard.ps1`, `post-compact.ps1`; (b) `node -e` settings.json patch; (c) `.gitattributes` eol rules; (d) `.gitignore` turn-count.txt entry.

**Interfaces:**
- Consumes: `PROJ_DIR` variable (set to `.claude` earlier in the `--project` block)
- Produces: all hook files copied to `.claude/hooks/`; settings.json patched; `.gitattributes` updated; `.gitignore` updated

- [ ] **T-008-1: Add hook downloads after the existing post-compact download line**

Find the block at line 1214–1217:
```bash
  download "project-template/.claude/hooks/pre-tool-use.sh"  "${PROJ_DIR}/hooks/pre-tool-use.sh"  false
  download "project-template/.claude/hooks/post-compact.sh"  "${PROJ_DIR}/hooks/post-compact.sh"

  chmod +x "${PROJ_DIR}/hooks/pre-tool-use.sh" "${PROJ_DIR}/hooks/post-compact.sh"
```

Replace with:
```bash
  download "project-template/.claude/hooks/pre-tool-use.sh"    "${PROJ_DIR}/hooks/pre-tool-use.sh"    false
  download "project-template/.claude/hooks/post-compact.sh"    "${PROJ_DIR}/hooks/post-compact.sh"
  download "project-template/.claude/hooks/context-guard.sh"   "${PROJ_DIR}/hooks/context-guard.sh"
  download "project-template/.claude/hooks/context-guard.ps1"  "${PROJ_DIR}/hooks/context-guard.ps1"
  download "project-template/.claude/hooks/post-compact.ps1"   "${PROJ_DIR}/hooks/post-compact.ps1"

  chmod +x "${PROJ_DIR}/hooks/pre-tool-use.sh" \
           "${PROJ_DIR}/hooks/post-compact.sh" \
           "${PROJ_DIR}/hooks/context-guard.sh"
```

- [ ] **T-008-2: Add `node -` heredoc settings.json patch after the project verbosity hook merge block**

After the `_merge_settings_json` call (around line 1235), insert:

```bash
  # ── context-guard hook wiring ─────────────────────────────────────────────
  if [ "$_node_ok" = true ] 2>/dev/null || command -v node >/dev/null 2>&1; then
    _cg_node_ok=true
    _node_major=$(node -e "process.stdout.write(String(process.version.split('.')[0].replace('v','')))" 2>/dev/null || echo "0")
    [ "$_node_major" -lt 16 ] 2>/dev/null && { warn "Node.js v${_node_major} < 16 — context-guard settings.json wiring skipped"; _cg_node_ok=false; }
    if [ "$_cg_node_ok" = true ]; then
      node - "${PROJ_DIR}/settings.json" 2>/dev/null << 'JSEOF'
const fs = require('fs');
const f  = process.argv[2];
let obj  = {};
if (fs.existsSync(f)) {
  const raw = fs.readFileSync(f, 'utf8');
  try {
    const p = JSON.parse(raw);
    if (p !== null && typeof p === 'object' && !Array.isArray(p)) { obj = p; }
    else { process.stderr.write('WARN: settings.json root is not a JSON object -- treating as {}\n'); }
  } catch(e) { if (raw.trim()) process.stderr.write('WARN: settings.json is malformed -- treating as {}\n'); }
}
if (!obj.hooks) obj.hooks = {};
['UserPromptSubmit','PostCompact'].forEach(k => {
  if (!Array.isArray(obj.hooks[k])) obj.hooks[k] = [{ hooks: [] }];
  if (!obj.hooks[k][0]) obj.hooks[k][0] = { hooks: [] };
  if (!Array.isArray(obj.hooks[k][0].hooks)) obj.hooks[k][0].hooks = [];
});
function appendIfAbsent(arr, cmd) {
  if (!arr.some(h => h.command === cmd)) arr.push({ type: 'command', command: cmd });
}
const UPS_BASH = "bash -c 'set +e; _dir=\"${PWD:-}\"; _prev=\"\"; _i=0; while [ \"$_dir\" != \"$_prev\" ] && [ \"$_i\" -lt 40 ]; do _h=\"$_dir/.claude/hooks/context-guard.sh\"; [ -f \"$_h\" ] && [ -r \"$_h\" ] && { CC_PROJECT_ROOT=\"$_dir\" bash \"$_h\"; exit $?; }; _prev=\"$_dir\"; _dir=\"${_dir%/*}\"; [ -z \"$_dir\" ] && _dir=/; _i=$((_i+1)); done; exit 0'";
const PC_PS   = "powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \".claude/hooks/post-compact.ps1\"";
appendIfAbsent(obj.hooks.UserPromptSubmit[0].hooks, UPS_BASH);
appendIfAbsent(obj.hooks.PostCompact[0].hooks, PC_PS);
const tmp = f + '.tmp';
fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', { encoding: 'utf8' });
fs.renameSync(tmp, f);
JSEOF
      if [ $? -eq 0 ]; then
        ok "context-guard hooks registered in ${PROJ_DIR}/settings.json"
      else
        warn "context-guard settings.json wiring failed — add hooks manually"
      fi
    fi
  else
    warn "node not found — context-guard settings.json wiring skipped; install Node.js v16+ and re-run"
  fi
```

- [ ] **T-008-3: Add `.gitattributes` eol rules and turn-count.txt gitignore entry**

After the existing `.gitignore` block (around line 1254), add:

```bash
  # ── .gitattributes eol rules (idempotent) ────────────────────────────────
  _ga=".gitattributes"
  if [ -f "$_ga" ] && [ ! -w "$_ga" ]; then
    warn ".gitattributes is read-only — *.sh eol=lf and *.ps1 eol=crlf not added; add manually"
  else
    grep -qF '*.sh text eol=lf'    "$_ga" 2>/dev/null || printf '*.sh text eol=lf\n'    >> "$_ga"
    grep -qF '*.ps1 text eol=crlf' "$_ga" 2>/dev/null || printf '*.ps1 text eol=crlf\n' >> "$_ga"
    ok "Updated .gitattributes eol rules"
  fi

  # ── turn-count.txt gitignore entry (idempotent) ──────────────────────────
  _tc_entry=".claude/memory/turn-count.txt"
  grep -qF "$_tc_entry" .gitignore 2>/dev/null || { printf '%s\n' "$_tc_entry" >> .gitignore; ok "Added $_tc_entry to .gitignore"; }
```

- [ ] **T-008-4: Verify bash syntax**

```bash
bash -n install.sh && echo PASS
```

Expected: `PASS`

- [ ] **T-008-5: Commit**

```bash
git add install.sh
git commit -m "feat(FEAT-007): update install.sh to wire context-guard hooks and eol rules"
```

---

### Task 9 (T-009): Update `install.ps1`

**Files:**
- Modify: `install.ps1`

**Changes:** In the `if ($Project)` block, add: (a) downloads for context-guard scripts and post-compact.ps1; (b) `node -e` settings.json patch (via `@'...'@` here-string); (c) `.gitattributes` eol rules; (d) turn-count.txt gitignore entry.

**Interfaces:**
- Consumes: `$Project` switch, `$HasNode`, `$PROJ_DIR` variable (set to `.claude` in project block)
- Produces: hook files copied; settings.json patched; `.gitattributes` and `.gitignore` updated

- [ ] **T-009-1: Find the project block hook download section in `install.ps1`**

Search for the `post-compact.sh` download call in the `if ($Project)` block. It should look like:
```powershell
Save-RemoteFile "project-template/.claude/hooks/post-compact.sh"  "$projDir\hooks\post-compact.sh"
```

Add after it:
```powershell
    Save-RemoteFile "project-template/.claude/hooks/context-guard.sh"   "$projDir\hooks\context-guard.sh"
    Save-RemoteFile "project-template/.claude/hooks/context-guard.ps1"  "$projDir\hooks\context-guard.ps1"
    Save-RemoteFile "project-template/.claude/hooks/post-compact.ps1"   "$projDir\hooks\post-compact.ps1"
```

- [ ] **T-009-2: Add `node -e` settings.json patch using `@'...'@` here-string**

After the project verbosity hook merge block, insert:

```powershell
    # -- context-guard hook wiring -------------------------------------------
    $cgNodeOk = $false
    if (Get-Command node -ErrorAction SilentlyContinue) {
      $nm = node -e "process.stdout.write(String(process.version.split('.')[0].replace('v','')))" 2>$null
      if ([int]$nm -ge 16) { $cgNodeOk = $true } else { Write-Warn "Node.js v$nm < 16 -- context-guard wiring skipped" }
    } else { Write-Warn "node not found -- context-guard settings.json wiring skipped" }
    if ($cgNodeOk) {
      $cgScript = @'
const fs = require('fs');
const f  = process.argv[1];
let obj  = {};
if (fs.existsSync(f)) {
  const raw = fs.readFileSync(f, 'utf8');
  try {
    const p = JSON.parse(raw);
    if (p !== null && typeof p === 'object' && !Array.isArray(p)) { obj = p; }
    else { process.stderr.write('WARN: settings.json root is not a JSON object -- treating as {}\n'); }
  } catch(e) { if (raw.trim()) process.stderr.write('WARN: settings.json is malformed -- treating as {}\n'); }
}
if (!obj.hooks) obj.hooks = {};
['UserPromptSubmit','PostCompact'].forEach(k => {
  if (!Array.isArray(obj.hooks[k])) obj.hooks[k] = [{ hooks: [] }];
  if (!obj.hooks[k][0]) obj.hooks[k][0] = { hooks: [] };
  if (!Array.isArray(obj.hooks[k][0].hooks)) obj.hooks[k][0].hooks = [];
});
function appendIfAbsent(arr, cmd) {
  if (!arr.some(h => h.command === cmd)) arr.push({ type: 'command', command: cmd });
}
const UPS_BASH = "bash -c 'set +e; _dir=\"${PWD:-}\"; _prev=\"\"; _i=0; while [ \"$_dir\" != \"$_prev\" ] && [ \"$_i\" -lt 40 ]; do _h=\"$_dir/.claude/hooks/context-guard.sh\"; [ -f \"$_h\" ] && [ -r \"$_h\" ] && { CC_PROJECT_ROOT=\"$_dir\" bash \"$_h\"; exit $?; }; _prev=\"$_dir\"; _dir=\"${_dir%/*}\"; [ -z \"$_dir\" ] && _dir=/; _i=$((_i+1)); done; exit 0'";
const UPS_PS   = "powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \".claude/hooks/context-guard.ps1\"";
const PC_PS    = "powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \".claude/hooks/post-compact.ps1\"";
appendIfAbsent(obj.hooks.UserPromptSubmit[0].hooks, UPS_BASH);
appendIfAbsent(obj.hooks.UserPromptSubmit[0].hooks, UPS_PS);
appendIfAbsent(obj.hooks.PostCompact[0].hooks,      PC_PS);
const tmp = f + '.tmp';
fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', { encoding: 'utf8' });
fs.renameSync(tmp, f);
'@
      $cgSettingsPath = "$projDir\settings.json"
      node -e $cgScript $cgSettingsPath 2>$null
      if ($LASTEXITCODE -eq 0) { Write-Ok "context-guard hooks registered in $cgSettingsPath" }
      else { Write-Warn "context-guard settings.json wiring failed -- add hooks manually" }
    }
```

- [ ] **T-009-3: Add `.gitattributes` eol rules and turn-count.txt gitignore**

After the existing `.gitignore` append block, add:

```powershell
    # -- .gitattributes eol rules (idempotent) --------------------------------
    $ga = ".gitattributes"
    $gaRo = (Test-Path $ga) -and (Get-Item $ga).IsReadOnly
    if ($gaRo) {
      Write-Warn ".gitattributes is read-only -- *.sh eol=lf and *.ps1 eol=crlf not added; add manually"
    } else {
      $enc8 = [System.Text.UTF8Encoding]::new($false)
      $gaContent = if (Test-Path $ga) { [System.IO.File]::ReadAllText($ga, [System.Text.Encoding]::UTF8) } else { '' }
      if ($gaContent -notmatch '\*\.sh text eol=lf') {
        [System.IO.File]::AppendAllText($ga, "*.sh text eol=lf`n", $enc8)
      }
      if ($gaContent -notmatch '\*\.ps1 text eol=crlf') {
        [System.IO.File]::AppendAllText($ga, "*.ps1 text eol=crlf`n", $enc8)
      }
      Write-Ok "Updated .gitattributes eol rules"
    }

    # -- turn-count.txt gitignore entry (idempotent) --------------------------
    $tcEntry = ".claude/memory/turn-count.txt"
    $gi = ".gitignore"
    $giContent = if (Test-Path $gi) { [System.IO.File]::ReadAllText($gi, [System.Text.Encoding]::UTF8) } else { '' }
    if ($giContent -notlike "*$tcEntry*") {
      $enc8 = [System.Text.UTF8Encoding]::new($false)
      [System.IO.File]::AppendAllText($gi, "$tcEntry`n", $enc8)
      Write-Ok "Added $tcEntry to .gitignore"
    }
```

- [ ] **T-009-4: Verify install.ps1 syntax**

```bash
powershell -NonInteractive -NoProfile -Command "
  \$src = [System.IO.File]::ReadAllText('install.ps1', [System.Text.Encoding]::UTF8)
  \$e   = \$null
  \$null = [System.Management.Automation.PSParser]::Tokenize(\$src, [ref]\$e)
  if (\$e.Count) { \$e | ForEach-Object { Write-Host \$_.Message }; exit 1 } else { Write-Host 'PASS' }
"
```

Expected: `PASS`

- [ ] **T-009-5: Commit**

```bash
git add install.ps1
git commit -m "feat(FEAT-007): update install.ps1 to wire context-guard hooks and eol rules"
```

---

### Task 10 (T-010): Write `tests/hooks/context-guard.test.js`

**Files:**
- Create: `tests/hooks/context-guard.test.js`

**Interfaces:**
- Consumes: `.claude/hooks/context-guard.sh` (via `spawnSync` with `BASH_PATH`)
- Consumes: `.claude/hooks/post-compact.sh` (for PostCompact reset test)
- Produces: 19 passing test cases covering all spec rows

- [ ] **T-010-1: Write the test file**

```js
import { describe, it, expect, afterEach } from 'vitest'
import { spawnSync } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT  = resolve(__dirname, '../..')
const HOOK_PATH  = resolve(REPO_ROOT, '.claude/hooks/context-guard.sh')
const PC_PATH    = resolve(REPO_ROOT, '.claude/hooks/post-compact.sh')

const WIN32 = process.platform === 'win32'
const _whichBash = WIN32 ? null : spawnSync('which', ['bash'], { stdio: 'pipe', timeout: 5000 })
const BASH_PATH  = (_whichBash?.status === 0) ? _whichBash.stdout.toString().trim() : 'bash'
const _bashCheck = spawnSync('bash', ['--version'], { stdio: 'pipe', timeout: 5000 })
const BASH_AVAILABLE = !_bashCheck.error && _bashCheck.status === 0

const dirs = []
function mkTmp(thresh = null, count = null) {
  const d = mkdtempSync(join(tmpdir(), 'cg-'))
  dirs.push(d)
  mkdirSync(join(d, '.claude', 'memory'), { recursive: true })
  if (thresh !== null) writeFileSync(join(d, '.claude', 'memory', 'context-threshold.txt'), `${thresh}\n`)
  if (count !== null)  writeFileSync(join(d, '.claude', 'memory', 'turn-count.txt'), `${count}\n`)
  return d
}

function runHook(cwd, env = {}) {
  const r = spawnSync(BASH_PATH, [HOOK_PATH], {
    cwd,
    env: { ...process.env, CC_PROJECT_ROOT: cwd, ...env },
    stdio: 'pipe',
    timeout: 10000,
  })
  if (r.error) throw new Error(`spawn failed: ${r.error.message}`)
  const strip = s => (s ?? '').toString().replace(/\r\n/g, '\n')
  return { status: r.status ?? -1, stdout: strip(r.stdout), stderr: strip(r.stderr) }
}

function runPC(cwd) {
  const r = spawnSync(BASH_PATH, [PC_PATH], {
    cwd,
    env: { ...process.env, CC_PROJECT_ROOT: cwd },
    stdio: 'pipe',
    timeout: 10000,
  })
  if (r.error) throw new Error(`spawn failed: ${r.error.message}`)
  return r.status ?? -1
}

afterEach(() => {
  while (dirs.length) { try { rmSync(dirs.pop(), { recursive: true }) } catch {} }
})

describe.skipIf(!BASH_AVAILABLE)('context-guard.sh', () => {
  // row 1: count below warning (default threshold=25, warning=20)
  it('count below warning — no output', () => {
    const d = mkTmp(25, 5)            // new_count=6, warning=20
    const r = runHook(d)
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('')
  })

  // row 2: count at warning threshold
  it('count at warning — emits ⚠', () => {
    const d = mkTmp(25, 19)           // new_count=20 == warning
    const r = runHook(d)
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('⚠ CONTEXT WARNING: Turn 20/25 — consider running /cc-compact soon.\n')
  })

  // row 3: count above warning, below critical
  it('count above warning below critical — emits ⚠', () => {
    const d = mkTmp(25, 22)           // new_count=23, warning=20, critical=25
    const r = runHook(d)
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('⚠ CONTEXT WARNING: Turn 23/25 — consider running /cc-compact soon.\n')
  })

  // row 4: count at critical
  it('count at critical — emits 🚨', () => {
    const d = mkTmp(25, 24)           // new_count=25 == critical
    const r = runHook(d)
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('🚨 CONTEXT CRITICAL: Turn 25/25 — run /cc-compact NOW before context overflows.\n')
  })

  // row 5: counter saturation
  it('count=99999 — emits saturated message', () => {
    const d = mkTmp(25, 99999)        // new_count stays 99999
    const r = runHook(d)
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('🚨 CONTEXT CRITICAL: Turn 99999/25 (counter saturated) — run /cc-compact NOW.\n')
  })

  // row 6: PostCompact reset
  it('post-compact.sh resets turn-count.txt to 0', () => {
    const d = mkTmp(25, 42)
    const status = runPC(d)
    expect(status).toBe(0)
    const val = readFileSync(join(d, '.claude', 'memory', 'turn-count.txt'), 'utf8').trim()
    expect(val).toBe('0')
  })

  // row 7: corrupt turn-count.txt (non-numeric)
  it('corrupt turn-count.txt — resets to 0, no output', () => {
    const d = mkTmp(25)
    writeFileSync(join(d, '.claude', 'memory', 'turn-count.txt'), 'not-a-number\n')
    const r = runHook(d)
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('')         // new_count=1, below warning=20
    const val = readFileSync(join(d, '.claude', 'memory', 'turn-count.txt'), 'utf8').trim()
    expect(val).toBe('1')
  })

  // row 8: empty turn-count.txt
  it('empty turn-count.txt — treated as 0, no output', () => {
    const d = mkTmp(25)
    writeFileSync(join(d, '.claude', 'memory', 'turn-count.txt'), '')
    const r = runHook(d)
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('')         // new_count=1, below warning=20
  })

  // row 9: custom threshold = 10
  it('custom threshold=10 — MAX=10 in warning string', () => {
    const d = mkTmp(10, 7)            // new_count=8 == warning(8)
    const r = runHook(d)
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('⚠ CONTEXT WARNING: Turn 8/10 — consider running /cc-compact soon.\n')
  })

  // row 10: BOM-prefixed threshold file
  it('BOM-prefixed threshold — BOM stripped, correct threshold applied', () => {
    const d = mkTmp()
    const bom = Buffer.from([0xef, 0xbb, 0xbf])
    const content = Buffer.concat([bom, Buffer.from('10\n')])
    writeFileSync(join(d, '.claude', 'memory', 'context-threshold.txt'), content)
    writeFileSync(join(d, '.claude', 'memory', 'turn-count.txt'), '7\n')
    const r = runHook(d)              // new_count=8 == warning(8) of critical=10
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('⚠ CONTEXT WARNING: Turn 8/10 — consider running /cc-compact soon.\n')
  })

  // row 11: absent threshold file — fallback 25
  it('absent threshold — default 25 used', () => {
    const d = mkTmp()
    writeFileSync(join(d, '.claude', 'memory', 'turn-count.txt'), '19\n')
    const r = runHook(d)              // new_count=20 == warning(20) of critical=25
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('⚠ CONTEXT WARNING: Turn 20/25 — consider running /cc-compact soon.\n')
  })

  // row 12: locked/unreadable threshold (Unix only)
  it.skipIf(WIN32)('unreadable threshold file — fallback 25', () => {
    const d = mkTmp()
    const tf = join(d, '.claude', 'memory', 'context-threshold.txt')
    writeFileSync(tf, '10\n')
    chmodSync(tf, 0o000)
    writeFileSync(join(d, '.claude', 'memory', 'turn-count.txt'), '19\n')
    const r = runHook(d)              // new_count=20 == warning(20) of fallback critical=25
    chmodSync(tf, 0o644)              // restore so cleanup can delete
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('⚠ CONTEXT WARNING: Turn 20/25 — consider running /cc-compact soon.\n')
  })

  // row 13: negative threshold ('-5') — fallback 25
  it('negative threshold — fallback 25 used', () => {
    const d = mkTmp()
    writeFileSync(join(d, '.claude', 'memory', 'context-threshold.txt'), '-5\n')
    writeFileSync(join(d, '.claude', 'memory', 'turn-count.txt'), '19\n')
    const r = runHook(d)
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('⚠ CONTEXT WARNING: Turn 20/25 — consider running /cc-compact soon.\n')
  })

  // row 14: empty threshold file — fallback 25
  it('empty threshold file — fallback 25 used', () => {
    const d = mkTmp()
    writeFileSync(join(d, '.claude', 'memory', 'context-threshold.txt'), '')
    writeFileSync(join(d, '.claude', 'memory', 'turn-count.txt'), '19\n')
    const r = runHook(d)
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('⚠ CONTEXT WARNING: Turn 20/25 — consider running /cc-compact soon.\n')
  })

  // row 15: CRLF threshold file — CR stripped, correct threshold
  it('CRLF threshold file — CR stripped, correct threshold applied', () => {
    const d = mkTmp()
    writeFileSync(join(d, '.claude', 'memory', 'context-threshold.txt'), '10\r\n')
    writeFileSync(join(d, '.claude', 'memory', 'turn-count.txt'), '7\n')
    const r = runHook(d)              // new_count=8 == warning(8) of critical=10
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('⚠ CONTEXT WARNING: Turn 8/10 — consider running /cc-compact soon.\n')
  })

  // row 16: merge-conflict threshold — fallback 25
  it('merge-conflict threshold — fallback 25 used', () => {
    const d = mkTmp()
    writeFileSync(join(d, '.claude', 'memory', 'context-threshold.txt'),
      '<<<<<<< HEAD\n25\n=======\n50\n>>>>>>> branch\n')
    writeFileSync(join(d, '.claude', 'memory', 'turn-count.txt'), '19\n')
    const r = runHook(d)
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('⚠ CONTEXT WARNING: Turn 20/25 — consider running /cc-compact soon.\n')
  })

  // row 17: CC_GUARD_DEBUG=1 — stderr contains [context-guard]
  it('CC_GUARD_DEBUG=1 — stderr contains [context-guard]', () => {
    const d = mkTmp(25, 5)
    const r = runHook(d, { CC_GUARD_DEBUG: '1' })
    expect(r.status).toBe(0)
    expect(r.stderr).toMatch(/\[context-guard\]/)
  })

  // row 18: critical=1 (warning=0) — 🚨 fires from first turn
  it('critical=1 (warning=0) — 🚨 fires when new_count >= 1', () => {
    const d = mkTmp(1, 0)             // new_count=1, critical=1, warning=0
    const r = runHook(d)
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('🚨 CONTEXT CRITICAL: Turn 1/1 — run /cc-compact NOW before context overflows.\n')
  })

  // row 19: no .claude/ in tmpDir — hook creates dir and exits 0 cleanly
  it('no .claude/ in tmpDir — hook starts from scratch, exits 0, no output', () => {
    const d = mkdtempSync(join(tmpdir(), 'cg-empty-'))
    dirs.push(d)
    // No .claude/ directory at all
    const r = runHook(d)
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('')         // new_count=1, below warning=20 (default threshold=25)
  })
})
```

- [ ] **T-010-2: Run the tests**

```bash
npx vitest run tests/hooks/context-guard.test.js --reporter=verbose
```

Expected: all tests in the `context-guard.sh` describe block pass (skipped on Windows is acceptable for rows 12, all Unix rows).

- [ ] **T-010-3: Commit**

```bash
git add -f tests/hooks/context-guard.test.js
git commit -m "test(FEAT-007): add context-guard test suite (19 cases)"
```

- [ ] **T-010-4: Run full test suite (regression check)**

**Dependencies:** requires T-001 (`context-guard.sh`) and T-003 (`post-compact.sh`) to be implemented first — `HOOK_PATH` and `PC_PATH` in the test resolve to those files at runtime.

```bash
npx vitest run --reporter=verbose
```

Expected: all existing suites (guard3, guard4, plugin-integrity) pass with no regressions; `context-guard.test.js` adds 19 passing tests (18 on Windows where row 12 `skipIf(WIN32)` is skipped). Total test count increases by 18–19.

---

## Test List

- [x] T-010 — 19-case Vitest suite in `tests/hooks/context-guard.test.js`
- [ ] Manual smoke test: `CC_GUARD_DEBUG=1 bash .claude/hooks/context-guard.sh` (verify stderr output + turn-count.txt created)
- [ ] Manual smoke test: `bash .claude/hooks/post-compact.sh` (verify turn-count.txt reset to 0)
- [ ] Idempotency: run T-006 node -e script twice; verify settings.json has exactly 3 new entries (no duplicates)

## Commit Order

1. T-001: `feat(FEAT-007): add context-guard.sh hook (Unix turn counter)`
2. T-002: `feat(FEAT-007): add context-guard.ps1 hook (Windows turn counter)`
3. T-003: `feat(FEAT-007): rewrite post-compact.sh with atomic counter reset`
4. T-004: `feat(FEAT-007): add post-compact.ps1 (Windows PostCompact counter reset)`
5. T-005: `feat(FEAT-007): update project-template with context-guard hook entries and threshold`
6. T-006: `feat(FEAT-007): wire context-guard dispatchers in live settings.json`
7. T-007: `chore(FEAT-007): gitignore turn-count.txt; add .gitattributes eol rules`
8. T-008: `feat(FEAT-007): update install.sh to wire context-guard hooks and eol rules`
9. T-009: `feat(FEAT-007): update install.ps1 to wire context-guard hooks and eol rules`
10. T-010: `test(FEAT-007): add context-guard test suite (19 cases)`

## Identified Risks

1. **Shell escaping in node -e UPS_BASH string (T-006, T-008):** The dispatcher command contains single-quotes and double-quotes. When embedded in a shell here-string passed to `node -e`, escaping is complex. The T-006 step uses a double-quoted JS string with explicit escape sequences; verify with the `node -e` verify step (T-006-2) before committing.

2. **PS `@'...'@` closing marker column-0 requirement (T-009):** If any editor auto-indents the `'@` line, PS 5.1 will throw a parse error at runtime. Verify by running the installer on Windows after T-009.

3. **`post-compact.ps1` `Select-String` on Windows (T-004):** `?.Line` optional-member access is not available in PS 5.1 — rewrite as explicit `if ($last) { $last.Line }` if needed.

4. **`warning = 0` edge case (T-010 row 18):** When critical=1, `new_count=1 >= critical=1` → 🚨 fires via the first elif branch; the ⚠ branch is never reached. Test row 18 verifies 🚨, not ⚠.

5. **`.gitattributes` retroactive effect:** Adding `*.ps1 eol=crlf` after files are committed may cause diffs on next checkout on Unix. Run `git add --renormalize .` after creating `.gitattributes` to normalize already-tracked files.
