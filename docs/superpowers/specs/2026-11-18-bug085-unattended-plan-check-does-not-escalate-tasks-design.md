# BUG-085: Unattended plan check does not escalate tasks that write config-read hook runners, editor and container auto-run files, other package managers or other CI systems

**Status:** Draft (pending independent review)

**Item:** `[BUG-085]` (intake of issue #241, follow-up to `[BUG-081]`). **Date:** 2026-11-18.

## Problem

In an unattended `/cc-orchestrate` run, `delegate plan` turns a delegated `APPROVE` into `ESCALATE` when a plan task's **Files:** entry reaches `WRITE_SURFACE` or the control plane (`surfaceTask` in `scripts/orchestrate.mjs`; FEAT-054, BUG-080, BUG-081, BUG-082, BUG-086). BUG-081 added the files that run code *outside* the run, after it ends, to `CONTROL_PLANE` (`scripts/orchestrate.mjs:27`): git hooks (`.git/**`, `.husky/**`, `.githooks/**`), MCP and OpenCode configuration, the status line, GitHub workflows and actions, and the npm manifests. BUG-082 made npm's manifest names reach it at any depth (`CONTROL_PLANE_NAMES`). BUG-081's owner decision 7 sent four families to one follow-up item, and this is that item:

- **Config-read hook runners.** Tools that install a git hook and then decide what it runs from a config file in the working tree: pre-commit (`.pre-commit-config.yaml`), lefthook (`lefthook.yml` and its variants, plus its script directories), overcommit (`.overcommit.yml`), simple-git-hooks, husky 4 (`.huskyrc` and its variants) and lint-staged (`.lintstagedrc` and its variants), whose config names the commands the pre-commit hook runs. Editing the config changes what runs on the owner's next `git commit` or `git push`, without touching `.git/`.
- **Editor and container auto-run configuration.** VS Code runs a task marked `runOn: folderOpen` from `.vscode/tasks.json` when the folder is opened, and `.vscode/settings.json` can name executables that extensions start. JetBrains (`.idea/`) and Zed (`.zed/`) keep run configurations, tasks and tool paths in the same way. A dev container's `initializeCommand` runs **on the host** before the container is built, and `postCreateCommand` and similar run inside it (`.devcontainer/**`, `.devcontainer.json`). Gitpod runs the `tasks` in `.gitpod.yml` when a workspace starts.
- **Other package managers and build systems.** Their manifests, lockfiles, config and build files pick the code that their next install, build or command runs: Yarn (`yarnPath` in `.yarnrc.yml`, plugins and releases under `.yarn/`, the PnP loader), pnpm (`.pnpmfile.cjs` hooks), Bun (`preload` in `bunfig.toml`), Deno, Python (`setup.py` runs on install, and `pyproject.toml` names the build backend), Ruby (Bundler), PHP (Composer `scripts` run on install), Rust (`.cargo/config.toml` sets runners and wrappers, the toolchain files pick the compiler, and `build.rs` runs on every build), Go (`replace` and `toolchain` in `go.mod`), Maven and Gradle (the wrappers download and run a distribution, and Gradle build scripts are code) and .NET (NuGet sources, the SDK pin, and MSBuild files imported into every project). The same files in a workspace member or nested project are read by the same tools, so they matter at any depth, as npm's do since BUG-082.
- **Other CI systems.** GitLab CI, CircleCI, Azure Pipelines, Travis CI, Jenkins, Bitbucket Pipelines, Buildkite, Drone, Woodpecker, AppVeyor, Gitea and Forgejo Actions, Cirrus CI and Semaphore read a pipeline file from the repository and run it with the project's CI secrets on the next push.

So a plan approved only by the delegated reviewer can leave persistent execution in place through any of these files, and in an unattended run the owner never sees that plan. The precondition is `--unattended`, which the owner opts into. Attended runs are unaffected, because the owner approves every plan.

## Solution

Two data changes in `scripts/orchestrate.mjs`, in the constants' existing notation (lower-case; a trailing `/**` protects a whole directory):

1. Append one group of fixed, root-relative entries to `CONTROL_PLANE`, after the BUG-081 group. A short comment line above each family says why it is there.
2. Append every fixed-file entry of the package-manager group (the build-system row included; no `/**` entry) to `CONTROL_PLANE_NAMES`, after its six shipped names and in the same order as in `CONTROL_PLANE`, so these files reach the control plane at any depth by their last segment, exactly as BUG-082's names do.

The comment block above `CONTROL_PLANE` gains one `Owner decision (BUG-085)` line, and a comment line directly above `CONTROL_PLANE_NAMES` records the decision to extend it (see Resulting list). Nothing else changes: `reachesList`, `reachesDir`, `globToRegExp`, `taskGlob`, `namesControlFile`, `inControlPlane`, `surfaceTask`, both reason texts, the precedence and the run-file shape stay as shipped. A task that declares one of the new paths escalates with the existing reason `task <id> declares <entry> inside the control-plane files`, and the owner's `approve plan` works as for any escalation.

### Boundary (how a file qualifies)

A file is added when the owner's next ordinary action (open the folder, commit, push, install, build) runs code that the file's content chooses, without the owner running that file on purpose. For a package manager, "chooses" also covers a lockfile that names where the code is fetched from, which is the reason BUG-081 gave for `package-lock.json`; for a build system it covers a build file that the build runs as code (`build.rs`, a Gradle script) and a wrapper that fetches and runs the tool. Within that rule, this spec takes the conventional locations of the mainstream tools in each family.

A tool that a hook calls is in when its config is what picks the commands the hook runs: lint-staged's config names the commands run on the staged files at every commit, so editing it changes what the next commit runs, as a hook runner's config does. The configs of the commands themselves (commitlint, ESLint, Prettier, test runners) stay out: they are inputs of the commands a hook runs, like any source file, and covering them would mean covering every tool's config.

Placement: the hook-runner, editor, container and CI entries are root-only, because those tools read them at the repository root. The package-manager and build-system fixed files also reach the control plane at any depth (`CONTROL_PLANE_NAMES`), because workspaces and nested projects are read by the same tools. Their `/**` directory entries (`.yarn/**`, `.bundle/**`, `.cargo/**`, `.mvn/**`, `gradle/**`) stay root-only: `CONTROL_PLANE_NAMES` matches a file's last segment, and none of these is a file name.

### Entries per family

**Config-read hook runners (46).**

| Entries | Why |
|---|---|
| `.pre-commit-config.yaml` | pre-commit's config; each hook entry names a repository and a command run on commit. |
| `lefthook.yml`, `lefthook.yaml`, `lefthook.json`, `lefthook.toml`, `.lefthook.yml`, `.lefthook.yaml`, `.lefthook.json`, `.lefthook.toml`, `lefthook-local.yml`, `lefthook-local.yaml`, `lefthook-local.json`, `lefthook-local.toml`, `.lefthook-local.yml`, `.lefthook-local.yaml`, `.lefthook-local.json`, `.lefthook-local.toml` | lefthook's main and local config, in each name and format it reads; each names the commands its hooks run. |
| `.lefthook/**`, `.lefthook-local/**` | lefthook's default script directories; a script there runs as a hook. |
| `.overcommit.yml` | overcommit's config; it names the hooks and commands run on commit. |
| `.simple-git-hooks.json`, `.simple-git-hooks.js`, `.simple-git-hooks.cjs`, `.simple-git-hooks.mjs`, `simple-git-hooks.json`, `simple-git-hooks.js`, `simple-git-hooks.cjs`, `simple-git-hooks.mjs` | simple-git-hooks' config, in each name it reads; it maps each hook to a command, and the script forms are also code it loads. |
| `.huskyrc`, `.huskyrc.json`, `.huskyrc.yaml`, `.huskyrc.yml`, `.huskyrc.js`, `.huskyrc.cjs`, `husky.config.js`, `husky.config.cjs` | husky 4's config, in each name it reads; it maps each hook to a command, read on every hook run. |
| `.lintstagedrc`, `.lintstagedrc.json`, `.lintstagedrc.yaml`, `.lintstagedrc.yml`, `.lintstagedrc.js`, `.lintstagedrc.cjs`, `.lintstagedrc.mjs`, `lint-staged.config.js`, `lint-staged.config.cjs`, `lint-staged.config.mjs` | lint-staged's config, in each name it reads; it names the commands the pre-commit hook runs (see Boundary). |

**Editor and container auto-run (6).**

| Entries | Why |
|---|---|
| `.vscode/**` | `tasks.json` folder-open tasks, and executables named in `settings.json`. The whole directory, like `.git/**`: the rest of it (`extensions.json`, `launch.json`) is rarely a plan's business, so the wider entry costs little. |
| `.idea/**`, `.zed/**` | JetBrains and Zed project configuration: run configurations, tasks, and tool and language-server paths. |
| `.devcontainer/**`, `.devcontainer.json` | The two locations the dev container tooling reads; `initializeCommand` runs on the host. |
| `.gitpod.yml` | Its `tasks` run when a workspace starts. |

**Other package managers and build systems (59).**

| Ecosystem | Entries |
|---|---|
| Yarn | `.yarnrc`, `.yarnrc.yml`, `yarn.lock`, `.yarn/**`, `.pnp.cjs`, `.pnp.loader.mjs` |
| pnpm | `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `.pnpmfile.cjs` |
| Bun | `bunfig.toml`, `bun.lock`, `bun.lockb` |
| Deno | `deno.json`, `deno.jsonc`, `deno.lock` |
| Python | `pyproject.toml`, `setup.py`, `setup.cfg`, `requirements.txt`, `pipfile`, `pipfile.lock`, `poetry.lock`, `poetry.toml`, `uv.lock`, `uv.toml`, `pdm.lock` |
| Ruby | `gemfile`, `gemfile.lock`, `gems.rb`, `gems.locked`, `.bundle/**` |
| PHP | `composer.json`, `composer.lock` |
| Rust | `cargo.toml`, `cargo.lock`, `.cargo/**`, `rust-toolchain`, `rust-toolchain.toml`, `build.rs` |
| Go | `go.mod`, `go.work` |
| Build systems (Maven, Gradle, NuGet, MSBuild) | `.mvn/**`, `mvnw`, `mvnw.cmd`, `pom.xml`, `gradle/**`, `gradlew`, `gradlew.bat`, `gradle.properties`, `build.gradle`, `build.gradle.kts`, `settings.gradle`, `settings.gradle.kts`, `nuget.config`, `packages.lock.json`, `global.json`, `directory.build.props`, `directory.build.targets`, `directory.packages.props` |

pnpm also reads `.npmrc`, which BUG-081 already lists. `go.sum` and `go.work.sum` are left out: they hold only hashes, checked against Go's checksum database, so they cannot point at other code; a change that does (`replace`, `toolchain`) is in `go.mod` or `go.work`. Names are lower-case, like every entry, because `taskGlob` lower-cases the plan's entry (`Gemfile`, `Pipfile`, `Cargo.toml` and `Directory.Build.props` match as `gemfile`, `pipfile`, `cargo.toml` and `directory.build.props`).

Of these 59, the 54 fixed files (all but `.yarn/**`, `.bundle/**`, `.cargo/**`, `.mvn/**` and `gradle/**`) also join `CONTROL_PLANE_NAMES`.

**Other CI systems (19).**

`.gitlab-ci.yml`, `.circleci/**`, `azure-pipelines.yml`, `azure-pipelines.yaml`, `.travis.yml`, `jenkinsfile`, `bitbucket-pipelines.yml`, `.buildkite/**`, `.drone.yml`, `.woodpecker.yml`, `.woodpecker.yaml`, `.woodpecker/**`, `appveyor.yml`, `.appveyor.yml`, `.gitea/workflows/**`, `.forgejo/workflows/**`, `.cirrus.yml`, `.cirrus.star`, `.semaphore/**`. Gitea and Forgejo get their workflow directories only, like `.github/workflows/**`; the rest of `.gitea/` and `.forgejo/` (issue templates) runs nothing.

The totals are 46 + 6 + 59 + 19 = **130 entries** appended to `CONTROL_PLANE` (42 shipped + 130 = 172), and **54 names** appended to `CONTROL_PLANE_NAMES` (6 shipped + 54 = 60).

### Resulting list

`CONTROL_PLANE` keeps every BUG-080 and BUG-081 entry unchanged and in order, and gains, at its end, exactly these 130 entries in this order, each family under its own one-line comment:

```
// BUG-085: config-read git hook runners.
'.pre-commit-config.yaml',
'lefthook.yml', 'lefthook.yaml', 'lefthook.json', 'lefthook.toml', '.lefthook.yml', '.lefthook.yaml', '.lefthook.json', '.lefthook.toml',
'lefthook-local.yml', 'lefthook-local.yaml', 'lefthook-local.json', 'lefthook-local.toml',
'.lefthook-local.yml', '.lefthook-local.yaml', '.lefthook-local.json', '.lefthook-local.toml',
'.lefthook/**', '.lefthook-local/**', '.overcommit.yml',
'.simple-git-hooks.json', '.simple-git-hooks.js', '.simple-git-hooks.cjs', '.simple-git-hooks.mjs',
'simple-git-hooks.json', 'simple-git-hooks.js', 'simple-git-hooks.cjs', 'simple-git-hooks.mjs',
'.huskyrc', '.huskyrc.json', '.huskyrc.yaml', '.huskyrc.yml', '.huskyrc.js', '.huskyrc.cjs', 'husky.config.js', 'husky.config.cjs',
'.lintstagedrc', '.lintstagedrc.json', '.lintstagedrc.yaml', '.lintstagedrc.yml', '.lintstagedrc.js', '.lintstagedrc.cjs', '.lintstagedrc.mjs',
'lint-staged.config.js', 'lint-staged.config.cjs', 'lint-staged.config.mjs',
// BUG-085: editor and container auto-run configuration.
'.vscode/**', '.idea/**', '.zed/**', '.devcontainer/**', '.devcontainer.json', '.gitpod.yml',
// BUG-085: other package managers' and build systems' manifests, lockfiles, config and build files.
'.yarnrc', '.yarnrc.yml', 'yarn.lock', '.yarn/**', '.pnp.cjs', '.pnp.loader.mjs',
'pnpm-workspace.yaml', 'pnpm-lock.yaml', '.pnpmfile.cjs',
'bunfig.toml', 'bun.lock', 'bun.lockb',
'deno.json', 'deno.jsonc', 'deno.lock',
'pyproject.toml', 'setup.py', 'setup.cfg', 'requirements.txt', 'pipfile', 'pipfile.lock',
'poetry.lock', 'poetry.toml', 'uv.lock', 'uv.toml', 'pdm.lock',
'gemfile', 'gemfile.lock', 'gems.rb', 'gems.locked', '.bundle/**',
'composer.json', 'composer.lock',
'cargo.toml', 'cargo.lock', '.cargo/**', 'rust-toolchain', 'rust-toolchain.toml', 'build.rs',
'go.mod', 'go.work',
'.mvn/**', 'mvnw', 'mvnw.cmd', 'pom.xml', 'gradle/**', 'gradlew', 'gradlew.bat', 'gradle.properties',
'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts',
'nuget.config', 'packages.lock.json', 'global.json', 'directory.build.props', 'directory.build.targets', 'directory.packages.props',
// BUG-085: other CI systems' pipeline files.
'.gitlab-ci.yml', '.circleci/**', 'azure-pipelines.yml', 'azure-pipelines.yaml', '.travis.yml', 'jenkinsfile',
'bitbucket-pipelines.yml', '.buildkite/**', '.drone.yml', '.woodpecker.yml', '.woodpecker.yaml', '.woodpecker/**',
'appveyor.yml', '.appveyor.yml', '.gitea/workflows/**', '.forgejo/workflows/**', '.cirrus.yml', '.cirrus.star', '.semaphore/**',
```

`CONTROL_PLANE_NAMES` becomes exactly these 60 names, in this order (the six shipped names, then the 54 fixed package-manager and build-system files in `CONTROL_PLANE` order), with this comment line directly above it:

```
// Owner decision (BUG-085): the other package managers' and build systems' fixed files also reach it at any depth, like npm's.
export const CONTROL_PLANE_NAMES = [
  'claude.md', 'claude.local.md', 'package.json', 'package-lock.json', 'npm-shrinkwrap.json', '.npmrc',
  '.yarnrc', '.yarnrc.yml', 'yarn.lock', '.pnp.cjs', '.pnp.loader.mjs',
  'pnpm-workspace.yaml', 'pnpm-lock.yaml', '.pnpmfile.cjs',
  'bunfig.toml', 'bun.lock', 'bun.lockb',
  'deno.json', 'deno.jsonc', 'deno.lock',
  'pyproject.toml', 'setup.py', 'setup.cfg', 'requirements.txt', 'pipfile', 'pipfile.lock',
  'poetry.lock', 'poetry.toml', 'uv.lock', 'uv.toml', 'pdm.lock',
  'gemfile', 'gemfile.lock', 'gems.rb', 'gems.locked',
  'composer.json', 'composer.lock',
  'cargo.toml', 'cargo.lock', 'rust-toolchain', 'rust-toolchain.toml', 'build.rs',
  'go.mod', 'go.work',
  'mvnw', 'mvnw.cmd', 'pom.xml', 'gradlew', 'gradlew.bat', 'gradle.properties',
  'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts',
  'nuget.config', 'packages.lock.json', 'global.json', 'directory.build.props', 'directory.build.targets', 'directory.packages.props',
];
```

The `Owner decision (BUG-085)` line above `CONTROL_PLANE` reads: `// Owner decision (BUG-085): also the config-read hook runners, editor and container auto-run files, other package managers, build systems and CI systems.`

Mirrors: none. `project-template/` holds none of these files and the installer deploys none of them, so no `project-template/` entry is added. In a host project the lists apply to the host's own files, which is the point: a host's editor, hook-runner, package-manager, build and CI files run code exactly as they would here.

### Choices the entry leaves open, and the ones this spec takes

| Choice | Taken | Why |
|---|---|---|
| Where the rule lives | Fixed entries appended to `CONTROL_PLANE` and fixed names appended to `CONTROL_PLANE_NAMES`, no logic change | Every file here is read at a fixed root location, which `CONTROL_PLANE`'s notation already expresses; the package-manager and build-system files are also read at any depth, which `CONTROL_PLANE_NAMES` already expresses (owner decision). |
| Reason text | The existing `… inside the control-plane files` | Same family as BUG-081's files: they run code outside the run. BUG-081 already rejected a third list for one word of a message that names the triggering entry anyway. |
| Which tools in each family | The mainstream tools named under Problem, at their conventional locations | The issue names families, not files. An open-ended list cannot be pinned; a fixed list can, and the pin tests keep every later addition a reviewed change. |
| Whole directory or single file | Whole directory where the tool reads a directory (`.vscode/**`, `.devcontainer/**`, `.yarn/**`, `.cargo/**`, `.mvn/**`, `gradle/**`, `.circleci/**`, …); fixed files otherwise | Same reasoning as `.git/**` in BUG-081: a new file in such a directory is also read, and plans rarely write there. |
| Membership itself | Decided by the owner (see Owner decisions) | The lists are a security-posture boundary. |

## Owner decisions

These were open in the first draft and are now decided:

1. **Membership.** The proposed 93 entries are accepted, with three additions: husky 4's eight config names and lint-staged's ten config names join the hook-runner group, and `build.rs` joins the Rust row. The Boundary moves lint-staged in; commitlint, ESLint and Prettier configs stay out.
2. **Other build systems.** Added here, as a build-system row in the package-manager group: `.mvn/**`, `mvnw`, `mvnw.cmd`, `pom.xml`, `gradle/**`, `gradlew`, `gradlew.bat`, `gradle.properties`, `build.gradle`, `build.gradle.kts`, `settings.gradle`, `settings.gradle.kts`, `nuget.config`, `packages.lock.json`, `global.json`, `directory.build.props`, `directory.build.targets`, `directory.packages.props`.
3. **The rest of `.opencode/`.** Its own item; `.opencode/**` outside `.opencode/plugin/**` stays out of this spec.
4. **Nested and workspace manifests are in scope**, because BUG-082 covered only npm's names. Every fixed-file entry of the package-manager and build-system groups (no `/**` entry) also joins `CONTROL_PLANE_NAMES` after the six shipped names, in the same order. The `CONTROL_PLANE_NAMES` pin is updated in the same commit and cites `[BUG-085]`, AC6 no longer lists `CONTROL_PLANE_NAMES` and its pin as byte-identical, and the comment above the constant records the decision.
5. **Tests.** `src/setup.py`, `src/go.mod`, `tools/yarn.lock`, `tools/cargo.toml` and `packages/a/pyproject.toml` move from near misses to escalation rows, together with `crates/a/build.rs`, `app/pom.xml`, `modules/a/build.gradle.kts`, `src/a/packages.lock.json`, `src/**/*.py`, `lib/**/*.rb` and `src/**/*.rs`. The near misses gain `docs/setup.py.md`, `src/cargo.toml.orig`, `src/go.sum`, `docs/requirements-dev.txt`, `src/pom.xml.bak` and `src/xbuild.rs`. Every approve row in U43, U48, U51 and U53 is re-measured, and any that now escalates moves (see Alternative paths: none does).
6. **Separate items.** Each of these stays out of this spec as its own unnumbered issue: `.opencode/**` outside `plugin/**`; a name-pattern rule (`*.code-workspace`, `requirements-*.txt`, `*.gemspec`, `*.csproj`); CI files reached through an include; deploy-platform config. `Makefile`, `justfile` and `Taskfile.yml` stay out because the owner runs them on purpose.
7. **Approval.** The spec and the plan each take an owner approval, and no delegated verdict approves either.
8. Everything else stands as first proposed: root-only placement for the hook-runner, editor, container and CI entries, the unchanged reason text, and the new rows as U55-U58 after U54.

## Behavior

### Main path

1. The unattended run reaches the plan approval; the `define-review` agent writes `.conductor/delegate/plan.md` with `VERDICT: APPROVE`.
2. `orchestrate.mjs delegate plan <doc> <hash>` parses the report (unchanged) and, for an `APPROVE`, runs `surfaceTask` over the plan text.
3. Task 2 declares `- Modify: \`.vscode/tasks.json\``. `inSurface` does not match; `reachesList` finds that the entry's first segment names `.vscode/**`.
4. The verb records `delegated.plan = { verdict: 'ESCALATE', reason: 'task Task 2 declares .vscode/tasks.json inside the control-plane files', at, review_sha256 }`, leaves `approvals.plan` null, prints `owner approval required: delegated review plan returned ESCALATE (<reason>); see .conductor/delegate/plan.md`, and exits 0.
5. The owner's `approve plan …` then approves it as in attended mode.

A nested manifest takes the same path through `namesControlFile`: Task 2 declares `packages/a/pyproject.toml`, `reachesList` does not match, and its last segment `pyproject.toml` is in `CONTROL_PLANE_NAMES`.

### Alternative paths

Every row below was measured against a copy of the shipped `globToRegExp`, `reachesDir`, `reachesList`, `taskGlob`, `inSurface`, `namesControlFile` and `inControlPlane` with both arrays exactly as under Resulting list; every escalation row was also measured against the shipped arrays, where each one approves today (except the write-surface rows, which escalate today with the same reason).

- One literal per new `CONTROL_PLANE` entry escalates with the control-plane reason (130 rows); for a `/**` entry the literal is a file inside it (`.vscode/x`, `.mvn/x`, `gradle/x`, `.circleci/x`, …).
- Directory, glob, case and `./` forms escalate with the control-plane reason: `.vscode`, `.vscode/tasks.json`, `.vscode/settings.json`, `.vscode/tasks.*`, `.VSCode/Tasks.json`, `.idea/workspace.xml`, `.zed/tasks.json`, `.devcontainer`, `.devcontainer/devcontainer.json`, `.devcontainer/*.yml`, `./.devcontainer/devcontainer.json`, `.lefthook/pre-commit/a.sh`, `.Pre-Commit-Config.YAML`, `./.huskyrc`, `.LintStagedRC`, `Lint-Staged.Config.mjs`, `*.yaml`, `*.yml`, `*.lock`, `*.toml`, `*.py`, `*.cjs`, `setup.*`, `go.*`, `jenkins*`, `JENKINSFILE`, `Jenkinsfile`, `Cargo.TOML`, `Gemfile`, `Pipfile`, `Build.RS`, `POM.xml`, `Directory.Build.props`, `NuGet.Config`, `.GitLab-CI.yml`, `./.gitlab-ci.yml`, `./yarn.lock`, `.yarn`, `.yarn/releases/yarn-4.cjs`, `.mvn`, `.mvn/wrapper/maven-wrapper.properties`, `gradle`, `gradle/wrapper/gradle-wrapper.properties`, `.circleci`, `.circleci/config.yml`, `.circle*/config.yml`, `.gitea/workflows`, `.gitea/workflows/ci.yml`, `.gitea/*/ci.yml`, `.forgejo/workflows/ci.yml`, `.cargo/config.toml`, `.bundle/config`.
- Nested and workspace manifests escalate with the control-plane reason, through `CONTROL_PLANE_NAMES`: `src/setup.py`, `src/go.mod`, `tools/yarn.lock`, `tools/cargo.toml`, `packages/a/pyproject.toml`, `crates/a/build.rs`, `app/pom.xml`, `modules/a/build.gradle.kts`, `src/a/packages.lock.json`, `src/**/*.py`, `lib/**/*.rb`, `src/**/*.rs`, `src/Cargo.toml`, `Packages/A/PyProject.TOML`, `./src/setup.py`, `src/**/pom.xml`, `src/*/build.rs`. The first five were near misses in the first draft.
- Near misses approve: `docs/.vscode/settings.json`, `src/.vscode/tasks.json`, `.vscodex/a.json`, `vscode/settings.json`, `.devcontainerx/devcontainer.json`, `devcontainer.json`, `.idea.md`, `.gitlab/issue_templates/bug.md`, `gitlab-ci.yml`, `.gitlab-ci.yml.example`, `docs/.gitlab-ci.yml`, `.travis.yml.bak`, `docs/jenkinsfile`, `.pre-commit-hooks.yaml` (a hook provider's manifest; it runs nothing in the repository that holds it), `docs/.pre-commit-config.yaml`, `lefthook.yml.example`, `docs/.huskyrc`, `docs/.lintstagedrc`, `.commitlintrc.json`, `commitlint.config.js`, `.eslintrc.json`, `eslint.config.js`, `.prettierrc`, `.circlecix/config.yml`, `.gitea`, `.gitea/issue_template/bug.md`, `.forgejo`, `.yarnrc.yml.bak`, `cargo.toml.orig`, `go.sum`, `docs/setup.py.md`, `src/cargo.toml.orig`, `src/go.sum`, `docs/requirements-dev.txt`, `src/pom.xml.bak`, `src/xbuild.rs`, `.mvnx/x`, `gradlex/x`, `src/**/x.py`, `makefile`, `justfile`, `taskfile.yml`.
- Globs whose first segment can be `.conductor` keep the write-surface reason, because `inSurface` runs first: `*/tasks.json`, `.*/config.yml`, `**/yarn.lock`, `*/workflows/ci.yml`, `**/go.mod`, `**/build.rs`, `**/pom.xml`.
- Re-measured: every approve row already in U43 (8 rows), U48 (16), U51 (4) and U53 (15), 43 rows in all, still approves against both new arrays, so none moves. (The first draft said 46; the blocks hold 43.) The delegated-approval fixtures declare only `src/` and `tests/` JavaScript files and docs, so none of them starts escalating. The `pnpm-lock.yaml`, `yarn.lock`, `bun.lockb` and `go.mod` names in the stack-detection tests (`tests/scripts/orchestrate.test.js:521` onward) are files on disk, not plan entries, and are unaffected.
- `RETURN`, `ESCALATE`, `UNPARSED`, `delegate spec`, `delegate build`, attended runs and an owner `approve plan`: unchanged.

### Error cases

No new error codes and no new refusals. The change is data in two constants that the existing pure string-matching check reads; it cannot fail on its own. A plan with several matching tasks names the first one in plan order, as today (U45).

## Acceptance Criteria

The entry's scope is the four families; the owner decisions above settle which files each family covers and where they are matched.

- [ ] AC1: `CONTROL_PLANE` equals the shipped list, unchanged and in order, followed by exactly the 130 entries under Resulting list, in that order, with no duplicate and every entry lower-case. The pin test at `tests/scripts/orchestrate.test.js:478` is updated to that exact array in the same commit and cites `[BUG-085]`.
- [ ] AC2: `CONTROL_PLANE_NAMES` equals exactly the 60 names under Resulting list, in that order, with no duplicate and every name lower-case; each name after the sixth is a fixed (no `/**`) entry of the package-manager group in `CONTROL_PLANE`, in `CONTROL_PLANE` order. The pin test at `tests/scripts/orchestrate.test.js:498` is updated to that exact array in the same commit and cites `[BUG-085]`. The comment lines above `CONTROL_PLANE` and `CONTROL_PLANE_NAMES` are as under Resulting list.
- [ ] AC3: `delegate plan` over an `APPROVE` report escalates, records `verdict: 'ESCALATE'` with reason `task Task 2 declares <entry> inside the control-plane files`, leaves `approvals.plan === null`, and a following owner `approve plan` exits 0 (the U46 shape), for one row per new `CONTROL_PLANE` entry: the entry itself for a fixed entry, and `<dir>/x` for a `/**` entry.
- [ ] AC4: the same escalation with the control-plane reason for every directory, glob, case and `./` form, and every nested or workspace manifest, listed under Alternative paths.
- [ ] AC5: a plan whose only non-source task declares one of the near misses listed under Alternative paths is approved by the delegated review (`plan approved by delegated review`, `approvals.plan.by === 'define-review'`).
- [ ] AC6: `*/tasks.json`, `.*/config.yml`, `**/yarn.lock`, `*/workflows/ci.yml`, `**/go.mod`, `**/build.rs` and `**/pom.xml` escalate with the write-surface reason.
- [ ] AC7: `WRITE_SURFACE` and its pin test are byte-identical; `inSurface`, `inControlPlane`, `namesControlFile`, `reachesList`, `reachesDir`, `globToRegExp` and `surfaceTask` are unchanged; every existing row U22 and U41-U54 stays green unchanged; the hook's `ORCH_WRITE_SURFACE` and Guards 5 and 6 are unchanged.
- [ ] AC8: `npm test` passes.

The new rows are `it.each` blocks U55-U58 after U54: U55 for AC3, U56 for AC4, U57 for AC5 and U58 for AC6.

## Out of Scope

Each of the first four is its own issue, to be opened separately:

- **The rest of `.opencode/`** outside `.opencode/plugin/**`, which BUG-081 owner decision 7 also sent to a follow-up.
- **A name-pattern rule** for files that neither notation can express: `*.code-workspace` (VS Code workspace files hold settings and tasks), `requirements-*.txt`, `*.gemspec`, `*.csproj`. A fixed entry or name matches one file name; a suffix or prefix rule is new logic.
- **CI files reached only through an include** (a GitLab `include: local:` file outside `.gitlab-ci.yml`, a Jenkins shared library in the repository).
- **Deploy-platform config** (`netlify.toml`, `vercel.json`, `cloudbuild.yaml`).
- **`Makefile`, `justfile` and `Taskfile.yml`**, which the owner runs on purpose.
- **Files a hook calls that do not pick the hook's commands**: commitlint configs, ESLint, Prettier and test-runner config modules. They are inputs of commands, like source files (see Boundary).
- **Files whose tool asks the owner after every change**: `.envrc` (direnv requires `direnv allow` again), `.nvim.lua` and `.exrc` (Neovim's `exrc` trust prompt), mise and asdf config with trust checks.
- **Nested hook-runner, editor, container and CI files** (`docs/.huskyrc`, `src/.vscode/tasks.json`, `docs/.gitlab-ci.yml`): those tools read them at the root, so they stay near misses.
- The reach rule, `inSurface`, `inControlPlane`, `namesControlFile`, `surfaceTask` and the reason texts; the hook files, Guards 5/6/7, the attended flow, `delegate spec` and `delegate build`.
- Records: the `README.md` Known-limits line for `[BUG-085]`, `CHANGELOG.md`, the backlog and the memory files are written at release.
- Any change under `.github/workflows/` or `.github/actions/`: this item only names CI paths in a constant; it writes no workflow.

## Owner approval

The lists are a security-posture boundary, as they were for BUG-080, BUG-081 and BUG-082, and the plan's tasks declare `scripts/orchestrate.mjs`, which is itself in `CONTROL_PLANE`. So the spec and the plan need an owner approval, not a delegated one: each takes an owner approval, no delegated verdict approves either, and no `--unattended` run approves them. This document keeps its Draft status until then.

## System Impact

- `scripts/orchestrate.mjs`: 130 entries, four family comment lines and one `Owner decision (BUG-085)` comment line appended to `CONTROL_PLANE`; 54 names and one comment line added to `CONTROL_PLANE_NAMES`. No logic change. The installer deploys this file to `.claude/scripts/`, so host projects get the fix on their next install; no installer change.
- `tests/scripts/orchestrate.test.js`: both pins (lines 478 and 498) updated to the new arrays and renamed to cite `[BUG-085]`; new `it.each` blocks U55-U58 after U54 (line 3864), reusing `atPlan`, `plan`, `task`, `delegateDoc`, `runFile`, `expectEscalation` and the U46 approve-path assertions.
- `.claude/commands/cc-orchestrate.md` and its `project-template/` mirror do not enumerate the escalating paths, so no text change.
- Unattended runs: a plan that edits any of the new files, at the root or (for the package-manager and build-system files) at any depth, now needs the owner's approval. A plan glob that can name one of the new names at any depth also escalates: `src/**/*.py` names `setup.py`, `lib/**/*.rb` names `gems.rb`, `src/**/*.rs` names `build.rs`, and a nested `global.json` or `requirements.txt` escalates even when it is not the tool's file. That is the cost the owner accepted for covering nested manifests; the owner's `approve plan` clears it.
- No hook, installer, settings or workflow file changes; no new dependency; no new network.

### Files Requiring Full Read (deferred to /cc-plan)

- `scripts/orchestrate.mjs`: this phase read lines 1-80 and 1040-1125 (`globToRegExp` through `surfaceTask`). The plan reads the `CONTROL_PLANE` and `CONTROL_PLANE_NAMES` block in full to place the groups and comments.
- `tests/scripts/orchestrate.test.js`: the two pins near lines 478 and 498, `expectEscalation`, and the U46-U54 blocks (lines 3660-3870), for exact helper signatures and row placement.

## Complexity Estimate

S: 130 entries appended to one constant and 54 names to another, two pin tests updated, and table-driven rows added after an existing block; no logic change.
