// [BUG-057] project.md is append-only and grows without bound, so a phase entry must
// read only the bounded `## Current State` digest at its top and Grep history for detail.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { LEGACY_PROJECT_MEMORY_STUB_SHA256 } from '../../lib/installer/deploy.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8').replace(/\r\n/g, '\n');

// Same inverse of the template's script-path nesting as commands-parity.test.js.
const unnest = (text) =>
  text
    .split('node .claude/scripts/').join('node scripts/')
    .split('-flags> .claude/scripts/').join('-flags> scripts/')
    .split('running `.claude/scripts/').join('running `scripts/');

const mirrors = (name) => [`.claude/commands/${name}`, `project-template/.claude/commands/${name}`];
const READERS = ['cc-implement.md', 'cc-plan.md', 'cc-resume.md'].flatMap(mirrors);
const SPEC_MIRRORS = mirrors('cc-spec.md');
const CHECKPOINT = 'global/commands/cc-checkpoint.md';
const TERMINATOR = '<!-- end current state -->';
const READ_OF_MEMORY = /\bRead\b[^\n]*`\.claude\/memory\/project\.md`/;

function skeleton() {
  const block = read(CHECKPOINT).match(/```markdown\n(## Current State\n[\s\S]*?)```/);
  expect(block).not.toBeNull();
  return block[1].trimEnd().split('\n');
}

function fillToCaps(lines) {
  const bullet = `- ${'x'.repeat(198)}`;
  return lines.flatMap((l) => (/^### (Conventions|Debt)$/.test(l) ? [l, ...Array(12).fill(bullet)] : [l]));
}

describe('bounded project memory [BUG-057]', () => {
  it('AC1: every phase-entry Read of project.md is bounded and stops at the terminator', () => {
    for (const rel of READERS) {
      const reads = read(rel).split('\n').filter((l) => READ_OF_MEMORY.test(l));
      expect(reads.length, rel).toBeGreaterThan(0);
      for (const line of reads) {
        expect(line, rel).toContain('`limit: 60`');
        expect(line, rel).toContain(TERMINATOR);
      }
    }
  });

  it('AC2: every reader names the bounded fallback for a file with no Current State', () => {
    for (const rel of READERS) {
      const text = read(rel);
      expect(text, rel).toContain('`limit: 40`');
      expect(text, rel).toContain('`^## (Spec|Checkpoint)`');
      expect(text, rel).toContain('`offset`');
    }
  });

  it('AC3: cc-resume extracts conventions and debt from the digest, not the unwritten top sections', () => {
    for (const rel of mirrors('cc-resume.md')) {
      const text = read(rel);
      expect(text, rel).toContain('`### Conventions` in `## Current State`');
      expect(text, rel).toContain('`### Debt` in `## Current State`');
      expect(text, rel).not.toContain('## Active Conventions');
      expect(text, rel).not.toContain('## Technical Debt');
    }
  });

  it('AC4a: cc-checkpoint keeps history append-only and carries the skeleton', () => {
    const text = read(CHECKPOINT);
    expect(text).toContain('(append only, never delete)');
    expect(skeleton()).toEqual([
      '## Current State',
      '<!-- Bounded digest, max 40 lines, each line max 200 characters. History below is append-only. -->',
      '- Active spec: none',
      '- Last checkpoint: none',
      '### Conventions',
      '### Debt',
      TERMINATOR,
    ]);
  });

  it('AC4b: cc-checkpoint states the caps, one Edit per change, and the one-time bootstrap insert', () => {
    const text = read(CHECKPOINT);
    for (const phrase of ['40 lines', '12 bullets', '200 characters', 'one Edit per bullet', 'one-time bootstrap insert']) {
      expect(text).toContain(phrase);
    }
  });

  it('AC5: both cc-spec mirrors replace the single Active spec line after the append', () => {
    for (const rel of SPEC_MIRRORS) {
      const text = read(rel);
      const append = text.indexOf('`## Spec: [name] [YYYY-MM-DD]`');
      const replace = text.indexOf('replace the single `- Active spec:` line');
      expect(append, rel).toBeGreaterThan(-1);
      expect(replace, rel).toBeGreaterThan(append);
    }
    expect(unnest(read(SPEC_MIRRORS[1]))).toBe(read(SPEC_MIRRORS[0]));
  });

  it('AC6: the skeleton filled to its caps fits the 60-line read under the stub intro', () => {
    const section = fillToCaps(skeleton());
    const intro = read('project-template/.claude/memory/project.md').split('\n').slice(0, 3);
    expect(section.length).toBeLessThanOrEqual(40);
    expect(intro.length + 1 + section.length).toBeLessThanOrEqual(60);
    expect(section.every((l) => l.length <= 200)).toBe(true);
    // post-compact hooks grep `## Checkpoint` unanchored; a field must never look like one.
    expect(section.some((l) => /^- [^:]+: ## /.test(l))).toBe(false);
  });

  // (#94) The stub 1.28/1.29 shipped now lives only in a fixture; the installer
  // keeps its digest so the overwrite warning still recognizes the bytes they wrote.
  it('AC7: the legacy stub fixture matches the digest the installer recognizes', () => {
    const stub = read('tests/fixtures/legacy-project-memory-stub.md');
    const digest = createHash('sha256').update(stub).digest('hex');
    // sha256 of the stub as committed in b018793, LF-normalized.
    expect(digest).toBe('01e65fdecfd0a842dc1269cb0a5ff59718978830c94d5815b09c3a0454f261f9');
    expect(digest).toBe(LEGACY_PROJECT_MEMORY_STUB_SHA256);
  });

  it('(#94) the template stub is neutral: headings only, no code-conductor history', () => {
    const stub = read('project-template/.claude/memory/project.md');
    expect(stub).not.toMatch(/\b(BUG|FEAT|ARCH)-\d+/);
    expect(stub).not.toContain('### Checkpoint');
    expect(stub).not.toMatch(/project-template\/|global\/commands\//);
    const headings = stub.split('\n').filter((l) => l.startsWith('## '));
    expect(headings).toEqual(['## Stack', '## Architecture Decisions', '## Active Conventions', '## Technical Debt', '## Workarounds']);
  });
});
