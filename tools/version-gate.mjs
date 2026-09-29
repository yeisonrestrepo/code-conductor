#!/usr/bin/env node
// VERSION is the authority. The other four locations are checked against it, and
// agreement is reported as agreement.
//
// REPO-ONLY. See the note in tools/id-ceiling.mjs; tools-not-shipped.test.js pins it.
//
// The retired form took `process.argv[2] ?? '1.31.2'`, a literal frozen two releases
// back, and so reported FAIL on five locations that agreed. There is deliberately no
// target parameter here and therefore nothing to default.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LOCATIONS = [
  'VERSION',
  'package.json version',
  'package-lock.json version',
  'package-lock.json packages[""].version',
  'CHANGELOG.md first heading',
];

const SEMVER = /^\d+\.\d+\.\d+$/;

// Review Focus 3: an `## [Unreleased]` heading does not match, and the reader must
// not silently fall through to the next heading, which would compare VERSION against
// the PREVIOUS release and report an agreement that does not exist. The first `## `
// line is the current version or the gate has nothing to compare.
export function firstChangelogVersion(text) {
  for (const line of String(text).replace(/\r\n/g, '\n').split('\n')) {
    if (!line.startsWith('## ')) continue;
    const m = line.match(/^## \[?(\d+\.\d+\.\d+)\]?/);
    return m ? m[1] : null;
  }
  return null;
}

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const readText = (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } };

export function readLocations(root) {
  const pkg = readJson(join(root, 'package.json'));
  const lock = readJson(join(root, 'package-lock.json'));
  const changelog = readText(join(root, 'CHANGELOG.md'));
  const version = readText(join(root, 'VERSION'));
  return {
    'VERSION': version === null ? null : version.trim(),
    'package.json version': pkg?.version ?? null,
    'package-lock.json version': lock?.version ?? null,
    'package-lock.json packages[""].version': lock?.packages?.['']?.version ?? null,
    'CHANGELOG.md first heading': changelog === null ? null : firstChangelogVersion(changelog),
  };
}

export function compare(found) {
  const authority = found['VERSION'];
  if (typeof authority !== 'string' || !SEMVER.test(authority)) {
    return {
      ok: false,
      authorityFailed: true,
      reason: `VERSION is unreadable or malformed: ${JSON.stringify(authority)}. ` +
        'The authority failed, so the other four locations are not at fault and are not reported.',
      rows: [],
      disagreements: [],
    };
  }
  const rows = LOCATIONS.map((name) => ({ name, value: found[name], ok: found[name] === authority }));
  const disagreements = rows.filter((r) => !r.ok).map((r) => r.name);
  return { ok: disagreements.length === 0, want: authority, rows, disagreements };
}

function main() {
  const r = compare(readLocations(process.cwd()));
  if (r.authorityFailed) {
    console.error(`VERSION_GATE_ABORT: ${r.reason}`);
    process.exit(2);
  }
  for (const row of r.rows) {
    console.log(`${row.ok ? 'ok   ' : 'FAIL '}${row.name.padEnd(38)} = ${JSON.stringify(row.value)}`);
  }
  console.log(r.ok
    ? `VERSION_GATE_OK ${r.want}`
    : `VERSION_GATE_FAILED (${r.disagreements.length} of ${r.rows.length} disagree with VERSION)`);
  process.exit(r.ok ? 0 : 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
