# FEAT-046: /cc-metrics, Offline Token and Time Metrics with Recommendations

**Issue:** #82
**Date:** 2026-10-22
**Status:** Draft — awaiting operator approval. Answers the `[FEAT-046]` entry in `AGENT-READABLE BACKLOG.md`.

This is a design document only. No code ships with it.

---

## Problem

Pillar 1 exists to reduce token spend, and nothing in the project measures token spend. No shipped item can show what it saved, and no user can see which tools, commands, branches or backlog items cost them the most tokens and time. The data already exists: Claude Code writes every session to `~/.claude/projects/<slug>/*.jsonl`. This item is Pillar 1's measurement instrument.

## Solution

Two files, no hook, no write:

1. **`scripts/session-metrics.mjs`.** A zero-dependency Node module that streams the project's session logs line by line, aggregates usage and timing, and prints one compact text report to stdout. Its parsing functions are exported so unit tests drive them over fixture logs.
2. **`/cc-metrics`.** A project command that runs the script and echoes its output. Nothing else.

It runs only when invoked, adds no latency to any session, and writes nothing anywhere.

## Measurements

Taken on 2026-10-22: Windows 11, Node v24.16.0, this repository's own logs (16 JSONL files, 57.4 MB, 1016 API requests, 2 compactions, 5 subagent transcripts). Throwaway POC code in the session scratchpad; none of it is committed.

### Log format, as found (keys only; no transcript content was copied)

| Need | Where it lives | Notes |
|---|---|---|
| Token usage | `assistant` record, `message.usage.{input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens}` | One API response spans several `assistant` records (one per content block), all carrying the same `requestId`. **M3** shows the usage values are identical across them, so counting once per `requestId` is exact. |
| Timestamps | `timestamp` (ISO 8601) on `user`, `assistant`, `system`, `attachment` | |
| Tool calls | `assistant.message.content[]` blocks with `type: "tool_use"`, `name`, `id`, `input` | |
| Tool results | `user.message.content[]` blocks with `type: "tool_result"`, `tool_use_id`, `content` | `toolUseResult.durationMs` exists only for some tools (Grep, Glob, Agent), so tool time is taken as the tool_use → tool_result timestamp delta for every tool. |
| Commands | `Skill` tool_use, `input.skill` (e.g. `cc-spec`) | Typed `<command-name>` user text: **0** occurrences in these logs; every command arrived as a `Skill` call. Both are read. |
| Branch | `gitBranch` on every conversational record | 15 distinct values, including `main`, `HEAD`, `release/*`. |
| Session / subagent | `sessionId`; subagents in `<sessionId>/subagents/agent-<id>.jsonl` with `isSidechain: true` and `agentId` | **Subagent records carry the parent's `sessionId`.** Worktree-isolated agents log there too, not under a worktree slug. |
| Compaction | `system` record, `subtype: "compact_boundary"`, `compactMetadata.{trigger, preTokens, postTokens}` | 2 found. |
| Turn wall time | `system` record, `subtype: "turn_duration"`, `durationMs` | Main transcripts only. |
| Noise | `mode`, `permission-mode`, `atis-latch`, `last-prompt`, `ai-title`, `api-request*`, `file-history-*`, `pr-link`, `cost-state`, `queue-operation`, `attachment` | Ignored by type. Unknown types are skipped, never counted. |

### Approaches

| # | Approach | Runtime | Output the agent ingests | Verdict |
|---|---|---|---|---|
| M1 | **(a) Streaming reader script** (`readline` over every log, aggregate in memory, print top-5 tables) | 430 ms warm, 1008 ms cold | **1553 bytes, about 390 tokens** | Chosen |
| M2 | **(b) Agent greps the logs itself.** Three minimal `grep -o` extractions: usage objects, `tool_use` names, `requestId`s | n/a | 230 KB + 109 KB + 87 KB = **426 KB, about 107k tokens**, about 275× M1 | Rejected. It still cannot join usage to branch, command or tool (they sit on different records), cannot dedupe by `requestId`, and the Grep tool's default `head_limit` of 250 truncates it silently. |
| M3 | Usage values across records sharing a `requestId` | | **0** differences in 1016 requests | Count once per `requestId`. |
| M4 | **(c) Read-only join with `.conductor/cache.db`** (`node:sqlite`, `readOnly: true`) for phase | 2 ms | | Rejected for phase. **1 of 10** main sessions has a `sessions` row; the row holds one phase per session (last write wins); `node:sqlite` needs Node ≥ 22.5 while `engines` is `>=20`. Phase is derivable from the logs instead (D4). |
| M5 | Tool-result token estimate (chars / 4), counting text blocks only | | Read 194.9k, Bash 149.7k, Grep 60.3k | 23 results carry image or document blocks. Counting them as JSON inflated Read to 2.1M; text-only is the honest estimate, labelled as such. |
| M6 | Attribution coverage on these logs | | By pillar: **30%** of tokens (`fix/bug-045-*` etc.); by command: **15%** | Most work happened on `main`, `poc/*` and id-less `feat/*` branches, and most prompts were typed free-form. Unattributed spend is reported as its own row, never dropped. |

