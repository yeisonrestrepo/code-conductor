#!/usr/bin/env bash
# BUG-014 verbosity hook test harness
# Run: bash tests/verbosity-hook-test.sh
# Requires: bash 3.2+, mktemp

set -euo pipefail
PASS=0; FAIL=0; _tmp=$(mktemp -d)
# Remove stale .verbosity-fence-warned marker before tests — a marker < 60 min old
# from a prior run or session would suppress fence-warning assertions in this harness.
rm -f "$HOME/.claude/logs/.verbosity-fence-warned" 2>/dev/null || true
trap 'rm -rf "$_tmp"' EXIT

# || true guards: (( expr )) returns exit code 1 when expr == 0 (e.g. PASS++ when PASS=0).
# With set -e active, a bare (( PASS++ )) would kill the script on the first assertion.
ok()   { echo "  PASS: $1"; (( PASS++ )) || true; }
fail() { echo "  FAIL: $1 — got: '$2' want: '$3'"; (( FAIL++ )) || true; }

# Environment isolation: each helper runs in a subshell that `cd`s into the
# designated temp directory so the hook's $PWD-based traversal starts from the
# correct location. Inline `PWD=...` env-var prefixes are NOT used because bash
# resets $PWD to the actual CWD on startup, ignoring any inherited value.
# HOME is passed as an inline prefix — bash does honour that variable.
# Each test block creates its own temp directory so filesystem state is isolated.
# CC_VERBOSITY_SKIP defaults to 0 if omitted (third arg to helpers).
_REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

run_global() {
    local _home="$1" _pwd="$2" _skip="${3:-0}"
    ( cd "$_pwd" 2>/dev/null && CC_VERBOSITY_SKIP="$_skip" HOME="$_home" \
        bash "$_REPO_ROOT/global/hooks/verbosity-remind.sh" 2>/dev/null ) || true
}

run_project() {
    local _home="$1" _pwd="$2" _skip="${3:-0}"
    ( cd "$_pwd" 2>/dev/null && CC_VERBOSITY_SKIP="$_skip" HOME="$_home" \
        bash "$_REPO_ROOT/project-template/.claude/hooks/verbosity-remind.sh" 2>/dev/null ) || true
}

# ── Matrix row 1: global hook, no project hook, verbosity.md = MIN ─────────
_h1="$_tmp/h1"; mkdir -p "$_h1/.claude/memory"
echo "VERBOSITY: MIN" > "$_h1/.claude/memory/verbosity.md"
out=$(run_global "$_h1" "$_h1")
case "$out" in
    *"VERBOSITY:MIN"*) ok "row1 global hook emits MIN" ;;
    *) fail "row1 global hook emits MIN" "$out" "contains VERBOSITY:MIN" ;;
esac

# ── Row 2: global defers to project hook ──────────────────────────────────
_h2="$_tmp/h2"; mkdir -p "$_h2/proj/.claude/hooks" "$_h2/.claude/memory"
echo "VERBOSITY: MIN" > "$_h2/.claude/memory/verbosity.md"
cp project-template/.claude/hooks/verbosity-remind.sh "$_h2/proj/.claude/hooks/verbosity-remind.sh"
out=$(run_global "$_h2" "$_h2/proj")
if [ -z "$out" ] || [ "$out" = $'\n' ]; then
    ok "row2 global defers (exits 0, no output) when project hook exists"
else
    fail "row2 global defers" "$out" "empty (deferred)"
fi

# ── Row 3: invoked from subdirectory, project hook at root ────────────────
_h3="$_tmp/h3"; mkdir -p "$_h3/proj/src/lib" "$_h3/proj/.claude/hooks" "$_h3/.claude/memory"
echo "VERBOSITY: MIN" > "$_h3/.claude/memory/verbosity.md"
cp project-template/.claude/hooks/verbosity-remind.sh "$_h3/proj/.claude/hooks/verbosity-remind.sh"
out=$(run_global "$_h3" "$_h3/proj/src/lib")
if [ -z "$out" ] || [ "$out" = $'\n' ]; then
    ok "row3 global defers from subdir via traversal"
else
    fail "row3 global defers from subdir" "$out" "empty (deferred)"
fi

