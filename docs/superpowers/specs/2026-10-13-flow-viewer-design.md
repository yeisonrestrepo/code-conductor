# Flow viewer design spec

**Issue:** #57
**Date:** 2026-10-13, revised 2026-10-18
**Status:** Candidate (unminted; the id is assigned by the maintainer)

This is a design document only. No code ships with it. Implementation starts when the owner mints an id and approves this spec, after the queue named in the issue's triage comment.

**Revision 2026-10-18.** The first draft made a static HTML page the primary display. The proofs of concept in #83 backed the emitter and the event file, but not that page as the place users look. This revision moves the primary display into the CLI: a status line, plus a `/cc-flow` command for detail. The HTML page becomes optional, for debugging guards (D2). It also folds in the amendments #83 measured: a locked rotation (D7), `VAR=value` skipping, an `agent` field and guard-owned reason codes (D5), and a Guard 4 entry for the event file (D8). The emitter, its transport (D1) and fail-open (AC2) are unchanged.

---

## Problem

A session under code-conductor is opaque to the person running it. The `PreToolUse` hook decides every `Read`, `Write`, `Edit`, `Bash`, `Agent` and `SendMessage` call, and the only trace of a decision is a denial message inside the agent's own transcript. An allow leaves no trace at all. There is no way to see which guard fired, how often, or on which tool, without reading the transcript line by line.

## Solution

Three parts, none with runtime dependencies or a background process:

1. **Emitter.** The `PreToolUse` hook appends one line per routed tool call to `.claude/flow-events.js`, after its decision is already written.
2. **Status line (primary display).** A script, `.claude/flow-status.mjs`, that Claude Code runs as its status line. It reads the tail of the event file and prints one line, always visible, for example `⛔ G3 P9 · 12 calls · 3 deny`. It needs no browser, costs no tokens, and adds nothing to the transcript.
3. **`/cc-flow` (on demand).** A slash command that prints the D3 lanes with per-guard counts and the latest events as text.

## Measurements

The triage comment asked for the open technical notes to be measured at spec time. Taken on 2026-10-13: Windows 11, Node v24.16.0, Chrome 155.0.8059.79, Edge 155.0.4283.45, both browsers headless.

| # | Question | Result |
|---|---|---|
| M1 | Does `fetch('./events.jsonl')` work from a `file://` page? | No. `Failed to fetch` in Chrome and in Edge. |
| M2 | Does a `<script src="./events.js?t=…">` element load from a `file://` page, and reload when re-inserted with a new query string? | Yes, in both. Two insertions ran the file twice. |
| M3 | Cost of `statSync` plus `appendFileSync` for one 258-byte line, 500 writes, two rounds | p50 0.27 to 0.28 ms, p95 0.42 to 0.46 ms, p99 0.59 to 0.64 ms, max 1.19 to 1.28 ms |
| M4 | Cost of one rotation: read 500 lines, rewrite the last 250 | 18.4 ms, one sample |
| M5 | Node cold start, the hook's fixed cost per call | 45 to 55 ms, five samples |

Taken in #83 on candidate code:

| # | Question | Result |
|---|---|---|
| M6 | Hook p50 with the emitter, against a 56 to 62 ms baseline | −1 to +2 ms (noise) |
| M7 | Torn lines under parallel appends: 16 processes × 500 appends, and 64 KiB lines | 0 |
| M8 | Rotation as first specified (unlocked rename) | Fails on Windows: `EPERM`, 11 to 206 errors per run |
| M9 | Rotation under a `wx` lock, 960 parallel calls | 0 errors, 0 torn lines, 0 leftover files |
| M10 | Fail-open (AC2) on an allow, a deny and an ask | Byte-identical to a `CC_FLOW_OFF` run |

M3 and M6 against M5 put the write within the hook's existing noise. M8 is why D7 changed.

**Not measured:** macOS and Linux for M7 to M9, a disk behind real-time antivirus scanning, and how often Claude Code refreshes the status line on the current release (T-001-B).

## Decisions

Each one names the choice, the alternative, and where it departs from the issue as written.

### D1. Transport: a script file, not JSONL plus `fetch`

The event file is `.claude/flow-events.js`. Each line is one complete statement:

```
flowEvent({"ts":1760364151000,"tool":"Bash","verdict":"deny","guard":3,"code":"P5 P9","target":"git","agent":null,"passed":[7]});
```

Stripping the `flowEvent(` prefix and the `);` suffix from a line leaves plain JSON. The status line and `/cc-flow` do exactly that. The wrapper exists so the optional HTML page (D2) can load the file from `file://` through a `<script>` element (M1, M2) without a server.

