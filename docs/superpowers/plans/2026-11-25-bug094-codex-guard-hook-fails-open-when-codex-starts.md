# BUG-094: Codex guard hook fails open outside the project root, implementation plan

**Goal:** The Codex `PreToolUse` hook enforces the project's guard from any start directory, and blocks visibly
whenever the guard cannot run, instead of resolving a cwd-relative path and failing open.

**Architecture:** `.codex/hooks.json` carries a `node -e "<body>"` bootstrap that walks up from its working
directory to the nearest ancestor holding `.codex/hooks.json`, imports `<root>/.codex/hooks/conductor-guard.mjs`
and calls its exported `main()`. The adapter takes `<root>` from its own location, runs
`<root>/.claude/hooks/pre-tool-use.mjs` with `process.execPath`, passes a trustworthy verdict through unchanged and
answers Claude's deny shape for everything else. The installer installs the adapter as a managed file and replaces
the FEAT-048 entry through a legacy fingerprint, printing a re-trust line when it does.

**Tech stack:** Node ESM, `node:` builtins only, vitest. Test command: `npm test`.

**Spec:** `docs/superpowers/specs/2026-11-25-bug094-codex-guard-hook-fails-open-when-codex-starts-design.md`
(approved by the owner; sha256 `bd00f7629d94522c1bed8c76ac8f0be24aa7906cd833b69a99259020217dce2b`).

## Global constraints

- `project-template/.claude/hooks/pre-tool-use.mjs` and `.claude/hooks/pre-tool-use.mjs` are not edited; no new
  dependency; `dependencies` stays `{}`.
- Records are not touched: `VERSION`, `package.json`/`package-lock.json` versions, `CHANGELOG.md`, the backlog,
  `.claude/memory/**`, and the README "Known limits" `[BUG-094]` line (`README.md:537`).
- The Claude settings merge and the Antigravity merge pass no legacy list and keep today's statuses and output.
- The installer is never run in this repository; it is exercised only through its tests in temp directories.
- Protected surfaces touched: hooks (`project-template/.codex/`), installer (`lib/installer/`). No workflow file is
  touched, so no `.github/` change is needed.
- Never bare `git add -u`; every staging step names its paths.

## Decisions this plan takes (technical, inside the spec)

1. **How the bootstrap runs the adapter: `import(...)` then `m.main()`.** The Antigravity adapter runs its `main()`
   only when it is `process.argv[1]`; under `node -e` there is no `argv[1]`, so an import alone would run nothing
   and print nothing, which is an allow. The Codex adapter therefore exports `main()`, and the bootstrap calls it.
   A missing export throws inside the promise chain and lands in the bootstrap's `catch`, which prints a deny. The
   adapter keeps the same direct-run guard as the Antigravity one, so `node .codex/hooks/conductor-guard.mjs`
   also works for a manual check.
2. **The import uses a file URL** (`require('url').pathToFileURL(a).href`): a bare Windows absolute path is not a
   valid ESM specifier.
3. **No newline escape in the bootstrap's deny.** `'\n'` would put `\` in the body, which choice 6 forbids. The
   bootstrap writes the JSON with no trailing newline; Codex parses the object either way (the guard's own output
   is a single JSON line too).