**Not measured:** macOS and Linux log paths (the slug rule is the same by inspection), logs from Claude Code versions older than those present (opus-4-6 and opus-5-5 era records were both present and parsed), and transcripts above 100 MB.

## Decisions

### D1. A script, not agent-side parsing (Pillar 1)

M1 against M2: the script's report costs the agent about 390 tokens; doing the same with greps costs about 107k and still produces wrong numbers. A metrics command that itself burns context would undercut the pillar it measures. The command body only runs the script.

### D2. Logs are the only source; no `cache.db`

M4 rules out the database as a phase source on measured coverage and on the Node floor. Ingesting logs into `cache.db` (approach c as a cache) is a write, which the entry forbids, and M1 shows no need for incremental parsing at these volumes. The issue's optional `phase-enter` rows in `raw_history` are out of scope for the same reason: they add a write to three commands.

### D3. Locating the logs

- Root: `$CLAUDE_CONFIG_DIR` if set, else `~/.claude`, then `projects/<slug>`.
- Slug: the project root (git toplevel, else cwd) with every character outside `[A-Za-z0-9]` replaced by `-`. `C:\Users\ASUS\WebstormProjects\code-conductor` becomes `C--Users-ASUS-WebstormProjects-code-conductor`, which matches the directory on disk.
- Files: `<slug>/*.jsonl` and `<slug>/*/subagents/*.jsonl`. Nothing else under the directory is opened.
- `--dir <path>` overrides the slug directory. Tests use it; so does a user running from a worktree, whose cwd slug has no logs.

### D4. How each grouping is derived

| Grouping | Rule | When not derivable |
|---|---|---|
| Tool | `tool_use.name`; calls, estimated result tokens (M5), wall seconds (tool_use → tool_result delta) | Unmatched tool_use (session cut mid-call): counted as a call, time `not measured` |
| Command | The latest `Skill` call or `<command-name>` in the same transcript; it holds until the next one or a new typed prompt (`promptSource: "typed"`) | `(none)` |
| Phase | The command mapped to a band: `cc-spec`, `cc-plan` → Define; `cc-implement`, `cc-refactor`, `cc-debug` → Build; `cc-review`, `cc-test` → Verify | `(none)`; other commands never get a phase |
| Branch / item | `gitBranch`; item id by `/(feat|bug|arch)-?(\d{3})/i` on the branch, normalized to `FEAT-NNN` | Branch kept, item `(none)` |
| Pillar | Item id → the `## PILLAR N` heading above its `### [ ] \`[ID]\`` line in `AGENT-READABLE BACKLOG.md`, when the file exists at the project root | `(unattributed)`; no backlog file → the pillar table is omitted with a note |
| Session | `sessionId` (first 8 chars); a subagent transcript is its own row, `<session>/<agentId>`. Active minutes = sum of `turn_duration.durationMs` | Active time `—` (subagents have no `turn_duration`) |

Every token is counted exactly once per grouping, so each table sums to the total; the unattributed share is printed as a percentage.

### D5. Recommendations: four rules, each quoting its evidence

| Rule | Fires when | Line quotes |
|---|---|---|
| R1 repeated read | the same file is `Read` 5 or more times | file basename, count, estimated tokens |
| R2 unbounded read | a `Read` without `limit` returned more than 2k estimated tokens | count, largest estimate, its basename |
| R3 context peak | a session's peak context (`input + cache_read + cache_creation` of one request) exceeds 150k | session, peak, compactions in it |
| R4 cache miss | cache-read share of input falls below 80% | the share and the token counts it rests on |

