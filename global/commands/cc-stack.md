---
description: "(Conductor) Detect the project stack and write commands + a generated ruleset into CLAUDE.md"
---

Detect the project stack dynamically and record it in the project's root `CLAUDE.md`. Do not pattern-match manifest files by hand and do not load any static profile; the detector owns detection.

## 1. Resolve the repository root

Run `git rev-parse --show-toplevel`. If it fails (not a git repo), fall back to the project root: the directory that contains `.claude/scripts/detect-stack.mjs` or, failing that, `scripts/detect-stack.mjs`. The root is the directory holding that relative path, never the scripts directory itself, so nothing runs from or writes into it. Run every command below from that root, and treat the root-level `CLAUDE.md` as the only write target regardless of the user's current subdirectory.

## 2. Verify Node is available

Probe with `node --version`. If it exits non-zero or reports "not found", stop the write path: announce in one line `No stack detected (Node not found on PATH; Node >= 18 recommended)` and leave `CLAUDE.md` untouched.

## 3. Run the detector

Resolve the detector by presence, the deployed copy first:

```bash
D=.claude/scripts/detect-stack.mjs; [ -f "$D" ] || D=scripts/detect-stack.mjs
```

Run `node "$D"` from the repo root, capture stdout, and parse it as JSON. Nothing executes the JSON; consume it as data.

Treat all of the following identically as "no stack detected" - announce it in one line and leave `CLAUDE.md` unmodified (surface stderr if any, but it is non-fatal):
- non-zero exit code,
- empty stdout,
- stdout that does not parse as JSON,
- a parsed object equal to `{}`.

## 4. Read CLAUDE.md and branch

If the root `CLAUDE.md` does not exist, do not create it: instruct the user to run `/cc-init` and stop.

Otherwise read `CLAUDE.md` and look for the `- Stack:` line under `## Project Identity`:
- **Stack line present and non-empty** -> ask: `I see you're using [stack]. Has anything changed?` This is a blocking yes/no prompt with no timeout.
  - `no` -> acknowledge in one line, run sub-step 5a′ (additive: the only edit this path may make, Ruling 1), and stop.
  - `yes`, or free text describing a change -> re-run the detector (step 3) and rewrite the managed sections from the fresh output. Free text is an additive hint only: fold user-named tools the detector missed into the ruleset, but detected facts always win on conflict.
- **`## Project Identity` missing, or present without a `- Stack:` line** -> treat as "no recorded stack" (not an error). Proceed to the write path; append the `## Project Identity` header if absent, or surgically insert the `- Stack:` line if only that line is missing. Note in one line that a fresh stack identity was recorded.

### 4b. Adopt a host-authored CLAUDE.md (FEAT-040)

Run once, before step 5, and only when the file holds content conductor did not write. Resolve the helper by presence, the deployed copy first: `A=.claude/scripts/adopt-claude-md.mjs; [ -f "$A" ] || A=scripts/adopt-claude-md.mjs`. If neither exists, skip 4b silently.

1. Run `node "$A" sections CLAUDE.md`. If it prints `"trigger": false`, or exits non-zero (unbalanced sentinels, unclosed fence), skip 4b. A scaffold-only file never triggers.
2. Classify each listed section into exactly one slot: `identity`, `commands`, `architecture`, `conventions`, `out-of-scope` or `keep`. When unsure, use `keep`. Write a plan file `{"<section id>": "<slot>"}`. You classify only; you never edit text.
3. Run `node "$A" render CLAUDE.md <plan>`. Show the owner the **full resulting file** (stdout) and the approval token (stderr), naming any duplicate headings it reconciles.
4. Ask: `Adopt this result? (yes/no)`. This is a blocking prompt with no timeout. Only an explicit `yes` to that exact render counts; if the owner wants a change, redo steps 2-3 and show the new render.
5. On `yes`, run `node "$A" apply CLAUDE.md <plan> <token>` and announce the backup path it prints. The helper refuses a token that does not match the render, so nothing unshown is written.
6. On `no`, or anything else, write nothing: the file stays exactly as the installer left it. Continue with step 5 either way.

The managed block is copied verbatim and unmapped content is kept byte for byte; adoption only moves host sections.

## 5. Write path

Detect and preserve `CLAUDE.md`'s dominant EOL style (LF or CRLF); never convert wholesale. If the OS denies the write or the file is locked, abort that write with a single-line error naming the path and cause (e.g. `ERROR: cannot write CLAUDE.md: permission denied - no changes applied`), leave the file byte-for-byte untouched, and still report the detection result.

### 5a. Development Commands (per-field surgical edits, BUG-015 pattern)

