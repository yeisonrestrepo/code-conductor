# FEAT-037 Frontend design skill stack (replace ui-ux-pro-max): implementation plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Update one checkbox per edit (BUG-003 invariant). Execute in file order.

**Goal:** `code-conductor --project` sweeps a stale `ui-ux-pro-max` install only on an exact content match, and on a project the stack detector classifies as `frontend` or `fullstack` it offers (interactive `[Y/n]`, or `--with-frontend-skills`) three pinned third-party design skills: Impeccable through `npx --yes impeccable@4.11.1 install` with its design hook, and `emil-design-eng` and `design-taste-frontend` through `npx --yes skills@1.9.0 add <repo>@<commit>`. It verifies each on disk, records the choice, the pins and the sha256 of Impeccable's installed files in `.claude/frontend-skills.json`, and never fails the install. Both `CLAUDE.md` mirrors, `global/CLAUDE.md`, the README and the wiki Skills page replace the ui-ux-pro-max rows.

**Spec:** `docs/superpowers/specs/2026-11-26-feat037-frontend-design-skill-stack-replace-ui-ux-pro-design.md` (sha256 `0940bebd2950a5cec673903b9d8ac98fb6d7ee6ed635d9660a0fbdd0f7e038d9`), approved by the owner with the changes it records under "Owner decisions". Issue #147.

**Test command:** `npm test`. Filtered runs use `npx vitest run <file>` and `-t '<pattern>'`.

## Global Constraints

