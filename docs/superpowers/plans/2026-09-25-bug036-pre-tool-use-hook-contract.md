# pre-tool-use Hook Contract Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the shipped bash `pre-tool-use` hook with a single zero-dependency Node front door that speaks the platform's real `PreToolUse` contract, so the guards this project advertises actually fire.

**Architecture:** One `.mjs` file reads the payload from stdin, parses it once, dispatches on `tool_name` through a four-wide table, and returns a decision as `hookSpecificOutput.permissionDecision` with exit 0. Guards 1, 2 and 4 are translated from the 519-line bash original; Guard 3's slot is declared and returns allow. The repository's own `.claude/hooks/` carries a byte-identical mirror, so this project dogfoods the shipped artifact, and a new integration harness invokes the hook exactly as Claude Code does.

**Tech Stack:** Node >= 20 (`node:fs`, `node:path` only), Vitest, bash (frozen Guard 3 corpus fixture only).

**Spec:** `docs/superpowers/specs/2026-09-25-bug036-pre-tool-use-hook-contract-design.md`

## Global Constraints

- The hook imports only `node:` builtins and adds no entry to `dependencies`.
- Every path through the hook exits 0. Nothing in this hook exits 2, and nothing emits a `{"decision":...}` object.
- Denials are `hookSpecificOutput.permissionDecision` with `permissionDecisionReason`; Guards 1 and 4 use `"deny"`, Guard 2 uses `"ask"`.
- Case A (parsed payload, guard has no field to act on): allow. Case B (stdin does not parse): deny pre-dispatch, one stderr line, `CC_HOOK_ALLOW=1` overrides that denial and nothing else. Canary (valid but unfamiliar shape): allow.
- Guard logic is translated, not revised. The 150-line threshold, the blocked component set `{graphify-out, node_modules}`, the path normalization semantics including `..` resolution and lowercase component comparison, and Guard 2's prompt text are mechanical translations.
- **Standing rule for every re-pointed test:** 125 existing guard tests must pass against a new runtime and a new input contract with **no case quietly adjusted to fit**. Assertion mechanics change (exit code, decision shape); a case's verdict changes only at the two rows this plan names, each with its red state predicted.
- `npm test` is green at every commit. Baseline at the start of this work: **600 passed / 12 skipped**.
- Release 1.28.0 (minor: the hook's interface with the platform changes).
- No em-dashes in any file this plan writes.
- All plan state updates are surgical single-line edits (BUG-003 invariant).

---

## Decisions this plan makes that the spec did not spell out

Three, each named here rather than buried in a step. They are reported at plan approval and are the only places where translation required a judgment call.

**1. Guard 2 is registered for `Write`, `create_file` and `write_file`, not for `Edit`.**
The bash guard extracted a `"path"` key. Neither `Write` nor `Edit` sends `path`; both send `file_path`, so Guard 2 has never fired for either, which is a fifth defect the spec did not name. The repaired reader accepts `file_path`, with `path` kept as a compatibility fallback for an MCP-provided `create_file` or `write_file`. That is contract repair and is required by the spec's own acceptance criterion ("a `Write` to an existing file returning `ask`"). Registering the repaired guard for `Edit` as well would return `ask` on every targeted edit of every existing file, which is both a product-wide regression and incoherent with the guard's own recommendation ("Edit the existing file instead of overwriting"). `Edit` stays in the matcher, per the spec's pinned matcher string, and dispatches to no guard.

**2. For `Read`, Guard 4 runs before Guard 1.**
The bash file ran Guard 1 first. Both guards exited 1 there, which never blocked, so no user-visible precedence has ever existed. Now that both are real, precedence decides which reason the user sees for a large file inside `graphify-out/`. Guard 4 first is the correct answer (the path is forbidden regardless of its size), it removes a stat and a full file read on a path that is about to be denied, and it makes `guard4.test.js` row1 deterministic on a machine where `graphify-out/graph.json` exists and exceeds 150 lines.

**3. The spec's `row14` / `row15` reference is inverted against the file.**
`tests/hooks/guard4.test.js:121` is `row14: fail-open on malformed JSON input` and `:125` is `row15: fail-open on missing file_path key`. The spec says "row15 and row16 flipped to expect a denial and row14 left allowing". Its intent is unambiguous elsewhere (Case A allows, Case B denies), so the row numbers are what is wrong. The flips this plan executes are **row14** (malformed, becomes deny) and **row16** (PATH-stripped, becomes deny); **row15** (missing `file_path`) stays allowing. Fixed in the spec text as T-001-A's first step so the two documents agree.

---

## File Structure

| File | Responsibility |
|---|---|
| `project-template/.claude/hooks/pre-tool-use.mjs` | New. The shipped front door: stdin parse, dispatch table, Guards 1, 2, 4, Guard 3 slot, one decision writer. |
| `.claude/hooks/pre-tool-use.mjs` | New. Byte-identical mirror consumed by this repository. |
| `project-template/.claude/hooks/pre-tool-use.sh` | Deleted. |
| `.claude/hooks/pre-tool-use.sh` | Moved to `tests/fixtures/guard3-reference.sh`, stripped to Guard 3 alone. |
| `tests/fixtures/guard3-reference.sh` | New. Frozen corpus subject, ships to no one, the behavioral authority `[BUG-037]` ports against. |
| `tests/hooks/pre-tool-use-contract.test.js` | New. The integration harness: spawn, stdin payload, assertions on exit code and parsed stdout. |
| `tests/hooks/guard4.test.js` | Re-pointed at the `.mjs` over the stdin contract; row14 and row16 flipped. |
| `tests/hooks/guard3.test.js`, `tests/guard3-test.sh` | Re-pointed at the frozen fixture; not one case altered. |
| `tests/installer/templates.test.js` | Parity assertion for the mirrored pair, matcher assertions for both settings files, env-var absence sweep. |
| `.claude/settings.json`, `project-template/.claude/settings.json` | `PreToolUse` matcher widened to the union; command points at the `.mjs`. |
| `README.md`, `CLAUDE.md`, `project-template/CLAUDE.md`, both `cc-init.md` mirrors, `CONTRIBUTING.md` | Claims and instructions corrected to the shipped state. |
| `VERSION`, `package.json`, `package-lock.json`, `CHANGELOG.md`, `AGENT-READABLE BACKLOG.md` | Release 1.28.0. |

---

## Task 0: Branch and plan commit

**Files:**
- Create: `docs/superpowers/plans/2026-09-25-bug036-pre-tool-use-hook-contract.md` (this file, already written)

**Interfaces:**
- Consumes: nothing.
- Produces: the plan file tracked in git, on the feature branch.

- [>] [T-000-A] Stage the plan file. `docs/` is gitignored, so it must be force-added.

```bash
git add -f "docs/superpowers/plans/2026-09-25-bug036-pre-tool-use-hook-contract.md"
```

- [ ] [T-000-B] Verify exactly one path is staged.

```bash
git diff --cached --name-only
```
Expected: one line, `docs/superpowers/plans/2026-09-25-bug036-pre-tool-use-hook-contract.md`.

- [ ] [T-000-C] Commit the plan.

```bash
git commit -m "$(cat <<'EOF'
docs: add the BUG-036 pre-tool-use hook contract implementation plan

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 1: The Node front door, its integration harness, and the re-pointed Guard 4 suite

**Files:**
- Modify: `docs/superpowers/specs/2026-09-25-bug036-pre-tool-use-hook-contract-design.md:283-285` (row reference correction)
- Create: `tests/hooks/pre-tool-use-contract.test.js`
- Modify: `tests/hooks/guard4.test.js` (whole file)
- Create: `project-template/.claude/hooks/pre-tool-use.mjs`
- Create: `.claude/hooks/pre-tool-use.mjs`

Guard 4's two flipped verdicts land in this commit, beside the parser that justifies them, and both are written before the parser exists so each carries a predicted red state. The wiring that makes the hook reachable is Task 2's business.

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: the hook at `project-template/.claude/hooks/pre-tool-use.mjs` and its mirror at `.claude/hooks/pre-tool-use.mjs`. It is invoked as `node <path>` with the `PreToolUse` payload on stdin, writes at most one JSON object to stdout with the shape `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny"|"ask","permissionDecisionReason":"<text>"}}`, and always exits 0. Environment: `CC_HOOK_ALLOW` (non-empty overrides the Case B denial only), `CC_HOOK_DEBUG` (non-empty enables `PRE_TOOL_USE:` stderr diagnostics).

- [ ] [T-001-A] Reconcile the spec with the code this plan is about to write. Four edits to `docs/superpowers/specs/2026-09-25-bug036-pre-tool-use-hook-contract-design.md`, all before a line of code exists: the two documents must name the same behavior first.

**Edit 1, the inverted row reference.** Replace:

```
- [ ] Guard 4's seventeen logic cases pass against the new artifact, with `row15` and
      `row16` flipped to expect a denial and `row14` left allowing, each flip landing in the
      same commit as the parser with its red state predicted.
```

with:

```
- [ ] Guard 4's seventeen logic cases pass against the new artifact, with `row14` (malformed
      stdin) and `row16` (PATH stripped) flipped to expect a denial and `row15` (missing
      `file_path`) left allowing, each flip landing in the same commit as the parser with its
      red state predicted.
```

**Edit 2, the override's scope pin.** The hook's top-level `catch` routes any internal exception through the same denial path, and that path honors `CC_HOOK_ALLOW`. The behavior is right (a crashed guard is a verifier that could not run, the same class as unparseable stdin, and crashing open would reopen the hole this audit closes), so the words move, not the code. Replace:

```
**Scope pin.** `CC_HOOK_ALLOW=1` bypasses **only** the unparseable-input denial (Case B).
It does not suppress, alter or bypass any guard's decision on input that parses. It is not
```

with:

```
**Scope pin.** `CC_HOOK_ALLOW=1` bypasses **only** the unparseable-input denial (Case B) and
the hook-internal-failure denial, both pre-verdict conditions where no guard could inspect
the call.
It does not suppress, alter or bypass any guard's decision on input that parses. It is not
```

**Edit 3, Guard 2's field reader.** The spec never named which key Guard 2 reads, and the answer is the fifth defect. In `### Contract-forced behavior changes`, replace:

```
Only two, both named so neither is silent:
```

with:

```
Only three, each named so none is silent:
```

and append, after the `permissionDecisionReason` bullet:

```
- **Guard 2 accepts `file_path`, with `path` as a compatibility fallback.** The bash original
  read a `path` key, which neither `Write` nor `Edit` sends, so the guard could not fire even
  on a host where the wiring worked. The reader takes `file_path` first and keeps `path` for
  an MCP-provided `create_file` or `write_file`. It is registered for `Write`, `create_file`
  and `write_file` only: gating `Edit` would return `ask` on the very action this guard
  recommends.
```

**Edit 4, the command's form, recorded so a future reviewer of both specs is not left guessing.** Append to `### Design decision: union matcher with internal dispatch`:

```
**On the command's form.** The settings entry names a relative path,
`node .claude/hooks/pre-tool-use.mjs`, where `[BUG-033]` mandated an absolute one. The rules
differ because the hooks do. `[BUG-033]`'s graphify wrapper is a global hook living under a
home directory only the installer knows, and a bare `~` does not expand under PowerShell.
This is a project hook resolved against the session cwd, the same cwd the guards' own `stat`
calls resolve against, and the bash wiring it replaces was already relative.
```

- [ ] [T-001-B] Write the failing integration harness. Create `tests/hooks/pre-tool-use-contract.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HOOK = join(REPO_ROOT, '.claude/hooks/pre-tool-use.mjs');

// Invoke the hook the way Claude Code does: spawn it, write one PreToolUse payload
// to stdin, close stdin, read the exit code and stdout back. process.execPath rather
// than 'node' so PATH can be emptied by a caller without breaking the spawn itself.
function fire(payload, env = {}) {
  const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const r = spawnSync(process.execPath, [HOOK], {
    stdio: 'pipe',
    cwd: REPO_ROOT,
    timeout: 15000,
    input: raw,
    env: { ...process.env, ...env },
  });
  if (r.error) throw new Error(`hook spawn failed: ${r.error.message}`);
  const stdout = (r.stdout ?? Buffer.alloc(0)).toString();
  return {
    status: r.status ?? -1,
    stdout,
    stderr: (r.stderr ?? Buffer.alloc(0)).toString(),
    decision: stdout.trim() === '' ? null : JSON.parse(stdout).hookSpecificOutput,
  };
}

const readPayload = (file, extra = {}) => ({
  tool_name: 'Read',
  tool_input: { file_path: file, ...extra },
});

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cc-hook-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function writeLines(name, count) {
  const p = join(dir, name);
  writeFileSync(p, Array.from({ length: count }, (_, i) => `line ${i + 1}`).join('\n') + '\n');
  return p;
}

describe('pre-tool-use contract harness', () => {
  it('denies a graphify-out read and still exits 0', () => {
    const r = fire(readPayload('graphify-out/graph.json'));
    expect(r.status).toBe(0);
    expect(r.decision.hookEventName).toBe('PreToolUse');
    expect(r.decision.permissionDecision).toBe('deny');
    expect(r.decision.permissionDecisionReason).toMatch(/Guard 4/);
  });

  it('allows an ordinary source read with no decision written', () => {
    const r = fire(readPayload(writeLines('small.txt', 3)));
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.decision).toBeNull();
  });

  it('asks before a Write over a file that already exists', () => {
    const p = writeLines('existing.txt', 4);
    const r = fire({ tool_name: 'Write', tool_input: { file_path: p, content: 'x' } });
    expect(r.status).toBe(0);
    expect(r.decision.permissionDecision).toBe('ask');
    expect(r.decision.permissionDecisionReason).toMatch(/FILE ALREADY EXISTS/);
    expect(r.decision.permissionDecisionReason).toContain(p);
  });

  it('allows a Write to a path that does not exist', () => {
    const r = fire({ tool_name: 'Write', tool_input: { file_path: join(dir, 'new.txt'), content: 'x' } });
    expect(r.status).toBe(0);
    expect(r.decision).toBeNull();
  });

  it('denies a 200-line Read that names no limit', () => {
    const r = fire(readPayload(writeLines('big.txt', 200)));
    expect(r.status).toBe(0);
    expect(r.decision.permissionDecision).toBe('deny');
    expect(r.decision.permissionDecisionReason).toMatch(/Guard 1/);
  });

  it('allows the same read once limit is present', () => {
    const r = fire(readPayload(writeLines('big.txt', 200), { limit: 50 }));
    expect(r.status).toBe(0);
    expect(r.decision).toBeNull();
  });

  it('routes a Bash payload to the empty Guard 3 slot and allows it', () => {
    const r = fire({ tool_name: 'Bash', tool_input: { command: 'cat *.ts' } });
    expect(r.status).toBe(0);
    expect(r.decision).toBeNull();
  });

  it('Case A: a valid Read payload with no file_path allows', () => {
    const r = fire({ tool_name: 'Read', tool_input: {} });
    expect(r.status).toBe(0);
    expect(r.decision).toBeNull();
  });

  it('Case B: malformed stdin denies, names the override, writes one stderr line', () => {
    const r = fire('{not json');
    expect(r.status).toBe(0);
    expect(r.decision.permissionDecision).toBe('deny');
    expect(r.decision.permissionDecisionReason).toMatch(/CC_HOOK_ALLOW/);
    expect(r.stderr.trimEnd().split('\n')).toHaveLength(1);
  });

  it('Case B with CC_HOOK_ALLOW=1 allows and still writes the stderr line', () => {
    const r = fire('{not json', { CC_HOOK_ALLOW: '1' });
    expect(r.status).toBe(0);
    expect(r.decision).toBeNull();
    expect(r.stderr.trimEnd().split('\n')).toHaveLength(1);
  });

  // The override's scope, asserted as an absence: it bypasses the unparseable-input
  // denial and nothing else. Without this case one refactor turns a malformed-input
  // override into a product-wide off switch and no test notices.
  it('CC_HOOK_ALLOW=1 still denies a well-formed graphify-out read', () => {
    const r = fire(readPayload('graphify-out/graph.json'), { CC_HOOK_ALLOW: '1' });
    expect(r.status).toBe(0);
    expect(r.decision.permissionDecision).toBe('deny');
    expect(r.decision.permissionDecisionReason).toMatch(/Guard 4/);
  });

  it('canary: a valid payload carrying an unknown top-level key is allowed', () => {
    const r = fire({
      tool_name: 'Read',
      tool_input: { file_path: writeLines('small.txt', 3) },
      tool_use_id: 'toolu_abc',
      some_future_key: { nested: true },
    });
    expect(r.status).toBe(0);
    expect(r.decision).toBeNull();
  });

  it('never exits 2 and never emits the legacy decision shape', () => {
    const payloads = [
      readPayload('graphify-out/graph.json'),
      readPayload(writeLines('big.txt', 200)),
      { tool_name: 'Write', tool_input: { file_path: writeLines('existing.txt', 4) } },
      { tool_name: 'Bash', tool_input: { command: 'ls' } },
      '{not json',
      '',
    ];
    for (const p of payloads) {
      const r = fire(p);
      expect(r.status).toBe(0);
      expect(r.stdout).not.toMatch(/"decision"\s*:/);
    }
  });
});
```

- [ ] [T-001-C] Re-point the Guard 4 suite at the new artifact and flip the two rows. Depends on T-001-B. Replace the whole of `tests/hooks/guard4.test.js` with:

```js
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'child_process'
import { mkdtempSync, rmdirSync } from 'fs'
import { tmpdir } from 'os'
import { fileURLToPath } from 'url'
import { dirname, join, resolve } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = resolve(__dirname, '../..')
const HOOK = join(REPO_ROOT, '.claude/hooks/pre-tool-use.mjs')

const WIN32 = process.platform === 'win32'

// These 17 cases are Guard 4's logic of record. The runtime and the input contract both
// changed under them, so the mechanics move (JSON on stdin, decision in stdout, exit 0
// always) while the verdicts do not, except at row14 and row16, which the contract itself
// flips and which are named in the plan rather than quietly adjusted.
function runRead(filePath, { toolName = 'Read', input = null, env = {} } = {}) {
  const payload = input ?? JSON.stringify({ tool_name: toolName, tool_input: { file_path: filePath } })
  const result = spawnSync(process.execPath, [HOOK], {
    stdio: 'pipe',
    cwd: REPO_ROOT,
    timeout: 15000,
    input: payload,
    env: { ...process.env, ...env },
  })
  if (result.error) throw new Error(`hook spawn failed: ${result.error.message}`)
  const strip = s => s.replace(/\r\n|\r/g, '\n').replace(/\x1b\[[0-9;]*m/g, '')
  const stdout = strip((result.stdout ?? Buffer.alloc(0)).toString())
  return {
    status: result.status ?? -1,
    stdout,
    stderr: strip((result.stderr ?? Buffer.alloc(0)).toString()),
    decision: stdout.trim() === '' ? null : JSON.parse(stdout).hookSpecificOutput,
  }
}

const expectBlocked = (r, matcher = /Guard 4/) => {
  expect(r.status).toBe(0)
  expect(r.decision.permissionDecision).toBe('deny')
  expect(r.decision.permissionDecisionReason).toMatch(matcher)
}
const expectAllowed = (r) => {
  expect(r.status).toBe(0)
  expect(r.decision).toBeNull()
}

describe('Guard 4 — Read blocker for graphify-out/ and node_modules/', () => {
  it('row1: blocks graphify-out/graph.json', () => {
    expectBlocked(runRead('graphify-out/graph.json'))
  })
  it('row2: blocks graphify-out/cache/ast/abc.json', () => {
    expectBlocked(runRead('graphify-out/cache/ast/abc.json'))
  })
  it('row3: blocks node_modules/vitest/dist/index.js', () => {
    expectBlocked(runRead('node_modules/vitest/dist/index.js'))
  })
  it('row4: blocks absolute path /abs/path/graphify-out/file.json', () => {
    expectBlocked(runRead('/abs/path/graphify-out/file.json'))
  })
  it('row5: blocks Windows backslash path graphify-out\\cache\\file.json', () => {
    expectBlocked(runRead('graphify-out\\cache\\file.json'))
  })
  it('row6: blocks case variant Graphify-Out/graph.json', () => {
    expectBlocked(runRead('Graphify-Out/graph.json'))
  })
  it('row7: blocks NODE_MODULES/pkg/index.js (uppercase)', () => {
    expectBlocked(runRead('NODE_MODULES/pkg/index.js'))
  })
  it('row8: allows graphify-out/../src/main.js (normalize resolves to src/main.js)', () => {
    expectAllowed(runRead('graphify-out/../src/main.js'))
  })
  it('row9: blocks graphify-out/ (trailing slash: component still matched)', () => {
    expectBlocked(runRead('graphify-out/'))
  })
  it('row10: blocks "  graphify-out/graph.json" (leading spaces trimmed)', () => {
    expectBlocked(runRead('  graphify-out/graph.json'))
  })
  it('row11: allows graphify-out-backup/file.json (not an exact component match)', () => {
    expectAllowed(runRead('graphify-out-backup/file.json'))
  })
  it('row12: allows src/utils/graphify-out-helper.js (no blocked component)', () => {
    expectAllowed(runRead('src/utils/graphify-out-helper.js'))
  })
  it('row13: allows src/index.js (normal file)', () => {
    expectAllowed(runRead('src/index.js'))
  })
  // FLIPPED. Was "fail-open on malformed JSON". Unparseable stdin is not "nothing to
  // verify", it is "the verifier could not run", which is the condition that fails closed.
  it('row14: denies malformed JSON input {invalid json} and names the override', () => {
    const r = runRead('', { input: '{invalid json}' })
    expectBlocked(r, /CC_HOOK_ALLOW/)
  })
  // UNCHANGED verdict. A payload that names no file_path carries no path that could reach
  // graphify-out/, so there is nothing to deny (Case A).
  it('row15: allows a valid Read payload with no file_path', () => {
    expectAllowed(runRead('', { input: JSON.stringify({ tool_name: 'Read', tool_input: {} }) }))
  })
  // FLIPPED. Was "fail-open when python3 absent". The path check is now pure JavaScript
  // over an already-parsed string, so an empty PATH cannot disarm it.
  it.skipIf(WIN32)('row16: denies with PATH restricted to an empty dir', () => {
    const fakeBin = mkdtempSync(join(tmpdir(), 'guard4-nopath-'))
    try {
      expectBlocked(runRead('graphify-out/graph.json', { env: { PATH: fakeBin } }))
    } finally {
      rmdirSync(fakeBin)
    }
  })
  it('row17: does NOT fire Guard 4 when tool_name is Bash (Guard 3 slot handles it)', () => {
    expectAllowed(runRead('graphify-out/graph.json', { toolName: 'Bash' }))
  })
})
```

The `describe.skipIf(!BASH_AVAILABLE)` wrapper is gone, because nothing in this file needs bash any more; on a Windows host these 16 non-skipped cases now run where they previously all skipped.

- [ ] [T-001-D] Run both suites and confirm they fail for the right reason. Depends on T-001-C.

Run: `npx vitest run tests/hooks/pre-tool-use-contract.test.js tests/hooks/guard4.test.js`
Expected: **30 failed | 0 passed**. The hook file does not exist yet, so `spawnSync` succeeds (the `node` binary is real) and `result.error` is undefined; node itself exits 1 with `Cannot find module` on stderr. Every case therefore fails at `expected 1 to be 0` on the status assertion. A module-resolution error inside Vitest, or any passing case, means a suite is not exercising the artifact and must be fixed before proceeding.

Run: `npm test`
Expected: **583 passed | 30 failed | 12 skipped**. Guard 4's 17 leave the passing column because they are re-pointed, not because anything regressed.

- [ ] [T-001-E] Create the shipped hook. Depends on T-001-D.

Create `project-template/.claude/hooks/pre-tool-use.mjs`:

```js
#!/usr/bin/env node
// PreToolUse front door. Contract: https://code.claude.com/docs/en/hooks (read 2026-09-25).
// Claude Code writes the payload to stdin as JSON; a decision is returned as
// hookSpecificOutput.permissionDecision and EVERY path exits 0. Nothing here exits 2:
// a deliberate denial must never be indistinguishable from a crashed script.
// Zero dependencies by design; node: builtins only.
import { readFileSync, statSync } from 'node:fs';
import { posix } from 'node:path';

const LINE_LIMIT = 150;
const BLOCKED_COMPONENTS = new Set(['graphify-out', 'node_modules']);

let emitted = false;

function debug(msg) {
  if (process.env.CC_HOOK_DEBUG) process.stderr.write(`PRE_TOOL_USE: ${msg}\n`);
}

const deny = (reason) => ({ permissionDecision: 'deny', permissionDecisionReason: reason });
const ask = (reason) => ({ permissionDecision: 'ask', permissionDecisionReason: reason });

function emit(decision) {
  if (emitted) return;
  emitted = true;
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', ...decision },
  }) + '\n');
}

// `wc -l` counts newline characters and the 150-line threshold was calibrated against
// it, so count the same way rather than splitting (which would report one line more).
function countLines(text) {
  let n = 0;
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') n++;
  return n;
}

function isRegularFile(path) {
  try { return statSync(path).isFile(); } catch { return false; }
}

// The platform sends `file_path` for Read/Write/Edit. The bash original read `path`,
// which no tool sends, which is why Guard 2 never fired even where the wiring worked;
// both are accepted so an MCP-provided create_file/write_file keeps working.
function targetPath(input) {
  const raw = input.file_path ?? input.path;
  return typeof raw === 'string' ? raw.trim() : '';
}

function stamp(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Guard 4: reads of graphify-out/ and node_modules/ (BUG-017). Runs before Guard 1 for
// Read: a forbidden path is forbidden whatever its size, and deciding here spares a stat
// and a full file read on a path that is about to be denied anyway.
function guard4BlockedRead(input) {
  const path = targetPath(input);
  if (!path) return null; // Case A: nothing to verify
  const normalized = posix.normalize(path.replace(/\\/g, '/'));
  const parts = normalized.split('/').filter(p => p && p !== '.');
  if (!parts.some(p => BLOCKED_COMPONENTS.has(p.toLowerCase()))) return null;
  return deny(
    'Guard 4: direct reads of graphify-out/ and node_modules/ are forbidden. ' +
    'Use Glob for existence checks or the graphify skill: /graphify query "<question>".'
  );
}

// Guard 1: a large-file Read with no limit. A path that cannot be stat'd has no size to
// exceed the threshold, so it allows.
function guard1LargeRead(input) {
  if (input.limit !== undefined) return null;
  const path = targetPath(input);
  if (!path || !isRegularFile(path)) return null;
  let lines;
  try { lines = countLines(readFileSync(path, 'utf8')); }
  catch (e) { debug(`guard 1 could not read ${path}: ${e.message}`); return null; }
  if (lines <= LINE_LIMIT) return null;
  return deny(
    `Guard 1: LARGE FILE READ BLOCKED. File: ${path}. Lines: ${lines} ` +
    `(>${LINE_LIMIT}, no limit specified). Follow the orchestrator lookup chain: ` +
    '1. Check .claude/memory/project.md  2. Query graphify for structural questions  ' +
    '3. Use Grep/Glob for pattern searches  4. Read with explicit offset + limit.'
  );
}

// Guard 2: writing over a file that already exists. "ask" rather than "deny" because the
// bash original printed a three-option prompt, and the contract's "ask" is that prompt in
// the platform's own vocabulary. Not registered for Edit: a targeted edit is the action
// this guard recommends, so gating it would contradict its own text.
function guard2DuplicateWrite(input) {
  const path = targetPath(input);
  if (!path || !isRegularFile(path)) return null;
  let lines = '?';
  try { lines = countLines(readFileSync(path, 'utf8')); } catch { /* keep '?' */ }
  let modified = 'unknown';
  try { modified = stamp(statSync(path).mtimeMs); } catch { /* keep 'unknown' */ }
  return ask(
    'FILE ALREADY EXISTS\n' +
    `   Path:          ${path}\n` +
    `   Lines:         ${lines}\n` +
    `   Last modified: ${modified}\n\n` +
    '   Choose an action:\n' +
    '   1. Edit the existing file instead of overwriting\n' +
    '   2. Confirm you want to overwrite (re-issue the command)\n' +
    '   3. Cancel'
  );
}

// Guard 3: declared and empty. The twelve-pattern bash scanner has never shipped; its
// behavioral authority is tests/fixtures/guard3-reference.sh and [BUG-037] fills this in.
// The slot exists now so that port plugs in a pattern table and nothing else, and so the
// Bash dispatch route is proven live by this release's harness.
function guard3BashScan() {
  return null;
}

const DISPATCH = {
  Read: [guard4BlockedRead, guard1LargeRead],
  Write: [guard2DuplicateWrite],
  create_file: [guard2DuplicateWrite],
  write_file: [guard2DuplicateWrite],
  Edit: [],
  Bash: [guard3BashScan],
};

// Case B. Unparseable input is not "nothing to verify", it is "the verifier could not
// run", which is the condition that fails closed. CC_HOOK_ALLOW bypasses THIS denial only;
// it does not suppress, alter or bypass any guard's decision on input that parses.
function unreadable(why) {
  process.stderr.write(
    `pre-tool-use: ${why}; no guard could inspect this call. ` +
    'Set CC_HOOK_ALLOW=1 to allow calls whose payload this hook cannot read.\n'
  );
  if (process.env.CC_HOOK_ALLOW) return;
  emit(deny(
    `Pre-tool-use hook: ${why}, so no guard could inspect this call. ` +
    'Unreadable input fails closed. Set CC_HOOK_ALLOW=1 to override.'
  ));
}

function main() {
  let raw = '';
  try { raw = readFileSync(0, 'utf8'); }
  catch (e) { debug(`stdin read failed: ${e.message}`); }

  let payload;
  try { payload = JSON.parse(raw); }
  catch { return unreadable('stdin did not parse as JSON'); }

  // Parsed, so not Case B. Anything the table cannot route on is unfamiliar-but-valid,
  // and fail-closed is scoped to unparseable input, never to an additive payload change.
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    debug('payload is not a JSON object; allowing');
    return;
  }
  const name = typeof payload.tool_name === 'string' ? payload.tool_name : '';
  const raw_input = payload.tool_input;
  const input = (raw_input && typeof raw_input === 'object' && !Array.isArray(raw_input)) ? raw_input : {};
  const guards = DISPATCH[name];
  if (!guards) { debug(`no guard registered for tool_name "${name}"; allowing`); return; }
  for (const guard of guards) {
    const decision = guard(input);
    if (decision) { emit(decision); return; }
  }
}

try { main(); } catch (e) { unreadable(`the hook threw (${e && e.message})`); }
```

- [ ] [T-001-F] Mirror the hook into this repository's own `.claude/hooks/`, so the project runs the artifact it ships. Depends on T-001-E.

```bash
cp project-template/.claude/hooks/pre-tool-use.mjs .claude/hooks/pre-tool-use.mjs
cmp project-template/.claude/hooks/pre-tool-use.mjs .claude/hooks/pre-tool-use.mjs && echo "IDENTICAL"
```
Expected: `IDENTICAL`.

- [ ] [T-001-G] Run both hook suites green. Depends on T-001-F.

Run: `npx vitest run tests/hooks/pre-tool-use-contract.test.js tests/hooks/guard4.test.js`
Expected: **30 passed** (13 harness, 17 Guard 4). If a Guard 4 case other than row14 or row16 fails, the translation drifted; fix the hook, never the case.

- [ ] [T-001-H] Run the full suite. Depends on T-001-G.

Run: `npm test`
Expected: **613 passed | 12 skipped**. Guard 4's 17 cases are re-pointed rather than added, so the arithmetic is the 600 baseline plus the 13 new harness cases.

- [ ] [T-001-I] Stage the four tracked paths this task changed. Depends on T-001-H. The spec correction lives under gitignored `docs/` and is not staged.

```bash
git add tests/hooks/pre-tool-use-contract.test.js tests/hooks/guard4.test.js project-template/.claude/hooks/pre-tool-use.mjs .claude/hooks/pre-tool-use.mjs
```

- [ ] [T-001-J] Verify exactly four staged paths. Depends on T-001-I.

```bash
git diff --cached --name-only
```
Expected: exactly four lines, `.claude/hooks/pre-tool-use.mjs`, `project-template/.claude/hooks/pre-tool-use.mjs`, `tests/hooks/guard4.test.js`, `tests/hooks/pre-tool-use-contract.test.js`.

- [ ] [T-001-K] Commit. Depends on T-001-J.

```bash
git commit -m "$(cat <<'EOF'
feat: add the Node pre-tool-use front door on the platform stdin contract [BUG-036]

Guards 1, 2 and 4 translated from the bash original; Guard 3's slot declared and
empty. Every denial is hookSpecificOutput.permissionDecision with exit 0. Case B
(unparseable stdin) denies pre-dispatch behind CC_HOOK_ALLOW, whose scope is pinned
by a negative test: a well-formed graphify-out read is denied with it set.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Wiring, the frozen Guard 3 corpus, and the re-pointed suites

**Files:**
- Modify: `project-template/.claude/settings.json:5-9`
- Modify: `.claude/settings.json:5-9`
- Delete: `project-template/.claude/hooks/pre-tool-use.sh`
- Create: `tests/fixtures/guard3-reference.sh` (from `.claude/hooks/pre-tool-use.sh`, which is removed)
- Modify: `tests/hooks/guard3.test.js:10`
- Modify: `tests/guard3-test.sh:5`
- Modify: `tests/installer/templates.test.js` (append one describe block)

**Interfaces:**
- Consumes: `.claude/hooks/pre-tool-use.mjs` and `project-template/.claude/hooks/pre-tool-use.mjs` from Task 1, invoked as `node <path>` with the payload on stdin.
- Produces: `tests/fixtures/guard3-reference.sh`, a standalone bash script that reads `CLAUDE_TOOL_NAME` and `CLAUDE_TOOL_INPUT` from the environment, runs Guard 3 alone, exits 1 when a pattern fires and 0 otherwise, and still declares `BASH_SCAN_ALLOWLIST=()` on its own line for `runAllowlisted` to rewrite.

- [ ] [T-002-A] Point the shipped settings entry at the `.mjs` and widen the matcher. Modify `project-template/.claude/settings.json`, replacing:

```json
        "matcher": "Write|Edit|create_file|write_file",
        "hooks": [
          {
            "type": "command",
            "command": "bash -c 'h=\".claude/hooks/pre-tool-use.sh\"; [ -f \"$h\" ] && bash \"$h\" || { echo \"⚠ Hook missing — run /cc-init to repair\"; exit 0; }'"
          }
        ]
```

with:

```json
        "matcher": "Read|Write|Edit|create_file|write_file|Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node .claude/hooks/pre-tool-use.mjs"
          }
        ]
