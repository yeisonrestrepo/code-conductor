# FEAT-037: Frontend design skill stack (replace ui-ux-pro-max)

**Status:** Draft (pending independent review)

Backlog entry: `AGENT-READABLE BACKLOG.md`, `[FEAT-037]` (issue #147). This spec answers that entry's acceptance criteria. Where the entry leaves a choice open, or where the tree contradicts the entry, the spec names the choice and the reason.

## Problem

The `CLAUDE.md` templates still send frontend work to a skill that nothing installs:

- `CLAUDE.md:48,74` and `project-template/CLAUDE.md:49,75` name `ui-ux-pro-max` in the Dynamic Specialization table (FRONTEND_ONLY row) and in the Sub-Agent Delegation table (Frontend UI/UX row).
- `global/CLAUDE.md:88` lists it under Active Skills, "activate via `/cc-stack` when frontend frameworks are detected". `/cc-stack` does no such thing.
- `README.md:87` and `README.md:290` and `.github/wiki/pages/Skills.md:56` already call it "retired guidance, pending `[FEAT-037]`".

An agent on a frontend project is pointed at a skill that does not exist, so it gets no frontend design guidance at all.

**The entry's premise about the installer is stale, and the spec works from the tree.** The entry says the installer's frontend-detect branch "currently downloads ui-ux-pro-max from GitHub". The npm CLI has no such branch and no frontend detection: `lib/installer/` and `bin/code-conductor.mjs` contain no reference to the skill (1.34.3 corrected the README to say so). The download lived in the retired shell installers, in two shapes:

| Era | Shell installer code | What it left on a host |
|---|---|---|
| 2026-05-01 (`3eaae1d`) to 2026-05-25 | `curl` of the upstream `SKILL.md` from the skill author's `main` branch | `~/.claude/skills/ui-ux-pro-max.md`, a flat file Claude Code never registers |
| 2026-05-25 (`2a3d7b2`) to 1.23.0 (FEAT-023, 2026-07-05) | `npm install -g uipro-cli`, then `uipro init --ai claude` under `--project` | `<project>/.claude/skills/ui-ux-pro-max/` with `SKILL.md`, a `data/` set of CSV files and a `scripts/` set of Python files |

`uipro-cli`'s last release is 2.2.3 (published 2026-01-29, measured on the npm registry 2026-11-27), so every install of the second era ran 2.2.3 unless the host already had an older global copy. Its `claude` platform template writes to `.claude/skills/ui-ux-pro-max/`. The first era's bytes are whatever the upstream `main` held on the day of the `curl`; this repository holds no copy.

So FEAT-037 is two things: a new opt-in install of a maintained skill stack on frontend projects, and a content-matched sweep of what the shell installers left behind.

## Solution

`code-conductor --project` gains a frontend design skill offer. When the target project classifies as `frontend` or `fullstack`, the installer offers (default Yes, by owner decision) to install three third-party skills into the project's Claude Code skill directory: Impeccable through its own npm CLI at an exact version (`impeccable@4.11.1`), with its design hook, and the other two through the `skills` CLI from npm, each pinned to a full commit SHA, with their entries in the project's `skills-lock.json`. The offer follows the FEAT-039 superpowers consent rule, except for its interactive default (`lib/installer/plugins.mjs:46`: "third-party code is offered, never silently run"): an interactive run asks, a non-interactive run installs only with an explicit flag, every outcome prints one report line, and any failure degrades to the manual commands without failing the install. The CLI is invoked through `npx`, never depended on, so `dependencies` stays `{}`. The same `--project` run sweeps a stale `ui-ux-pro-max` install only when its files match a known version byte for byte, and names any other copy in the report. Both `CLAUDE.md` mirrors, `global/CLAUDE.md`, the README and the wiki page replace the ui-ux-pro-max rows with the new stack in the same commit.

## Behavior

### Main path

1. The user runs `code-conductor --project` in a project whose `scripts/detect-stack.mjs` classification (`classifyProject`) is `frontend` or `fullstack`.
2. After `deployProject`, the installer runs the stale sweep (below) and then the frontend offer.
3. Interactive run: it prints the disclosure and one prompt. The disclosure names the three skills and their pins, says they are third-party code that runs with the agent's permissions, and says that Impeccable adds a Claude Code command hook that runs on the agent's edits even when you deny the model's own commands, and that the hook can download Impeccable's engine binary (checksum-verified) on first use. The prompt is `Install the frontend design skills? [Y/n] `. Empty input, `y` or `yes` accepts; `n` or `no` declines; anything else declines (an unreadable answer is not consent).
4. On consent, in a fixed order:
   - Impeccable: `npx --yes impeccable@4.11.1 install -y --providers=claude --scope=project` in the project root. `-y` accepts the installer's detected defaults, which include the design hook (only `--no-hooks` leaves it out); `--providers` and `--scope` remove its remaining questions, so it never prompts.
   - The other two, each installing only the one skill named (both repositories ship more than one; Emil Kowalski's ships 20):
     - `npx --yes skills@1.9.0 add emilkowalski/skill@64eb3deb9a5fbfa041faf783e0bc3fd635872e9c --skill emil-design-eng -a claude-code --copy -y`
     - `npx --yes skills@1.9.0 add Leonxlnx/taste-skill@952435f63acece7d2fcb4b4d3c1786c1c43603e0 --skill design-taste-frontend -a claude-code --copy -y`
   Each runs with `DISABLE_TELEMETRY=1` and `DO_NOT_TRACK=1` set in the child environment, under a per-command timeout.
5. After the three commands, it verifies the result on disk: each skill has `.claude/skills/<name>/SKILL.md`, where `<name>` is the installed name in the table below (`impeccable`, `emil-design-eng`, `design-taste-frontend`); for the two `skills` CLI installs, `skills-lock.json` at the project root has an entry whose `commit` equals the pinned SHA; for Impeccable, `.claude/settings.json` or `.claude/settings.local.json` holds a hook entry whose command points into `.claude/skills/impeccable/` (the exact event and file are measured in the plan from the engine's install output shape).
6. It prints one report line per skill (`installed`, `already installed`, or `not installed (<reason>)`) and records the choice (below). The installer exits 0.

The three skills and their sources, as the entry names them:

| Order | Skill | Source | Pin | Pin recorded in | Role |
|---|---|---|---|---|---|
| 1 | Impeccable (`impeccable`) | npm package `impeccable` | exact npm version `4.11.1` | `.claude/frontend-skills.json` | Lead design skill, with its design hook |
| 2 | Emil Kowalski's skill (`emil-design-eng`) | `emilkowalski/skill`, skill `emil-design-eng` only | commit `64eb3deb9a5fbfa041faf783e0bc3fd635872e9c` | `skills-lock.json` | Design, animation and motion practice |
| 3 | Taste (`design-taste-frontend`) | `Leonxlnx/taste-skill`, skill `design-taste-frontend` only (repository folder `skills/taste-skill/`) | commit `952435f63acece7d2fcb4b4d3c1786c1c43603e0` | `skills-lock.json` | Layout, typography and spacing defaults |

The skill names and commit SHAs are the owner's pins (Owner decisions, below). They live in one constant table in a new installer module (the `SUPERPOWERS_PLUGIN` single-source pattern), so a re-pin is a one-line reviewed change that a unit test pins.

### Choices this spec makes, and why

- **Pinning shape (skills 2 and 3).** `owner/repo@<full 40-hex commit>`, which the `skills` CLI documents as a pin form ("Pin a release tag or full commit"), and the CLI itself pinned by exact version (`skills@1.9.0`, latest on the npm registry 2026-11-27, confirmed by the owner). A tag can be moved and a bare `owner/repo` follows `main`, so neither is a reviewed revision. `skills-lock.json` (format version 2) records the `commit` and a `computedHash` of the installed files, and `skills install --frozen-lockfile` restores exactly that, which is what makes the pin reviewable after the fact.
- **Which name the `skills` CLI installs under (measured in the `skills@1.9.0` package, 2026-11-27).** The taste skill's folder in its repository is `skills/taste-skill/`, but its frontmatter `name` is `design-taste-frontend`. In `skills@1.9.0` the frontmatter `name` decides everything: `--skill` is matched by `filterSkills` against the skill's display name, which is the frontmatter `name` (exact, case-insensitive, or with spaces and underscores read as hyphens), never against the folder name; the install directory is `sanitizeName(name)` (`installSkillForAgent`, `getInstallPath`); and the `skills-lock.json` key is that `name` (`recordProjectLock`). A `--skill taste-skill` would fail with "no matching skills". So the argv passes `--skill design-taste-frontend`, verification looks in `.claude/skills/design-taste-frontend/`, and the lock entry is read under `design-taste-frontend`. The same rule gives `emil-design-eng` for the other skill. The plan re-checks both on a local-path fixture that copies the folder/name mismatch (no network).
- **Install location.** Project scope with `-a claude-code`, because Claude Code registers project skills at `.claude/skills/<name>/SKILL.md`. `--copy` instead of the default symlink, because symlinks need elevated rights on stock Windows and this installer supports win32. Whether `--copy` still writes the canonical `.agents/skills/<name>` copy that `computedHash` covers is measured in the plan against a local-path source (which needs no network); if it does not, the plan drops `--copy` only for non-win32 and says so.
- **Project only.** Frontend classification is a property of a project, so the offer runs only under `--project`; a global-only run never offers.
- **Pinning shape (Impeccable), by owner decision.** The exact npm version `impeccable@4.11.1`, never a range or a dist-tag. Its installer does not write `skills-lock.json`, so its pin is recorded in `.claude/frontend-skills.json` instead (below), and the entry's lock criterion reads, for Impeccable, as "the exact npm version is recorded there".
- **Recording the choice.** The outcome is written to `.claude/frontend-skills.json` in the project (installer-owned, beside the other installer-written files under `.claude/`): `{ "choice": "accepted" | "declined" | "skipped", "reason": <string or null>, "cli": "skills@1.9.0", "skills": [{ "name", "source", "pin", "status" }] }`, where `pin` is `impeccable@4.11.1` for Impeccable and the 40-hex commit for the other two. A later interactive run that finds `"declined"` does not ask again and prints one line naming `--with-frontend-skills`, which installs anyway; a recorded `"accepted"` with every skill present is reported as `already installed` and nothing is re-run. For the two `skills` CLI installs the lock file remains the authority on what is installed; for Impeccable this file is the only pin record.
- **The hook survives re-runs.** `--project` merges `.claude/settings.json` by fingerprint (`lib/installer/settings-merge.mjs`): only entries carrying a conductor fingerprint are replaced, so Impeccable's hook entry is a host entry and is kept. A test pins that a re-run leaves an Impeccable-shaped hook entry in place.
- **Telemetry off.** The `skills` CLI sends install telemetry unless `DISABLE_TELEMETRY` or `DO_NOT_TRACK` is set. The installer sets both for its child processes, so running code-conductor never reports a host's skill installs to a third party. Impeccable honours `DO_NOT_TRACK=1` for its own anonymous record, but its README says the skill still fetches visual directions from `impeccable.style` when a new design starts; that is the skill's runtime behaviour, outside the installer, and the README section names it.
- **Timeout.** Each `npx` command gets 120 s (a git fetch plus a first `npx` download, or Impeccable's engine package of about 25 MB, is slower than the 60 s plugin install); a timeout reports `not installed (timed out after 120s)` and the next skill still runs.
- **Node floor.** `skills@1.9.0` declares `engines.node >=22.20.0`; `impeccable@4.11.1` declares `>=18.19.0`; the CLI here supports Node `>=20`. On a Node below 22.20 the two `skills` CLI installs are skipped with `not installed (needs Node >= 22.20, found <v>)` and their manual commands, never attempted; Impeccable still runs.

### What Impeccable's installer does (measured on the registry, 2026-11-27)

Measured by unpacking the published tarballs from the npm registry, without running them:

- **Binary.** `impeccable@4.11.1` (7 files, about 53 kB) is a Node launcher, `cli/bin/cli.js`, that execs a native engine. It does not bundle the engine. The engine comes from an exact-pinned optional dependency, `@impeccable/cli-<os>-<arch>@0.1.31` (darwin-arm64, darwin-x64, linux-x64, linux-arm64, windows-x64), which `npx` installs from the npm registry under the registry's own sha512 integrity; none of the five declares install scripts. When that package is missing, the launcher falls back to `~/.impeccable/bin/0.1.31/` and then to a download from the project's GitHub releases.
- **Checksum.** The package ships `skill/scripts/engine-checksums.txt` with a sha256 per platform asset for engine 0.1.31. The launcher verifies a cached or downloaded engine against it and fails closed (no digest on record: no request; mismatch: nothing written). It does not re-hash the engine that came from the npm optional dependency; that path relies on npm's integrity check. All five platform binaries published at 0.1.31 hash to the digests in that file (measured).
- **Skill files.** The npm tarball holds no skill files. The engine's install command fetches a skill bundle from the project's GitHub releases (`releases/download/skill-v…`) and verifies a bundle signature against a signing keyring compiled into the engine (read from the binary's embedded strings; the plan does not execute it). So the npm version pins the launcher, the engine and the signing key; the bundle it accepts is the one the vendor signed for that release.
- **Hook.** With its defaults (`-y`, no `--no-hooks`) it writes the skill to `.claude/skills/impeccable/` and a Claude Code command hook into the project's `.claude/settings.json` or `.claude/settings.local.json` that runs the skill's engine on the UI files the agent edits and hands the findings back before the agent calls the work done. Its README states: "In Claude Code, installed command hooks run even when you deny the model's own commands, so the first edit can download the engine." The prompt and the README say exactly that. The hook is outside code-conductor's guard hooks and is not fingerprinted as conductor-owned.

### Stale ui-ux-pro-max sweep

Follows the 1.23.3 root-`scripts/` sweep (exact file list) and the `lib/installer/heal.mjs` graphify sweep (sha256 constants are the only surviving record):

1. **Project copy** (`<project>/.claude/skills/ui-ux-pro-max/`, the `uipro init --ai claude` shape). The directory is removed only when its full recursive file list equals the file list of a known `uipro-cli` version's `claude` output and every file's sha256 equals that version's hash. Any extra, missing or changed file means a user-modified copy: it is left in place and the report names its path. A directory containing a symlink or a non-regular file is left in place and named, never followed.
2. **Global flat file** (`~/.claude/skills/ui-ux-pro-max.md`, the `curl` shape). Removed only on a sha256 match against a known hash; otherwise left in place and named.
3. The known set is a constant table (`version → { relative path → sha256 }`), pinned by a test. The plan derives the `uipro-cli@2.2.3` entry from the registry tarball by rendering the `claude` platform output, and records the provenance beside the constant. The `curl`-era file's bytes are not recoverable from the registry or this repository, so that table ships empty unless the owner supplies a hash: every flat copy is then named, never removed. That is the safe failure of the rule the entry sets.
4. The sweep runs on every `--project` run, frontend or not, because a project's stack can change after the shell installer ran. It never prompts: removing only bytes the shell installers put there, unchanged, is the existing precedent.

Report lines (one per finding): `removed stale ui-ux-pro-max skill (uipro-cli 2.2.3 content): <path>` and `left ui-ux-pro-max in place (does not match a known install; review and remove it yourself): <path>`.

### Alternative paths

- **Non-frontend project** (`backend`, `library`, `infra`, `mobile`): no offer, no prompt, no `.claude/frontend-skills.json`. The sweep still runs.
- **Non-interactive run without the flag:** `frontend design skills not installed (non-interactive run; pass --with-frontend-skills to install them)` plus the manual commands; choice recorded as `skipped`. The default Yes applies only to an interactive answer, never to a run with no terminal.
- **Non-interactive run with `--with-frontend-skills`:** installs without asking, as `--with-plugins` does for superpowers. `--with-plugins` does not imply it, nor the reverse.
- **`--no-deps`:** stays the accepted no-op it has been since FEAT-023 (`bin/code-conductor.mjs:33-36`), so it does not affect this offer, just as it does not affect the superpowers offer; only the prompt or the consent flag does.
- **Skill already present** (`.claude/skills/<name>/SKILL.md` exists and the lock entry carries the pinned commit, or for Impeccable the recorded pin is `impeccable@4.11.1`): `already installed`, not re-run.
- **Skill present at a different commit, or without a lock entry** (for Impeccable: present without a record, or recorded at another version): left alone and reported as `present at a different revision (<commit, version or "unlocked">); not changed`.
- **Impeccable installed but no hook entry found:** `installed without its design hook (no hook entry for .claude/skills/impeccable in .claude/settings*.json)`; nothing is deleted. The installer never upgrades or overwrites a skill the user installed or re-pinned.
- **Classification fails** (detector throws or the project is unreadable): treated as non-frontend, with one stderr line; the install still succeeds.

### Error cases

- **`npx` missing, or the command exits non-zero:** that skill reports `not installed (<exit code or signal>)` with its manual command; the other skills still run; exit 0.
- **Command succeeded but verification fails** (no `SKILL.md`, no lock entry, or the lock `commit` differs from the pin): `not verified (<what is missing>)`. The installer does not delete what the CLI wrote; the user reviews it.
- **`skills-lock.json` unparseable:** verification reports `not verified (skills-lock.json unreadable)`; the file is never rewritten by the installer.
- **Sweep hits an I/O error** (permission, file vanished): that path is reported as left in place with the error code; the install still succeeds.
- **A pin in the table is not a 40-hex SHA:** a unit test fails, so this cannot ship.

## Acceptance Criteria

Each maps to the entry's criteria (E1 offer and record, E2 placement and lock, E3 no dependency, E4 sweep, E5 mirrors).

- [ ] E1: on a `frontend` or `fullstack` fixture project, an interactive `--project` run asks one `[Y/n]` prompt before any `npx` spawn; empty input and `y` accept, `n` declines and spawns nothing. Tested with the injected `ask` and `spawn` that `run()` already accepts.
- [ ] E1: the disclosure printed before the prompt names the hook, says it runs even when the model's own commands are denied, and says it can download the engine on first use (pinned by a test on the text).
- [ ] E1: a non-interactive run without `--with-frontend-skills` spawns nothing and prints the manual commands; with the flag it spawns the three commands without asking; `--with-plugins` alone spawns none of them; the flag appears in `USAGE`.
- [ ] E1: every outcome writes `.claude/frontend-skills.json` with `choice` `accepted`, `declined` or `skipped`; a recorded `declined` suppresses the prompt on the next interactive run.
- [ ] E1: a `backend` or `library` fixture never prompts, never spawns, writes no choice file.
- [ ] E2: the Impeccable argv is exactly `npx --yes impeccable@4.11.1 install -y --providers=claude --scope=project` (no `--no-hooks`); the other two argvs are exactly `npx --yes skills@1.9.0 add emilkowalski/skill@64eb3deb9a5fbfa041faf783e0bc3fd635872e9c --skill emil-design-eng -a claude-code [--copy] -y` and `npx --yes skills@1.9.0 add Leonxlnx/taste-skill@952435f63acece7d2fcb4b4d3c1786c1c43603e0 --skill design-taste-frontend -a claude-code [--copy] -y` (one `--skill` each, never `'*'` or `--all`); every one has `DISABLE_TELEMETRY=1` and `DO_NOT_TRACK=1` in its env.
- [ ] E2: a unit test asserts the Impeccable pin and the `skills` CLI pin are exact versions (no range, no tag) and every repository pin is a full 40-hex SHA.
- [ ] E2: verification looks for `.claude/skills/emil-design-eng/` and `.claude/skills/design-taste-frontend/` (the frontmatter names, not the repository folder `taste-skill`) and reads their lock entries under those keys; a stub that writes `.claude/skills/taste-skill/` instead reports `not verified`.
- [ ] E2: after a (stubbed) successful run, verification passes only when `.claude/skills/<name>/SKILL.md` exists and, for the two `skills` CLI installs, `skills-lock.json` has the pinned `commit`; each missing piece yields its `not verified` line. `.claude/frontend-skills.json` records `impeccable@4.11.1` as Impeccable's pin.
- [ ] E2: a stubbed Impeccable install without a hook entry reports `installed without its design hook`; a `--project` re-run keeps an existing Impeccable hook entry in `.claude/settings.json`.
- [ ] E2: a failing, timed-out or missing `npx` reports per skill and the run still exits 0.
- [ ] E3: `package.json` `dependencies` is still `{}` and no devDependency is added (existing invariant tests stay green).
- [ ] E4: a fixture `.claude/skills/ui-ux-pro-max/` equal to the `uipro-cli@2.2.3` output is removed and reported; the same fixture with one byte changed, one extra file, one missing file, or a symlink is left byte-identical and named.
- [ ] E4: `~/.claude/skills/ui-ux-pro-max.md` is removed only on a known-hash match and otherwise left and named.
- [ ] E5: `CLAUDE.md` and `project-template/CLAUDE.md` change their FRONTEND_ONLY row and Frontend UI/UX row identically in the same commit; `global/CLAUDE.md`'s Active Skills line changes with them; no shipped template names `ui-ux-pro-max` as an active skill. A repo-invariant test pins this.
- [ ] README: the Dependencies row and the skills section describe the opt-in stack, its pins, the consent flag and the sweep; the file tree adds the new installer module. The existing `repo-invariants` assertion (no automatic-install claim) still passes, extended to forbid naming ui-ux-pro-max as installed.
- [ ] Full `npm test` is green; no test touches the network.

## Out of Scope

- The `[FEAT-032]` UX agent, which is the stack's consumer; this item only installs the skills and points the delegation rows at them.
- Global-scope (`~/.claude/skills`) installs of the new stack, and the OpenCode, Antigravity and Codex targets: `-a claude-code` only.
- Upgrading, re-pinning or removing the new skills after install (`npx skills update` and `remove` are the user's tools); a later re-pin is a reviewed one-line change to the pin table.
- Reviewing the contents of Impeccable's signed skill bundle or its engine binary: the pin is the exact npm version (owner decision), which fixes the launcher, the engine digests and the signing key.
- Adding stack detection to `/cc-stack` or changing `classifyProject`; the installer only calls it.
- Records (`VERSION`, `CHANGELOG.md`, backlog, memory): the release writes them.

## Owner decisions

Network from the installer, third-party code with full agent permissions, a hook outside the guard posture, and new public flags are the owner's. Decided by the owner:

- **Impeccable is installed by its own CLI, with its hook.** `npx --yes impeccable@4.11.1 install -y --providers=claude --scope=project`: exact version, the design hook included (without it the tool is only half there), no prompts. None of the three options this spec first offered (the `skills` CLI path, `--no-hooks`, the literal unpinned command) is taken as written. For Impeccable the pin is the exact npm version, recorded in `.claude/frontend-skills.json`. The spec documents what the hook does and that it runs even when the model's own commands are denied (the Impeccable section above), whether 4.11.1 ships the engine and how it is checksummed (same section), and the prompt says so.
- **Consent flag.** A new `--with-frontend-skills`; `--with-plugins` does not imply it.
- **Default answer.** The interactive prompt is `[Y/n]`: an empty answer accepts.
- **The `curl`-era hash.** The recommended default: the known set for `~/.claude/skills/ui-ux-pro-max.md` ships empty, so every flat copy is named and left in place, never removed.
- **Pins for the two `skills` CLI installs.** The CLI is `skills@1.9.0`. `emilkowalski/skill` at commit `64eb3deb9a5fbfa041faf783e0bc3fd635872e9c`, installing only the skill `emil-design-eng` with `--skill` (the repository ships 20 skills; the others are not installed). `Leonxlnx/taste-skill` at commit `952435f63acece7d2fcb4b4d3c1786c1c43603e0`, installing only the skill `design-taste-frontend`. The repository folder for that skill is `skills/taste-skill/` while its frontmatter `name` is `design-taste-frontend`; the spec checked which one the CLI uses (the frontmatter `name`, see "Which name the `skills` CLI installs under" above) and sets the argv and the `.claude/skills/<name>/` verification to match.

Nothing is left open.

## System Impact

- `bin/code-conductor.mjs`: parse `--with-frontend-skills`; call the sweep and the offer after `deployProject`; add the flag to `USAGE`.
- New `lib/installer/frontend-skills.mjs`: pin table (Impeccable's npm version and the two repository SHAs), disclosure and consent, spawn, verification (lock entries, Impeccable's hook entry), choice file. Modeled on `lib/installer/plugins.mjs` (consent, `spawnSync` injection, timeout classification, win32 handling).
- Sweep: a new function beside `sweepGraphifyHooks` in `lib/installer/heal.mjs`, or its own module if the file-list matcher does not fit there (plan decides on full read).
- `scripts/detect-stack.mjs`: called, not changed (`classifyProject`, `scripts/detect-stack.mjs:478`).
- `CLAUDE.md`, `project-template/CLAUDE.md`, `global/CLAUDE.md`: the rows above.
- `README.md:87,290` and the file tree; `.github/wiki/pages/Skills.md:56`.
- Tests: new `tests/installer/frontend-skills.test.js` and sweep cases; `tests/tools/repo-invariants.test.js:148` extended; fixture for the `uipro-cli@2.2.3` output (generated hashes, not the third-party files, unless the plan shows the files are needed and their license allows it).
- `.agents/skills/` is also where `--codex` writes `cc-*` skills; the three names do not start with `cc-`, and `-a claude-code` keeps the `skills` CLI from linking into other agents. The plan checks the Codex deploy never sweeps or overwrites them.
- `.gitignore`: this spec's leaf line.

### Files Requiring Full Read (deferred to /cc-plan)

- `lib/installer/plugins.mjs` (117 lines): consent, spawn, timeout and win32 classification to mirror.
- `bin/code-conductor.mjs` (181 lines): flag parsing, `run()` injection points, report emission order.
- `lib/installer/heal.mjs` (98 lines): sweep shape and report lines.
- `lib/installer/settings-merge.mjs`: confirm a host hook entry without a conductor fingerprint survives a `--project` re-run.
- `lib/installer/deploy.mjs` (412 lines): `sweepStaleRootScripts` exact-list matcher, `--codex` writes under `.agents/skills/`.
- `scripts/detect-stack.mjs`: how to obtain a classification for a directory (the entry point beyond `classifyProject`).
- `tests/installer/plugins.test.js`: the stubbing pattern for `ask` and `spawn`.

## Complexity Estimate

M: one new installer module and one sweep, both following existing patterns with injected I/O, plus documentation rows; the risk is in the third-party CLI's on-disk behavior, which the plan measures against a local-path source before building.