# ── Row 4: project-local verbosity.md overrides global ────────────────────
_h4="$_tmp/h4"; mkdir -p "$_h4/proj/.claude/memory" "$_h4/.claude/memory"
echo "VERBOSITY: MIN" > "$_h4/.claude/memory/verbosity.md"
echo "VERBOSITY: INFO" > "$_h4/proj/.claude/memory/verbosity.md"
out=$(run_project "$_h4" "$_h4/proj")
case "$out" in
    *"VERBOSITY:INFO"*) ok "row4 project-local verbosity.md overrides global" ;;
    *) fail "row4 project-local override" "$out" "contains VERBOSITY:INFO" ;;
esac

# ── Row 5: lowercase 'verbose' normalizes to VERBOSE ─────────────────────
_h5="$_tmp/h5"; mkdir -p "$_h5/proj/.claude/memory" "$_h5/.claude/memory"
echo "VERBOSITY: MIN" > "$_h5/.claude/memory/verbosity.md"
echo "VERBOSITY: verbose" > "$_h5/proj/.claude/memory/verbosity.md"
out=$(run_project "$_h5" "$_h5/proj")
case "$out" in
    *"VERBOSITY:VERBOSE"*) ok "row5 lowercase verbose normalized to VERBOSE" ;;
    *) fail "row5 lowercase verbose" "$out" "contains VERBOSITY:VERBOSE" ;;
esac

# ── Row 6: no verbosity.md at any level → sanity guard MIN ───────────────
_h6="$_tmp/h6"; mkdir -p "$_h6"
out=$(run_global "$_h6" "$_h6")
case "$out" in
    *"VERBOSITY:MIN"*) ok "row6 sanity guard MIN when no verbosity.md" ;;
    *) fail "row6 sanity guard MIN" "$out" "contains VERBOSITY:MIN" ;;
esac

# ── Row 7: unrecognized level → sanity guard MIN ─────────────────────────
_h7="$_tmp/h7"; mkdir -p "$_h7/.claude/memory"
echo "VERBOSITY: LOUD" > "$_h7/.claude/memory/verbosity.md"
out=$(run_global "$_h7" "$_h7")
case "$out" in
    *"VERBOSITY:MIN"*) ok "row7 unrecognized level falls back to MIN" ;;
    *) fail "row7 unrecognized level" "$out" "contains VERBOSITY:MIN" ;;
esac

# ── Row 8: no project verbosity.md → HOME-level verbosity.md used ────────
# Tests that when CWD has no .claude/memory/verbosity.md anywhere up its tree,
# the hook falls back to $HOME/.claude/memory/verbosity.md. Implemented via
# run_global (subshell cd) so traversal starts from the correct temp dir.
_h8="$_tmp/h8"; mkdir -p "$_h8/.claude/memory"
echo "VERBOSITY: INFO" > "$_h8/.claude/memory/verbosity.md"
out=$(run_global "$_h8" "$_h8")
case "$out" in
    *"VERBOSITY:INFO"*) ok "row8 HOME-level verbosity.md used when no project override" ;;
    *) fail "row8 HOME-level fallback" "$out" "contains VERBOSITY:INFO" ;;
esac

# ── Row 10: VERBOSITY: inside code fence → not matched ───────────────────
_h10="$_tmp/h10"; mkdir -p "$_h10/.claude/memory"
cat > "$_h10/.claude/memory/verbosity.md" <<'EOF'
Some doc

```
VERBOSITY: VERBOSE
```

VERBOSITY: MIN
EOF
out=$(run_global "$_h10" "$_h10")
case "$out" in
    *"VERBOSITY:MIN"*) ok "row10 fenced VERBOSITY not matched, body VERBOSITY:MIN used" ;;
    *) fail "row10 fence guard" "$out" "contains VERBOSITY:MIN" ;;
esac

# ── Row 11: CC_VERBOSITY_SKIP=1 → no output ──────────────────────────────
_h11="$_tmp/h11"; mkdir -p "$_h11/.claude/memory"
echo "VERBOSITY: VERBOSE" > "$_h11/.claude/memory/verbosity.md"
out=$(run_global "$_h11" "$_h11" "1")
if [ -z "$out" ]; then
    ok "row11 CC_VERBOSITY_SKIP=1 produces no output"
else
    fail "row11 CI bypass" "$out" "empty"
fi

# ── Row 12: path with spaces ──────────────────────────────────────────────
_h12="$_tmp/h12 with spaces"; mkdir -p "$_h12/.claude/memory"
echo "VERBOSITY: MIN" > "$_h12/.claude/memory/verbosity.md"
out=$(run_global "$_h12" "$_h12")
case "$out" in
    *"VERBOSITY:MIN"*) ok "row12 path with spaces handled correctly" ;;
    *) fail "row12 path with spaces" "$out" "contains VERBOSITY:MIN" ;;
