# CODE-CONDUCTOR MASTER AGENT-READABLE BACKLOG

This document is the single source of truth for the evolutionary engineering of Code Conductor. The AI agent must read this file at the start of each session to pick pending tasks and update their status autonomously by marking checkboxes `[X]` upon successful, tested implementation.

---

## PILLAR 1: CONTEXT REDUCTION AND TOKEN OPTIMIZATION

### [X] `[BUG-001]` Context Overflow via Superpowers Redundancy
* **Description:** Each execution cycle of Superpowers skills (brainstorming, plan writing) acts as a closed loop that continuously accumulates previous chat history and re-injects heavy instructions. Context consumption grows at an exponential rate O(N^2).
* **Impact:** Exhausts the Claude Pro context window token quota within less than an hour of continuous technical development.
* **Components Affected:** Orchestrator runtime, core prompt injection cycles.
* **Acceptance Criteria:** Isolate chat history per sub-task phase and ensure instructions are cached or injected once instead of being appended repeatedly per turn.

### [X] `[BUG-002]` Lack of Context Pruning in Specification Phase
* **Description:** The agent reads full source code files from the repository during the initial analysis phase even when it does not yet need to alter them, saturating the prompt buffer with static base code.
* **Impact:** High waste of input tokens during the early requirement gathering and architecture scoping phases.
* **Components Affected:** Context gathering middleware, file scanning system.
* **Acceptance Criteria:** Force the agent to read only file maps, structural interfaces, or export definitions during the specification stage, postponing full file reads until implementation.

### [X] `[BUG-003]` Inefficient Plan State Persistence
* **Description:** The agent continuously edits and re-processes the entire `plan.md` or `spec.md` files on disk. For extensive plans, every minor checklist change forces the LLM to re-read and re-write thousands of redundant tokens.
* **Impact:** Skyrocketing output token costs and redundant input re-processing overhead.
* **Components Affected:** State persistence modules, markdown generation engine.
* **Acceptance Criteria:** Move active step execution tracking away from monolithic markdown processing and synchronize execution states dynamically through precise block updates or atomic status flags.

### [X] `[BUG-004]` System Prompt Base Overhead in Superpowers
* **Description:** Injection of highly dense, text-heavy system instructions on every single turn of the conversation to enforce agent behavior, charging a costly base token fee even for single-word or short answers.
* **Impact:** Drastically reduces the amount of useful context space available for code logic within the session.
* **Components Affected:** Core prompt manager templates.
* **Acceptance Criteria:** Streamline and compact the global system prompt, moving static rule constraints to dedicated local reference files that the agent only reads when needed.

### [X] `[BUG-006]` Loose Read-Tool Filtering Restrictions
* **Description:** Superpowers grants unrestricted access to native Claude Code tools that read entire directory trees without precise scoping, allowing megabytes of non-essential data into the session.
* **Impact:** Increases LLM noise, degrades attention mechanisms, and leads to code hallucinations.
* **Components Affected:** File system access hooks, read tool configuration.
* **Acceptance Criteria:** Restrict directory scans to return strictly path lists and metadata, blocking raw mass content dumps unless explicitly verified by an internal path whitelist.

### [X] `[FEAT-007]` Rolling Context Window (Context Compactor)
* **Description:** Implement an orchestrator middleware that tracks the active message buffer size. Upon reaching a specific token threshold, it invokes a sub-process to generate a dense, consolidated snapshot (storing metadata, completed actions, and immediate pending steps), clears the active session chat history, and injects the snapshot as the new clean starting point.
* **Impact:** Protects the absolute context limit, eliminates the "Lost in the Middle" attention degradation, and maximizes Prompt Caching savings up to 90% on intermediate turns.
* **Components Affected:** Buffer monitoring layer, snapshot generation logic.
* **Acceptance Criteria:** Automatically trigger context compaction when hitting 75% of the model window limit, ensuring the agent retains functional memory without carrying dead conversational weight.

### [X] `[FEAT-010]` Dense Prompt Protocol Standard
* **Description:** Design a high-density, low-overhead data exchange format (such as minified JSON, custom symbols, or compact Key-Value syntaxes) used specifically for communication between the compression middleware and the core LLM brain.
* **Impact:** Minimizes token consumption without causing any loss in architectural precision or code quality during agent handoffs.
* **Components Affected:** Serialization utilities, agent communication layer.
* **Acceptance Criteria:** Achieve a minimum 30% character reduction compared to standard conversational markdown descriptions while retaining a 100% success rate on code generation tests.

