// .github/wiki/wiki-gen.mjs
// Builds the GitHub Wiki from the page templates in .github/wiki/pages/. A template
// is copied as written, except for `<!-- wiki-gen:NAME -->` marker lines, which are
// replaced by a table read from the source that owns the fact. Zero dependencies.
//
// REPO-ONLY, and deliberately not under tools/: that directory holds release-critical
// instruments, each named in the README and counted by repo-invariants.test.js.
//
// All-or-nothing: every page is rendered before the first is written, so a broken
// source can never leave a half-built wiki for the workflow to push.

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PAGES_DIR = '.github/wiki/pages';
const MARKER = /^<!-- wiki-gen:([a-z-]+) -->$/gm;

// A Windows checkout may hold CRLF; the wiki is published with LF either way.
const readText = (path) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

const cell = (text) => String(text).replace(/\|/g, '\\|');
const table = (head, rows) => [
  `| ${head.join(' | ')} |`,
  `|${head.map(() => '---').join('|')}|`,
  ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`),
].join('\n');

export function readFrontmatter(path) {
  const block = /^---\n([\s\S]*?)\n---(\n|$)/.exec(readText(path));
  if (!block) throw new Error(`${path}: no frontmatter block`);
  const fields = {};
  for (const line of block[1].split('\n')) {
    const pair = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
    if (pair) fields[pair[1]] = pair[2].replace(/^"(.*)"$/, '$1');
  }
  return fields;
}

function requireField(fields, name, path) {
  if (!fields[name]) throw new Error(`${path}: frontmatter has no "${name}"`);
  return fields[name];
}

async function snapCaps(root) {
  const contract = await import(pathToFileURL(resolve(root, 'scripts/snap-contract.mjs')).href);
  const caps = { ...contract.CAPS, ...contract.V3_CAPS };
  const rows = Object.entries(caps).map(([field, [count, chars]]) => [`\`${field}\``, count, chars]);
  return table(['Field', 'Max entries', 'Max chars per entry'], rows);
}

function skillsIndex(root) {
  const dir = join(root, 'skills');
  const names = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  const rows = names.map((name) => {
    const path = join(dir, name, 'SKILL.md');
    return [`\`${name}\``, requireField(readFrontmatter(path), 'description', path)];
  });
  return table(['Skill', 'Description'], rows);
}

function agentTools(root) {
  const dir = join(root, '.claude/agents');
  const files = readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
  const rows = files.map((file) => {
    const path = join(dir, file);
    return [`\`${file}\``, requireField(readFrontmatter(path), 'tools', path)];
  });
  return table(['Agent', 'Tools'], rows);
}

export const BLOCKS = { 'snap-caps': snapCaps, 'skills-index': skillsIndex, 'agent-tools': agentTools };

async function renderPage(template, root) {
  let text = template;
  for (const [marker, name] of template.matchAll(MARKER)) {
    if (!BLOCKS[name]) throw new Error(`unknown block "${name}"`);
    const block = await BLOCKS[name](root);
    text = text.replace(marker, () => block);   // a function, so `$` in a description stays literal
  }
  return text;
}

export function listPages(root) {
  return readdirSync(join(root, PAGES_DIR)).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)).sort();
}

export async function generateWiki({ outDir, projectRoot = '.', pages }) {
  const all = listPages(projectRoot);
  const unknown = (pages ?? []).filter((p) => !all.includes(p));
  if (unknown.length) throw new Error(`no such page: ${unknown.join(', ')}`);
  const rendered = [];
  for (const page of pages ?? all) {
    const template = readText(join(projectRoot, PAGES_DIR, `${page}.md`));
    try {
      rendered.push([page, await renderPage(template, projectRoot)]);
    } catch (e) {
      throw new Error(`${page}: ${e.message}`);
    }
  }
  mkdirSync(outDir, { recursive: true });
  for (const [page, text] of rendered) writeFileSync(join(outDir, `${page}.md`), text);
  return rendered.map(([page]) => page);
}

async function main(argv) {
  const out = argv[argv.indexOf('--out') + 1];
  if (!argv.includes('--out') || !out) {
    console.error('usage: wiki-gen.mjs --out <dir>');
    process.exit(2);
  }
  try {
    const written = await generateWiki({ outDir: out });
    console.log(`wiki-gen: wrote ${written.length} pages to ${out}`);
  } catch (e) {
    // Non-zero on purpose: the workflow's job is continue-on-error, so this shows as a
    // warning on the run without failing CI, and the push step never sees partial output.
    console.error(`wiki-gen: nothing written, ${e.message}`);
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
