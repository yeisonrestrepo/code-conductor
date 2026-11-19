import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const raw = readFileSync(join(root, '.github', 'workflows', 'publish.yml'), 'utf8').replace(/\r\n/g, '\n');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));

// Comment lines are prose and may name what a job must NOT do; every assertion reads
// the YAML without them. [BUG-073]
const wf = raw.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
const jobsAt = wf.search(/^jobs:\s*$/m);
const header = wf.slice(0, jobsAt);
const jobsText = wf.slice(jobsAt);

// Job keys are the two-space-indented keys under `jobs:`. A job's block runs to the next
// such key or the end of the file. No YAML dependency: the shape is fixed and small.
const JOB_KEY = /^ {2}([A-Za-z0-9_-]+):\s*$/gm;
const jobNames = [...jobsText.matchAll(JOB_KEY)].map((m) => m[1]);
function job(name) {
  const keys = [...jobsText.matchAll(JOB_KEY)];
  const i = keys.findIndex((m) => m[1] === name);
  if (i < 0) return '';
  const end = i + 1 < keys.length ? keys[i + 1].index : jobsText.length;
  return jobsText.slice(keys[i].index, end);
}
const runs = (block) => [...block.matchAll(/^\s*-?\s*run:\s*(.*)$/gm)].map((m) => m[1].trim());
const uses = (block) => [...block.matchAll(/uses:\s*([^@\s]+)@/g)].map((m) => m[1]);
// The job-level `permissions:` map: its indented lines, until the next job-level key.
function permissions(block) {
  const m = block.match(/^ {4}permissions:[ \t]*(\{\})?[ \t]*\n((?: {6}\S.*\n)*)/m);
  if (!m) return null;
  if (m[1]) return {};
  return Object.fromEntries(m[2].trim().split('\n').filter(Boolean).map((l) => l.trim().split(/:\s*/)));
}
// One step of a job: from its `- uses: <action>@` line to the next step, or '' if absent. [BUG-083]
function step(block, action) {
  const lines = block.split('\n');
  const i = lines.findIndex((l) => l.startsWith(`      - uses: ${action}@`));
  if (i < 0) return '';
  const j = lines.findIndex((l, k) => k > i && l.startsWith('      - '));
  return lines.slice(i, j < 0 ? lines.length : j).join('\n');
}

const verify = job('verify');
const publish = job('publish');

describe('publish workflow', () => {
  it('triggers on published releases', () => { expect(header).toMatch(/release:\s*\n\s*types:\s*\[\s*published\s*\]/); });
  it('denies every permission at the workflow level [BUG-073]', () => {
    expect(header).toMatch(/^permissions:[ \t]*\{\}[ \t]*$/m);
  });
  it('has exactly the verify and publish jobs, in that order [BUG-073]', () => {
    expect(jobNames).toEqual(['verify', 'publish']);
  });
  it('pins ubuntu-latest on both jobs', () => {
    expect(verify).toMatch(/^ {4}runs-on:\s*ubuntu-latest\s*$/m);
    expect(publish).toMatch(/^ {4}runs-on:\s*ubuntu-latest\s*$/m);
  });
  it('authenticates via OIDC trusted publishing, not a stored token', () => {
    expect(wf).not.toMatch(/NODE_AUTH_TOKEN/);
    expect(wf).not.toMatch(/secrets\./);
  });
  it('carries no dependency-audit step, so a dev advisory never blocks a publish [BUG-073]', () => {
    expect(wf).not.toMatch(/npm audit/);
  });
  it('checks out the release commit in both jobs (no ref override) [BUG-073]', () => {
    expect(wf).not.toMatch(/^\s*ref:/m);
  });
});