4. **Reference body (the build may reformat it but must keep its behavior and its alphabet):**

   ```js
   const p=require('path'),f=require('fs'),u=require('url');const deny=(r)=>process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'deny',permissionDecisionReason:r}}));const has=(d)=>f.existsSync(p.join(d,'.codex','hooks.json'));let d=process.cwd();while(has(d)===false&&(p.dirname(d)===d)===false)d=p.dirname(d);const a=p.join(d,'.codex','hooks','conductor-guard.mjs');if(has(d)===false)deny('code-conductor: no .codex/hooks.json in '+process.cwd()+' or above; the guard did not run');else if(f.existsSync(a)===false)deny('code-conductor: no guard adapter at '+a+'; the guard did not run');else import(u.pathToFileURL(a).href).then((m)=>m.main()).catch((e)=>deny('code-conductor: the guard adapter at '+a+' could not run: '+e.message));
   ```

   Prototyped under `sh -c` during planning: from the root and from `sub/deep` it reached the adapter; from `/` it
   printed the "no .codex/hooks.json" deny; with the adapter removed it printed the "no guard adapter" deny naming
   the path. Character scans of earlier drafts found one `\` (the `'\n'`, hence decision 3) and one `!` (a `!==` in
   the walk-up loop, now written `(p.dirname(d)===d)===false`); `sh -c` does not expand `!=`, so only the scan caught
   it. The body above was re-scanned in full against the six forbidden characters and for non-printable bytes, found
   none, and was re-run through the four cases above with the same results.
5. **"Replaced through a legacy fingerprint" means an entry that matches a legacy fingerprint and not the current
   one.** Such an entry is the old fail-open command. `mergeSettingsFile` returns `legacy-replaced` when the write
   (the text differs from the host file) replaced or dropped at least one such entry. An entry matching both the
   current and a legacy fingerprint is the current entry, so its replacement reads `merged`. A dropped duplicate
   legacy entry behind a current one still counts, because the file changed and Codex will ask for trust again.
6. **Option shape:** `mergeSettingsFile(templatePath, settingsPath, fingerprints, { now, legacyFingerprints = {} })`,
   where `legacyFingerprints` maps a current fingerprint to its old ones, here
   `{ 'conductor-guard.mjs': ['pre-tool-use.mjs'] }`. `mergeHarnessHooks` gains one optional trailing parameter
   with the same map and returns the merge status when the entry is in place (`created`, `merged`, `unchanged`,
   `malformed-replaced`, `legacy-replaced`) and `null` otherwise. The Antigravity caller still tests it for
   truthiness, so its behavior does not change.
7. **Shell matrix by platform, not by probe, except `pwsh`.** `sh -c` runs on non-Windows platforms;
   `cmd.exe /d /s /c` and `powershell -NoProfile -Command` run on Windows; `pwsh -NoProfile -Command` runs on
   Windows when a `pwsh -NoProfile -NonInteractive -Command "exit 0"` probe succeeds (the probe shape of
   `tests/hooks/context-guard.test.js:237-241`). Gating on the platform keeps each CI leg's skip set fixed, so
   `tools/skip-baseline.json` can be predicted exactly. `cmd.exe` gets the command wrapped in one extra pair of
   quotes with `windowsVerbatimArguments: true` (what `/s` strips, and how Node's own `shell: true` calls it).
   PowerShell gets the command as one argv element.
8. **Corpus parity is byte parity.** The adapter passes the guard's output unchanged, so the corpus test asserts
   that the Codex command's stdout equals the Claude hook's stdout for the same payload, which is stronger than an
   equal allow/deny. The Claude hook reference is `node <root>/.claude/hooks/pre-tool-use.mjs` run at `<root>`
   with `CLAUDE_PROJECT_DIR=<root>` set explicitly, which is the value the adapter forces, so both sides read the
   same allowlist. Both sides receive the same payload text, whose `cwd` is the directory the shell starts in
   (`<root>` or `<root>/sub/deep`).
9. **One clean environment for every spawned process.** The suite builds each child's environment with one helper,
   `codexEnv(extra)`: a copy of `process.env` with `CLAUDE_PROJECT_DIR`, `CC_HOOK_ALLOW`, `CC_GUARD3_WARN`,
   `CC_HOOK_DEBUG` and `CC_FLOW_OFF` deleted (the BUG-061 convention of `tests/hooks/flow-events.test.js:14-18`),
   then `CC_FLOW_OFF=1` and `extra` applied. The shell runs (corpus, matrix, shadowing, fail-closed) use
   `codexEnv({})`; the reference run uses `codexEnv({ CLAUDE_PROJECT_DIR: root })`. An inherited
   `CLAUDE_PROJECT_DIR` would point the reference at another checkout's allowlist, an inherited `CC_HOOK_ALLOW` or
   `CC_GUARD3_WARN` would reach the guard through the adapter's `...process.env` and flip deny rows, and
   `CC_FLOW_OFF=1` keeps rows from writing flow events into the scaffold under the payload's `cwd`.

## Predicted skips per environment

The only new skips are in `tests/hooks/codex-guard.test.js`, describe `Codex hook: shell matrix (BUG-094)`:

| Environment | New skipped identities |
|---|---|
| Local (Linux, Node 24) | `cmd.exe /d /s /c …`, `powershell -NoProfile -Command …`, `pwsh -NoProfile -Command …` (3) |
| `ci-node20` (ubuntu) | the same 3 |
| `ci-node24` (ubuntu) | the same 3 |
| `ci-windows-node24` | `sh -c …` (1); `pwsh` is preinstalled on `windows-latest`, so its case runs |

Exact identities (each ends `denies a deny row and allows an allow row from a subdirectory`):

- `tests/hooks/codex-guard.test.js > Codex hook: shell matrix (BUG-094) sh -c denies a deny row and allows an allow row from a subdirectory`
- `tests/hooks/codex-guard.test.js > Codex hook: shell matrix (BUG-094) cmd.exe /d /s /c denies a deny row and allows an allow row from a subdirectory`
- `tests/hooks/codex-guard.test.js > Codex hook: shell matrix (BUG-094) powershell -NoProfile -Command denies a deny row and allows an allow row from a subdirectory`
- `tests/hooks/codex-guard.test.js > Codex hook: shell matrix (BUG-094) pwsh -NoProfile -Command denies a deny row and allows an allow row from a subdirectory`

No other new test skips: the new symlink case in `tests/installer/deploy.test.js` uses `CAN_SYMLINK`, and the
Antigravity symlink case with the same gate is absent from every leg's baseline, so it runs on all three.

---

- [X] [T-000] Task 0: commit the plan (done by the runner at the end of the plan session)
  - [X] [T-000-A] Add the leaf `!/docs/superpowers/plans/2026-11-25-bug094-codex-guard-hook-fails-open-when-codex-starts.md` to the `.gitignore` tracked-surface block in sorted position (after `2026-11-23-feat048-harness-commands.md`).
  - [X] [T-000-B] `git add -f docs/superpowers/plans/2026-11-25-bug094-codex-guard-hook-fails-open-when-codex-starts.md` then `git add -u .gitignore`.
  - [X] [T-000-C] `git commit -m "docs: add the BUG-094 Codex guard hook implementation plan [BUG-094]"`

### Task 1: legacy fingerprints in the settings merger

**Files:**
- Modify: `lib/installer/settings-merge.mjs` (`upsertEntry`, `mergeHookTree`, `mergeSettingsFile`)
- Test: `tests/installer/settings-merge.test.js`

**Interfaces:**
- `mergeSettingsFile(templatePath, settingsPath, fingerprints, { now = new Date(), legacyFingerprints = {} } = {})`
  returns one of today's statuses or `legacy-replaced` (decision 5). Without `legacyFingerprints` the output is
  byte-identical to today's for every input.
- `upsertEntry(arr, tplEntry, fingerprint, legacy = [])`: an entry is "ours" when it matches `fingerprint` or any
  of `legacy`; the first is replaced in place, later ones dropped (today's rule). It returns
  `{ entries, legacyHit }`, where `legacyHit` is true when a replaced or dropped entry matched a legacy fingerprint
  and not `fingerprint`.
- `mergeHookTree(hostHooks, tplHooks, fingerprints, legacyFingerprints)` returns `{ hooks, legacyHit }`.
- `upsertEntry` and `mergeHookTree` stay at or under 30 lines. `mergeSettingsFile` is already about 53 lines
  (`settings-merge.mjs:68-120`); it gains only the option destructuring, the `legacyFingerprints` argument to
  `mergeHookTree` and the `legacy-replaced` status branch, nothing else. The comments on `upsertEntry` and `mergeSettingsFile` say why a legacy
  fingerprint exists (an entry whose command changed so much that it no longer carries the current fingerprint).

- [X] [T-001] Merger tests, then the merger
  - [X] [T-001-A] Modify `tests/installer/settings-merge.test.js`: add `describe('mergeSettingsFile: legacy fingerprints (BUG-094)')` with a template whose one `PreToolUse` entry runs `node -e "conductor-guard.mjs"`, `FPS_CODEX = ['conductor-guard.mjs']`, `LEGACY = { 'conductor-guard.mjs': ['pre-tool-use.mjs'] }` and a legacy host entry running `node .claude/hooks/pre-tool-use.mjs`. Cases: (1) `[HOST_ENTRY, legacy, HOST_ENTRY2]` → `[HOST_ENTRY, shipped, HOST_ENTRY2]`, status `legacy-replaced`; (2) a host that is already the merged result of (1), built as its own fixture (`[HOST_ENTRY, shipped, HOST_ENTRY2]` written directly, not produced by case (1)) → `unchanged`; (3) an entry carrying both `conductor-guard.mjs` and `pre-tool-use.mjs` → one shipped entry in its position, status `merged`; (4) `[legacy, legacy]` → `[shipped]`, `legacy-replaced`; (5) `[shipped, legacy]` → `[shipped]`, `legacy-replaced`; (6) a missing host file → `created`; (7) the same host as (1) merged without `legacyFingerprints` → legacy kept and shipped appended, status `merged`, never `legacy-replaced`; (8) the existing `TPL`/`FPS` host-preservation input merged with an empty `legacyFingerprints` gives the same bytes as without the option.
  - [X] [T-001-B] Run `npx vitest run tests/installer/settings-merge.test.js`. Expected: the 21 existing tests PASS; new cases (1), (4) and (5) FAIL (the legacy entry is kept and the status is not `legacy-replaced`); new cases (2), (3), (6), (7) and (8) PASS already, because today's merger ignores the option and these cases do not depend on it. Any other result halts the task.
  - [X] [T-001-C] Modify `lib/installer/settings-merge.mjs` per Interfaces.
  - [X] [T-001-D] Run `npx vitest run tests/installer/settings-merge.test.js tests/installer/deploy.test.js tests/installer/templates.test.js`; expected: all PASS (the deploy and template suites are unchanged callers).
  - [X] [T-001-E] `git add -u lib/installer/settings-merge.mjs tests/installer/settings-merge.test.js docs/superpowers/plans/2026-11-25-bug094-codex-guard-hook-fails-open-when-codex-starts.md`
  - [X] [T-001-F] `git commit -m "fix: let the settings merger replace an entry through a legacy fingerprint [BUG-094]"`

### Task 2: the Codex adapter and the bootstrap entry

**Files:**
- Create: `project-template/.codex/hooks/conductor-guard.mjs`
- Modify: `project-template/.codex/hooks.json` (the one entry's `command` becomes the bootstrap, decision 4)
- Modify: `tests/installer/deploy.test.js` (only the last Codex case, `ships the real hooks.json in the template, pointing at the guard`, which pins the old command)
- Test: `tests/hooks/codex-guard.test.js` (new; pattern `tests/hooks/antigravity-guard.test.js`)

**Interfaces (adapter):**
- `ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')`; `GUARD = join(ROOT, '.claude', 'hooks', 'pre-tool-use.mjs')`.
- `export function main()`: reads stdin, prints the guard's output or a deny, never throws, exit code stays 0.
- Stdin empty or not JSON → deny `code-conductor guard could not read the Codex call: <message>`. The payload is
  passed to the guard as the same text, unchanged (spec Main path 4).
