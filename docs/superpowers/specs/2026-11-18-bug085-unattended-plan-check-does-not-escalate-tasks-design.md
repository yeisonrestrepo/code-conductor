# BUG-085: Unattended plan check does not escalate tasks that write config-read hook runners, editor and container auto-run files, other package managers or other CI systems

**Status:** Draft (pending independent review)

**Item:** `[BUG-085]` (intake of issue #241, follow-up to `[BUG-081]`). **Date:** 2026-11-18.

## Problem

In an unattended `/cc-orchestrate` run, `delegate plan` turns a delegated `APPROVE` into `ESCALATE` when a plan task's **Files:** entry reaches `WRITE_SURFACE` or the control plane (`surfaceTask` in `scripts/orchestrate.mjs`; FEAT-054, BUG-080, BUG-081, BUG-082, BUG-086). BUG-081 added the files that run code *outside* the run, after it ends, to `CONTROL_PLANE` (`scripts/orchestrate.mjs:27`): git hooks (`.git/**`, `.husky/**`, `.githooks/**`), MCP and OpenCode configuration, the status line, GitHub workflows and actions, and the npm manifests. Its owner decision 7 sent four families to one follow-up item, and this is that item:

- **Config-read hook runners.** Tools that install a git hook and then decide what it runs from a config file in the working tree: pre-commit (`.pre-commit-config.yaml`), lefthook (`lefthook.yml` and its variants, plus its script directories), overcommit (`.overcommit.yml`) and simple-git-hooks. Editing the config changes what runs on the owner's next `git commit` or `git push`, without touching `.git/`.
- **Editor and container auto-run configuration.** VS Code runs a task marked `runOn: folderOpen` from `.vscode/tasks.json` when the folder is opened, and `.vscode/settings.json` can name executables that extensions start. JetBrains (`.idea/`) and Zed (`.zed/`) keep run configurations, tasks and tool paths in the same way. A dev container's `initializeCommand` runs **on the host** before the container is built, and `postCreateCommand` and similar run inside it (`.devcontainer/**`, `.devcontainer.json`). Gitpod runs the `tasks` in `.gitpod.yml` when a workspace starts.
- **Other package managers.** Their manifests, lockfiles and config files pick the code that their next install or command runs: Yarn (`yarnPath` in `.yarnrc.yml`, plugins and releases under `.yarn/`, the PnP loader), pnpm (`.pnpmfile.cjs` hooks), Bun (`preload` in `bunfig.toml`), Deno, Python (`setup.py` runs on install, and `pyproject.toml` names the build backend), Ruby (Bundler), PHP (Composer `scripts` run on install), Rust (`.cargo/config.toml` sets runners and wrappers, and the toolchain files pick the compiler) and Go (`replace` and `toolchain` in `go.mod`).
- **Other CI systems.** GitLab CI, CircleCI, Azure Pipelines, Travis CI, Jenkins, Bitbucket Pipelines, Buildkite, Drone, Woodpecker, AppVeyor, Gitea and Forgejo Actions, Cirrus CI and Semaphore read a pipeline file from the repository and run it with the project's CI secrets on the next push.

So a plan approved only by the delegated reviewer can leave persistent execution in place through any of these files, and in an unattended run the owner never sees that plan. The precondition is `--unattended`, which the owner opts into. Attended runs are unaffected, because the owner approves every plan.

## Solution

Append one group of fixed entries to the existing `CONTROL_PLANE` constant in `scripts/orchestrate.mjs`, after the BUG-081 group, in the constant's notation: root-relative, lower-case, and a trailing `/**` protects a whole directory. A short comment line above each family says why it is there, and the comment block above the constant gains one `Owner decision (BUG-085)` line. Nothing else changes: `reachesList`, `reachesDir`, `globToRegExp`, `taskGlob`, `namesControlFile`, `CONTROL_PLANE_NAMES`, `inControlPlane`, `surfaceTask`, both reason texts, the precedence and the run-file shape stay as shipped. A task that declares one of the new paths escalates with the existing reason `task <id> declares <entry> inside the control-plane files`, and the owner's `approve plan` works as for any escalation.

### Boundary (how a file qualifies)

A file is added when the owner's next ordinary action (open the folder, commit, push, install, build) runs code that the file's content chooses, without the owner running that file on purpose. For a package manager, "chooses" also covers a lockfile that names where the code is fetched from, which is the reason BUG-081 gave for `package-lock.json`. Within that rule, this spec takes the conventional root locations of the mainstream tools in each family. Files that a git hook *calls* (a lint-staged or commitlint config, an ESLint config) are left out: they are inputs of the commands a hook runs, like any source file, and covering them would mean covering every tool's config.

### Entries per family

**Config-read hook runners (28).**

| Entries | Why |
|---|---|
| `.pre-commit-config.yaml` | pre-commit's config; each hook entry names a repository and a command run on commit. |
| `lefthook.yml`, `lefthook.yaml`, `lefthook.json`, `lefthook.toml`, `.lefthook.yml`, `.lefthook.yaml`, `.lefthook.json`, `.lefthook.toml`, `lefthook-local.yml`, `lefthook-local.yaml`, `lefthook-local.json`, `lefthook-local.toml`, `.lefthook-local.yml`, `.lefthook-local.yaml`, `.lefthook-local.json`, `.lefthook-local.toml` | lefthook's main and local config, in each name and format it reads; each names the commands its hooks run. |
| `.lefthook/**`, `.lefthook-local/**` | lefthook's default script directories; a script there runs as a hook. |
| `.overcommit.yml` | overcommit's config; it names the hooks and commands run on commit. |
| `.simple-git-hooks.json`, `.simple-git-hooks.js`, `.simple-git-hooks.cjs`, `.simple-git-hooks.mjs`, `simple-git-hooks.json`, `simple-git-hooks.js`, `simple-git-hooks.cjs`, `simple-git-hooks.mjs` | simple-git-hooks' config, in each name it reads; it maps each hook to a command, and the script forms are also code it loads. |

**Editor and container auto-run (6).**

| Entries | Why |
|---|---|
| `.vscode/**` | `tasks.json` folder-open tasks, and executables named in `settings.json`. The whole directory, like `.git/**`: the rest of it (`extensions.json`, `launch.json`) is rarely a plan's business, so the wider entry costs little. |
| `.idea/**`, `.zed/**` | JetBrains and Zed project configuration: run configurations, tasks, and tool and language-server paths. |
| `.devcontainer/**`, `.devcontainer.json` | The two locations the dev container tooling reads; `initializeCommand` runs on the host. |
| `.gitpod.yml` | Its `tasks` run when a workspace starts. |

**Other package managers (40).**

| Ecosystem | Entries |
|---|---|
| Yarn | `.yarnrc`, `.yarnrc.yml`, `yarn.lock`, `.yarn/**`, `.pnp.cjs`, `.pnp.loader.mjs` |
| pnpm | `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `.pnpmfile.cjs` |
| Bun | `bunfig.toml`, `bun.lock`, `bun.lockb` |
| Deno | `deno.json`, `deno.jsonc`, `deno.lock` |
| Python | `pyproject.toml`, `setup.py`, `setup.cfg`, `requirements.txt`, `pipfile`, `pipfile.lock`, `poetry.lock`, `poetry.toml`, `uv.lock`, `uv.toml`, `pdm.lock` |
| Ruby | `gemfile`, `gemfile.lock`, `gems.rb`, `gems.locked`, `.bundle/**` |
| PHP | `composer.json`, `composer.lock` |
| Rust | `cargo.toml`, `cargo.lock`, `.cargo/**`, `rust-toolchain`, `rust-toolchain.toml` |
| Go | `go.mod`, `go.work` |

pnpm also reads `.npmrc`, which BUG-081 already lists. `go.sum` and `go.work.sum` are left out: they hold only hashes, checked against Go's checksum database, so they cannot point at other code; a change that does (`replace`, `toolchain`) is in `go.mod` or `go.work`. Names are lower-case, like every entry, because `taskGlob` lower-cases the plan's entry (`Gemfile`, `Pipfile` and `Cargo.toml` match as `gemfile`, `pipfile` and `cargo.toml`).

**Other CI systems (19).**

`.gitlab-ci.yml`, `.circleci/**`, `azure-pipelines.yml`, `azure-pipelines.yaml`, `.travis.yml`, `jenkinsfile`, `bitbucket-pipelines.yml`, `.buildkite/**`, `.drone.yml`, `.woodpecker.yml`, `.woodpecker.yaml`, `.woodpecker/**`, `appveyor.yml`, `.appveyor.yml`, `.gitea/workflows/**`, `.forgejo/workflows/**`, `.cirrus.yml`, `.cirrus.star`, `.semaphore/**`. Gitea and Forgejo get their workflow directories only, like `.github/workflows/**`; the rest of `.gitea/` and `.forgejo/` (issue templates) runs nothing.

The totals are 28 + 6 + 40 + 19 = **93 entries**.

### Resulting list

`CONTROL_PLANE` keeps every BUG-080 and BUG-081 entry unchanged and in order, and gains, at its end, exactly these 93 entries in this order, each family under its own one-line comment:

```
// BUG-085: config-read git hook runners.
'.pre-commit-config.yaml',
'lefthook.yml', 'lefthook.yaml', 'lefthook.json', 'lefthook.toml', '.lefthook.yml', '.lefthook.yaml', '.lefthook.json', '.lefthook.toml',
'lefthook-local.yml', 'lefthook-local.yaml', 'lefthook-local.json', 'lefthook-local.toml',
'.lefthook-local.yml', '.lefthook-local.yaml', '.lefthook-local.json', '.lefthook-local.toml',
'.lefthook/**', '.lefthook-local/**', '.overcommit.yml',
'.simple-git-hooks.json', '.simple-git-hooks.js', '.simple-git-hooks.cjs', '.simple-git-hooks.mjs',
'simple-git-hooks.json', 'simple-git-hooks.js', 'simple-git-hooks.cjs', 'simple-git-hooks.mjs',
// BUG-085: editor and container auto-run configuration.
'.vscode/**', '.idea/**', '.zed/**', '.devcontainer/**', '.devcontainer.json', '.gitpod.yml',
// BUG-085: other package managers' manifests, lockfiles and config.
'.yarnrc', '.yarnrc.yml', 'yarn.lock', '.yarn/**', '.pnp.cjs', '.pnp.loader.mjs',
'pnpm-workspace.yaml', 'pnpm-lock.yaml', '.pnpmfile.cjs',
'bunfig.toml', 'bun.lock', 'bun.lockb',
'deno.json', 'deno.jsonc', 'deno.lock',
'pyproject.toml', 'setup.py', 'setup.cfg', 'requirements.txt', 'pipfile', 'pipfile.lock',
'poetry.lock', 'poetry.toml', 'uv.lock', 'uv.toml', 'pdm.lock',
'gemfile', 'gemfile.lock', 'gems.rb', 'gems.locked', '.bundle/**',
'composer.json', 'composer.lock',
'cargo.toml', 'cargo.lock', '.cargo/**', 'rust-toolchain', 'rust-toolchain.toml',
'go.mod', 'go.work',
// BUG-085: other CI systems' pipeline files.
'.gitlab-ci.yml', '.circleci/**', 'azure-pipelines.yml', 'azure-pipelines.yaml', '.travis.yml', 'jenkinsfile',
'bitbucket-pipelines.yml', '.buildkite/**', '.drone.yml', '.woodpecker.yml', '.woodpecker.yaml', '.woodpecker/**',
'appveyor.yml', '.appveyor.yml', '.gitea/workflows/**', '.forgejo/workflows/**', '.cirrus.yml', '.cirrus.star', '.semaphore/**',
```

Mirrors: none. `project-template/` holds none of these files and the installer deploys none of them, so no `project-template/` entry is added. In a host project the list applies to the host's own files, which is the point: a host's editor, hook-runner, package-manager and CI files run code exactly as they would here.

### Choices the entry leaves open, and the ones this spec takes

| Choice | Taken | Why |
|---|---|---|
| Where the rule lives | Fixed entries appended to `CONTROL_PLANE`, no logic change | Every file here is read at a fixed root location, which `CONTROL_PLANE`'s notation already expresses. The entry puts nested and workspace manifests out of scope, so `CONTROL_PLANE_NAMES` (any depth) is not extended. |
| Reason text | The existing `… inside the control-plane files` | Same family as BUG-081's files: they run code outside the run. BUG-081 already rejected a third list for one word of a message that names the triggering entry anyway. |
| Which tools in each family | The mainstream tools named under Problem, at their conventional root locations | The issue names families, not files. An open-ended list cannot be pinned; a fixed list can, and the pin test keeps every later addition a reviewed change. |
| Whole directory or single file | Whole directory where the tool reads a directory (`.vscode/**`, `.devcontainer/**`, `.yarn/**`, `.cargo/**`, `.circleci/**`, …); fixed files otherwise | Same reasoning as `.git/**` in BUG-081: a new file in such a directory is also read, and plans rarely write there. |
| Membership itself | Proposed here, decided by the owner | The list is a security-posture boundary (see Owner approval). |

## Behavior

### Main path

1. The unattended run reaches the plan approval; the `define-review` agent writes `.conductor/delegate/plan.md` with `VERDICT: APPROVE`.
2. `orchestrate.mjs delegate plan <doc> <hash>` parses the report (unchanged) and, for an `APPROVE`, runs `surfaceTask` over the plan text.
3. Task 2 declares `- Modify: \`.vscode/tasks.json\``. `inSurface` does not match; `reachesList` finds that the entry's first segment names `.vscode/**`.
4. The verb records `delegated.plan = { verdict: 'ESCALATE', reason: 'task Task 2 declares .vscode/tasks.json inside the control-plane files', at, review_sha256 }`, leaves `approvals.plan` null, prints `owner approval required: delegated review plan returned ESCALATE (<reason>); see .conductor/delegate/plan.md`, and exits 0.
5. The owner's `approve plan …` then approves it as in attended mode.

### Alternative paths

Every row below was measured against a copy of the shipped `globToRegExp`, `reachesDir`, `reachesList`, `taskGlob`, `inSurface`, `namesControlFile` and `inControlPlane` with the 93 entries appended.

- One literal per new entry escalates with the control-plane reason; for a `/**` entry the literal is a file inside it (`.vscode/x`, `.circleci/x`, …).
- Directory, glob, case and `./` forms escalate with the control-plane reason: `.vscode`, `.vscode/tasks.json`, `.vscode/settings.json`, `.vscode/tasks.*`, `.VSCode/Tasks.json`, `.idea/workspace.xml`, `.zed/tasks.json`, `.devcontainer`, `.devcontainer/devcontainer.json`, `.devcontainer/*.yml`, `./.devcontainer/devcontainer.json`, `.lefthook/pre-commit/a.sh`, `.Pre-Commit-Config.YAML`, `*.yaml`, `*.yml`, `*.lock`, `*.toml`, `*.py`, `*.cjs`, `setup.*`, `go.*`, `jenkins*`, `JENKINSFILE`, `Jenkinsfile`, `Cargo.TOML`, `Gemfile`, `Pipfile`, `.GitLab-CI.yml`, `./.gitlab-ci.yml`, `./yarn.lock`, `.yarn`, `.yarn/releases/yarn-4.cjs`, `.circleci`, `.circleci/config.yml`, `.circle*/config.yml`, `.gitea/workflows`, `.gitea/workflows/ci.yml`, `.gitea/*/ci.yml`, `.forgejo/workflows/ci.yml`, `.cargo/config.toml`, `.bundle/config`. Each of these approves today, measured.
- Near misses approve: `docs/.vscode/settings.json`, `.vscodex/a.json`, `vscode/settings.json`, `.devcontainerx/devcontainer.json`, `devcontainer.json`, `.idea.md`, `.gitlab/issue_templates/bug.md`, `gitlab-ci.yml`, `.gitlab-ci.yml.example`, `.travis.yml.bak`, `docs/jenkinsfile`, `.pre-commit-hooks.yaml` (a hook provider's manifest; it runs nothing in the repository that holds it), `lefthook.yml.example`, `.circlecix/config.yml`, `.gitea`, `.gitea/issue_template/bug.md`, `.forgejo`, `.yarnrc.yml.bak`, `cargo.toml.orig`, `go.sum`, `src/setup.py`, `src/go.mod`, `tools/yarn.lock`, `tools/cargo.toml`, `packages/a/pyproject.toml`. The last five are nested manifests, which the entry puts out of scope; their rows carry a comment saying so.
- Globs whose first segment can be `.conductor` keep the write-surface reason, because `inSurface` runs first: `*/tasks.json`, `.*/config.yml`, `**/yarn.lock`, `*/workflows/ci.yml`.
- Every approve row already in U43, U48, U51 and U53 still approves (measured, 46 rows), and the delegated-approval fixtures declare only `src/` and `tests/` files, so none of them starts escalating. The `pnpm-lock.yaml`, `yarn.lock`, `bun.lockb` and `go.mod` names in the stack-detection tests (`tests/scripts/orchestrate.test.js:521` onward) are files on disk, not plan entries, and are unaffected.
- `RETURN`, `ESCALATE`, `UNPARSED`, `delegate spec`, `delegate build`, attended runs and an owner `approve plan`: unchanged.

### Error cases

No new error codes and no new refusals. The change is data in a constant that the existing pure string-matching check reads; it cannot fail on its own. A plan with several matching tasks names the first one in plan order, as today (U45).

## Acceptance Criteria

The entry's scope is the four families; this spec's table is the decision of which files each family covers.

- [ ] AC1: `CONTROL_PLANE` equals the shipped list, unchanged and in order, followed by exactly the 93 entries under Resulting list, in that order, with no duplicate and every entry lower-case. The pin test at `tests/scripts/orchestrate.test.js:478` is updated to that exact array in the same commit and cites `[BUG-085]`.
- [ ] AC2: `delegate plan` over an `APPROVE` report escalates, records `verdict: 'ESCALATE'` with reason `task Task 2 declares <entry> inside the control-plane files`, leaves `approvals.plan === null`, and a following owner `approve plan` exits 0 (the U46 shape), for one row per new entry: the entry itself for a fixed entry, and `<dir>/x` for a `/**` entry.
- [ ] AC3: the same escalation with the control-plane reason for every directory, glob, case and `./` form listed under Alternative paths.
- [ ] AC4: a plan whose only non-source task declares one of the near misses listed under Alternative paths is approved by the delegated review (`plan approved by delegated review`, `approvals.plan.by === 'define-review'`). The `src/setup.py`, `src/go.mod`, `tools/yarn.lock`, `tools/cargo.toml` and `packages/a/pyproject.toml` rows carry a comment saying nested manifests are out of scope for `[BUG-085]`.
- [ ] AC5: `*/tasks.json`, `.*/config.yml`, `**/yarn.lock` and `*/workflows/ci.yml` escalate with the write-surface reason.
- [ ] AC6: `WRITE_SURFACE`, `CONTROL_PLANE_NAMES` and their pin tests are byte-identical; `inSurface`, `inControlPlane`, `namesControlFile`, `reachesList`, `reachesDir`, `globToRegExp` and `surfaceTask` are unchanged; every existing row U22 and U41-U54 stays green unchanged; the hook's `ORCH_WRITE_SURFACE` and Guards 5 and 6 are unchanged.
- [ ] AC7: `npm test` passes.

## Out of Scope

- **Nested and workspace manifests** of the new package managers (`tools/yarn.lock`, `packages/a/pyproject.toml`, …): the entry says they are tracked separately. Only npm's names are matched at any depth today (`CONTROL_PLANE_NAMES`, BUG-082).
- **Name patterns that `CONTROL_PLANE`'s notation cannot express**: `*.code-workspace` (VS Code workspace files hold settings and tasks), `requirements-*.txt`, `*.gemspec`, `Directory.Build.props` at any depth. A fixed entry names one file; a suffix or prefix rule is new logic, like BUG-082's, and needs its own item.
- **Build systems outside the families above** (Maven `.mvn/**`, the Gradle wrapper and build scripts, NuGet and MSBuild files): see Owner questions.
- **Files a hook or a tool calls rather than the hook runner itself**: lint-staged and commitlint configs, ESLint, Prettier and test-runner config modules. They are inputs of commands, like source files (see Boundary).
- **Files whose tool asks the owner after every change**: `.envrc` (direnv requires `direnv allow` again), `.nvim.lua` and `.exrc` (Neovim's `exrc` trust prompt), mise and asdf config with trust checks.
- **CI files reached only through an include** (a GitLab `include: local:` file outside `.gitlab-ci.yml`, a Jenkins shared library in the repository), and deploy-platform config (`netlify.toml`, `vercel.json`, `cloudbuild.yaml`): not standard paths; a candidate for a later item.
- **The rest of `.opencode/`** outside `.opencode/plugin/**`, which BUG-081 owner decision 7 also sent to a follow-up: the BUG-085 entry and issue #241 do not name it. See Owner questions.
- The reach rule, `inSurface`, `inControlPlane`, `namesControlFile`, `surfaceTask` and the reason texts; the hook files, Guards 5/6/7, the attended flow, `delegate spec` and `delegate build`.
- Records: the `README.md` Known-limits line for `[BUG-085]`, `CHANGELOG.md`, the backlog and the memory files are written at release.
- Any change under `.github/workflows/` or `.github/actions/`: this item only names CI paths in a constant; it writes no workflow.

## Owner approval

The list is a security-posture boundary, as it was for BUG-080 and BUG-081, and the plan's tasks declare `scripts/orchestrate.mjs`, which is itself in `CONTROL_PLANE`. So the spec and the plan need an owner approval, not a delegated one, and no `--unattended` run approves them. This document keeps its Draft status until then.

Open questions for the owner:

1. **Membership.** Accept the 93 entries as proposed; or trim them (for example to the JavaScript package managers only, or without `.idea/**` and `.zed/**`); or add more. Recommendation: accept as proposed.
2. **Other build systems.** Leave Maven, Gradle, NuGet and MSBuild files to a later item, or add their fixed root files here (`.mvn/**`, `gradle/wrapper/gradle-wrapper.properties`, `build.gradle`, `build.gradle.kts`, `settings.gradle`, `settings.gradle.kts`, `pom.xml`, `nuget.config`, `directory.build.props`, `directory.build.targets`). Recommendation: a later item, because the entry names package managers, and these are build tools whose build files are code, like `build.rs`, which this spec also leaves out.
3. **The rest of `.opencode/`.** Leave it to its own item, or add `.opencode/**` here. Recommendation: its own item, because the entry does not name it.

## System Impact

- `scripts/orchestrate.mjs`: 93 entries, four family comment lines and one `Owner decision (BUG-085)` comment line appended to `CONTROL_PLANE`. No logic change. The installer deploys this file to `.claude/scripts/`, so host projects get the fix on their next install; no installer change.
- `tests/scripts/orchestrate.test.js`: the `CONTROL_PLANE` pin (line 478) updated to the new array and renamed to cite `[BUG-085]`; new `it.each` blocks U55-U58 after U54 (line 3864) for AC2-AC5, reusing `atPlan`, `plan`, `task`, `delegateDoc`, `runFile`, `expectEscalation` and the U46 approve-path assertions.
- `.claude/commands/cc-orchestrate.md` and its `project-template/` mirror do not enumerate the escalating paths, so no text change.
- Unattended runs: a plan that edits any of the new files now needs the owner's approval.
- No hook, installer, settings or workflow file changes; no new dependency; no new network.

### Files Requiring Full Read (deferred to /cc-plan)

- `scripts/orchestrate.mjs`: this phase read its first 30 lines plus grep-located lines (27-46, 1055-1110: `globToRegExp` through `surfaceTask`). The plan reads the `CONTROL_PLANE` block in full to place the group and its comments.
- `tests/scripts/orchestrate.test.js`: the `CONTROL_PLANE` pin near line 478, `expectEscalation`, and the U46-U54 blocks (lines 3660-3870), for exact helper signatures and row placement.

## Complexity Estimate

S: 93 entries appended to one constant, one pin test updated, and table-driven rows added after an existing block; no logic change.
