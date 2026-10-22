# Guards Reference

All guards live in a single zero-dependency Node script: `.claude/hooks/pre-tool-use.mjs`. It fires before `Read`, `Write`, `Edit`, `create_file`, `write_file` and `Bash`. Every path exits 0 — a denial is data, never a crash.

## Guard 1: Large-File Read

| | |
|---|---|
| **Fires on** | `Read` |
| **Enforces** | A file over 150 lines needs an explicit `limit`; otherwise denied |
| **Redirect** | Memory → grep → bounded read |

## Guard 2: Duplicate Write

| | |
|---|---|
| **Fires on** | `Write`, `create_file`, `write_file` |
| **Enforces** | Writing to an existing path asks first, showing path, line count and last-modified time |
| **Redirect** | Edit in place, confirm the overwrite, or cancel |

## Guard 3: Bash Scan

| | |
|---|---|
| **Fires on** | `Bash` |
| **Enforces** | 12 mass content-dump patterns denied before execution |

### The 12 Patterns

1. Deep `find` without `-maxdepth 1`
2. `find -exec` with readers or shells
3. `xargs` with readers
4. `cat` or pager followed by unquoted glob
5. Command substitution as reader argument
6. `grep -r` with match-all pattern
7. `ls -R`
8. Shell loops
9. `mapfile` and `readarray`
10. `eval`
11. `source` and the dot operator
12. Alias remapping to a reader

### Allowlist

Permanent exceptions in `.claude/memory/bash-scan-allowlist.txt`:
- One entry per line, blank lines and `#` comments ignored
- Entry ending in `/` covers paths under that prefix (no `..` traversal)
- Other entries match whole command tokens literally

### Triage mode

```bash
CC_GUARD3_WARN=1  # ask instead of deny (triage aid, not a config mode)
CC_HOOK_DEBUG=1   # show diagnostic lines
```

## Guard 4: node_modules

| | |
|---|---|
| **Fires on** | `Read` |
| **Enforces** | Paths containing `node_modules` as exact path component denied |
| **Note** | Backslashes and `..` resolved first. Use Glob for existence checks |

## Guard 5: Band Scope

| | |
|---|---|
| **Fires on** | `Write`, `Edit`, `create_file`, `write_file` from a band role |
| **Enforces** | Writes must be inside the role's installed SNAP envelope scope |
| **Data** | `.claude/memory/band-envelope.json` |

Roles checked: `spec`, `plan`, `code`, `audit`, `qa`. A role not holding `RW` or writing outside scope is denied. Assumes cooperative agents (`agent_type` is taken on trust).

## Guard 6: Orchestrator Writes

| | |
|---|---|
| **Fires on** | Writes during a live `/cc-orchestrate` run |
| **Enforces** | Non-band writers may only touch the orchestrator's write surface |

Allowed surface: `orchestrator-run.json`, `band-envelope.json`, `session-snapshot.json`, `.conductor/**`.

Stale/invalid run files warn (`ORCH_RUN_STALE`, `ORCH_RUN_INVALID`) but never block.

Nested `Agent` or `SendMessage` from a subagent is denied (`ORCH_NESTED_DISPATCH`).

## Guard 7: Role Shell

| | |
|---|---|
| **Fires on** | `Bash` from a band role |
| **Priority** | Runs before Guard 3 — `CC_GUARD3_WARN` cannot override it |

| Role | Shell Access |
|------|-------------|
| `spec` | None (`ROLE_SHELL_DENIED`) |
| `plan` | None (`ROLE_SHELL_DENIED`) |
| `audit` | None (`ROLE_SHELL_DENIED`) |
| `code` | Exactly the recorded test command, byte for byte |
| `qa` | Exactly the recorded test command, byte for byte |

Chaining characters (`;`, `&`, `|`, backtick, `$(`, `<`, `>`, newline) are denied first (`ROLE_SHELL_CHAINING`).

## Unparseable Input

Fails closed. Denied with one stderr line naming `CC_HOOK_ALLOW=1`, which overrides that denial alone and leaves every guard active on readable payloads.