- Guard run: `spawnSync(process.execPath, [GUARD], { cwd: ROOT, input, encoding: 'utf8', timeout: 60000, windowsHide: true, env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT } })`.
- Readout: `res.error` (missing interpreter, timeout), a signal, or `status !== 0` → deny
  `code-conductor guard could not run (<GUARD>): …`; a missing guard file → the same deny (node exits 1 with
  `Cannot find module`); stdout empty after trim → print nothing; stdout a JSON object → write `res.stdout`
  unchanged; anything else (not JSON, or JSON that is not a plain object) → deny `…: output was not a JSON object`.
- Deny shape: `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":<reason>}}`.
- Same direct-run guard as the Antigravity adapter (`process.argv[1]` is this file → `main()`).

**Interfaces (bootstrap):** the exact form `node -e "<body>"`; the body is printable ASCII with none of
`"`, `$`, `` ` ``, `\`, `%`, `!`; it names `conductor-guard.mjs` and does not contain `pre-tool-use.mjs`.

**Test scaffold:** `mkdtempSync` project holding `.claude/hooks/pre-tool-use.mjs` (the template guard),
`.claude/memory/`, `.codex/hooks.json` (the shipped template file, byte for byte), `.codex/hooks/conductor-guard.mjs`
(the template adapter) and `sub/deep/`. The two corpus describes and the shell matrix share one read-only
scaffold built in `beforeAll`; the only file they touch is `.claude/memory/bash-scan-allowlist.txt`, which each
row writes (or removes) before it runs, and the cases in a file run in sequence. Every shadowing and fail-closed case builds its
own `scaffold()` and removes it in a `finally`, because each one adds, removes or replaces a file, so no result
depends on run order. The command under test is read from the scaffold's `.codex/hooks.json`
(`hooks.PreToolUse[0].hooks[0].command`), never retyped. Payloads are Claude's shape
(`{ cwd, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } }`) on stdin, with `cwd` set to the shell's start directory (decision 8). Every spawn uses `codexEnv` (decision 9).
The platform shell
is `sh -c` on non-Windows and `cmd.exe /d /s /c` on Windows (decision 7). Every run asserts exit status 0.

- [X] [T-002] Codex hook tests, then the adapter and the entry
  - [X] [T-002-A] Create `tests/hooks/codex-guard.test.js` with these describes and cases:
    - `Codex hook command: shipped form (BUG-094)`: (1) the command matches `^node -e "([ -~]*)"$` with nothing after the closing quote, and the body contains none of `"`, `$`, `` ` ``, `\`, `%`, `!`; (2) it contains `conductor-guard.mjs` and not `pre-tool-use.mjs`.
    - `Codex hook: Guard 3 corpus from the root (BUG-094)` and `Codex hook: Guard 3 corpus from a subdirectory (BUG-094)`: `it.each` over every Bash row of `CORPUS` and `DIALECT` (173 rows each; the allowlist file written per row as in the Antigravity test); the platform-shell run's stdout equals the Claude hook's stdout for the same payload (decision 8), and a `deny` row's output matches `/BASH SCAN BLOCKED/`.
    - `Codex hook: shell matrix (BUG-094)`: four `it.skipIf` cases named exactly as in "Predicted skips per environment"; each runs the command from `sub/deep` through its shell, expects a deny matching `/BASH SCAN BLOCKED/` for `cat *.log` and empty stdout for `echo probe-ok`.
    - `Codex hook: shadowing and nested layers (BUG-094)`: (1) `sub/.claude/hooks/pre-tool-use.mjs` that allows everything (prints nothing, exits 0) does not change the verdict of `cat *.log` run from `sub`; (2) `sub/` holding a complete nested layer (`.codex/hooks.json`, a copy of the adapter, an allow-everything guard) returns allow for `cat *.log` from `sub` (accepted residual risk, spec choice 2); (3) the same with `sub/.codex/hooks/conductor-guard.mjs` removed → deny naming `sub`'s adapter path.
    - `Codex hook: fails closed (BUG-094)`, each a deny on stdout with exit 0: (1) run from a fresh temp dir with no `.codex/hooks.json` in it or above (precondition: assert no ancestor holds one, failing with the ancestor's path rather than skipping) → reason names "no .codex/hooks.json"; (2) adapter removed → reason names its path; (3) adapter replaced by a file with a syntax error → reason "could not run"; (4) guard removed → reason names `pre-tool-use.mjs`; (5) guard printing `not json` → reason "not a JSON object"; (6) guard printing `5` → the same; (7) guard exiting 3 → reason names exit 3; (8) stdin `not json` → "could not read"; (9) empty stdin → "could not read".
  - [X] [T-002-B] Run `npx vitest run tests/hooks/codex-guard.test.js`. Expected on Linux: the 3 Windows shell-matrix cases SKIP; every other case (2 form cases, 346 corpus rows, `sh -c`, 3 shadowing, 9 fail-closed) FAILS, because the scaffold copies the template adapter, which does not exist yet, and the shipped command is still the FEAT-048 one. Any PASS halts the task.
  - [X] [T-002-C] Create `project-template/.codex/hooks/conductor-guard.mjs` per Interfaces (header comment: why it exists, BUG-094; fail closed; exits 0 on every path).
  - [X] [T-002-D] Modify `project-template/.codex/hooks.json`: replace the `command` value with the bootstrap (decision 4). Keep `matcher: ".*"`, `type: "command"` and the file's 2-space JSON layout with a trailing newline.
  - [X] [T-002-E] Modify `tests/installer/deploy.test.js` case `ships the real hooks.json in the template, pointing at the guard`: rename to `ships the real adapter and a hooks.json whose command is the bootstrap (BUG-094)`; assert `project-template/.codex/hooks/conductor-guard.mjs` exists and the template command contains `conductor-guard.mjs` and starts with `node -e "`.
  - [X] [T-002-F] Run `npx vitest run tests/hooks/codex-guard.test.js tests/hooks/antigravity-guard.test.js tests/installer/deploy.test.js tests/installer/cli.test.js`. Expected: all PASS except the 3 Windows shell-matrix SKIPs on Linux. The deploy Codex block still uses its own fixture template, so its other 3 cases stay green; `cli.test.js` creates `.codex/hooks.json` fresh, which writes the template verbatim.
  - [X] [T-002-G] `git add project-template/.codex/hooks/conductor-guard.mjs tests/hooks/codex-guard.test.js` then `git add -u project-template/.codex/hooks.json tests/installer/deploy.test.js docs/superpowers/plans/2026-11-25-bug094-codex-guard-hook-fails-open-when-codex-starts.md`
  - [X] [T-002-H] `git commit -m "fix: route the Codex guard hook through a root-anchored adapter [BUG-094]"`

### Task 3: the installer installs the adapter and upgrades the old entry

**Files:**
- Modify: `lib/installer/deploy.mjs` (`mergeHarnessHooks`, `installCodexHook`, the comment at 320-321, a `CODEX_GUARD` constant beside `ANTIGRAVITY_GUARD`)
- Modify: `tests/installer/deploy.test.js` (block `deployProject: Codex hook (FEAT-048)`)
- Modify: `tests/installer/cli.test.js` (case `wires the Codex hook with --project --codex …`)

**Interfaces:**
- `CODEX_GUARD = '.codex/hooks/conductor-guard.mjs'`.
- `installCodexHook`: `installManagedFile(templateRoot, cwd, CODEX_GUARD, 'guard', opts)` first; on false, return
  with nothing printed. Then `mergeHarnessHooks(templateRoot, cwd, '.codex', 'conductor-guard.mjs', opts.warn,
  { 'conductor-guard.mjs': ['pre-tool-use.mjs'] })`. Status `legacy-replaced` → report
  `code-conductor: replaced the old Codex guard hook in .codex/hooks.json; Codex asks for trust again after this edit, so the guards are not enforced until you re-trust the hooks in Codex with /hooks`
  (spec choice 5, verbatim, one line). Any other non-null status → today's
  `code-conductor: installed the Codex guard hook in .codex/hooks.json; trust it once in Codex with /hooks`.
  `null` → nothing (the warning was already printed).
- The comment at 320-321 says the hook runs the bootstrap, which finds the root from the hook's cwd, and the
  adapter, which finds it from its own location, because Codex may run the hook from any directory.

- [X] [T-003] Installer tests, then the installer
  - [X] [T-003-A] Modify the Codex block of `tests/installer/deploy.test.js`: the fixture template gets `.codex/hooks/conductor-guard.mjs` (`'// shipped codex guard\n'`) and the real shipped `hooks.json` (read from `ROOT`), so `OURS` is the shipped entry; add `LEGACY` (`node .claude/hooks/pre-tool-use.mjs`) and `REPLACED` (the replace line). Cases: (1) without the option nothing under `.codex/` exists (kept); (2) fresh install writes the adapter byte for byte and the shipped `hooks.json`, prints `INSTALLED`, not `REPLACED` (extends the existing case); (3) host hooks kept, ours added once, re-run byte-identical, both runs print `INSTALLED` and no `REPLACED` (extends the existing case); (4) new: host `[host, LEGACY, host2]` → `[host, OURS, host2]`, the report contains `REPLACED` (and it names `.codex/hooks.json`, "not enforced until" and `/hooks`) and not `INSTALLED`; a second run leaves the bytes unchanged and prints `INSTALLED`, not `REPLACED`; (5) new, `it.skipIf(!CAN_SYMLINK)`: a symlink at the adapter path is replaced by the shipped file and its target is untouched; (6) new: `.codex/hooks.json` is a directory → the skip warning, no `INSTALLED` and no `REPLACED`; (7) the template case from T-002-E (kept).
  - [X] [T-003-B] Modify `tests/installer/cli.test.js` case `wires the Codex hook with --project --codex and lists the flag in --help (FEAT-048)`: also assert `.codex/hooks/conductor-guard.mjs` exists and a `stdout:` log line equals the `INSTALLED` line.
  - [X] [T-003-C] Run `npx vitest run tests/installer/deploy.test.js tests/installer/cli.test.js`. Expected: Codex cases (2), (4), (5) and the extended CLI case FAIL (no adapter installed, legacy entry kept, no replace line); (3) FAILS because the old `pre-tool-use.mjs` fingerprint matches nothing in the shipped entry, so the merge adds nothing; (1), (6), (7) and every other test in both files (87 other deploy tests, 70 other CLI tests) PASS.
  - [X] [T-003-D] Modify `lib/installer/deploy.mjs` per Interfaces.
  - [X] [T-003-E] Run `npx vitest run tests/installer tests/hooks/codex-guard.test.js tests/hooks/antigravity-guard.test.js`; expected: all PASS (plus the 3 Windows shell-matrix SKIPs on Linux).
  - [X] [T-003-F] `git add -u lib/installer/deploy.mjs tests/installer/deploy.test.js tests/installer/cli.test.js docs/superpowers/plans/2026-11-25-bug094-codex-guard-hook-fails-open-when-codex-starts.md`
  - [X] [T-003-G] `git commit -m "fix: install the Codex guard adapter and upgrade the old hook entry [BUG-094]"`

### Task 4: README and the CI skip baseline

**Files:**
- Modify: `README.md` (`### Codex CLI` at 441 and 453; the tree near 601)
- Modify: `tools/skip-baseline.json`

- [X] [T-004] Documentation and baseline
  - [X] [T-004-A] Modify `README.md:441`: `--project --codex` installs `.codex/hooks/conductor-guard.mjs` and merges one `PreToolUse` entry into `.codex/hooks.json`; the entry is a short `node -e` bootstrap that finds the project root from the directory Codex runs it in, and the adapter runs the project's guard and blocks the call when the guard cannot run. Drop "so no adapter is needed". Keep the trust sentence.
  - [X] [T-004-B] Replace `README.md:453` (the "Launch `codex` from the project root" paragraph) with: `codex` may be started from the root or any subdirectory; if the nearest `.codex/hooks.json` has no adapter beside it, the call is blocked; the guards are not enforced without `node` on `PATH`; upgrading an install that has the old `node .claude/hooks/pre-tool-use.mjs` entry rewrites `.codex/hooks.json`, Codex then asks for trust again, and the guards are not enforced until the hooks are re-trusted in `/hooks` (the installer says so when it replaces the entry). Do not touch the Known-limits line at 537.
  - [X] [T-004-C] Modify the README tree near 601: add `|   +-- .codex/hooks/conductor-guard.mjs     Codex guard adapter, only with --codex (BUG-094)` above the `.codex/hooks.json` line, aligned with its neighbors.
  - [X] [T-004-D] Modify `tools/skip-baseline.json`: add the cmd.exe, powershell and pwsh identities to `ci-node20` and `ci-node24`, and the `sh -c` identity to `ci-windows-node24`, each in sorted position.
  - [X] [T-004-E] Run `npx vitest run tests/unit tests/scripts/doc-locations.test.js`; expected: all PASS (baseline-format and README-adjacent checks).
  - [X] [T-004-F] `git add -u README.md tools/skip-baseline.json docs/superpowers/plans/2026-11-25-bug094-codex-guard-hook-fails-open-when-codex-starts.md`
  - [X] [T-004-G] `git commit -m "docs: describe the Codex guard adapter and re-trust on upgrade [BUG-094]"`

### Task 5: closeout

- [X] [T-005] Full suite and scope check
  - [X] [T-005-A] Run `npm test`. Expected: exit 0; the only new skips are the 3 predicted Windows shell-matrix cases.
  - [X] [T-005-B] `git diff origin/main --stat` lists only: `.gitignore`, this plan, `README.md`, `lib/installer/deploy.mjs`, `lib/installer/settings-merge.mjs`, `project-template/.codex/hooks.json`, `project-template/.codex/hooks/conductor-guard.mjs`, `tests/hooks/codex-guard.test.js`, `tests/installer/cli.test.js`, `tests/installer/deploy.test.js`, `tests/installer/settings-merge.test.js`, `tools/skip-baseline.json` (plus the spec and its leaf, already on the branch). No record, no `pre-tool-use.mjs`, no `package.json`.
  - [X] [T-005-C] `git add -u docs/superpowers/plans/2026-11-25-bug094-codex-guard-hook-fails-open-when-codex-starts.md`
  - [X] [T-005-D] `git commit -m "docs: close out the BUG-094 plan [BUG-094]"`

## Test list

- [X] [T-006] `tests/installer/settings-merge.test.js` (Task 1): legacy-only entry replaced in place → `legacy-replaced`; re-run `unchanged`; entry carrying both fingerprints → one entry, `merged`; duplicate legacy → one entry; current plus legacy → legacy dropped, `legacy-replaced`; fresh → `created`; no legacy list → appended, `merged`, never `legacy-replaced`; empty legacy map → same bytes as none.
- [X] [T-007] `tests/hooks/codex-guard.test.js` (Task 2): shipped command form and alphabet; fingerprint present, legacy name absent; 173-row Guard 3 corpus byte parity from the root and from a subdirectory; shell matrix (`sh`, `cmd.exe`, `powershell`, `pwsh`) from a subdirectory; subdirectory guard alone ignored; complete nested layer judged by its own guard; nested `hooks.json` without an adapter blocks; nine fail-closed cases.
- [X] [T-008] `tests/installer/deploy.test.js` (Tasks 2 and 3): template pin; fresh install with adapter; host kept and re-run unchanged with `INSTALLED`; FEAT-048 entry replaced in place with `REPLACED`, then `INSTALLED` on the unchanged re-run; symlinked adapter path; `hooks.json` as a directory prints neither line.
- [X] [T-009] `tests/installer/cli.test.js` (Task 3): real `--project --codex` install writes the adapter and prints the installed line.

## Commit order

1. Task 0, plan (runner, end of the plan session).
2. Task 1, merger: independent of the hook files; every existing caller stays green.
3. Task 2, adapter, bootstrap and hook tests, plus the deploy template pin that the new `hooks.json` would break.
4. Task 3, installer wiring and its tests (needs Task 1's option and Task 2's adapter file).
5. Task 4, README and skip baseline (the baseline names Task 2's tests).
6. Task 5, closeout.

In the build session the runner makes one commit of the whole tree; the commit steps above are its grouping guide
and are ticked when the runner's commit carries them.

## Identified risks

- **PowerShell stdin and argument passing are unmeasured here.** The sandbox is Linux; the PowerShell and `cmd.exe`
  cases run first on the Windows leg. If PowerShell does not forward stdin to `node`, or rewrites the quoted body,
  the case fails red (the allow row turns into a deny, or the deny row into an allow), never green. The fix is
  then in the test's spawn call (decision 7) or a finding that the command form breaks under that shell, reported
  in the correction phase; the command is not weakened to make the test pass.
- **`pwsh` absent from `windows-latest`.** The case would skip and the Windows leg's baseline check would go red,
  naming the identity; the fix is adding it to `ci-windows-node24`.
- **An ancestor of the temp dir holding `.codex/hooks.json`** (for example a user-level `~/.codex/hooks.json` above a
  temp dir under the home directory) would change the "no ancestor" case. The test asserts the precondition and
  fails naming the ancestor instead of passing on the wrong path.
- **Corpus run time.** 173 rows × 2 locations, each spawning a shell, the bootstrap and the guard, plus the
  reference run: about 1,000 processes, comparable to the Antigravity suite's 346 guard runs times three. If the
  Windows leg nears the 30 s per-test limit, the rows are separate `it.each` cases, so no single test is long.
- **A host entry that merely mentions `pre-tool-use.mjs`** is captured as the conductor's and replaced. FEAT-048
  already claims that substring as conductor-owned in `.codex/hooks.json`, so no host entry changes owner (spec
  choice 5).
- **README flag table (`README.md:394`)** still says `--codex` merges an entry "that runs the project's guard",
  which stays true; the spec does not list that line, so it is left unchanged.
- **Guard-surface lists elsewhere** (for example the protected-path cases in `tests/scripts/orchestrate.test.js`
  near 4003) do not list the Antigravity adapter either; extending them is outside this item's spec.
