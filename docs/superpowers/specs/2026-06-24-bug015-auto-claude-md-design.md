# BUG-015: Auto-Generated CLAUDE.md via Manifest Detection

## Problem

When a developer runs `install.sh --project` or `install.ps1 -Project`, the installer copies `project-template/CLAUDE.md` verbatim into the target project. Every field in `## Development Commands` (`Build`, `Test`, `Lint`, `Format`, `Setup`) is set to the literal placeholder `<command>`, and `## Project Identity` fields (`Name`, `Description`, `Stack`) are blank. The agent starts work blindly, wastes tokens guessing commands that already exist in `package.json` or `go.mod`, and the developer must manually fill in values that can be detected automatically.

## Solution

Introduce `scripts/detect-stack.mjs`, a read-only Node.js script that performs a single `readdir` sweep of the project root, reads relevant manifest files, and emits a JSON object on stdout containing all detectable fields. Both the installer (at `--project` install time) and `/cc-init` Step 2 (at session start) call this script, then surgically fill in only the blank/placeholder lines of CLAUDE.md. Fields the developer has already customized are never overwritten. Interactive questions are asked only for fields the script could not resolve.

## Behavior

### Main path

1. Developer runs `./install.sh --project` (or `install.ps1 -Project`) inside a project directory containing a `package.json`, `go.mod`, or similar manifest.
2. Installer resolves the absolute project root (`cd "$projDir" && pwd` / `Resolve-Path`).
3. Installer calls `node scripts/detect-stack.mjs <abs-root>` and captures stdout via `| Out-String` (PS) or command substitution (bash).
4. `detect-stack.mjs` runs one `fs.promises.readdir` sweep, distributes the file list to all detectors in priority order, merges results, trims all string values, and writes `JSON.stringify(result, null, 2) + '\n'` to stdout. All errors go to stderr. Exit code is always 0.
5. Installer reads current CLAUDE.md content. For each target field, it checks whether the line currently contains the `<command>` placeholder or is blank after `: ` (CRLF-resilient regex). If yes → replaces with the detected value (no secondary unescaping — `ConvertFrom-Json` / `JSON.parse` values are already unescaped runtime strings). If no → skips.
6. CLAUDE.md is written once with all resolvable fields populated. Remaining `<command>` placeholders stay for `/cc-init` to handle.
7. Developer opens Claude Code and runs `/cc-init`.
8. `/cc-init` Step 2 re-runs `detect-stack.mjs` with the absolute project root, receives the same JSON, and auto-fills any remaining blank fields. Only fields still absent from the JSON trigger interactive questions (batched, not one-at-a-time).
9. CLAUDE.md is updated with a single surgical `Edit` call — no full-file rewrite.

### Alternative paths

- **Monorepo (`pnpm-workspace.yaml` / `pkg.workspaces` / `melos.yaml`):** detector adjusts build/setup commands to `pnpm -r build` / `melos bootstrap` etc.
- **Angular with version pin:** `@angular/core` major version extracted and appended to stack string (e.g. `"Angular 20"`).
- **Multiple manifests (polyglot repo):** detector with highest specificity wins per field; first non-null value in the priority chain is used.
- **Re-run installer on existing project:** all already-filled fields (non-placeholder, non-blank) are preserved unchanged. Detection runs again but produces no changes to those fields.
- **`/cc-init` on a project with a CLAUDE.md already fully filled:** detect-stack runs, JSON is produced, all fields found to be non-placeholder → zero questions asked, zero writes performed.

### Error cases

- **Corrupt or unreadable manifest:** `readManifest` wraps each file read in try/catch; logs to stderr; returns `null` for that manifest. Script continues with remaining detectors. If all detectors return nothing, stdout receives `{}` and exit code is 0.
- **Node.js absent:** installer skips the detect-stack call and leaves CLAUDE.md with placeholders; `/cc-init` falls back to full interactive mode.
- **PS 5.1 `ConvertFrom-Json` failure:** isolated try/catch sets `$detected = $null`; installer proceeds with full interactive fallback.
- **CLAUDE.md missing or read-only:** installer logs a warning to stderr and skips the fill step; no crash.
- **Absolute path resolution fails:** fallback to `$PWD` / `$(pwd)`. Log warning to stderr.

## Acceptance Criteria