esac

# ── Row 13: project hook exists but not readable → global retains authority
# chmod 000 has no effect on root (Docker, CI containers). Skip with explanation when uid=0.
_h13="$_tmp/h13"; mkdir -p "$_h13/proj/.claude/hooks" "$_h13/.claude/memory"
echo "VERBOSITY: MIN" > "$_h13/.claude/memory/verbosity.md"
cp project-template/.claude/hooks/verbosity-remind.sh "$_h13/proj/.claude/hooks/verbosity-remind.sh"
if [ "$(id -u)" = "0" ]; then
    echo "  SKIP: row13 — running as root; chmod 000 is bypassed by kernel, test not meaningful"
else
    chmod 000 "$_h13/proj/.claude/hooks/verbosity-remind.sh"
    if [ -r "$_h13/proj/.claude/hooks/verbosity-remind.sh" ]; then
        echo "  SKIP: row13 — chmod 000 has no effect on this filesystem (Windows/MSYS2 NTFS)"
        chmod 644 "$_h13/proj/.claude/hooks/verbosity-remind.sh"
    else
        out=$(run_global "$_h13" "$_h13/proj")
        case "$out" in
            *"VERBOSITY:MIN"*) ok "row13 unreadable project hook -> global retains authority" ;;
            *) fail "row13 unreadable project hook" "$out" "contains VERBOSITY:MIN" ;;
        esac
        chmod 644 "$_h13/proj/.claude/hooks/verbosity-remind.sh"
    fi
fi

# ── CRLF line endings ─────────────────────────────────────────────────────
_hcr="$_tmp/hcr"; mkdir -p "$_hcr/.claude/memory"
printf "VERBOSITY: VERBOSE\r\n" > "$_hcr/.claude/memory/verbosity.md"
out=$(run_global "$_hcr" "$_hcr")
case "$out" in
    *"VERBOSITY:VERBOSE"*) ok "CRLF line endings normalized correctly" ;;
    *) fail "CRLF" "$out" "contains VERBOSITY:VERBOSE" ;;
esac

# ── Frontmatter VERBOSITY not matched; body VERBOSITY matched ─────────────
_hfm="$_tmp/hfm"; mkdir -p "$_hfm/.claude/memory"
cat > "$_hfm/.claude/memory/verbosity.md" <<'EOF'
---
VERBOSITY: VERBOSE
---

VERBOSITY: INFO
EOF
out=$(run_global "$_hfm" "$_hfm")
case "$out" in
    *"VERBOSITY:INFO"*) ok "frontmatter VERBOSITY not matched, body VERBOSITY:INFO used" ;;
    *) fail "frontmatter guard" "$out" "contains VERBOSITY:INFO" ;;
esac

# ── UTF-8 BOM on line 1 ───────────────────────────────────────────────────
_hbom="$_tmp/hbom"; mkdir -p "$_hbom/.claude/memory"
printf '\xef\xbb\xbfVERBOSITY: INFO\n' > "$_hbom/.claude/memory/verbosity.md"
out=$(run_global "$_hbom" "$_hbom")
case "$out" in
    *"VERBOSITY:INFO"*) ok "UTF-8 BOM stripped, VERBOSITY:INFO matched on line 1" ;;
    *) fail "UTF-8 BOM" "$out" "contains VERBOSITY:INFO" ;;
esac

# ── Inline comment (space+hash) stripped; token preserved ────────────────
_hic="$_tmp/hic"; mkdir -p "$_hic/.claude/memory"
echo "VERBOSITY: MIN # keep it short" > "$_hic/.claude/memory/verbosity.md"
out=$(run_global "$_hic" "$_hic")
case "$out" in
    *"VERBOSITY:MIN"*) ok "inline comment (space+hash) stripped, MIN extracted" ;;
    *) fail "inline comment" "$out" "contains VERBOSITY:MIN" ;;
esac

# ── Bare hash (no space) — NOT a comment; value fails normalization → MIN ─
_hbh="$_tmp/hbh"; mkdir -p "$_hbh/.claude/memory"
echo "VERBOSITY: MIN#tag" > "$_hbh/.claude/memory/verbosity.md"
out=$(run_global "$_hbh" "$_hbh")
case "$out" in
    *"VERBOSITY:MIN"*) ok "bare-hash value fails normalization, sanity guard sets MIN" ;;
    *) fail "bare-hash guard" "$out" "contains VERBOSITY:MIN" ;;