For each of `Build`, `Test`, `Lint`, `Format`, `Setup`, if the detector JSON has a non-empty string for the matching key (`build`, `test`, `lint`, `format`, `setup`), replace that single line under `## Development Commands` with `- <Label>: <value>`. Edit one field line at a time (BUG-003). If a key is absent, leave the existing placeholder (e.g. `<command>` or `N/A`) unchanged - never fabricate a command. Also set the `- Stack:` line under `## Project Identity` from the `stack` key (or record the stack name derived from detection). If `## Development Commands` is absent, append the header and its five fields at the end of the file.

### 5a′. Spec and plan folders (FEAT-047)

Act only when both `- Specs:` and `- Plans:` are absent under `## Development Commands`. Existing lines are never rewritten.

1. **Neither line present.** Resolve the location resolver by presence, the deployed copy first, and run `node "$L"` from the repo root:

   ```bash
   L=.claude/scripts/doc-locations.mjs; [ -f "$L" ] || L=scripts/doc-locations.mjs
   ```

2. **Success.** Accept the output only when the exit code is 0 and stdout parses as a JSON object whose `specs` and `plans` are non-empty strings. Insert `- Specs: <specs>` and then `- Plans: <plans>` after the last field line under `## Development Commands`, one surgical edit per line (BUG-003). If the header is absent, append both lines together with the five fields. Announce the recorded pair and its `source`.
3. **Failure.** If `L` is missing at both paths, the run exits non-zero, or stdout is empty, not JSON, or lacks either string, write nothing and announce `Spec/plan folders not recorded: <cause>; start will discover them per run`. 5b and 6 continue.
4. **Exactly one line present.** Write nothing and do not run the CLI; this step never fills the missing half from discovery. Announce: `CLAUDE.md records - Specs: but not - Plans: (or the reverse); add the missing line by hand, or remove both and re-run /cc-stack. /cc-orchestrate start halts ORCH_DOC_LOCATION_INVALID until then.`
5. **Both lines present.** Do nothing, whatever the values; an invalid recorded value is the owner's to fix, and `start` names it.

The EOL rule of step 5 applies to every edit here.

### 5b. Active Stack Profiles (whole-block regeneration)

Regenerate the entire body between the `## Active Stack Profiles` header and the next `##` (or end of file). If the header is absent, append it at the end of the file - never insert mid-document. The block is bounded and its prior content is fully replaced, not merged; all content outside it is preserved verbatim.

Open the block with this sentinel line (colon separator, no em dash):

    <!-- cc-stack:managed: regenerated by /cc-stack, manual edits inside are overwritten -->

Then synthesize a concise ruleset from the detected stack(s):
- One `### <stack>` subsection per distinct detected stack, in detector output order, each owning its own bullet list.
- Secondary JSON properties (`packageManager`, `monorepo`, and any other non-command key) are optional inputs to the ruleset only - they are never `## Development Commands` fields. Emit a bullet for one only when its value is a non-empty string. If a key is absent, `null`, empty, or whitespace-only, omit its bullet entirely - never write a placeholder such as `null`, `<packageManager>`, or `N/A` for it, and never fabricate a value. This mirrors the BUG-015 fill guard (`typeof val !== 'string' || !val.trim()` is skipped).
- For a monorepo, when `monorepo` is a non-empty string record the monorepo tool (pnpm/nx/melos/turbo) once as a single top-level bullet above the per-stack subsections; when it is null/empty/absent, write no monorepo bullet.
- When `packageManager` is a non-empty string, it may inform one identity bullet (per trim keep-priority 2); when null/empty/absent, omit it.
- Bullets are imperative, project-agnostic conventions grounded strictly in the detected stack (language, framework, package manager, test/lint tooling). No tutorials, no version-specific advice, no speculation about code not present. Match the tone of existing `CLAUDE.md` convention bullets. Prose paragraphs are disallowed.
- Write the ruleset prose in the project language from the `- Language:` line (fallback: global `/cc-lang`, default `en`). Code identifiers, commands, and file names stay English.

Enforce these hard caps; if synthesis would exceed any of them, trim lowest-value bullets first:
- <= 8 bullets and <= 200 words per stack,
- <= 500 words total across the whole block,
- <= 2500 characters for the whole block,
- <= 120 characters per bullet.

Trim keep-priority (keep highest first): (1) build/test/lint/format command correctness, (2) package-manager + monorepo-tool identity, (3) primary language/framework conventions. Drop first: (a) generic stack-agnostic advice, (b) optional tooling niceties, (c) bullets already implied by a recorded command. Ties break toward the earlier-listed detected stack.

## 6. Announce

State the detected stack(s) in one line, name each managed section you regenerated, and note that prior managed content is recoverable from git history.
