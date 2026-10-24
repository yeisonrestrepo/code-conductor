# Guards Reference

All guards live in a single zero-dependency Node script: `.claude/hooks/pre-tool-use.mjs`. It fires before `Read`, `Write`, `Edit`, `create_file`, `write_file`, `Bash`, `Agent` and `SendMessage`, the tools named in the `PreToolUse` matcher of `.claude/settings.json`. Every path exits 0 — a denial is data, never a crash.

The guards run per tool, in this order, and the first decision wins:

| Tool | Guards, in order |
|---|---|
| `Read` | 4, 1 |
| `Write`, `create_file`, `write_file` | 5, 6, 2 |
| `Edit` | 5, 6 (no Guard 2: editing in place is what Guard 2 recommends) |
| `Bash` | 7, 3 |
| `Agent`, `SendMessage` | 6 (nested-dispatch check only) |

[C4 Components](C4-Components#pre-tool-use-guard-chain) draws this chain and explains the order.

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
| **Enforces** | 12 mass content-dump patterns plus an obfuscation check, denied before execution. A command over 8192 characters, or one with an unclosed quote, is denied fail-closed |

### The patterns

A denial names the ids that matched, for example `Pattern ids: P7`. The ids are those of the `G3_CHECKS` table in `pre-tool-use.mjs`:

| Id | Pattern |
|---|---|
| `P1` | Deep `find` without `-maxdepth 1` |
| `P2` | `find -exec`, `-execdir`, `-ok` or `-okdir` running a reader or a shell |
| `P3` | `xargs` with a reader |
| `P4` | `cat` followed by an unquoted glob |
| `P5` | Command substitution as a reader's argument |
| `P6` | `grep -r` with a match-all pattern |
| `P7` | A pager or filter (`less`, `more`, `head`, `tail`, `sed`, `awk`) followed by an unquoted glob |
| `P8` | `ls -R` |
| `P9` | Shell loops (`for`, `while`, `until`) |
| `P10` | `mapfile` and `readarray` |
| `P11` | `eval`, `source` and the dot operator |
| `P12` | An alias that remaps to a reader, `eval`, `source` or `.` |
| `OBF` | Obfuscation sequences, such as a `$"..."` string or a command word split by quotes or backslashes |

`P6` and `P12` read quoted text by design (the grep pattern, the alias value); every other check reads the command with quoted regions masked.

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
| **Fires on** | `Write`, `Edit`, `create_file`, `write_file`, `Agent` and `SendMessage` during a live `/cc-orchestrate` run |
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

Chaining characters (`;`, `&`, `|`, backtick, `$(`, `<`, `>`, newline) are denied first (`ROLE_SHELL_CHAINING`). No live run in this session, or no recorded command, is denied as `ROLE_SHELL_UNRESOLVED`; any other command is denied as `ROLE_SHELL_NOT_ALLOWED`, naming the allowed one. An error inside the guard denies too.

## Unparseable Input

Fails closed. Denied with one stderr line naming `CC_HOOK_ALLOW=1`, which overrides that denial alone and leaves every guard active on readable payloads.