### [X] `[BUG-014]` Ignorance of the Verbosity Level (Verbosity Dilution)
* **Description:** The agent tends to neglect configured verbosity constraints (MIN, INFO, VERBOSE) over extended development sessions due to instructions fading from context.
* **Impact:** Waste of output tokens on redundant text conversational fluff when minimal code-only changes are requested.
* **Components Affected:** `skills/verbosity.md`, `global/memory/`
* **Acceptance Criteria:** Enforce verbosity levels strictly as a programmatic guardrail, matching response lengths to the exact technical detail limits requested.

### [X] `[BUG-017]` Graphify Initialization Bloat (AST Graph Overload)
* **Description:** The agent attempts to read full structural metadata dependency maps and large cache files straight into context during the initial session start.
* **Impact:** Bloats the early context window with static relational maps and introduces temporary file noise.
* **Components Affected:** Initialization hooks, workspace scanning policies.
* **Acceptance Criteria:** Prevent direct reading of raw massive JSON dependency graphs by enforcing strict resource isolation and verifying their inclusion in the `.gitignore` setup.

### [X] `[FEAT-018]` Surgical Search Tools (Ripgrep / Find Wrappers)
* **Description:** Build wrapper utilities around native system search tools like `ripgrep` or `find` to enforce highly localized searches before allowing file reading tools.
* **Impact:** Lowers token consumption by requiring the agent to identify exact line coordinates or code symbols before reading full files.
* **Components Affected:** `skills/memory-first.md`, `.claude/hooks/pre-tool-use.sh`
* **Acceptance Criteria:** Block general file reading tools unless the agent has previously executed a targeted search query or can supply explicit line offsets.

### [X] `[BUG-020]` Static System Prompt Invisibility (Invisible System Prompt Defect)
* **Description:** The static `system-prompt` file inside internal configuration directories remains invisible to Claude Code because the native Anthropic binary only targets `CLAUDE.md` at runtime.
* **Impact:** Unused orphan configuration files that clutter the repository structure without exercising any real control over agent behavior.
* **Components Affected:** `.claude/system-prompt` (Removal), `project-template/CLAUDE.md` (Merger)
* **Acceptance Criteria:** Eradicate the standalone static prompt file and integrate its behavioral core principles into the dynamic compilation templates of `CLAUDE.md`.

---

## PILLAR 2: LOCAL PERSISTENCE AND STATE ENGINE

### [X] `[FEAT-005]` Local Persistence Layer (SQLite Context Engine)
* **Description:** Establish an embedded local database file (`.conductor/cache.db`) to serve as the persistent "bird's-eye view" of the target workspace, caching file structures, interface hashes, method signatures, and task tracking records. This core engine implementation initiates the deprecation phase for the legacy `claude-mem` system.
* **Impact:** Eliminates the need to inject the full repository file map into the LLM prompt, reducing planning input tokens by 60% to 80%, and prepares the codebase to cut ties with external memory utilities.
* **Components Affected:** Core framework storage layer, repository indexing scripts, installer configuration templates, project dependency manifests.
* **Acceptance Criteria:** Maintain an independent local SQLite instance capable of handling schema updates, fast metadata lookups, and task state tracking without querying the LLM context. Verify that dependency files and installers are mapped out to drop the legacy memory tool.

### [X] `[ARCH-008]` Relational Persistence for Agent Memory
* **Description:** Detail and implement the local SQLite schema across three distinct git-linked operational tables: `sessions` (global tracking), `raw_history` (raw developer execution logs kept out of the active prompt, reserved for local RAG/audits), and `snapshots` (compacted state timelines indexed directly by `git_commit_hash`). This milestone marks the final, absolute removal of `claude-mem`.
* **Impact:** Enables instant agent session resumption with clean context bounds, adds support for agent "time-travel" rollbacks, and eliminates the `claude-mem` footprint entirely from the setup overhead.
* **Components Affected:** Cache database schema, state serialization engines, core installation scripts (`install.sh`, `install.ps1`), dependency manifest files.
* **Acceptance Criteria:** Successfully reload full agent awareness across branch switches or project rollbacks by matching database state records to the current Git commit identifier. Completely purge all `claude-mem` binary references, installation steps, and environment dependencies from every setup script and project manifest.
* **Note (from FEAT-005, v1.19.0):** Consider mirroring `/cc-checkpoint` output into the relational store here. Today checkpoints write prose (decisions, conventions, debt) to `project.md`, while the FEAT-005 `task_state` table stores only per-task checkbox state — there is no column for checkpoint content, and the cache is an explicitly non-authoritative, fail-open mirror. A `sessions`/`snapshots` table under this milestone would give checkpoints a queryable, git-hash-indexed home without overloading `task_state`. Keep the plan markdown + `project.md` authoritative; the DB copy would be an optimization only.
* **Decomposition (from 2026-07-04 scoping):** ARCH-008 ships as three sequential specs. `[ARCH-008-S1]` builds the relational schema engine (below), `[ARCH-008-A]` wires the writers, `[ARCH-008-B]` wires resume-reads. The umbrella `[ARCH-008]` checkbox flips only when all three are `[X]`. claude-mem purge is already satisfied by `[BUG-020]`.