- No release records: `VERSION`, the `package.json` / `package-lock.json` version, `CHANGELOG.md`, `AGENT-READABLE BACKLOG.md`, `.claude/memory/**` and the README "Known limits" lines stay untouched. The release rewrites them.
- `package.json` `dependencies` stays `{}` and no devDependency is added or changed: the `skills` and `impeccable` CLIs are invoked through `npx` at run time, never depended on (E3).
- **Files that change** (the spec's System Impact list), plus this plan and its `.gitignore` leaf:
  - new: `lib/installer/file-digests.mjs`, `lib/installer/stale-uipro.mjs`, `lib/installer/frontend-skills.mjs`, `tests/installer/file-digests.test.js`, `tests/installer/stale-uipro.test.js`, `tests/installer/frontend-skills.test.js`, `tests/installer/frontend-skills-cli.test.js`;
  - modified: `bin/code-conductor.mjs`, `CLAUDE.md`, `project-template/CLAUDE.md`, `global/CLAUDE.md`, `README.md`, `.github/wiki/pages/Skills.md`, `tests/tools/repo-invariants.test.js`.
- Not touched: `scripts/detect-stack.mjs` (called as a child process, never changed or imported), `lib/installer/plugins.mjs` (only its exported `formatTimeout` is imported), `lib/installer/heal.mjs`, `lib/installer/deploy.mjs`, `lib/installer/settings-merge.mjs`, the hooks and their mirrors, `.github/workflows/`, `.github/actions/`, the spec, and `tests/installer/fixtures/bug049-2a3a811-tail.md` (a historical fixture that must keep its old rows).
- Network: no test reaches the network. Every spawn of `npx` in a test is an injected stub; the only real child process a test starts is `node scripts/detect-stack.mjs` on a local fixture.
- Staging forms: every modified file above is tracked and outside any ignored directory, so `git add -u <path>`. The new files under `lib/installer/` and `tests/installer/` are new and not ignored, so plain `git add <path>`. This plan is new in Task 0 under the ignored `docs/superpowers/plans/` (so `git add -f`); after that it is tracked and re-included by its leaf (so `git add -u`).
- `.claude/` is read-only for Bash in the build sandbox; no file under `.claude/` changes in this plan.
- Code rules of the repository: functions do one thing (at most about 30 lines), guard clauses over nesting, comments say why. No new abstraction beyond the three modules named here.

## Files read in full (spec, Files Requiring Full Read)

- `lib/installer/plugins.mjs` (117 lines): the consent rule (`refusalReason`, `:47-53`), the byte-wise `readLine` (`:33-42`, exported), `formatTimeout` (`:20`, exported), the spawn-to-files pattern (`spawnInstall`, `:63-82`: stdout and stderr go to temp files so an inherited pipe cannot hold `spawnSync` past the timeout), the win32 single-string `shell: true` form (`:76-78`) and the result classification (`classifyInstall`, `:96-104`: `ENOENT`, `9009` / "is not recognized", `ETIMEDOUT` / `SIGTERM`).
- `bin/code-conductor.mjs` (181 lines): `USAGE` (`:12`), `parseArgs` (`:25-68`, `--with-plugins` at `:45`), `offerPlugins` (`:79-85`, its own try so it never changes the exit class), `run()`'s injection points (`:90`: `isInteractive`, `ask`, `spawn`, `pluginTimeoutMs`, `pluginEnv`, `nodeVersion`), and the order `deployProject` (`:145`) then `offerPlugins` (`:146`).
- `lib/installer/heal.mjs` (98 lines): the sweep shape: sha256 constants as the only surviving record (`SHIPPED_GRAPHIFY_HASHES`, `:17-20`), an unreadable file counts as modified (`sweepOne`, `:65-73`), every failure becomes a report line and none escapes (`healGraphifyHook`, `:80-98`). Its matcher is per-file by name; a recursive file-list matcher does not fit there, so the sweep gets its own module (plan decision 3).
- `lib/installer/settings-merge.mjs` (141 lines): `entryMatches` (`:17-20`) owns an entry only when a hook command contains a fingerprint; `upsertEntry` (`:46-55`) replaces only owned entries and appends otherwise; `mergeHookTree` carries host events through untouched. The project fingerprints are `pre-tool-use.mjs`, `post-compact.sh`, `verbosity-remind.sh` (`lib/installer/host-owned.mjs:66-70`); none is a substring of Impeccable's hook command (`${CLAUDE_PROJECT_DIR}/.claude/skills/impeccable/scripts/impeccable hook…`, measured below), so its entry is a host entry and survives a re-run.
- `lib/installer/deploy.mjs` (412 lines): `sweepStaleRootScripts` (`:147-154`, exact-list match then `rmSync`); `deployProject` (`:341-400`); with `--codex`, `copyRenderedCommands(…, '.agents/skills', …)` (`:369`, `:314-319`) is a `cpSync` of `project-template/.agents/skills/` (18 `cc-*` folders) that overwrites only same-named folders and removes nothing, so it can never sweep or overwrite `impeccable`, `emil-design-eng` or `design-taste-frontend`. With `--copy` (plan decision 2) the `skills` CLI writes nothing under `.agents/skills/` anyway.
- `scripts/detect-stack.mjs` (704 lines): `classifyProject` (`:478`) needs the merged stack, infra, db, the dependency map and the root entries, all computed inside the async `main()` (`:497-694`); `main()` prints one JSON object with `projectType` to stdout and exits 0, printing `{}` on any failure. Importing the module would register process-wide `unhandledRejection` / `uncaughtException` handlers that call `process.exit(0)` (`:681-693`). So the installer runs it as a child process (`node <assetRoot>/scripts/detect-stack.mjs <cwd>`), which keeps `run()` synchronous and the script unchanged (plan decision 4). `scripts/` ships in the package (`package.json` `files`).
- `tests/installer/plugins.test.js` (424 lines): the `fakeSpawn` stub that writes into the fds it is handed (`:18-28`) and the injected `ask`; `tests/installer/cli.test.js` (`:15-23`): every `run()` there is non-interactive with a recording `spawn`, and `afterEach` asserts nothing was spawned. Its `--project` runs use an empty temp `cwd`, which the detector classifies `library`, so they see no new line.

## Measurements (2026-11-27, Node v24.22.2, from the npm registry; third-party code read, never executed)

1. **`skills@1.9.0`** (`dist/_chunks/remove.mjs`, `dist/cli.mjs`, tarball integrity `sha512-8p27fa6S…enlvSSVqg==`):
   - `owner/repo@<40-hex>` parses as a ref, not a skill filter: `isVersionPin` accepts `isCommitSha` (`/^[0-9a-f]{40}$/i`), and the source becomes `{ url: https://github.com/<owner>/<repo>.git, ref: <sha> }`.
   - The install mode is `options.copy ? "copy" : defaultInstallMode(targets)`, and `defaultInstallMode` returns `"copy"` whenever every target shares one skills dir, which a lone `-a claude-code` does. So **with or without `--copy`, a single-agent install copies straight into `.claude/skills/<name>/` and writes no canonical `.agents/skills/<name>/` copy** (`installSkillForAgent`, copy branch: `cleanAndCreateDirectory(agentDir)` then `copyDirectory`).
   - The lock entry's `computedHash` is `sourceSkillHash(skill)`, a hash of the fetched source folder, not of any installed copy (`installedSkillHash`). The project lock entry is `{ source, sourceUrl, ref, commit, sourceType, skillPath, computedHash }` plus `installMode: "copy"` only when `--copy` was passed (`lockedInstallMode` requires `options.copy` when the default is already copy), keyed by the skill's frontmatter `name` (`addSkillToLocalLock(skill.name, …)`).
   - A frozen restore reads `installMode` from the entry and restores as a symlink (canonical `.agents/skills/` plus link) when it is absent (`cli.mjs` restore, `entry.installMode === "copy"`).
   - Telemetry is off when `DISABLE_TELEMETRY` or `DO_NOT_TRACK` is set (`remove.mjs:3461`).
2. **`impeccable@4.11.1`** (tarball integrity `sha512-XpoQPgPj…OPA3g==`) and its engine `@impeccable/cli-linux-x64@0.1.31` (read as text): the Claude Code hook is written to `.claude/settings.json` or `.claude/settings.local.json` (both paths appear in the installer's table), with matcher `Edit|Write|…` and a command under `${CLAUDE_PROJECT_DIR}/.claude/skills/impeccable/scripts/impeccable` with a `hook…` subcommand (`hook-before-edit`, `hook-after-edit`, `hook-stop` appear). The exact event is not decidable from the strings, so verification accepts the hook under any event in either file (plan decision 6). `DO_NOT_TRACK` is read by the engine. The spec's Impeccable section (binary, checksum, signed bundle) is the rest of the measurement.
3. **`uipro-cli@2.2.3`** (tarball `https://registry.npmjs.org/uipro-cli/-/uipro-cli-2.2.3.tgz`, integrity `sha512-bqeOGqeZOE2R6sze0XPf13OfKBjjlb2Mz0S5ImIhF+ypnt4ywkw5a60VkN4OU2yApTNDci2+yRDyzYkA4RkIUQ==`, MIT): `uipro init --ai claude` without `--legacy` takes `templateInstall` → `generatePlatformFiles`: it writes `.claude/skills/ui-ux-pro-max/SKILL.md` rendered from `assets/templates/platforms/claude.json` (frontmatter) plus `assets/templates/base/skill-content.md` and `quick-reference.md`, then `cp -r` of `assets/data/` and `assets/scripts/` (which ships three `__pycache__/*.cpython-314.pyc`). Re-rendering that output with an independent script over the tarball's assets gives 31 files (plan decision 3, table below). The table digest, `sha256` of the sorted lines `<sha256> <path>\n`, is `b474d030548bdc3a092512a709cda05362ab263b735d1379418fd05629120a88`.

## Plan decisions

1. **Pins in one frozen table** (`lib/installer/frontend-skills.mjs`, the `SUPERPOWERS_PLUGIN` single-source pattern):

   ```js
   export const IMPECCABLE_PACKAGE = 'impeccable@4.11.1';
   export const SKILLS_CLI = 'skills@1.9.0';
   export const SKILLS_CLI_NODE_FLOOR = '22.20.0';
   export const FRONTEND_TIMEOUT_MS = 120000;
   export const CHOICE_FILE = join('.claude', 'frontend-skills.json');
   export const FRONTEND_SKILLS = Object.freeze([
     Object.freeze({ name: 'impeccable', source: 'impeccable', pin: IMPECCABLE_PACKAGE, via: 'impeccable' }),
     Object.freeze({ name: 'emil-design-eng', source: 'emilkowalski/skill', pin: '64eb3deb9a5fbfa041faf783e0bc3fd635872e9c', via: 'skills' }),
     Object.freeze({ name: 'design-taste-frontend', source: 'Leonxlnx/taste-skill', pin: '952435f63acece7d2fcb4b4d3c1786c1c43603e0', via: 'skills' }),
   ]);
   ```

   The array order is the install order (spec table). `name` is the installed directory and, for the two `skills` CLI entries, the `--skill` value and the `skills-lock.json` key (the frontmatter `name`, per the spec's measurement; the taste skill's repository folder `taste-skill` appears nowhere).

2. **`--copy` stays on every platform.** The spec leaves to this plan whether `--copy` "still writes the canonical `.agents/skills/<name>` copy that `computedHash` covers", and drops it for non-win32 if not. Measurement 1 shows the premise does not hold: `computedHash` covers the fetched source, never an installed copy, and a lone `-a claude-code` install is a copy with or without the flag, so dropping `--copy` changes no byte on disk. What it would change is the lock: without `--copy` the entry carries no `installMode`, and `skills install --frozen-lockfile` would restore the skill as a symlink into a new `.agents/skills/` tree (which Codex also reads), unlike what was installed and unworkable on stock Windows. Keeping `--copy` keeps the restore identical to the install on all platforms. The spec's E2 argv writes `[--copy]`, which this satisfies. `installArgs(skill)` therefore takes no platform argument:

   ```js
   // impeccable
   ['--yes', 'impeccable@4.11.1', 'install', '-y', '--providers=claude', '--scope=project']
   // each skills CLI entry
   ['--yes', 'skills@1.9.0', 'add', `${source}@${pin}`, '--skill', name, '-a', 'claude-code', '--copy', '-y']
   ```

   `commandLine(skill)` is `npx ${installArgs(skill).join(' ')}`; it is both the win32 shell string and the manual command printed on a failure.

3. **Sweep in its own module, `lib/installer/stale-uipro.mjs`**, with the tree hasher shared with Impeccable's file record in `lib/installer/file-digests.mjs`:
   - `digestTree(root, { readFile = readFileSync } = {})` returns a plain object whose keys are the `/`-separated paths relative to `root`, sorted by plain string order, and whose values are the sha256 hex of each regular file, `'symlink'` for a symlink or junction (`lstatSync`, never followed or opened), `'not a regular file'` for anything else that is not a directory, and `'unreadable (<code>)'` when reading a file or listing a subdirectory fails. Directories are recursed and are not entries. A failure to list `root` itself throws (the caller turns it into a line). Exported markers: `SYMLINK = 'symlink'`, `NOT_REGULAR = 'not a regular file'`.
   - `UIPRO_CLAUDE_OUTPUT`: `new Map([['2.2.3', Object.freeze({ …31 entries… })]])`, with a provenance comment naming the tarball URL, its integrity and the rendering of measurement 3. The 31 entries, path → sha256:

     ```
     SKILL.md 07b87b8998b51b9c234df031e31aa2a85cf86abeaa05efd984c2f66ca7f06d68
     data/charts.csv b754c0efffcf54cb889114a9314be1d5af6ceebe65c4c436d713b52018e752c9
     data/colors.csv 4cc0df2785f340b8bd0ace50bd4068dc13a7c4c6fa4d9d2723271244ce904614
     data/icons.csv 351fe61ba45b8146c66de6ea7d67297654639d79a94f537b4d0bad570058c28f
     data/landing.csv 010e1e46db271b94e0af6f18973bea86ddba62feeccd62aeeaa6ed40e2ae2db1
     data/products.csv 5359e3037dcb84e99c792ea13dd44f5b78ab6a53557afb309cf19140512aaf5b
     data/react-performance.csv 904c8afcda229629545912dde0e8ac37503757131f0169f80b016f1f58c4fd3f
     data/stacks/astro.csv ad18dae3ab6d148d37d144592df80dc1825b6c9e86d9d2d68fdda77434206a37
     data/stacks/flutter.csv e470e6bc2bcd8562667cc764d1e1afb0be0a30ca4dc9ec12fa18b19d46f156bd
     data/stacks/html-tailwind.csv 1f004891dd189f6bc2a7717401e3100244326e7e2f3963a79bf7b2349d85e091
     data/stacks/jetpack-compose.csv 6c8fd4b0391c342c12b0af15610cd5becbeccaef0bbe8dcfc01d928c3195d93e
     data/stacks/nextjs.csv 06a8e8c13bd44696c6ebb4cb6c4d8dea440e3de8cce77616512529ed29258f0c
     data/stacks/nuxt-ui.csv 05d6e74501b2b6a636faed32450622759f49a5bcafad971f5f4e7eba0eb7be71
     data/stacks/nuxtjs.csv f7a3f2d9542856d00199f85c6c023b7c284cc698e2e6e12d61afce2edacb24d6
     data/stacks/react-native.csv a08ca77fcf6b6d9531982dce465366296013bfcf12d2938ac72ad57cf0c4f085
     data/stacks/react.csv b6e3eb0e4c9c01bd00ffb951d5ca224a19d488b4544c75436f48cf92ff12bf45
     data/stacks/shadcn.csv 395c2e415ef6f48a474acccdc8eb2c7258a6ed751a5037ba171a2d8823e02ded
     data/stacks/svelte.csv bc8d158994a8bdf412830a9dd5e5a5534edd2f367a6e50e0ebd4d76f592dfa3f
     data/stacks/swiftui.csv e87cb9eee208bb753bdab96d4a261c7f830c4317ee90ec098316b248fc32be85
     data/stacks/vue.csv 9b793c3f4eec85f77a758c09322f2b62f3b3ca549bb713ccf0849ef885934395
     data/styles.csv ad3c3236134d833bda01a2faf31ddeaaa1dbd5005fa430dec571fa91b26e5fea
     data/typography.csv 64695e05ac335ba534aff396c4ba9241c642f80ea53b424251d2669b71c4772b
     data/ui-reasoning.csv 58fc52fff69f62709f8c7dd460de6f6693699ea820f24287f3301a427c2b554e
     data/ux-guidelines.csv 1870ee048f2a2bdd60709f8f7adf7f3b6dcad560bc005c8b2915a8ac8639820d
     data/web-interface.csv 10bfc24e09a6a15db8309e6ef9b6881e1d4af97dffb7c99418aefb8e30df7d54
     scripts/__pycache__/core.cpython-314.pyc f48bad01daeb2f69ad374fcd0ea69e137f4b3d8e2c68489ac1d82054e5a02217
     scripts/__pycache__/design_system.cpython-314.pyc 4bd10a5f5c270d162a7392dc502e3a2b66688d15d0fdfc7ff64076a2d5f4ad61
     scripts/__pycache__/search.cpython-314.pyc 73bde4bb8508dbe8206e7bbc3719bb953f83b2e47b37439d3f607aa670e8d189
     scripts/core.py 5459d1f04eea03dfb913742d0c03edc5065ac67f6227e4807fa87699662588cb
     scripts/design_system.py 4da1d341f3c7749df51b51db4a543a48a427c3c746eb0e9882a1ab86acf3bb54
     scripts/search.py a449e57060ef5134e98e62fd11f6e240153afd68c27dab89cbb72a3ce55f1498
     ```

     Only these digests ship; the third-party files are not copied into the repository (tests build synthetic trees and pass their own table).
   - `UIPRO_FLAT_HASHES = new Map()` (sha256 → era label): empty by owner decision, so every `~/.claude/skills/ui-ux-pro-max.md` is named and left.
   - `matchKnownVersion(digests, known)` returns the version whose table has exactly the same key set and equal values, else `null`. A `'symlink'`, `'not a regular file'` or `'unreadable (…)'` value can never equal a hex digest, so any of them leaves the copy in place.
   - `sweepStaleUipro({ cwd, home, known = UIPRO_CLAUDE_OUTPUT, flatHashes = UIPRO_FLAT_HASHES, rm = rmSync, unlink = unlinkSync })` returns `{ stdout: string[], stderr: string[] }` and never throws. Project copy `<cwd>/.claude/skills/ui-ux-pro-max`: absent (`lstat` `ENOENT`) → nothing; a symlink or a non-directory → left; else `digestTree`, then match → `rm(dir, { recursive: true, force: false })` → removed. Flat file `<home>/.claude/skills/ui-ux-pro-max.md`: absent → nothing; not a regular file → left; sha256 in `flatHashes` → `unlink` → removed with that label; else left. Lines, exactly:
     - stdout `removed stale ui-ux-pro-max skill (uipro-cli 2.2.3 content): <path>` (the label is `uipro-cli <version>` for the project copy and the map's label for the flat file);
     - stderr `left ui-ux-pro-max in place (does not match a known install; review and remove it yourself): <path>`;
     - stderr `left ui-ux-pro-max in place (<code>): <path>` when `lstat`, `digestTree`, `rm` or `unlink` throws (`e.code ?? e.message`).

4. **Classification through the detector as a child process.** `classifyWithDetector(assetRoot, cwd, { spawn = spawnSync, timeoutMs = 30000 } = {})` runs `spawn(process.execPath, [join(assetRoot, 'scripts', 'detect-stack.mjs'), cwd], { encoding: 'utf8', timeout: timeoutMs, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })` and returns `{ type: <projectType> }`, or `{ error: <reason> }` when the spawn errors, exits non-zero, prints unparseable JSON, or prints no string `projectType` (the detector prints `{}` on its own failures). Pipes are safe here: the child is `node` itself and starts no grandchild. `isOfferedType(type)` is true for `frontend` and `fullstack` only.

5. **The offer, `offerFrontendSkills(options)`** returns `{ stdout: string[], stderr: string[] }` and never throws (an outer catch returns `stderr: ['frontend design skills: unexpected error: <message>']`). Options: `{ cwd, withFrontendSkills = false, isInteractive = false, ask = askOnTerminal, spawn = spawnSync, timeoutMs = FRONTEND_TIMEOUT_MS, env = process.env, platform = process.platform, nodeVersion = process.versions.node, rm = rmSync }`. Steps, each its own small function:
   1. Read the prior record (`readChoice(cwd)`: parsed `.claude/frontend-skills.json`, or `null` when absent or unparseable).
   2. Survey each skill (`surveySkill`): `.claude/skills/<name>/SKILL.md` absent → `absent`. Present, for Impeccable: the prior record's `impeccable` entry has `pin === IMPECCABLE_PACKAGE`, a `files` object and a status in `INSTALLED_STATES` (`installed`, `already installed`, `installed without its design hook`) → `already installed`, carrying `files` over; otherwise `present at a different revision` with the prior entry's pin when it differs, else `unlocked`. Present, for a `skills` CLI entry: lock entry `commit === pin` → `already installed`; another commit → `present at a different revision (<commit>)`; no entry, no lock or an unreadable lock → `present at a different revision (unlocked)`.
   3. No absent skill → no question; report each surveyed state; record with `choice: prior?.choice ?? 'skipped'`, `reason: 'nothing to install'`.
   4. Consent (`consent`): `withFrontendSkills` → accepted. Not interactive → skipped, reason `non-interactive run`. Prior `choice === 'declined'` → declined, reason `declined on an earlier run`, and `ask` is not called. Else `ask(DISCLOSURE + CONSENT_PROMPT)`; `acceptsAnswer(answer)` is true only for a string that, trimmed and case-insensitive, is `''`, `y` or `yes`; anything else, a non-string (`null`, `undefined`) or a throwing `ask` declines (reason `declined`). Because an empty answer now means Yes, the module's terminal reader must tell an empty line from end of input: `askOnTerminal` reads byte by byte like `plugins.mjs`'s `readLine` but returns `null` when input ends before a newline, so a closed stdin (Ctrl-D, a pipe that ends) is an unreadable answer and declines, as the spec requires ("an unreadable answer is not consent").
   5. Accepted: for each absent skill in table order, a `skills` CLI entry on a Node below `SKILLS_CLI_NODE_FLOOR` is `not installed (needs Node >= 22.20, found <v>)` and never spawned; otherwise spawn `commandLine` / `installArgs` (decision 7), classify the result (decision 7), and on exit 0 verify (decision 6). Present skills are never re-run.
   6. Report one line per skill (decision 8) and write the record (decision 9).

   `DISCLOSURE` (exact text, joined with `\n`, ending in `\n`):

   ```
   This project looks like frontend work. code-conductor can install three third-party design skills into .claude/skills/:
     - impeccable (npm impeccable@4.11.1), the lead design skill, with its design hook
     - emil-design-eng (emilkowalski/skill at 64eb3deb9a5fbfa041faf783e0bc3fd635872e9c, through skills@1.9.0)
     - design-taste-frontend (Leonxlnx/taste-skill at 952435f63acece7d2fcb4b4d3c1786c1c43603e0, through skills@1.9.0)
   They are third-party code and run with the agent's permissions.
   Impeccable adds a Claude Code command hook that runs on the agent's edits even when you deny the model's own commands, and the hook can download Impeccable's engine binary (checksum-verified) on first use.
   The Impeccable skill fetches visual directions from impeccable.style when a new design starts, and its skill content is signed by the vendor and not pinned to a commit: the npm version pins the launcher, the engine and the signing key, not the bundle bytes.
   ```

   `CONSENT_PROMPT = 'Install the frontend design skills? [Y/n] '`. The disclosure and the prompt reach the user through the one `ask` call, so the disclosure is always printed before the prompt and never on a run that does not ask. The module's default `askOnTerminal` writes the question to stdout and reads with `readAnswerLine(fd = 0, read = readSync)` (exported; `null` on end of input before a newline, at most 256 bytes, like `readLine`).

6. **Verification after exit 0** (`verifySkill`):
   - Every skill: `.claude/skills/<name>/SKILL.md` must exist (`existsSync`), else `not verified (no .claude/skills/<name>/SKILL.md)`. A stub that writes `.claude/skills/taste-skill/` therefore reports `design-taste-frontend: not verified (no .claude/skills/design-taste-frontend/SKILL.md)`.
   - `skills` CLI entries: `readLock(cwd)` reads `<cwd>/skills-lock.json` and returns `{ state: 'missing' }` (`ENOENT`), `{ state: 'unreadable' }` (any other read error, unparseable JSON, or no `skills` object), or `{ state: 'ok', skills }`. Unreadable → `not verified (skills-lock.json unreadable)`; missing or no entry under `<name>` → `not verified (no skills-lock.json entry for <name>)`; `commit !== pin` → `not verified (skills-lock.json commit for <name> is <commit>, expected <pin>)`. The lock file is only ever read.
   - Impeccable: after `SKILL.md`, `hasImpeccableHook(cwd)` scans `.claude/settings.json` and `.claude/settings.local.json` (each parsed on its own; an unreadable one counts as no hook): any event array, any entry's `hooks[]`, any string `command` that, with `\` read as `/`, contains `.claude/skills/impeccable/`. Found → `installed`; not found → `installed without its design hook (no hook entry for .claude/skills/impeccable in .claude/settings*.json)`. In both cases the entry gets `files: digestTree(<cwd>/.claude/skills/impeccable)` (a throw becomes `files: {}`). Nothing the CLI wrote is ever deleted.

7. **Spawn and result classification** (`spawnSkill`, `classifySpawn`), mirroring `plugins.mjs`: stdout and stderr go to two files in a `mkdtempSync(join(tmpdir(), 'cc-frontend-'))` directory removed best-effort afterwards; options `{ cwd, env: childEnv, timeout: timeoutMs, windowsHide: true, stdio: ['ignore', outFd, errFd] }`, with `cwd` the project root (both CLIs install relative to it). `childEnv = { ...env, DISABLE_TELEMETRY: '1', DO_NOT_TRACK: '1' }`, plus `NoDefaultCurrentDirectoryInExePath: '1'` on win32: there the call is `spawn(commandLine(skill), { ...options, shell: true })`, and that variable stops `cmd.exe` from resolving an `npx.cmd` committed to the project directory it runs in (the reason `plugins.mjs` runs `claude` from an empty temp dir, which this command cannot do). Elsewhere it is `spawn('npx', installArgs(skill), options)`. The command string holds only constants. Classification: `ENOENT`, or on win32 status `9009` or "is not recognized" in stderr → `npx not found on PATH`; `ETIMEDOUT` or signal `SIGTERM` → `timed out after 120s` (`formatTimeout`); any other `error` → `unexpected error: <message>`; another signal → `signal <name>`; non-zero status → `exit <status>`; status 0 → verify.

8. **Report lines** (bin prefixes `code-conductor: `):
   - stdout: `frontend design skill <name>: installed (<pin>)`, `frontend design skill <name>: already installed`.
   - stderr: `frontend design skill <name>: not installed (<reason>); to install it yourself: <commandLine>`; `frontend design skill <name>: not verified (<what>)`; `frontend design skill <name>: present at a different revision (<pin, commit or unlocked>); not changed`; `frontend design skill impeccable: installed without its design hook (no hook entry for .claude/skills/impeccable in .claude/settings*.json)`.
   - Not accepted (stderr): one summary line `frontend design skills not installed (<reason>; pass --with-frontend-skills to install them)`, where `<reason>` is `non-interactive run`, `declined` or `declined on an earlier run` (the first is the spec's exact skipped line). For `non-interactive run` and `declined`, each absent skill then gets `to install <name> yourself: <commandLine>`; for `declined on an earlier run` the summary is the only line, as the spec says. Surveyed present skills report their state line in every case.
   - Classification failure (stderr, from bin): `could not classify the project (<reason>); frontend design skills not offered`.

9. **The record**, written on every offered outcome with `writeAtomic` (`lib/installer/file-merge.mjs`) to `<cwd>/.claude/frontend-skills.json` as `JSON.stringify(record, null, 2) + '\n'`:

   ```json
   { "choice": "accepted | declined | skipped", "reason": null, "cli": "skills@1.9.0",
     "skills": [ { "name": "impeccable", "source": "impeccable", "pin": "impeccable@4.11.1", "status": "installed", "files": { "SKILL.md": "<sha256>" } },
                 { "name": "emil-design-eng", "source": "emilkowalski/skill", "pin": "64eb3deb…", "status": "installed" },
                 { "name": "design-taste-frontend", "source": "Leonxlnx/taste-skill", "pin": "952435f6…", "status": "installed" } ] }
   ```

   `reason` is `null` when accepted, else the consent reason or `nothing to install`. `status` is one of `installed`, `already installed`, `not installed`, `not verified`, `present at a different revision`, `installed without its design hook` (the line's words, without the detail). `files` appears only on Impeccable's entry when its install verified or it was carried over as `already installed`, so a run that reports `already installed` leaves the map as it was. A failed write becomes one stderr line `could not record the frontend skills choice (<code>)` and changes nothing else.

10. **Wiring in `bin/code-conductor.mjs`.**
    - `USAGE` gains `[--with-frontend-skills]` right after `[--with-plugins]`.
    - `parseArgs`: `opts.withFrontendSkills = false` in the defaults; `else if (a === '--with-frontend-skills') opts.withFrontendSkills = true;` after the `--with-plugins` branch, with a one-line comment (FEAT-037: consent to install the frontend design skills without asking; `--with-plugins` does not imply it).
    - `run()`'s options gain `classify`, `frontendSpawn`, `frontendTimeoutMs`, `frontendEnv = process.env` and `platform = process.platform`, documented in the existing comment above `run()`.
    - New `projectExtras(emit, options)` and `offerFrontend(emit, options)`, each with its own try (fail-open, like `offerPlugins`): `projectExtras` first emits `sweepStaleUipro({ cwd, home })`'s lines, then calls `classify(cwd)` (default `(dir) => classifyWithDetector(assetRoot, dir)`); `{ error }` or a throw → the classification line; an offered type → `offerFrontend` emits `offerFrontendSkills(...)`'s stdout and stderr lines. It runs only when `opts.project`, right after `deployProject` and before `offerPlugins`, so a global-only run never classifies, sweeps or offers.
    - `--no-deps` stays a no-op (spec, Alternative paths); its comment adds "or the frontend skills offer".

11. **Docs.**
    - `CLAUDE.md:48` and `project-template/CLAUDE.md:49` become exactly `| FRONTEND_ONLY | No backend framework    | Component modularity, design skills    |` (same width as before).
    - `CLAUDE.md:74` and `project-template/CLAUDE.md:75` become exactly `| Frontend UI/UX             | impeccable, emil-design-eng, design-taste-frontend skills |`.
    - `global/CLAUDE.md:88` becomes ``- `impeccable`, `emil-design-eng`, `design-taste-frontend` — frontend design skills; `code-conductor --project` offers them on frontend projects and installs them into the project's `.claude/skills/` ``.
    - `README.md:87` (Dependencies row) becomes: ``| Frontend design skills: `impeccable`, `emil-design-eng`, `design-taste-frontend` | Frontend UI/UX work on a project the stack detector classifies as `frontend` or `fullstack` (the delegation row in `CLAUDE.md`) | `code-conductor --project` offers them: an interactive run asks first (default Yes), and a non-interactive run installs them only with `--with-frontend-skills`. Impeccable comes from `npx impeccable@4.11.1 install` with its design hook; the other two from `npx skills@1.9.0 add`, pinned to commits `64eb3deb9a5fbfa041faf783e0bc3fd635872e9c` and `952435f63acece7d2fcb4b4d3c1786c1c43603e0` in `skills-lock.json`. If an install cannot run, the installer prints the manual command and still succeeds |``.
    - `README.md:390` (`--no-deps` row): "does not affect the superpowers offer (see `--with-plugins`)" becomes "does not affect the superpowers offer or the frontend skills offer (see `--with-plugins` and `--with-frontend-skills`)".
    - After `README.md:395` (`--with-plugins` row), a new row: ``| `--with-frontend-skills` | With `--project` on a `frontend` or `fullstack` project, install the three frontend design skills without asking (120 s timeout per command). A non-interactive run installs them only with this flag; an interactive run asks instead (default Yes). `--with-plugins` does not imply it, nor the reverse. The outcome, the pins and the sha256 of Impeccable's installed files are recorded in `.claude/frontend-skills.json` |``.
    - `README.md:290` (Skills section) becomes: ``- **Frontend design skills (offered on frontend projects).** `code-conductor --project` offers three third-party skills when the project classifies as `frontend` or `fullstack`: Impeccable (`impeccable@4.11.1`, the lead design skill, with its design hook), `emil-design-eng` (`emilkowalski/skill`) and `design-taste-frontend` (`Leonxlnx/taste-skill`), the last two through `skills@1.9.0` and pinned to a commit in `skills-lock.json`. They are third-party code and run with the agent's permissions. Impeccable's hook runs on the agent's edits even when you deny the model's own commands and can download Impeccable's engine binary (checksum-verified) on first use; the Impeccable skill fetches visual directions from `impeccable.style` when a new design starts, and its skill content is signed by the vendor and not pinned to a commit, so the installer records the sha256 of each installed file in `.claude/frontend-skills.json`. The installer turns the CLIs' telemetry off (`DISABLE_TELEMETRY`, `DO_NOT_TRACK`). A `ui-ux-pro-max` copy left by the retired shell installers is removed only when it matches the `uipro-cli` 2.2.3 output byte for byte; any other copy stays and is named in the report.``
    - `README.md:584` (file tree): `CLI modules (env, deploy, settings, merges, heal)` becomes `CLI modules (env, deploy, settings, merges, heal, plugins, frontend-skills, stale-uipro, file-digests)`.
    - `.github/wiki/pages/Skills.md:54-60`: the `## Retired` / `### ui-ux-pro-max` block becomes a `## Frontend design skills` section (the three skills, the offer and its default Yes, `--with-frontend-skills`, the pins, the hook disclosure, the record file) followed by `## Retired` / `### ui-ux-pro-max` reduced to one paragraph: replaced by the frontend design skills, and a copy left by the shell installers is swept only on an exact content match.

12. **Repo invariants** (`tests/tools/repo-invariants.test.js`, inside `describe('this repository, at every commit'`):
    - The existing ui-ux-pro-max row (`:148-150`) extends its regex with `|installs ui-ux-pro-max|ui-ux-pro-max (skill )?is installed` (it stays one test).
    - New `it('both CLAUDE.md mirrors name the frontend design skills in the same rows [FEAT-037]')`: in `CLAUDE.md` and `project-template/CLAUDE.md`, the one line starting `| FRONTEND_ONLY |` and the one line starting `| Frontend UI/UX` equal the decision 11 strings.
    - New `it('no shipped template names ui-ux-pro-max [FEAT-037]')`: `CLAUDE.md` and every file under `global/`, `project-template/` and `skills/` (recursive `readdirSync`) do not contain `ui-ux-pro-max`; `section(read('global/CLAUDE.md'), 'Active Skills')` contains `` `impeccable` ``.
    - New `it('the README describes the offered frontend design skills [FEAT-037]')`: `section(README, 'Quickstart')` contains `--with-frontend-skills`, `impeccable@4.11.1`, `skills@1.9.0`, both full SHAs and `default Yes`, contains no `| ui-ux-pro-max skill |`, and its `Frontend design skills:` row does not match `/opt-in/i`; `section(README, 'Skills')` contains `even when you deny the model's own commands`, `impeccable.style` and `byte for byte`.

13. **`.gitignore` leaf** for this plan: `!/docs/superpowers/plans/2026-11-26-feat037-frontend-design-skill-stack-replace-ui-ux-pro.md`, inserted after the `2026-11-26-bug099-install-writes-an-unbounded-build-tree.md` plan leaf and before the `2026-11-26-feat062-…` plan leaf (sorted order).

## Baseline (measured on this branch, HEAD a584374, Node v24.22.2)

- `npx vitest run tests/installer/cli.test.js`: **71 passed (71)**; `tests/installer/plugins.test.js`: **37 passed (37)**; `tests/tools/repo-invariants.test.js`: **16 passed (16)**; `tests/installer/settings-merge.test.js`: **32 passed (32)**.
- None of the four new test files exists. The suite grows by 3 + 11 + 28 + 12 + 3 = **57** tests.

---

### Task 0: Commit this plan

**Files:**
- Create: `docs/superpowers/plans/2026-11-26-feat037-frontend-design-skill-stack-replace-ui-ux-pro.md`
- Modify: `.gitignore`

- [X] [T-001] Create this plan file from the approved spec `0940bebd…`. No dependency.
- [X] [T-002] `.gitignore`: insert the leaf of plan decision 13. Depends on T-001.
- [X] [T-003] Stage: `git add -u .gitignore` (tracked) and `git add -f docs/superpowers/plans/2026-11-26-feat037-frontend-design-skill-stack-replace-ui-ux-pro.md` (new, under the ignored `docs/superpowers/plans/`). Depends on T-002.
- [X] [T-004] Commit: `docs: plan the frontend design skill stack [FEAT-037]`. Depends on T-003.

---

### Task 1: Tree digests (red, then green)

**Files:**
- Create: `lib/installer/file-digests.mjs`
- Test: `tests/installer/file-digests.test.js`

- [ ] [T-101] `tests/installer/file-digests.test.js`: the three cases of T-901. Symlinks are directory junctions (`symlinkSync(target, link, 'junction')`, as `tests/installer/file-merge.test.js:144` does), so every case runs on every CI leg and `tools/skip-baseline.json` does not change. Depends on T-004.
- [ ] [T-102] Red run: `npx vitest run tests/installer/file-digests.test.js`. Predicted: the file fails to load (the module does not exist), **no tests** run, exit 1. Depends on T-101.
- [ ] [T-103] `lib/installer/file-digests.mjs`: `SYMLINK`, `NOT_REGULAR` and `digestTree` (plan decision 3). Depends on T-102.
- [ ] [T-104] Green run: the T-102 command. Predicted: **3 passed (3)**. Depends on T-103.

---

### Task 2: Stale ui-ux-pro-max sweep (red, then green)

**Files:**
- Create: `lib/installer/stale-uipro.mjs`
- Test: `tests/installer/stale-uipro.test.js`

- [ ] [T-201] `tests/installer/stale-uipro.test.js`: the eleven cases of T-902. Matching trees are synthetic: each test writes a small tree, builds its `known` map with `digestTree` (or by hand), and passes it; only S1 reads the shipped table. Depends on T-104.
- [ ] [T-202] Red run: `npx vitest run tests/installer/stale-uipro.test.js`. Predicted: the file fails to load, **no tests**, exit 1. Depends on T-201.
- [ ] [T-203] `lib/installer/stale-uipro.mjs`: `UIPRO_CLAUDE_OUTPUT` (the 31 entries of plan decision 3, with the provenance comment), `UIPRO_FLAT_HASHES`, `matchKnownVersion`, `sweepStaleUipro` and its line builders. Depends on T-202.
- [ ] [T-204] Check the shipped table against the measurement: `node -e` that imports the module and prints the sha256 of the sorted `<hash> <path>\n` lines prints `b474d030548bdc3a092512a709cda05362ab263b735d1379418fd05629120a88`. Depends on T-203.
- [ ] [T-205] Green run: the T-202 command. Predicted: **11 passed (11)**. Depends on T-204.

---

### Task 3: The frontend skills module (red, then green)

**Files:**
- Create: `lib/installer/frontend-skills.mjs`
- Test: `tests/installer/frontend-skills.test.js`

- [ ] [T-301] `tests/installer/frontend-skills.test.js`: the 28 cases of T-903. The injected spawn is a stub in the `fakeSpawn` shape of `tests/installer/plugins.test.js:18-28` that records `(command, args, options)` and, per case, writes into `options.cwd` what the CLI would have written (`SKILL.md`, `skills-lock.json` entries, an Impeccable hook entry); every case passes `platform: 'linux'` (except the argv case, which is pure), `env: {}` and an explicit `nodeVersion`. Depends on T-205.
- [ ] [T-302] Red run: `npx vitest run tests/installer/frontend-skills.test.js`. Predicted: the file fails to load, **no tests**, exit 1. Depends on T-301.
- [ ] [T-303] `lib/installer/frontend-skills.mjs`: the constants and table of plan decision 1, `installArgs`, `commandLine`, `DISCLOSURE`, `CONSENT_PROMPT`, `acceptsAnswer`, `isOfferedType` and `classifyWithDetector` (decisions 2, 4, 5). Depends on T-302.
- [ ] [T-304] Same file: `readChoice`, `readLock`, `hasImpeccableHook`, `surveySkill` and `verifySkill` (decisions 5.2, 6). Depends on T-303.
- [ ] [T-305] Same file: `spawnSkill`, `classifySpawn`, the consent step, the report lines, the record writer and `offerFrontendSkills` (decisions 5, 7, 8, 9). Depends on T-304.
- [ ] [T-306] Green run: the T-302 command. Predicted: **28 passed (28)**. Depends on T-305.

---

### Task 4: Wire the sweep and the offer into the CLI (red, then green)

**Files:**
- Modify: `bin/code-conductor.mjs`
- Test: `tests/installer/frontend-skills-cli.test.js`

- [ ] [T-401] `tests/installer/frontend-skills-cli.test.js`: the twelve cases of T-904, every `run()` with an injected `classify`, `frontendSpawn`, `spawn` (superpowers, recording) and `ask` (answers `n` to the superpowers prompt; the frontend question is recognised by `CONSENT_PROMPT`). Depends on T-306.
- [ ] [T-402] Red run: `npx vitest run tests/installer/frontend-skills-cli.test.js`. Its full match set is the twelve cases. Predicted: **7 failed | 5 passed (12)**: C2, C3, C4, C9 and C10 are green before the wiring (nothing is offered, and the settings merge already keeps a host hook); C1, C5, C6, C7, C8, C11 and C12 are red. Any other split means a test is wrong: fix the test, not the prediction. Depends on T-401.
- [ ] [T-403] `bin/code-conductor.mjs`: imports, `USAGE`, `parseArgs`, the `run()` options and comment, `projectExtras`, `offerFrontend` and the call after `deployProject` (plan decision 10). Depends on T-402.
- [ ] [T-404] Green run: `npx vitest run tests/installer/frontend-skills-cli.test.js tests/installer/cli.test.js tests/installer/plugins.test.js tests/installer/smoke.test.js tests/installer/settings-merge.test.js`. Predicted: all passed, with `frontend-skills-cli` at **12**, `cli` at **71**, `plugins` at **37** and `settings-merge` at **32** (unchanged). Depends on T-403.

---

### Task 5: The CLAUDE.md mirrors, the README and the wiki (red, then green)

**Files:**
- Modify: `CLAUDE.md`
- Modify: `project-template/CLAUDE.md`
- Modify: `global/CLAUDE.md`
- Modify: `README.md`
- Modify: `.github/wiki/pages/Skills.md`
- Test: `tests/tools/repo-invariants.test.js`

- [ ] [T-501] `tests/tools/repo-invariants.test.js`: the regex extension and the three new cases of plan decision 12. Depends on T-404.
- [ ] [T-502] Red run: `npx vitest run tests/tools/repo-invariants.test.js`. Predicted: **3 failed | 16 passed (19)**, the extended ui-ux-pro-max row among the passes (no current line says the skill is installed). Depends on T-501.
- [ ] [T-503] `CLAUDE.md` and `project-template/CLAUDE.md`: the two rows of plan decision 11 in each. Then `grep -n 'FRONTEND_ONLY\|Frontend UI/UX' CLAUDE.md project-template/CLAUDE.md` prints four lines whose row text is pairwise identical. Depends on T-502.
- [ ] [T-504] `global/CLAUDE.md:88`: the Active Skills line of plan decision 11. Depends on T-503.
- [ ] [T-505] `README.md`: the Dependencies row (`:87`), the Skills entry (`:290`), the `--no-deps` row (`:390`), the new `--with-frontend-skills` row after `:395`, and the file tree (`:584`), as plan decision 11 gives them. `git diff README.md` touches no line under `## Known limits`. Depends on T-504.
- [ ] [T-506] `.github/wiki/pages/Skills.md`: the section of plan decision 11. Depends on T-505.
- [ ] [T-507] Green run: the T-502 command, plus `npx vitest run tests/installer/templates.test.js tests/installer/merge-md.test.js tests/unit/adopt-claude-md.test.js tests/scripts/docs-sync.test.js` (they read the `CLAUDE.md` templates). Predicted: `repo-invariants` **19 passed (19)** and the other four all passed with their counts unchanged. Depends on T-506.

---

### Task 6: Full suite, scope check and commit

**Files:**
- Modify: `docs/superpowers/plans/2026-11-26-feat037-frontend-design-skill-stack-replace-ui-ux-pro.md` (ticks only)

- [ ] [T-601] Run `npm test` (long: `tests/scripts/orchestrate.test.js` alone takes several minutes; run it in the background if the shell times out). Predicted: exit 0, with the four new files at 3, 11, 28 and 12 and `repo-invariants` at 19. A red counts as ENV only if the sandbox caused it (network, tmp permissions) and its file is not one this plan touches; report it by name. Any other red gets fixed. Depends on T-507.
- [ ] [T-602] Scope check: `git status --short` lists exactly the files of the Global Constraints and this plan; no temporary file is left in the tree (no `skills-lock.json`, `.claude/frontend-skills.json` or `cc-frontend-*` directory at the repository root). `git diff --stat` shows no change to the spec, `scripts/detect-stack.mjs`, `lib/installer/plugins.mjs`, `lib/installer/heal.mjs`, `lib/installer/deploy.mjs`, `lib/installer/settings-merge.mjs`, the hooks, `package.json`, `package-lock.json`, `.github/workflows/`, `.github/actions/` or the README Known-limits lines. `node -e "console.log(JSON.stringify(require('./package.json').dependencies))"` prints `{}`. Depends on T-601.
- [ ] [T-603] Stage the new files: `git add lib/installer/file-digests.mjs lib/installer/stale-uipro.mjs lib/installer/frontend-skills.mjs tests/installer/file-digests.test.js tests/installer/stale-uipro.test.js tests/installer/frontend-skills.test.js tests/installer/frontend-skills-cli.test.js` (new, not ignored). Depends on T-602.
- [ ] [T-604] Stage the modified files: `git add -u bin/code-conductor.mjs CLAUDE.md project-template/CLAUDE.md global/CLAUDE.md README.md .github/wiki/pages/Skills.md tests/tools/repo-invariants.test.js` (all tracked). Depends on T-603.
- [ ] [T-605] Stage: `git add -u docs/superpowers/plans/2026-11-26-feat037-frontend-design-skill-stack-replace-ui-ux-pro.md` (carries the ticks for T-101 to T-604). Depends on T-604.
- [ ] [T-606] Commit: `feat: offer a pinned frontend design skill stack and sweep stale ui-ux-pro-max installs [FEAT-037]`. Depends on T-605.

---

## Test List

- [ ] [T-901] `tests/installer/file-digests.test.js` (Task 1):
  - D1 a tree with `b.txt`, `a/nested/c.txt` and `A.md` gives sorted `/`-separated keys (`A.md`, `a/nested/c.txt`, `b.txt`) and the sha256 of each file's bytes; empty directories are not entries.
  - D2 a junction `link` to a directory outside the tree is recorded as `'symlink'`, and no key under `link/` appears (not followed).
  - D3 with an injected `readFile` that throws `{ code: 'EACCES' }` for one path, that key is `'unreadable (EACCES)'` and the others are digests.
- [ ] [T-902] `tests/installer/stale-uipro.test.js` (Task 2):
  - S1 `UIPRO_CLAUDE_OUTPUT` has exactly the key `2.2.3`, 31 entries, every value `/^[0-9a-f]{64}$/`, `SKILL.md` = `07b87b89…` (full digest), and the sha256 of its sorted `<hash> <path>\n` lines is `b474d030…` (full digest); `UIPRO_FLAT_HASHES.size` is 0.
  - S2 a `<cwd>/.claude/skills/ui-ux-pro-max/` tree equal to an injected `known` (`{ '9.9.9': … }`) is removed, and stdout is exactly `removed stale ui-ux-pro-max skill (uipro-cli 9.9.9 content): <path>`.
  - S3 the same tree with one byte changed is left byte-identical (`digestTree` before equals after) and stderr names it with the `does not match a known install` line.
  - S4 one extra file: left and named. S5 one missing file: left and named. S6 a junction inside the tree: left and named, and the junction's target is untouched.
  - S7 `ui-ux-pro-max` itself a junction to a matching tree elsewhere: left and named, the target untouched.
  - S8 `<home>/.claude/skills/ui-ux-pro-max.md` whose sha256 is in an injected `flatHashes` (`label: 'curl download'`) is removed with `(curl download content)`. S9 the same file with the default empty map is left and named.
  - S10 neither path exists: both arrays empty.
  - S11 an injected `rm` that throws `{ code: 'EPERM' }` on a matching tree: stderr `left ui-ux-pro-max in place (EPERM): <path>`, no throw.
- [ ] [T-903] `tests/installer/frontend-skills.test.js` (Task 3):
  - F1 pins: `IMPECCABLE_PACKAGE` matches `/^impeccable@\d+\.\d+\.\d+$/` and is `impeccable@4.11.1`; `SKILLS_CLI` matches `/^skills@\d+\.\d+\.\d+$/` and is `skills@1.9.0`; the two `skills` pins match `/^[0-9a-f]{40}$/`; names are exactly `impeccable`, `emil-design-eng`, `design-taste-frontend` in that order.
  - F2 `installArgs` gives exactly the three argv of plan decision 2; none contains `--no-hooks`, `--all` or `*`; each `skills` argv has exactly one `--skill`; `commandLine` is `npx ` plus the argv joined by spaces.
  - F3 `DISCLOSURE` contains `hook`, `even when you deny the model's own commands`, `download Impeccable's engine binary (checksum-verified) on first use`, `impeccable.style`, `signed by the vendor` and `not pinned to a commit`, and names the three pins; `CONSENT_PROMPT` is `Install the frontend design skills? [Y/n] `.
  - F4 `acceptsAnswer` is true for `''`, `'y'`, `'Y'`, `'yes'`, `' yes '` and false for `'n'`, `'no'`, `'maybe'`, `null` and `undefined`; `readAnswerLine` (the reader behind `askOnTerminal`, exported for this test, with an injected `read`) returns `''` for input `\n`, `'y'` for `y\n`, and `null` for input that ends with no newline.
  - F5 interactive, answer `''`: `ask` is called once with `DISCLOSURE + CONSENT_PROMPT` and before the first spawn; three spawns in table order, each `('npx', installArgs(skill), options)` with `options.cwd` the project, `options.timeout` 120000 and `options.env` holding `DISABLE_TELEMETRY: '1'` and `DO_NOT_TRACK: '1'`.
  - F6 answer `'n'`: no spawn; the record has `choice: 'declined'`; stderr has the `(declined; pass --with-frontend-skills to install them)` summary and three `to install <name> yourself:` lines.
  - F7 a prior record with `choice: 'declined'`, interactive: `ask` is never called, nothing is spawned, stderr is exactly one line, the `declined on an earlier run` summary.
  - F8 non-interactive, no flag: no spawn, stderr starts with `frontend design skills not installed (non-interactive run; pass --with-frontend-skills to install them)` followed by the three manual commands; the record has `choice: 'skipped'`.
  - F9 non-interactive with `withFrontendSkills`: `ask` never called, three spawns.
  - F10 a stub that writes every `SKILL.md`, both lock entries at their pinned commits and an Impeccable `PostToolUse` hook in `.claude/settings.json`: three stdout `installed (<pin>)` lines, no stderr; the record has `choice: 'accepted'`, `reason: null`, `cli: 'skills@1.9.0'`, Impeccable's `pin: 'impeccable@4.11.1'`.
  - F11 the Impeccable stub writes `SKILL.md`, `reference/a.md`, `reference/deep/b.md` and a junction `linked` → the record's `files` keys are exactly those paths in sorted order, the three values are the files' sha256, and `linked` is `'symlink'`.
  - F12 the taste stub writes `.claude/skills/taste-skill/SKILL.md` (and its lock entry): `design-taste-frontend: not verified (no .claude/skills/design-taste-frontend/SKILL.md)`.
  - F13a lock commit differs from the pin → the `skills-lock.json commit for <name> is <x>, expected <pin>` line. F13b no lock entry → `no skills-lock.json entry for <name>`. F13c `skills-lock.json` is `{not json` → `not verified (skills-lock.json unreadable)` and the file's bytes are unchanged.
  - F14a Impeccable stub without any hook → `installed without its design hook (…)`, the record's status `installed without its design hook` and a `files` map. F14b the hook in `.claude/settings.local.json` only → `installed`.
  - F15a the first spawn exits 1 → `impeccable: not installed (exit 1); to install it yourself: npx --yes impeccable@4.11.1 install -y --providers=claude --scope=project`, and the two others are still spawned. F15b `{ error: { code: 'ETIMEDOUT' } }` → `not installed (timed out after 120s)`. F15c `{ error: { code: 'ENOENT' } }` → `not installed (npx not found on PATH)`. None throws.
  - F16 `nodeVersion: '22.19.0'`: only Impeccable is spawned; the two others report `not installed (needs Node >= 22.20, found 22.19.0); to install it yourself: …`.
  - F17 a prior record `accepted` with Impeccable's `files` map, every `SKILL.md` present and both lock entries at their pins: no `ask`, no spawn, three `already installed` lines, and the rewritten record's Impeccable `files` equals the prior map.
  - F18a emil present with a lock entry at another commit, the others absent: emil is not spawned and reports `present at a different revision (<commit>); not changed`; the other two are installed. F18b Impeccable's `SKILL.md` present with no record → `present at a different revision (unlocked); not changed`.
  - F19 `classifyWithDetector(ROOT, dir)` on real temp fixtures: a `package.json` with `dependencies.react` plus a `src/` directory → `{ type: 'frontend' }`; `dependencies.express` plus `server/` → `backend`; an empty directory → `library`; a path that does not exist → `{ error }`. Four `it` rows.
- [ ] [T-904] `tests/installer/frontend-skills-cli.test.js` (Task 4), every case through `run()` with a temp `home` and `cwd`:
  - C1 `--project`, `classify` → `{ type: 'frontend' }`, interactive, frontend answer `''`: the frontend question is asked after `<cwd>/.claude/settings.json` exists (deploy ran first), `frontendSpawn` is called three times, exit 0.
  - C2 `classify` → `backend`, and C3 → `library`: no frontend question, no `frontendSpawn` call, no `.claude/frontend-skills.json`.
  - C4 `--with-plugins` alone, non-interactive, `frontend`: no `frontendSpawn` call.
  - C5 `--with-frontend-skills`, non-interactive, `fullstack`: three `frontendSpawn` calls, no frontend question.
  - C6 `--help` prints a `USAGE` containing `[--with-frontend-skills]`.
  - C7 `classify` throws: exactly one stderr line starting `code-conductor: could not classify the project (`, exit 0.
  - C8 `classify` → `backend` and a non-matching `<cwd>/.claude/skills/ui-ux-pro-max/SKILL.md`: stderr has `code-conductor: left ui-ux-pro-max in place (does not match a known install; review and remove it yourself): <path>` and the file is still there.
  - C9 `<cwd>/.claude/settings.json` holding an Impeccable `PostToolUse` entry (`command: '"${CLAUDE_PROJECT_DIR}/.claude/skills/impeccable/scripts/impeccable" hook-after-edit'`): after two `--project` runs the entry is still there, deep-equal.
  - C10 a global-only run (no `--project`): `classify` is never called.
  - C11 `--with-frontend-skills`, `frontendSpawn` returning `{ status: 2 }`: exit 0 and three `not installed (exit 2)` lines.
  - C12 `--with-frontend-skills` produces no `ignoring unrecognized argument(s)` line.
- [ ] [T-905] `tests/tools/repo-invariants.test.js` (Task 5): the extended ui-ux-pro-max row and the three new rows of plan decision 12 (E5 and the README criterion).
- [ ] [T-906] No row needed: E3 is held by T-602's `dependencies` check and the existing invariant tests; the wiki page has no test and T-506 is checked by reading its diff. Full `npm test` is T-601. No UI, so no E2E row. CI legs: no new test is conditionally skipped (symlinks are junctions; the unreadable case is injected), so no leg's set in `tools/skip-baseline.json` changes.

## Commit Order

1. Task 0 (T-004): this plan and its `.gitignore` leaf.
2. Task 6 (T-606): the three modules, the four new test files, the CLI wiring, both `CLAUDE.md` mirrors with `global/CLAUDE.md`, the README, the wiki page, the invariant test and the plan ticks for T-101 to T-605 in one commit, so the two mirrors change their rows in the same commit (E5) and no commit has a red suite. The red runs (T-102, T-202, T-302, T-402, T-502) happen in the working tree before each fix. The ticks for T-606 and the Test List ride the closeout commit.

## Identified Risks

- **Python bytecode drift in a real 2.2.3 copy.** The skill tells the agent to run `scripts/search.py`; a Python other than 3.14 writes another `__pycache__/*.pyc`, and any run can rewrite the shipped ones. Such a copy has an extra or changed file and is named, not removed. That is the safe side of the rule the entry sets, and the report tells the user to remove it.
- **The detector's cost and output.** Each `--project` run now starts one `node scripts/detect-stack.mjs` (about 0.1 s on an empty project, bounded at 30 s). Its `WARN:` lines go to a pipe the installer ignores. Existing `cli.test.js` `--project` runs use an empty `cwd` that classifies as `library`, so their exact stderr assertions (for example `cli.test.js:278`) see no new line; T-404 checks it.
- **Impeccable's hook shape changing in a later engine.** Verification matches any event in either settings file by the `.claude/skills/impeccable/` path, which survives an event or matcher change; a version that moved the skill elsewhere would report `installed without its design hook`, never a failure. The pin keeps 4.11.1 fixed until a reviewed re-pin.
- **`npx` resolution on win32.** `shell: true` in the project directory is needed for `npx.cmd`; `NoDefaultCurrentDirectoryInExePath=1` keeps `cmd.exe` from running an `npx.cmd` committed to that directory. A `PATH` entry of `.` on POSIX is the user's own configuration and is not worked around.
- **A lock written by another `skills` version.** If the user re-runs `skills add` themselves, the entry's `commit` changes and the next run reports `present at a different revision`; the installer never edits the lock.
- **Sweep TOCTOU.** A file changed between `digestTree` and `rmSync` would be removed with the rest. The window is one synchronous call on a directory the user is not expected to be editing during an install; the same holds for the 1.23.3 root-`scripts/` sweep.
- **The long suite timing out the shell.** T-601 notes the duration. A timeout is not a red.
