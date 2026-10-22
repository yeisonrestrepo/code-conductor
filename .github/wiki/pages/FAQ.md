# FAQ

## General

### What is code-conductor?

A governance layer for Claude Code that installs slash commands, hooks, guardrails, and a persistent memory system. It enforces a spec-first workflow and cuts token usage.

### Does it modify my project's code?

No. It only creates/manages files inside `.claude/` and optionally `.conductor/` (gitignored). Your source code is untouched.

### What stacks does it support?

Any stack. `/cc-stack` auto-detects from `package.json`, `go.mod`, `Cargo.toml`, `pom.xml`, `build.gradle`, `pyproject.toml`, `Gemfile`, and others.

### Is it a security sandbox?

No. The guards are **process guardrails for cooperative agents**, not a security boundary. They assume `agent_type` is reported honestly and do not cover every write path (e.g., `Bash` can still write files). See the [Known Limits section in the README](https://github.com/yeisonrestrepo/code-conductor#known-limits).

---

## Installation

### I get errors about CLAUDE.md being damaged

Install `@latest` (minimum `1.34.4`). Older versions could strip or damage existing CLAUDE.md files.

### The installer prints nothing — is that normal?

Yes. Silent exit 0 is by design and is asserted by a test.

### How do I update?

```bash
npx @yeison.restrepo.r/code-conductor@latest --project
```

The installer is idempotent: it merges settings, preserves your content, and only updates managed sections.

---

## Guards

### Guard 3 blocked a command I need — what do I do?

Three options, in order of preference:

1. **Use the targeted alternative** shown in the denial message (grep, glob, bounded read)
2. **Add an allowlist entry** in `.claude/memory/bash-scan-allowlist.txt` with a comment explaining why
3. **Set `CC_GUARD3_WARN=1`** for triage (ask instead of deny) — this is a triage aid, not a permanent setting

### How do I debug a guard denial?

```bash
CC_HOOK_DEBUG=1   # shows diagnostic lines the hook normally swallows
CC_HOOK_ALLOW=1   # overrides an unparseable-input denial only
```

### Can I disable all guards?

Don't. If a specific guard is wrong, report it as an issue. The guards are the value proposition — disabling them returns you to unguarded Claude Code.

---

## Orchestrator

### What's the difference between `/cc-implement` and `/cc-orchestrate`?

`/cc-implement` is manual: you drive each phase yourself. `/cc-orchestrate` is automated: it dispatches role agents through Define → Build → Verify with validation at every boundary.

### The orchestrator halted — how do I recover?

```bash
# End the current run
node .claude/scripts/orchestrate.mjs end

# Start fresh
node .claude/scripts/orchestrate.mjs start
```

### Do I still need to approve things in `--auto` mode?

Yes. `--auto` skips pauses between role dispatches, but **spec and plan approvals always require your explicit approval**.

---

## Memory

### Where is my project memory?

`.claude/memory/project.md` — committed to git, shared with your team.

### Where are my personal preferences?

`~/.claude/memory/personal.md` — local, never committed.

### How often should I run `/cc-checkpoint`?

Before `/compact`, after completing a feature, and after key architectural decisions. The more you checkpoint, the less you re-explain.

---

## Token Usage

### How much does code-conductor save?

Depends on your usage pattern. The biggest savings come from:

- Guard 1 blocking unbounded file reads
- Guard 3 blocking mass content dumps (47 denials measured in one real session)
- Memory-first lookup chain avoiding file reads entirely
- SNAP handoffs being 15%+ smaller than markdown
- Verbosity MIN producing one-sentence responses

### Does code-conductor itself consume tokens?

The hooks are lightweight (pre-tool-use.mjs is pure Node, no model calls). Commands like `/cc-spec` and `/cc-plan` do consume tokens for their model work, but they prevent the much larger waste of building the wrong thing.
