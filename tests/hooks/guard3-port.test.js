import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
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

  // The walk's correctness has no behavioral shadow: g3Scan scans the WHOLE
  // after-text, so a second iteration can never find a glob the first pass missed,
  // and the hook exports nothing to call directly. The contract is therefore
  // asserted where it lives, in the source, the same way tests/installer/
  // templates.test.js pins the character-class trap. [BUG-041].
  it('slices the glob walk from the end of the match, not by its length', () => {
    const src = readFileSync(HOOK, 'utf8');
    expect(src).toContain('rest.slice(m.index + m[0].length)');
    expect(src).not.toContain('rest.slice(m[0].length)');
  });

  // The differential's other half, asserted in the same file so one reader sees both.
  // The count of 2 is load-bearing: P4 and P7 are separate functions in the authority,
  // and a fix applied to one of them is the regression [BUG-041] exists to prevent.
  it('keeps the authority on the same corrected walk', () => {
    const src = readFileSync(join(REPO_ROOT, 'tests/fixtures/guard3-reference.sh'), 'utf8');
    expect(src).not.toContain('${rest:mlen}');
    expect(src.match(/\$\{rest:\$\{#pre\}\+\$\{#BASH_REMATCH\[0\]\}\}/g) ?? []).toHaveLength(2);
  });

  // A walk that fails to advance hangs the hook, and a verdict assertion would never
  // catch it: the harness would time out and report a spawn failure instead. This row
  // is built to maximize iterations, 40 pager matches each followed by a quoted span.
  it('terminates on a command built to maximize walk iterations', () => {
    const command = Array.from({ length: 40 }, (_, i) => `head -1 "file ${i}.txt"`).join('; ');
    const r = runRow({ command });
    expect(r.status).toBe(0);
    expect(r.decision).toBeNull();
  });

  // The next four pin what no verdict can reach. The hook exports nothing and runs
  // main() at load, so the masked copy is unobservable from a test; these assert the
  // contract in the source, the way templates.test.js pins the character-class trap.
  // [BUG-043].
  it('builds the mask from the stripped string, before the newline join', () => {
    const src = readFileSync(HOOK, 'utf8');
    expect(src).toContain('const chomped = g3Chomp(scan.result);');
    expect(src).toContain("const masked = g3Scan('mask', chomped).result.split('\\n').join(';');");
  });

  // AC8 has NO behavioral discriminator: a variant emitting one character per escaped
  // pair agreed with the correct mask on all 124 corpus rows and four constructed cases,
  // because the masked string is consumed alone and never compared offset-wise with the
  // unmasked one. Length preservation is pinned here and nowhere else, and this comment
  // records that honestly. AC9 is different: its discriminator was measured. The corpus
  // row c'a't turns green if quote characters stop surviving, because OBF's
  // [a-zA-Z]'[a-zA-Z]+'[a-zA-Z] needs them.
  it('emits one mask character per input character and keeps the quote characters', () => {
    const src = readFileSync(HOOK, 'utf8');
    expect(src).toContain("result += 'xx'");
    expect(src).toContain('result += ch === "\'" ? ch : \'x\'');
    expect(src).not.toContain("mode === 'mask') result += 'x'; i += 2");
  });

  it('keeps the authority on the same mask contract, in the same order', () => {
    const src = readFileSync(join(REPO_ROOT, 'tests/fixtures/guard3-reference.sh'), 'utf8');
    expect(src).toContain('_G3_MASK=$(_g3_scan "mask" "$_G3_PRE")');
    expect(src).toContain('_G3_MASK="${_G3_MASK//$\'\\n\'/;}"');
    expect(src).toContain('result+="xx"');
    // The ordering pin: the mask is built before the newline substitution, which is the
    // one place that order is visible. A quoted newline must never become an anchor.
    expect(src.indexOf('_G3_MASK=$(_g3_scan "mask"'))
      .toBeLessThan(src.indexOf('_G3_PRE="${_G3_PRE//$\'\\n\'/;}"'));
  });

  // The by-design boundary as a COUNT, not a comment. In the port it is a Set; in the
  // authority it is how many call sites read each variable, which is what makes a drift
  // to a twelfth masked check impossible to miss.
  it('gives exactly two checks the unmasked string in both subjects', () => {
    const port = readFileSync(HOOK, 'utf8');
    expect(port).toContain("const UNMASKED_CHECKS = new Set(['P6', 'P12']);");
    expect(port).toContain('g3AllowlistCovers(pre,');
    const ref = readFileSync(join(REPO_ROOT, 'tests/fixtures/guard3-reference.sh'), 'utf8');
    const sites = ref.split('\n').filter(l => /^\s*_g3_(p[0-9]+|obfuscation)[a-z_0-9]*\s+"\$_G3_(PRE|MASK)"/.test(l));
    expect(sites).toHaveLength(13);
    expect(sites.filter(l => l.includes('_G3_PRE'))).toHaveLength(2);
    expect(sites.filter(l => l.includes('_G3_MASK'))).toHaveLength(11);
    expect(ref).toContain('_g3_check_allowlist "$_G3_PRE"');
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
