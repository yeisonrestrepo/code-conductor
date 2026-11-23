// FEAT-048 slice 3: renders every cc-* Claude Code command into an Antigravity CLI workflow
// (.agents/workflows/cc-<x>.md) and a Codex CLI skill (.agents/skills/cc-<x>/SKILL.md).
// The rendered files are committed under project-template/ and a drift test re-renders
// them, so they are never hand-maintained copies.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SOURCE_DIRS = ['project-template/.claude/commands', 'global/commands'];

export const PREAMBLE = '> code-conductor: this command was written for Claude Code. Where it names a Claude Code tool (Read, Grep, Glob, Edit, Write, Bash, Skill, Agent), use your closest equivalent. `$ARGUMENTS` and an `ARGUMENTS:` line mean the text the user gave with the command.';

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n/;

function readDescription(name, frontmatter) {
  const line = frontmatter.split('\n').find((l) => l.startsWith('description:'));
  if (!line) throw new Error(`${name}: missing frontmatter description`);
  const raw = line.slice('description:'.length).trim();
  const value = raw.startsWith('"') ? JSON.parse(raw) : raw;
  if (!value) throw new Error(`${name}: missing frontmatter description`);
  return value;
}

// JSON string quoting is valid YAML double-quoted scalar syntax, so any description stays parseable.
export function renderCommand(name, text) {
  // Some sources carry a UTF-8 BOM; it is not content and would hide the frontmatter.
  const source = text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const match = FRONTMATTER.exec(source);
  if (!match) throw new Error(`${name}: missing frontmatter description`);
  const description = readDescription(name, match[1]);
  const body = `\n${PREAMBLE}\n\n${source.slice(match[0].length)}`;
  const skillDescription = `${description} Use when the user asks for /${name} or ${name}.`;
  return {
    workflow: `---\ndescription: ${JSON.stringify(description)}\n---\n${body}`,
    skill: `---\nname: ${name}\ndescription: ${JSON.stringify(skillDescription)}\n---\n${body}`,
  };
}

export function renderAll(repoRoot) {
  const out = new Map();
  for (const dir of SOURCE_DIRS) {
    for (const file of readdirSync(join(repoRoot, dir)).filter((f) => /^cc-.*\.md$/.test(f)).sort()) {
      const name = file.slice(0, -3);
      const { workflow, skill } = renderCommand(name, readFileSync(join(repoRoot, dir, file), 'utf8'));
      out.set(`.agents/workflows/${name}.md`, workflow);
      out.set(`.agents/skills/${name}/SKILL.md`, skill);
    }
  }
  return out;
}

// cc-* renders present under project-template/ that renderAll no longer produces.
export function staleRenders(repoRoot, rendered) {
  const base = join(repoRoot, 'project-template', '.agents');
  const stale = [];
  const workflows = join(base, 'workflows');
  if (existsSync(workflows)) {
    for (const f of readdirSync(workflows)) if (f.startsWith('cc-') && !rendered.has(`.agents/workflows/${f}`)) stale.push(`.agents/workflows/${f}`);
  }
  const skills = join(base, 'skills');
  if (existsSync(skills)) {
    for (const d of readdirSync(skills)) if (d.startsWith('cc-') && !rendered.has(`.agents/skills/${d}/SKILL.md`)) stale.push(`.agents/skills/${d}`);
  }
  return stale;
}

function writeAll(repoRoot) {
  const rendered = renderAll(repoRoot);
  for (const rel of staleRenders(repoRoot, rendered)) rmSync(join(repoRoot, 'project-template', rel), { recursive: true, force: true });
  for (const [rel, text] of rendered) {
    const target = join(repoRoot, 'project-template', rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
  }
  return rendered.size;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv[2] !== '--write') {
    process.stderr.write('usage: node lib/installer/harness-commands.mjs --write\n');
    process.exit(2);
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  process.stdout.write(`rendered ${writeAll(root)} files\n`);
}
