# C4 Components

Level 3 of the [C4 model](https://c4model.com/): the components inside the containers on [Architecture Overview](Architecture-Overview). Level 4 appears once, at the end, where a sequence shows something a component diagram cannot.

Colors follow the legend on [Architecture Overview](Architecture-Overview); amber marks a decision, red a deny.

## Pre-tool-use guard chain

**Container:** hook processes. **Source:** `.claude/hooks/pre-tool-use.mjs`, one zero-dependency Node script. Claude Code starts it before every tool named in the `PreToolUse` matcher of `.claude/settings.json`: `Read|Write|Edit|create_file|write_file|Bash|Agent|SendMessage`.

The script looks up the payload's `tool_name` in its `DISPATCH` table and runs that tool's guards **in order**. The first guard that returns a decision wins, and the rest do not run. Every path exits 0: a denial is data in `hookSpecificOutput.permissionDecision`, never a crash.

```mermaid
flowchart TD
  stdin["PreToolUse payload on stdin<br/>tool_name, tool_input, agent_type, session_id, cwd"]
  parse{"Parses as JSON?"}
  unread["Deny: unreadable input<br/>CC_HOOK_ALLOW=1 lifts this denial only"]
  route{"tool_name"}
  allow["Allow<br/>no guard registered"]

  g4["Guard 4<br/>node_modules path component"]
  g1["Guard 1<br/>over 150 lines with no limit"]

  w5["Guard 5<br/>band scope, BAND_*"]
  w6["Guard 6<br/>orchestrator write surface"]
  g2["Guard 2<br/>existing file: ask"]

  e5["Guard 5<br/>band scope"]
  e6["Guard 6<br/>write surface"]

  g7["Guard 7<br/>role shell, ROLE_SHELL_*"]
  g3["Guard 3<br/>P1 to P12 and OBF, then allowlist"]

  r7["Guard 6, R7<br/>ORCH_NESTED_DISPATCH"]

  stdin --> parse
  parse -->|"no"| unread
  parse -->|"yes"| route
  route -->|"Read"| g4 --> g1
  route -->|"Write, create_file, write_file"| w5 --> w6 --> g2
  route -->|"Edit"| e5 --> e6
  route -->|"Bash"| g7 --> g3
  route -->|"Agent, SendMessage"| r7
  route -->|"anything else"| allow

  classDef guard fill:#1a7f74,stroke:#0d4d46,color:#ffffff
  classDef decision fill:#bf8700,stroke:#7d4e00,color:#ffffff
  classDef deny fill:#cf222e,stroke:#82071e,color:#ffffff
  classDef ext fill:#6e7781,stroke:#424a53,color:#ffffff
  class g4,g1,w5,w6,g2,e5,e6,g7,g3,r7 guard
  class parse,route decision
  class unread deny
  class stdin,allow ext
```

Why this order:

- **Guard 4 before Guard 1.** A `node_modules` read is denied whatever its size.
- **Guards 5 and 6 before Guard 2.** A scope denial must outrank Guard 2's "ask", and Guard 6 steps aside for the band roles Guard 5 governs.
- **Guard 7 before Guard 3.** Under `CC_GUARD3_WARN=1`, Guard 3 asks instead of denying, and an ask must never outrank a role's shell denial.
- **`Edit` has no Guard 2.** Editing in place is what Guard 2 recommends.

The detail for each guard, its reason codes and its limits is on [Guards Reference](Guards-Reference).

## `/cc-orchestrate` bands

**Containers:** project payload (the `/cc-orchestrate` command and six agent files), script CLIs (`orchestrate.mjs`, `snap-build.mjs`, `snap-validate.mjs`, `ticket.mjs`) and state stores (`.claude/memory/orchestrator-run.json`, `band-envelope.json`, `.conductor/`).

The main session is the orchestrator. It is the only thing that dispatches agents during a run, and Guard 6 (R7) denies a subagent's `Agent` or `SendMessage`.

```mermaid
flowchart TD
  start["orchestrate.mjs start<br/>resolves the test command, writes the run file<br/>gate: boundary_routed"]

  subgraph define["Define band"]
    spec["spec role, tk RW<br/>writes the spec"]
    rv1["define-review loop<br/>at most 3 passes and 2 revisions, advisory"]
    ap1{"Owner approves the spec<br/>hash shown, re-hashed before approve"}
    plan["plan role, tk RW<br/>writes the plan"]
    rv2["define-review loop"]
    ap2{"Owner approves the plan<br/>gate: define_approved"}
    spec --> rv1 --> ap1 --> plan --> rv2 --> ap2
  end

  subgraph build["Build band"]
    code["code role, tk RW<br/>one dispatch per plan task, in order<br/>hands back build_executed"]
  end

  subgraph verify["Verify band"]
    audit["audit role, tk R<br/>static review, no shell<br/>hands back build_executed"]
    qa["qa role, tk X<br/>runs the recorded test command<br/>hands back verify_pass"]
    audit --> qa
  end

  report["Report, then orchestrate.mjs end<br/>ship_released stays with a human"]

  start --> spec
  ap2 --> code
  code --> audit
  qa --> report

  classDef role fill:#1a7f74,stroke:#0d4d46,color:#ffffff
  classDef gate fill:#bf8700,stroke:#7d4e00,color:#ffffff
  classDef ext fill:#6e7781,stroke:#424a53,color:#ffffff
  class spec,plan,code,audit,qa role
  class rv1,rv2 ext
  class ap1,ap2 gate
  class start,report ext
```

Each role dispatch is the same SNAP v3 handoff:

```mermaid
flowchart LR
  inst["orchestrate.mjs install ROLE"]
  build["snap-build<br/>SNAP v3 envelope: sys.role, sys.tk,<br/>ops.scope, ops.gate"]
  val["snap-validate --to ROLE<br/>ops.gate must be the previous band's exit"]
  env[("band-envelope.json")]
  disp["Agent tool<br/>agent_type = ROLE"]
  work["Role works<br/>Guard 5 bounds writes to ops.scope,<br/>Guard 7 bounds Bash"]
  hb["exactly one SNAP_HANDBACK line"]
  rec["orchestrate.mjs handback<br/>checks the role and its allowed gate"]

  inst --> build --> val --> env --> disp --> work --> hb --> rec

  classDef step fill:#1a7f74,stroke:#0d4d46,color:#ffffff
  class inst,build,val,env,disp,work,hb,rec step
```

| Role | Band | `tk` | Tools | Gate it hands back |
|---|---|---|---|---|
| `spec` | define | RW | Read, Grep, Glob, Write, Edit | `boundary_routed` |
| `plan` | define | RW | Read, Grep, Glob, Write, Edit | `boundary_routed` |
| `code` | build | RW | Read, Grep, Glob, Write, Edit, Bash | `build_executed` |
| `audit` | verify | R | Read, Grep, Glob | `build_executed` |
| `qa` | verify | X | Read, Grep, Glob, Bash | `verify_pass` |
| `define-review` | none (reviewer) | none | Read, Grep, Glob | none: reports open checklist rows |

Approvals are `orchestrate.mjs approve spec` and `approve plan`, recorded in the run file as `{at, by}`. Only `approve plan` moves the gate to `define_approved`. `--auto` skips the pause between dispatches, never an approval. The verbs are `start`, `install`, `handback`, `approve`, `review` and `end`. A refusal exits 2 and writes nothing; a halt exits 1 and is recorded in the run file. A halted run cannot resume: end it, then start again.

More: [Orchestrator Guide](Orchestrator-Guide), [Band Roles & Agents](Band-Roles-and-Agents), [SNAP Protocol](SNAP-Protocol).

## Installer phases

**Container:** installer CLI. **Source:** `bin/code-conductor.mjs` drives `lib/installer/` (`env`, `config`, `deploy`, `file-merge`, `merge-md`, `settings`, `settings-merge`, `host-owned`, `heal`).

```mermaid
flowchart TD
  a["1. nodeMajorAtLeast 20"]
  b["2. resolveAssetRoot, parseArgs<br/>--project, --verbosity, --version, --help;<br/>unknown arguments warn and are ignored"]
  c["3. resolveHome"]
  d["4. Pre-flight: assertAssets, assertMergeTargets,<br/>assertNotSelfInstall when --project"]
  e["5. deployGlobal<br/>copy global/ and skills/ to ~/.claude,<br/>merge CLAUDE.md, seed host-owned files"]
  f["6. chmodHooks on .sh files"]
  g["7. writeVerbosity"]
  h["8. mergeVerbosityHook<br/>into ~/.claude/settings.json"]
  i["9. healGraphifyHook<br/>remove the retired hook, with a backup"]
  j["10. writeVersionFile<br/>memory/conductor-version.md"]
  k["11. deployProject when --project<br/>copy .claude/ and scripts/, merge CLAUDE.md,<br/>.gitignore and settings.json hooks"]
  ok(["exit 0"])
  fail(["exit 1: pre-flight or environment failure<br/>exit 2: partial write"])

  a --> b --> c --> d --> e --> f --> g --> h --> i --> j --> k --> ok
  d -.-> fail
  k -.-> fail

  classDef step fill:#1a7f74,stroke:#0d4d46,color:#ffffff
  classDef ext fill:#6e7781,stroke:#424a53,color:#ffffff
  classDef deny fill:#cf222e,stroke:#82071e,color:#ffffff
  class a,b,c,d,e,f,g,h,i,j,k step
  class ok ext
  class fail deny
```

How each merge treats your files:

- **`CLAUDE.md`.** Only the text between `<!-- cc:managed:start -->` and `<!-- cc:managed:end -->` is replaced. A file without the markers gets the block appended at the end. Damaged markers, or a file that ends inside an unclosed code fence, leave the file untouched with a warning.
- **`.gitignore`.** Gains one labelled block.
- **`settings.json`.** Only its `hooks` entries are merged, matched by fingerprint. `permissions` is written only on a fresh install.
- **Backups.** Every change to one of these files is backed up first as `<file>.installer-backup.<UTC>`, the five newest are kept, and each backup is reported on stdout.

## Context guard

**Container:** hook processes. **Source:** `.claude/hooks/context-guard.sh` and `.ps1`, on every `UserPromptSubmit`; `post-compact.sh` and `.ps1` reset it.

```mermaid
flowchart TD
  t["Read context-threshold.txt<br/>default 25; warning at 80%"]
  s["Read session_id from the hook's stdin JSON"]
  r["Read turn-count.txt<br/>format: session-id count"]
  same{"Same session as stored?"}
  zero["Start from 0"]
  keep["Keep the stored count"]
  inc["Add 1, saturating at 99999<br/>write tmp file, then mv"]
  out{"count vs threshold"}
  crit["CONTEXT CRITICAL<br/>run /cc-compact now"]
  warn["CONTEXT WARNING"]
  quiet["No output"]
  pc["PostCompact: post-compact resets the count to 0"]

  t --> s --> r --> same
  same -->|"no"| zero --> inc
  same -->|"yes"| keep --> inc
  inc --> out
  out -->|"at or over threshold"| crit
  out -->|"at or over 80%"| warn
  out -->|"below"| quiet
  pc -.-> r

  classDef step fill:#1a7f74,stroke:#0d4d46,color:#ffffff
  classDef decision fill:#bf8700,stroke:#7d4e00,color:#ffffff
  classDef deny fill:#cf222e,stroke:#82071e,color:#ffffff
  classDef ext fill:#6e7781,stroke:#424a53,color:#ffffff
  class t,s,r,zero,keep,inc step
  class same,out decision
  class crit,warn deny
  class quiet,pc ext
```

A count left by another session says nothing about this session's context, so a new `session_id` starts from zero (`[BUG-056]`). The hook always exits 0, because a non-zero `UserPromptSubmit` hook would block the prompt.

## Level 4: one guard dispatch

A `Write` from the `code` role during a live `/cc-orchestrate` run. This is the call that the band envelope exists to bound.

```mermaid
sequenceDiagram
  autonumber
  participant CC as Claude Code harness
  participant H as pre-tool-use.mjs
  participant G5 as guard5BandScope
  participant ENV as band-envelope.json
  participant G6 as guard6OrchestratorRun
  participant G2 as guard2DuplicateWrite

  CC->>H: stdin: tool_name Write, agent_type code, tool_input.file_path
  H->>H: JSON.parse, then look up DISPATCH.Write
  H->>G5: run first
  G5->>ENV: find the nearest one above cwd, read it
  alt envelope invalid, role mismatch, tk not RW, or path outside ops.scope
    G5-->>H: deny with a BAND_* reason
    H-->>CC: permissionDecision deny, exit 0
  else path inside ops.scope
    G5-->>H: null
    H->>G6: run next
    G6-->>H: null, because band roles belong to Guard 5
    H->>G2: run last
    alt file already exists
      G2-->>H: ask, showing line count and mtime
      H-->>CC: permissionDecision ask, exit 0
    else new file
      G2-->>H: null
      H-->>CC: no output, exit 0: the write proceeds
    end
  end
```
