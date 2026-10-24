import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HOOK = join(REPO_ROOT, '.claude/hooks/pre-tool-use.mjs');

// The hook roots its allowlist at CLAUDE_PROJECT_DIR when set (BUG-061). A run inside
// Claude Code, or in a worktree, may inherit one that names another checkout, whose
// allowlist would then decide the Guard 3 assertions below.
const contractEnv = () => {
  const env = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  return env;
};

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
    env: { ...contractEnv(), ...env },
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
  it('denies a node_modules read and still exits 0', () => {
    const r = fire(readPayload('node_modules/pkg/index.js'));
    expect(r.status).toBe(0);
    expect(r.decision.hookEventName).toBe('PreToolUse');
    expect(r.decision.permissionDecision).toBe('deny');
    expect(r.decision.permissionDecisionReason).toMatch(/Guard 4/);
  });

  it('Guard 1 names no graph step in its lookup chain', () => {
    const r = fire(readPayload(writeLines('big.txt', 200)));
    expect(r.decision.permissionDecision).toBe('deny');
    expect(r.decision.permissionDecisionReason).toMatch(/Guard 1/);
    expect(r.decision.permissionDecisionReason).not.toMatch(/graph/i);
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

  // [BUG-063] A binary has no lines: Claude Code renders an image rather than reading it
  // as text, so its 0x0A bytes must not count. Every PNG carries NUL in its IHDR length.
  it('allows a no-limit Read of a binary PNG with more than 150 newline bytes', () => {
    const p = join(dir, 'shot.png');
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const ihdrLength = Buffer.from([0x00, 0x00, 0x00, 0x0d]);
    writeFileSync(p, Buffer.concat([signature, ihdrLength, Buffer.alloc(200, 0x0a)]));
    const r = fire(readPayload(p));
    expect(r.status).toBe(0);
    expect(r.decision).toBeNull();
  });

  it('still denies a 200-line text file whose first NUL sits past the sniff window', () => {
    const p = join(dir, 'late-nul.txt');
    writeFileSync(p, 'x'.repeat(8000) + '\n'.repeat(200) + '\0');
    const r = fire(readPayload(p));
    expect(r.decision.permissionDecision).toBe('deny');
    expect(r.decision.permissionDecisionReason).toMatch(/Guard 1/);
  });

  // This pair replaces the 1.28.0 assertion that the Bash route reached an EMPTY
  // Guard 3 slot. [BUG-037] filled the slot, so the route is now proven live by a
  // real verdict, and the second half keeps that from degrading into a blanket deny.
  it('routes a Bash payload to Guard 3, which denies a mass-dump command', () => {
    const r = fire({ tool_name: 'Bash', tool_input: { command: 'cat *.ts' } });
    expect(r.status).toBe(0);
    expect(r.decision.permissionDecision).toBe('deny');
    expect(r.decision.permissionDecisionReason).toMatch(/BASH SCAN BLOCKED/);
  });

  it('leaves an ordinary Bash command alone', () => {
    const r = fire({ tool_name: 'Bash', tool_input: { command: 'git status --porcelain' } });
    expect(r.status).toBe(0);
    expect(r.decision).toBeNull();
  });

  // [BUG-044] The allowlist sentence rides only on a pattern denial. g3AllowlistCovers runs
  // at the end of guard3BashScan; the length and malformed denials return before it, so on
  // those two the allowlist cannot lift the block. Each absence case asserts its positive
  // half in the same breath, so a denial that failed to fire cannot satisfy the absence
  // vacuously.
  it('a pattern denial names the allowlist as operator policy', () => {
    const r = fire({ tool_name: 'Bash', tool_input: { command: 'cat *.ts' } });
    expect(r.decision.permissionDecision).toBe('deny');
    expect(r.decision.permissionDecisionReason).toMatch(/BASH SCAN BLOCKED/);
    expect(r.decision.permissionDecisionReason).toMatch(/Pattern ids: P4/);
    expect(r.decision.permissionDecisionReason).toMatch(/Authorized alternatives/);
    expect(r.decision.permissionDecisionReason).toContain('.claude/memory/bash-scan-allowlist.txt');
    expect(r.decision.permissionDecisionReason).toMatch(/operator policy/);
    expect(r.decision.permissionDecisionReason).toMatch(/must not add it to clear its own denial/);
  });

  it('a length denial carries no allowlist sentence, because the allowlist is never consulted', () => {
    const r = fire({ tool_name: 'Bash', tool_input: { command: 'echo ' + 'x'.repeat(8193) } });
    expect(r.decision.permissionDecision).toBe('deny');
    expect(r.decision.permissionDecisionReason).toMatch(/exceeds the maximum scan length/);
    expect(r.decision.permissionDecisionReason).toMatch(/Authorized alternatives/);
    expect(r.decision.permissionDecisionReason).not.toContain('bash-scan-allowlist');
  });

  it('a malformed denial carries no allowlist sentence', () => {
    const r = fire({ tool_name: 'Bash', tool_input: { command: "echo 'unclosed" } });
    expect(r.decision.permissionDecision).toBe('deny');
    expect(r.decision.permissionDecisionReason).toMatch(/Malformed shell syntax/);
    expect(r.decision.permissionDecisionReason).toMatch(/Authorized alternatives/);
    expect(r.decision.permissionDecisionReason).not.toContain('bash-scan-allowlist');
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
  it('CC_HOOK_ALLOW=1 still denies a well-formed node_modules read', () => {
    const r = fire(readPayload('node_modules/pkg/index.js'), { CC_HOOK_ALLOW: '1' });
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
      readPayload('node_modules/pkg/index.js'),
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

describe('CC_GUARD3_WARN', () => {
  it('converts Guard 3 denial into ask, carrying the same reason', () => {
    const denied = fire({ tool_name: 'Bash', tool_input: { command: 'cat *.ts' } });
    expect(denied.decision.permissionDecision).toBe('deny');
    const warned = fire({ tool_name: 'Bash', tool_input: { command: 'cat *.ts' } }, { CC_GUARD3_WARN: '1' });
    expect(warned.status).toBe(0);
    expect(warned.decision.permissionDecision).toBe('ask');
    expect(warned.decision.permissionDecisionReason).toBe(denied.decision.permissionDecisionReason);
  });

  // The scope pin. The project now carries two override variables, so their
  // interaction is a contract rather than folklore. These four assertions are what
  // stop a refactor from widening a per-guard triage aid into a product-wide off
  // switch. They pass before the feature exists, because they assert absences; their
  // value is as a regression guard from here on.
  it('changes nothing except Guard 3', () => {
    const env = { CC_GUARD3_WARN: '1' };
    const blockedRead = fire(readPayload('node_modules/pkg/index.js'), env);
    expect(blockedRead.decision.permissionDecision).toBe('deny');

    const p = writeLines('existing.txt', 4);
    const write = fire({ tool_name: 'Write', tool_input: { file_path: p, content: 'x' } }, env);
    expect(write.decision.permissionDecision).toBe('ask');

    const malformed = fire('{not json', env);
    expect(malformed.decision.permissionDecision).toBe('deny');

    const overridden = fire('{not json', { ...env, CC_HOOK_ALLOW: '1' });
    expect(overridden.decision).toBeNull();
  });
});
