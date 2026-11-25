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
name the adapter by a cwd-relative path: it is a short `node -e` bootstrap that walks up from its working directory
to the nearest ancestor holding `.codex/hooks.json`, imports `<that>/.codex/hooks/conductor-guard.mjs`, and prints a
deny itself when no such ancestor or no adapter exists. The installer installs the adapter as a managed file (as it
does for Antigravity) and upgrades the FEAT-048 entry in place. A test runs the installed command through the
platform shell from the root and from a subdirectory.

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
   The nearest `.codex/hooks.json` is the hooks layer closest to where Codex started, so it is the file that
   declared this command or a nested one. If that nested layer has no adapter of ours beside it, the bootstrap
   blocks: a nested project produces a visible block, never a silent pass, and never runs a guard that a
   `.claude/` folder in a subdirectory supplies.
3. **Deny by output, exit 0.** The only block mechanism measured on Codex is Claude's
   `hookSpecificOutput.permissionDecision: "deny"` on stdout (FEAT-048 live check; the guard itself exits 0 on every
   path, `project-template/.claude/hooks/pre-tool-use.mjs:4`). The bootstrap and the adapter block the same way and
   never rely on an exit code whose meaning to Codex is unmeasured.
4. **`node` not on `PATH` stays a documented limit.** Every command form that runs JavaScript must start an
   interpreter by name; whether Codex blocks a hook that cannot start is unmeasured, and no file the installer
   writes can change it. The README Codex subsection keeps one sentence saying that without `node` on `PATH` the
   guards are not enforced. Writing an absolute interpreter path is rejected for the reason in choice 2.

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
- A subdirectory holds its own `.claude/hooks/pre-tool-use.mjs`: never run; the root guard judges the call.
- A subdirectory holds its own `.codex/hooks.json` but no `.codex/hooks/conductor-guard.mjs`: the bootstrap blocks,
  naming the folder it looked in.
- The host's `.codex/hooks.json` already holds the FEAT-048 entry (`node .claude/hooks/pre-tool-use.mjs`): a
  re-install replaces it in place with the bootstrap entry; no duplicate, host entries kept. A second re-install
  reports `unchanged`.
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

## Acceptance Criteria

- [ ] `project-template/.codex/hooks.json` no longer runs a cwd-relative path to the guard; its one entry is the
      bootstrap, which contains none of `"`, `$`, `` ` ``, `\`, `%`, `!` inside its `-e` argument (so `sh`, `cmd.exe`
      and PowerShell pass it unchanged), and a test pins that.
- [ ] Hook test: in a temp project scaffolded with the guard, the adapter and the shipped `hooks.json`, the shipped
      command run through the platform shell from the root **and from a subdirectory** gives the same allow/deny as
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
- [ ] The installer comment at `lib/installer/deploy.mjs:320-321` and README `### Codex CLI` describe the adapter;
      the "launch from the project root" instruction is removed; the `node`-on-`PATH` limit stays stated.
- [ ] `npm test` passes; the change adds no dependency and does not touch `.claude/hooks/pre-tool-use.mjs`.

## Out of Scope

- A Codex root environment variable, and measuring whether Codex blocks a hook that cannot start or exits non-zero
  (needs a live Codex run).
- Making the hook work without `node` on `PATH` (choice 4).
- Mapping Codex tools other than the shell (Guards 1, 2 and 4 stay "not reached", README).
- The Antigravity adapter, the OpenCode plugin, and Codex's hook trust gate.
- Records: the README "Known limits" `[BUG-094]` line, `CHANGELOG.md`, `VERSION`, the backlog (written at release).

## System Impact

- `project-template/.codex/hooks.json` — entry replaced by the bootstrap (protected surface: hooks).
- `project-template/.codex/hooks/conductor-guard.mjs` — new adapter (protected surface: hooks).
- `lib/installer/deploy.mjs` — `installCodexHook` installs the adapter through `installManagedFile` before merging,
  passes the new fingerprint, and replaces the legacy FEAT-048 entry; comment at 320-321 (protected surface:
  installer). `.codex` is already in `HARNESS_DIRS`, so the template copy loop needs no change.
- `lib/installer/settings-merge.mjs` — read for how a legacy entry is replaced in place (`upsertEntry` matches by
  fingerprint substring); changed only if the plan finds no existing seam.
- Tests: new `tests/hooks/codex-guard.test.js` (pattern: `tests/hooks/antigravity-guard.test.js`); additions to the
  Codex block of `tests/installer/deploy.test.js` (from line 885); `tests/installer/cli.test.js` checked for the
  report line.
- `README.md` `### Codex CLI` (lines 441 and 453) and the tree lines near 601. Not the Known-limits line.
- `.gitignore`: this spec's leaf. New `project-template/` files need no leaf (not under `/.claude/*` or `/docs/*`).
- `tools/skip-baseline.json`: affected only if the new test skips on a CI leg (e.g. no shell); the plan predicts
  each leg.

### Files Requiring Full Read (deferred to /cc-plan)

- `lib/installer/deploy.mjs` (403 lines; lines 239-331 for the managed-file and harness-hooks helpers)
- `lib/installer/settings-merge.mjs` (upsert and legacy-entry replacement)
- `project-template/.agents/hooks/conductor-guard.mjs` (101 lines; the guard-run and fail-closed helpers to mirror)
- `tests/hooks/antigravity-guard.test.js` (scaffold and corpus parity pattern)
- `tests/installer/deploy.test.js` (Codex block from line 885)

## Complexity Estimate

M — one new adapter mirroring an existing one, a one-line bootstrap, an installer upgrade of one entry, and two test
files, all on protected surfaces whose rituals apply.