- **Departs from the issue:** the file is not named `.flow-events.jsonl` and is not JSON Lines.
- **Alternative:** plain JSONL. That is simpler for the two CLI readers, and the right choice if the owner drops the HTML page (D2, option b). It is a one-line change in the emitter and the readers.
- **Safety of executing the file:** the line is `'flowEvent(' + JSON.stringify(event) + ');'`. JSON text is a valid ECMAScript expression, so no value inside the event can leave the literal. The emitter is the only writer.

### D2. Display: status line first, `/cc-flow` on demand, HTML optional

| Surface | Role | When the user sees it |
|---|---|---|
| Status line | Primary | Always, below the prompt |
| `/cc-flow` | Detail | When asked |
| `flow-viewer.html` | Debugging guards, demos | Opened by hand |

**Status line.** Claude Code runs the configured command on conversation updates and shows the first line of its stdout. It passes session JSON on stdin; the script uses only the working directory from it. The script reads at most the last 32 KiB of the event file, never the whole file, and prints one line:

| State | Line |
|---|---|
| No event file | Nothing (an empty line; the status line stays blank) |
| Events, last one a deny | `⛔ G3 P9 · 12 calls · 3 deny` |
| Events, last one an ask | `? G2 · 12 calls · 1 ask` |
| Events, last one an allow | `✓ 12 calls · 3 deny` |
| Unreadable tail | `flow: unreadable, retrying` |

The counts cover the current session: events are filtered to `ts` at or after the session's first event in the tail. The script exits 0 on every path, including a thrown error, which prints nothing. A failing status line must never show a stack trace under the prompt.

**`/cc-flow`.** A command file under `.claude/commands/`. It runs `node .claude/flow-status.mjs --detail`, which prints the D3 lanes, one row per lane with per-guard pass and deny counts, then the newest 20 events, one per line. The agent echoes the output and adds nothing. The command costs one tool call and its output tokens, and only when the user asks.

**HTML page.** The first draft's viewer: the D3 lanes as inline SVG, polling the event file through a `<script>` element (D1). It is no longer the primary display, and whether it ships is the owner's call:

- **(a) Ship it, not deployed by default.** It lives in the repository for maintainers tuning guards and for demos. `--project` does not copy it. This is the recommended option.
- **(b) Drop it.** D1 then switches to JSONL.

The proof of concept in #83 also ran the display as a Claude Code plugin band ("`cc-flow` mod"). That needs the plugin to be installed and deployed by the installer, which is a larger protected-surface change than a status line. It is not proposed here.

### D3. Topology: guard lanes, not command stages

The issue draws `init → stack → spec → plan → implement` with guards branching off each stage. The hook cannot see stages: its matcher is `Read|Write|Edit|create_file|write_file|Bash|Agent|SendMessage`, and a slash command reaches Claude Code as a prompt, not as a tool call. What the hook does know exactly is which guards ran on which tool, in which order.

So `/cc-flow` (and the optional HTML page) shows one lane per tool family, with the guards in dispatch order:

| Lane | Guards, in order |
|---|---|
| Read | 4, 1 |
| Write, create_file, write_file | 5, 6, 2 |
| Edit | 5, 6 |
| Bash | 7, 3 |
| Agent, SendMessage | 6 |

- **Departs from the issue:** no stage row in this item.
- **Alternative, left for the owner:** a second emitter on `UserPromptSubmit` that records a stage when a prompt starts with `/cc-`. It adds a hook file, a `settings.json` entry and a fingerprint, on two more protected surfaces. Recommended as its own candidate once the guard lanes have shipped.

### D4. On by default, with one switch

The emitter runs unless `CC_FLOW_OFF` is set. With it set, the status line is blank and `/cc-flow` says the flow log is off. M6 puts the cost of leaving the emitter on inside the hook's noise. This is the owner's call; the opposite default is a one-line change.

### D5. What an event records

| Field | Value |
|---|---|
| `ts` | Epoch milliseconds |
| `tool` | `tool_name` from the payload |
| `verdict` | `allow`, `deny` or `ask` |
| `guard` | Number of the guard that decided, or `null` on allow |
| `code` | Short reason token on deny or ask, returned by the guard itself: `BAND_SCOPE_VIOLATION`, `P5 P9`. Capped at 80 characters |
| `target` | File tools: the path relative to the payload's `cwd`. Bash: the first word of the command after skipping leading `VAR=value` words. Agent: the agent type. Capped at 200 characters |
| `agent` | `agent_type` from the payload when a band role made the call, else `null` |
| `passed` | Numbers of the guards that ran and passed before the decision |