### [X] `[ARCH-008-S1]` Relational Schema Engine (Foundation)
* **Description:** Extend `scripts/conductor-db.mjs` with a `user_version` 1→2 additive migration creating `sessions`, `snapshots`, `raw_history` alongside the untouched `task_state`, plus flat subcommands `session` / `get-session` / `snapshot` / `get-snapshot` / `history`. Snapshots store one verbatim SNAP v1 JSON blob; queries print a single line on hit and an empty string on miss/degradation.
* **Impact:** Provides the git-hash-indexed storage substrate for session tracking, raw logs, and compacted timelines without touching any consumer.
* **Components Affected:** `scripts/conductor-db.mjs`, `tests/scripts/conductor-db.test.js`.
* **Acceptance Criteria:** Migration is idempotent and preserves `task_state`; `sessions` upsert preserves original `started_at`; `get-snapshot` uses `ORDER BY id DESC LIMIT 1`; `snap_json` capped at 10 MiB; indexes on `snapshots(git_commit_hash)` and `raw_history(session_id)`; no foreign keys; all write paths stay fail-open (exit 0). Spec: `docs/superpowers/specs/2026-07-04-arch008-relational-persistence-schema-design.md`.

### [X] `[ARCH-008-A]` Checkpoint/Compact Write Wiring
* **Description:** Wire `/cc-checkpoint` and `/cc-compact` to resolve the current git commit hash and persist `sessions` + `snapshots` (the SNAP v1 blob) into the cache via the `[ARCH-008-S1]` subcommands.
* **Impact:** Gives checkpoints and compaction a queryable, commit-indexed relational home; `project.md` + plan markdown remain authoritative.
* **Components Affected:** `cc-checkpoint` command, `cc-compact` command, both `.claude/` and `project-template/.claude/` mirrors.
* **Acceptance Criteria:** Each checkpoint/compact writes exactly one `snapshots` row indexed by the current git hash and upserts its `sessions` row; write failures remain non-fatal (fail-open). Depends on `[ARCH-008-S1]`.

### [X] `[ARCH-008-B]` Phase-Entry Resume Read Wiring
* **Description:** On phase entry (`cc-spec` / `cc-plan` / `cc-implement`), read `get-snapshot <current-git-hash>` to restore agent awareness across branch switches and rollbacks; a miss degrades cleanly to today's fresh-start behavior.
* **Impact:** Delivers ARCH-008's headline acceptance behavior — reload full awareness by matching DB state to the current Git commit identifier.
* **Components Affected:** `cc-spec` / `cc-plan` / `cc-implement` phase-entry logic, both command mirrors.
* **Acceptance Criteria:** A branch switch or rollback to a commit with a stored snapshot restores phase context; absence of a snapshot is non-fatal and silent. Depends on `[ARCH-008-A]`. Flips the umbrella `[ARCH-008]` when complete.

---

## PILLAR 3: MULTI-AGENT ARCHITECTURE AND ASYMMETRIC ORCHESTRATION

### [ ] `[FEAT-009]` Bicameral Proxy Architecture (Asymmetric LLM Chaining)
* **Description:** Create a dual-layer model execution flow. A fast, low-cost model (such as Claude Haiku) acts as the interactive proxy, stripping conversational noise from user prompts before sending clean structures to the core model (Sonnet/Opus), and later wrapping dense core model text outputs into developer-friendly CLI responses.
* **Impact:** Maximizes cost savings on premium-tier model calls while keeping the terminal UX highly communicative.
* **Components Affected:** API communication proxy layer, message pre-processing handlers.
* **Acceptance Criteria:** Route all interactive queries through the fast model layer, ensuring the premium heavy model is only invoked for complex code-generation or core planning tasks.

### [ ] `[FEAT-011]` Multi-Agent Orchestration Core (Agent Router & Choreographer)
* **Description:** Build the central orchestration logic in Code Conductor responsible for managing execution context, tool authorization tokens, and data handoffs between distinct specialized roles depending on the active phase of the engineering lifecycle.
* **Impact:** Decouples agent tasks completely, laying down the groundwork for targeted, specialized system prompts.
* **Components Affected:** Core framework orchestrator loop, execution router.
* **Acceptance Criteria:** Coordinate role handoffs deterministically based on phase completion states without leaking prompt boundaries across different sub-agents.

