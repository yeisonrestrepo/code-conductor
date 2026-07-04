// tests/unit/feat013-no-stack-profiles.test.js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');

// Spec clarification 9 scopes the token grep to four named files; global/CLAUDE.md
// is added here per the plan-review decision so the hyphenated `stack-profiles`
// directory token is guarded automatically rather than by manual grep. Its
// legitimate `## Loaded Profiles` prose uses the space form ("Stack profiles"),
// so the hyphenated check does not produce a false positive.
const NAMED_FILES = [
  'global/commands/cc-stack.md',
  'install.sh',
  'install.ps1',
  'README.md',
  'global/CLAUDE.md',
];

describe('FEAT-013 static-profile retirement', () => {
  for (const f of NAMED_FILES) {
    it(`${f} contains no stack-profiles reference`, () => {
      expect(read(f)).not.toMatch(/stack-profiles/);
    });
  }

  it('cc-stack.md invokes the dynamic detector', () => {
    expect(read('global/commands/cc-stack.md')).toMatch(/detect-stack\.mjs/);
  });

  // Guards clarification 26/31: the ruleset caps must not silently drop out of
  // the command instructions. The synthesized ruleset is runtime agent output
  // (written into a consuming project's CLAUDE.md), so it cannot be measured
  // statically here; instead we assert the four hard bounds remain documented
  // in cc-stack.md so every future run stays bounded.
  it('cc-stack.md documents the ruleset length and character caps', () => {
    const doc = read('global/commands/cc-stack.md');
    expect(doc).toMatch(/8 bullets/);        // <= 8 bullets per stack
    expect(doc).toMatch(/200 words/);        // <= 200 words per stack
    expect(doc).toMatch(/500 words/);        // <= 500 words total
    expect(doc).toMatch(/2500 characters/);  // <= 2500 chars whole block
    expect(doc).toMatch(/120 characters/);   // <= 120 chars per bullet
  });
});
