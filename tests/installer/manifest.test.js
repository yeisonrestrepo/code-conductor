import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

describe('package.json manifest', () => {
  it('names the package code-conductor and is not private', () => {
    expect(pkg.name).toBe('@yeison.restrepo.r/code-conductor');
    expect(pkg.private).toBeUndefined();
  });
  it('maps the bin command to the mjs entry', () => {
    expect(pkg.bin).toEqual({ 'code-conductor': 'bin/code-conductor.mjs' });
  });
  it('allowlists only shipped assets + entry', () => {
    expect(pkg.files.sort()).toEqual(
      ['bin/', 'global/', 'lib/', 'project-template/', 'skills/'].sort()
    );
    expect(pkg.files).not.toContain('tests/');
    expect(pkg.files).not.toContain('docs/');
  });
  it('keeps ESM + node floor and publishes public', () => {
    expect(pkg.type).toBe('module');
    expect(pkg.engines.node).toBe('>=20');
    expect(pkg.publishConfig).toEqual({ access: 'public' });
  });
});