```

The `bash -c` wrapper is dropped deliberately: a `command` with no `args` runs under PowerShell on a Windows host without Git Bash, where `bash -c` fails outright, so the curated "Hook missing" message was unreachable on exactly the hosts that needed it. A missing file now degrades to the platform's own non-blocking hook error, which is what exit 1 means in this contract.

- [ ] [T-002-B] Apply the identical change to this repository's own settings. Modify `.claude/settings.json` with the same replacement as T-002-A.

- [ ] [T-002-C] Delete the shipped bash hook. Depends on T-002-A.

```bash
git rm project-template/.claude/hooks/pre-tool-use.sh
```

- [ ] [T-002-D] Move the repository-local bash hook to the fixtures directory, preserving history.

```bash
mkdir -p tests/fixtures
git mv .claude/hooks/pre-tool-use.sh tests/fixtures/guard3-reference.sh
```

`git mv` stages the rename, and T-002-E then edits the moved file, so the index holds the pre-strip content until T-002-M re-stages it. That is the one place in this plan where a staging operation precedes an edit of the same path, and it is the reason T-002-N verifies `git status --porcelain` as well as the staged list: an unstaged modification there means the strip was never committed.

- [ ] [T-002-E] Strip the fixture to Guard 3 alone and give it a header that records what it is. Depends on T-002-D. Lines 29 through 465 of the original are the Guard 3 helpers, the `_G3_*` regex constants, the twelve pattern functions, the allowlist matcher and the Guard 3 block itself; lines 6 to 27 are Guard 1 and lines 466 to 519 are Guards 4 and 2.

```bash
{
  printf '%s\n' \
    '#!/usr/bin/env bash' \
    '# FROZEN CORPUS SUBJECT. NOT A SHIPPED ARTIFACT.' \
    '#' \
    '# The bash Guard 3 implementation as it stood at 1.27.2. It ships to no one: the' \
    '# installer deploys project-template/.claude/hooks/pre-tool-use.mjs, whose Guard 3' \
    '# slot is declared and empty. These twelve patterns are the behavioral authority' \
    '# the [BUG-037] port is verified against, exercised unchanged by the 108 cases in' \
    '# tests/hooks/guard3.test.js. Do not edit to make a port pass.' \
    '' \
    'set -euo pipefail'
  sed -n '29,465p' tests/fixtures/guard3-reference.sh
} > tests/fixtures/guard3-reference.sh.tmp
mv tests/fixtures/guard3-reference.sh.tmp tests/fixtures/guard3-reference.sh
```

- [ ] [T-002-F] Verify the fixture carries Guard 3 and nothing else. Depends on T-002-E.

```bash
bash -n tests/fixtures/guard3-reference.sh && echo "PARSES"
echo "python3: $(grep -c 'python3' tests/fixtures/guard3-reference.sh || true)"
echo "guard2:  $(grep -c 'FILE ALREADY EXISTS' tests/fixtures/guard3-reference.sh || true)"
echo "guard1:  $(grep -c 'LARGE FILE READ BLOCKED' tests/fixtures/guard3-reference.sh || true)"
echo "allowlist decl: $(grep -c '^BASH_SCAN_ALLOWLIST=' tests/fixtures/guard3-reference.sh || true)"
echo "lines: $(wc -l < tests/fixtures/guard3-reference.sh)"
```
Expected: `PARSES`, `python3: 0`, `guard2: 0`, `guard1: 0`, `allowlist decl: 1`, `lines: 446`. A non-zero count on any of the three guards means the line range was wrong; halt and re-derive it rather than deleting by hand.

- [ ] [T-002-G] Re-point the Guard 3 suite at the fixture without touching a case. Depends on T-002-F. Modify `tests/hooks/guard3.test.js`, replacing line 10:

```js
const HOOK = join(REPO_ROOT, '.claude/hooks/pre-tool-use.sh')
```

with:

```js
// The frozen corpus subject, not a shipped artifact: the deployed hook is
// pre-tool-use.mjs, whose Guard 3 slot is empty until [BUG-037]. These 108 cases are
// the behavioral authority that port is verified against, so not one of them moves.
const HOOK = join(REPO_ROOT, 'tests/fixtures/guard3-reference.sh')
```

- [ ] [T-002-H] Re-point the standalone bash harness. Modify `tests/guard3-test.sh`, replacing line 5:

```bash
HOOK=".claude/hooks/pre-tool-use.sh"
```

with:

```bash
HOOK="tests/fixtures/guard3-reference.sh"
```

- [ ] [T-002-I] Run the Guard 3 suite. Depends on T-002-G.

Run: `npx vitest run tests/hooks/guard3.test.js`
Expected: **108 passed**. Any failure here means the strip removed something Guard 3 depends on; fix the fixture, never the case.

- [ ] [T-002-J] Pin the wiring and the mirror. Depends on T-002-B. Append to `tests/installer/templates.test.js`:

```js
const SETTINGS = ['.claude/settings.json', 'project-template/.claude/settings.json'];
const HOOK_MIRRORS = ['.claude/hooks/pre-tool-use.mjs', 'project-template/.claude/hooks/pre-tool-use.mjs'];
const readText = (rel) => readFileSync(join(root, rel), 'utf8').replace(/\r\n/g, '\n');

