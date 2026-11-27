---
description: "(Conductor) Show the guard lanes and the latest hook decisions"
---

> code-conductor: this command was written for Claude Code. Where it names a Claude Code tool (Read, Grep, Glob, Edit, Write, Bash, Skill, Agent), use your closest equivalent. ` $ARGUMENTS ` and an `ARGUMENTS:` line mean the text the user gave with the command. A space was inserted after some exclamation marks and at signs, and between the arguments placeholder and an adjacent backtick, so OpenCode does not run or attach text; read the text as if the space were not there.


Run this one command from the project root and nothing else:

```bash
node .claude/flow-status.mjs --detail
```

Echo its output verbatim inside a code block. Add nothing before or after it: no summary, no interpretation, no advice.

The output lists one lane per tool family with each guard's pass, deny and ask counts, then the newest 20 events from `.claude/.flow-events.jsonl`. Do not open that file with the Read tool; Guard 4 denies it, and this command is the way to see it.

If the command fails, print its error output verbatim and stop.
