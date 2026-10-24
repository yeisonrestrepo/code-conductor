---
description: "(Conductor) Report token and time spend from local session logs, with recommendations"
argument-hint: "[--dir <log directory>]"
---

Read-only. This command reads Claude Code's local session logs for this project and prints one compact report. It registers no hook and writes no file.

## Step 1 — Run the reader

Resolve the reader by presence, the deployed copy first, and run it once:

```bash
M=.claude/scripts/session-metrics.mjs; [ -f "$M" ] || M=scripts/session-metrics.mjs; node "$M" '$ARGUMENTS'
```

If neither file exists, output `"cc-metrics: reader not found. Run the installer with --project."` and stop.

## Step 2 — Relay the report

Output the reader's stdout verbatim, inside one code block. Do not open, grep or summarize the log files yourself: the report already holds every number, and reading the logs would spend the tokens this command measures.

Every recommendation line quotes the number it rests on. Values labelled `est` are estimates (characters / 4). A line starting `cc-metrics: no session logs at` or `cc-metrics: failed:` is the whole report: relay it and stop. From a git worktree, the project's logs live under the main checkout's directory; pass it with `--dir`.
