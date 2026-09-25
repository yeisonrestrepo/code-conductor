import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FIELDS, FIELD_KEYS, fieldByKey, canonicalLine, unresolvedReason, isResolved,
} from '../../scripts/claude-md-fields.mjs';
import { buildReport } from '../../scripts/init-wizard.mjs';

const SCRIPT = fileURLToPath(new URL('../../scripts/init-wizard.mjs', import.meta.url));

// Every child runs in its own temp cwd: `apply` writes, and no test may touch the
// live project's CLAUDE.md.
const sandboxes = [];
function sandbox(claudeMd) {
  const d = mkdtempSync(join(tmpdir(), 'cc-wiz-'));
  sandboxes.push(d);
  if (claudeMd !== undefined) writeFileSync(join(d, 'CLAUDE.md'), claudeMd);
  return d;
}
afterEach(() => { while (sandboxes.length) { try { rmSync(sandboxes.pop(), { recursive: true }); } catch {} } });

function run(args, { cwd, input } = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd, input: input ?? '', encoding: 'utf8' });
}

// One literal line per field. Keyed on FIELD_KEYS by the drift test below, so adding a
// field to claude-md-fields.mjs without adding a line here fails the suite.
const LINES = {
  name:        '- Name: code-conductor',
  description: '- Description: a spec-first config',
  stack:       '- Stack: markdown/shell',
  build:       '- Build: <command>',
  test:        '- Test: N/A',
  lint:        '- Lint:',
  format:      '- Format: <COMMAND>',
  setup:       '- Setup: bash install.sh',
};

const fixture = (omit = []) =>
  ['# Project Claude Configuration', '', '## Project Identity']
    .concat(FIELD_KEYS.filter(k => !omit.includes(k)).map(k => LINES[k]))
    .concat(['', '<!-- cc:managed:start -->', 'managed', '<!-- cc:managed:end -->', ''])
    .join('\n');

describe('claude-md-fields', () => {
  it('pins the eight CLAUDE.md fields in file order', () => {
    expect(FIELD_KEYS).toEqual([
      'name', 'description', 'stack', 'build', 'test', 'lint', 'format', 'setup',
    ]);
    expect(FIELDS).toHaveLength(FIELD_KEYS.length);
  });

  it('maps each field to its CLAUDE.md line label', () => {
    expect(canonicalLine(fieldByKey('build'))).toBe('- Build:');
    expect(canonicalLine(fieldByKey('description'))).toBe('- Description:');
    expect(fieldByKey('nope')).toBeUndefined();
  });

  // The spec's truth table, verbatim.
  it.each([
    ['npm run build', null],
    ['N/A',           null],
    ['<COMMAND>',     null],
    ['<Command>',     null],
    ['',              'empty'],
    ['   ',           'empty'],
    ['<command>',     'placeholder'],
    ['  <command>  ', 'placeholder'],
  ])('unresolvedReason(%j) === %j', (value, reason) => {
    expect(unresolvedReason(value)).toBe(reason);
    expect(isResolved(value)).toBe(reason === null);
  });

  it('treats a missing value as empty rather than throwing', () => {
    expect(unresolvedReason(undefined)).toBe('empty');
    expect(unresolvedReason(null)).toBe('empty');
  });
});

describe('the fixture tracks the field list', () => {
  it('has one line per canonical field', () => {
    expect(Object.keys(LINES).sort()).toEqual([...FIELD_KEYS].sort());
  });
});

describe('report', () => {
  it('sorts every field into exactly one bucket', () => {
    const r = buildReport(fixture());
    expect(r.unresolved).toEqual([
      { field: 'build', raw: '- Build: <command>', reason: 'placeholder' },
      { field: 'lint',  raw: '- Lint:',            reason: 'empty' },
    ]);
    expect(r.resolved).toEqual(['name', 'description', 'stack', 'test', 'format', 'setup']);
    expect(r.absent).toEqual([]);
  });

  it('reports a deleted line as absent, carrying the line to restore', () => {
    const r = buildReport(fixture(['setup']));
    expect(r.absent).toEqual([{ field: 'setup', expected: '- Setup:' }]);
    expect(r.resolved).not.toContain('setup');
  });

  it('matches the first occurrence only', () => {
    const r = buildReport('- Build: <command>\n- Build: npm run build\n');
    expect(r.unresolved.map(u => u.field)).toEqual(['build']);
  });

  it('keeps a CRLF line terminator out of raw', () => {
    const r = buildReport('- Build: <command>\r\n');
    expect(r.unresolved[0].raw).toBe('- Build: <command>');
  });

  it('prints only JSON on stdout and exits 0', () => {
    const res = run(['report'], { cwd: sandbox(fixture()) });
    expect(res.status).toBe(0);
    expect(() => JSON.parse(res.stdout)).not.toThrow();
    expect(JSON.parse(res.stdout).unresolved.map(u => u.field)).toEqual(['build', 'lint']);
    expect(res.stderr).toContain('build, lint');   // advisory, never parsed
  });

  it('exits non-zero when CLAUDE.md is absent', () => {
    const res = run(['report'], { cwd: sandbox() });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain('CLAUDE.md');
  });

  it('exits non-zero on an unknown subcommand', () => {
    const res = run(['wat'], { cwd: sandbox(fixture()) });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain('usage');
  });
});

describe('mode blindness', () => {
  it('the script never probes interactivity', () => {
    const src = readFileSync(SCRIPT, 'utf8');
    expect(src).not.toMatch(/isTTY/);
    expect(src).not.toMatch(/\bprocess\.env\.CI\b/);
    expect(src).not.toMatch(/\benv\.CI\b/);
  });
});
