---
description: "(Conductor) Switch response language for this session"
---

> code-conductor: this command was written for Claude Code. Where it names a Claude Code tool (Read, Grep, Glob, Edit, Write, Bash, Skill, Agent), use your closest equivalent. ` $ARGUMENTS ` and an `ARGUMENTS:` line mean the text the user gave with the command. A space was inserted after some exclamation marks and at signs, and between the arguments placeholder and an adjacent backtick, so OpenCode does not run or attach text; read the text as if the space were not there.


Switch the response language for this session.

**With argument** (`/lang es`, `/lang pt`, etc.):
- Switch immediately to the requested language
- Confirm in the new language (e.g., "Idioma cambiado a Español. ¿En qué puedo ayudarte?")
- Scope: responses and code comments only
- Never change: identifiers, file names, commit messages, branch names

**Without argument** (`/lang`):
Show current setting and list available codes:

| Code | Language    |
|------|-------------|
| en   | English     |
| es   | Spanish     |
| pt   | Portuguese  |
| fr   | French      |
| de   | German      |
| it   | Italian     |
| zh   | Chinese     |
| ja   | Japanese    |
| ko   | Korean      |

**Priority hierarchy:**
1. Session setting (this command) — highest
2. Project CLAUDE.md `language:` setting
3. `personal.md` `response_language:` value
4. Default: English