### [ ] `[FEAT-012]` Role-Based Sub-Agent Modeling (Spec, Plan, Auditor, QA)
* **Description:** Model the strict profile requirements, minimal system prompts, and tool access boundaries for specialized roles:
  * **Spec Agent:** Read-only repository indexing access plus interactive developer requirement analysis.
  * **Plan Agent:** Read access to finalized specifications and target schema metadata; writes tracking records to SQLite.
  * **Code Agent:** Strict write-only and patch tool access restricted strictly to the paths declared in the current active task.
  * **Auditor Agent:** Read access to code patches for static verification, lint checking, styling rules, and architectural compliance.
  * **QA Agent:** Terminal tool access restricted to running defined software test suites (e.g., npm test, vitest).
* **Impact:** Shrinks system prompt footprints to the absolute minimum and ensures bulletproof task isolation.
* **Components Affected:** Agent profile manifests, tool authorization middleware.
* **Acceptance Criteria:** Instantiate each agent role independently with a prompt under 1000 tokens, blocking cross-role tool usage (e.g., ensuring Code Agent cannot run general shell commands and QA Agent cannot edit code files directly).

---

## PILLAR 4: DYNAMIC INITIALIZATION AND ONBOARDING

### [X] `[FEAT-013]` Dynamic Stack Discovery (Just-In-Time Profiles)
* **Description:** Drop the rigid structure of static configuration profiles for technical stacks and deploy an automated, on-the-fly repository manifest scanner.
* **Impact:** Removes the maintenance burden of individual stack files and prevents loading unneeded framework rules into the context of multi-stack or mixed projects.
* **Components Affected:** `stack-profiles/` directory, `/cc-stack` implementation.
* **Acceptance Criteria:** Parse active repository manifests (e.g., package.json, go.mod) dynamically, assembling the exact required stack ruleset directly into the local SQLite store during initialization.

### [X] `[BUG-015]` Orphan or Generic CLAUDE.md (Static CLAUDE.md Blindness)
* **Description:** The setup phase copies a static `CLAUDE.md` file populated with empty placeholders or generic configurations into the workspace root.
* **Impact:** The agent starts work blindly, failing at guessing correct compilation or testing commands and wasting token quotas on test errors.
* **Components Affected:** `project-template/CLAUDE.md`, `/cc-init` command logic.
* **Acceptance Criteria:** Read actual project dependencies during setup and auto-generate a `CLAUDE.md` tailored with the precise commands for the project's build, format, and test scripts.

### [X] `[FEAT-016]` Interactive Assisted Onboarding (Interactive Fallback Wizard)
* **Description:** Implement an interactive terminal setup wizard for the `/cc-init` command to handle blank workspaces or legacy codebases lacking standard package manifests.
* **Impact:** Guides the environment initialization safely through user input prompts, leveraging low-cost models to format the initial developer brief.
* **Components Affected:** `scripts/init-wizard.mjs`, `scripts/claude-md-fields.mjs`, `/cc-init` Step 2 (both mirrors). *No model API binding: the agent running the session does the asking.*
* **Acceptance Criteria:** Gracefully fall back to an interactive console questionnaire if automated file discovery yields no metadata, resulting in a structured, clean `CLAUDE.md` output.

---

## PILLAR 5: INFRASTRUCTURE, ECOSYSTEM, AND QUALITY ASSURANCE

### [ ] `[FEAT-019]` Dependency Abstraction via Local Consumption (Graph Dependency Shield)
* **Description:** Implement an internal middleware utility that processes raw Graphify relationship outputs locally before exposing them to the agent prompt.
* **Impact:** Provides the agent with necessary structural awareness without flooding the context window with raw multidimensional JSON dependency data.
* **Components Affected:** Dependency mapper utility, tool output parser.
* **Acceptance Criteria:** Expose structural relationships to the agent strictly via query-driven operations that return direct dependencies at a single layer of depth per request.

### [ ] `[FEAT-021]` Python-Free Structural Analysis (AST Decoupling)
* **Description:** Re-engineer the code structural parser to drop python runtime dependencies completely, moving to modern, ultra-portable local indexing solutions.
* **Impact:** Eradicates environment setup friction for developer workstations that lack Python runtimes or face dependency lockouts.
* **Components Affected:** `global/hooks/graphify-ast-refresh.py` (Replacement).
* **Acceptance Criteria:** Execute full codebase indexing natively using the TypeScript compiler API for JavaScript targets, pre-compiled Tree-sitter WebAssembly bindings, or a graceful fallback to high-speed regular expression scanners.
* **Reframe (2026-09-25, recorded while filing BUG-033):** the first question is not which parser but **whether this repo needs a graph at all**. `graphify` is a third-party Python package this repo does not ship, and it has never been installed on the developer machine - the graph rung of the Orchestrator Protocol has been inert for the project's entire life while every cycle shipped on memory to grep, and `skills/memory-first/SKILL.md:37` already documents the skip. Candidate resolutions to evaluate when this is picked up: (a) drop the graph rung from the Orchestrator Protocol under YAGNI and keep memory to grep to targeted read; (b) a zero-dependency indexer over the repo's own `.mjs` files (`node:module` plus regex) honoring the `dependencies: {}` constraint. The TypeScript compiler API path is **out** unless code-conductor decides to index TypeScript user projects, which is a separate product decision requiring its own `/cc-spec`: `typescript` is a real runtime dependency against a package whose defining constraint is zero dependencies, and it covers TS/JS only. Replacing `graphify` is also not a parser swap - it supplies a `graphify query "<question>"` CLI over `graphify-out/graph.json`, so a replacement owns the schema, the query surface and the freshness lifecycle too.

