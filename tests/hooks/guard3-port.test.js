import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CORPUS, DIALECT, EXCEPTIONS } from '../fixtures/guard3-corpus.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HOOK = join(REPO_ROOT, '.claude/hooks/pre-tool-use.mjs');

// Every row spawns with a throwaway cwd, so the allowlist a row asks for is the only
// one the guard can see and the developer's own .claude/memory/ is unreachable.
function runRow(row) {
  const dir = mkdtempSync(join(tmpdir(), 'cc-g3-port-'));
  try {
    if (row.allowlist && row.allowlist.length) {
      mkdirSync(join(dir, '.claude', 'memory'), { recursive: true });
      writeFileSync(join(dir, '.claude', 'memory', 'bash-scan-allowlist.txt'), row.allowlist.join('\n') + '\n', 'utf8');
    }
    const toolName = row.toolName ?? 'Bash';
    const tool_input = toolName === 'Read' ? { file_path: '/tmp/x' } : { command: row.command };
    const r = spawnSync(process.execPath, [HOOK], {
      stdio: 'pipe',
      cwd: dir,
      timeout: 15000,
      input: JSON.stringify({ tool_name: toolName, tool_input }),
      env: { ...process.env },
    });
    if (r.error) throw new Error(`hook spawn failed: ${r.error.message}`);
    const stdout = (r.stdout ?? Buffer.alloc(0)).toString();
    return {
      status: r.status ?? -1,
      decision: stdout.trim() === '' ? null : JSON.parse(stdout).hookSpecificOutput,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const assertVerdict = (row, verdict) => {
  const r = runRow(row);
  expect(r.status).toBe(0);
  if (verdict === 'deny') {
    expect(r.decision.permissionDecision).toBe('deny');
    expect(r.decision.permissionDecisionReason).toMatch(/BASH SCAN BLOCKED/);
  } else {
    expect(r.decision).toBeNull();
  }
};

describe('Guard 3 port', () => {
  it.each(CORPUS.map(r => [r.label, r]))('corpus: %s', (_label, row) => {
    assertVerdict(row, row.verdict);
  });

  it.each(DIALECT.map(r => [r.label, r]))('dialect: %s', (_label, row) => {
    assertVerdict(row, row.verdict);
  });

  // Guarding the guard: a second entry here would mean a second place where the port
  // silently disagrees with its own authority, which the spec forbids.
  it('carries exactly one sanctioned divergence from the authority', () => {
    expect(EXCEPTIONS).toHaveLength(1);
  });

  it.each(EXCEPTIONS.map(r => [r.label, r]))('exception: %s', (_label, row) => {
    assertVerdict(row, row.portVerdict);
  });
});