- [ ] `node scripts/detect-stack.mjs <dir>` prints only valid JSON to stdout; all warnings/errors go to stderr; exit code is always 0
- [ ] Output format is exactly `JSON.stringify(result, null, 2) + '\n'`, UTF-8, no BOM
- [ ] `main()` calls `fs.promises.readdir` exactly once; the resulting file list is passed to all detectors; no detector calls readdir independently
- [ ] Detector execution order (first match wins per field): Flutter/Melos → Angular (version-pinned) → Next.js → NestJS → React → Vue → bare TypeScript/Node → Go → Python (uv → poetry → pip) → Rust → Java (Maven → Gradle) → generic fallback
- [ ] Monorepo detection: `pnpm-workspace.yaml` present, or `pkg.workspaces` array, or `melos.yaml` → commands adjusted (e.g. `pnpm -r build`, `melos bootstrap`)
- [ ] All string values from manifests are `.trim()`-ed before being placed in the output JSON
- [ ] Parsed JSON property values are written to CLAUDE.md as-is (no secondary regex unescaping); `ConvertFrom-Json` / `JSON.parse` guarantees unescaped runtime strings
- [ ] Placeholder matching uses CRLF-resilient, non-greedy, line-by-line patterns targeting `<command>` literal or blank after `:\s*` — never raw key names
- [ ] Fields in CLAUDE.md that already hold a non-placeholder value are never overwritten by installer or `/cc-init`
- [ ] `install.sh --project`: resolves absolute root before calling detect-stack.mjs; fills CLAUDE.md idempotently; re-running the installer on the same project produces byte-identical CLAUDE.md
- [ ] `install.ps1 -Project`: captures stdout via `| Out-String`; `ConvertFrom-Json` in isolated try/catch; no secondary unescape pass
- [ ] `/cc-init` Step 2: asks interactive questions only for fields absent from detected JSON; all resolvable fields written in one `Edit` call
- [ ] `tests/scripts/detect-stack.test.js`: fs/promises fully mocked via Vitest `vi.mock`; covers happy path (package.json with known deps), monorepo (pnpm-workspace.yaml), Angular version pin, Flutter/melos, corrupt manifest fail-open, missing manifest returns `{}`, `.trim()` on whitespace-padded values, Go detection

## Out of Scope

- Modifying `project.md`, `personal.md`, or any memory file — only CLAUDE.md is touched
- Lock-file dep-tree traversal (lockfile used only to infer package manager: `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, else npm)
- Detecting more than one primary framework per project (priority list resolves ambiguity)
- FEAT-016 interactive wizard for blank-workspace / no-manifest case (separate spec)
- Global-only installs (no `--project` flag) — detect-stack is never called
- Generating or modifying `## Architecture Notes`, `## Conventions`, or `## Out of Scope` sections of CLAUDE.md

## System Impact

- `scripts/detect-stack.mjs` — new file; pure ESM; no runtime deps beyond Node built-ins
- `tests/scripts/detect-stack.test.js` — new test file; adds to the Vitest suite
- `project-template/.claude/commands/cc-init.md` — Step 2 rewritten to call detect-stack and apply smart merge
- `install.sh` — `--project` path extended with detect-stack call and `_fill_claude_md` helper
- `install.ps1` — `-Project` path extended with detect-stack call and `Set-ClaudeMdFields` helper
- `project-template/CLAUDE.md` — template unchanged (placeholders remain as fallback targets)
- `AGENT-READABLE BACKLOG.md` — BUG-015 checkbox marked `[X]` after verified implementation
- `VERSION` / `CHANGELOG.md` / `README.md` — updated to reflect 1.16.0 release

### Files Requiring Full Read (deferred to /cc-plan)

- `install.sh` — exceeds 30-line cap; `/cc-plan` will read the `--project` branch to identify exact insertion points for `_fill_claude_md` and detect-stack call
- `install.ps1` — same; `/cc-plan` will identify the `-Project` branch insertion points
- `project-template/.claude/commands/cc-init.md` — full read needed to locate Step 2 boundary and identify exact lines to replace

## Complexity Estimate

**M** — one new Node.js file with multi-manifest detection logic, one new Vitest suite, two install script extensions (bash + PS 5.1), one command file rewrite. No new runtime dependencies. No schema migrations.