describe('pre-tool-use wiring', () => {
  it('ships the front door as one byte-identical mirrored pair', () => {
    expect(readText(HOOK_MIRRORS[0])).toBe(readText(HOOK_MIRRORS[1]));
  });

  // Read and Bash are asserted by name: their absence from the matcher is the defect
  // that made Guards 1, 3 and 4 unreachable on every deployed machine.
  it.each(SETTINGS)('%s gates Read and Bash through one union matcher', (rel) => {
    const entries = JSON.parse(readText(rel)).hooks.PreToolUse;
    expect(entries).toHaveLength(1);
    expect(entries[0].matcher).toBe('Read|Write|Edit|create_file|write_file|Bash');
    expect(entries[0].matcher.split('|')).toContain('Read');
    expect(entries[0].matcher.split('|')).toContain('Bash');
    expect(entries[0].hooks.map(h => h.command)).toEqual(['node .claude/hooks/pre-tool-use.mjs']);
  });

  it('leaves no CLAUDE_TOOL_NAME or CLAUDE_TOOL_INPUT reference in the shipped tree', () => {
    const offenders = [];
    const walk = (dir, rel) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) { walk(join(dir, entry.name), `${rel}/${entry.name}`); continue; }
        const text = readFileSync(join(dir, entry.name), 'utf8');
        if (/CLAUDE_TOOL_(NAME|INPUT)/.test(text)) offenders.push(`${rel}/${entry.name}`);
      }
    };
    for (const d of ['global', 'project-template']) walk(join(root, d), d);
    expect(offenders).toEqual([]);
  });
});
```

- [ ] [T-002-K] Run the templates suite. Depends on T-002-J.

Run: `npx vitest run tests/installer/templates.test.js`
Expected: **19 passed** (15 existing plus 4 new).

- [ ] [T-002-L] Run the full suite. Depends on T-002-K.

Run: `npm test`
Expected: **617 passed | 12 skipped**.

- [ ] [T-002-M] Stage everything this task touched. Depends on T-002-L. `git rm` and `git mv` already staged their own deletions and renames; this picks up the edits.

```bash
git add project-template/.claude/settings.json .claude/settings.json \
  tests/fixtures/guard3-reference.sh tests/hooks/guard3.test.js tests/guard3-test.sh \
  tests/installer/templates.test.js
