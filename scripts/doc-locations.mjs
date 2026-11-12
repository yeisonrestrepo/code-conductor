#!/usr/bin/env node
// scripts/doc-locations.mjs
// Spec and plan location resolver (FEAT-047). Resolves the folder pair a run writes its
// spec and plan into: recorded in CLAUDE.md, else discovered, else docs/specs + docs/plans,
// and the backlog group the item's documents sit under. Zero dependencies, node: builtins only.
// orchestrate.mjs imports this module, so it has no top-level side effects, installs no
// process handler, writes nothing, and sets an exit code only from its CLI entry.
import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
// Imported, not hardcoded: the spec derives DIR_MAX from this cap, and snap-contract.mjs is
// itself zero-dependency, so the import costs nothing and a cap change cannot drift.
import { V3_CAPS } from './snap-contract.mjs';

export const CANDIDATE_PAIRS = [
  { specs: '.claude/specs', plans: '.claude/plans' },
  { specs: 'docs/specs', plans: 'docs/plans' },
  { specs: 'docs/superpowers/specs', plans: 'docs/superpowers/plans' },
];
export const DEFAULT_PAIR = { specs: 'docs/specs', plans: 'docs/plans' };
export const GROUP_MAX = 47;
// A scope element is `<dir>/<group>/**`, so the folder leaves room for the longest group.
export const DIR_MAX = V3_CAPS['ops.scope'][1] - (GROUP_MAX + '/'.length + '/**'.length);

const CODE = 'ORCH_DOC_LOCATION_INVALID';
// A recorded folder becomes the spec and plan agents' Guard 5 write scope, so it may not cover
// the orchestrator write surface, git internals, or any folder that holds enforcement code
// (`.opencode` holds the OpenCode guard). Inside `.claude`, only specs and plans may hold
// documents: everything else there is agent instructions or configuration (skills, settings,
// rules), so the rule below it is an allowlist, not this deny list.
const RESERVED = ['.claude/memory', '.claude/hooks', '.claude/agents', '.claude/commands', '.claude/scripts', '.conductor', '.git', '.github', '.opencode', 'scripts'];
const CLAUDE_DOCS = ['.claude/specs', '.claude/plans'];
const GROUP_RE = /^(#{1,5})\s+(phase|epic|pillar)\b[\s:#-]*(\d+)?[\s:.-]*(.*)$/i;
const HEADING_RE = /^(#{1,6})\s/;

export class DocLocationError extends Error {
  constructor(reason) {
    super(`${CODE}: ${reason}`);
    this.name = 'DocLocationError';
    this.code = CODE;
    this.reason = reason;
  }
}

const stripSlash = (value) => value.replace(/\/+$/, '');
const underRoot = (value, base) => value === base || value.startsWith(`${base}/`);
const overlaps = (a, b) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);

// Case-folded because Windows and macOS file systems treat `.Claude/Hooks` as `.claude/hooks`.
function reservedReason(value) {
  const folded = value.toLowerCase();
  const base = RESERVED.find((entry) => overlaps(folded, entry));
  if (base) {
    if (underRoot(folded, base)) return `sits in the reserved \`${base}\``;
    return `covers the reserved \`${base}\``;
  }
  if (underRoot(folded, '.claude') && !CLAUDE_DOCS.some((ok) => underRoot(folded, ok))) {
    return 'sits in `.claude`, where only `.claude/specs` and `.claude/plans` may hold documents';
  }
  return '';
}

export function checkDocDir(rel) {
  const value = stripSlash(String(rel ?? ''));
  if (value === '' || value === '<command>') return 'is empty or the template placeholder';
  if (isAbsolute(value) || /^[A-Za-z]:/.test(value) || value.startsWith('/')) return 'is absolute; use a path relative to the repository root';
  if (value.split('/').includes('..')) return 'climbs out with a `..` segment';
  if (value.includes('\\')) return 'uses `\\`; separate segments with `/`';
  if (/[*?[\]{}]/.test(value)) return 'carries a glob character';
  if (value === '.') return 'is the repository root, which covers every reserved folder';
  if (value.split('/').some((seg) => seg === '' || seg === '.')) return 'carries an empty or `.` segment; write the plain path from the repository root';
  const reserved = reservedReason(value);
  if (reserved) return reserved;
  if (value.length > DIR_MAX) return `is ${value.length} characters; the cap is ${DIR_MAX}`;
  return '';
}

function readText(path) {
  try { return readFileSync(path, 'utf8').replace(/\r\n/g, '\n'); } catch { return null; }
}

export function readRecordedPair(root) {
  const text = readText(join(root, 'CLAUDE.md'));
  if (text === null) return null;
  const specs = text.match(/^- Specs: (\S+)$/m)?.[1];
  const plans = text.match(/^- Plans: (\S+)$/m)?.[1];
  if (!specs && !plans) return null;
  if (!specs || !plans) throw new DocLocationError('CLAUDE.md records `- Specs:` but not `- Plans:` (or the reverse); add the missing line, or remove both');
  for (const [label, value] of [['Specs', specs], ['Plans', plans]]) {
    const why = checkDocDir(value);
    if (why) throw new DocLocationError(`\`- ${label}: ${value}\` ${why}; fix that line`);
  }
  const pair = { specs: stripSlash(specs), plans: stripSlash(plans) };
  if (overlaps(pair.specs, pair.plans)) throw new DocLocationError('`- Specs:` and `- Plans:` overlap; use two disjoint folders');
  return pair;
}

function isDir(path) {
  try { return statSync(path).isDirectory(); } catch { return false; }
}

// Hand-written, not readdirSync({ recursive: true }): engines is >=20 and that option arrived
// in 20.1. Dirent.isDirectory() is false for a symlink, so symlinked folders are not followed.
function countMarkdown(dir) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  let count = 0;
  for (const entry of entries) {
    if (entry.isDirectory()) count += countMarkdown(join(dir, entry.name));
    else if (entry.isFile() && entry.name.endsWith('.md')) count += 1;
  }
  return count;
}