No rule fires without a number. Thresholds are constants at the top of the script, named in the report header. More rules are out of scope until a measurement asks for one.

### D6. Fail-open, never a wrong number

- No log directory: one line, `cc-metrics: no session logs at <path>`, exit 0.
- An unparsable line (a session still being written ends mid-line) is skipped and counted in the header (`N unparsable lines`).
- A record of a known type without the expected field is skipped for that measure and counted as `not measured`.
- Any thrown error in the script prints `cc-metrics: failed: <message>` and exits 0. No stack trace.
- Estimates (result tokens) are labelled `est`.

### D7. Output stays small

Top 5 rows per table, one header, at most 4 recommendation lines. Bounded at about 45 lines regardless of log volume. Example (synthetic numbers):

```
cc-metrics: 12 logs (3 subagent), 31.0MB, 640 requests, 1 unparsable line, 1 compaction
tokens: in 1.2k out 402.5k cacheR 71.0M cacheW 1.4M | cache hit 98.0%
by tool (calls, est result tok, wall s):
  Bash          410   98.2k   2210
  Read          150  120.4k     51
  Grep           96   40.1k     30
by command (tokens):    (none) 61.0M 84% | cc-implement 6.1M | cc-spec 3.0M
by phase (tokens):      (none) 61.0M 84% | Build 6.1M | Define 5.5M
by branch (tokens):
  main                       30.2M
  fix/bug-061-hook-root       9.8M   BUG-061  P5
by pillar (tokens):     P5 14.0M 19% | P1 2.2M 3% | (unattributed) 56.2M 78%
by session (tokens, active min):
  4a1b2c3d                   22.0M   96
recommendations:
  - R1 README.md Read 7x (~18.0k est tok): grep before reading, or keep the fact in memory
  - R3 session 4a1b2c3d peaked at 171.3k context with 1 compaction: run /cc-compact earlier
thresholds: R1>=5 reads, R2>2k tok, R3>150k ctx, R4<80% cache
```

### D8. Command placement: project command, two byte-identical mirrors

`/cc-metrics` reads the project's backlog and the project slug, so it is a project command: `project-template/.claude/commands/cc-metrics.md` and `.claude/commands/cc-metrics.md`. It probes by presence, as `/cc-resume` does, so both copies are byte-identical:

```
M=.claude/scripts/session-metrics.mjs; [ -f "$M" ] || M=scripts/session-metrics.mjs; node "$M" $ARGUMENTS
```

The installer already copies all of `scripts/` to `.claude/scripts/` (`lib/installer/deploy.mjs:241`), so no installer change is needed.

## Behavior

### Main path

The user runs `/cc-metrics`. The agent runs one Bash command and relays stdout verbatim. The script resolves the log directory (D3), streams each file, aggregates (D4), evaluates D5, prints D7 and exits 0.

### Alternative paths

- `--dir <path>`: reads that directory instead of the slug directory.
- No backlog file: pillar table omitted, with `pillar: no AGENT-READABLE BACKLOG.md` in its place.

### Error cases

D6. The process never exits non-zero and never writes a file.

## Acceptance criteria

Mapped to the `[FEAT-046]` entry.

- [ ] **AC1** (read-only). The script opens files only for reading; it contains no `writeFile*`, `appendFile*`, `mkdir*`, `rm*`, `unlink*`, `rename*` or `createWriteStream`, asserted by a source scan. No hook or `settings.json` is touched. A test snapshots the fixture directory's file list and mtimes before and after a run and finds them unchanged.
- [ ] **AC2** (fail-open). A missing directory, an empty directory, a partial last line, an unknown record type and a record with no `usage` each produce a named note and exit 0; none throws.
- [ ] **AC3** (zero deps). `dependencies` in `package.json` stays `{}`; the script imports only `node:` modules; it runs on Node 20 (no `node:sqlite`).
- [ ] **AC4** (format breaks a test). Parsing lives in `scripts/session-metrics.mjs` with exported functions, covered by `tests/scripts/session-metrics.test.js` over synthetic fixtures shaped exactly like the census above. Renaming any field the parser reads in a fixture turns a named test red.
- [ ] **AC5** (evidence). Each of R1 to R4 fires on a fixture built to trip it, and its line contains the measured number from that fixture; none fires on the clean fixture.
- [ ] **AC6** (exactness). Usage repeated across three records with one `requestId` is counted once; each grouping table sums to the total.
- [ ] **AC7** (mirrors). Both command copies are byte-identical and probe the deployed script before the source one; `/cc-metrics` appears in `.github/wiki/pages/Commands-Reference.md` (the existing wiki-gen test enforces it) and in README's project command table.