```

- [ ] [T-002-N] Verify the staged set. Depends on T-002-M.

```bash
git diff --cached --name-only | sort
git status --porcelain
```
Expected from the first command, eight paths: `.claude/hooks/pre-tool-use.sh` (deleted), `.claude/settings.json`, `project-template/.claude/hooks/pre-tool-use.sh` (deleted), `project-template/.claude/settings.json`, `tests/fixtures/guard3-reference.sh`, `tests/guard3-test.sh`, `tests/hooks/guard3.test.js`, `tests/installer/templates.test.js`. The second must show no unstaged modification to any of them.

- [ ] [T-002-O] Commit. Depends on T-002-N.

```bash
git commit -m "$(cat <<'EOF'
fix: wire PreToolUse to the union matcher and re-point the guard suites [BUG-036]

The matcher excluded Read, so Guards 1 and 4 were unreachable on every deployed
machine. Both settings files now name one union matcher and the Node front door.
The 519-line bash hook becomes tests/fixtures/guard3-reference.sh, a frozen corpus
subject that ships to no one and keeps its 108 cases green as [BUG-037]'s authority.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Documentation states what ships

**Files:**
- Modify: `README.md:179-187` (the pre-tool-use section), `README.md:301` (the file tree)
- Modify: `CLAUDE.md:102`, `project-template/CLAUDE.md:103`
- Modify: `.claude/commands/cc-init.md:91-102`, `project-template/.claude/commands/cc-init.md:91-102`
- Modify: `CONTRIBUTING.md:64-73` (the reset section)