### [ ] `[FEAT-022]` UI/UX Skill Assimilation and Passive Process Removal
* **Description:** Deconstruct the isolated, passive structure of scripts and CSV dictionaries inside the `ui-ux-pro-max` skill directory, converting them into native configuration assets.
* **Impact:** Restores design-system verification features and removes dead code assets that the agent currently ignores during live sessions.
* **Components Affected:** `.claude/skills/ui-ux-pro-max/` (Restructuring).
* **Acceptance Criteria:** Transform the static layout CSV sheets into lightweight Markdown guidelines that are loaded directly alongside the discovered active technology stack profile.

### [x] `[FEAT-023]` Global Distribution Infrastructure via NPM CLI
* **Description:** Upgrade the current installation strategy away from loose shell scripts (`install.sh`, `install.ps1`) to a standard Node package executable.
* **Impact:** Establishes cross-platform installation consistency, proper semantic versioning management, and streamlined updates.
* **Components Affected:** Project manifest configs, build packaging pipeline, GitHub Actions workflows.
* **Acceptance Criteria:** Enable global distribution through npm registries, managing directory setup, template unpacking, and local command registration natively via Node across Windows, macOS, and Linux.

### [X] `[FEAT-024]` Automated Unit Testing Suite (Self-Testing Infrastructure)
* **Description:** Setup a unified, fast testing suite driven by Vitest to validate CLI orchestrator paths, stack discovery algorithms, and context guardrails.
* **Impact:** Offers a bulletproof, deterministic validation tool for the agent to check its own work before closing issues, ensuring zero regressions in core performance.
* **Components Affected:** Core test setup config, orchestrator business logic, in-memory file system simulation tests (`memfs`).
* **Acceptance Criteria:** Ensure robust test coverage across stack identification, template interpolation, and tool boundary filtering, binding test runs as a mandatory criteria before any backlog item change can be committed.


### [X] `[FEAT-025]` Retention Purge for the Conductor Cache DB (`snapshots` / `raw_history`)
* **Description:** `scripts/conductor-db.mjs` inserts new rows into `snapshots` (one per checkpoint/compact, keyed by git commit hash) and `raw_history` (one per recorded event) with no eviction path — both tables grow without bound over the life of a repo. Add a bounded retention mechanism (e.g. keep only the last N rows per `session_id`/`git_commit_hash`, or a max-age window) so `.conductor/cache.db` stays small over time.
* **Impact:** Prevents unbounded disk growth of the local cache DB without weakening context restoration: `get-snapshot` already only ever reads the most recent row per commit hash (`ORDER BY id DESC LIMIT 1`) and `sessions` is already upserted to one row per `session_id`, so purging older `snapshots`/`raw_history` rows does not remove data any current read path depends on.
* **Components Affected:** `scripts/conductor-db.mjs` (new `purgeTable` helper, two call sites), `tests/scripts/conductor-db.test.js`.
* **Acceptance Criteria:** Writes to `snapshots`/`raw_history` trigger (or a scheduled path performs) a bounded purge that keeps the most recent N rows or rows within a max-age window per key; purge failures remain non-fatal (fail-open, matching the existing `CONDUCTOR_DB:` warn-and-continue convention); `get-snapshot`/`get-session` behavior is unaffected by the purge.

### [X] `[FEAT-026]` Guided Branch Creation and Commit Drafting for Backlog Work
* **Description:** No part of the project automates the Git side of picking up a backlog item: branch creation and commit-message drafting are manual, guided only by the naming/format convention documented in `CONTRIBUTING.md`. Add a step (e.g. at `/cc-spec` or `/cc-plan` approval, or a new `/cc-branch` helper) that offers to create a descriptively named branch (derived from the `[FEAT-XXX]`/`[BUG-XXX]` id and title) and drafts a Conventional-Commits-style commit message from the resulting diff.
* **Impact:** Removes manual naming/formatting friction for routine backlog work while keeping every Git write auditable and explicit.
* **Components Affected:** `project-template/.claude/commands/cc-spec.md` / `cc-plan.md` (trigger point), possible new `cc-branch` command, both command mirrors.
* **Acceptance Criteria:** The agent proposes a branch name and drafts a commit message automatically, but still requires explicit user confirmation before running `git checkout -b`, `git commit`, `git push`, or opening a PR — matching this project's existing Git safety protocol (never push or open PRs without confirmation).