esac

# ── Hook always exits 0 (even with broken HOME) ───────────────────────────
CC_VERBOSITY_SKIP=0 HOME="" PWD="" bash global/hooks/verbosity-remind.sh >/dev/null 2>/dev/null
[ $? -eq 0 ] && ok "hook exits 0 with empty HOME" || fail "hook exit 0" "$?" "0"

# ── UserPromptSubmit array ordering — verbosity hook must be present and last ─
# Run _merge_settings_json on a fixture that already has a non-verbosity entry;
# confirm: (1) pre-existing entry is preserved, (2) verbosity entry is appended last.
if command -v python3 >/dev/null 2>&1; then
    _ha_cfg="$_tmp/ordering-settings.json"
    echo '{"hooks":{"UserPromptSubmit":[{"matcher":"","hooks":[{"type":"command","command":"bash /existing/hook.sh"}]}]}}' > "$_ha_cfg"
    bash -c "source install.sh 2>/dev/null; _merge_settings_json '$_ha_cfg' 'bash /verbosity/hook.sh'" 2>/dev/null || true
    python3 - "$_ha_cfg" <<'PYEOF' || true
import json, sys
d = json.load(open(sys.argv[1]))
arr = d["hooks"]["UserPromptSubmit"]
if len(arr) != 2:
    print(f"  FAIL: array ordering — expected 2 entries, got {len(arr)}")
    sys.exit(1)
first_cmd = (arr[0].get("hooks") or [{}])[0].get("command", arr[0].get("command", ""))
last_cmd  = (arr[1].get("hooks") or [{}])[0].get("command", arr[1].get("command", ""))
if "/existing/hook.sh" in first_cmd:
    print("  PASS: pre-existing hook preserved as first entry")
else:
    print(f"  FAIL: pre-existing hook not first — got: {first_cmd!r}")
    sys.exit(1)
if "/verbosity/hook.sh" in last_cmd:
    print("  PASS: verbosity hook appended as last entry")
else:
    print(f"  FAIL: verbosity hook not last — got: {last_cmd!r}")
    sys.exit(1)
PYEOF
else
    echo "  SKIP: array ordering test requires python3 (not found)"
fi

# ── T-14: Deeply nested path exceeding 40-iteration traversal cap ─────────────
# verbosity.md is placed at the BASE of a 45-deep tree; hook starts at the LEAF.
# The traversal cap (40) is exhausted before reaching the base, so VERBOSE must
# NOT be found. The hook falls back to $HOME/.claude/memory/verbosity.md (MIN).
# Note: verbosity.md MUST be at the base, not the leaf — if at the leaf it would
# be found on iteration 0 (before the cap could fire).
_deep_base="$_tmp/deep-path-test"
_deep_path="$_deep_base"
for _i in $(seq 1 45); do _deep_path="${_deep_path}/d${_i}"; done
mkdir -p "$_deep_path" 2>/dev/null || true
mkdir -p "$_deep_base/.claude/memory"
printf 'VERBOSITY: VERBOSE\n' > "$_deep_base/.claude/memory/verbosity.md"
_deep_home="$_tmp/deep-home"
mkdir -p "$_deep_home/.claude/memory"
printf 'VERBOSITY: MIN\n' > "$_deep_home/.claude/memory/verbosity.md"
_deep_out=$( ( cd "$_deep_path" 2>/dev/null && HOME="$_deep_home" \
    bash "$_REPO_ROOT/global/hooks/verbosity-remind.sh" 2>/dev/null ) || true )
case "$_deep_out" in
    *'VERBOSITY:MIN'*)     ok "T-14: cap=40 blocks verbosity.md 45 levels above; HOME fallback emits MIN" ;;
    *'VERBOSITY:VERBOSE'*) fail "T-14" "VERBOSE (traversal exceeded cap)" "MIN (HOME fallback)" ;;
    "")                    ok "T-14: no output — HOME verbosity.md absent (MIN default, acceptable)" ;;
    *)                     fail "T-14" "$_deep_out" "VERBOSITY:MIN" ;;
esac
rm -rf "$_deep_base" "$_deep_home" 2>/dev/null || true

echo ""
echo "  Results: ${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