Full Bash command text is never written. Commands carry inline tokens and passwords often enough that a convenience log must not hold them, even one that is git-ignored. #83 found the first-word rule alone leaking `TOKEN=sk-… curl` as the target, which is why `VAR=value` words are skipped.

Each guard returns its own `code`. The readers never parse the human-readable reason text, so rewording a denial message cannot break the display.

### D6. No `post-tool-use` hook

The issue names `post-tool-use.mjs`. This repository has no such hook, and every guard verdict exists before the tool runs. Adding one would be a new hook on a protected surface for no event the display needs.

### D7. Rotation by size, under a lock

The issue caps the file at 500 lines, rotated on write. Counting lines means reading the file on every tool call. Instead the emitter takes the size from `statSync` and rotates when the file passes 160 KiB, about 500 events at the capped line length:

1. Take `.claude/flow-events.lock` with `openSync(…, 'wx')`. If it exists and is older than 10 s, break it and retry once; a hook that died mid-rotation must not stop rotation forever. If it is held, skip rotation this call and just append.
2. Keep the last 250 lines that parse, write them to a temporary file, rename it over the original, release the lock.

Before each append, the emitter reads the file's last byte. If it is not a newline, the tail is torn, and the emitter rotates (step 1 and 2) so the unparseable line is dropped instead of fused with the next append.

- **Departs from the issue:** the bound is bytes, so the line count at rotation varies.
- **Why the lock:** M8. The unlocked rename fails with `EPERM` on Windows under parallel hook processes; M9 is the locked version.

### D8. Guard 4 covers the event file

Guard 4 already blocks reads under `node_modules/`. It also blocks `Read` of `.claude/flow-events.js`, so the agent does not pull its own audit log into context. The status line and `/cc-flow` read it from Node, not through the `Read` tool, so they are unaffected.

## Behavior

### Main path

1. Claude Code invokes the hook. The guards run exactly as they do today.
2. The hook writes its decision to stdout, or nothing on a plain allow, exactly as today.
3. Only then does the hook build the event, check the tail and the size, rotate if needed (D7), and append one line.
4. On its next refresh the status line reads the tail and repaints.

### Alternative paths

- `CC_FLOW_OFF` set: no file is created or touched. The status line is blank.
- No `.claude/` directory under the payload's `cwd`: nothing is written. The emitter never creates directories.
- A tool with no dispatch entry, or a payload that does not parse: nothing is written. The second case has no tool to name.
- No event file yet: the status line is blank; `/cc-flow` prints the idle lanes and "no events yet".
- The host already has a status line configured: see "Installer" below.

### Error cases

The hook's outermost `catch` fails closed: any throw becomes a denial unless `CC_HOOK_ALLOW` is set (`pre-tool-use.mjs:805`). An emitter error that reached it would turn a full disk into a denied tool call. Three rules follow, and each has a test:

- The emitter body, rotation and lock included, sits inside its own `try`/`catch` that swallows every error. It reports through `debug()` only.
- The emitter runs after `emit(decision)`. It can never delay, change or suppress a decision.
- The emitter adds no top-level statement that can throw at load. Its new imports are `node:fs` names only.

The status line script follows the same rule in its own process: every path exits 0, and an error prints nothing. Event fields are printed as data and never evaluated; the readers strip the wrapper and use `JSON.parse`, never `eval`.

### Installer

The status line is configured in the project's `.claude/settings.json`:

```json
"statusLine": { "type": "command", "command": "node .claude/flow-status.mjs" }
```

`settings.json` is a protected surface, and a project-level `statusLine` overrides one the user set globally. So:

- `--project` adds the entry only when neither the project's nor the user's `settings.json` has a `statusLine`. Otherwise it leaves both untouched and prints one line saying the flow status line was skipped and how to add it by hand.
- An existing `statusLine` is never modified or removed, consistent with the installer's rule of keeping host-modified blocks byte-identical.
- **Owner approval required** for this entry before implementation. It is the one change in this item to a host-owned file.

## Acceptance criteria

Mapped to the issue's five, with the departures above applied.

