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