## Fixture strategy

- Location: `tests/scripts/fixtures/session-metrics/` (not git-ignored, checked with `git check-ignore`).
- **Synthetic only.** Hand-written records using the census key names, placeholder ids (`sess-aaaa…`), branches like `fix/bug-999-fixture`, and file paths like `/fx/a.md`. No real transcript line is copied; real logs hold prompts, file contents and paths.
- Files: `clean/` (one main session, one subagent transcript, a compaction, a `Skill` call, a typed `<command-name>`), `partial/` (last line cut mid-JSON), `noisy/` (unknown types, a record without `usage`), `trip/` (crafted to fire R1 to R4), and a fixture `BACKLOG.md` with two pillar headings.
- Each fixture file stays under 40 lines, so the suite stays fast and the shapes stay reviewable.
- **Manual protocol, not in CI:** run against real logs and compare totals with M1. This is what catches a format change in a Claude Code release before the fixtures are updated.

## Predicted test impact

| Suite | Today | After | Why |
|---|---|---|---|
| `tests/scripts/session-metrics.test.js` | — | +16 (new) | AC1 to AC6: locator (2), parse and dedupe (3), each grouping (6), fail-open (2), recommendations (2), read-only (1) |
| `tests/installer/commands-parity.test.js` | unchanged count | +3 | byte-identical pair, probe line in each copy (`it.each` over 2) |
| `tests/wiki/wiki-gen.test.js` | unchanged count | 0 | "names every shipped command" goes red without the `Commands-Reference` row; the row lands in the same commit |
| `tests/unit/gitignore-block-parity.test.js` | unchanged count | 0 | goes red without the `!/.claude/commands/cc-metrics.md` leaf; the leaf lands in the same commit |
| `tests/installer/cli.test.js:197` | unchanged count | 0 | enumerates `scripts/` dynamically; picks up the new file |

Predicted net: **+19 passing, 0 red** at the end of each commit. The baseline is taken from `main` on the day implementation starts.

## Out of scope

- Dollar cost, OpenTelemetry export, an HTML dashboard (issue #82).
- Any write: `cache.db` ingestion, `phase-enter` rows, cached aggregates (D2).
- A `--since`/date filter, JSON output, per-file drill-down. Candidates for a later item once someone measures a need.
- A retroactive baseline for shipped Pillar 1 items, and renaming historical branches.
- Recommendations beyond R1 to R4.

## System impact

| Surface | Change | Protected |
|---|---|---|
| `scripts/session-metrics.mjs` | New, about 200 lines, functions ≤ 30 lines | No |
| `project-template/.claude/commands/cc-metrics.md` | New | No |
| `.claude/commands/cc-metrics.md` | New, byte-identical | No |
| `.gitignore` | One leaf: `!/.claude/commands/cc-metrics.md` | No |
| `tests/scripts/session-metrics.test.js`, `tests/scripts/fixtures/session-metrics/**` | New | No |
| `tests/installer/commands-parity.test.js` | One `describe` for the new pair | No |
| `.github/wiki/pages/Commands-Reference.md`, `README.md` (project command table only) | One row each | No |

No hook, installer, settings or SNAP file changes. Not touched, by rule: `VERSION`, package versions, `CHANGELOG.md`, `AGENT-READABLE BACKLOG.md`, README "Known limits".

## Risks

- **R-1. Undocumented format.** The log schema is Claude Code's internal format and can change in any release. Mitigated by AC4 (a renamed field fails a named test) and D6 (an unexpected shape becomes `not measured`, never a wrong number). The fixtures must be refreshed by hand when it changes.
- **R-2. Tool wall time includes permission waits.** The tool_use → tool_result delta includes time the user spent on a permission prompt. Labelled `wall s`, not `exec s`.
- **R-3. Privacy of output.** The report prints tool names, counts, branch names, command names and file basenames from `Read` inputs; it never prints prompt or result text. It goes to the terminal only.
- **R-4. Cross-project logs.** Only the current project's slug directory is read; other projects' transcripts are never opened.

## Complexity estimate

Small to medium. One script of about 200 lines, one command file mirrored, one test file with fixtures, three one-line doc and ignore edits.
