import { spawnSync } from 'node:child_process';

// Shared across test suites: probe whether this Node can open node:sqlite and
// which launch flags it needs. Centralized here so no suite duplicates the probe.
export function dbFlags() {
  const opts = { encoding: 'utf8', timeout: 2000, env: process.env };
  if (spawnSync(process.execPath, ['--no-warnings', '-e', "require('node:sqlite')"], opts).status === 0) return [];
  if (spawnSync(process.execPath, ['--experimental-sqlite', '--no-warnings', '-e', "require('node:sqlite')"], opts).status === 0) {
    return ['--experimental-sqlite', '--no-warnings'];
  }
  return null;
}

export function sqliteAvailable() { return dbFlags() !== null; }
