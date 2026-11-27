import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const SYMLINK = 'symlink';
export const NOT_REGULAR = 'not a regular file';

const unreadable = (e) => `unreadable (${e.code ?? e.message})`;

function digestFile(path, readFile) {
  try { return createHash('sha256').update(readFile(path)).digest('hex'); } catch (e) { return unreadable(e); }
}

// lstat, never stat: a symlink or junction is recorded and not followed, so a link planted
// in the tree cannot make the walk read (or the caller delete) anything outside it.
function walk(dir, prefix, out, readFile) {
  let names;
  try { names = readdirSync(dir); } catch (e) {
    if (prefix === '') throw e;
    out[prefix.slice(0, -1)] = unreadable(e);
    return;
  }
  for (const name of names) {
    const path = join(dir, name);
    const key = `${prefix}${name}`;
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) out[key] = SYMLINK;
    else if (stat.isDirectory()) walk(path, `${key}/`, out, readFile);
    else if (stat.isFile()) out[key] = digestFile(path, readFile);
    else out[key] = NOT_REGULAR;
  }
}

// Plain string order, not locale order, so the same tree gives the same record anywhere.
export function digestTree(root, { readFile = readFileSync } = {}) {
  const found = {};
  walk(root, '', found, readFile);
  const sorted = {};
  for (const key of Object.keys(found).sort()) sorted[key] = found[key];
  return sorted;
}
