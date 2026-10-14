# Flow viewer design spec

**Issue:** #57
**Date:** 2026-10-13
**Status:** Candidate (unminted; the id is assigned by the maintainer)

This is a design document only. No code ships with it. Implementation starts when the owner mints an id and approves this spec, after the queue named in the issue's triage comment.

---

## Problem

A session under code-conductor is opaque to the person running it. The `PreToolUse` hook decides every `Read`, `Write`, `Edit`, `Bash`, `Agent` and `SendMessage` call, and the only trace of a decision is a denial message inside the agent's own transcript. An allow leaves no trace at all. There is no way to see which guard fired, how often, or on which tool, without reading the transcript line by line.

## Solution

Two parts, both with no runtime dependencies and no background process:

1. **Emitter.** The `PreToolUse` hook appends one line per routed tool call to `.claude/flow-events.js`, after its decision is already written.
2. **Viewer.** A single static page, `.claude/flow-viewer.html`, deployed by the installer. Opened from disk, it re-reads the event file every 1.5 seconds and draws the guard pipeline as inline SVG with a newest-first event log.

## Measurements

The triage comment asked for the open technical notes to be measured at spec time. Taken on 2026-10-13: Windows 11, Node v24.16.0, Chrome 155.0.8059.79, Edge 155.0.4283.45, both browsers headless.

| # | Question | Result |
|---|---|---|
| M1 | Does `fetch('./events.jsonl')` work from a `file://` page? | No. `Failed to fetch` in Chrome and in Edge. |
| M2 | Does a `<script src="./events.js?t=…">` element load from a `file://` page, and reload when re-inserted with a new query string? | Yes, in both. Two insertions ran the file twice. |
| M3 | Cost of `statSync` plus `appendFileSync` for one 258-byte line, 500 writes, two rounds | p50 0.27 to 0.28 ms, p95 0.42 to 0.46 ms, p99 0.59 to 0.64 ms, max 1.19 to 1.28 ms |
| M4 | Cost of one rotation: read 500 lines, rewrite the last 250 | 18.4 ms, one sample |
| M5 | Node cold start, the hook's fixed cost per call | 45 to 55 ms, five samples |

M1 confirms triage note 1: the issue's fifth acceptance criterion does not hold with `fetch`. M2 is what keeps it reachable by another transport. M3 against M5 puts the write at under 1% of what the hook already costs per call.

**Not measured:** Firefox and Safari, macOS and Linux, a disk behind real-time antivirus scanning, and two hook processes appending at the same instant. The last one is risk R1 and the plan's first task.

## Decisions

Each one names the choice, the alternative, and where it departs from the issue as written.

### D1. Transport: a script file, not JSONL plus `fetch`

The event file is `.claude/flow-events.js`. Each line is one complete statement:

```
flowEvent({"ts":1760364151000,"tool":"Bash","verdict":"deny","guard":3,"code":"P5 P9","target":"git","passed":[7]});
```

The viewer defines `window.flowEvent`, inserts a `<script>` element pointing at the file with a cache-busting query, and removes the element on load. The append stays one line per event.

- **Departs from the issue:** the file is not named `.flow-events.jsonl` and is not JSON Lines. Stripping the `flowEvent(` prefix and the `);` suffix from a line leaves plain JSON.
- **Alternative:** keep JSONL and require `npx serve`. That drops the "no server required" criterion and has the user download and run a third-party package to look at a local file.
- **Safety of executing the file:** the line is `'flowEvent(' + JSON.stringify(event) + ');'`. JSON text is a valid ECMAScript expression, so no value inside the event can leave the literal. The emitter is the only writer.

### D2. Renderer: hand-written inline SVG, no Mermaid

The graph is a fixed set of lanes that mirrors the hook's `DISPATCH` table (D3). A fixed topology needs no layout engine, so the viewer carries its own SVG and makes no network request of any kind. This answers triage note 2 without inlining a multi-megabyte library.

### D3. Topology: guard lanes, not command stages

