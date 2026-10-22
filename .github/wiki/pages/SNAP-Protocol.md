# SNAP Protocol

**SNAP** (Session Notification and Pointer) is the minified single-line JSON handoff format used between phases and role agents. It replaces markdown snapshots and is at least 15% smaller.

## Why SNAP

Markdown handoffs consume context tokens. A spec summary, a plan status, and a list of decisions easily runs to 2000+ tokens as formatted markdown. SNAP serializes the same data as minified JSON, schema-validated, and the receiving phase can parse exactly the fields it needs without scanning prose.

## Structure

```json
{
  "sys": {
    "phase": "define|build|verify|ship",
    "context": "...",
    "status": "...",
    "role": "spec|plan|code|audit|qa",
    "tool_kind": "R|RW|X"
  },
  "ops": {
    "notes": ["..."],
    "files": ["..."],
    "scope": ["glob patterns"],
    "gate": "boundary_routed|define_approved|build_executed|verify_pass|ship_released"
  },
  "mem": {
    "decisions": ["..."],
    "exceptions": ["..."],
    "pointers": ["..."]
  }
}
```

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

A failed validation halts the orchestrated run.

## Key Files

| File | Purpose |
|------|---------|
| `scripts/snap-contract.mjs` | Schema definition (versions 1–3) |
| `scripts/snap-validate.mjs` | Validation |
| `scripts/snap-build.mjs` | Builder |
| `.claude/memory/band-envelope.json` | Active envelope for current role |
| `.claude/memory/session-snapshot.json` | Phase state snapshot |
