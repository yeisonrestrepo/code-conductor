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

### [ ] `[FEAT-007]` Rolling Context Window (Context Compactor)
* **Description:** Implement an orchestrator middleware that tracks the active message buffer size. Upon reaching a specific token threshold, it invokes a sub-process to generate a dense, consolidated snapshot (storing metadata, completed actions, and immediate pending steps), clears the active session chat history, and injects the snapshot as the new clean starting point.
* **Impact:** Protects the absolute context limit, eliminates the "Lost in the Middle" attention degradation, and maximizes Prompt Caching savings up to 90% on intermediate turns.
* **Components Affected:** Buffer monitoring layer, snapshot generation logic.
* **Acceptance Criteria:** Automatically trigger context compaction when hitting 75% of the model window limit, ensuring the agent retains functional memory without carrying dead conversational weight.

### [ ] `[FEAT-010]` Dense Prompt Protocol Standard
* **Description:** Design a high-density, low-overhead data exchange format (such as minified JSON, custom symbols, or compact Key-Value syntaxes) used specifically for communication between the compression middleware and the core LLM brain.
* **Impact:** Minimizes token consumption without causing any loss in architectural precision or code quality during agent handoffs.
* **Components Affected:** Serialization utilities, agent communication layer.
* **Acceptance Criteria:** Achieve a minimum 30% character reduction compared to standard conversational markdown descriptions while retaining a 100% success rate on code generation tests.

### [X] `[BUG-014]` Ignorance of the Verbosity Level (Verbosity Dilution)
* **Description:** The agent tends to neglect configured verbosity constraints (MIN, INFO, VERBOSE) over extended development sessions due to instructions fading from context.
* **Impact:** Waste of output tokens on redundant text conversational fluff when minimal code-only changes are requested.
* **Components Affected:** `skills/verbosity.md`, `global/memory/`
* **Acceptance Criteria:** Enforce verbosity levels strictly as a programmatic guardrail, matching response lengths to the exact technical detail limits requested.

### [ ] `[BUG-017]` Graphify Initialization Bloat (AST Graph Overload)
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

### [ ] `[FEAT-005]` Local Persistence Layer (SQLite Context Engine)
* **Description:** Establish an embedded local database file (`.conductor/cache.db`) to serve as the persistent "bird's-eye view" of the target workspace, caching file structures, interface hashes, method signatures, and task tracking records. This core engine implementation initiates the deprecation phase for the legacy `claude-mem` system.
* **Impact:** Eliminates the need to inject the full repository file map into the LLM prompt, reducing planning input tokens by 60% to 80%, and prepares the codebase to cut ties with external memory utilities.
* **Components Affected:** Core framework storage layer, repository indexing scripts, installer configuration templates, project dependency manifests.
* **Acceptance Criteria:** Maintain an independent local SQLite instance capable of handling schema updates, fast metadata lookups, and task state tracking without querying the LLM context. Verify that dependency files and installers are mapped out to drop the legacy memory tool.

### [ ] `[ARCH-008]` Relational Persistence for Agent Memory
* **Description:** Detail and implement the local SQLite schema across three distinct git-linked operational tables: `sessions` (global tracking), `raw_history` (raw developer execution logs kept out of the active prompt, reserved for local RAG/audits), and `snapshots` (compacted state timelines indexed directly by `git_commit_hash`). This milestone marks the final, absolute removal of `claude-mem`.
* **Impact:** Enables instant agent session resumption with clean context bounds, adds support for agent "time-travel" rollbacks, and eliminates the `claude-mem` footprint entirely from the setup overhead.
* **Components Affected:** Cache database schema, state serialization engines, core installation scripts (`install.sh`, `install.ps1`), dependency manifest files.
* **Acceptance Criteria:** Successfully reload full agent awareness across branch switches or project rollbacks by matching database state records to the current Git commit identifier. Completely purge all `claude-mem` binary references, installation steps, and environment dependencies from every setup script and project manifest.

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

### [ ] `[FEAT-013]` Dynamic Stack Discovery (Just-In-Time Profiles)
* **Description:** Drop the rigid structure of static configuration profiles for technical stacks and deploy an automated, on-the-fly repository manifest scanner.
* **Impact:** Removes the maintenance burden of individual stack files and prevents loading unneeded framework rules into the context of multi-stack or mixed projects.
* **Components Affected:** `stack-profiles/` directory, `/cc-stack` implementation.
* **Acceptance Criteria:** Parse active repository manifests (e.g., package.json, go.mod) dynamically, assembling the exact required stack ruleset directly into the local SQLite store during initialization.

### [ ] `[BUG-015]` Orphan or Generic CLAUDE.md (Static CLAUDE.md Blindness)
* **Description:** The setup phase copies a static `CLAUDE.md` file populated with empty placeholders or generic configurations into the workspace root.
* **Impact:** The agent starts work blindly, failing at guessing correct compilation or testing commands and wasting token quotas on test errors.
* **Components Affected:** `project-template/CLAUDE.md`, `/cc-init` command logic.
* **Acceptance Criteria:** Read actual project dependencies during setup and auto-generate a `CLAUDE.md` tailored with the precise commands for the project's build, format, and test scripts.

### [ ] `[FEAT-016]` Interactive Assisted Onboarding (Interactive Fallback Wizard)
* **Description:** Implement an interactive terminal setup wizard for the `/cc-init` command to handle blank workspaces or legacy codebases lacking standard package manifests.
* **Impact:** Guides the environment initialization safely through user input prompts, leveraging low-cost models to format the initial developer brief.
* **Components Affected:** CLI init interactive layer, low-cost model API bindings.
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

### [ ] `[FEAT-022]` UI/UX Skill Assimilation and Passive Process Removal
* **Description:** Deconstruct the isolated, passive structure of scripts and CSV dictionaries inside the `ui-ux-pro-max` skill directory, converting them into native configuration assets.
* **Impact:** Restores design-system verification features and removes dead code assets that the agent currently ignores during live sessions.
* **Components Affected:** `.claude/skills/ui-ux-pro-max/` (Restructuring).
* **Acceptance Criteria:** Transform the static layout CSV sheets into lightweight Markdown guidelines that are loaded directly alongside the discovered active technology stack profile.

### [ ] `[FEAT-023]` Global Distribution Infrastructure via NPM CLI
* **Description:** Upgrade the current installation strategy away from loose shell scripts (`install.sh`, `install.ps1`) to a standard Node package executable.
* **Impact:** Establishes cross-platform installation consistency, proper semantic versioning management, and streamlined updates.
* **Components Affected:** Project manifest configs, build packaging pipeline, GitHub Actions workflows.
* **Acceptance Criteria:** Enable global distribution through npm registries, managing directory setup, template unpacking, and local command registration natively via Node across Windows, macOS, and Linux.

### [X] `[FEAT-024]` Automated Unit Testing Suite (Self-Testing Infrastructure)
* **Description:** Setup a unified, fast testing suite driven by Vitest to validate CLI orchestrator paths, stack discovery algorithms, and context guardrails.
* **Impact:** Offers a bulletproof, deterministic validation tool for the agent to check its own work before closing issues, ensuring zero regressions in core performance.
* **Components Affected:** Core test setup config, orchestrator business logic, in-memory file system simulation tests (`memfs`).
* **Acceptance Criteria:** Ensure robust test coverage across stack identification, template interpolation, and tool boundary filtering, binding test runs as a mandatory criteria before any backlog item change can be committed.