The issue draws `init → stack → spec → plan → implement` with guards branching off each stage. The hook cannot see stages: its matcher is `Read|Write|Edit|create_file|write_file|Bash|Agent|SendMessage`, and a slash command reaches Claude Code as a prompt, not as a tool call. What the hook does know exactly is which guards ran on which tool, in which order.

So the graph is one lane per tool family, with the guards in dispatch order:

| Lane | Guards, in order |
|---|---|
| Read | 4, 1 |
| Write, create_file, write_file | 5, 6, 2 |
| Edit | 5, 6 |
| Bash | 7, 3 |
| Agent, SendMessage | 6 |

- **Departs from the issue:** no stage row in this item.
- **Alternative, left for the owner:** a second emitter on `UserPromptSubmit` that records a stage when a prompt starts with `/cc-`. It adds a hook file, a `settings.json` entry and a fingerprint, on two more protected surfaces. Whether that payload carries a slash command's raw text was not verified. Recommended as its own candidate once the guard lanes have shipped.

### D4. On by default, with one switch

The emitter runs unless `CC_FLOW_OFF` is set. A viewer that ships disabled shows an empty graph to everyone who opens it, and M3 puts the cost of leaving it on below the noise of M5. This is the owner's call; the opposite default is a one-line change.

### D5. What an event records

| Field | Value |
|---|---|
| `ts` | Epoch milliseconds |
| `tool` | `tool_name` from the payload |
| `verdict` | `allow`, `deny` or `ask` |
| `guard` | Number of the guard that decided, or `null` on allow |
| `code` | Short reason token on deny or ask: `BAND_SCOPE_VIOLATION`, `P5 P9`. Capped at 80 characters |
| `target` | File tools: the path relative to the payload's `cwd`. Bash: the first word of the command. Agent: the agent type. Capped at 200 characters |
| `passed` | Numbers of the guards that ran and passed before the decision |

Full Bash command text is never written. Commands carry inline tokens and passwords often enough that a convenience log must not hold them, even one that is git-ignored.

### D6. No `post-tool-use` hook

The issue names `post-tool-use.mjs`. This repository has no such hook, and every guard verdict exists before the tool runs. Adding one would be a new hook on a protected surface for no event the viewer needs.

### D7. Rotation by size

The issue caps the file at 500 lines, rotated on write. Counting lines means reading the file on every tool call. Instead the emitter takes the size from `statSync` and rotates when the file passes 160 KiB, about 500 events at the capped line length: it keeps the last 250 lines, written to a temporary file and renamed over the original. The viewer shows at most the newest 500 events regardless.

- **Departs from the issue:** the bound is bytes, so the line count at rotation varies.

## Behavior

### Main path

1. Claude Code invokes the hook. The guards run exactly as they do today.
2. The hook writes its decision to stdout, or nothing on a plain allow, exactly as today.
3. Only then does the hook build the event, check the file size, rotate if needed, and append one line.
4. The viewer's next poll re-runs the file, rebuilds per-guard counts and the log from the events, and repaints.

### Alternative paths

- `CC_FLOW_OFF` set: no file is created or touched.
- No `.claude/` directory under the payload's `cwd`: nothing is written. The emitter never creates directories.
- A tool with no dispatch entry, or a payload that does not parse: nothing is written. The second case has no tool to name.
- The viewer is opened before any event exists: the script load fails, and the viewer shows the idle graph with "no events yet" and keeps polling.

### Error cases

The hook's outermost `catch` fails closed: any throw becomes a denial unless `CC_HOOK_ALLOW` is set (`pre-tool-use.mjs:805`). An emitter error that reached it would turn a full disk into a denied tool call. Three rules follow, and each has a test:

- The emitter body sits inside its own `try`/`catch` that swallows every error. It reports through `debug()` only.
- The emitter runs after `emit(decision)`. It can never delay, change or suppress a decision.
- The emitter adds no top-level statement that can throw at load. Its new imports are `node:fs` names only.

In the viewer, a file that fails to parse leaves the previous state on screen, shows "event file unreadable, retrying", and clears on the next good load. Event fields reach the page through `textContent` only, because `target` is derived from tool input.

## Acceptance criteria

Mapped to the issue's five, with the departures above applied.