### [X] `[BUG-027]` Installer Destroys an Existing CLAUDE.md
* **Description:** `deployProject` copied every non-`.claude` entry of `project-template/` onto the host project root with `{ force: true }`, and `deployGlobal` did the same to `~/.claude/CLAUDE.md`, replacing a hand-authored configuration with the empty-section template. `.gitignore` was clobbered by the same loop.
* **Impact:** Every project convention, architecture note and stack profile is lost on install; installing on a second device wipes the developer's global configuration.
* **Components Affected:** `lib/installer/deploy.mjs`, `bin/code-conductor.mjs`, `global/CLAUDE.md`, `project-template/`.
* **Acceptance Criteria:** Conductor-owned content is delimited by `<!-- cc:managed:start -->` / `<!-- cc:managed:end -->` and refreshed wholesale on upgrade; content outside the block is preserved byte-for-byte; missing template sections are appended once above the block; every change is backed up and written atomically; a symlinked target keeps its link.

### [X] `[BUG-028]` Bundled Skills Never Register
* **Description:** `deployGlobal` copied `skills/*.md` as flat files into `~/.claude/skills/`, but Claude Code discovers personal skills only at `~/.claude/skills/<name>/SKILL.md`. Two of the five skills additionally shipped with no frontmatter.
* **Impact:** `/cc-spec`, `/cc-plan`, `/cc-review`, `/cc-debug` and `/cc-refactor` silently skip the skill they invoke, so a fresh install runs without the adversarial-review, simplification and verbosity protocols the project advertises.
* **Components Affected:** `lib/installer/deploy.mjs`, `skills/`, `tests/plugin/code-conductor-plugin.test.js`.
* **Acceptance Criteria:** All five skills deploy to `~/.claude/skills/<name>/SKILL.md`, non-empty, with `name:` and `description:` frontmatter; a file blocking `skills/<name>` is removed before the copy; a stale flat `<name>.md` matching the bundled content is swept; a hermetic test proves the contract in CI.

### [X] `[BUG-029]` project-template/.gitignore Never Ships to npm Installs
* **Description:** npm unconditionally excludes `.gitignore` from every published tarball, so `project-template/.gitignore` is absent from the package despite `project-template/` being listed in `package.json`'s `files` array. A `--project` install from npm therefore never delivers the template's ignore rules — including the `*.installer-backup.*` and `*.installer-tmp.*` patterns added in 1.24.0. Only a git-clone install has ever received the file. Surfaced when 1.24.0's `mergeFileInto` call hit `ENOENT`; the crash was worked around by skipping an absent bundled template (`'skipped-missing'`), which restores the pre-1.24 behaviour but not the missing content.
* **Impact:** npm-installed projects leak installer backup and temp files into `git status` and can commit them; the README's `.gitignore Note` documents behaviour that does not occur on the npm path.
* **Components Affected:** `package.json` (`files`), `project-template/.gitignore`, `lib/installer/deploy.mjs`, `lib/installer/file-merge.mjs`, `tests/installer/smoke.test.js`.
* **Acceptance Criteria:** The template's ignore rules ship in the tarball (e.g. stored as `project-template/gitignore` and mapped to `.gitignore` on deploy); a smoke test asserts the file is physically present in `npm pack` output and that a `--project` install from the packed tarball produces a `.gitignore` containing both installer patterns; the `skipped-missing` guard remains as defence in depth.

### [ ] `[FEAT-030]` Byte-Sum Bound for the Conductor Cache DB `snapshots` Table
* **Description:** FEAT-025 bounds `snapshots` by row count (3 per commit hash, soft 200, hard 500) and never by size. `snap_json` rows are not size-capped by that purge: a v2 checkpoint blob carries `pr` up to `snap-build.mjs`'s 10 MiB cap, so a single hash can legitimately hold 30 MiB and the table's theoretical ceiling is ~5 GB. Add an optional byte-sum bound that deletes oldest non-floor rows until `SUM(LENGTH(snap_json))` is under a budget.
* **Impact:** Closes the one growth mode FEAT-025 deliberately left open, for repos that checkpoint long prose frequently.
* **Components Affected:** `scripts/conductor-db.mjs` (`purgeTable`), `tests/scripts/conductor-db.test.js`.
* **Acceptance Criteria:** A byte budget bounds `SUM(LENGTH(snap_json))` on `snapshots`, deleting oldest-first under the same newest-per-key floor as FEAT-025 bound 2; the scan cost is paid only when a cheap row-count precondition indicates it may be needed; purge failures stay fail-open. Pick up only if a real `.conductor/cache.db` is observed above a few hundred MB — 28 KB measured 2026-09-22.

