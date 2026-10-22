---
description: "(Conductor) Show the guard lanes and the latest hook decisions"
---

Run this one command from the project root and nothing else:

```bash
node .claude/flow-status.mjs --detail
```

Echo its output verbatim inside a code block. Add nothing before or after it: no summary, no interpretation, no advice.

The output lists one lane per tool family with each guard's pass, deny and ask counts, then the newest 20 events from `.claude/.flow-events.jsonl`. Do not open that file with the Read tool; Guard 4 denies it, and this command is the way to see it.

If the command fails, print its error output verbatim and stop.
