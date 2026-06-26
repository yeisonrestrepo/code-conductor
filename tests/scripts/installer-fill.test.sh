#!/usr/bin/env bash
# tests/scripts/installer-fill.test.sh
# Run with: bash tests/scripts/installer-fill.test.sh

set -euo pipefail
PASS=0; FAIL=0

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FILL_HELPER="$SCRIPT_DIR/_fill_helper.cjs"

assert_contains() {
  local _label="$1" _file="$2" _pattern="$3"
  if grep -qF -- "$_pattern" "$_file"; then
    echo "PASS: $_label"; PASS=$((PASS+1))
  else
    echo "FAIL: $_label (expected '$_pattern' in '$_file')"; FAIL=$((FAIL+1))
    grep '' "$_file" | head -5
  fi
}

assert_not_contains() {
  local _label="$1" _file="$2" _pattern="$3"
  if ! grep -qF -- "$_pattern" "$_file"; then
    echo "PASS: $_label"; PASS=$((PASS+1))
  else
    echo "FAIL: $_label (did NOT expect '$_pattern' in '$_file')"; FAIL=$((FAIL+1))
  fi
}

do_fill() {
  node "$FILL_HELPER" "$1" "$2"
}

mktemp_dir() { mktemp -d 2>/dev/null || mktemp -d -t cctest; }

TEMPLATE='## Project Identity
- Name:
- Description:
- Stack:
- Language: en

## Development Commands
- Build: <command>
- Test: <command>
- Lint: <command>
- Format: <command>
- Setup: <command>'

# ── Test 1: basic fill ──────────────────────────────────────────────────────
T=$(mktemp_dir); echo "$TEMPLATE" > "$T/CLAUDE.md"
do_fill "$T/CLAUDE.md" '{"name":"myapp","build":"npm run build","test":"jest"}'
assert_contains "basic: name filled"  "$T/CLAUDE.md" "- Name: myapp"
assert_contains "basic: build filled" "$T/CLAUDE.md" "- Build: npm run build"
assert_contains "basic: test filled"  "$T/CLAUDE.md" "- Test: jest"
assert_contains "basic: lint blank (not filled)" "$T/CLAUDE.md" "- Lint: <command>"
rm -rf "$T"

# ── Test 2: value with / (path) ─────────────────────────────────────────────
T=$(mktemp_dir); echo "$TEMPLATE" > "$T/CLAUDE.md"
do_fill "$T/CLAUDE.md" '{"build":"./scripts/build.sh"}'
assert_contains "slash: build filled" "$T/CLAUDE.md" "- Build: ./scripts/build.sh"
rm -rf "$T"

# ── Test 3: value with & ────────────────────────────────────────────────────
T=$(mktemp_dir); echo "$TEMPLATE" > "$T/CLAUDE.md"
do_fill "$T/CLAUDE.md" '{"build":"npm run lint && npm run build"}'
assert_contains "ampersand: build filled" "$T/CLAUDE.md" "- Build: npm run lint && npm run build"
rm -rf "$T"

# ── Test 4: value with backslash ────────────────────────────────────────────
T=$(mktemp_dir); echo "$TEMPLATE" > "$T/CLAUDE.md"
do_fill "$T/CLAUDE.md" '{"setup":"C:\\proj\\app-setup"}'
assert_contains "backslash: setup filled" "$T/CLAUDE.md" "- Setup: C:\proj\app-setup"
rm -rf "$T"

# ── Test 5: non-placeholder line is preserved ───────────────────────────────
T=$(mktemp_dir)
printf '%s\n' '## Development Commands' '- Build: my-custom-build' '- Test: <command>' > "$T/CLAUDE.md"
do_fill "$T/CLAUDE.md" '{"build":"npm run build","test":"jest"}'
assert_contains     "preserve: custom build unchanged" "$T/CLAUDE.md" "- Build: my-custom-build"
assert_contains     "preserve: placeholder test filled" "$T/CLAUDE.md" "- Test: jest"
assert_not_contains "preserve: custom build not overwritten" "$T/CLAUDE.md" "- Build: npm run build"
rm -rf "$T"

# ── Test 6: CRLF line endings handled correctly ─────────────────────────────
T=$(mktemp_dir)
printf '## Development Commands\r\n- Build: <command>\r\n- Test: <command>\r\n' > "$T/CLAUDE.md"
do_fill "$T/CLAUDE.md" '{"build":"npm run build"}'
assert_contains "crlf: build filled" "$T/CLAUDE.md" "npm run build"
rm -rf "$T"

# ── Test 7: read-only CLAUDE.md — helper exits 0, file unchanged ────────────
T=$(mktemp_dir); echo "$TEMPLATE" > "$T/CLAUDE.md"
chmod 444 "$T/CLAUDE.md"
set +e
do_fill "$T/CLAUDE.md" '{"build":"npm run build"}'
set -e
assert_not_contains "readonly: placeholder not replaced on failure" "$T/CLAUDE.md" "npm run build"
chmod 644 "$T/CLAUDE.md"
rm -rf "$T"

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""; echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