- [ ] **AC1** (issue 1). Every routed tool call appends exactly one event line with the D5 fields. A deny from each of guards 1 to 7 records that guard's number.
- [ ] **AC2** (issue 1, fail-open). With the event path unwritable, the hook's stdout, stderr and exit code are byte-identical to a run with `CC_FLOW_OFF` set, on an allow, a deny and an ask.
- [ ] **AC3** (issue 2). The viewer draws the D3 lanes and updates counts, last verdict and the log from the event file without a reload. Verified by the manual protocol in the plan; no browser runs in CI.
- [ ] **AC4** (issue 2, drift). A test fails when a guard number in the hook's dispatch has no node in the viewer, or the reverse.
- [ ] **AC5** (issue 3). `--project` deploys `flow-viewer.html` and prints one line naming its path.
- [ ] **AC6** (issue 4). The file rotates past 160 KiB to its last 250 lines, and the template `gitignore` ignores it.
- [ ] **AC7** (issue 5). The viewer works from `file://` in Chrome and Edge with no server, and contains no `http://` or `https://` URL.
- [ ] **AC8.** `dependencies` in `package.json` is still `{}`. Both copies of the hook are byte-identical.
- [ ] **AC9.** No Bash command text beyond its first word appears in any event.

## Out of scope

- The stage row and any `UserPromptSubmit` emitter (D3).
- Phase 2 of the issue: the SSE server.
- A `post-tool-use` hook (D6).
- History beyond the rotation window, filtering, search, export.
- Events from the bash hooks (`context-guard`, `verbosity-remind`, `post-compact`).
- A numeric latency gate in CI. Timing assertions on shared runners are flaky; M3 is reported, not enforced.

## System impact

| Surface | Change | Protected |
|---|---|---|
| `project-template/.claude/hooks/pre-tool-use.mjs` | Emitter, guard-number table, call in `main()` | Yes |
| `.claude/hooks/pre-tool-use.mjs` | Same bytes; the copies are identical today | Yes |
| `project-template/.claude/flow-viewer.html` | New. Copied by the existing `cpSync` at `deploy.mjs:217` | No |
| `lib/installer/deploy.mjs` | One `report()` line in `deployProject` | Yes |
| `project-template/gitignore` | One line: `.claude/flow-events.*` | No |
| `tests/installer/templates.test.js` | The pinned ignore-line lists at lines 78 and 86 gain the entry | No |
| `tests/hooks/flow-events.test.js`, `tests/installer/flow-viewer.test.js` | New | No |

Guard 3's frozen authority, `tests/fixtures/guard3-reference.sh`, is not touched. No guard's decision logic changes.

Not touched, by rule: `VERSION`, the `version` fields of `package.json` and `package-lock.json`, `CHANGELOG.md`, `AGENT-READABLE BACKLOG.md`, and "Known limits" in `README.md`. Those are written owner-side at release.

### Files requiring full read (deferred to the plan)

- `project-template/.claude/hooks/pre-tool-use.mjs`, lines 746 to 805
- `tests/hooks/pre-tool-use-contract.test.js`
- `tests/installer/templates.test.js`, lines 60 to 95
- `tests/unit/host-owned-ignore-xor.test.js`

## Risks

- **R1. Torn lines under parallel appends.** Claude Code runs tool calls in parallel, so two hook processes can append at once. One malformed line makes the whole script file fail to parse, and the viewer goes blind until the next rotation. JSONL would lose one line; this transport loses the file. Not measured. The plan measures it first, on all three CI operating systems, and falls back to JSONL plus a documented server step if a torn line is ever observed.
- **R2. Firefox and Safari.** M2 covers Chromium only.
- **R3. Hook size.** The hook is 805 lines in one file by design. The emitter adds about 40.
- **R4. Rotation spike.** M4 is 18 ms about once per 250 events. It happens after the decision is written, so the user-visible cost is a late hook exit, not a late decision.

## Complexity estimate

Medium. About 40 lines in the hook, one static page of about 300 lines, one installer line, two new test files, one pinned-list update. The risk is concentrated in R1 and in the fail-open rules, not in the volume.
