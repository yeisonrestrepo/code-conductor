# SNAP Protocol

**SNAP** is the minified single-line JSON handoff format used between phases and role agents. It replaces markdown snapshots and is at least 15% smaller.

## Why SNAP

Markdown handoffs consume context tokens. A spec summary, a plan status, and a list of decisions easily runs to 2000+ tokens as formatted markdown. SNAP serializes the same data as minified JSON, schema-validated, and the receiving phase can parse exactly the fields it needs without scanning prose.

## Structure

The wire names are short on purpose. A v3 envelope, pretty-printed here (on disk it is one line):

```json
{
  "v": 3,
  "sys": { "ph": "...", "c": "...", "s": "...", "role": "spec|plan|code|audit|qa", "tk": "R|RW|X" },
  "ops": { "n": ["..."], "f": ["..."], "scope": ["glob patterns"], "gate": "boundary_routed|define_approved|build_executed|verify_pass|ship_released" },
  "mem": { "d": ["..."], "x": ["..."], "p": {} },
  "pr": "..."
}
```

| Field | Meaning |
|---|---|
| `v` | Version, 1 to 3 (`MAX_VERSION` in `snap-contract.mjs`) |
| `sys.ph` | The phase, for example `spec`, `plan`, `impl`, `rev` from `/cc-compact` |
| `sys.c` | The git commit hash the snapshot is keyed to |
| `sys.s` | The active spec's slug, or `none` |
| `sys.role`, `sys.tk` | v3: the band role and its tool kind (`R` read, `RW` read-write, `X` execute) |
| `ops.n` | Pending next steps |
| `ops.f` | Files touched, each `<path>:C\|M\|D` |
| `ops.scope` | v3: the globs a role may write; required when `tk` is `RW` |
| `ops.gate` | v3: the gate the envelope carries |
| `mem.d`, `mem.x` | Decisions and constraints |
| `mem.p` | v3: pointers, for example the bound ticket on the spec envelope |
| `pr` | v2 and later: free prose, for example the checkpoint body `/cc-checkpoint` appended to `project.md` |

v1 and v2 have only `sys.ph/c/s`, `ops.n/f` and `mem.d/x`; v1 has no `pr`. `snap-contract.mjs` is the authority for every field set.

## Versions

| Version | Description |
|---------|-------------|
| SNAP v1 | Initial format |
| SNAP v2 | Added array caps and size limits |
| SNAP v3 | Current. Band envelopes, scope globs, gate validation |

## Array Caps

<!-- wiki-gen:snap-caps -->

## Bands and Gates

```
boundary → define → build → verify → ship
   │          │        │        │       │
   └──────────┴────────┴────────┴───────┘
boundary_routed → define_approved → build_executed → verify_pass → ship_released
```

## Validation

```bash
# Validate a SNAP envelope before dispatching to a role
node .claude/scripts/snap-validate.mjs --to <role>
```

`--to <role>` also requires `ops.gate` to be the exit gate of the band before that role's band: `spec` and `plan` receive `boundary_routed`, `code` receives `define_approved`, `audit` and `qa` receive `build_executed`. A mismatch is `SNAP_GATE_MISMATCH`. A failed validation halts the orchestrated run. Where this sits in a dispatch is drawn on [C4 Components](C4-Components#cc-orchestrate-bands).

## Key Files

| File | Purpose |
|------|---------|
| `scripts/snap-contract.mjs` | Schema definition (versions 1–3) |
| `scripts/snap-validate.mjs` | Validation |
| `scripts/snap-build.mjs` | Builder |
| `.claude/memory/band-envelope.json` | Active envelope for current role |
| `.claude/memory/session-snapshot.json` | Phase state snapshot |