**Interfaces:**
- Consumes: the shipped state produced by Tasks 1 and 2.
- Produces: no code interface. The `cc-init.md` pair must stay parity-clean under `tests/installer/commands-parity.test.js`, which compares the two files after rewriting `node .claude/scripts/` to `node scripts/`; the hook path is identical in both mirrors, so both edits must be byte-identical.

- [ ] [T-003-A] Replace the README hook section. Modify `README.md`, replacing the block that begins `### pre-tool-use` and ends with the Guard 3 paragraph (`... BASH_SCAN_ALLOWLIST` in the hook file.`) with:

```markdown
### pre-tool-use

Fires before `Read`, `Write`, `Edit`, `create_file`, `write_file` and `Bash`. A single zero-dependency Node front door (`pre-tool-use.mjs`) reads the `PreToolUse` payload from stdin, dispatches on `tool_name`, and returns its verdict as `hookSpecificOutput.permissionDecision`. Every path exits 0: a denial is data, never an exit code.

**Large-file Read guard (Guard 1)** - a `Read` of a file over 150 lines that names no `limit` is denied, and the reason redirects Claude to the orchestrator lookup chain (memory, graph, grep, targeted read). Prevents reading entire codebases when a targeted search would do.

**Duplicate file guard (Guard 2)** - a `Write`, `create_file` or `write_file` naming a path that already exists returns `ask`, showing the path, line count and last-modified timestamp with three options: edit in place, confirm the overwrite, or cancel. `Edit` is deliberately not gated, because editing in place is the action this guard recommends.

**Bash scan guard (Guard 3)** - not shipped yet. `Bash` already routes to the guard's slot and the slot is empty. The twelve-pattern scanner is verified in this repository against `tests/fixtures/guard3-reference.sh` and ships in `[BUG-037]`.

**graphify-out and node_modules guard (Guard 4)** - a `Read` whose path carries `graphify-out` or `node_modules` as an exact path component is denied, with backslashes and `..` resolved first. Use Glob for existence checks and the graphify skill for graph questions.

Input the hook cannot parse fails closed: it is denied with one stderr line naming `CC_HOOK_ALLOW=1`, which overrides that denial alone and leaves every guard fully active on every payload the hook can read. Set `CC_HOOK_DEBUG=1` to see the diagnostic lines it otherwise swallows.
```

- [ ] [T-003-B] Update the file tree entry. Modify `README.md`, replacing:

```
│       │   ├── pre-tool-use.sh   Large-file read guard + duplicate file guard + bash scan guard
```

with:

```
│       │   ├── pre-tool-use.mjs  Node front door: large-file, duplicate-write and graphify-out guards
```

- [ ] [T-003-C] Correct the filename in the hard constraint. Modify `CLAUDE.md`, replacing:

```
- Never skip the pre-tool-use.sh hook; if it blocks a tool invocation, investigate — do not bypass.
```

with:

```
- Never skip the pre-tool-use hook; if it blocks a tool invocation, investigate — do not bypass.
```

The line `Guard 4 blocks such reads at the hook level` at `CLAUDE.md:38` is left alone: this release is what makes it true.

- [ ] [T-003-D] Apply the identical edit to `project-template/CLAUDE.md`, replacing the same `Never skip the pre-tool-use.sh hook` line with the same replacement as T-003-C.

- [ ] [T-003-E] Update the `/cc-init` hook integrity check in the template mirror. Modify `project-template/.claude/commands/cc-init.md`, replacing:

````markdown
Verify `.claude/hooks/pre-tool-use.sh` exists and is executable:

```bash
HOOK=".claude/hooks/pre-tool-use.sh"
if [ ! -f "$HOOK" ]; then
  echo "⚠️  Hook missing: $HOOK"
  echo "Run: bash install.sh  (or copy from project-template/.claude/hooks/)"
  exit 1
fi
[ -x "$HOOK" ] || chmod +x "$HOOK"
echo "✓ Hook OK: $HOOK"
```
````

with:

````markdown
Verify `.claude/hooks/pre-tool-use.mjs` exists. It is launched as `node <path>`, so it needs no execute bit:

```bash
HOOK=".claude/hooks/pre-tool-use.mjs"
if [ ! -f "$HOOK" ]; then
  echo "⚠️  Hook missing: $HOOK"
  echo "Run: npx code-conductor --project  (or copy from project-template/.claude/hooks/)"
  exit 1
fi
echo "✓ Hook OK: $HOOK"
```
````

- [ ] [T-003-F] Apply the byte-identical edit to `.claude/commands/cc-init.md`. Depends on T-003-E. The parity suite compares the two files after rewriting script paths only, so any divergence in this block fails `tests/installer/commands-parity.test.js`.

- [ ] [T-003-G] Update the reset instructions. Modify `CONTRIBUTING.md`, replacing:

````markdown
If your local `.claude/hooks/pre-tool-use.sh` has diverged (e.g., manual edits, failed
partial upgrade), delete it and re-run the installer to pull the current version from the
project template:

**macOS / Linux / Windows:**
```bash
rm .claude/hooks/pre-tool-use.sh   # (PowerShell: Remove-Item .claude\hooks\pre-tool-use.sh)
code-conductor --project
```
````

with:

````markdown
If your local `.claude/hooks/pre-tool-use.mjs` has diverged (e.g., manual edits, failed
partial upgrade), delete it and re-run the installer to pull the current version from the
project template:

**macOS / Linux / Windows:**
```bash
rm .claude/hooks/pre-tool-use.mjs   # (PowerShell: Remove-Item .claude\hooks\pre-tool-use.mjs)
code-conductor --project
```
````

- [ ] [T-003-H] Confirm no stale filename survives outside the frozen fixture and the backlog's historical record. Depends on T-003-G.

```bash
grep -rn "pre-tool-use\.sh" README.md CLAUDE.md CONTRIBUTING.md project-template/ .claude/commands/ skills/ global/ || echo "NONE"
```
Expected: `NONE`.

- [ ] [T-003-I] Run the full suite. Depends on T-003-H.

Run: `npm test`
Expected: **617 passed | 12 skipped**. The `cc-init.md` parity cases are the ones at risk here; a failure means the two mirrors diverged in T-003-E / T-003-F.

- [ ] [T-003-J] Stage the documentation set. Depends on T-003-I.

```bash
git add README.md CLAUDE.md project-template/CLAUDE.md CONTRIBUTING.md \
  .claude/commands/cc-init.md project-template/.claude/commands/cc-init.md
```

- [ ] [T-003-K] Verify exactly six staged paths. Depends on T-003-J.

```bash
git diff --cached --name-only
```
Expected: six lines, the six files listed in T-003-J.

- [ ] [T-003-L] Commit. Depends on T-003-K.

```bash
git commit -m "$(cat <<'EOF'
docs: state the guard set this release actually ships [BUG-036]

The README advertised three working guards and a bash scanner that has reached no
user. It now describes the Node front door, names Guard 3 as verified in-repository
and shipping in [BUG-037], and documents CC_HOOK_ALLOW's single-case scope. The
/cc-init integrity check and the CONTRIBUTING reset both point at the .mjs.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Release 1.28.0

**Files:**
- Modify: `VERSION`
- Modify: `package.json`, `package-lock.json` (via `npm version`)
- Modify: `CHANGELOG.md` (new entry at the top)
- Modify: `AGENT-READABLE BACKLOG.md:265` (`[BUG-036]` checkbox)

**Interfaces:**
- Consumes: the working tree produced by Tasks 1 to 3.
- Produces: version `1.28.0` recorded identically in `VERSION`, `package.json` and `package-lock.json`.

- [ ] [T-004-A] Bump the manifest and the lockfile together. `npm version` is used rather than a hand edit because the lockfile records the version twice (root and `packages[""]`).

```bash
npm version 1.28.0 --no-git-tag-version
```

- [ ] [T-004-B] Bump the `VERSION` file. Depends on T-004-A.

```bash
printf '1.28.0\n' > VERSION
```

- [ ] [T-004-C] Verify all three agree. Depends on T-004-B.

```bash
cat VERSION
node -p "require('./package.json').version"
node -p "require('./package-lock.json').version + ' / ' + require('./package-lock.json').packages[''].version"
```
Expected: `1.28.0` from each of the four readings.

- [ ] [T-004-D] Add the changelog entry. Modify `CHANGELOG.md`, inserting immediately after the `# Changelog` line and its blank line:

```markdown
## [1.28.0] - 2026-09-25

### Fixed

- **[BUG-036]** Code Conductor advertised four `pre-tool-use` guards. On a deployed machine none of them had ever fired, for four independent reasons. Both `settings.json` files wired `PreToolUse` with `matcher: "Write|Edit|create_file|write_file"`, so a `Read` never reached the hook at all and the two guards that exist to catch one were unreachable. The script read `CLAUDE_TOOL_NAME` and `CLAUDE_TOOL_INPUT` from the environment, but the platform passes `{tool_name, tool_input}` as JSON on stdin, and no environment contract is documented anywhere in the hooks reference. Blocking was attempted with `exit 1`, which the contract defines as a non-blocking error. Guard 4's path check shelled out to `python3 -c` with `2>/dev/null || true`, so a Python-free host produced neither `BLOCK` nor `OK` and the read was allowed. The hook is now a single zero-dependency Node front door, `pre-tool-use.mjs`, that parses stdin once, dispatches on `tool_name`, and denies through `hookSpecificOutput.permissionDecision` with exit 0 on every path. Guard 2 returns `"ask"`, which is what its three-option prompt always meant; it accepts `file_path` with `path` as a compatibility fallback, having previously read only `path`, which no tool sends; and it is scoped to `Write`, `create_file` and `write_file`, because gating `Edit` would prompt on the very action the guard recommends. Input the hook cannot parse fails closed with one stderr line and a `CC_HOOK_ALLOW=1` override whose scope is pinned by a test that proves a well-formed `graphify-out/` read is still denied with it set. A new integration harness invokes the hook exactly as Claude Code does, which is the layer the 125 existing guard tests never touched.
- **[BUG-037] is not fixed here.** Guard 3, the twelve-pattern bash command scanner, has never shipped: the deployed template carried none of it. Its implementation is preserved as `tests/fixtures/guard3-reference.sh`, its 108 cases still run against it, and the front door's Guard 3 slot is declared and empty until that port lands.

Existing installations: re-run the installer to apply. Be aware of `[BUG-035]` before you do: the installer force-copies `settings.json` over the host's, so any `UserPromptSubmit` entry you added yourself is lost in that re-run. Back the file up if it carries entries you own.
```

- [ ] [T-004-E] Flip the backlog entry. Modify `AGENT-READABLE BACKLOG.md`, replacing:

```
### [ ] `[BUG-036]` The pre-tool-use Hook Speaks a Contract Claude Code Does Not Use, So No Guard Has Ever Fired
```

with:

```
### [X] `[BUG-036]` The pre-tool-use Hook Speaks a Contract Claude Code Does Not Use, So No Guard Has Ever Fired
```

`[BUG-034]` keeps its `[~]` superseded state and is not marked done. `[BUG-035]` and `[BUG-037]` stay `[ ]`.

- [ ] [T-004-F] Verify the flip is exactly one line changed. Depends on T-004-E.

```bash
git diff --numstat "AGENT-READABLE BACKLOG.md"
```
Expected: `1	1	AGENT-READABLE BACKLOG.md`.

- [ ] [T-004-G] Run the full suite. Depends on T-004-F.

Run: `npm test`
Expected: **617 passed | 12 skipped**.

- [ ] [T-004-H] Stage the release set. Depends on T-004-G.

```bash
git add VERSION package.json package-lock.json CHANGELOG.md "AGENT-READABLE BACKLOG.md"
```

- [ ] [T-004-I] Verify exactly five staged paths. Depends on T-004-H.

```bash
git diff --cached --name-only
```
Expected: five lines, `AGENT-READABLE BACKLOG.md`, `CHANGELOG.md`, `VERSION`, `package-lock.json`, `package.json`.

- [ ] [T-004-J] Commit. Depends on T-004-I.

```bash
git commit -m "$(cat <<'EOF'
chore: release 1.28.0 [BUG-036]

Minor, not a patch: the hook's interface with Claude Code changes. Names [BUG-035]
in the upgrade line, because this release is the one telling users to re-run the
installer that triggers it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Ship the branch

**Files:**
- Modify: `docs/superpowers/plans/2026-09-25-bug036-pre-tool-use-hook-contract.md` (terminal checkbox state)

**Interfaces:**
- Consumes: the four commits from Tasks 0 to 4.
- Produces: a pushed branch and an open pull request.

- [ ] [T-005-A] Push the branch.

```bash
git push -u origin HEAD
```

- [ ] [T-005-B] Open the pull request. Depends on T-005-A.

```bash
gh pr create --title "fix: repair the pre-tool-use hook contract so the guards actually fire [BUG-036]" --body "$(cat <<'EOF'
## Summary

Four defects, one root cause: nothing in this repository has ever exercised the hook's real interface with Claude Code, so every guard it advertises has been theatre on a deployed machine.

- The `PreToolUse` matcher excluded `Read`, making Guards 1 and 4 unreachable.
- The script read `CLAUDE_TOOL_NAME` / `CLAUDE_TOOL_INPUT`; the platform sends `{tool_name, tool_input}` as JSON on stdin.
- Blocking used `exit 1`, which the contract defines as a non-blocking error.
- Guard 4's path check shelled out to `python3`, failing open on a Python-free host (the originally filed `[BUG-034]`, now superseded).

Replaced with one zero-dependency Node front door. Guard 3, which had never shipped at all, is frozen as a test fixture and ships in `[BUG-037]`.

## Named behavior changes

- Guard 2 returns `"ask"` rather than `"deny"`: its output was always a three-option prompt.
- Guard 2 accepts `file_path`, with `path` as a compatibility fallback. It previously read only `path`, which no tool sends, so it could not fire even where the wiring worked.
- Guard 2 is scoped to `Write`, `create_file`, `write_file`. Gating `Edit` would prompt on the action the guard itself recommends.
- For `Read`, Guard 4 decides before Guard 1. Both exited 1 before, so no precedence was ever observable.
- `row14` (malformed stdin) and `row16` (empty PATH) flip to expect a denial. `row15` stays allowing. No other case moved.

## Test plan

- `npm test`: 617 passed / 12 skipped (baseline 600 / 12).
- New `tests/hooks/pre-tool-use-contract.test.js` spawns the hook with a real stdin payload for all 13 contract cases, including the `CC_HOOK_ALLOW` negative test that keeps the override from becoming a guard kill switch.
- 108 Guard 3 cases green against the frozen fixture, unchanged.
- 17 Guard 4 cases green against the new artifact.

## Upgrade note

Existing installations must re-run the installer. That re-run triggers `[BUG-035]`, which overwrites a host `settings.json`; the changelog names it rather than leaving a user to discover it.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] [T-005-C] Report the PR URL and hand off. Depends on T-005-B. The terminal checkbox state of this plan lands as its own closing `docs:` commit after every box above reads `[X]`, never as an amend of the release commit.

