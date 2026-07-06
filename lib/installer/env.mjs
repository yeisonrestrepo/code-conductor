import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// This module lives at <root>/lib/installer/env.mjs, so the package root
// (where global/ skills/ project-template/ sit) is two levels up. Deriving it
// from import.meta.url makes it correct from both the npx cache and the -g prefix.
export function resolveAssetRoot() {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..');
}

// Platform-independent absolute-path test so a Windows path (drive or UNC) is
// recognized as absolute even when the code runs on a POSIX test host, and vice
// versa. Covers: POSIX root `/…`, Windows drive `C:\…` / `C:/…`, UNC `\\…` / `//…`.
export function isAbsolutePath(p) {
  return /^([/\\]|[A-Za-z]:[/\\])/.test(p);
}

export function resolveHome(env = process.env) {
  const home = env.HOME || env.USERPROFILE;
  if (!home || !home.trim()) return null;
  // Reject a relative HOME/USERPROFILE: joining assets onto it would write into an
  // unpredictable location (e.g. under CWD). Treat as unresolvable → exit 1 upstream.
  if (!isAbsolutePath(home.trim())) return null;
  return home;
}

// Runtime floor enforcement (engines.node only warns at install; npx/-g can run on
// any Node). Returns true when the major version satisfies >=20, false otherwise, so
// the entry can abort with a clear message instead of failing obscurely later.
// Accepts a version string like "18.19.1" (defaults to the running process).
export function nodeMajorAtLeast(min, version = process.versions.node) {
  const major = parseInt(String(version).split('.')[0], 10);
  return Number.isFinite(major) && major >= min;
}
