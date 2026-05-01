# Base Profile

Applies to all projects regardless of language. Loaded first by `/stack`; language profiles add on top.

## Identifiers

Always English. No exceptions, regardless of the team's spoken language.

## Commits

Conventional Commits format, in English:

```
feat: add user authentication
fix: prevent null pointer in order totals
docs: update API reference
refactor: extract payment validation
test: add unit tests for cart service
chore: bump dependencies
```

Breaking changes: append `!` after type (`feat!:`) and add `BREAKING CHANGE:` footer.

## Files

- One file, one responsibility
- File names: lowercase with hyphens (kebab-case) in most languages
- If a file exceeds ~200 lines, it is doing too much — split it

## Error Handling

- Never swallow errors silently — `catch (e) {}` is always wrong
- Either handle the error meaningfully or re-throw with added context
- Log errors with enough information to reproduce the issue

## Secrets

- Never hardcode secrets, tokens, API keys, or passwords
- Use environment variables locally; use a secrets manager in production
- `.env` files are always in `.gitignore`

## Comments

- Comments explain WHY, not WHAT
- If you need a comment to explain what a line does, rename the variable or function instead
- Delete commented-out code — git history preserves it

## Dependencies

- Ask before adding: can this be 10 lines instead of a dependency?
- Pin major versions; allow minor/patch updates
- Remove unused dependencies immediately
- Audit transitive dependencies for known vulnerabilities before shipping

## Testing

- Test behavior, not implementation details
- Test name format: "should [behavior] when [condition]"
- No `if (process.env.NODE_ENV === 'test')` in production code
- A test that passes when the feature is broken is worse than no test
