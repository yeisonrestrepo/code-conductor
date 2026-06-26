# BUG-015: Auto-Generated CLAUDE.md via Manifest Detection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `scripts/detect-stack.mjs` — a read-only Node.js script that detects project stack from manifests — and wire it into both installers and `/cc-init` so CLAUDE.md fields auto-fill at install/init time.

**Architecture:** `detect-stack.mjs` does one `readdir` sweep of the project root, expands monorepo workspace dirs, runs 21+ detectors in priority order, computes a classification matrix, and emits a single JSON object to stdout. `_fill_claude_md` (bash) and `Set-ClaudeMdFields` (PS) read that JSON and surgically replace only blank/`<command>` lines in CLAUDE.md using inline node scripts (avoids sed cross-platform issues). `/cc-init` Step 2 is rewritten to call the same script via `node scripts/detect-stack.mjs "$PWD"`.

**Tech Stack:** Node.js ESM (≥ 18), bash 3.2+, PowerShell 5.1+, Vitest 3.x.

## Global Constraints

- `detect-stack.mjs` exits 0 always; fatals write `{"error":...}` to stderr + `{}\n` to stdout.
- No runtime deps beyond Node built-ins — pure ESM, no npm install needed.
- `jq` is never used — all JSON extraction via `node -e` or `node -` heredoc.
- Placeholder match: exactly `<command>` (any case, internal whitespace) OR blank after `Key:` — mixed content is user-customized and never overwritten.
- **Node ≥ 18 check is mandatory** in both installers before invoking detect-stack; "skip gracefully" means: emit exactly one `warn`/`Write-Warn` line, set `_ds_skip=true`/`$dsSkip=$true`, and continue installation without auto-fill. No uncaught syntax exception must reach the user.
- **stderr routing:** detect-stack stderr is redirected to `${_install_logfile:-/dev/null}` (bash) and `2>$null` (PS). The raw `{"error":...}` JSON payload is never printed to the user terminal; the installer emits its own human-readable `warn` line when something goes wrong. This preserves UI cleanliness.
- **CWD path with spaces/special characters:** bash passes the project root as `"$(pwd)"` (always double-quoted). PS must pass it as `"$($pwd.Path)"` (double-quoted expression) — bare `$pwd.Path` breaks on paths containing spaces and must not be used.
- **Exit codes:** `_fill_claude_md` and `Set-ClaudeMdFields` always return exit 0 to the caller; node subprocess failure is absorbed internally. Installer exit code is never affected by auto-fill failure. detect-stack.mjs itself exits 0 in all cases.
- **Atomic write:** `writeFileSync(tmp, content, 'utf8')` must complete without throwing before `renameSync` is called. If `writeFileSync` throws, the rename never runs and the original CLAUDE.md is unchanged. No additional size-check is required; a thrown exception from `writeFileSync` is sufficient signal.
- **JSON capture (bash):** `_ds_json=$(node ...)` via shell variable substitution is safe; detect-stack JSON output is always < 10 KB in practice, well within POSIX shell limits. No temp file is needed for the captured JSON in the bash installer.
- PS 5.1: `@'...'@` closing `'@` must be at column 0; no `??` operator; CLAUDE.md written via `[System.IO.File]::WriteAllText` with `[System.Text.UTF8Encoding]::new($false)` (UTF-8, genuinely no BOM). **`[System.Text.Encoding]::UTF8` must NOT be used** — in .NET Framework 4.x (PS 5.1), `Encoding.UTF8` is `new UTF8Encoding(encoderShouldEmitUTF8Identifier: true)` and `WriteAllText` writes the `EF BB BF` preamble. Using `[System.Text.UTF8Encoding]::new($false)` is mandatory for BOM-free output.
- All string values `.trim()`-ed before JSON output; empty/null/undefined fields omitted from JSON.
- **CC_GLOB_DEPTH clamping:** `Math.max(1, Math.min(20, v))` is applied after parsing; non-finite / non-numeric inputs (empty string, `NaN`, strings) fall back to default 5. Negative numbers clamp to 1. Values above 20 clamp to 20. No error is thrown for out-of-range inputs.
- **Circular symlink prevention:** `safeAddDir` resolves each candidate path via `realpath` and checks membership in a `visited` Set (initialized to `rootReal`). If `realpath` returns a path already in `visited`, or a path that does not start with `rootReal + sep` (escapes the project), the directory is silently skipped. This prevents infinite loops from circular symlinks.
- **512 KB per-manifest cap:** `readManifest` and `readText` both stat the file first; if `s.size > 512 * 1024` the file is skipped with a `WARN:` line to stderr. No content is read from files exceeding this limit.
- **Classification uses only production dependencies:** The `allDeps` map used by `classifyProject` is built exclusively from `p.dependencies` (not `devDependencies`) across root and workspace packages. Framework detectors that return partial results also use `pkgProdDep` for scoring signals (react, vue). `devDependencies` entries do not contribute to FE or BE scores.
- **Directory type filter in glob:** `expandGlob` calls `e.isDirectory()` on every `readdir` entry before processing it. Regular files, symlinks to files, and other non-directory types are silently skipped. Only true directories proceed to `safeAddDir`.
- **UTF-16 / UTF-32 BOM handling:** `readFile(filepath, 'utf8')` reads the raw bytes as UTF-8. A UTF-16 LE BOM (`FF FE`) or UTF-32 BOM decoded as UTF-8 produces garbage characters that cause `JSON.parse` to throw; the catch block in `readManifest` returns `null`. These files are silently skipped as corrupt data — no special BOM detection is added.
- **No comments written or removed from CLAUDE.md:** The fill regex `'^(\\s*-?\\s*Label:)\\s*(<[^>]*>)?\\s*(\\r?)$'` matches only field lines that are blank or contain a `<...>` placeholder. Comment lines (starting with `#`), section headings (`##`), and any other line content are never touched. The fill operation is purely additive.
- **Infra classification threshold:** `projectType: 'infra'` is assigned only when `infra` is truthy AND `FE < 2` AND `BE < 2` (strict less-than). If either score reaches 2, the standard fullstack/frontend/backend rules take precedence.
- **Multi-statement commands stored verbatim:** Detected command strings (e.g. `npm run lint && npm run build`) are stored exactly as found in the manifest's `scripts` field. No shell parsing, splitting, or transformation is applied. The only normalization is `.trim()` and collapsing embedded newlines to a single space (`\r?\n` → ` `).
- **Workspace directory sort order:** `workspaceDirs.sort()` uses JavaScript's default Unicode code-point lexicographic order (case-sensitive). This is deterministic across platforms. No locale-aware or case-insensitive sort is used.
- **Exclusion pattern handling:** In `expandPatterns`, entries prefixed with `!` are resolved to absolute paths and stored in a `negative` array. After positive expansion, any result directory whose absolute path equals or is prefixed by a negative path (with `sep` appended) is filtered out. Exclusion is applied after all positive expansions, not per-pattern.
- **Temp file co-location:** The atomic write temp file is always `mdPath + '.tmp.' + process.pid` — placed in the same directory as CLAUDE.md. This guarantees `renameSync` is a same-volume operation on all platforms.
- **Fullstack as tie-breaker:** When `FE >= 2` AND `BE >= 2`, the result is always `fullstack` regardless of score magnitude. There is no higher-scoring winner; equal scores at or above threshold are both fullstack.
- **JSON key → CLAUDE.md field mapping:** The fill scripts use exactly this mapping (JSON key → CLAUDE.md label): `name→Name`, `description→Description`, `stack→Stack`, `build→Build`, `test→Test`, `lint→Lint`, `format→Format`, `setup→Setup`. No other JSON keys are written into CLAUDE.md. The JSON keys emitted by detect-stack.mjs must match exactly these lowercase camelCase names.
- **Polyglot stack field override:** When multiple language manifests are found at the root (`package.json` + `go.mod`, etc.), `merged.stack` is replaced with a slash-joined string (e.g. `typescript/go`). The `build`, `test`, `lint`, `format`, and `setup` fields are NOT overridden — they retain the value from the first detector that set them. Only the `stack` field is affected by polyglot detection.
- **CI mode for installers:** `install.sh --project` and `install.ps1 -Project` never ask interactive questions; they run detect-stack unconditionally (subject to the Node ≥ 18 check) and leave unfilled `<command>` placeholders for the user. The `CI=true` / `!isTTY` guard applies only to `/cc-init` Step 2 (which may ask questions). No CI check is needed in the installer scripts themselves.
- **`process.argv[2]` fallback:** `main()` in detect-stack.mjs uses `process.argv[2] ?? process.cwd()` — if no target path is supplied on the command line, the script silently falls back to the current working directory. No error or warning is emitted for a missing argument.
- **Empty JSON `{}` skips field iteration:** Both `_fill_claude_md` and `Set-ClaudeMdFields` must exit early (before the field-iteration loop) when the parsed JSON has no keys. In the bash helper this is handled by `Object.keys(d).length === 0 && process.exit(0)` after parsing. In the PS path the `$dsJson -and ($dsRaw.Trim() -ne '{}')` guard prevents calling `Set-ClaudeMdFields` at all.
- **Literal `\n`/`\t` escape sequences scrubbed:** When a manifest `scripts` value contains the literal two-character sequences `\n`, `\t`, or `\r` (not actual newline/tab bytes), they are replaced with a single space: `clean.replace(/\\[ntr]/g, ' ')` applied after `.trim()`. This prevents these sequences from appearing verbatim in CLAUDE.md.
- **Omitted JSON key → field untouched:** If a key (e.g. `lint`) is absent from the detected JSON, the fill loop's `typeof val !== 'string'` guard fires (`val` is `undefined`) and the corresponding CLAUDE.md line is left exactly as found. No null, empty string, or placeholder is written.
- **Backslash normalization in workspace patterns:** Workspace glob patterns read from `pnpm-workspace.yaml`, `melos.yaml`, and `package.json#workspaces` always use forward slashes (YAML/JSON convention). Within `expandGlob`, `pattern.split('/')` splits on forward slashes only. `resolve()` and `join()` produce OS-native paths internally. No explicit backslash-to-forward-slash normalization is required in the glob patterns themselves because the inputs are always forward-slash. Absolute result paths use OS separator and are passed to node functions natively.
- **Root readdir returns all entries; GLOBAL_IGNORE filters further IO:** The single `readdirSafe(rootReal)` call returns every entry at the project root — including `node_modules`, `.git`, `.svn`, `.hg`, `.venv`, `.turbo`, and other artifact dirs — in one syscall. No additional IO is performed on GLOBAL_IGNORE members: they are excluded from `expandGlob` (workspace expansion), from `detectArchitecture` dir-entry loops, and from any other recursive traversal. Entries whose names start with `.` are also skipped unconditionally inside `expandGlob`. The result is that only the root-level file-name set (`rootNames`) is used for detector existence checks (e.g., `rootNames.has('go.mod')`); no secondary `readdir` or `readFile` call is made into `node_modules`, `.git`, or any other GLOBAL_IGNORE dir during normal execution.
- **File permissions preserved during atomic rename:** `fs.renameSync(tmp, mdPath)` is an atomic OS-level rename that preserves the inode's permission bits on POSIX. On Windows, `renameSync` replaces the target file but the filesystem ACL of the original is not restored. If permission preservation is critical on Windows, use `[System.IO.File]::Replace` in a PS-only path; for the node fill script, `renameSync` is sufficient — no explicit `chmod` or `icacls` call is needed.
- **Stderr diagnostic routing:** All `warn(msg)` calls in detect-stack.mjs write to `process.stderr` only. In `_fill_claude_md`, node's stderr is redirected with `2>>"${_install_logfile:-/dev/null}"` so diagnostics are appended to the installer log file without appearing on the user terminal. In `Set-ClaudeMdFields`, stderr is suppressed with `2>$null`. No diagnostic line is ever written to stdout.
- **Classification tie-breaking for equal sub-scores:** Within the FE and BE scoring, multiple signals can each add to the same score bucket. The tie-breaking rules are: (1) infra checked first (before FE/BE); (2) fullstack when `FE >= 2 AND BE >= 2` regardless of whether FE > BE or FE == BE; (3) within a single bucket, no further tie-breaking is needed — only the bucket totals matter.
- **Single quotes in values do not break PS node execution:** `Set-ClaudeMdFields` writes `$JsonStr` to a temp file via `[System.IO.File]::WriteAllText` and passes the file path (not the JSON string) as `process.argv[2]` to node. Single quotes in the JSON content never touch the PS argument boundary.
- **512 KB limit from OS stat, not compressed size:** `s.size` from `fs.stat()` is the file's on-disk byte count as reported by the OS — this is the uncompressed logical size. Compressed or sparse files report their allocated size. No decompression is performed; the limit is applied strictly to the value returned by `stat().size`.
- **Negative pattern exact-match on workspace subdirectory:** In `expandPatterns`, a discovered absolute directory path `d` is excluded if `d === negPath` (exact match) OR `d.startsWith(negPath + sep)` (prefix match, i.e. subpath). Both conditions are checked. An exclusion pattern that resolves to `/root/apps/internal` will exclude `/root/apps/internal` itself and `/root/apps/internal/sub` but not `/root/apps/internal2`.
- **Trailing CR handling / exact line-ending preservation:** The fill regex must capture the optional trailing `\r` as group 3 and restore it in the replacement: `'$1 ' + safe + '$3'`. This guarantees CRLF files remain CRLF and LF files remain LF after any fill pass. The regex is `'^(\\s*-?\\s*Label:)\\s*(<[^>]*>)?\\s*(\\r?)$'` with the `'im'` flags. Group 1 captures leading whitespace + optional hyphen + optional whitespace + label prefix so that indented lines (e.g., `  - Build: <command>`) are matched and their indentation is preserved verbatim in the replacement.
- **Missing label in CLAUDE.md → no-op, no error:** If the label (e.g. `Build:`) does not exist anywhere in CLAUDE.md, `re.test(content)` returns false and the `continue` fires. No exception is thrown. The file is written back unchanged (or the write is skipped entirely if no fields matched).
- **detect-stack.mjs path resolution:** The script locates itself via `fileURLToPath(import.meta.url)` — this is an absolute URL of the script file as loaded by Node, independent of the installer's location or the CWD at launch time. The project root is passed explicitly as `process.argv[2]`; the script never infers a path from its own physical location.
- **Monorepo manifest priority:** Exactly one monorepo source is used: `pnpm-workspace.yaml` → `melos.yaml` → `package.json#workspaces`, in that order, as an if/else-if/else-if chain. If `pnpm-workspace.yaml` exists, the others are ignored. If multiple manifests coexist, the first in this priority order wins for workspace expansion; `monorepo=true` is set by whichever branch fires.
- **Multi-line / chained commands verbatim after normalization:** Chained commands (`npm lint && npm build`) and multi-statement commands are preserved exactly as written after the two normalizations: (1) actual newline bytes → single space, (2) literal `\n`/`\t`/`\r` → single space. No further parsing, splitting, or truncation is applied. The full command string is written to CLAUDE.md as a single line.
- **Global top-level error catch:** `main()` is always called as `main().catch(err => { stderr.write(JSON.stringify({error,code})); stdout.write('{}\n'); process.exit(0); })`. Every async rejection inside `main()` — including unhandled promise rejections from awaited calls — is caught by this top-level handler. Synchronous exceptions in detector functions are also propagated to `main()`'s catch. Exit code is always 0.
- **Special characters in project path (bash):** The bash installer passes the project root as `"$(pwd)"` (double-quoted expansion). This handles spaces, parentheses, brackets, and most special characters. Paths with embedded single quotes or literal `$()` constructs are not supported and should not appear in a typical project root; no extra escaping is applied beyond the double quotes.
- **Special characters in project path (PS):** The PS installer passes the project root as `"$($pwd.Path)"` (double-quoted expression). PowerShell expands `$($pwd.Path)` before passing; the resulting string is passed as a single positional argument to node. Paths with embedded double quotes are not expected; if they occur, the installer emits a warn and skips auto-fill.
- **Case-insensitive label matching and indentation preservation:** The fill regex uses `'im'` flags. `- build:`, `- Build:`, `  - BUILD:` (indented), and `Build:` (no hyphen) all match. Group 1 captures the full prefix including any leading whitespace — `'  - Build:'` is captured verbatim and restored as `$1` in the replacement, preserving the original indentation. The `\\s*-?\\s*` before `Label:` handles zero or more spaces, optional hyphen, and zero or more spaces in any combination.
- **Zero-byte / blank manifest guard:** `readManifest` checks `if (s.size === 0)` before reading and emits a `WARN:` then returns null. `readText` also checks `if (s.size === 0)` and returns null. Neither function calls `readFile` on a zero-byte file. A file containing only whitespace has `size > 0` — it is read but `JSON.parse('')` (after trim) throws and the catch returns null.
- **Idempotency:** After a first fill pass, every matched line has a real value (not a `<placeholder>` and not blank). On a second run, the regex `'^(\\s*-?\\s*Label:)\\s*(<[^>]*>)?\\s*(\\r?)$'` does NOT match a line with a real value (e.g. `- Build: npm run build`) because `(<[^>]*>)?\\s*$` requires end-of-line after optional placeholder and optional whitespace only. The line is left untouched. Repeated runs are fully idempotent.
- **Equal FE scores for multiple frontend techs:** If a repo has both `react` (FE+=3) and `vue` (FE+=3), FE=6 ≥ 2 → frontend (unless BE also ≥ 2 → fullstack). No additional tie-breaking is applied within the FE bucket; the total sum is all that matters. The `stack` field will be set by whichever frontend detector fires first in the priority chain.
- **devDependencies scanning rules:** Framework detectors that identify the primary stack (react, vue, etc.) use `pkgProdDep` (production-only). Detectors for tooling-style frameworks (NestJS, TypeScript via `ts-node`) use `pkgDep` (both prod and dev) because they may legitimately appear in devDependencies. Classification scoring (`classifyProject`) uses `allDeps` built from prod-only `dependencies`. No fallback rule promotes devDependencies into classification scores.
- **Database detection uses both prod and dev dependencies:** `detectDb` merges `{ ...pkg.dependencies, ...pkg.devDependencies }` before checking for db signal packages (Prisma, pg, mongoose, etc.). Database client libraries like `@prisma/client` typically appear in `dependencies`, but the Prisma CLI (`prisma`) and test utilities often appear in `devDependencies`. Merging both ensures accurate db detection regardless of where the package was declared. This is an intentional exception to the prod-only rule used for classification scoring.
- **Stderr WARN format mandate:** Every non-fatal diagnostic emitted by detect-stack.mjs must follow exactly the format `WARN: <message>\n` (no ANSI codes, no timestamps, no structured JSON). Fatal diagnostics use `{"error":"...","code":"..."}` JSON to stderr. This predictable format allows automated log parsers to distinguish WARN lines from fatal JSON without regex fragility.
- **Trailing inline comments preserved:** The fill regex requires end-of-line (`$`) immediately after the optional placeholder and optional whitespace. A line `- Build: <command>  # my comment` does NOT match because `# my comment` trails after `<command>`. The line is left entirely untouched. Comments on the same line as a `<placeholder>` are therefore preserved by the non-match.
- **Missing/unreadable project-template/CLAUDE.md:** `_fill_claude_md` starts with `[ -f "$_md" ] || return 0` (bash) and `if (-not (Test-Path $MdPath)) { return }` (PS). If the CLAUDE.md file was not downloaded (network failure in `download`), is not a regular file, or cannot be read, the fill helper exits immediately with code 0. The installer continues normally.
- **Backend service vs library classification:** A pure library (no server framework, no server-like dirs like `api/`, `server/`, `cmd/`, no DB signal, no `go/java/python/rust/csharp/scala/spring-boot` stack) accumulates BE < 2 and FE < 2 → `projectType: 'library'`. The `api/` directory adds BE+=2 (≥ 2 alone) → `backend`. A `go`/`python`/etc. stack adds BE+=3 → `backend`. The library classification is the residual catch-all when no other rule fires.
- **Node.js absent or corrupted graceful fallback:** `command -v node` (bash) / `Get-Command node -ErrorAction SilentlyContinue` (PS) is checked before any node invocation. If node is absent, the installer emits one `warn` line and sets `_ds_skip=true`/`$dsSkip=$true`. The `download "project-template/CLAUDE.md"` step has already run by this point, so the baseline CLAUDE.md copy is intact with its `<command>` placeholders.
- **External symlinks rejected by safeAddDir:** `realpath(abs)` resolves all symlinks to a canonical path. If the result does not start with `rootReal + sep` (and is not `rootReal` itself), the directory is silently skipped with a `WARN:` to stderr. This prevents following symlinks that point outside the project root regardless of how deeply they are nested.
- **Alternative script names (compile, bundle):** The current implementation reads only `pkg.scripts.build` for the `build` field. No fallback to `compile`, `bundle`, or `make` is implemented in this release. If `scripts.build` is absent, the `build` field is left undefined and the corresponding CLAUDE.md line keeps its `<command>` placeholder for manual editing.
- **Parent repo metadata fallback:** `name` falls back to `basename(rootReal)` if `rootPkg.name` is absent and `go.mod` has no module line. `description` is sourced only from `rootPkg.description` — no parent-dir, git-remote, or sibling-manifest lookup is performed. If `description` is absent from the manifest, the `Description:` field in CLAUDE.md is left as-is.
- **Terminal output encoding:** `process.stdout.write` and `process.stderr.write` emit raw UTF-8 bytes. On Unix containers the terminal's UTF-8 locale handles these correctly. On Windows, `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8` and `$OutputEncoding = [System.Text.Encoding]::UTF8` are set in the PS installer block before calling node, ensuring the PowerShell pipeline does not corrupt the UTF-8 JSON when capturing with `| Out-String`.
- **`.venv` and `.turbo` in GLOBAL_IGNORE:** `GLOBAL_IGNORE` must include `.venv` and `.turbo` in addition to the existing entries (`node_modules`, `.git`, `.svn`, `.hg`, `.expo`, `.dart_tool`, `.pub-cache`, `__pycache__`, `.gradle`, `.m2`, `vendor`, `dist`, `build`, `out`, `.next`, `.nuxt`, `.cache`, `.parcel-cache`). These entries are filtered only within the recursive `expandGlob` loop — the initial root `readdir` does NOT apply `GLOBAL_IGNORE` (this allows `.github` and similar hidden dirs to be visible for CI signal detection). Entries filtered in `expandGlob`: both `GLOBAL_IGNORE.has(e.name)` and `e.name.startsWith('.')`.
- **Missing CLAUDE.md headers are silent no-ops:** If CLAUDE.md completely lacks `## Development Commands` or `## Project Identity` headers, the fill regex `re.test(content)` returns `false` for every field and the `continue` fires for each. The file is written back unchanged (or the write is skipped entirely if no fields matched). No error is thrown. This is the same no-op path as a missing label described above.
- **`\r` in `node --version` output (bash):** `node --version` on Windows may emit `v18.0.0\r`. The bash version extractor `sed 's/^v\([0-9]*\).*/\1/'` discards the `\r` because `\r` is not a digit — the regex `[0-9]*` stops before it. The subsequent `case "$_ds_major" in ''|*[!0-9]*)` guard further coerces any non-numeric residue to `0`. No explicit `tr -d '\r'` is needed but the guard must remain.
- **First-wins dedup across workspace subdirs:** `detect-stack.mjs` merges detector results via `if (merged[f] === undefined && d[f] !== undefined) merged[f] = d[f]`. Only the first defined value for each field wins — duplicate detections from multiple workspace subdirs (e.g., two `package.json` files both defining `scripts.build`) do not overwrite the first-set value. No explicit deduplication Set is needed; the undefined-check is the dedup mechanism.
- **Indented placeholder lines are matched and indentation preserved:** The fill regex `'^(\\s*-?\\s*Label:)...'` captures any leading whitespace in group 1. A line `  - Build: <command>` (two-space indent) matches with `$1 = "  - Build:"` and is replaced as `"  - Build: detected-value"` — the indentation is preserved verbatim. This supports CLAUDE.md files that use nested or indented list formatting.
- **Malformed/corrupted JSON never throws unhandled exceptions:** `readManifest` wraps all JSON parsing in `try { ... } catch { return null; }`. A truncated, trailing-garbage, non-string-key, or NaN-value JSON manifest is always silently skipped. The top-level `main().catch()` handler absorbs any remaining propagated errors. No JSON parsing call in detect-stack.mjs is outside a try/catch boundary.
- **Non-directory root path → graceful empty result:** If `process.argv[2]` resolves (via `realpath`) to a regular file rather than a directory, `readdir` on that path throws `ENOTDIR`. `readdirSafe` catches this via its `.catch` handler, emits `WARN: readdir error — skipped: <path>`, and returns `[]`. `main()` continues with an empty `rootEntries` array, emits `{"name":"<basename>","projectType":"library","layeredArchitecture":"unknown"}`, and exits 0.
- **Node.js experimental warnings go to stderr only:** `node` emits `ExperimentalWarning` lines to `process.stderr`, never to `process.stdout`. All detect-stack.mjs output is written explicitly via `process.stdout.write` — no `console.log` is used. The installer redirects node's stderr to `${_install_logfile:-/dev/null}` (bash) and `2>$null` (PS), so experimental warnings never contaminate the captured JSON. No `NODE_NO_WARNINGS=1` flag is required.
- **`writeFileSync` disk-full / file-lock failure:** `fs.writeFileSync(tmp, content, 'utf8')` can throw `ENOSPC` (disk full) or `EBUSY` (file locked on Windows). In the node fill script this call is NOT wrapped in its own try/catch — if it throws, the error propagates to the `main().catch()` handler, which writes `{"error":"..."}` to stderr and `{}\n` to stdout and exits 0. The original CLAUDE.md is unchanged because the temp file was never renamed. This is the correct safe-fail behavior.
- **Non-UTF-8 system locales do not affect I/O:** All `readFile` and `writeFileSync` calls in detect-stack.mjs and the fill scripts use an explicit `'utf8'` encoding argument. The OS locale (`LANG`, `LC_ALL`) is never consulted for text encoding. `JSON.stringify` output is always ASCII-safe (non-ASCII chars are `\uXXXX`-escaped by default). Tests that run under a non-UTF-8 locale (e.g., `LANG=C`) must still pass with no behavior change.
- **Corrupted or absent node binary handled by numeric guard:** If `node --version` exits non-zero, outputs garbage, or emits nothing (e.g., a partially installed Node), the bash extractor produces an empty or non-numeric `_ds_major`. The `case ''|*[!0-9]*)` guard forces `_ds_major=0` → the `-lt 18` check fires → `_ds_skip=true`. In PS, `$nmRaw -match '^v(\d+)'` fails → `$nm=0` → `$nm -lt 18` → `$dsSkip=$true`. Both installers emit exactly one warn line and continue; no exception reaches the user.
- **Fill regex does not exhibit catastrophic backtracking:** The regex `'^(\\s*-?\\s*Label:)\\s*(<[^>]*>)?\\s*(\\r?)$'` is safe from catastrophic backtracking: `\\s*-?\\s*` is bounded by the start-of-line anchor `^`; `[^>]*` is a negated character class (linear); the two `\\s*` groups are separated by `(<[^>]*>)?` which either matches or fails immediately; `(\\r?)$` is anchored to end-of-line. No alternation or nested quantifiers exist. The regex is guaranteed O(n) where n is the line length.
- **Orphaned temp files cleaned at the start of each fill invocation:** `_fill_claude_md` starts with `rm -f "${_md}.tmp."* 2>/dev/null || true`; `Set-ClaudeMdFields` starts with `$null = Remove-Item "${MdPath}.tmp.*" -Force -ErrorAction SilentlyContinue`. These lines remove any `.tmp.<pid>` file left by a prior process that was killed mid-write. Cleanup is unconditional and happens before any new temp file is created — the `rm`/`Remove-Item` failure is silently ignored.
- **Script priority order — build vs compile vs bundle:** Only `pkg.scripts.build` is read for the `build` field. If `build` is absent but `compile`, `bundle`, or `make` exist, those are ignored in this release. Scripts discovery is strictly key-name-based (`scripts.build`, `scripts.test`, `scripts.lint`, `scripts.format`) with no fuzzy fallback. The `setup` field comes from installer detection (uv, poetry, pip, `npm install`, etc.), not from `scripts.setup`. No new fallback keys are added in BUG-015.
- **MAX_DIRS cap (200) prevents memory exhaustion:** After workspace expansion, `workspaceDirs` is capped at 200 entries (`MAX_DIRS = 200`). If expansion yields more, a `WARN:` is emitted and the list is truncated to the first 200 (post-sort). Each workspace dir reads at most one `readdir` call (for `package.json` detection) — 200 dirs × 1 readdir = bounded I/O regardless of monorepo size.
- **Variant placeholder formats matched:** The fill regex group 2 `(<[^>]*>)?` matches any content between angle brackets including interior spaces. `< command >`, `<COMMAND>`, `< Command >`, and `<command>` are all matched and replaced. The `i` flag on the outer regex applies only to the label portion (`Label:`), not to the placeholder group — but `[^>]*` is inherently case-agnostic since it matches any non-`>` character.
- **`package.json#workspaces` object form supported:** When `rootPkg.workspaces` is a plain object (not an array), the code checks `Array.isArray(ws.packages)`. If `ws.packages` is an array (e.g. `{"workspaces": {"packages": ["apps/*", "packages/*"]}}`), those patterns are used and `monorepo = true`. If neither `ws` is an array nor `ws.packages` is an array, no workspace expansion is performed and `monorepo` remains false.
- **Consistent async I/O — no sync/async mixing:** All file system operations in `detect-stack.mjs` use the `node:fs/promises` named imports (`readdir`, `readFile`, `stat`, `realpath`). No synchronous `fs.*Sync` call exists in the detector pass. The fill scripts (embedded in install.sh/install.ps1) use `require('fs')` with synchronous `readFileSync`/`writeFileSync`/`renameSync` because they run as a self-contained node one-shot script with no event loop contention.
- **`detectArchitecture` return values:** Returns `'clean'` (domain/ports/adapters/application/infrastructure dirs found), `'mvc'` (controllers/models/views dirs found), `'layered'` (service/repository/dao dirs found), or `undefined` (no pattern detected → stripped from output). Detection checks both root-level and one level inside `src/`. No other architectural pattern strings are returned in this release.
- **Replacement value — only `$` needs escaping:** The detected command string is used as the *replacement argument* to `String.prototype.replace(re, replacement)`. In a replacement string, only `$` has special meaning (`$1`, `$&`, `$\``, etc.). No other regex metacharacter (`*`, `.`, `+`, `[`, etc.) has special meaning in a replacement string. Therefore `clean.replace(/\$/g, '$$$$')` is sufficient — no other character in the detected value needs escaping before being placed into CLAUDE.md.
- **JSON output is pretty-printed; bash capture is safe:** `process.stdout.write(JSON.stringify(output, null, 2) + '\n')` emits pretty-printed JSON (2-space indent, multiple lines) terminated with a single `\n`. This is intentional for human readability. Single-line output is NOT used. POSIX `$()` variable capture handles multi-line strings correctly — `_ds_json=$(node ...)` captures the full pretty-printed JSON into a shell variable. The trailing `\n` is consistent across all platforms.
- **`process.exit(0)` required at end of `main()`:** After `process.stdout.write(JSON.stringify(output, null, 2) + '\n')`, `main()` must call `process.exit(0)` explicitly. Without it, any `readdir` call that reached its `READDIR_TIMEOUT` and was rejected via `Promise.race` still has a pending native I/O operation. That operation prevents the event loop from draining and the process from exiting. Explicit `process.exit(0)` at the end of the happy path is mandatory to guarantee the script always terminates.
- **PS `-LiteralPath` for non-wildcard file operations:** All PS cmdlets operating on known paths (`Test-Path`, single-file `Remove-Item`, `Copy-Item` source) must use `-LiteralPath` instead of `-Path` to prevent PowerShell from interpreting `[` and `]` as character-class wildcards. Exception: `Remove-Item "${MdPath}.tmp.*"` intentionally uses `-Path` (wildcard expansion required); its wildcard characters come from the `*` suffix, not from `$MdPath` itself. If `$MdPath` contains brackets, the temp-file cleanup becomes `Get-ChildItem -LiteralPath (Split-Path $MdPath) -Filter "$(Split-Path $MdPath -Leaf).tmp.*" | Remove-Item -Force -ErrorAction SilentlyContinue`.
- **Download validation — detect-stack.mjs must be non-empty after fetch:** After `curl`/`wget`/`Invoke-WebRequest` downloads `detect-stack.mjs` to a temp file, the installer must check `[ -s "$_ds_tmp" ]` (bash) / `(Get-Item -LiteralPath $dsTmp).Length -gt 0` (PS) before executing. An empty file (network truncation, 302 redirect body, CDN error page) must be treated as a download failure: emit one warn, skip auto-fill, delete the temp file. No syntax-error output from executing an empty `.mjs` file should reach the user.
- **Negative exclusion patterns with `**` are resolved as string paths, not recursive globs:** In `expandPatterns`, negative entries like `!apps/**/internal` are passed through `resolve(rootReal, p.slice(1))`. `resolve()` treats `**` as a literal directory-name segment — `resolve('/root', 'apps/**/internal')` produces `/root/apps/**/internal`. The exclusion check `d === negPath || d.startsWith(negPath + sep)` then compares against that literal string, which will never match a real path. **Double-asterisk negative patterns are therefore no-ops in this implementation** — they should be avoided; use single-level patterns like `!apps/internal` instead. This is documented behavior, not a bug.
- **Infra signals scanned at root level only:** `detectInfraCI` is called with `rootNames` (the root `readdir` result) and `rootReal` only. It does NOT scan workspace subdirectories for `Dockerfile`, `k8s/`, `terraform/`, `.github/`, etc. If infra tooling is only present in subdirectories (e.g., a `deploy/` subdirectory with a `Dockerfile`), it will not be detected and `infra`/`ci` fields remain `undefined` in the output. This is intentional: scanning every workspace subdir for infra files would be expensive and non-deterministic.
- **Corporate proxy support:** `curl` and `wget` in bash respect the `http_proxy`, `https_proxy`, `HTTP_PROXY`, `HTTPS_PROXY` environment variables natively. `Invoke-WebRequest` in PS respects the system proxy (set via Internet Options or `netsh winhttp`). No explicit proxy flag is added to the installer commands; proxy configuration is the user's responsibility. If the download fails in a proxy environment, the installer emits "Could not download detect-stack.mjs" and skips auto-fill — the baseline CLAUDE.md copy (already downloaded earlier in the install flow) is unaffected.
- **Framework dependency matching is exact-key, not substring:** `pkgDep(pkg, 'react')` checks `pkg.dependencies['react']` — an exact property-key lookup. A package named `@my-org/react-components` or `react-dom` does NOT trigger the react detector. There is no `includes()` or substring check on dependency names. This prevents false positives from similarly-prefixed packages (e.g., `react-query` does not set `stack: 'typescript'`).
- **CC_GLOB_DEPTH `parseInt` handles trailing whitespace and newlines:** `parseInt('5\n', 10)` → `5` and `parseInt('  3  ', 10)` → `3`. `parseInt` ignores leading/trailing whitespace by spec. A value inherited from an env file or shell pipeline with a trailing newline is parsed correctly and never falls back to the default. No `trim()` call is needed before `parseInt`.
- **Broken symlinks in root readdir do not throw:** `readdir(rootReal, { withFileTypes: true })` returns broken symlinks as `Dirent` entries with `isDirectory() === false` and `isSymbolicLink() === true`. These are not directories → `e.isDirectory()` returns false → skipped in `expandGlob` and not added to `rootNames` checks for manifests. No individual-entry try/catch is needed; `readdir` itself does not throw on broken symlinks.
- **SIGKILL leaves temp file; next invocation cleans it:** A process killed with SIGKILL (or `TerminateProcess` on Windows) cannot run cleanup handlers. The temp file `CLAUDE.md.tmp.<pid>` is left on disk. The next invocation of `_fill_claude_md` / `Set-ClaudeMdFields` opens with `rm -f "${_md}.tmp."* 2>/dev/null` / `Remove-Item "${MdPath}.tmp.*"` which removes all matching temp files from any prior run, regardless of PID. No additional cleanup mechanism is needed; the startup sweep is sufficient.
- **Workspace sort is always code-point order, regardless of filesystem case-sensitivity:** `workspaceDirs.sort()` sorts by JavaScript Unicode code-point order (case-sensitive: uppercase < lowercase). On case-insensitive filesystems (Windows NTFS, macOS HFS+), the sort result differs from what `ls` shows but remains deterministic and reproducible across all Node.js versions. The sorted order is used for output only (JSON `workspaceDirs` array); it does not affect which dirs are processed.
- **Node basic eval sanity check not performed:** The installer checks only `node --version` (exit code + numeric parse). A corrupted Node.js installation that reports a valid version but fails on actual script execution is not pre-screened with `node -e "1"`. If `node "$_ds_tmp"` fails with a non-zero exit, `_ds_json` is empty → the `[ -n "$_ds_json" ]` guard fires → the fill is silently skipped with no warn. This is the correct silent-fallback behavior; no additional eval gate is required.
- **Total manifest reads capped at MAX_DIRS + 1:** At most one `readManifest` call per workspace dir (for `package.json`) + one for the root `package.json` + one each for `go.mod`, `pyproject.toml`, etc. at root = `MAX_DIRS (200) + ~10 root manifests`. The effective upper bound on manifest reads is ~210 `stat` + `readFile` pairs per invocation. No additional manifest count variable is needed; `MAX_DIRS` on workspace dirs is the binding constraint.
- **Leading-hyphen paths are impossible for all installer-generated paths:** All paths handled by `_fill_claude_md` and the detect-stack invocation are absolute paths. `"$(pwd)"` always starts with `/` on POSIX; `$($pwd.Path)` always starts with a drive letter on Windows. The CLAUDE.md path is always `"$_install_dir/CLAUDE.md"` (an absolute or `./`-relative path). No bash command in the installer receives a path that could start with `-`. No `--` double-dash separator is needed. If a user's CWD somehow starts with `-` (impossible on all supported platforms), the `mktemp -d` and `realpath` calls would fail before reaching the fill logic.
- **Node version prerelease and RC tags stripped by regex:** `node --version` may output `v20.0.0-rc.1`, `v18.0.0-beta.3`, or `v22.1.0-nightly.20240101`. The bash extractor `sed 's/^v\([0-9]*\).*/\1/'` captures only the leading digit group — everything after the first non-digit (including `-rc`, `-beta`, `.`) is discarded. The PS extractor `$nmRaw -match '^v(\d+)'` captures only `\d+` before any non-digit. Both produce a clean major integer regardless of prerelease suffix. No additional stripping is required.
- **`readdir` results are not capped per-directory; only workspace count is capped:** `readdirSafe` returns all `Dirent` entries from a single directory without a per-directory entry count limit. A directory with 10 000 files returns all of them. However, detect-stack.mjs reads each directory's entries in a single linear pass and only checks `e.name` for known manifest filenames — no file content is read from large directories. The `MAX_DIRS = 200` cap on workspace directories is the primary performance bound. Per-directory entry count is unbounded by design; the OS `readdir` syscall is the bottleneck, not JavaScript iteration.
- **`workspaceDirs` field in JSON output contains absolute paths:** The `workspaceDirs` array in the emitted JSON holds OS-native absolute paths (e.g. `/home/user/project/apps/web` on POSIX, `C:\Users\...\apps\web` on Windows). These paths are informational and are NOT written to CLAUDE.md. The fill loop only processes `name`, `description`, `stack`, `build`, `test`, `lint`, `format`, `setup` — all of which are strings, never paths. Portability of `workspaceDirs` values across machines is a non-issue for the fill workflow.
- **Temp file suffix is process PID, not a cryptographic random:** The atomic write temp file is `mdPath + '.tmp.' + process.pid`. PID is not cryptographically random but is unique per live process — two simultaneous fill invocations on the same CLAUDE.md would use different PIDs and produce non-colliding temp files. PID reuse after process exit is possible but the startup `rm -f "${_md}.tmp."*` sweep removes all prior temp files before creating a new one. No cryptographic suffix (`crypto.randomBytes`) is needed for this use case.
- **CLAUDE.md without trailing newline is handled correctly:** The fill regex uses `m` flag (`multiline`). In JavaScript's multiline mode, `$` matches immediately before a `\n` OR at the very end of the string. A CLAUDE.md file whose last line `- Setup: <command>` has no trailing newline IS matched: `$` anchors to end-of-string. The replacement writes the modified string back — the trailing newline (or lack thereof) is preserved exactly as read because no newline is appended.
- **Serverless and edge-native projects without framework markers → library:** A project using Vercel edge functions, Cloudflare Workers, or AWS Lambda without a recognized framework dependency (no react, express, etc.) and without server-like directories (`api/`, `server/`) accumulates `FE < 2` and `BE < 2`. If no infra signal (`Dockerfile`, `k8s/`) is found either, the result is `projectType: 'library'`. If a framework like React IS present, the normal FE scoring applies. No special serverless detector is added in BUG-015; `library` is the intentional catch-all for unrecognized configurations.
- **Manifest filenames are matched exactly as written in code; case-sensitive on Linux:** `rootNames.has('package.json')` is an exact string match. On Linux (case-sensitive FS), a file named `Package.json` or `PACKAGE.JSON` is NOT found. Detectors only scan canonical lowercase filenames (`package.json`, `go.mod`, `Cargo.toml`, `pyproject.toml`, etc.). This is intentional — non-canonical names are treated as absent. macOS and Windows (case-insensitive FS) return lowercase-equivalent names from `readdir` in practice, so this distinction only matters on Linux.
- **Workspace-within-workspace (nested monorepo) is not recursed:** When `expandPatterns` resolves a workspace directory, detect-stack reads only that directory's `package.json` for commands/name. It does NOT check whether that subdirectory itself has a `pnpm-workspace.yaml`, `melos.yaml`, or `workspaces` field — nested workspace configs are ignored. Only the root-level monorepo config drives workspace expansion. Sub-workspace members that are themselves monorepos are treated as leaf packages.
- **DB signal priority — file-based checks beat package-based checks:** In `detectDb`, file-based signals are checked first: `schema.prisma` file present → return `'prisma'` immediately, without inspecting `package.json`. Package-based signals (e.g. `@prisma/client` dep) are checked only if no file-based signal matched. This ordering ensures that a project with a `schema.prisma` file is correctly classified as `'prisma'` even if its `package.json` is missing or empty.
- **Multiple server runtimes in one project accumulate BE score:** A project with both `express` and `fastify` in `dependencies` accumulates `BE += 3` twice (BE = 6). This is ≥ 2, so the project is still classified `backend` (or `fullstack` if FE ≥ 2). No special handling for multi-runtime projects is added. The `stack` field is set by whichever detector fires first — in this case `detectNextjs`/`detectNestjs`/`detectReact` etc. run before generic Express, so if Next.js is present it sets `stack` first.
- **Project name is used verbatim; markdown control chars are not escaped:** `merged.name` (from `rootPkg.name` or `basename(rootReal)`) is written directly into CLAUDE.md as `- Name: <value>`. Characters like `[`, `]`, `*`, `_`, `` ` `` that have special meaning in Markdown are NOT escaped. The fill is a plain text substitution into the CLAUDE.md template — it is not processed by any Markdown renderer during the fill step. If a project name contains Markdown control characters, they appear verbatim in CLAUDE.md (which is fine, since CLAUDE.md is treated as plain text by the installer).
- **Minimal container runtimes without `sed`:** The bash version check uses `node --version 2>/dev/null | sed 's/^v\([0-9]*\).*/\1/'`. If `sed` is absent, the `sed` call fails, the pipe produces no output, and `_ds_major` is empty. The `case ''|*[!0-9]*)` guard then coerces `_ds_major=0` → `-lt 18` fires → `_ds_skip=true`. Auto-fill is gracefully skipped with one warn. The baseline CLAUDE.md (already downloaded before this block) is preserved intact. No `sed`-free fallback regex is needed.
- **Auxiliary config files take priority over package deps within each detector:** Within a single detector function, file-existence checks are placed before package-dependency checks. For example, `detectDb` checks for `schema.prisma` file existence before checking `@prisma/client` in deps. `detectPython` checks for `uv.lock` file before reading `pyproject.toml` content. This file-first ordering ensures that projects with strong structural signals (dedicated config files) are not misclassified by stale or incomplete `package.json` entries.
- **Permission-denied workspace subdirectory is silently skipped:** When `expandGlob` calls `readdirSafe(base)` on a directory that is inaccessible (`EACCES`/`EPERM`), `readdirSafe` catches the error, emits `WARN: readdir error — skipped: <dir>`, and returns `[]`. When `safeAddDir` calls `realpath(abs)` on an inaccessible path, the catch block returns `false`. Either case results in the workspace directory being silently omitted from `workspaceDirs`. No fatal error is raised; the installer continues without auto-fill data from that subdirectory.
- **Multi-line or vendor-prefixed `node --version` output degrades safely:** Some vendor-patched Node.js runtimes write branding text or warnings to stdout alongside the version line. In bash, `sed 's/^v\([0-9]*\).*/\1/'` transforms each line; `_ds_major` then contains newlines → the `*[!0-9]*` case guard fires → `_ds_major=0` → `-lt 18` → `_ds_skip=true`. In PS, `$nmRaw -match '^v(\d+)'` matches the first `v<digit>` occurrence anywhere in the string; if vendor text precedes the version line and itself contains a digit sequence, `$Matches[1]` may be wrong → the `-lt 18` guard is the safety net. Both paths degrade to a graceful skip for non-standard version output. No `grep -m1` or head-line extraction is added.
- **Installer logfile redirect failure is silent:** If `$_install_logfile` is set to a path on a read-only filesystem or a full disk, the bash `2>>"${_install_logfile}"` append silently fails (the shell continues; stderr diagnostics from detect-stack.mjs are lost). In PS, `2>$null` is always safe. No additional guard is added around the logfile redirect — losing diagnostics to a full/read-only log target is acceptable, and the installer's own terminal output and exit code are unaffected.
- **Bun and Deno workspace definitions are out of scope in BUG-015:** Bun workspaces (`bunfig.toml`, `bun.workspace.ts`) and Deno workspaces (`deno.json`/`deno.jsonc#workspace`) are not parsed in this release. Bun is detected as a package manager (via `bun.lockb`), but its workspace manifest is not read. Deno has no detector at all. Both are deferred to a future release. Projects using these runtimes will have `monorepo: false` and no workspace expansion; the root-level detectors still run.
- **Corrupt root `package.json` does not block workspace expansion:** If `rootPkg` is `null` (due to a parse error, empty file, or schema violation in the root `package.json`), workspace expansion via `pnpm-workspace.yaml` or `melos.yaml` is unaffected — those branches do not require a valid `rootPkg`. The `package.json#workspaces` branch is skipped when `rootPkg` is null. Individual workspace `package.json` files are read and merged independently; a corrupt root manifest only means root-level `name`, `description`, and `scripts` fall back to their null-check defaults.
- **PS `Set-ClaudeMdFields` does not retry on file-lock failure:** `[System.IO.File]::Replace` or `[System.IO.File]::Move` may throw if CLAUDE.md is locked by an IDE indexer at rename time. The PS function does NOT add a sleep-retry loop. A single attempt is made; on failure the exception is caught, one `Write-Warning` line is emitted, and the function returns without writing. The temp file (`.tmp.<pid>`) is left on disk and cleaned by the next invocation's startup sweep. Retry logic would add complexity and delay; a single-attempt fail-safe write is the correct behavior for a non-interactive installer.
- **Duplicate `Label:` lines in CLAUDE.md — first occurrence only is filled:** `String.prototype.replace(re, replacement)` without the `g` flag replaces only the first match. If CLAUDE.md contains two `- Build: <command>` lines (e.g., a malformed or user-duplicated template), only the first is replaced; the second remains as `<command>`. This is intentional: a duplicated field indicates a non-standard template that the user has manually modified; touching only the first canonical occurrence prevents accidental overwrites. No `g` flag is added to the fill regex.
- **No cryptographic checksum validation on downloaded `detect-stack.mjs`:** The installer verifies only that the downloaded file is non-empty (`[ -s "$_ds_tmp" ]` / `.Length -gt 0`). No SHA256 hash, GPG signature, or content-hash comparison is performed in BUG-015. Cryptographic verification is deferred to a future release. Users in high-security environments should pin the download URL to a specific commit SHA.
- **Library repo with infra-only testing artifacts is classified `infra`, not `library`:** A project with no framework dependencies and no server-like directories, but with a `Dockerfile` or `docker-compose.yml` (even if used only for local test infrastructure), has `infra` truthy and `FE < 2`, `BE < 2`. The classification result is `projectType: 'infra'`. This is intentional: the presence of infrastructure manifests is treated as a structural signal regardless of their purpose. There is no "testing-only infra" distinction in the scoring matrix.
- **Test suite does not cover OS-level `PATH_MAX` or `ELOOP` symlink depth:** T-002 does not add test cases for maximum path length (`PATH_MAX = 4096` on Linux) or deeply nested circular symlinks (Linux `ELOOP` limit at ~40 levels). These are OS-level constraints enforced by `realpath()` itself. When `realpath` throws `ELOOP` or `ENAMETOOLONG`, the existing `safeAddDir` try/catch catches the error and returns `false`, silently skipping the directory. No additional test infrastructure is needed to cover these OS-level bounds.
- **Installer skip notification exact message format:** When auto-fill is skipped due to Node < 18 or absent Node: bash emits `warn "detect-stack: Node ≥ 18 required — skipping auto-fill"` and PS emits `Write-Warning "detect-stack: Node >= 18 required -- skipping auto-fill"`. When skipped due to download failure: bash emits `warn "detect-stack: could not download script — skipping auto-fill"` and PS emits `Write-Warning "detect-stack: could not download script -- skipping auto-fill"`. These exact strings are used by T-005 installer tests for assertion matching. No other skip condition emits a user-visible line (node execution failure is absorbed by the `[ -n "$_ds_json" ]` guard and produces no warn).
- **512 KB boundary is exclusive (`>`, not `>=`):** The guard `s.size > MAX_FILE_SIZE` uses strict greater-than. A file of exactly `512 * 1024 = 524288` bytes is accepted and read. A file of `524289` bytes is rejected with a `WARN:` line. This applies identically in both `readManifest` and `readText`. The exact boundary value (524288 bytes) is never rejected.
- **`main().catch` exact error object shape:** The catch handler parameter is `err`; the stderr payload is `JSON.stringify({ error: err.message, code: err.code ?? 'UNKNOWN' })`. The property key is `error` (not `err`) — this naming is intentional to produce a consistent JSON key independent of the parameter name. `err.code` is present on Node.js system errors (e.g., `ENOENT`, `EACCES`); non-system errors without a `.code` property produce `"UNKNOWN"`. This exact shape `{"error":"<string>","code":"<string>"}` is the canonical form for fatal stderr output from detect-stack.mjs across all error paths (see also the fatal stderr standardization constraint).
- **go.work path validation: `safeAddDir` is the authoritative escape guard, not `startsWith('../')`:** The `rel.startsWith('../')` check in the go.work loop is a fast-fail optimization for the single most common escape pattern — it emits an explicit WARN and skips without calling `resolve`/`safeAddDir`. For all other potentially escaping paths — absolute paths (`/abs`, `C:\abs`), complex relatives (`sub/../../outside`), empty string, `.` (resolves to rootReal) — `resolve(rootReal, rel)` runs first, then `safeAddDir`'s `!real.startsWith(rootReal + sep) && real !== rootReal` check catches any resulting path outside the project root. The `startsWith('../')` guard is not exhaustive by design; `safeAddDir` handles all remaining cases.
- **`e.isDirectory()` returns `false` for symlinked directories in `expandGlob`:** `readdir(dir, { withFileTypes: true })` returns `Dirent` entries. `Dirent.isDirectory()` is `true` only for true (non-symlink) directories; a symlink to a directory returns `isSymbolicLink() === true` and `isDirectory() === false`. Therefore, workspace subdirectories that are symlinks to other directories are NOT matched by wildcard glob patterns — `if (!e.isDirectory()) continue` skips them. A symlinked workspace dir can only be included by listing it as a literal non-wildcard pattern (e.g., `packages/link-to-shared`), which bypasses `readdir` and goes directly through `safeAddDir` + `realpath`. This is documented behavior: glob expansion follows true directories only.
- **Read-only CLAUDE.md is absorbed as a graceful fill failure:** If CLAUDE.md has read-only permissions, `fs.renameSync(tmp, mdPath)` throws → the catch block attempts `fs.writeFileSync(mdPath, content, 'utf8')` → also throws `EACCES`/`EPERM` → exception propagates to `main().catch()` → `{"error":"...","code":"EACCES"}` written to stderr, `{}\n` to stdout, process exits 0. The original CLAUDE.md is unchanged. The `_fill_claude_md` call returns 0 (node exited 0) and the installer continues; the diagnostic appears only in the logfile. On read-only targets, `<command>` placeholders are preserved intact.
- **T-005 PS test harness must extract `Set-ClaudeMdFields` using function-boundary parsing:** The PowerShell test file `tests/scripts/installer-fill.test.ps1` must extract the function body from `install.ps1` using: `(Get-Content install.ps1 -Raw) -match '(?ms)(function Set-ClaudeMdFields\s*\{.*?^\})'` with `$Matches[1]` capturing the full body. The `(?ms)` flags enable multiline (`^`/`$` match line boundaries) and dotall (`.` matches newlines) mode. This pattern is resilient to internal whitespace variation, indentation changes, and line-count shifts. The function body delimiter is `^\}` — a closing brace at column 0 on its own line.
- **Double-quote characters in manifest values are safe through env-var JSON transport (bash):** In `_fill_claude_md`, the JSON string is passed via `_CC_JSON="$_json"` — a double-quoted shell variable assignment. Double-quote characters embedded in the JSON value (e.g., a `description` like `"A "fast" server"`) are preserved verbatim inside the env var; the assignment uses word-splitting-safe double-quote wrapping. Inside the node heredoc, `process.env._CC_JSON` retrieves the raw string; `JSON.parse()` handles all embedded escape sequences. No additional shell-level escaping of double quotes is required before the assignment.
- **CLAUDE.md BOM is stripped before fill regex execution:** The node fill script reads CLAUDE.md as `fs.readFileSync(mdPath, 'utf8').replace(/^﻿/, '')`. This strips a UTF-8 BOM (U+FEFF, `EF BB BF`) from the very start of the file before any regex operations. Without this strip, the fill regex fails to match the first line because `﻿` precedes the first `^`-anchored content. After fill, the BOM-free content is written back — CLAUDE.md is permanently de-BOM'd after one fill pass. This is intentional: CLAUDE.md is plain UTF-8.
- **Concurrent installer instances produce a last-writer-wins race:** If two installer processes run simultaneously against the same project directory, each creates `CLAUDE.md.tmp.<pid>` with a unique PID. However, each invocation's startup sweep `rm -f "${_md}.tmp."*` removes ALL `.tmp.*` files, including one belonging to a concurrently running invocation. If the sweep fires while the concurrent process is between `writeFileSync` and `renameSync`, the concurrent `renameSync` fails → graceful fallback. Concurrent installation is not a supported use case and no file-lock mechanism is added. Both processes produce equivalent content (same source manifest); the last `renameSync`/`writeFileSync` to complete wins, and no partial or corrupt CLAUDE.md can result.
- **Fatal stderr JSON shape is standardized across all error paths:** All fatal diagnostics written to stderr must include both `error` and `code` string properties: (1) `main().catch(err)` → `{error: err.message, code: err.code ?? 'UNKNOWN'}`; (2) `process.on('unhandledRejection', err)` → `{error: String(err), code: 'UNHANDLED_REJECTION'}`; (3) `process.on('uncaughtException', err)` → `{error: err.message ?? String(err), code: err.code ?? 'UNCAUGHT_EXCEPTION'}`. The `code` field is never omitted. This standardization allows T-002 tests and automated log parsers to assert on the full shape without conditional field checks.
- **PS `[Console]::OutputEncoding` must be saved and restored to avoid session side effects:** `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8` permanently alters the encoding for the remainder of the terminal session. The detect-stack block in `install.ps1` must wrap this assignment in save/restore: `$_prevConsoleEnc = [Console]::OutputEncoding; $_prevOutEnc = $OutputEncoding` before the block, then `[Console]::OutputEncoding = $_prevConsoleEnc; $OutputEncoding = $_prevOutEnc` after it — inside a `try/finally` so restoration occurs even if the node invocation throws. Users running `install.ps1` inside a long-lived PS session (IDE terminal, CI runner) must not see encoding behavior change after the installer exits.
- **Fill regex matches any line in CLAUDE.md that looks like a field — including lines inside fenced code blocks:** The fill regex uses the `m` flag and operates on the entire file content as a single string. A line inside a fenced code block (` ``` `) that happens to match the pattern (e.g., `- Build: <command>`) will be replaced. The `project-template/CLAUDE.md` contains no fenced code blocks with field-like lines, so this is not an issue for first-run installs. On subsequent runs, the idempotency constraint prevents re-replacement (a line already containing real content does not match). Users who manually add code blocks containing `- Label: <something>` patterns to their CLAUDE.md should be aware that those lines may be replaced during an install/init re-run. No code-block detection is added to the regex in BUG-015.
- **T-002 must include a monorepo priority test when multiple workspace configs coexist:** The test suite must verify that when `pnpm-workspace.yaml` and `melos.yaml` both exist in `rootNames`, only `pnpm-workspace.yaml` patterns are used (melos is ignored). Similarly, when `melos.yaml` and `package.json#workspaces` both exist, only `melos.yaml` is used. These tests mock `readText` to return valid content for the winning config and verify that the loser's patterns are never expanded. This confirms the `if/else-if/else-if` priority chain is exercised explicitly, not just documented.
- **Empty monorepo — workspace patterns defined but zero sub-packages discovered:** If a monorepo manifest (e.g., `pnpm-workspace.yaml`) is present and patterns are parsed, but the resolved patterns match no existing directories (because `apps/` doesn't exist, is empty, or all directories are in GLOBAL_IGNORE), `workspaceDirs` is `[]` after expansion. `monorepo: true` is still set in the JSON output (the manifest exists), but the `workspaceDirs` field is omitted (empty array stripped by the falsy-strip pass). `workspacePkgs` is `[]`. Detectors run with only `rootPkg`. This is correct and expected behavior — an empty monorepo workspace is not an error.
- **Multiple Node.js installations: first match in PATH is used, no fallback to alternatives:** `command -v node` (bash) and `Get-Command node -ErrorAction SilentlyContinue` (PS) resolve to the first `node` binary in `PATH`. If this binary is Node 16 (e.g., system node) while Node 18 is installed at a different PATH location, the installer sees v16 < 18, emits the skip warn, and does not attempt to find an alternative `node` binary. The installer does not iterate PATH entries, check version managers (nvm, nodenv, asdf, volta), or fall back to `nodejs`, `node18`, or other executable names. The user is responsible for ensuring the correct `node` is first in PATH.
- **No contradiction between `isDirectory()` filter and `safeAddDir` circular-symlink check — they operate on disjoint code paths:** In `expandGlob` (wildcard path), `readdir` + `e.isDirectory()` filters out symlinked directories before `safeAddDir` is ever called — symlinked dirs are silently skipped at the `isDirectory()` guard. `safeAddDir`'s `realpath` + `visited` circular-symlink detection is therefore irrelevant for wildcard-expanded dirs. In the literal-path branch (no wildcards), `resolve(rootReal, pattern)` → `safeAddDir` → `realpath` → `visited.has(real)` does detect circular symlinks. The two mechanisms are complementary and non-overlapping: wildcard expansion avoids symlinks by nature of `isDirectory()`; literal expansion validates them via `realpath`. No special casing is needed to reconcile them.
- **`label` in `new RegExp(...)` requires no escaping — it is a hardcoded constant:** The `label` variable inside the fill scripts comes exclusively from the hardcoded `FIELDS` object values: `'Name'`, `'Description'`, `'Stack'`, `'Build'`, `'Test'`, `'Lint'`, `'Format'`, `'Setup'`. None of these strings contain regex metacharacters (`.`, `*`, `+`, `?`, `(`, `)`, `[`, `]`, `{`, `}`, `^`, `$`, `|`, `\`). Label escaping via `.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')` is therefore not added to the BUG-015 implementation. If FIELDS were ever extended with a label containing metacharacters, escaping would become mandatory — this is documented as a future extension requirement.
- **T-006 cc-init.md Step 2 must specify script-path resolution and fallback:** When cc-init runs in a user's project, `node scripts/detect-stack.mjs "$PWD"` uses a path relative to the current working directory. This resolves correctly only when the user runs cc-init from the project root where `scripts/detect-stack.mjs` was placed during install. Step 2 must guard: if `scripts/detect-stack.mjs` does not exist (e.g., user ran cc-init without having run the full installer, or in a deep subdirectory), cc-init must attempt to download detect-stack.mjs to a temp path (same URL as the installer uses) and invoke from there, or skip auto-fill with one warn. The step must never assume the script exists at a relative path without checking first.
- **T-005 must include a test verifying that fill functions exit cleanly on a read-only CLAUDE.md:** `tests/scripts/installer-fill.test.sh` must include a case that: (1) creates a CLAUDE.md with `chmod 444`; (2) calls `_fill_claude_md`; (3) asserts exit code is 0 and the file content is unchanged. `tests/scripts/installer-fill.test.ps1` must include a parallel case using `Set-ItemProperty -Name IsReadOnly -Value $true`. Both tests verify that a read-only target never causes the installer to abort or produce a non-zero exit.
- **cc-init invoked from a workspace subdirectory scans that dir only — advisory warn, no upward traversal:** When T-006 cc-init Step 2 calls `node scripts/detect-stack.mjs "$PWD"`, the script receives the caller's current directory as root. If the user runs cc-init from `apps/web/` inside a monorepo, detect-stack.mjs scans `apps/web/` and sees no monorepo config — `monorepo: false`, no workspace expansion. This is correct behavior for the scoped package. T-006 Step 2 must add an advisory check: if the scanned root contains neither `pnpm-workspace.yaml`, `melos.yaml`, `go.work`, nor `package.json#workspaces`, but the script finds a `package.json` with a `name` field (a workspace package), cc-init emits one `warn` suggesting the user re-run from the project root for full monorepo detection. No upward directory traversal is performed; the warn is advisory only and detection continues with the scoped result.
- **Detector return object interface:** Every detector function returns a plain object with a subset of these optional string fields: `stack`, `build`, `test`, `lint`, `format`, `setup`, `name`, `goVersion`. Functions that detect nothing return `{}`. The merge step uses `MERGE_FIELDS = ['stack','build','test','lint','format','setup','name','goVersion']` — only these 8 keys are merged via first-wins; any other keys a detector may return are silently ignored. `detectDb` returns a plain string or `undefined`. `detectInfraCI` returns `{infra?: string, ci?: string}`. `detectArchitecture` returns a string or `undefined`. `classifyProject` returns `{projectType: string, layeredArchitecture: string}`. These four functions are NOT processed through `MERGE_FIELDS` — their results are assigned directly to the `raw` output object.
- **T-002 must include an explicit second-run idempotency test:** A test must verify that running the fill logic twice with the same JSON produces no change on the second pass. The test: (1) produce a CLAUDE.md string with `- Build: <command>`; (2) apply the fill regex with `{build: 'npm run build'}`; (3) verify result is `- Build: npm run build`; (4) apply the same fill regex again with the same JSON; (5) assert the string is byte-for-byte identical to step 3. This confirms the constraint that a filled value never matches `'^(\\s*-?\\s*Build:)\\s*(<[^>]*>)?\\s*(\\r?)$'` because `npm run build` is neither a `<placeholder>` nor blank.
- **cc-resume detect-stack fills blank fields only — does NOT refresh already-populated fields after manifest changes:** If a developer upgrades their stack (e.g., migrates from React to Vue, adds a Go backend, changes the build tool) after a prior fill pass, the already-populated CLAUDE.md fields (`- Stack: typescript`, `- Build: npm run build`) are NOT updated by cc-resume's detect-stack call. The idempotency rule — "a line with a real value never matches the fill regex" — applies equally in cc-resume. To re-detect after a major manifest change, the user must manually clear the outdated field value (replace with `<command>` or blank it) and then re-run cc-resume or cc-init. This constraint is intentional: auto-overwriting user-customized values on every resume would be destructive.
- **cc-resume must run detect-stack if any CLAUDE.md command fields remain blank:** After `cc-resume` Step 2 reads CLAUDE.md, if any of the command fields (`Build`, `Test`, `Lint`, `Format`, `Setup`) are still `<command>` (any case) or blank, and `scripts/detect-stack.mjs` exists at `$PWD`, the skill must run `node scripts/detect-stack.mjs "$PWD"`, capture the JSON, and fill the blank fields using a single `Edit` call — same idempotency rules as cc-init Step 2 (only blank/placeholder lines replaced, user-customized values never overwritten). If all five fields are already populated, detection is skipped to avoid unnecessary disk I/O. If `scripts/detect-stack.mjs` does not exist, this step is silently skipped. This ensures sessions resumed after adding new manifests (e.g., adding a `go.mod` to an existing JS repo) automatically pick up the new stack.
- **`detect-stack.mjs` requires only read access to the project tree and `node` ≥ 18 in PATH — no execute bit needed:** The script is always invoked as `node scripts/detect-stack.mjs "$PWD"` (explicit interpreter), never as a standalone executable. It therefore does not require an execute permission bit (`chmod +x`) on any platform. In minimal Alpine Linux or restricted CI containers: (1) `node` ≥ 18 must be in PATH (the version check guards this); (2) the script needs read access to project files (`stat`, `readdir`, `readFile` calls); (3) stdout must not be redirected by the container runtime. Alpine's `ash` (not `bash`) is not used — the installer is always invoked as `bash install.sh`. If `bash` is absent from the container, the installer fails before reaching detect-stack; this is outside BUG-015 scope.
- **PowerShell Constrained Language Mode (CLM) causes `Set-ClaudeMdFields` to fail gracefully:** In CLM (enforced by WDAC or AppLocker on hardened Windows Server targets), .NET type method calls like `[System.IO.File]::WriteAllText`, `[System.IO.Path]::GetTempFileName()`, and `[System.Text.UTF8Encoding]::new(...)` are blocked. The detect-stack block in `install.ps1` must check `$ExecutionContext.SessionState.LanguageMode` at entry: if the value is `ConstrainedLanguage`, emit `Write-Warning "detect-stack: PowerShell Constrained Language Mode detected — skipping auto-fill"` and set `$dsSkip = $true`. The `node -e` invocation (a native executable call) is not affected by CLM, but since the JSON temp-file write cannot complete, the entire block is skipped. The baseline `CLAUDE.md` (already downloaded before this block) is preserved intact.
- **`Set-ClaudeMdFields` is defined inline in `install.ps1` — no separate execution policy bypass is required:** `Set-ClaudeMdFields` is a PowerShell function body defined inside `install.ps1` and called in the same script scope. It executes under the same execution policy context as the parent `install.ps1` invocation. If the user can run `install.ps1` (typically via `powershell -ExecutionPolicy Bypass -File install.ps1`), the inline function runs without any additional policy exemption. The `node -e $script ...` call within the function invokes Node.js (a native executable), which is not subject to PowerShell execution policy. No `Set-ExecutionPolicy`, `Unblock-File`, or signing is needed for the inline node invocation.
- **`install.ps1` must set TLS 1.2 before any `Invoke-WebRequest` call:** `[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12` must appear once at the start of the download block — before any `Invoke-WebRequest` invocation. The `-bor` (bitwise-OR) form adds TLS 1.2 without removing other protocols already in the list. On Windows Server 2012 R2 and early Windows 10 builds, the default SecurityProtocol does not include TLS 1.2 and HTTPS downloads fail silently. This line is idempotent and harmless on modern systems.
- **All wildcard characters in negative exclusion patterns make them no-ops:** In `expandPatterns`, negative entries are processed via `resolve(rootReal, p.slice(1))`. `path.resolve()` treats `*`, `?`, and `**` as literal directory-name characters — they are not expanded. A negative pattern like `!apps/*` resolves to the literal path `/root/apps/*`, which contains a `*` character and will never equal a real directory path in the `d === negPath || d.startsWith(negPath + sep)` check. **Any negative pattern containing a wildcard is therefore a no-op** — only literal-path negative patterns (e.g., `!apps/internal`) are effective exclusions. This is documented behavior for BUG-015; recursive or glob-based exclusion support is deferred.
- **Polyglot `stack` string order is deterministic by code, not by filesystem ordering:** The `langSignals` array is populated by sequential `if (rootNames.has(...))` checks in a fixed hardcoded order: `package.json` → `go.mod` → `Cargo.toml` → `pom.xml/build.gradle`. This order is determined by the code's if-chain, not by iterating `rootNames` or sorting `readdir` output. The resulting slash-joined string (e.g., `typescript/go`) is therefore fully deterministic on all filesystems and OS configurations. No explicit sort of `rootNames` is needed.
- **PS Node version regex uses no start anchor to tolerate leading content:** The PS version extractor must use `$nmRaw -match 'v(\d+)'` (without a `^` start anchor). The anchor-free form matches `v<digits>` anywhere in the string, correctly handling leading whitespace, ANSI escape sequences, or vendor branding text before the version line (e.g., `  v18.0.0` with a leading space). The literal `v` is still required immediately before the digits to prevent matching arbitrary digit sequences. This makes the PS extractor more robust than the bash `sed` form, which requires strict `^v` at line start.
- **Process-level `unhandledRejection` and `uncaughtException` listeners are required:** Immediately before the `if (process.argv[1] === __filename)` guard, `detect-stack.mjs` must register: `process.on('unhandledRejection', err => { process.stderr.write(JSON.stringify({error:String(err)})+'\n'); process.stdout.write('{}\n'); process.exit(0); }); process.on('uncaughtException', err => { process.stderr.write(JSON.stringify({error:String(err)})+'\n'); process.stdout.write('{}\n'); process.exit(0); });`. These catch any rejection from a detached (non-awaited) promise or a synchronous throw outside `main()`. In Node ≥ 15, an unhandled rejection causes a non-zero exit code by default, breaking the installer's JSON capture. Both handlers write a `{}\n` sentinel to stdout and exit 0, keeping the installer's capture-and-check logic intact.
- **Bold and decorated label variants are out of scope for BUG-015:** The fill regex `'^(\\s*-?\\s*Label:)...'` matches only plain labels of the form `[whitespace][hyphen][whitespace]Label:`. Markdown-decorated variants like `**Build:**`, `**- Build:**`, or `` `Build:` `` do NOT match and are treated as user-customized content that is never touched. The `project-template/CLAUDE.md` uses plain undecorated labels only. Supporting bold or backtick-wrapped label formats is explicitly deferred.
- **PS installer must clean up the empty base file created by `GetTempFileName()`:** `[System.IO.Path]::GetTempFileName()` creates an empty `.tmp` file on disk as a side effect. If the installer derives the script path by appending `.mjs` (e.g., `$dsTmp = [System.IO.Path]::GetTempFileName() + '.mjs'`), the original `.tmp` file is orphaned. The correct pattern is: `$base = [System.IO.Path]::GetTempFileName(); Remove-Item -LiteralPath $base -Force -ErrorAction SilentlyContinue; $dsTmp = $base + '.mjs'`. This sequence saves the base path, deletes the empty file, then derives the script path — leaving no orphan regardless of whether the subsequent download succeeds or fails.
- **Detector execution priority order (fixed in code, must not be reordered):** The `detectorResults` array in `main()` runs detectors in this exact order; the first non-`undefined` value per field wins: (1) Ionic, (2) Capacitor, (3) React Native + Expo, (4) React Native bare, (5) Flutter, (6) Angular, (7) Next.js, (8) NestJS, (9) React, (10) Vue, (11) TypeScript/ts-node, (12) Go, (13) Python, (14) Rust, (15) Scala, (16) Spring Boot, (17) Quarkus, (18) Java (generic), (19) .NET/C#, (20) iOS/Xcode, (21) Android. Example: a project with both `next` and `react` in deps — Next.js fires at position 7, sets `stack: 'typescript'` and `build: 'next build'`; React at position 9 finds `merged.stack` already set and produces no override. This order is a hard constraint; reordering detectors changes output for polyglot projects.
- **`renameSync` fallback to non-atomic write on cross-device failure:** In the `_fill_claude_md` node script, `fs.renameSync(tmp, mdPath)` may fail with `EXDEV` on some Linux configurations where `/tmp` is a separate filesystem from the project directory. The catch block falls back to `fs.writeFileSync(mdPath, content, 'utf8')` followed by `try { fs.unlinkSync(tmp); } catch {}`. This fallback is NOT atomic: a concurrent write or SIGKILL between `writeFileSync` and the process exit could leave CLAUDE.md in a partial state. The fallback is acceptable because: (1) `renameSync` failure is rare and requires cross-device conditions; (2) the temp file was already successfully written, so content is valid; (3) the original CLAUDE.md was read from the same path. The `renameSync` path remains the primary path; the fallback is a best-effort safety net.
- **`workspaceDirs` Unicode sort order affects workspace-aware detector precedence:** `workspaceDirs.sort()` uses JavaScript's default Unicode code-point lexicographic order. This sorted order determines the iteration sequence of `workspacePkgs`, which feeds `detectAngular(rootPkg, workspacePkgs)`. If multiple workspace packages contain `@angular/core`, the Angular version from the alphabetically-first workspace directory wins. In repos with numerically-named subdirectories, `app10` sorts before `app2` (lexicographic, not numeric). This is a documented, deterministic behavior; it is not a bug. The `workspaceDirs` field in JSON output also reflects this sorted order.

---

### Task 1 (T-001): `scripts/detect-stack.mjs` — complete implementation

**Files:**
- Create: `scripts/detect-stack.mjs`

**Interfaces:**
- Consumes: `process.argv[2]` — absolute project root path (falls back to `process.cwd()`)
- Consumes: `CC_GLOB_DEPTH` env var (integer 1–20, default 5)
- Produces: one JSON object on stdout (`JSON.stringify(result, null, 2) + '\n'`, UTF-8, no BOM)
- Produces: `WARN:` plain text lines on stderr for non-fatal errors
- Produces: `{"error":"...","code":"..."}` JSON on stderr for root `readdir` failure
- Exports: all helper and detector functions (for Vitest mocking in Task 2)

- [X] **T-001-1: Create `scripts/` directory**

```bash
mkdir -p scripts
```

- [X] **T-001-2: Create `scripts/detect-stack.mjs`**

```javascript
// scripts/detect-stack.mjs
import { readdir, readFile, stat, realpath } from 'node:fs/promises';
import { join, resolve, basename, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Constants ────────────────────────────────────────────────────────────────
export const GLOBAL_IGNORE = new Set([
  'node_modules', '.git', '.svn', '.hg', '.expo', '.dart_tool', '.pub-cache',
  '__pycache__', '.gradle', '.m2', 'vendor', 'dist', 'build', 'out',
  '.next', '.nuxt', '.cache', '.parcel-cache', '.venv', '.turbo',
]);
const MAX_FILE_SIZE   = 512 * 1024;
const MAX_DIRS        = 200;
const READDIR_TIMEOUT = 10_000;
const DEFAULT_DEPTH   = 5;
const MAX_DEPTH       = 20;

export const globDepth = (() => {
  const v = parseInt(process.env.CC_GLOB_DEPTH ?? '', 10);
  if (!Number.isFinite(v)) return DEFAULT_DEPTH;
  return Math.max(1, Math.min(MAX_DEPTH, v));
})();

// ── Low-level helpers ─────────────────────────────────────────────────────────
export function stripBOM(s) { return s.replace(/^﻿/, ''); }

export function warn(msg) { process.stderr.write(`WARN: ${msg}\n`); }

export async function readdirSafe(dir) {
  return Promise.race([
    readdir(dir, { withFileTypes: true }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), READDIR_TIMEOUT)),
  ]).catch(err => {
    warn(`readdir ${err.message === 'timeout' ? 'timeout' : 'error'} — skipped: ${dir}`);
    return [];
  });
}

export async function readManifest(filepath) {
  try {
    const s = await stat(filepath);
    if (s.size === 0) { warn(`zero-byte manifest skipped: ${filepath}`); return null; }
    if (s.size > MAX_FILE_SIZE) { warn(`manifest too large (>512KB), skipped: ${filepath}`); return null; }
    const raw = JSON.parse(stripBOM(await readFile(filepath, 'utf8')));
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
    if (Object.keys(raw).length === 0) return null;
    return raw;
  } catch { return null; }
}

export async function readText(filepath, maxLines = Infinity) {
  try {
    const s = await stat(filepath);
    if (s.size === 0 || s.size > MAX_FILE_SIZE) return null;
    const raw = stripBOM(await readFile(filepath, 'utf8'));
    return maxLines === Infinity ? raw : raw.split('\n').slice(0, maxLines).join('\n');
  } catch { return null; }
}

export function pkgDep(pkg, name) {
  return !!(pkg?.dependencies?.[name] || pkg?.devDependencies?.[name]);
}
export function pkgProdDep(pkg, name) { return !!(pkg?.dependencies?.[name]); }

// ── Glob expansion ─────────────────────────────────────────────────────────────
export function matchWild(name, pattern) {
  const re = '^' + pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '*')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]') + '$';
  return new RegExp(re).test(name);
}

export async function safeAddDir(abs, rootReal, visited) {
  try {
    const real = await realpath(abs);
    if (!real.startsWith(rootReal + sep) && real !== rootReal) {
      warn(`symlink target outside project root — skipped: ${abs}`);
      return false;
    }
    if (visited.has(real)) return false;
    visited.add(real);
    return true;
  } catch { return false; }
}

export async function expandGlob(pattern, rootReal, visited, depth = 0) {
  if (depth >= globDepth) return [];
  if (pattern.startsWith('/') || /^[A-Za-z]:[\\/]/.test(pattern)) {
    warn(`absolute path in workspace entry rejected: ${pattern}`);
    return [];
  }
  const segs    = pattern.split('/').filter(Boolean);
  const wildIdx = segs.findIndex(s => s.includes('*') || s.includes('?'));
  if (wildIdx === -1) {
    const abs = resolve(rootReal, pattern);
    return (await safeAddDir(abs, rootReal, visited)) ? [abs] : [];
  }
  const base    = resolve(rootReal, ...segs.slice(0, wildIdx));
  const wcSeg   = segs[wildIdx];
  const rest    = segs.slice(wildIdx + 1).join('/');
  const entries = await readdirSafe(base);
  const results = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (GLOBAL_IGNORE.has(e.name) || e.name.startsWith('.')) continue;
    if (!matchWild(e.name, wcSeg)) continue;
    if (rest) {
      results.push(...await expandGlob(rest, join(base, e.name), visited, depth + 1));
    } else {
      const abs = join(base, e.name);
      if (await safeAddDir(abs, rootReal, visited)) results.push(abs);
    }
  }
  return results;
}

export async function expandPatterns(patterns, rootReal, visited) {
  const positive = patterns.filter(p => !p.startsWith('!'));
  const negative = patterns.filter(p => p.startsWith('!')).map(p => resolve(rootReal, p.slice(1)));
  const dirs = [];
  for (const p of positive) dirs.push(...await expandGlob(p, rootReal, visited));
  return [...new Set(dirs)].filter(d => !negative.some(n => d === n || d.startsWith(n + sep)));
}

// ── YAML line-scanners ─────────────────────────────────────────────────────────
export function normalizeMelosLine(raw) {
  let s = raw.trim();
  if (!s || s.startsWith('#')) return null;
  s = s.replace(/^-\s+/, '');
  s = s.replace(/^(["'])(.*)\1$/, '$2');
  s = s.replace(/#.*$/, '').trim();
  s = s.replace(/&\w+/g, '').replace(/\*\w+/g, '').trim();
  if (!s || s.startsWith('#')) return null;
  return s;
}

export function parseMelosPackages(content) {
  const lines = content.split('\n');
  const results = [];
  let inPkgs = false;
  for (const line of lines) {
    const col0NotComment = line.length > 0 && line[0] !== '#' && line[0] !== ' ' && line[0] !== '\t';
    if (col0NotComment && /^packages\s*:/.test(line)) {
      const flow = line.match(/:\s*\[([^\]]*)\]/);
      if (flow) {
        flow[1].split(',').map(normalizeMelosLine).filter(Boolean).forEach(p => results.push(p));
        inPkgs = false;
      } else { inPkgs = true; }
      continue;
    }
    if (inPkgs) {
      if (col0NotComment && !/^[-\s]/.test(line)) break;
      const n = normalizeMelosLine(line);
      if (n) results.push(n);
    }
  }
  return results;
}

export function parseYamlList(content, key) {
  const lines = content.split('\n');
  const results = [];
  let inSection = false;
  for (const line of lines) {
    const col0NC = line.length > 0 && line[0] !== '#' && line[0] !== ' ' && line[0] !== '\t';
    if (col0NC && new RegExp('^' + key + '\\s*:').test(line)) {
      const flow = line.match(/:\s*\[([^\]]*)\]/);
      if (flow) {
        flow[1].split(',').map(normalizeMelosLine).filter(Boolean).forEach(p => results.push(p));
        inSection = false;
      } else { inSection = true; }
      continue;
    }
    if (inSection) {
      if (col0NC && !/^[-\s]/.test(line)) break;
      const n = normalizeMelosLine(line);
      if (n) results.push(n);
    }
  }
  return results;
}

// ── Package manager ───────────────────────────────────────────────────────────
export function detectPackageManager(names) {
  if (names.has('bun.lockb'))         return 'bun';
  if (names.has('pnpm-lock.yaml'))    return 'pnpm';
  if (names.has('yarn.lock'))         return 'yarn';
  if (names.has('package-lock.json')) return 'npm';
  return undefined;
}

// ── Angular version extraction ────────────────────────────────────────────────
export function extractMajorVersion(v) {
  if (!v) return null;
  let s = v.trim();
  if (s.startsWith('workspace:')) s = s.slice('workspace:'.length).trim();
  s = s.replace(/^[~^>=<]+/, '');
  const major = s.split('.')[0];
  return (major && /^\d+$/.test(major)) ? major : null;
}

// ── Detectors (return partial result objects) ──────────────────────────────────
export function detectIonic(names) {
  if (!names.has('ionic.config.json')) return {};
  return { stack: 'ionic', build: 'ionic build', test: 'npm test', setup: 'npm install' };
}

export function detectCapacitor(names) {
  if (names.has('ionic.config.json')) return {};
  if (!names.has('capacitor.config.json') && !names.has('capacitor.config.ts')) return {};
  return { stack: 'capacitor', build: 'npx cap build', setup: 'npm install && npx cap sync' };
}

export function detectRNExpo(pkg) {
  if (!pkg || !pkgDep(pkg, 'react-native') || !pkgDep(pkg, 'expo')) return {};
  return { stack: 'react-native-expo', build: 'expo build', test: 'jest', setup: 'npm install' };
}

export function detectRNBare(pkg, names) {
  if (!pkg || !pkgDep(pkg, 'react-native')) return {};
  if (names.has('ionic.config.json') || names.has('capacitor.config.json') || names.has('capacitor.config.ts')) return {};
  return { stack: 'react-native', build: 'react-native bundle', test: 'jest', setup: 'npm install' };
}

export async function detectFlutter(names, root) {
  if (!names.has('pubspec.yaml')) return {};
  const c = await readText(join(root, 'pubspec.yaml'));
  if (!c || !/^flutter\s*:/m.test(c)) return {};
  return { stack: 'flutter', build: 'flutter build', test: 'flutter test', lint: 'flutter analyze', format: 'dart format .', setup: 'flutter pub get' };
}

export async function detectAngular(pkg, workspacePkgs) {
  for (const p of [pkg, ...(workspacePkgs ?? [])].filter(Boolean)) {
    const v = p?.dependencies?.['@angular/core'] || p?.devDependencies?.['@angular/core'];
    const major = extractMajorVersion(v);
    if (!major) continue;
    const s = p.scripts ?? {};
    return { stack: `Angular ${major}`, build: s.build ?? 'ng build', test: s.test ?? 'ng test', lint: s.lint ?? 'ng lint', format: 'prettier --write .', setup: 'npm install' };
  }
  return {};
}

export function detectNextjs(pkg) {
  if (!pkg || !pkgDep(pkg, 'next')) return {};
  const s = pkg.scripts ?? {};
  return { stack: 'typescript', build: s.build ?? 'next build', test: s.test ?? 'jest', lint: s.lint ?? 'next lint', format: 'prettier --write .', setup: 'npm install' };
}

export function detectNestjs(pkg) {
  if (!pkg || !pkgDep(pkg, '@nestjs/core')) return {};
  const s = pkg.scripts ?? {};
  return { stack: 'typescript', build: s.build ?? 'nest build', test: s.test ?? 'jest', lint: s.lint ?? 'eslint .', format: 'prettier --write .', setup: 'npm install' };
}

export function detectReact(pkg) {
  if (!pkg || !pkgProdDep(pkg, 'react')) return {};
  const s = pkg.scripts ?? {};
  return { stack: 'typescript', build: s.build, test: s.test ?? 'jest', lint: s.lint, format: 'prettier --write .', setup: 'npm install' };
}

export function detectVue(pkg) {
  if (!pkg || !pkgProdDep(pkg, 'vue')) return {};
  const s = pkg.scripts ?? {};
  return { stack: 'typescript', build: s.build, test: s.test ?? 'vitest', lint: s.lint, format: 'prettier --write .', setup: 'npm install' };
}

export function detectTSNode(pkg) {
  if (!pkg) return {};
  const s = pkg.scripts ?? {};
  const hasDep = pkgDep(pkg, 'typescript') || pkgDep(pkg, 'ts-node');
  if (!hasDep && !pkg.name) return {};
  return { stack: 'typescript', build: s.build, test: s.test, lint: s.lint, format: s.format, setup: 'npm install' };
}

export async function detectGo(names, root) {
  if (!names.has('go.mod')) return {};
  const c = await readText(join(root, 'go.mod'), 20);
  const m = c?.match(/^go\s+(\d+\.\d+)/m);
  const result = { stack: 'go', build: 'go build ./...', test: 'go test ./...', format: 'gofmt -w .', setup: 'go mod download' };
  if (m) result.goVersion = m[1];
  return result;
}

export async function detectPython(names, root) {
  if (!names.has('pyproject.toml') && !names.has('requirements.txt') &&
      !names.has('Pipfile') && !names.has('uv.lock') && !names.has('poetry.lock') && !names.has('hatch.toml')) return {};
  if (names.has('uv.lock')) return { stack: 'python', test: 'uv run pytest', lint: 'uv run ruff check .', format: 'uv run ruff format .', setup: 'uv sync' };
  const py = names.has('pyproject.toml') ? await readText(join(root, 'pyproject.toml')) : null;
  if (py && /^\[tool\.uv\]/m.test(py)) return { stack: 'python', test: 'uv run pytest', lint: 'uv run ruff check .', format: 'uv run ruff format .', setup: 'uv sync' };
  if ((py && /^\[tool\.poetry\]/m.test(py)) || names.has('poetry.lock')) return { stack: 'python', test: 'poetry run pytest', lint: 'poetry run ruff check .', format: 'poetry run ruff format .', setup: 'poetry install' };
  if (names.has('Pipfile')) return { stack: 'python', test: 'pipenv run pytest', setup: 'pipenv install' };
  if ((py && /^\[tool\.hatch\]/m.test(py)) || names.has('hatch.toml')) return { stack: 'python', test: 'hatch run test', setup: 'hatch env create' };
  if (names.has('requirements.txt')) return { stack: 'python', test: 'pytest', setup: 'pip install -r requirements.txt' };
  if (py) return { stack: 'python', test: 'pytest', setup: 'pip install -e .' };
  return {};
}

export async function detectRust(names, root) {
  if (!names.has('Cargo.toml')) return {};
  const c = await readText(join(root, 'Cargo.toml'));
  let name;
  if (c) {
    const blocks = c.split(/\n(?=\[)/);
    for (const b of blocks) {
      if (!/^\[package\]/.test(b)) continue;
      const m = b.match(/^name\s*=\s*"([^"]+)"/m);
      if (m) { name = m[1]; break; }
    }
  }
  return { stack: 'rust', name, build: 'cargo build', test: 'cargo test', lint: 'cargo clippy -- -D warnings', format: 'cargo fmt', setup: 'cargo fetch' };
}

export function detectScala(names) {
  if (!names.has('build.sbt')) return {};
  return { stack: 'scala', build: 'sbt compile', test: 'sbt test', lint: 'sbt scalafmt --check', format: 'sbt scalafmt', setup: 'sbt update' };
}

export async function detectSpringBoot(names, root) {
  const hasPom = names.has('pom.xml');
  const hasBuild = names.has('build.gradle') || names.has('build.gradle.kts');
  if (!hasPom && !hasBuild) return {};
  if (hasPom) {
    const c = await readText(join(root, 'pom.xml'));
    if (c?.includes('spring-boot-starter')) {
      const w = names.has('mvnw') ? './mvnw' : 'mvn';
      return { stack: 'spring-boot', build: `${w} package -DskipTests`, test: `${w} test`, setup: `${w} dependency:resolve` };
    }
  }
  if (hasBuild) {
    const fname = names.has('build.gradle.kts') ? 'build.gradle.kts' : 'build.gradle';
    const c = await readText(join(root, fname));
    if (c?.includes('spring-boot-starter')) {
      const w = names.has('gradlew') ? './gradlew' : 'gradle';
      return { stack: 'spring-boot', build: `${w} build`, test: `${w} test`, setup: `${w} dependencies` };
    }
  }
  return {};
}

export async function detectQuarkus(names, root) {
  const hasPom = names.has('pom.xml');
  const hasBuild = names.has('build.gradle') || names.has('build.gradle.kts');
  if (!hasPom && !hasBuild) return {};
  const fname = hasPom ? 'pom.xml' : (names.has('build.gradle.kts') ? 'build.gradle.kts' : 'build.gradle');
  const c = await readText(join(root, fname));
  if (!c?.includes('quarkus')) return {};
  const w = hasBuild ? (names.has('gradlew') ? './gradlew' : 'gradle') : (names.has('mvnw') ? './mvnw' : 'mvn');
  return { stack: 'java', build: `${w} package`, test: `${w} test`, setup: hasBuild ? `${w} quarkusDev` : `${w} quarkus:dev` };
}

export async function detectJava(names, root) {
  const hasPom = names.has('pom.xml');
  const hasBuild = names.has('build.gradle') || names.has('build.gradle.kts');
  if (!hasPom && !hasBuild) return {};
  if (hasPom) {
    const w = names.has('mvnw') ? './mvnw' : 'mvn';
    return { stack: 'java', build: `${w} package`, test: `${w} test`, setup: `${w} dependency:resolve` };
  }
  const w = names.has('gradlew') ? './gradlew' : 'gradle';
  return { stack: 'java', build: `${w} build`, test: `${w} test`, setup: `${w} dependencies` };
}

export function detectDotNet(names) {
  const csproj = [...names].find(n => n.endsWith('.csproj'));
  const sln    = [...names].find(n => n.endsWith('.sln'));
  if (!csproj && !sln) return {};
  return { stack: 'csharp', build: 'dotnet build', test: 'dotnet test', lint: 'dotnet format --verify-no-changes', format: 'dotnet format', setup: sln ? `dotnet restore ${sln}` : 'dotnet restore' };
}

export async function detectIOS(names, root) {
  const xcw = [...names].find(n => n.endsWith('.xcworkspace'));
  const xcp = [...names].find(n => n.endsWith('.xcodeproj'));
  if (!xcw && !xcp) return {};
  const target = xcw ?? xcp;
  const scheme = target.replace(/\.(xcworkspace|xcodeproj)$/, '');
  return { stack: 'swift', build: `xcodebuild -workspace ${target} -scheme ${scheme} -sdk iphonesimulator build`, test: 'xcodebuild test', setup: names.has('Podfile') ? 'pod install' : 'swift package resolve' };
}

export async function detectAndroid(names, root) {
  const aEntries = await readdirSafe(join(root, 'android'));
  if (!aEntries.length) return {};
  const aNames = new Set(aEntries.map(e => e.name));
  if (!aNames.has('build.gradle') && !aNames.has('build.gradle.kts')) return {};
  const w = names.has('gradlew') ? './gradlew' : 'gradle';
  let isKotlin = false;
  try {
    const srcE = await readdirSafe(join(root, 'android', 'app', 'src'));
    isKotlin = srcE.some(e => e.name.endsWith('.kt'));
  } catch {}
  return { stack: isKotlin ? 'kotlin' : 'java', build: `${w} assembleDebug`, test: `${w} test`, lint: `${w} lint`, setup: `${w} dependencies` };
}

// ── DB signals ────────────────────────────────────────────────────────────────
export async function detectDb(names, root, pkg, stack) {
  if (names.has('schema.prisma')) return 'prisma';
  try {
    const pD = await readdirSafe(join(root, 'prisma'));
    if (pD.some(e => e.name === 'schema.prisma')) return 'prisma';
  } catch {}
  if (names.has('migrations') || names.has('db')) return 'migrations';
  if (pkg) {
    const d = { ...pkg.dependencies, ...pkg.devDependencies };
    if (d['@prisma/client'] || d['prisma']) return 'prisma';
    if (d['pg']) return 'postgres';
    if (d['mysql2'] || d['mysql']) return 'mysql';
    if (d['mongodb'] || d['mongoose']) return 'mongodb';
    if (d['sqlite3'] || d['better-sqlite3']) return 'sqlite';
  }
  if (stack === 'go') {
    const c = await readText(join(root, 'go.mod'));
    if (c && (c.includes('gorm.io/gorm') || c.includes('entgo.io/ent') || c.includes('database/sql'))) return 'go-orm';
  }
  if (stack === 'rust') {
    const c = await readText(join(root, 'Cargo.toml'));
    if (c && (c.includes('diesel') || c.includes('sqlx'))) return 'rust-db';
  }
  if (stack === 'java' || stack === 'spring-boot') {
    const fname = names.has('pom.xml') ? 'pom.xml' : (names.has('build.gradle.kts') ? 'build.gradle.kts' : 'build.gradle');
    const c = await readText(join(root, fname));
    if (c && (c.includes('spring-data') || c.includes('hibernate'))) return 'jpa';
  }
  return undefined;
}

// ── Infra / CI ────────────────────────────────────────────────────────────────
export async function detectInfraCI(names, root) {
  let infra, ci;
  try {
    const gw = await readdirSafe(join(root, '.github', 'workflows'));
    if (gw.length > 0) ci = 'github-actions';
  } catch {}
  const hasK8s = names.has('k8s') || names.has('kubernetes') || [...names].some(n => /^(deployment|service|ingress).*\.ya?ml$/.test(n));
  if (hasK8s) infra = 'kubernetes';
  else if ([...names].some(n => n.endsWith('.tf'))) infra = 'terraform';
  else if (names.has('Dockerfile') || [...names].some(n => n.startsWith('Dockerfile.')) || names.has('docker-compose.yml') || names.has('docker-compose.yaml') || names.has('compose.yml')) infra = 'docker';
  return { infra, ci };
}

// ── Architecture ──────────────────────────────────────────────────────────────
export async function detectArchitecture(names, root) {
  const check = async (targets) => {
    if (targets.some(d => names.has(d))) return true;
    if (!names.has('src')) return false;
    const srcE = await readdirSafe(join(root, 'src'));
    return targets.some(d => srcE.some(e => e.name === d && e.isDirectory()));
  };
  if (await check(['domain', 'ports', 'adapters', 'application', 'infrastructure'])) return 'clean';
  if (await check(['controllers', 'models', 'views'])) return 'mvc';
  if (await check(['service', 'repository', 'dao'])) return 'layered';
  return undefined;
}

// ── Project classification ─────────────────────────────────────────────────────
const MOBILE_STACKS = new Set(['react-native', 'react-native-expo', 'flutter', 'swift', 'kotlin', 'ionic', 'capacitor']);

export function classifyProject(stack, infra, db, allDeps, dirEntries) {
  if (stack && MOBILE_STACKS.has(stack)) return { projectType: 'mobile', layeredArchitecture: 'N/A' };
  let FE = 0, BE = 0;
  ['react','vue','svelte'].forEach(d => { if (allDeps[d]) FE += 3; });
  // angular/next/nest counted via stack detection, not scoring
  ['express','fastify','hono','koa'].forEach(d => { if (allDeps[d]) BE += 3; });
  if (allDeps['@nestjs/core']) BE += 3;
  if (['go','java','spring-boot','scala','rust','csharp','python'].includes(stack)) BE += 3;
  const dirNames = new Set(dirEntries.filter(e => e.isDirectory()).map(e => e.name));
  if (['src','public','static','assets'].some(d => dirNames.has(d))) FE += 1;
  if (['api','server','cmd','internal'].some(d => dirNames.has(d))) BE += 2;
  if (db) BE += 1;
  if (infra && FE < 2 && BE < 2) return { projectType: 'infra', layeredArchitecture: 'N/A' };
  if (FE >= 2 && BE >= 2) return { projectType: 'fullstack', layeredArchitecture: 'fullstack' };
  if (FE >= 2) return { projectType: 'frontend', layeredArchitecture: 'fe-only' };
  if (BE >= 2) return { projectType: 'backend', layeredArchitecture: 'be-only' };
  return { projectType: 'library', layeredArchitecture: 'unknown' };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const root = process.argv[2] ?? process.cwd();
  let rootReal;
  try { rootReal = await realpath(root); } catch (err) {
    process.stderr.write(JSON.stringify({ error: err.message, code: err.code ?? 'UNKNOWN' }) + '\n');
    process.stdout.write('{}\n');
    return;
  }

  let rootEntries;
  try { rootEntries = await readdir(rootReal, { withFileTypes: true }); }
  catch (err) {
    process.stderr.write(JSON.stringify({ error: err.message, code: err.code ?? 'UNKNOWN' }) + '\n');
    process.stdout.write('{}\n');
    return;
  }
  const rootNames = new Set(rootEntries.map(e => e.name));
  const visited   = new Set([rootReal]);

  // Package manager
  const packageManager = detectPackageManager(rootNames);

  // Root package.json
  const rootPkg = rootNames.has('package.json') ? await readManifest(join(rootReal, 'package.json')) : null;

  // Monorepo detection + workspace expansion
  let workspaceDirs = [];
  let monorepo = false;
  let melosMonorepo = false;

  if (rootNames.has('pnpm-workspace.yaml')) {
    monorepo = true;
    const c = await readText(join(rootReal, 'pnpm-workspace.yaml'));
    const patterns = c ? parseYamlList(c, 'packages') : ['apps/*', 'packages/*'];
    workspaceDirs = await expandPatterns(patterns.length ? patterns : ['apps/*', 'packages/*'], rootReal, visited);
  } else if (rootNames.has('melos.yaml')) {
    monorepo = true; melosMonorepo = true;
    const c = await readText(join(rootReal, 'melos.yaml'));
    const patterns = c ? parseMelosPackages(c) : [];
    workspaceDirs = await expandPatterns(patterns.length ? patterns : ['apps/*', 'packages/*'], rootReal, visited);
  } else if (rootPkg) {
    const ws = rootPkg.workspaces;
    let patterns = [];
    if (Array.isArray(ws) && ws.length > 0) { patterns = ws; monorepo = true; }
    else if (ws && !Array.isArray(ws) && Array.isArray(ws.packages)) { patterns = ws.packages; monorepo = true; }
    if (monorepo) workspaceDirs = await expandPatterns(patterns, rootReal, visited);
  }

  // go.work — parsing rules:
  // - Scan each line with /^\s*use\s+(\S+)/gm to find all `use <path>` directives.
  // - `use ( ... )` block syntax: each path inside the block appears on its own line
  //   matching the same regex (leading whitespace allowed), so block syntax is handled
  //   automatically by the line-by-line matchAll without special block detection.
  // - Paths starting with `../` escape the project root and are skipped with a WARN.
  // - All other paths are resolved relative to rootReal and passed through safeAddDir.
  // - Corrupted or empty go.work (readText returns null/empty) is silently skipped.
  if (rootNames.has('go.work')) {
    const c = await readText(join(rootReal, 'go.work'));
    if (c) {
      for (const m of c.matchAll(/^\s*use\s+(\S+)/gm)) {
        const rel = m[1];
        if (rel.startsWith('../')) { warn(`go.work use directive points outside project root — skipped: ${rel}`); continue; }
        const abs = resolve(rootReal, rel);
        if (await safeAddDir(abs, rootReal, visited)) workspaceDirs.push(abs);
      }
    }
  }

  // Dedup + sort + cap
  workspaceDirs = [...new Set(workspaceDirs)].sort();
  if (workspaceDirs.length > MAX_DIRS) {
    warn(`workspace dir count exceeds ${MAX_DIRS} — truncating`);
    workspaceDirs = workspaceDirs.slice(0, MAX_DIRS);
  }

  // Load workspace package.jsons
  const workspacePkgs = [];
  for (const dir of workspaceDirs) {
    const entries = await readdirSafe(dir);
    const names   = new Set(entries.map(e => e.name));
    if (names.has('package.json')) workspacePkgs.push(await readManifest(join(dir, 'package.json')));
    else workspacePkgs.push(null);
  }

  // Collect all production deps for classification scoring
  const allDeps = {};
  [rootPkg, ...workspacePkgs].filter(Boolean).forEach(p => {
    Object.keys(p.dependencies ?? {}).forEach(k => { allDeps[k] = true; });
  });

  // Run detectors in priority order — first non-undefined value per field wins
  const detectorResults = [
    detectIonic(rootNames),
    detectCapacitor(rootNames),
    detectRNExpo(rootPkg),
    detectRNBare(rootPkg, rootNames),
    await detectFlutter(rootNames, rootReal),
    await detectAngular(rootPkg, workspacePkgs),
    detectNextjs(rootPkg),
    detectNestjs(rootPkg),
    detectReact(rootPkg),
    detectVue(rootPkg),
    detectTSNode(rootPkg),
    await detectGo(rootNames, rootReal),
    await detectPython(rootNames, rootReal),
    await detectRust(rootNames, rootReal),
    detectScala(rootNames),
    await detectSpringBoot(rootNames, rootReal),
    await detectQuarkus(rootNames, rootReal),
    await detectJava(rootNames, rootReal),
    detectDotNet(rootNames),
    await detectIOS(rootNames, rootReal),
    await detectAndroid(rootNames, rootReal),
  ];

  const merged = {};
  const MERGE_FIELDS = ['stack','build','test','lint','format','setup','name','goVersion'];
  for (const d of detectorResults) {
    for (const f of MERGE_FIELDS) {
      if (merged[f] === undefined && d[f] !== undefined) merged[f] = d[f];
    }
  }

  // Polyglot stack: concatenate when multiple lang manifests at root
  const langSignals = [];
  if (rootNames.has('package.json') && rootPkg) langSignals.push('typescript');
  if (rootNames.has('go.mod'))   langSignals.push('go');
  if (rootNames.has('Cargo.toml')) langSignals.push('rust');
  if (rootNames.has('pom.xml') || rootNames.has('build.gradle')) langSignals.push('java');
  if (langSignals.length > 1) merged.stack = langSignals.join('/');

  // npm scripts fallback
  if (rootPkg?.scripts) {
    const s = rootPkg.scripts;
    if (!merged.build && s.build) merged.build = s.build.trim();
    if (!merged.test  && s.test)  merged.test  = s.test.trim();
    if (!merged.lint  && s.lint)  merged.lint  = s.lint.trim();
    if (!merged.format && s.format) merged.format = s.format.trim();
  }

  // Monorepo command overrides
  if (monorepo) {
    if (packageManager === 'pnpm') {
      if (!merged.build || merged.build === 'npm run build') merged.build = 'pnpm -r build';
      if (!merged.test  || merged.test  === 'npm test')     merged.test  = 'pnpm -r test';
    } else if (melosMonorepo) {
      merged.setup = 'melos bootstrap';
    }
  }

  // Name resolution
  if (!merged.name) {
    if (rootPkg?.name) merged.name = rootPkg.name;
    else if (rootNames.has('go.mod')) {
      const c = await readText(join(rootReal, 'go.mod'), 5);
      const m = c?.match(/^module\s+(\S+)/m);
      if (m) merged.name = m[1].split('/').pop();
    }
    if (!merged.name) merged.name = basename(rootReal);
  }

  // Description
  if (rootPkg?.description) merged.description = rootPkg.description.trim().replace(/\r?\n/g, ' ');

  // DB, infra, arch, CI
  const db = await detectDb(rootNames, rootReal, rootPkg, merged.stack);
  const { infra, ci } = await detectInfraCI(rootNames, rootReal);
  const arch = await detectArchitecture(rootNames, rootReal);
  const cls  = classifyProject(merged.stack, infra, db, allDeps, rootEntries);

  // Assemble output
  const raw = {
    name:               merged.name,
    description:        merged.description,
    stack:              merged.stack,
    build:              merged.build,
    test:               merged.test,
    lint:               merged.lint,
    format:             merged.format,
    setup:              merged.setup,
    packageManager:     packageManager,
    monorepo:           monorepo || undefined,
    workspaceDirs:      workspaceDirs.length ? workspaceDirs : undefined,
    goVersion:          merged.goVersion,
    db:                 db,
    projectType:        cls.projectType,
    layeredArchitecture: cls.layeredArchitecture,
    architecture:       arch,
    infra:              infra,
    ci:                 ci,
  };

  // Strip falsy / empty-string fields
  const output = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    if (Array.isArray(v) && v.length === 0) continue;
    output[k] = typeof v === 'string' ? v.trim() : v;
  }

  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
  process.exit(0); // Required: pending readdirSafe timeouts keep the event loop alive without this
}

// Guard: run main() only when this file is the entry point
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  main().catch(err => {
    process.stderr.write(JSON.stringify({ error: err.message, code: err.code ?? 'UNKNOWN' }) + '\n');
    process.stdout.write('{}\n');
    process.exit(0);
  });
}
```

- [X] **T-001-3: Smoke-test the script on the code-conductor repo itself**

```bash
node scripts/detect-stack.mjs "$PWD"
```

Expected: JSON with `"stack":"typescript"`, `"test":"vitest run"`, `"setup":"npm install"`, no non-JSON lines on stdout.

- [X] **T-001-4: Verify empty-repo minimal output and trailing newline**

```bash
_tmp=$(mktemp -d)
out=$(node scripts/detect-stack.mjs "$_tmp" 2>/dev/null)
echo "exit=$?"
echo "out=$out"
# Verify trailing newline: the raw stdout must end with a newline
node scripts/detect-stack.mjs "$_tmp" 2>/dev/null | xxd | tail -1
rmdir "$_tmp"
```

Expected: exit code 0. The output is a JSON object terminated by `\n`. An empty directory always produces at minimum `{"name":"<tmpdir-basename>","projectType":"library","layeredArchitecture":"unknown"}` — `name` defaults to `basename(rootReal)`, and `classifyProject` always returns `projectType`+`layeredArchitecture`. The output is never the bare string `{}` because these two fields are always set. The final byte on stdout must be `0a` (newline) as confirmed by `xxd`.

---

### Task 2 (T-002): `tests/scripts/detect-stack.test.js` — Vitest unit suite

**Files:**
- Create: `tests/scripts/detect-stack.test.js`

**Interfaces:**
- Consumes: exports from `../../scripts/detect-stack.mjs`
- Consumes: `vi.mock('node:fs/promises')` to intercept all disk reads

- [X] **T-002-1: Create `tests/scripts/` directory**

```bash
mkdir -p tests/scripts
```

- [X] **T-002-2: Write `tests/scripts/detect-stack.test.js`**

```javascript
// tests/scripts/detect-stack.test.js
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('node:fs/promises', () => ({
  readdir:  vi.fn(),
  readFile: vi.fn(),
  stat:     vi.fn(),
  realpath: vi.fn(p => Promise.resolve(p)),
}));

import { readdir, readFile, stat, realpath } from 'node:fs/promises';
import {
  detectPackageManager, detectReact, detectNextjs, detectNestjs, detectVue, detectTSNode,
  detectIonic, detectCapacitor, detectRNExpo, detectRNBare, detectFlutter,
  detectAngular, extractMajorVersion, detectGo, detectPython, detectRust, detectScala,
  detectSpringBoot, detectJava, detectDotNet,
  detectDb, classifyProject, detectInfraCI,
  parseMelosPackages, parseYamlList, normalizeMelosLine,
  matchWild, stripBOM, readManifest, readText,
} from '../../scripts/detect-stack.mjs';

const ROOT = '/proj';

function mkEntries(names) {
  return names.map(n => ({ name: n, isDirectory: () => false }));
}
function mkDirEntries(names) {
  return names.map(n => ({ name: n, isDirectory: () => true }));
}

beforeEach(() => { vi.clearAllMocks(); });

// ── readManifest ──────────────────────────────────────────────────────────────
describe('readManifest', () => {
  it('returns null for zero-byte file', async () => {
    stat.mockResolvedValue({ size: 0 });
    expect(await readManifest('/proj/package.json')).toBeNull();
  });

  it('returns null for file > 512 KB', async () => {
    stat.mockResolvedValue({ size: 600 * 1024 });
    expect(await readManifest('/proj/package.json')).toBeNull();
  });

  it('returns null for empty JSON object {}', async () => {
    stat.mockResolvedValue({ size: 2 });
    readFile.mockResolvedValue('{}');
    expect(await readManifest('/proj/package.json')).toBeNull();
  });

  it('returns null for JSON array root', async () => {
    stat.mockResolvedValue({ size: 20 });
    readFile.mockResolvedValue('[{"name":"x"}]');
    expect(await readManifest('/proj/package.json')).toBeNull();
  });

  it('strips UTF-8 BOM before parsing', async () => {
    stat.mockResolvedValue({ size: 20 });
    readFile.mockResolvedValue('﻿{"name":"myapp"}');
    const result = await readManifest('/proj/package.json');
    expect(result?.name).toBe('myapp');
  });

  it('returns parsed object for valid manifest', async () => {
    stat.mockResolvedValue({ size: 30 });
    readFile.mockResolvedValue('{"name":"myapp","version":"1.0.0"}');
    expect(await readManifest('/proj/package.json')).toEqual({ name: 'myapp', version: '1.0.0' });
  });
});

// ── Package manager ───────────────────────────────────────────────────────────
describe('detectPackageManager', () => {
  it('detects bun', () => expect(detectPackageManager(new Set(['bun.lockb']))).toBe('bun'));
  it('detects pnpm', () => expect(detectPackageManager(new Set(['pnpm-lock.yaml']))).toBe('pnpm'));
  it('detects yarn', () => expect(detectPackageManager(new Set(['yarn.lock']))).toBe('yarn'));
  it('detects npm', () => expect(detectPackageManager(new Set(['package-lock.json']))).toBe('npm'));
  it('bun wins over pnpm', () => expect(detectPackageManager(new Set(['bun.lockb','pnpm-lock.yaml']))).toBe('bun'));
  it('returns undefined for no lockfile', () => expect(detectPackageManager(new Set())).toBeUndefined());
});

// ── Angular version ───────────────────────────────────────────────────────────
describe('extractMajorVersion', () => {
  it('extracts major from semver', () => expect(extractMajorVersion('18.0.0')).toBe('18'));
  it('strips caret', () => expect(extractMajorVersion('^17.3.1')).toBe('17'));
  it('strips workspace prefix', () => expect(extractMajorVersion('workspace:^20.0.0')).toBe('20'));
  it('returns null for empty string', () => expect(extractMajorVersion('')).toBeNull());
});

describe('detectAngular', () => {
  it('extracts Angular major from root package.json', async () => {
    const pkg = { dependencies: { '@angular/core': '^18.0.0' }, scripts: {} };
    const result = await detectAngular(pkg, []);
    expect(result.stack).toBe('Angular 18');
    expect(result.build).toBe('ng build');
  });

  it('falls through when no @angular/core dep', async () => {
    const pkg = { dependencies: { react: '18' }, scripts: {} };
    const result = await detectAngular(pkg, []);
    expect(result).toEqual({});
  });
});

// ── JS framework detectors ────────────────────────────────────────────────────
describe('detectReact', () => {
  it('detects React from prod dep', () => {
    const pkg = { dependencies: { react: '18' }, scripts: { build: 'vite build', test: 'vitest' } };
    const r = detectReact(pkg);
    expect(r.stack).toBe('typescript');
    expect(r.build).toBe('vite build');
  });

  it('ignores react in devDependencies only', () => {
    const pkg = { devDependencies: { react: '18' }, scripts: {} };
    expect(detectReact(pkg)).toEqual({});
  });
});

describe('detectNextjs', () => {
  it('detects Next.js from next dep', () => {
    const pkg = { dependencies: { next: '14' }, scripts: {} };
    const r = detectNextjs(pkg);
    expect(r.build).toBe('next build');
    expect(r.lint).toBe('next lint');
  });
});

describe('detectNestjs', () => {
  it('detects NestJS from @nestjs/core dep', () => {
    const pkg = { devDependencies: { '@nestjs/core': '10' }, scripts: {} };
    const r = detectNestjs(pkg);
    expect(r.build).toBe('nest build');
  });
});

// ── Go detector ───────────────────────────────────────────────────────────────
describe('detectGo', () => {
  it('detects go.mod and extracts go version', async () => {
    stat.mockResolvedValue({ size: 50 });
    readFile.mockResolvedValue('module github.com/org/myrepo\n\ngo 1.23\n');
    const names = new Set(['go.mod']);
    const r = await detectGo(names, ROOT);
    expect(r.stack).toBe('go');
    expect(r.goVersion).toBe('1.23');
    expect(r.build).toBe('go build ./...');
  });
});

// ── Python sub-detector ───────────────────────────────────────────────────────
describe('detectPython', () => {
  it('prefers uv.lock', async () => {
    const names = new Set(['uv.lock']);
    const r = await detectPython(names, ROOT);
    expect(r.setup).toBe('uv sync');
    expect(r.stack).toBe('python');
  });

  it('prefers poetry when pyproject has [tool.poetry]', async () => {
    stat.mockResolvedValue({ size: 100 });
    readFile.mockResolvedValue('[tool.poetry]\nname = "myapp"\n');
    const names = new Set(['pyproject.toml']);
    const r = await detectPython(names, ROOT);
    expect(r.setup).toBe('poetry install');
  });

  it('falls back to requirements.txt', async () => {
    const names = new Set(['requirements.txt']);
    const r = await detectPython(names, ROOT);
    expect(r.setup).toBe('pip install -r requirements.txt');
  });
});

// ── Polyglot stack ────────────────────────────────────────────────────────────
describe('classifyProject - polyglot', () => {
  it('React + Go → fullstack (FE=3, BE=3)', () => {
    const allDeps = { react: true };
    const dirEntries = [];
    const cls = classifyProject('go', undefined, undefined, allDeps, dirEntries);
    // go sets BE+=3; react in deps sets FE+=3
    // Note: classifyProject receives stack='go' which adds BE+=3
    // allDeps={react:true} adds FE+=3 → fullstack
    expect(cls.projectType).toBe('fullstack');
  });

  it('React only → frontend', () => {
    const cls = classifyProject('typescript', undefined, undefined, { react: true }, []);
    expect(cls.projectType).toBe('frontend');
    expect(cls.layeredArchitecture).toBe('fe-only');
  });

  it('go only → backend', () => {
    const cls = classifyProject('go', undefined, undefined, {}, []);
    expect(cls.projectType).toBe('backend');
    expect(cls.layeredArchitecture).toBe('be-only');
  });

  it('mobile stack always → mobile', () => {
    const cls = classifyProject('flutter', undefined, undefined, {}, []);
    expect(cls.projectType).toBe('mobile');
    expect(cls.layeredArchitecture).toBe('N/A');
  });

  it('infra only → infra', () => {
    const cls = classifyProject(undefined, 'docker', undefined, {}, []);
    expect(cls.projectType).toBe('infra');
  });

  it('no signals → library', () => {
    const cls = classifyProject(undefined, undefined, undefined, {}, []);
    expect(cls.projectType).toBe('library');
    expect(cls.layeredArchitecture).toBe('unknown');
  });
});

// ── Melos YAML parser ─────────────────────────────────────────────────────────
describe('parseMelosPackages', () => {
  it('parses block sequence', () => {
    const yaml = 'packages:\n  - apps/*\n  - packages/*\n';
    expect(parseMelosPackages(yaml)).toEqual(['apps/*', 'packages/*']);
  });

  it('skips commented packages: line', () => {
    const yaml = '# packages:\n  - apps/*\npackages:\n  - lib/*\n';
    expect(parseMelosPackages(yaml)).toEqual(['lib/*']);
  });

  it('handles flow sequence', () => {
    const yaml = 'packages: [apps/*, packages/*]\n';
    expect(parseMelosPackages(yaml)).toEqual(['apps/*', 'packages/*']);
  });

  it('strips inline comments', () => {
    const yaml = 'packages:\n  - apps/* # main apps\n';
    expect(parseMelosPackages(yaml)).toEqual(['apps/*']);
  });
});

// ── matchWild ─────────────────────────────────────────────────────────────────
describe('matchWild', () => {
  it('* matches any non-slash sequence', () => expect(matchWild('apps', '*')).toBe(true));
  it('does not match slash in name', () => expect(matchWild('a/b', '*')).toBe(false));
  it('? matches single char', () => expect(matchWild('a', '?')).toBe(true));
  it('literal match works', () => expect(matchWild('web', 'web')).toBe(true));
  it('prefix literal with *', () => expect(matchWild('app-web', 'app-*')).toBe(true));
});

// ── .trim() on values ─────────────────────────────────────────────────────────
describe('value trimming', () => {
  it('stripBOM removes BOM', () => expect(stripBOM('﻿hello')).toBe('hello'));
  it('stripBOM is no-op without BOM', () => expect(stripBOM('hello')).toBe('hello'));
});

// ── GLOBAL_IGNORE membership ──────────────────────────────────────────────────
import { GLOBAL_IGNORE } from '../../scripts/detect-stack.mjs';
describe('GLOBAL_IGNORE', () => {
  it('contains node_modules',   () => expect(GLOBAL_IGNORE.has('node_modules')).toBe(true));
  it('contains .git',           () => expect(GLOBAL_IGNORE.has('.git')).toBe(true));
  it('contains .venv',          () => expect(GLOBAL_IGNORE.has('.venv')).toBe(true));
  it('contains .turbo',         () => expect(GLOBAL_IGNORE.has('.turbo')).toBe(true));
  it('does not contain src',    () => expect(GLOBAL_IGNORE.has('src')).toBe(false));
});

// ── CC_GLOB_DEPTH clamping ────────────────────────────────────────────────────
// globDepth is computed at module load time from CC_GLOB_DEPTH env var.
// These tests are best verified by inspecting the exported constant after setting
// process.env.CC_GLOB_DEPTH before import; use isolated vi.resetModules() per case.
// The following assertions document the expected behavior:
//   CC_GLOB_DEPTH=-5     → parseInt gives -5 → clamp to 1
//   CC_GLOB_DEPTH=99     → parseInt gives 99 → clamp to 20
//   CC_GLOB_DEPTH=""     → parseInt("") = NaN → !isFinite → default 5
//   CC_GLOB_DEPTH="abc"  → parseInt("abc") = NaN → !isFinite → default 5
//   CC_GLOB_DEPTH="3.7"  → parseInt("3.7") = 3 (integer truncation) → clamp(1,20,3) = 3
//   CC_GLOB_DEPTH="0.5"  → parseInt("0.5") = 0 → clamp(1,20,0) = 1
// Floating-point inputs are handled by parseInt which truncates toward zero; a value
// like 3.9 becomes 3 (not rounded up). Negative floats like -0.5 become 0 → clamp to 1.
// These invariants are verified in T-001-3 smoke test (manual) and enforced by the
// implementation; add re-import tests if the Vitest config allows env mutation.

// ── Robustness matrix: empty dir, unreadable files, permission blocks ─────────
describe('readManifest — robustness', () => {
  it('returns null and does not throw for stat() rejection (EACCES)', async () => {
    stat.mockRejectedValue(Object.assign(new Error('EACCES'), { code: 'EACCES' }));
    expect(await readManifest('/proj/package.json')).toBeNull();
  });

  it('returns null and does not throw for readFile() rejection (EPERM)', async () => {
    stat.mockResolvedValue({ size: 100 });
    readFile.mockRejectedValue(Object.assign(new Error('EPERM'), { code: 'EPERM' }));
    expect(await readManifest('/proj/package.json')).toBeNull();
  });
});

describe('readText — robustness', () => {
  it('returns null for zero-byte file', async () => {
    stat.mockResolvedValue({ size: 0 });
    expect(await readText('/proj/go.mod')).toBeNull();
  });

  it('returns null for stat() rejection (ENOENT)', async () => {
    stat.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    expect(await readText('/proj/go.mod')).toBeNull();
  });
});

// ── Corrupted manifest JSON → null (item 11) ─────────────────────────────────
describe('readManifest — corrupted JSON returns null', () => {
  it('returns null for truncated JSON', async () => {
    stat.mockResolvedValue({ size: 20 });
    readFile.mockResolvedValue('{"name":"myapp"'); // missing closing brace
    expect(await readManifest('/proj/package.json')).toBeNull();
  });

  it('returns null for JSON with trailing garbage', async () => {
    stat.mockResolvedValue({ size: 30 });
    readFile.mockResolvedValue('{"name":"ok"}GARBAGE');
    expect(await readManifest('/proj/package.json')).toBeNull();
  });
});

// ── matchWild — directory type filter (item 9) ────────────────────────────────
// expandGlob calls e.isDirectory() before matchWild; the following test confirms
// that non-directory entries are excluded even when their names match the pattern.
describe('expandGlob — skips non-directory entries', () => {
  it('file entry matching pattern is not returned as a workspace dir', async () => {
    // readdir returns a file named 'apps' — must be skipped
    readdir.mockResolvedValue([{ name: 'apps', isDirectory: () => false }]);
    const { expandGlob } = await import('../../scripts/detect-stack.mjs');
    const results = await expandGlob('apps', ROOT, new Set([ROOT]));
    expect(results).toEqual([]);
  });
});

// ── UTF-16 / UTF-32 BOM corrupt manifest ─────────────────────────────────────
describe('readManifest — UTF-16 BOM skipped', () => {
  it('returns null when file content starts with UTF-16 LE BOM bytes', async () => {
    // UTF-16 LE BOM is 0xFF 0xFE; read as UTF-8 string this becomes two replacement chars
    // that break JSON.parse — the catch block must return null.
    stat.mockResolvedValue({ size: 50 });
    readFile.mockResolvedValue('\xFF\xFE{"name":"myapp"}'); // simulates corrupted UTF-16 read
    expect(await readManifest('/proj/package.json')).toBeNull();
  });
});

// ── Exclusion patterns ────────────────────────────────────────────────────────
describe('expandPatterns — exclusion with ! prefix', () => {
  it('excludes directory matching negation pattern', async () => {
    const { expandPatterns } = await import('../../scripts/detect-stack.mjs');
    // positive: apps/*, negative: !apps/internal
    // readdir for apps/ returns ['web', 'internal', 'mobile']
    readdir.mockResolvedValue([
      { name: 'web',      isDirectory: () => true },
      { name: 'internal', isDirectory: () => true },
      { name: 'mobile',   isDirectory: () => true },
    ]);
    const visited = new Set([ROOT]);
    const results = await expandPatterns(['apps/*', '!apps/internal'], ROOT, visited);
    const names = results.map(r => r.replace(ROOT + '/', '').split('/').pop());
    expect(names).not.toContain('internal');
    expect(names).toContain('web');
  });
});

// ── Infra classification strict threshold (item 12) ──────────────────────────
describe('classifyProject — infra threshold FE<2 AND BE<2', () => {
  it('infra overrides when both scores are 0', () => {
    const cls = classifyProject(undefined, 'docker', undefined, {}, []);
    expect(cls.projectType).toBe('infra');
  });

  it('infra does NOT override when BE reaches 2 (api dir present)', () => {
    const dirEntries = [{ name: 'api', isDirectory: () => true }];
    // BE+=2 from api dir; FE=0; infra present but BE>=2 → backend wins
    const cls = classifyProject(undefined, 'docker', undefined, {}, dirEntries);
    expect(cls.projectType).toBe('backend');
  });
});

// ── Polyglot overlap / overlapping manifests ──────────────────────────────────
describe('classifyProject - overlapping manifests', () => {
  it('react dep + go stack → fullstack (both FE and BE >= 2)', () => {
    // Simulates a repo with package.json (react in deps) AND go.mod (stack='go').
    // classifyProject receives stack='go' (BE+=3) and allDeps={react:true} (FE+=3).
    const cls = classifyProject('go', undefined, undefined, { react: true }, []);
    expect(cls.projectType).toBe('fullstack');
    expect(cls.layeredArchitecture).toBe('fullstack');
  });

  it('react + express in same package.json → fullstack', () => {
    // Both FE and BE signals come from JS deps alone.
    const cls = classifyProject('typescript', undefined, undefined, { react: true, express: true }, []);
    expect(cls.projectType).toBe('fullstack');
    expect(cls.layeredArchitecture).toBe('fullstack');
  });

  it('react alone does not become fullstack (FE=3, BE=0)', () => {
    const cls = classifyProject('typescript', undefined, undefined, { react: true }, []);
    expect(cls.projectType).toBe('frontend');
  });

  it('db signal alone does not push frontend to fullstack (FE=3, BE=1)', () => {
    // db adds BE+=1 which is < 2; threshold is BE>=2.
    const cls = classifyProject('typescript', undefined, 'postgres', { react: true }, []);
    expect(cls.projectType).toBe('frontend');
  });
});
```

**Cross-platform path note:** The Vitest suite mocks `node:fs/promises` but does NOT mock `node:path`. All test fixtures use POSIX-style paths (e.g. `/proj`). This is intentional: the functions under test use `path.join` / `path.resolve` which on Windows would produce backslash paths, but Vitest runs in Node's ESM context where path behavior matches the OS. To keep the suite portable, every fixture path starts with `/proj` (a POSIX absolute path that Node accepts on all platforms in unit tests). No virtual file system (VFS) plugin (e.g. `memfs`) is needed — `vi.mock('node:fs/promises')` is sufficient because all disk I/O in `detect-stack.mjs` is funneled through those four named imports.

- [X] **T-002-3: Run the test suite**

```bash
npm test -- --reporter=verbose tests/scripts/detect-stack.test.js
```

Expected: all tests PASS.

- [>] **T-002-4: Commit Task 1 + Task 2**

```bash
git add scripts/detect-stack.mjs tests/scripts/detect-stack.test.js
git commit -m "feat(BUG-015): add scripts/detect-stack.mjs with 20+ ecosystem detectors and Vitest suite"
```

---

### Task 3 (T-003): `install.sh` — `_fill_claude_md` helper + detect-stack integration

**Files:**
- Modify: `install.sh`

**Interfaces:**
- Consumes: `node scripts/detect-stack.mjs` via temp file downloaded from GitHub
- Produces: CLAUDE.md with placeholder fields filled from detected JSON

- [ ] **T-003-1: Add `_fill_claude_md` function to `install.sh`**

Insert the following function block immediately before the `# ── Install project template` comment (line ~1179). Search for the anchor: `# ── Install project template`.

```bash
# ── CLAUDE.md smart fill ──────────────────────────────────────────────────────
# _fill_claude_md <claude_md_path> <detect_json_string>
# Replaces blank and <command> placeholder lines in CLAUDE.md using detected values.
# Uses inline node to handle all encoding and regex concerns without sed portability issues.
_fill_claude_md() {
  local _md="$1" _json="$2"
  [ -f "$_md" ] || return 0
  rm -f "${_md}.tmp."* 2>/dev/null || true
  command -v node >/dev/null 2>&1 || return 0

  _CC_JSON="$_json" node - "$_md" 2>>"${_install_logfile:-/dev/null}" << 'FILL_EOF'
const fs = require('fs');
const mdPath = process.argv[2];
let d;
try { d = JSON.parse(process.env._CC_JSON || '{}'); } catch { process.exit(0); }
const FIELDS = {
  name:'Name', description:'Description', stack:'Stack',
  build:'Build', test:'Test', lint:'Lint', format:'Format', setup:'Setup'
};
let content;
try { content = fs.readFileSync(mdPath, 'utf8').replace(/^﻿/, ''); } catch { process.exit(0); }
for (const [key, label] of Object.entries(FIELDS)) {
  const val = d[key];
  if (typeof val !== 'string' || !val.trim()) continue;
  // Normalize: collapse actual newlines and literal \n/\t/\r escape sequences to spaces
  const clean = val.trim().replace(/\r?\n/g, ' ').replace(/\\[ntr]/g, ' ');
  // Match: optional leading whitespace + optional hyphen + optional whitespace + Label:,
  // then blank or <placeholder>, then optional whitespace, then capture trailing \r (group 3).
  // Group 1 captures everything before the value so indentation is preserved in $1.
  // 'i' = case-insensitive label, 'm' = ^ matches each line start.
  const re = new RegExp('^(\\s*-?\\s*' + label + ':)\\s*(<[^>]*>)?\\s*(\\r?)$', 'im');
  if (!re.test(content)) continue;
  // Double $ signs so String.replace doesn't interpret $1/$2 in clean value
  const safe = clean.replace(/\$/g, '$$$$');
  // $1 = label prefix, $3 = captured \r (empty string if LF-only) — restores original line ending
  content = content.replace(re, '$1 ' + safe + '$3');
}
const tmp = mdPath + '.tmp.' + process.pid;
fs.writeFileSync(tmp, content, 'utf8');
try { fs.renameSync(tmp, mdPath); } catch(e) {
  // renameSync can fail cross-device; fall back to copy+delete
  fs.writeFileSync(mdPath, content, 'utf8');
  try { fs.unlinkSync(tmp); } catch {}
}
FILL_EOF
}
```

- [ ] **T-003-2: Add Node.js version guard + detect-stack download + `_fill_claude_md` call to the `--project` install block**

Locate the line `download "project-template/CLAUDE.md" "CLAUDE.md" false` (around line 1206). Insert the following block IMMEDIATELY AFTER that line (before `download "project-template/.claude/settings.json"`):

```bash
  # ── detect-stack: auto-fill CLAUDE.md fields ────────────────────────────────
  _ds_skip=false
  if ! command -v node >/dev/null 2>&1; then
    warn "node not found — CLAUDE.md auto-fill skipped; fill Development Commands manually"
    _ds_skip=true
  else
    # Strip the leading 'v' and everything after the first dot to get the major integer.
    # sed extracts only the first digit group; case guard coerces empty/non-numeric to 0
    # so the -lt 18 comparison never throws a syntax error on malformed output.
    _ds_major=$(node --version 2>/dev/null | sed 's/^v\([0-9]*\).*/\1/')
    case "$_ds_major" in ''|*[!0-9]*) _ds_major=0 ;; esac
    if [ "$_ds_major" -lt 18 ] 2>/dev/null; then
      warn "Node.js v${_ds_major} found but v18+ is required — CLAUDE.md auto-fill skipped; upgrade Node.js to v18+"
      _ds_skip=true
    fi
  fi

  if [ "$_ds_skip" = false ]; then
    _ds_tmp=$(mktemp 2>/dev/null || echo "/tmp/detect-stack-$$.mjs")
    _ds_ok=false
    if curl -fsSL --max-time 10 "${BASE_URL}/scripts/detect-stack.mjs" -o "$_ds_tmp" 2>/dev/null; then
      _ds_ok=true
    elif command -v wget >/dev/null 2>&1; then
      wget -q --timeout=10 "${BASE_URL}/scripts/detect-stack.mjs" -O "$_ds_tmp" 2>/dev/null && _ds_ok=true
    fi

    if [ "$_ds_ok" = true ]; then
      _ds_json=$(node "$_ds_tmp" "$(pwd)" 2>>"${_install_logfile:-/dev/null}")
      if [ -n "$_ds_json" ] && [ "$_ds_json" != '{}' ]; then
        _fill_claude_md "CLAUDE.md" "$_ds_json"
        ok "CLAUDE.md fields auto-filled from manifest detection"
      else
        info "No stack detected — CLAUDE.md placeholders kept for /cc-init to fill"
      fi
      # Keep script for /cc-init to re-use
      mkdir -p "scripts"
      cp "$_ds_tmp" "scripts/detect-stack.mjs" 2>/dev/null || true
    else
      warn "Could not download detect-stack.mjs — CLAUDE.md auto-fill skipped"
    fi
    rm -f "$_ds_tmp" 2>/dev/null || true
  fi
```

- [ ] **T-003-3: Run install.sh --project in a test directory and verify CLAUDE.md is auto-filled**

```bash
_testdir=$(mktemp -d)
echo '{"name":"myapp","scripts":{"build":"vite build","test":"vitest run"}, "dependencies":{"react":"18"}}' > "$_testdir/package.json"
(cd "$_testdir" && bash /path/to/install.sh --project) 2>&1 | head -30
grep -A5 'Development Commands' "$_testdir/CLAUDE.md"
```

Expected: `- Build: vite build` and `- Test: vitest run` in CLAUDE.md.

- [ ] **T-003-3a: Verify $ neutralization — dollar signs in package scripts survive fill intact**

```bash
_testdir=$(mktemp -d)
echo '{"scripts":{"build":"DATABASE_URL=$DATABASE_URL npm run compile"}}' > "$_testdir/package.json"
(cd "$_testdir" && bash /path/to/install.sh --project)
grep -F 'DATABASE_URL=$DATABASE_URL' "$_testdir/CLAUDE.md"
```

Expected: the literal string `DATABASE_URL=$DATABASE_URL` appears in CLAUDE.md. If the dollar sign was shell-expanded or corrupted by JS regex back-reference substitution, this check fails.

- [ ] **T-003-3b: Verify no orphaned temp files after fill**

```bash
find "$_testdir" -maxdepth 2 -name 'CLAUDE.md.tmp.*'
```

Expected: no output (zero files). The fill script must clean up its temp file even when `renameSync` falls back to `writeFileSync`.

- [ ] **T-003-4: Verify idempotency — re-running does not overwrite custom values**

```bash
# Set a custom value
sed -i 's/- Build:.*/- Build: my-custom-build/' "$_testdir/CLAUDE.md"
(cd "$_testdir" && bash /path/to/install.sh --project) 2>&1 | head -5
grep 'Build' "$_testdir/CLAUDE.md"
```

Expected: `- Build: my-custom-build` unchanged.

- [ ] **T-003-5: Commit**

```bash
git add install.sh
git commit -m "feat(BUG-015): extend install.sh --project with _fill_claude_md + detect-stack auto-fill"
```

---

### Task 4 (T-004): `install.ps1` — `Set-ClaudeMdFields` + detect-stack integration

**Files:**
- Modify: `install.ps1`

**Interfaces:**
- Consumes: detect-stack.mjs downloaded from GitHub; stdout captured via `| Out-String`
- Produces: CLAUDE.md with placeholder fields filled; UTF-8 no-BOM write via WriteAllText

- [ ] **T-004-1: Add `Set-ClaudeMdFields` function to `install.ps1`**

Insert the following function immediately before the `# -- Install project template` comment (around line 546). Search anchor: `if ($Project) {`.

```powershell
# -- CLAUDE.md smart fill -------------------------------------------------------
# Set-ClaudeMdFields <mdPath> <jsonString>
# Replaces blank and <command> placeholder lines in CLAUDE.md.
function Set-ClaudeMdFields {
  param([string]$MdPath, [string]$JsonStr)
  if (-not (Test-Path $MdPath)) { return }
  $null = Remove-Item "${MdPath}.tmp.*" -Force -ErrorAction SilentlyContinue
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { return }

  $script = @'
const fs = require('fs');
const mdPath = process.argv[1];
const jsonStr = process.argv[2];
let d;
try { d = JSON.parse(jsonStr); } catch { process.exit(0); }
const FIELDS = {
  name:'Name', description:'Description', stack:'Stack',
  build:'Build', test:'Test', lint:'Lint', format:'Format', setup:'Setup'
};
let content;
try { content = fs.readFileSync(mdPath, 'utf8').replace(/^﻿/, ''); } catch { process.exit(0); }
for (const [key, label] of Object.entries(FIELDS)) {
  const val = d[key];
  if (typeof val !== 'string' || !val.trim()) continue;
  const clean = val.trim().replace(/\r?\n/g, ' ');
  const re = new RegExp('^(- ' + label + ':)\\s*(<[^>]*>)?\\s*\\r?$', 'im');
  if (!re.test(content)) continue;
  const safe = clean.replace(/\$/g, '$$$$');
  content = content.replace(re, '$1 ' + safe);
}
const enc = require('buffer').Buffer.from(content);
const tmp = mdPath + '.tmp.' + process.pid;
fs.writeFileSync(tmp, enc);
try {
  require('fs').renameSync(tmp, mdPath);
} catch {
  [System.IO.File]::WriteAllBytes(mdPath, enc);
  try { fs.unlinkSync(tmp); } catch {}
}
'@
  # Pass JsonStr as process.argv[2]
  node -e $script $MdPath $JsonStr 2>$null
}
```

Note: PS 5.1 does not support `fs.renameSync` across volumes — use `[System.IO.File]::Replace` instead in the fallback. But since we're using `node -e` with a single-line argument, the atomic write is handled inside node. The PS function just calls node with the mdPath and jsonStr arguments.

Actually, replace the node script's renameSync fallback with a proper node approach:

Replace the script fallback block with:
```javascript
const tmp = mdPath + '.tmp.' + process.pid;
fs.writeFileSync(tmp, content, 'utf8');
try { fs.renameSync(tmp, mdPath); }
catch { fs.writeFileSync(mdPath, content, 'utf8'); try { fs.unlinkSync(tmp); } catch {} }
```

But also: the PS `node -e $script $MdPath $JsonStr` call — in PS 5.1, when `$JsonStr` contains special PS characters (e.g., `"`), the argument may be corrupted. Safer: use a temp file for the JSON:

```powershell
function Set-ClaudeMdFields {
  param([string]$MdPath, [string]$JsonStr)
  if (-not (Test-Path $MdPath)) { return }
  $null = Remove-Item "${MdPath}.tmp.*" -Force -ErrorAction SilentlyContinue
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { return }

  $jsonTmp = [System.IO.Path]::GetTempFileName()
  try {
    [System.IO.File]::WriteAllText($jsonTmp, $JsonStr, [System.Text.UTF8Encoding]::new($false))

    $script = @'
const fs = require('fs');
const mdPath   = process.argv[1];
const jsonPath = process.argv[2];
let d;
try { d = JSON.parse(fs.readFileSync(jsonPath, 'utf8')); } catch { process.exit(0); }
const FIELDS = {name:'Name',description:'Description',stack:'Stack',build:'Build',test:'Test',lint:'Lint',format:'Format',setup:'Setup'};
let content;
try { content = fs.readFileSync(mdPath, 'utf8').replace(/^﻿/, ''); } catch { process.exit(0); }
for (const [key, label] of Object.entries(FIELDS)) {
  const val = d[key];
  if (typeof val !== 'string' || !val.trim()) continue;
  const clean = val.trim().replace(/\r?\n/g, ' ');
  const re = new RegExp('^(\\s*-?\\s*' + label + ':)\\s*(<[^>]*>)?\\s*(\\r?)$', 'im');
  if (!re.test(content)) continue;
  content = content.replace(re, '$1 ' + clean.replace(/\$/g, '$$$$') + '$3');
}
const tmp = mdPath + '.tmp.' + process.pid;
fs.writeFileSync(tmp, content, 'utf8');
try { fs.renameSync(tmp, mdPath); } catch { fs.writeFileSync(mdPath, content, 'utf8'); try { fs.unlinkSync(tmp); } catch {} }
'@
    node -e $script $MdPath $jsonTmp 2>$null
  } finally {
    Remove-Item $jsonTmp -Force -ErrorAction SilentlyContinue
  }
}
```

- [ ] **T-004-2: Add Node version guard + detect-stack download + `Set-ClaudeMdFields` call to the `-Project` block**

Locate `Save-RemoteFile "project-template/CLAUDE.md" "CLAUDE.md" $false` (line ~573). Insert IMMEDIATELY AFTER that line:

```powershell
  # -- detect-stack: auto-fill CLAUDE.md fields --------------------------------
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  $OutputEncoding = [System.Text.Encoding]::UTF8
  $dsSkip = $false
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Warn "node not found -- CLAUDE.md auto-fill skipped; fill Development Commands manually"
    $dsSkip = $true
  } else {
    $nmRaw = node --version 2>$null
    if ($nmRaw -match '^v(\d+)') { $nm = [int]$Matches[1] } else { $nm = 0 }
    if ($nm -lt 18) {
      Write-Warn "Node.js v$nm found but v18+ is required -- CLAUDE.md auto-fill skipped; upgrade Node.js to v18+"
      $dsSkip = $true
    }
  }

  if (-not $dsSkip) {
    $dsTmp = [System.IO.Path]::GetTempFileName() + '.mjs'
    $dsOk = $false
    try {
      Invoke-WebRequest -Uri "$BaseUrl/scripts/detect-stack.mjs" -OutFile $dsTmp -TimeoutSec 10 -ErrorAction Stop
      $dsOk = $true
    } catch {
      Write-Warn "Could not download detect-stack.mjs -- CLAUDE.md auto-fill skipped"
    }

    if ($dsOk) {
      $dsRaw = node $dsTmp "$($pwd.Path)" 2>$null | Out-String
      $dsJson = try { $dsRaw | ConvertFrom-Json } catch { $null }
      if ($dsJson -and ($dsRaw.Trim() -ne '{}')) {
        $dsStr = $dsRaw.Trim()
        Set-ClaudeMdFields "CLAUDE.md" $dsStr
        Write-Ok "CLAUDE.md fields auto-filled from manifest detection"
        # Keep script for /cc-init to re-use
        $null = New-Item -ItemType Directory -Path "scripts" -Force
        Copy-Item $dsTmp "scripts\detect-stack.mjs" -Force -ErrorAction SilentlyContinue
      } else {
        Write-Info "No stack detected -- CLAUDE.md placeholders kept for /cc-init to fill"
      }
    }
    Remove-Item $dsTmp -Force -ErrorAction SilentlyContinue
  }
```

- [ ] **T-004-2a: Verify ConvertFrom-Json fallback when detect-stack emits invalid JSON**

If `node $dsTmp` exits 0 but stdout is not valid JSON (e.g. a partial write or a stderr bleed), `ConvertFrom-Json` throws. The `try { ... } catch { $null }` guard must absorb this:

```powershell
# Simulate invalid JSON from detect-stack
$dsRaw = "not-json"
$dsJson = try { $dsRaw | ConvertFrom-Json } catch { $null }
if (-not $dsJson) { Write-Host "PASS: fallback to null on bad JSON" }
```

Expected: `PASS: fallback to null on bad JSON`. The installer must then take the `else` branch and emit "No stack detected" rather than crashing. Add this as an assertion in `tests/scripts/installer-fill.test.ps1` (T-005-2 extension).

- [ ] **T-004-2b: Confirm CLAUDE.md encoding after fill**

After `Set-ClaudeMdFields` completes, the node fill script writes via `fs.writeFileSync(tmp, content, 'utf8')` — this is Node's UTF-8 encoder, which produces UTF-8 **without BOM**. Verify:

```powershell
$bytes = [System.IO.File]::ReadAllBytes("CLAUDE.md")
# UTF-8 BOM is EF BB BF; first 3 bytes must NOT be BOM
if ($bytes[0] -ne 0xEF -or $bytes[1] -ne 0xBB -or $bytes[2] -ne 0xBF) {
  Write-Host "PASS: no BOM"
} else {
  Write-Host "FAIL: BOM present"
}
```

Expected: `PASS: no BOM`. The `[System.IO.File]::WriteAllText` with `[System.Text.UTF8Encoding]::new($false)` is used for JSON temp files; the CLAUDE.md itself is written by node's `writeFileSync` which produces no BOM. **Do not use `[System.Text.Encoding]::UTF8`** for either file — it writes a `EF BB BF` preamble that causes JSON.parse to fail in node.

- [ ] **T-004-3: Verify PS installer fills CLAUDE.md on a test directory (manual test)**

In a PowerShell terminal:
```powershell
$testDir = [System.IO.Path]::GetTempPath() + "cc-test-" + [System.Guid]::NewGuid().ToString("N")
New-Item -ItemType Directory -Path $testDir | Out-Null
'{"name":"myapp","scripts":{"build":"vite build","test":"vitest"},"dependencies":{"react":"18"}}' | Set-Content "$testDir\package.json"
Set-Location $testDir
& "path\to\install.ps1" -Project 2>&1 | Select-Object -First 30
Select-String -Path "CLAUDE.md" -Pattern "Build:|Test:"
```

Expected: `Build: vite build`, `Test: vitest`.

- [ ] **T-004-4: Commit**

```bash
git add install.ps1
git commit -m "feat(BUG-015): extend install.ps1 -Project with Set-ClaudeMdFields + detect-stack auto-fill"
```

---

### Task 5 (T-005): Installer test harnesses

**Files:**
- Create: `tests/scripts/installer-fill.test.sh`
- Create: `tests/scripts/installer-fill.test.ps1`

**Interfaces:**
- Both harnesses test the fill helper in isolation against a temporary CLAUDE.md

- [ ] **T-005-1: Write `tests/scripts/installer-fill.test.sh`**

```bash
#!/usr/bin/env bash
# tests/scripts/installer-fill.test.sh
# Run with: bash tests/scripts/installer-fill.test.sh

set -euo pipefail
PASS=0; FAIL=0

assert_contains() {
  local _label="$1" _file="$2" _pattern="$3"
  if grep -qF "$_pattern" "$_file"; then
    echo "PASS: $_label"; PASS=$((PASS+1))
  else
    echo "FAIL: $_label (expected '$_pattern' in '$_file')"; FAIL=$((FAIL+1))
    grep '' "$_file" | head -5
  fi
}

assert_not_contains() {
  local _label="$1" _file="$2" _pattern="$3"
  if ! grep -qF "$_pattern" "$_file"; then
    echo "PASS: $_label"; PASS=$((PASS+1))
  else
    echo "FAIL: $_label (did NOT expect '$_pattern' in '$_file')"; FAIL=$((FAIL+1))
  fi
}

# Load _fill_claude_md from install.sh
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# Source only the _fill_claude_md function by extracting and evaling it
eval "$(awk '/^_fill_claude_md\(\)/,/^}$/' "$REPO_ROOT/install.sh")"

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
JSON='{"name":"myapp","build":"npm run build","test":"jest"}'
_install_logfile=/dev/null _fill_claude_md "$T/CLAUDE.md" "$JSON"
assert_contains "basic: name filled"  "$T/CLAUDE.md" "- Name: myapp"
assert_contains "basic: build filled" "$T/CLAUDE.md" "- Build: npm run build"
assert_contains "basic: test filled"  "$T/CLAUDE.md" "- Test: jest"
assert_contains "basic: lint blank (not filled)" "$T/CLAUDE.md" "- Lint: <command>"
rm -rf "$T"

# ── Test 2: value with / (path) ─────────────────────────────────────────────
T=$(mktemp_dir); echo "$TEMPLATE" > "$T/CLAUDE.md"
JSON='{"build":"./scripts/build.sh"}'
_install_logfile=/dev/null _fill_claude_md "$T/CLAUDE.md" "$JSON"
assert_contains "slash: build filled" "$T/CLAUDE.md" "- Build: ./scripts/build.sh"
rm -rf "$T"

# ── Test 3: value with & ────────────────────────────────────────────────────
T=$(mktemp_dir); echo "$TEMPLATE" > "$T/CLAUDE.md"
JSON='{"build":"npm run lint && npm run build"}'
_install_logfile=/dev/null _fill_claude_md "$T/CLAUDE.md" "$JSON"
assert_contains "ampersand: build filled" "$T/CLAUDE.md" "- Build: npm run lint && npm run build"
rm -rf "$T"

# ── Test 4: value with backslash ────────────────────────────────────────────
T=$(mktemp_dir); echo "$TEMPLATE" > "$T/CLAUDE.md"
JSON='{"setup":"C:\\path\\to\\setup"}'
_install_logfile=/dev/null _fill_claude_md "$T/CLAUDE.md" "$JSON"
assert_contains "backslash: setup filled" "$T/CLAUDE.md" "- Setup: C:\path\to\setup"
rm -rf "$T"

# ── Test 5: non-placeholder line is preserved ───────────────────────────────
T=$(mktemp_dir)
printf '%s\n' '## Development Commands' '- Build: my-custom-build' '- Test: <command>' > "$T/CLAUDE.md"
JSON='{"build":"npm run build","test":"jest"}'
_install_logfile=/dev/null _fill_claude_md "$T/CLAUDE.md" "$JSON"
assert_contains     "preserve: custom build unchanged" "$T/CLAUDE.md" "- Build: my-custom-build"
assert_contains     "preserve: placeholder test filled" "$T/CLAUDE.md" "- Test: jest"
assert_not_contains "preserve: custom build not overwritten" "$T/CLAUDE.md" "- Build: npm run build"
rm -rf "$T"

# ── Test 6: CRLF line endings handled correctly ─────────────────────────────
T=$(mktemp_dir)
printf '## Development Commands\r\n- Build: <command>\r\n- Test: <command>\r\n' > "$T/CLAUDE.md"
JSON='{"build":"npm run build"}'
_install_logfile=/dev/null _fill_claude_md "$T/CLAUDE.md" "$JSON"
assert_contains "crlf: build filled" "$T/CLAUDE.md" "npm run build"
rm -rf "$T"

# ── Test 7: read-only CLAUDE.md — helper exits 0, file unchanged ────────────
T=$(mktemp_dir); echo "$TEMPLATE" > "$T/CLAUDE.md"
chmod 444 "$T/CLAUDE.md"
JSON='{"build":"npm run build"}'
_install_logfile=/dev/null _fill_claude_md "$T/CLAUDE.md" "$JSON"
# Exit code must be 0 regardless of write failure
assert_not_contains "readonly: placeholder not replaced on failure" "$T/CLAUDE.md" "npm run build"
chmod 644 "$T/CLAUDE.md"
rm -rf "$T"

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""; echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
```

- [ ] **T-005-2: Write `tests/scripts/installer-fill.test.ps1`**

```powershell
# tests/scripts/installer-fill.test.ps1
# Run with: powershell -File tests/scripts/installer-fill.test.ps1

$pass = 0; $fail = 0

function Assert-Contains {
  param([string]$Label, [string]$File, [string]$Pattern)
  $content = [System.IO.File]::ReadAllText($File, [System.Text.Encoding]::UTF8)
  if ($content -like "*$Pattern*") {
    Write-Host "PASS: $Label"; $script:pass++
  } else {
    Write-Host "FAIL: $Label (expected '$Pattern')"; $script:fail++
    Write-Host ($content | Select-Object -First 5)
  }
}

function Assert-NotContains {
  param([string]$Label, [string]$File, [string]$Pattern)
  $content = [System.IO.File]::ReadAllText($File, [System.Text.Encoding]::UTF8)
  if ($content -notlike "*$Pattern*") {
    Write-Host "PASS: $Label"; $script:pass++
  } else {
    Write-Host "FAIL: $Label (did NOT expect '$Pattern')"; $script:fail++
  }
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..") | Select-Object -ExpandProperty Path

# Load Set-ClaudeMdFields from install.ps1
# Extract the function definition and dot-source it
$installContent = [System.IO.File]::ReadAllText((Join-Path $repoRoot "install.ps1"), [System.Text.Encoding]::UTF8)
$funcMatch = [regex]::Match($installContent, '(?s)function Set-ClaudeMdFields \{.*?\n\}')
if ($funcMatch.Success) {
  $funcDef = $funcMatch.Value
  Invoke-Expression $funcDef
} else {
  Write-Host "FAIL: Could not extract Set-ClaudeMdFields from install.ps1"
  exit 1
}

$TEMPLATE = @'
## Project Identity
- Name:
- Description:
- Stack:
- Language: en

## Development Commands
- Build: <command>
- Test: <command>
- Lint: <command>
- Format: <command>
- Setup: <command>
'@

# ── Test 1: basic fill ──────────────────────────────────────────────────────
$t = [System.IO.Path]::GetTempPath() + "cctest-" + [System.Guid]::NewGuid().ToString("N")
New-Item -ItemType Directory -Path $t | Out-Null
[System.IO.File]::WriteAllText("$t\CLAUDE.md", $TEMPLATE, [System.Text.Encoding]::UTF8)
Set-ClaudeMdFields "$t\CLAUDE.md" '{"name":"myapp","build":"npm run build","test":"jest"}'
Assert-Contains "basic: name filled"  "$t\CLAUDE.md" "- Name: myapp"
Assert-Contains "basic: build filled" "$t\CLAUDE.md" "- Build: npm run build"
Assert-Contains "basic: test filled"  "$t\CLAUDE.md" "- Test: jest"
Remove-Item $t -Recurse -Force

# ── Test 2: value with $ (dollar sign) ────────────────────────────────────
$t = [System.IO.Path]::GetTempPath() + "cctest-" + [System.Guid]::NewGuid().ToString("N")
New-Item -ItemType Directory -Path $t | Out-Null
[System.IO.File]::WriteAllText("$t\CLAUDE.md", $TEMPLATE, [System.Text.Encoding]::UTF8)
Set-ClaudeMdFields "$t\CLAUDE.md" '{"build":"DATABASE_URL=$DB npm test"}'
Assert-Contains "dollar: build with $ preserved" "$t\CLAUDE.md" '$DB'
Remove-Item $t -Recurse -Force

# ── Test 3: value with backslash (Windows path) ────────────────────────────
$t = [System.IO.Path]::GetTempPath() + "cctest-" + [System.Guid]::NewGuid().ToString("N")
New-Item -ItemType Directory -Path $t | Out-Null
[System.IO.File]::WriteAllText("$t\CLAUDE.md", $TEMPLATE, [System.Text.Encoding]::UTF8)
Set-ClaudeMdFields "$t\CLAUDE.md" '{"setup":"C:\\Users\\foo\\setup"}'
Assert-Contains "backslash: setup with path" "$t\CLAUDE.md" "Users"
Remove-Item $t -Recurse -Force

# ── Test 4: non-placeholder line is preserved ──────────────────────────────
$t = [System.IO.Path]::GetTempPath() + "cctest-" + [System.Guid]::NewGuid().ToString("N")
New-Item -ItemType Directory -Path $t | Out-Null
$custom = "## Development Commands`n- Build: my-custom-build`n- Test: <command>"
[System.IO.File]::WriteAllText("$t\CLAUDE.md", $custom, [System.Text.Encoding]::UTF8)
Set-ClaudeMdFields "$t\CLAUDE.md" '{"build":"npm run build","test":"jest"}'
Assert-Contains     "preserve: custom build unchanged" "$t\CLAUDE.md" "- Build: my-custom-build"
Assert-NotContains  "preserve: detected build not written" "$t\CLAUDE.md" "- Build: npm run build"
Assert-Contains     "preserve: placeholder test filled"   "$t\CLAUDE.md" "- Test: jest"
Remove-Item $t -Recurse -Force

# ── Summary ──────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "Results: $pass passed, $fail failed"
if ($fail -eq 0) { exit 0 } else { exit 1 }
```

- [ ] **T-005-3: Run bash test harness**

```bash
bash tests/scripts/installer-fill.test.sh
```

Expected: all PASS.

- [ ] **T-005-4: Run PS test harness (optional on Windows)**

```powershell
powershell -File tests/scripts/installer-fill.test.ps1
```

Expected: all PASS.

- [ ] **T-005-5: Commit**

```bash
git add tests/scripts/installer-fill.test.sh tests/scripts/installer-fill.test.ps1
git commit -m "test(BUG-015): add installer-fill test harnesses for bash and PS fill helpers"
```

---

### Task 6 (T-006): `project-template/.claude/commands/cc-init.md` — Step 2 rewrite

**Files:**
- Modify: `project-template/.claude/commands/cc-init.md`

**Interfaces:**
- Consumes: `scripts/detect-stack.mjs` (installed by `_fill_claude_md` to `scripts/detect-stack.mjs`)
- Produces: CLAUDE.md fields filled; interactive questions only for fields not auto-detected

- [ ] **T-006-1: Verify current Step 2 content (lines 11–31)**

Confirm the current Step 2 block reads `"## Step 2 — Collect project identity"` and the logic is asking the user manually. The replacement will add auto-detection before the manual questions.

- [ ] **T-006-2: Replace Step 2 in `project-template/.claude/commands/cc-init.md`**

Replace the entire `## Step 2` section (lines 11–31 inclusive) with:

```markdown
## Step 2 — Auto-detect and collect project identity

Check if `scripts/detect-stack.mjs` exists in the project root. If it does, run:

```bash
node scripts/detect-stack.mjs "$PWD"
```

**Environment flags:** `CC_GLOB_DEPTH` and any other `CC_*` env vars the user may have set are automatically inherited by the child `node` process — no explicit export or forwarding is required. The `/cc-init` command must NOT reset or unset these variables before calling detect-stack.

Capture the JSON output. For each field in the JSON (name, description, stack, build, test, lint, format, setup), check the corresponding line in CLAUDE.md:
- If the CLAUDE.md line contains `<command>` (any case) or is blank after `Key:` → replace with the detected value using a single `Edit` call.
- If the CLAUDE.md line already has a non-placeholder value → skip (never overwrite).

Apply all replacements in a **single `Edit` call** after collecting all detected values.

If `scripts/detect-stack.mjs` is missing or returns `{}`, skip auto-detection.

After auto-detection (or if skipped), check which identity fields remain blank:

Read `CLAUDE.md`. Check the `## Project Identity` section.

If **Name** is still empty, ask the user all of these questions at once (not one at a time):

1. What is the project name?
2. One sentence: what does it do?
3. Primary tech stack (e.g. "TypeScript + React", "Python + FastAPI") — **only ask if `IS_NEW=false` AND stack was not auto-detected**
4. Response language preference? (default: `en` — only ask if context suggests otherwise)

If Name was already filled (by auto-detection or previous run), skip directly to Step 3 without asking.

Once any manual fields are collected, update CLAUDE.md with a single `Edit` call covering all remaining blank fields.

**CI mode:** If `CI=true` or stdin is not a TTY, skip all interactive questions. Leave unresolved `<command>` placeholders in place.
```

- [ ] **T-006-3: Verify the file structure is intact after edit**

Read the first 80 lines and confirm Step 1, Step 2 (new), Step 3–7 are all present and correctly numbered.

- [ ] **T-006-4: Commit**

```bash
git add -f project-template/.claude/commands/cc-init.md
git commit -m "feat(BUG-015): rewrite cc-init.md Step 2 with auto-detect + selective interactive fallback"
```

---

### Task 7a (T-007a): `project-template/.claude/commands/cc-resume.md` — detect-stack integration

**Files:**
- Modify: `project-template/.claude/commands/cc-resume.md`

**Interfaces:**
- Consumes: `scripts/detect-stack.mjs` (placed at project root by installer or cc-init)
- Produces: CLAUDE.md blank command fields filled; session resume report shows updated stack

- [ ] **T-007a-1: Read current cc-resume.md Step 2 and Step 10 content**

Read `project-template/.claude/commands/cc-resume.md` lines 1–60 to identify the exact location of Step 2 (where CLAUDE.md fields are read) and Step 10 (where `/cc-stack` is invoked).

- [ ] **T-007a-2: Insert detect-stack sub-step after Step 2 field extraction**

After the block that extracts `Name`, `Description`, `Stack`, `Language` from CLAUDE.md (Step 2), add the following paragraph:

```markdown
**Auto-fill blank command fields (BUG-015):** After reading the identity fields, check if any of `Build`, `Test`, `Lint`, `Format`, `Setup` in CLAUDE.md are still `<command>` (any case) or blank after the colon. If at least one is blank AND `scripts/detect-stack.mjs` exists at `$PWD`:

1. Run `node scripts/detect-stack.mjs "$PWD"` and capture the JSON output.
2. For each blank/placeholder command field, if the JSON contains a matching key (`build`, `test`, `lint`, `format`, `setup`), replace the placeholder with the detected value using a single `Edit` call.
3. Never overwrite a field that already contains a non-placeholder value.
4. If all five fields are already populated, or if `scripts/detect-stack.mjs` does not exist, skip this step silently.
5. If the JSON is `{}` or node exits non-zero, skip silently.

Re-read the updated CLAUDE.md fields after this step so the session resume report reflects the filled values.
```

- [ ] **T-007a-3: Verify the edit did not disrupt surrounding steps**

Read lines 1–80 of the modified `cc-resume.md` and confirm Step 1, Step 2 (original + new sub-step), Steps 3–10 are all present and correctly numbered.

- [ ] **T-007a-4: Commit**

```bash
git add -f project-template/.claude/commands/cc-resume.md
git commit -m "feat(BUG-015): extend cc-resume Step 2 with detect-stack auto-fill for blank command fields"
```

---

### Task 7 (T-007): ~~Bug fix — `post-compact.ps1` emoji encoding~~ — OUT OF SCOPE

> **OUT OF SCOPE for BUG-015.** The `post-compact.ps1` and `context-guard.ps1` emoji fix belongs to FEAT-007 (context-guard infrastructure) and was already delivered in commit `e64fc44` as a pre-flight fix before this feature. Do not re-apply or re-commit these changes here.
>
> This task slot is intentionally kept as a tombstone so that T-008 numbering is not disturbed. Skip T-007 entirely during implementation.

---

### Task 8 (T-008): Metadata — BACKLOG, VERSION, CHANGELOG, README

**Files:**
- Modify: `AGENT-READABLE BACKLOG.md`
- Modify: `VERSION`
- Modify: `CHANGELOG.md`
- Modify: `README.md`

- [ ] **T-008-1: Mark BUG-015 as complete in BACKLOG**

Pre-check: `grep -c 'BUG-015' "AGENT-READABLE BACKLOG.md"` must equal 1.

Find the BUG-015 line and change `[ ]` to `[X]`. Use a surgical Edit — one field, one line.

- [ ] **T-008-2: Bump VERSION to 1.16.0**

```bash
echo "1.16.0" > VERSION
```

- [ ] **T-008-2a: Verify VERSION content**

```bash
[ "$(cat VERSION)" = "1.16.0" ] && echo "PASS" || echo "FAIL: $(cat VERSION)"
```

Expected: `PASS`. Commit immediately:

```bash
git add VERSION
git commit -m "chore(BUG-015): bump VERSION to 1.16.0"
```

- [ ] **T-008-3: Prepend CHANGELOG entry**

Add the following at the top of CHANGELOG.md (after the `# Changelog` heading):

```markdown
## [1.16.0] — 2026-06-24

### Added
- `scripts/detect-stack.mjs`: auto-detects project stack from manifests (20+ ecosystems: JS/TS, Go, Python, Rust, Scala, Spring Boot, Quarkus, Java, .NET, iOS, Android, Flutter, React Native, Ionic, Capacitor). Emits JSON to stdout; exits 0 always.
- `_fill_claude_md` (bash) / `Set-ClaudeMdFields` (PS): surgically fill CLAUDE.md blank/`<command>` fields from detected JSON; never overwrite user-customized values.
- `install.sh --project` / `install.ps1 -Project`: now auto-detect stack and fill CLAUDE.md at install time; Node.js ≥ 18 validated before calling detect-stack.
- `/cc-init` Step 2: rewired to run detect-stack and skip interactive questions for auto-detected fields.
- `/cc-resume` Step 2: now auto-fills blank command fields via detect-stack on session resume when manifests have changed.
```

- [ ] **T-008-3a: Verify CHANGELOG entry is first**

```bash
head -5 CHANGELOG.md | grep '## \[1\.16\.0\]' && echo "PASS" || echo "FAIL: entry missing or not first"
```

Expected: `PASS`. Commit immediately:

```bash
git add CHANGELOG.md
git commit -m "chore(BUG-015): add CHANGELOG [1.16.0] entry"
```

- [ ] **T-008-4: Update README to mention auto-detection**

Find the `## What it does` (or similar) section and add one bullet:

```markdown
- **Stack auto-detection** — `install.sh --project` reads your `package.json`, `go.mod`, `Cargo.toml`, etc. and auto-fills CLAUDE.md Development Commands so the agent never guesses your build/test/lint commands.
```

- [ ] **T-008-4a: Verify README update**

```bash
grep -c 'Stack auto-detection' README.md | grep -q '^1$' && echo "PASS" || echo "FAIL"
```

Expected: `PASS` (exactly one match). Commit immediately:

```bash
git add README.md
git commit -m "docs(BUG-015): document stack auto-detection in README"
```

- [ ] **T-008-5: Commit BACKLOG**

```bash
git add -f "AGENT-READABLE BACKLOG.md"
git commit -m "chore(BUG-015): mark BUG-015 complete in BACKLOG"
```

- [ ] **T-008-6: Final git status — confirm no unstaged changes remain**

After all T-008 commits, verify the working tree is clean:

```bash
git status --short
```

Expected: empty output (no `M`, `??`, or `A` lines). If any unstaged changes remain, investigate before marking T-008 complete — stray edits to unrelated files or failed atomic writes can cause false-clean states.

---

## Test List

- [x] `tests/scripts/detect-stack.test.js` — Vitest unit tests with mocked `node:fs/promises` (Task 2)
- [x] `tests/scripts/installer-fill.test.sh` — bash harness for `_fill_claude_md` (Task 5)
- [x] `tests/scripts/installer-fill.test.ps1` — PS harness for `Set-ClaudeMdFields` (Task 5)
- [ ] Manual smoke test: `node scripts/detect-stack.mjs "$PWD"` on this repo (Task 1)
- [ ] Manual installer test: `install.sh --project` on a temp dir with `package.json` (Task 3)
- [ ] Manual installer test: `install.ps1 -Project` on a temp dir (Task 4)
- [ ] Verify no orphaned `.tmp.*` files remain after fill: `find . -maxdepth 2 -name 'CLAUDE.md.tmp.*' | wc -l` must equal 0 after any fill run, including failed/interrupted runs (Tasks 3, 4, 5)
- [ ] Polyglot/overlapping manifest test: Vitest `classifyProject` — repo with `package.json` (react dep) + `go.mod` must yield `projectType: 'fullstack'`; repo with `package.json` (react + express deps) must yield `projectType: 'fullstack'` not `frontend` (Task 2 extension — add these cases if missing)
- [ ] $ neutralization check: after fill, `grep -F 'DATABASE_URL=$DB' CLAUDE.md` must return the literal string with `$DB` intact — not expanded by shell or corrupted by JS string replace (Task 5 T-005-2 `dollar` test already covers this; confirm it passes)
- [ ] Workspace sort order: verify `workspaceDirs` emitted in JSON are in Unicode code-point (case-sensitive) lexicographic order; `["apps/api","apps/web","packages/ui"]` must appear sorted, not insertion-ordered
- [ ] Melos flow-sequence bracket format: `parseMelosPackages('packages: [apps/*, packages/*]\n')` must return `['apps/*','packages/*']` — verified by T-002 test suite `handles flow sequence` case
- [ ] Fullstack tie-breaker: `classifyProject('typescript', undefined, undefined, {react:true, express:true}, [])` must return `projectType:'fullstack'` — equal FE=BE=3 both ≥ 2 triggers fullstack
- [ ] Customized-field preservation: a CLAUDE.md line `- Build: my-custom-build` (non-placeholder) must survive unchanged after fill with `{"build":"detected-build"}` — verified by T-005 bash Test 5 and PS Test 4
- [ ] ConvertFrom-Json fallback: when detect-stack stdout is not valid JSON, PS installer must not crash; `$dsJson` must be `$null` and installer must print "No stack detected" — verified by T-004-2a test block
- [ ] File permissions preserved: after atomic rename, `stat(CLAUDE.md).mode` must match the pre-fill mode — on POSIX, `renameSync` preserves inode permissions; verify with `ls -l CLAUDE.md` before and after
- [ ] Leading-hyphen-optional regex: `- Name: <command>` AND `Name: <command>` (no leading hyphen) must both be replaced; test with T-005 bash Test suite by adding a variant TEMPLATE without hyphens
- [ ] Literal escape sequence neutralization: a package script `"build":"compile\\ntest"` (literal backslash-n) must appear in CLAUDE.md as `compile test` (space), not `compile\ntest`
- [ ] CC_GLOB_DEPTH float: `CC_GLOB_DEPTH=3.9` must produce depth 3 (parseInt truncates); `CC_GLOB_DEPTH=0.5` must produce depth 1 (clamp to 1 minimum) — verified by clamping logic
- [ ] Node version diagnostic: warn message must include both the found version and the required version, e.g. `Node.js v16 found but v18+ is required` — verified by T-003-2 and T-004-2 code blocks
- [ ] CRLF preservation: fill a CRLF CLAUDE.md (line endings `\r\n`); after fill the output file must still have `\r\n` endings — `xxd CLAUDE.md | grep -c '0d0a'` must equal the original count
- [ ] Idempotency: run `_fill_claude_md` / `Set-ClaudeMdFields` twice on the same filled CLAUDE.md; file must be byte-for-byte identical after the second pass (`md5sum` before and after second run must match)
- [ ] Robustness: `readManifest` with EACCES stat error returns null without throwing — verified by T-002 robustness describe block
- [ ] Deep glob depth limit: workspace with 25 nesting levels (> MAX_DEPTH=20) must not expand beyond depth 20; verify with `CC_GLOB_DEPTH=20` on a deeply nested fixture
- [ ] git status clean after T-008: `git status --short` must show empty output after all T-008 commits (T-008-6)
- [ ] Terminal encoding on PS: `[Console]::OutputEncoding` set to UTF-8 before node invocation; `Out-String` capture of detect-stack JSON must contain no replacement characters (`?` or `�`) for non-ASCII values in package names
- [ ] go.work `use ( ... )` block syntax: paths inside a parenthesized block must be discovered; each `use path/to/mod` line inside the block matches `/^\s*use\s+(\S+)/gm` without special block handling
- [ ] **VERSION file:** `cat VERSION` must output exactly `1.16.0` with no trailing whitespace — standalone pre-completion check (T-008-2a)
- [ ] **CHANGELOG.md:** `## [1.16.0]` must be the first versioned entry after the `# Changelog` heading — standalone pre-completion check (T-008-3a)
- [ ] **README.md:** `Stack auto-detection` bullet must appear exactly once — standalone pre-completion check (T-008-4a)
- [ ] **GLOBAL_IGNORE includes `.venv` and `.turbo`:** `GLOBAL_IGNORE.has('.venv')` and `GLOBAL_IGNORE.has('.turbo')` must both be `true` — add assertions to `detect-stack.test.js` alongside the existing package manager tests
- [ ] **Missing headers → no-op:** fill a CLAUDE.md with no `## Development Commands` section; after `_fill_claude_md` / `Set-ClaudeMdFields`, file must be byte-for-byte unchanged — add as T-005 bash Test 8 and PS Test 5
- [ ] **Non-directory root → graceful exit 0:** `node scripts/detect-stack.mjs /path/to/a/file.txt` (a regular file) must exit 0 and emit valid JSON without throwing; add to T-001-3 smoke verification
- [ ] **Node corrupted/empty version output → skip:** simulate `_ds_major=""` in bash (`case ''|*[!0-9]*)` guard coerces to 0 → `-lt 18` fires); simulate `$nmRaw=""` in PS (`-match '^v(\d+)'` fails → `$nm=0`); both must emit one warn and set skip flag — document in T-003-2 and T-004-2 block comments
- [ ] **Indented placeholder line matched and indentation preserved:** a CLAUDE.md line `  - Build: <command>` (two leading spaces) must be filled as `  - Build: detected-value` (indentation preserved) — add as T-005 bash Test 9 (indented-template variant) and PS Test 6
- [ ] **Variant placeholder spaces matched:** `- Build: < command >` (spaces inside angle brackets) must be filled the same as `- Build: <command>` — add assertion to T-005 bash Test suite
- [ ] **`package.json#workspaces` object form:** `{"workspaces":{"packages":["apps/*"]}}` must trigger `monorepo=true` and expand `apps/*` — add Vitest case to T-002 test suite in a `detectMonorepo` describe block
- [ ] **`process.exit(0)` after stdout.write:** smoke-test `node scripts/detect-stack.mjs "$PWD"` must return within 15 seconds on a repo with no hanging readdir (i.e. process does not linger) — verified by T-001-3
- [ ] **MAX_DIRS cap emits WARN:** create a fixture with 201 workspace dirs; verify detect-stack exits 0, JSON `workspaceDirs.length === 200`, and stderr contains `WARN: workspace dir count exceeds 200`
- [ ] **PS UTF-8 no-BOM:** `$bytes = [System.IO.File]::ReadAllBytes("CLAUDE.md"); $bytes[0] -ne 0xEF -or $bytes[1] -ne 0xBB -or $bytes[2] -ne 0xBF` must be true after `Set-ClaudeMdFields` — and the JSON temp file must also be BOM-free (verified by T-004-2b)
- [ ] **Empty detect-stack.mjs download skipped:** simulate `_ds_tmp` = empty file; bash `[ -s "$_ds_tmp" ]` must return false → warn emitted, fill skipped, no `SyntaxError` output reaches user
- [ ] **`**` in negative exclusion pattern is a no-op:** `expandPatterns(['apps/*', '!apps/**/internal'], ROOT, visited)` must NOT error; `internal` dirs are included (no match against the `**/` literal path) — add Vitest case to T-002
- [ ] **Circular directory hierarchy mock:** add Vitest case where `realpath` mock returns a path already in `visited` set; `safeAddDir` must return `false` and not recurse

## Commit Order

1. **T-001 + T-002**: `scripts/detect-stack.mjs` + `tests/scripts/detect-stack.test.js`
2. **T-003**: `install.sh` extension
3. **T-004**: `install.ps1` extension
4. **T-005**: installer test harnesses
5. **T-006**: `cc-init.md` Step 2 rewrite
6. ~~**T-007**~~: skipped — out of scope (FEAT-007, delivered in e64fc44)
7. **T-008-2**: `VERSION` bump
8. **T-008-3**: `CHANGELOG.md` entry
9. **T-008-4**: `README.md` update
10. **T-008-1 + T-008-5**: `AGENT-READABLE BACKLOG.md` close

## Identified Risks

| Risk | Mitigation |
|------|------------|
| `node -` heredoc + env var `_CC_JSON` may hit OS env size limits (rare, > 128KB JSON) | JSON from detect-stack is always < 10KB in practice; no action needed |
| `$` in detected values corrupts JS string replace | `clean.replace(/\$/g, '$$$$')` in the fill script neutralizes regex back-refs |
| PS 5.1 `node -e $script $MdPath $jsonTmp` — JSON path arg with spaces | `$jsonTmp` is a `GetTempFileName()` path; on Windows always in `%TEMP%` which may have spaces — use quoted arg: `node -e $script "$MdPath" "$jsonTmp"` |
| detect-stack.mjs downloaded from GitHub at install time — network failure | Graceful fallback: installer warns and keeps `<command>` placeholders |
| `fs.renameSync` fails cross-volume on Windows | Fallback `writeFileSync` + `unlinkSync` in node fill script handles this |
| Melos `packages:` false positive on indented key | Column-0 + not-`#` guard in `parseMelosPackages` prevents this |