export function discoverPair(root) {
  let best = null;
  let bestCount = -1;
  for (const pair of CANDIDATE_PAIRS) {
    if (!isDir(join(root, pair.specs)) && !isDir(join(root, pair.plans))) continue;
    const count = countMarkdown(join(root, pair.specs)) + countMarkdown(join(root, pair.plans));
    // Strict: on a tie the earlier pair keeps the win.
    if (count > bestCount) { best = pair; bestCount = count; }
  }
  return best ? { ...best } : null;
}

function groupName(kind, n, rest) {
  const prefix = kind.toLowerCase();
  if (n) return checkGroupLength(`${prefix}-${n}`);
  const slug = rest.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
  if (!slug) return null;
  return checkGroupLength(`${prefix}-${slug}`);
}
const checkGroupLength = (name) => (name.length > GROUP_MAX ? null : name);

function backlogFiles(root) {
  try { return readdirSync(root).filter((name) => /backlog/i.test(name) && name.endsWith('.md')).sort(); } catch { return []; }
}

function hitsInText(text, itemRe) {
  const hits = [];
  let open = null;
  for (const line of text.split('\n')) {
    const heading = line.match(HEADING_RE);
    if (!heading) continue;
    const group = line.match(GROUP_RE);
    if (group) { open = { level: group[1].length, name: groupName(group[2], group[3], group[4]) }; continue; }
    // Close before the item check, so an item heading at the group's own level is flat.
    if (open && heading[1].length <= open.level) open = null;
    if (itemRe.test(line)) hits.push(open?.name ?? null);
  }
  return hits;
}

export function backlogGroup(root, item) {
  const escaped = String(item).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const itemRe = new RegExp(`(?<![A-Za-z0-9_-])${escaped}(?![A-Za-z0-9_-])`);
  const hits = [];
  for (const name of backlogFiles(root)) {
    const text = readText(join(root, name));
    if (text !== null) hits.push(...hitsInText(text, itemRe));
  }
  // Ruling 5: group only when the item is placed exactly once.
  return hits.length === 1 ? hits[0] : null;
}

export function resolveDocLocations(root, item) {
  const group = item ? backlogGroup(root, item) : null;
  const recorded = readRecordedPair(root);
  if (recorded) return { ...recorded, group, source: 'claude-md' };
  const discovered = discoverPair(root);
  if (discovered) return { ...discovered, group, source: 'discovered' };
  return { ...DEFAULT_PAIR, group, source: 'default' };
}

export function cli(argv) {
  try {
    const root = resolve(argv[0] ?? process.cwd());
    if (!isDir(root)) throw new Error(`${root} is not a directory`);
    const { specs, plans, source } = resolveDocLocations(root, null);
    process.stdout.write(`${JSON.stringify({ specs, plans, source })}\n`);
    return 0;
  } catch (e) {
    const line = e instanceof DocLocationError ? e.message : `doc-locations: ${e.message}`;
    process.stderr.write(`${line.replace(/\s*\n\s*/g, ' ')}\n`);
    return 1;
  }
}

function invokedDirectly() {
  try { return Boolean(process.argv[1]) && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url; } catch { return false; }
}
if (invokedDirectly()) process.exitCode = cli(process.argv.slice(2));
