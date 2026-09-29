# Show HN draft

**Nothing here publishes from an agent session.** Posting is the owner's act. This file is for review.

## Title candidates

Strongest first.

1. **Show HN: My Claude Code guard punished obedience to its own advice, so I rebuilt it until every denial was true**
2. **Show HN: I made my AI agent's guardrails prove themselves, and found the flagship one had never fired**
3. **Show HN: Thirteen releases in five days, every claim bisectable to a commit**
4. **Show HN: A governance layer for Claude Code where the release verifies its own changelog**
5. **Show HN: The bug that opened the chain was cosmetic. It took eight releases to reach the bottom**

Title 1 is the strongest because it states a specific, checkable, slightly humiliating fact. Title 3 is the weakest of the five: velocity is not a virtue and a reader is right to be suspicious of it.

---

## Body

**Word count: 583**, counted by script over the body between the horizontal rules, not estimated. Under the 600 ceiling.

---

code-conductor is a governance layer for Claude Code sessions: hooks that check what the agent may run before it runs, memory that survives compaction, and release instruments that assert the record against itself. It started as a personal config. It became something I would show you because of what auditing it turned up.

The chain opened on a cosmetic bug. `git add` was printing a warning on files that staged correctly, because `.gitignore` excluded `.claude/` wholesale and every tracked file inside it had an ignored ancestor. Annoying, not interesting.

Chasing it, I found something worse. The flagship guard, a scanner that blocks mass content dumps like `cat *.ts` before they burn the context window, **had a check that had never once fired correctly in the shape I believed it did.** Then a walk through the command string turned out to slice by match *length* instead of match *index*, marching a cursor through the command seven bytes at a time until it landed inside a quoted region and reported an unquoted glob that was not there. The guard was fabricating the evidence for its own denials.

Worse than fabricating: it punished obedience. The guard's deny message tells you to use targeted greps instead of dumps. Doing exactly that produced commands the guard then denied, because it read quoted patterns as code. I recovered every denial from one real working session and re-scanned each one: **47 events, 43 unique commands.** The population grew from 41 to 43 mid-measurement, because two of the scripts I wrote to perform the measurement were themselves denied by the bug I was measuring.

The fixes flipped **36 of 43** from deny to allow with **zero unplanned regressions**, because the rows that moved were written down as acceptance cases before any code changed.

Then the same class again, in a different costume: the scanner read **heredoc bodies** as command text. Writing a file whose content contained a `[` or an apostrophe was denied by patterns built to catch reads. Four specimens accumulated across four consecutive sessions before I fixed it, and the argument turned out to be one sentence: a heredoc body is content being *written*, already inside the command string the scanner is holding. It cannot flood anything.

Thirteen releases in five days, each with its red states predicted by suite and by case name before they ran. The discipline that made it survivable: **no claim without a measurement, and instruments are as suspect as the code they measure.** A version gate that reported FAIL on five locations that agreed. An id counter that read a plan file's prediction of its own output back as evidence. A test whose label announced "111 rows" while asserting 127. Each is in a registry of retired instruments, so the next one gets written by someone who has met the list.

**What it is not:** not a sandbox, not a security boundary, not a model. It does not contain a hostile process and was never built to. It is a discipline layer, and it is advisory.

**What is still broken**, because you would find it anyway: one false positive survives, a mixed grep with pager pipelines. The installer prints a stub warning on fresh installs that is simply untrue. One filed defect is open. All three are in the README under Known limits.

The backlog is the artifact I would actually point you at. It carries amendments above the text they amend, and wrong guesses recorded beside the probe that overturned them.

---

## Link targets

| Link | Target | Why |
|---|---|---|
| the repo | `https://github.com/yeisonrestrepo/code-conductor` | the obvious one |
| the backlog | `AGENT-READABLE BACKLOG.md` | the living artifact; the whole pitch of the post |
| a closeout record | `.claude/memory/project.md`, the `1.33.0` closeout | the idempotency rule and the self-corrected diagnosis |
| a second closeout | `.claude/memory/project.md`, the `1.32.2` closeout | AC31, a release verifying its own record |
| the registry | `tools/README.md` | five retired instruments with their failure modes |

## Pre-post verification

Every number in the body traces to one of these. **Re-check each before posting**, because a stale figure in a Show HN thread is the one thing that cannot be walked back.

- 47 events / 43 unique commands: `.claude/memory/project.md:991`
- 36 of 43, zero unplanned regressions: the table in that same section
- thirteen releases 2026-09-25 to 2026-09-29: `grep -cE '^## \[[0-9.]+\] - 2026-09-2[5-9]' CHANGELOG.md`
- four heredoc specimens across four sessions: `[BUG-047]`'s entry
- the "111 rows" label against a 127 assertion: the `1.33.0` closeout
- the surviving P7 false positive: `[BUG-041]`'s entry