---

## Test List

- [ ] [T-T01] Integration harness, `tests/hooks/pre-tool-use-contract.test.js`, 13 cases: blocked `graphify-out/` read, allowed source read, `Write` over an existing file returning `ask`, `Write` to a new path, 200-line `Read` without `limit` denied, the same read with `limit` allowed, `Bash` routing to the empty Guard 3 slot, Case A, Case B, Case B with the override, the override's negative scope test, the canary, and the no-exit-2 / no-legacy-shape sweep.
- [ ] [T-T02] Guard 4 logic suite re-pointed at the new artifact, 17 cases, two verdicts flipped with their red states predicted.
- [ ] [T-T03] Guard 3 corpus re-pointed at `tests/fixtures/guard3-reference.sh`, 108 cases, not one altered.
- [ ] [T-T04] Parity assertion pinning the two `pre-tool-use.mjs` mirrors byte for byte.
- [ ] [T-T05] Matcher assertions over both `settings.json` files, naming `Read` and `Bash` explicitly.
- [ ] [T-T06] Absence sweep proving no `CLAUDE_TOOL_NAME` / `CLAUDE_TOOL_INPUT` reference survives in `global/` or `project-template/`.
- [ ] [T-T07] No E2E test: this project ships no UI.

## Commit Order

1. **T-000**: the plan file (`docs:`).
2. **T-001**: the front door, its mirror, the integration harness, and Guard 4's re-pointed suite with its two flips (`feat:`). Green at 613 / 12.
3. **T-002**: both settings files, the template hook deletion, the frozen Guard 3 fixture, its two re-pointed harnesses, and the wiring assertions (`fix:`). Green at 617 / 12.
4. **T-003**: README, both `CLAUDE.md` files, both `cc-init.md` mirrors, `CONTRIBUTING.md` (`docs:`). Green at 617 / 12.
5. **T-004**: `VERSION`, `package.json`, `package-lock.json`, `CHANGELOG.md`, backlog flip (`chore:`). Green at 617 / 12.
6. **T-005**: push, PR, then the plan's terminal checkbox state as a closing `docs:` commit.