### [X] `[BUG-031]` Generated Plans Can Stage a Tracking File Before Editing It
* **Description:** `/cc-plan`'s plan-generation rules say nothing about the order of a task's staging step relative to the edit it is meant to capture. FEAT-016's generated Task 0 put `git add "AGENT-READABLE BACKLOG.md"` in step B and the backlog checkbox flip in step C, so executing the steps in file order — which is exactly what `cc-implement`'s surgical locator does — would have committed the unflipped file. Caught by inspection before execution and fixed in that plan by hand; nothing prevents the next generated plan from repeating it.
* **Impact:** A silently unrecorded state flip. The plan reports every checkbox `[X]` while the committed tracking file still shows the previous state, and the divergence surfaces only at the next task that asserts on the expected state (FEAT-016's own T-007-D expects `[>]` and would have halted).
* **Components Affected:** `.claude/commands/cc-plan.md` and its `project-template/` mirror (the `## Ordered Steps` / task-generation rules), `tests/installer/commands-parity.test.js`.
* **Acceptance Criteria:** The plan-generation rules state that any step staging a file must come after every step that edits it, and that a task mixing edits with a commit orders them edit → stage → commit; the rule ships in both `cc-plan.md` mirrors and is pinned by a presence anchor in the existing parity suite.

### [ ] `[BUG-032]` Global Memory Preferences Sit Outside the Documented Lookup Chain
* **Description:** Nothing in the documented lookup chain points at `~/.claude/memory/personal.md`. The Orchestrator Protocol in the global `CLAUDE.md` starts at `.claude/memory/project.md`, and the project `CLAUDE.md` describes `personal.md` only as "local only, never committed", so a project session never reads the global file where standing preferences live. The `global/memory/personal.md:9` no-em-dash rule was violated repeatedly across the BUG-031 spec phase before the developer pointed at the file by hand; a grep of the project-scoped `.claude/memory/personal.md` and both `CLAUDE.md` files does not reach it.
* **Impact:** A recorded rule the executing agent never reads is indistinguishable from no rule, the same failure shape BUG-031 fixed one level up. Every preference filed in the global memory is silently inert, and the developer has to restate it by hand each time.
* **Verified while filing:** the installer never deploys `global/memory/` at all. `lib/installer/deploy.mjs:40` excludes it from the copy as host-owned user data, `deploy.mjs:116` then creates an empty `<target>/memory` so later seeding has a parent, and no installer path references `personal.md` for a write-if-absent seed (`tests/installer/deploy.test.js:64` pins the exclusion). So the repo copy of `global/memory/personal.md` reaches `~/.claude/memory/personal.md` only if the developer puts it there by hand, and a fresh install has no global preferences file at all.
* **Components Affected:** `global/memory/personal.md`, the Orchestrator Protocol lookup chain in the global `CLAUDE.md` template, `project-template/CLAUDE.md`, `lib/installer/deploy.mjs` (`skipHostOwned`) and `tests/installer/deploy.test.js`.
* **Acceptance Criteria:** Either the global preferences file is deployed into a location the documented chain already reads and the chain names it explicitly as a step, or the chain documents where global preferences actually live and how a session is expected to reach them. Either way, a fresh session in an unrelated project can be shown to reach the no-em-dash rule by following only the documented steps, and no preference file remains reachable by hand-knowledge alone.

### [ ] `[BUG-033]` UserPromptSubmit Hook Is Launched With a `python` That Modern macOS Does Not Have
* **Description:** `global/settings.json:16` wires the graph refresh hook as `python ~/.claude/hooks/graphify-ast-refresh.py`, while the script's own shebang is `#!/usr/bin/env python3`. Apple removed the bare `python` shim in macOS 12.3, so on this host `command -v python` is empty and every `UserPromptSubmit` prints `UserPromptSubmit hook error / Failed with non-blocking status code: /bin/sh: python: command not found`. `tests/installer/settings.test.js:27` pins the same wrong string, so the suite defends the defect.
* **Impact:** Every prompt in every project on a Python-3-only machine (all modern macOS, most minimal Linux images) prints a hook error. No functional loss, because the `graphify` module is absent here too and the script would exit 0 on `ImportError` - the noise is pure friction, and it trains the developer to ignore hook errors, which is how a real one gets missed.
* **Components Affected:** `global/settings.json`, `global/hooks/graphify-ast-refresh.py`, new `global/hooks/graphify-ast-refresh.mjs`, `lib/installer/settings.mjs`, `tests/installer/settings.test.js`, `README.md`.
* **Acceptance Criteria:** Two stages in one patch release. (1) The pinned invocation names `python3` in both `global/settings.json` and the test expectation, so the test asserts the corrected command rather than preserving the bug. (2) A Node wrapper `global/hooks/graphify-ast-refresh.mjs` becomes the permanent wiring: it performs the freshness check, probes for a usable interpreter and for the `graphify` module, exits 0 silently when either is absent, and delegates to the existing AST payload only when the full toolchain exists. Degradation follows the `conductor-db.mjs` convention - at most one stderr line, gated behind the `CC_GUARD4_DEBUG` precedent, never blocking. On a Python-free macOS host every `UserPromptSubmit` is silent with exit 0; with the full toolchain present behavior is unchanged.

### [ ] `[BUG-034]` Guard 4 Fails Open When Python Is Absent, Silently Ceasing To Guard
* **Description:** `project-template/.claude/hooks/pre-tool-use.sh:33` implements Guard 4's path-component check by shelling out to `python3 -c`, with `2>/dev/null` and `|| true`. On a host without `python3` the subshell produces empty output, `_g4_result` is neither `BLOCK` nor `OK`, and the hook falls through to allow the read. The guard that blocks direct reads of `graphify-out/` and `node_modules/` therefore stops enforcing with no signal, on exactly the Python-free machines BUG-033 is about.
* **Impact:** Worse than cosmetic: a guardrail that reports nothing while no longer guarding. The agent can pull raw `graphify-out/` or `node_modules/` content into the main context, which is the context-flooding failure the guard was written for (BUG-017), and the developer has no way to notice. A guard that silently stops guarding is worse than one that overreaches.
* **Components Affected:** `project-template/.claude/hooks/pre-tool-use.sh` (Guard 4), the `.ps1` variant, `tests/hooks/guard4.test.js`, `README.md`.
* **Acceptance Criteria:** Guard 4 fails **closed** on verification error with one explicit, auditable escape hatch. If the path-component check cannot run, the read is blocked and the hook prints a single actionable line naming the cause and the override; the override is an env var (`CC_GUARD4_ALLOW=1` or equivalent) for operators who accept unguarded reads, never the default. Preferred hardening, feasibility to be settled in the fix: reimplement the check in pure shell or Node so Guard 4 carries no Python dependency at all and the fail-closed branch becomes nearly unreachable - it is string matching on path components and should not need an interpreter the rest of the repo does not require. If that route is taken, the `.ps1` variant gets the same treatment, per hook parity. On a Python-free machine a read of `graphify-out/` is blocked rather than silently allowed, the block message names the cause, the override restores reads and leaves a stderr trace, and the existing `BASH_SCAN_ALLOWLIST` family behavior is untouched.

### [ ] `[BUG-035]` The Installer Force-Copies settings.json Over the Host's, Destroying User-Owned Hook Entries
* **Description:** `deployGlobal` copies `global/` over `~/.claude/` with `force: true` (`lib/installer/deploy.mjs:23,110`), and `skipHostOwned` (`deploy.mjs:45`) excludes only `global/memory`. `settings.json` is therefore overwritten wholesale on every install, taking with it every key the shipped asset does not carry: any `UserPromptSubmit` entry the user added themselves, `enabledPlugins`, `extraKnownMarketplaces`, `permissions` edits, and anything else Claude Code stores there. The two mergers re-add the entries this repo owns, which is exactly why the loss is invisible - the file looks correct afterwards.
* **Impact:** `mergeGraphifyHook`'s "leaves an entry it does not own byte for byte" guarantee is true in unit tests and false on a real install, because the file is replaced before the normalizer ever reads it. BUG-033's 1.27.2 changelog actively instructs existing installations to re-run the installer, which makes this fire on precisely the machines told to run it. Silent, unprompted loss of host configuration the installer never announced it would touch.
* **Components Affected:** `lib/installer/deploy.mjs` (`CP_OPTS`, `skipHostOwned`, `deployGlobal`), `lib/installer/settings.mjs` (both mergers), `bin/code-conductor.mjs`, `tests/installer/deploy.test.js`, `tests/installer/cli.test.js`.
* **Candidate shape (decide in the spec, not here):** deploy everything under `global/` except `settings.json` wholesale, and let `mergeVerbosityHook` and `mergeGraphifyHook` own that file's full lifecycle - creation on a fresh host, normalization of the entries this repo owns, and nothing else. Whether the shipped `permissions` block still needs a first-install seed, and what happens to a host key that collides with one this repo owns, are open questions for that spec.
* **Acceptance Criteria:** A pre-existing `~/.claude/settings.json` carrying an unrelated `UserPromptSubmit` entry and an unrelated top-level key survives a full install byte for byte apart from the entries this repo owns, proven by a test at the CLI seam rather than at the merger seam, since the merger is not where the loss happens. A fresh host with no `settings.json` still ends up with a working file. Two consecutive installs remain idempotent.