describe('publish workflow: verify job [BUG-073]', () => {
  it('holds contents:read only, no id-token and no environment', () => {
    expect(permissions(verify)).toEqual({ contents: 'read' });
    expect(verify).not.toMatch(/id-token/);
    expect(verify).not.toMatch(/environment:/);
  });
  it('installs the locked dev dependencies and runs the suite', () => {
    expect(runs(verify)).toContain('npm ci');
    expect(runs(verify)).toContain('npx vitest run');
  });
  it('guards version==tag and blocks a duplicate publish', () => {
    expect(verify).toMatch(/name: Verify package version matches the release tag/);
    expect(verify).toMatch(/release\.tag_name/);
    expect(verify).toMatch(/name: Guard against re-publishing an existing version/);
    expect(verify).toMatch(/npm view "@yeison\.restrepo\.r\/code-conductor@/);
  });
  it('never publishes', () => { expect(verify).not.toMatch(/npm publish/); });
});

describe('publish workflow: publish job [BUG-073]', () => {
  it('runs only after verify, in the protected environment', () => {
    expect(publish).toMatch(/^ {4}needs:\s*verify\s*$/m);
    expect(publish).toMatch(/^ {4}environment:\s*npm-publish\s*$/m);
  });
  it('holds id-token:write and contents:read, nothing else', () => {
    expect(permissions(publish)).toEqual({ 'id-token': 'write', 'contents': 'read' });
  });
  it('uses only checkout and setup-node', () => {
    expect(uses(publish)).toEqual(['actions/checkout', 'actions/setup-node']);
  });
  it('does not persist the checkout credential', () => {
    expect(publish).toMatch(/persist-credentials:\s*false/);
  });
  it('targets the npm registry and disables the package-manager cache explicitly [BUG-083]', () => {
    const node = step(publish, 'actions/setup-node');
    expect(node).toMatch(/registry-url:\s*'https:\/\/registry\.npmjs\.org'/);
    expect((publish.match(/package-manager-cache:/g) ?? []).length).toBe(1);
    expect(node).toMatch(/^ {8}with:\n(?: {10}\S.*\n)* {10}package-manager-cache: false$/m);
    expect(publish).not.toMatch(/^[ -]*cache:/m);
    expect(publish).not.toMatch(/^[ -]*cache-dependency-path:/m);
  });
  it('runs exactly the npm self-upgrade and the publish, both without lifecycle scripts', () => {
    expect(runs(publish)).toEqual([
      'npm install -g npm@^11.5.1 --ignore-scripts',
      'npm publish --provenance --access public --ignore-scripts',
    ]);
  });
  it('installs and runs no project dependency', () => {
    for (const bad of [/npm ci/, /npm test/, /npm run/, /npx /, /vitest/, /npm install(?! -g npm@)/]) {
      expect(publish).not.toMatch(bad);
    }
  });
});

// The dev toolchain the verify job installs. 4.1.12 is the first vitest without the
// advisories BUG-073 names (tinypool is gone, @vitest/mocker is past 4.1.11); 5.x drops
// the Node 20 floor (engines ^22.12.0), so the line stays below 5.0.0. [BUG-073]
const MIN = [4, 1, 12];
const NEXT_MAJOR = 5;
function inSupportedLine(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version ?? '');
  if (!m) return false;
  const v = m.slice(1).map(Number);
  if (v[0] >= NEXT_MAJOR) return false;
  for (let i = 0; i < 3; i++) {
    if (v[i] !== MIN[i]) return v[i] > MIN[i];
  }
  return true;
}
const locked = (name) => lock.packages?.[`node_modules/${name}`]?.version;

describe('publish verify toolchain [BUG-073]', () => {
  it.each([
    ['4.1.11', false], ['4.1.12', true], ['4.1.13', true], ['4.2.0', true], ['4.99.99', true],
    ['5.0.0', false], ['5.1.0', false], ['3.2.6', false], ['4.1.12-beta.1', false], [undefined, false],
  ])('inSupportedLine(%s) is %s', (v, ok) => { expect(inSupportedLine(v)).toBe(ok); });

  it('gives vitest and @vitest/coverage-v8 the same range', () => {
    expect(pkg.devDependencies['@vitest/coverage-v8']).toBe(pkg.devDependencies.vitest);
  });
  it('locks vitest, @vitest/coverage-v8 and @vitest/mocker to one version in the supported line', () => {
    const v = locked('vitest');
    expect(inSupportedLine(v)).toBe(true);
    expect(locked('@vitest/coverage-v8')).toBe(v);
    expect(locked('@vitest/mocker')).toBe(v);
  });
  it('has no runtime dependencies and no pack or publish lifecycle script', () => {
    expect(pkg.dependencies ?? {}).toEqual({});
    for (const s of ['prepare', 'prepack', 'postpack', 'prepublish', 'prepublishOnly', 'publish', 'postpublish']) {
      expect(pkg.scripts?.[s]).toBeUndefined();
    }
  });
});
