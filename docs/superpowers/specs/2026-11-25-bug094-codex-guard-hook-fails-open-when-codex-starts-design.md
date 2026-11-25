# BUG-094 — Codex guard hook fails open when Codex starts outside the project root

**Status:** Draft (pending independent review)

**Item:** `[BUG-094]` (intake of issue #314, follow-up of `[FEAT-063]`). Pillar 5: infrastructure, ecosystem and
quality assurance.

## Problem

`--project --codex` merges one `PreToolUse` entry into `.codex/hooks.json`
(`project-template/.codex/hooks.json:9`): `node .claude/hooks/pre-tool-use.mjs`. The path is relative, so it
resolves against whatever directory the hook process runs in, and nothing sits between Codex and the guard to
notice when it did not run:

- Codex started from a subdirectory: `<sub>/.claude/hooks/pre-tool-use.mjs` does not exist, `node` exits 1 with
  `Cannot find module`, and the tool call goes ahead.
- That subdirectory holds its own `.claude/hooks/pre-tool-use.mjs` (a nested project, a vendored checkout, a
  planted file): that file runs instead of the installed guard, and whatever it answers is the verdict.
- `node` is not on `PATH`: the command cannot start.

In each case Guards 1-7 are silently not enforced. The installer comment at `lib/installer/deploy.mjs:320-321`
("Codex runs it from the project root") states the assumption the bug breaks, and README `### Codex CLI`
(`README.md:453`) currently tells the user to work around it by launching from the root. Enforcement depends on how
the user starts the tool, not on the installation.

The Antigravity route (`project-template/.agents/hooks/conductor-guard.mjs`, FEAT-048) does not have this defect:
its adapter derives the project root from its own file location and blocks when the guard cannot run.

## Solution

Route the Codex hook through a small adapter, `project-template/.codex/hooks/conductor-guard.mjs`, built like the
Antigravity one: it takes the project root from its own location (`<root>/.codex/hooks/` → `<root>`), runs
`<root>/.claude/hooks/pre-tool-use.mjs` with `process.execPath`, cwd `<root>` and `CLAUDE_PROJECT_DIR=<root>`, passes
the guard's verdict through, and answers with Claude's deny shape whenever the guard could not run or answered
something it cannot trust. Because the hook process may start in any directory, the `hooks.json` command does not
name the adapter by a cwd-relative path: it is a short `node -e "<body>"` bootstrap (the body wrapped in one pair of
double quotes, choice 6) that walks up from its working directory to the nearest ancestor holding
`.codex/hooks.json`, imports `<that>/.codex/hooks/conductor-guard.mjs`, and prints a deny itself when no such
ancestor or no adapter exists. The installer installs the adapter as a managed file (as it
does for Antigravity) and upgrades the FEAT-048 entry in place. Tests run the installed command from the root and
from a subdirectory, through every shell named in choice 6 that the CI leg has.

### Choices the entry leaves open

1. **Adapter, not a root environment variable.** The issue offers a root variable "if Codex provides one". None was
   measured on Codex 0.171.0 (the FEAT-048 measurements record the payload, deny shape and trust gate only), and
   this change cannot run Codex live. A design resting on an unmeasured variable would fail open the day the guess
   is wrong; the adapter needs no Codex fact beyond the ones FEAT-048 measured.
2. **How the command finds the adapter: walk up to the nearest `.codex/hooks.json`.** Alternatives rejected:
   - *Absolute path written at install time.* Makes `.codex/hooks.json` machine-specific; a moved project or a
     teammate's clone of a committed hooks file points at a path that does not exist, which is the same silent
     fail-open this item removes.
   - *Walk up to the nearest `.claude/hooks/pre-tool-use.mjs` or `.codex/hooks/conductor-guard.mjs`.* The first is
     exactly the shadowing the issue reports; the second lets a lone planted adapter file win.
   - *A shell construct (`$(git rev-parse …)`, `%CD%`).* Not portable across the shells Codex may use on Unix and
     Windows.
   - *Walk up to the outermost ancestor holding `.codex/hooks.json` and the adapter.* A planted nested layer would
     lose to the root, but the walk would then trust directories above the project: a project under a shared,
     world-writable parent (for example `/tmp/<project>`) would run whatever another user placed in
     `/tmp/.codex/` and `/tmp/.claude/`. That turns a fail-open into code execution by someone outside the tree.
   The nearest `.codex/hooks.json` is the hooks layer closest to where Codex started, so it is the file that
   declared this command or a nested one. If that nested layer has no adapter of ours beside it, the bootstrap
   blocks: a nested project produces a visible block, never a silent pass. A `.claude/hooks/pre-tool-use.mjs` in a
   subdirectory is never run on its own: it runs only when that same subdirectory also holds `.codex/hooks.json`
   and `.codex/hooks/conductor-guard.mjs`, a complete nested installation.

   **Residual risk (accepted by the maintainer; see Owner decisions).** A subdirectory between the hook's cwd and the root that holds all three files
   (`.codex/hooks.json`, `.codex/hooks/conductor-guard.mjs`, `.claude/hooks/pre-tool-use.mjs`), whether a vendored
   checkout that installed the conductor with `--codex` or files planted on purpose, has its guard run instead of
   the root's. It is accepted because it grants nothing the attacker does not already hold: writing those files
   needs write access inside the project tree, and with that same access one can replace
   `<root>/.claude/hooks/pre-tool-use.mjs` or `<root>/.codex/hooks/conductor-guard.mjs` directly (no guard protects
   the hook files themselves; the Claude route has the same exposure). It also cannot be removed by any anchor rule
   that needs no install-time absolute path (rejected above): from inside the tree, a planted complete layer and a
   legitimate nested project look identical. The bar does rise from one planted file (today) to three, and the
   case is pinned by a test so the behavior is a recorded decision, not an accident. The only anchor-rule
   alternative is the outermost walk above, whose risk this spec judges worse.
3. **Deny by output, exit 0.** The only block mechanism measured on Codex is Claude's
   `hookSpecificOutput.permissionDecision: "deny"` on stdout (FEAT-048 live check; the guard itself exits 0 on every
   path, `project-template/.claude/hooks/pre-tool-use.mjs:4`). The bootstrap and the adapter block the same way and
   never rely on an exit code whose meaning to Codex is unmeasured.
4. **`node` not on `PATH` stays a documented limit.** Every command form that runs JavaScript must start an
   interpreter by name; whether Codex blocks a hook that cannot start is unmeasured, and no file the installer
   writes can change it. The README Codex subsection keeps one sentence saying that without `node` on `PATH` the
   guards are not enforced. Writing an absolute interpreter path is rejected for the reason in choice 2.

5. **How the installer replaces the FEAT-048 entry: a legacy fingerprint.** The Codex fingerprint becomes
   `conductor-guard.mjs`; the bootstrap's `-e` text names that file, so the shipped entry matches it and nothing
   else (`mergeHookTree` skips a shipped entry matching zero or several fingerprints,
   `lib/installer/settings-merge.mjs:52`). The old entry carries only `pre-tool-use.mjs` and would not match, so the
   new entry would be appended and the fail-open one kept. `mergeSettingsFile` therefore gains, in its existing options
   object (beside `now`), an optional per-fingerprint list of legacy fingerprints (here `conductor-guard.mjs` → `['pre-tool-use.mjs']`), and
   `upsertEntry` treats a host entry matching the fingerprint **or** one of its legacy fingerprints as the same
   entry: the first such entry is replaced in place, later ones are dropped, exactly as for a duplicate today.
   `pre-tool-use.mjs` is the substring FEAT-048 already claims as conductor-owned in `.codex/hooks.json`, so no host
   entry changes owner. Callers that pass no legacy list (the Claude settings and Antigravity merges) behave as
   before. Rejected: keeping `pre-tool-use.mjs` as the fingerprint by writing that name into the bootstrap text,
   which would make the command name a file it never runs only to satisfy the matcher.

   **Reporting the replace.** Codex asks for hook trust again after `.codex/hooks.json` is edited (README
   `### Codex CLI`), so on an upgrade the guards are not enforced until the user re-trusts. The user has to be
   told. `mergeSettingsFile` therefore returns a new status, `legacy-replaced`, when the write replaced at least one
   host entry through a legacy fingerprint. Only a caller that passes a legacy list can get it, so the Claude
   settings and Antigravity merges see the same statuses as today. `mergeHarnessHooks` counts it as written (like
   `merged`) and hands the status back, so `installCodexHook` can pick its report line. On `legacy-replaced` it
   prints, instead of the "installed" line:
   `code-conductor: replaced the old Codex guard hook in .codex/hooks.json; Codex asks for trust again after this
   edit, so the guards are not enforced until you re-trust the hooks in Codex with /hooks`.
   Any other written status keeps today's "installed … trust it once in Codex with /hooks" line. Rejected: reading
   the host file a second time in `installCodexHook` to look for the old entry. That would repeat the matcher's
   fingerprint logic outside it, and the two copies could disagree.
6. **Command form: `node -e "<body>"`, the body in one pair of double quotes, with a closed alphabet inside.** Which
   shell Codex runs a hook command through has not been measured. On Unix it is presumably `sh` or the user's shell.
   On Windows it may be `cmd.exe` or PowerShell. So the command is written to reach `node` as one argv element,
   byte for byte the same, under POSIX `sh` (bash and zsh accept the same form), `cmd.exe`, Windows PowerShell 5.1
   and PowerShell 7.
   - **Delimiter.** The double quote is the only quote all of these treat as a quote. `cmd.exe` does not treat `'`
     as one. Node's Windows argv parser (MSVC rules) groups only on `"`. The command starts with `node`, not with a
     quote, so `cmd.exe /c` and `/s /c` do not strip the pair.
   - **Inside the quotes.** The body is printable ASCII only, because PowerShell also treats typographic quotes as
     quotes. It contains none of these characters:
     - `"`, which ends the argument in every shell;
     - `$` and `` ` ``, which expand or escape inside double quotes in `sh` and PowerShell;
     - `\`, which escapes in `sh` double quotes and before `"` under MSVC rules;
     - `%`, which `cmd.exe` expands even inside quotes;
     - `!`, which is delayed expansion in `cmd.exe` and history expansion in an interactive bash.

     JavaScript strings in the body use single quotes. Paths are built with `path.join` and `path.dirname`.
     Negation is written without `!` (for example `===false`).
   - **Every other character is literal between double quotes in all of these shells**: space, `(`, `)`, `;`, `&`,
     `|`, `<`, `>`, `^`, `'`, `*`, `?`, `[`, `{`, `#`, `~`, `=`. Inside double quotes, `sh` acts only on `$`, `` ` ``
     and `\`. `cmd.exe` stops treating space, `&`, `|`, `<`, `>`, `(`, `)` and `^` as special. PowerShell acts only
     on `$` and `` ` ``. No further escaping is needed.
   - **Rejected forms.** An unquoted body cannot work: JavaScript cannot call a function without `(`, which `sh`
     parses as syntax. A single-quoted body fails open on `cmd.exe`, which passes the quotes through. If such a body
     has no spaces, it reaches `node` as one string literal, which evaluates, prints nothing and exits 0: an allow.
   - **A command that runs but not as the bootstrap.** Empty output means allow, so a command that reached `node`
     mangled but still parsed would pass silently. No file the installer writes can detect that at run time,
     because the bootstrap is what would detect it. The closed alphabet removes every mechanism above that mangles a
     double-quoted argument. The tests close the rest:
     - the shipped command is read from the shipped `hooks.json` and run through every shell present on the CI leg:
       `sh -c` on Unix, and `cmd.exe /d /s /c`, `powershell -NoProfile -Command` and `pwsh -NoProfile -Command`
       (when installed) on the Windows leg;
     - it runs from a subdirectory, and a deny corpus row must come back as a deny.

     A command that does not run as the bootstrap answers allow for that row, so the test fails. A shell missing from
     a leg is skipped by name, never passed.

### Owner decisions

- **Residual risk of choice 2: accepted (option a).** When a complete nested guard layer (`.codex/hooks.json`,
  `.codex/hooks/conductor-guard.mjs` and `.claude/hooks/pre-tool-use.mjs`) sits between the Codex start directory
  and the project root, that nested layer's guard is used instead of the root's. Writing those three files already
  requires write access to the project tree, and that access can replace the root guard directly. The risk stays
  stated under Out of Scope and is pinned by the nested-layer acceptance criterion.
- **Spec approved, with one required addition: re-trust on upgrade.** The upgrade path edits `.codex/hooks.json`,
  and Codex asks for trust again after that edit, so the guards are not enforced until the user re-trusts. Three
  things follow. (1) When the installer replaces the FEAT-048 entry, its report line tells the user to re-trust the
  hooks in Codex with `/hooks` (choice 5, "Reporting the replace"). (2) The README `### Codex CLI` subsection says
  so for upgrades. (3) An acceptance criterion covers that report line on replace.
- **Follow-up item.** A follow-up backlog item is filed to measure, against a live Codex, whether Codex blocks a
  hook that cannot start or that exits non-zero (the `node`-not-on-`PATH` case). This change does not do that
  measurement (Out of Scope). The item is filed through the backlog's own process, not by this change.
- No other changes to the spec were requested.

## Behavior

### Main path

1. `code-conductor --project --codex` installs `.codex/hooks/conductor-guard.mjs` (managed, overwritten on
   re-install, symlink-safe like the Antigravity guard) and merges the bootstrap entry into `.codex/hooks.json`,
   keeping every host entry (BUG-069).
2. The user trusts the hooks once in Codex (`/hooks`), as today, and starts `codex` from the root or from any
   subdirectory.
3. On each `PreToolUse`, Codex runs the bootstrap in its hook working directory. The bootstrap walks up to `<root>`
   (the nearest ancestor with `.codex/hooks.json`) and imports `<root>/.codex/hooks/conductor-guard.mjs`.
4. The adapter reads the payload on stdin and runs `<root>/.claude/hooks/pre-tool-use.mjs` with it on stdin, cwd
   `<root>`, `CLAUDE_PROJECT_DIR=<root>`, a 60 s timeout. The payload is passed unchanged: Codex already sends
   Claude's shape.
5. Guard exit 0 with empty stdout → adapter prints nothing (allow). Guard exit 0 with a JSON object on stdout → the
   adapter writes that output unchanged, so a deny or ask reaches Codex as today.

### Alternative paths

- Codex started at the root: same result as the shipped entry for every Guard 3 corpus row.
- A subdirectory holds its own `.claude/hooks/pre-tool-use.mjs` (no `.codex/` layer beside it): never run; the root
  guard judges the call.
- A subdirectory holds a complete nested layer (`.codex/hooks.json`, `.codex/hooks/conductor-guard.mjs` and
  `.claude/hooks/pre-tool-use.mjs`) and Codex's hook cwd is inside it: that layer's guard judges the call, with
  that subdirectory as its root (the accepted residual risk in choice 2).
- A subdirectory holds its own `.codex/hooks.json` but no `.codex/hooks/conductor-guard.mjs`: the bootstrap blocks,
  naming the folder it looked in.
- The host's `.codex/hooks.json` already holds the FEAT-048 entry (`node .claude/hooks/pre-tool-use.mjs`): a
  re-install replaces it in place with the bootstrap entry; no duplicate, host entries kept. The installer prints
  the replace line (choice 5): the hooks file changed, Codex will ask for trust again, and the guards are not
  enforced until the user re-trusts the hooks with `/hooks`. A second re-install changes nothing in the file and
  prints the usual "installed" line, not the replace line.
- Without `--codex`, nothing under `.codex/` is written (unchanged from today).

### Error cases

Each prints a deny with a reason naming the cause, and exits 0:

- No ancestor of the hook's cwd holds `.codex/hooks.json`, or the adapter beside it is missing or fails to import
  (bootstrap).
- Stdin empty or not JSON (adapter).
- `<root>/.claude/hooks/pre-tool-use.mjs` missing, the guard times out, is killed by a signal, exits non-zero, or
  prints something that is not a JSON object (adapter; same rules as the Antigravity adapter's "guard could not
  run").
- The installer's existing hooks-file cases (malformed JSON backed up and replaced, directory or dangling symlink
  skipped with a warning) keep their current behavior; when the hooks entry is skipped, the "installed" line is not
  printed.
- The shell hands `node` something other than the bootstrap body, for example a quote passed through so the body
  evaluates as a string literal. Nothing can print a deny at run time in that case, since the bootstrap is what
  would print it. Choice 6 prevents it by construction: double-quote delimiting and a closed alphabet. The
  shell-matrix test catches any regression, because a deny row must come back as a deny through each shell. Such a
  command therefore never ships as an allow.

## Acceptance Criteria

- [ ] `project-template/.codex/hooks.json` no longer runs a cwd-relative path to the guard. Its one entry is
      the bootstrap, of the exact form `node -e "<body>"`: one pair of double quotes, nothing after the closing
      quote. The body is printable ASCII containing none of `"`, `$`, `` ` ``, `\`, `%`, `!` (choice 6). A test pins
      the form and the alphabet.
- [ ] Hook test (shell matrix): from a subdirectory of a scaffolded project, the shipped command run through
      `sh -c` (Unix legs), `cmd.exe /d /s /c` and `powershell -NoProfile -Command` (Windows leg), and
      `pwsh -NoProfile -Command` where installed, denies a Guard 3 deny row and allows an allow row. A shell absent
      from the leg is skipped by name, and the skip is predicted in the plan for `tools/skip-baseline.json`.
- [ ] Hook test: in a temp project scaffolded with the guard, the adapter and the shipped `hooks.json`, the shipped
      command run through the platform shell (`sh -c` on Unix, `cmd.exe /d /s /c` on Windows) from the root **and from a subdirectory** gives the same allow/deny as
      the Claude hook for every Bash row of `tests/fixtures/guard3-corpus.js` (the backlog's "launching from a
      subdirectory" test).
- [ ] Hook test: a subdirectory holding its own `.claude/hooks/pre-tool-use.mjs` that allows everything does not
      change the verdict when the command runs from that subdirectory.
- [ ] Hook test: each error case above yields a Claude-shaped deny on stdout with exit 0 — no ancestor
      `hooks.json`, nested `hooks.json` without an adapter, adapter missing, guard missing, guard printing
      `not json`, guard exiting non-zero, non-JSON stdin.
- [ ] Installer test: `--codex` installs `.codex/hooks/conductor-guard.mjs` and the bootstrap entry; a host
      `hooks.json` holding the FEAT-048 entry ends with exactly one conductor entry (the bootstrap) in the same
      position, host entries kept; a second run is unchanged; without `--codex` nothing under `.codex/` exists.
- [ ] Installer test (re-trust on replace): when `--codex` replaces a host's FEAT-048 entry, the report contains the
      replace line, which names `.codex/hooks.json`, says the guards are not enforced until the hooks are re-trusted,
      and names `/hooks`. It does not contain the "installed" line. A fresh install and a second, unchanged run print
      the "installed" line and no replace line. A merge test pins that `mergeSettingsFile` returns
      `legacy-replaced` only when a legacy fingerprint matched, and never for a call without a legacy list.
- [ ] Hook test: from a subdirectory holding a complete nested layer whose guard allows everything, the shipped
      command returns that nested guard's verdict (allow), pinning the residual risk of choice 2 as decided
      behavior; the same subdirectory with the nested `.codex/hooks/conductor-guard.mjs` removed yields a deny.
- [ ] Merge test in `tests/installer/settings-merge.test.js`: a host entry matching only a legacy fingerprint is replaced in place by the shipped entry; a host entry matching both the
      fingerprint and a legacy one, or a duplicate legacy entry, ends as one entry; a call without a legacy list
      merges exactly as before.
- [ ] The installer comment at `lib/installer/deploy.mjs:320-321` and README `### Codex CLI` describe the adapter;
      the "launch from the project root" instruction is removed; the `node`-on-`PATH` limit stays stated. README
      `### Codex CLI` also says that upgrading an install that has the old entry rewrites `.codex/hooks.json`, that
      Codex then asks for trust again, and that the guards are not enforced until the hooks are re-trusted in
      `/hooks`.
- [ ] `npm test` passes; the change adds no dependency and does not touch `.claude/hooks/pre-tool-use.mjs`.

## Out of Scope

- A Codex root environment variable, and measuring whether Codex blocks a hook that cannot start or exits non-zero
  (needs a live Codex run). The second measurement goes to the follow-up item in Owner decisions.
- Making the hook work without `node` on `PATH` (choice 4).
- Defending against a complete nested guard layer between the Codex start directory and the project root. Such a
  layer's guard runs instead of the root's. This is a remaining, accepted risk (Owner decisions): planting it needs
  the same write access to the project tree that could replace the root guard directly.
- Mapping Codex tools other than the shell (Guards 1, 2 and 4 stay "not reached", README).
- The Antigravity adapter, the OpenCode plugin, and Codex's hook trust gate.
- Records: the README "Known limits" `[BUG-094]` line, `CHANGELOG.md`, `VERSION`, the backlog (written at release).

## System Impact

- `project-template/.codex/hooks.json` — entry replaced by the bootstrap (protected surface: hooks).
- `project-template/.codex/hooks/conductor-guard.mjs` — new adapter (protected surface: hooks).
- `lib/installer/deploy.mjs` — `installCodexHook` installs the adapter through `installManagedFile` before merging
  and passes fingerprint `conductor-guard.mjs` with legacy fingerprint `pre-tool-use.mjs` (choice 5);
  `mergeHarnessHooks` forwards the optional legacy list; comment at 320-321 (protected surface: installer). `.codex`
  is already in `HARNESS_DIRS`, so the template copy loop needs no change.
- `lib/installer/settings-merge.mjs` — `mergeSettingsFile`, `mergeHookTree` and `upsertEntry` take the optional
  legacy-fingerprint map (choice 5), and `mergeSettingsFile` can return the new status `legacy-replaced`. Without
  the map every caller behaves as today (protected surface: installer).
- `lib/installer/deploy.mjs` — `mergeHarnessHooks` returns the merge status instead of a boolean, counting
  `legacy-replaced` as written; `installCodexHook` prints the replace line on `legacy-replaced` (choice 5).
- Tests: new `tests/hooks/codex-guard.test.js` (pattern: `tests/hooks/antigravity-guard.test.js`); additions to the
  Codex block of `tests/installer/deploy.test.js` (from line 885); `tests/installer/cli.test.js` checked for the
  report line.
- `README.md` `### Codex CLI` (lines 441 and 453) and the tree lines near 601. Not the Known-limits line.
- `.gitignore`: this spec's leaf. New `project-template/` files need no leaf (not under `/.claude/*` or `/docs/*`).
- `tools/skip-baseline.json`: affected if a shell-matrix case skips on a CI leg (for example `pwsh` absent on the
  Windows leg, or the Windows shells on Unix legs). The plan predicts each leg.

### Files Requiring Full Read (deferred to /cc-plan)

- `lib/installer/deploy.mjs` (403 lines; lines 239-331 for the managed-file and harness-hooks helpers)
- `lib/installer/settings-merge.mjs` (upsert, `mergeHookTree`, and every caller of `mergeSettingsFile`)
- `project-template/.agents/hooks/conductor-guard.mjs` (101 lines; the guard-run and fail-closed helpers to mirror)
- `tests/hooks/antigravity-guard.test.js` (scaffold and corpus parity pattern)
- `tests/installer/deploy.test.js` (Codex block from line 885)

## Complexity Estimate

M — one new adapter mirroring an existing one, a one-line bootstrap, a legacy-fingerprint option in the merger, an
installer upgrade of one entry, and two test files, all on protected surfaces whose rituals apply.