- [ ] **AC1** (issue 1). Every routed tool call appends exactly one event line with the D5 fields. A deny from each of guards 1 to 7 records that guard's number and its own `code`.
- [ ] **AC2** (issue 1, fail-open). With the event path unwritable, the hook's stdout, stderr and exit code are byte-identical to a run with `CC_FLOW_OFF` set, on an allow, a deny and an ask.
- [ ] **AC3** (issue 2). Given a seeded event file, `flow-status.mjs` prints the D2 line for each state in its table, exits 0 on every one, and reads no more than the last 32 KiB. `--detail` prints every D3 lane.
- [ ] **AC4** (issue 2, drift). A test fails when a guard number in the hook's dispatch has no lane entry in `flow-status.mjs`, or the reverse.
- [ ] **AC5** (issue 3). `--project` deploys `flow-status.mjs` and `/cc-flow`, and adds the `statusLine` entry only under the D2 installer rule. A host `statusLine` at either level is left byte-identical, and the skip prints one line.
- [ ] **AC6** (issue 4). Past 160 KiB the file rotates to its last 250 parseable lines under the D7 lock. A stale lock older than 10 s is broken. A torn tail is dropped, not fused. The template `gitignore` ignores `.claude/flow-events.*`.
- [ ] **AC7** (issue 5). No surface needs a server. The status line and `/cc-flow` need no browser. If D2 option (a) is chosen, the HTML page works from `file://` in Chrome and Edge and contains no `http://` or `https://` URL.
- [ ] **AC8.** `dependencies` in `package.json` is still `{}`. Both copies of the hook are byte-identical.
- [ ] **AC9.** No Bash command text beyond its first non-`VAR=value` word appears in any event.
- [ ] **AC10.** Guard 4 denies `Read` of `.claude/flow-events.js`.

## Out of scope

- The stage row and any `UserPromptSubmit` emitter (D3).
- A Claude Code plugin band as the display (D2).
- Phase 2 of the issue: the SSE server.
- A `post-tool-use` hook (D6).
- History beyond the rotation window, filtering, search, export.
- Events from the bash hooks (`context-guard`, `verbosity-remind`, `post-compact`).
- A numeric latency gate in CI. Timing assertions on shared runners are flaky; M3 and M6 are reported, not enforced.

## System impact

| Surface | Change | Protected |
|---|---|---|
| `project-template/.claude/hooks/pre-tool-use.mjs` | Emitter, lock, guard-number table, guard `code` returns, Guard 4 entry, call in `main()` | Yes |
| `.claude/hooks/pre-tool-use.mjs` | Same bytes; the copies are identical today | Yes |
| `project-template/.claude/flow-status.mjs` | New. Status line and `--detail` | No |
| `project-template/.claude/commands/cc-flow.md` | New. `/cc-flow` | No |
| `project-template/.claude/settings.json` handling in `lib/installer/deploy.mjs` | Conditional `statusLine` merge and one `report()` line | Yes, owner approval |
| `project-template/gitignore` | One line: `.claude/flow-events.*` | No |
| `tests/installer/templates.test.js` | The pinned ignore-line lists at lines 78 and 86 gain the entry | No |
| `tests/hooks/flow-events.test.js`, `tests/installer/flow-status.test.js` | New | No |
| `tools/flow-viewer.html` | New, only under D2 option (a); not deployed | No |

Guard 3's frozen authority, `tests/fixtures/guard3-reference.sh`, is not touched. No guard's allow or deny logic changes; guards gain a returned `code` and Guard 4 gains one path.

Not touched, by rule: `VERSION`, the `version` fields of `package.json` and `package-lock.json`, `CHANGELOG.md`, `AGENT-READABLE BACKLOG.md`, and "Known limits" in `README.md`. Those are written owner-side at release.

### Files requiring full read (deferred to the plan)

- `project-template/.claude/hooks/pre-tool-use.mjs`, lines 746 to 805
- `lib/installer/deploy.mjs`, the `settings.json` merge
- `tests/hooks/pre-tool-use-contract.test.js`
- `tests/installer/templates.test.js`, lines 60 to 95
- `tests/installer/deploy.test.js`, the host-modified `settings.json` cases
- `tests/unit/host-owned-ignore-xor.test.js`

## Risks

- **R1. Torn lines under parallel appends.** M7 saw none on Windows, and D7's tail check drops one if it happens. Still to measure on macOS and Linux (T-001-A).
- **R2. Status line refresh cadence.** The line is only as fresh as Claude Code's refresh. If it refreshes only on assistant messages, a deny shows at the end of the turn, not the instant it happens. Acceptable for a summary line; T-001-B records the cadence.
- **R3. Host status line.** Users who already have a status line do not get this one by default (D2 installer rule). They see the flow log through `/cc-flow` only, unless they compose the two by hand.
- **R4. Hook size.** The hook is 805 lines in one file by design. The emitter and lock add about 70.
- **R5. Rotation spike.** M4 is 18 ms about once per 250 events. It happens after the decision is written, so the user-visible cost is a late hook exit, not a late decision.

## Complexity estimate

Medium. About 70 lines in the hook, a status script of about 120 lines, one command file, a conditional installer merge, two new test files, one pinned-list update. The risk is concentrated in the installer's `settings.json` rule and in the fail-open rules, not in the volume.