Task 1 is separable from Task 2 on purpose: the hook, its harness and Guard 4's flipped verdicts land green before anything is wired, so the artifact and the proof that it works are on record as one reviewable commit even if the wiring goes wrong. The flips sit beside the parser that justifies them, as the spec requires, and are written before it exists so each carries a predicted red state.

## Identified Risks

| Risk | Detection | Response |
|---|---|---|
| This repository's own `.claude/settings.json` changes at T-002-B, so from that commit onward the session's own `Read` of any file over 150 lines without a `limit` is denied, and any `Write` over an existing file asks. | The first denied Read after T-002-B. | Intended dogfooding. Every subsequent step in this plan reads with an explicit `offset` and `limit`, which `CLAUDE.md` already mandates. If the denial is wrong, it is a Guard 1 defect found by using it, not a reason to widen the override. |
| Settings may not hot-reload mid-session, so the guard might not engage until the next session. | No behavior change after T-002-B. | Not a failure. The harness is the proof of record; the live session is a bonus observation. Record which one happened in the implementation report. |
| The fixture strip at T-002-E takes a line range. A wrong range silently drops a helper that only some of the 108 cases reach. | T-002-F's five counts, then T-002-I's 108 cases. | Halt and re-derive the range from the original file. Never edit a case to accommodate a bad strip. |
| Guard 1 could pre-empt Guard 4 on a machine where `graphify-out/graph.json` exists and exceeds 150 lines, making `row1`'s reason assertion machine-dependent. | `guard4.test.js` row1 failing on one developer's machine and not another's. | Already closed by ordering Guard 4 first in `DISPATCH.Read`. Do not reorder. |
| `readFileSync(0)` throws on a TTY, so running the hook by hand in a terminal produces a Case B denial rather than a hang. | Manual invocation printing the denial JSON. | Correct by design. Feed it a payload: `echo '{"tool_name":"Read","tool_input":{}}' \| node .claude/hooks/pre-tool-use.mjs`. |
| Guard 2's newly working `file_path` support could surprise users who have never seen this prompt, since it has never once fired. | The 1.28.0 changelog is the notice; `ask` is advisory and dismissible. | Named in the changelog and in the README. Scoped away from `Edit`, which is where the volume would have been. |
| `npm version` also rewrites the lockfile; a dirty lockfile from an unrelated `npm install` would ride along in the release commit. | T-004-I's five-path check. | If a sixth path appears, unstage it and investigate before committing. |
| The `cc-init.md` pair must stay byte-identical in the edited block or the parity suite fails, and the failure names the parity test rather than the edit. | T-003-I. | Re-apply T-003-E's replacement verbatim to the second mirror; do not hand-retype it. |
