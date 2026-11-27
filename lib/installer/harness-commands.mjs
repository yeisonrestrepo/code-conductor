// FEAT-048 slice 3: renders every cc-* Claude Code command into an Antigravity CLI workflow
// (.agents/workflows/cc-<x>.md), a Codex CLI skill (.agents/skills/cc-<x>/SKILL.md) and,
// since slice 4, an OpenCode command (.opencode/command/cc-<x>.md). Since slice 6, every band
// agent also becomes an OpenCode subagent (.opencode/agent/conductor-<role>.md).
// The rendered files are committed under project-template/ and a drift test re-renders
// them, so they are never hand-maintained copies.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SOURCE_DIRS = ['project-template/.claude/commands', 'global/commands'];

export const PREAMBLE = '> code-conductor: this command was written for Claude Code. Where it names a Claude Code tool (Read, Grep, Glob, Edit, Write, Bash, Skill, Agent), use your closest equivalent. `$ARGUMENTS` and an `ARGUMENTS:` line mean the text the user gave with the command.';

export const AGENT_SOURCE_DIR = 'project-template/.claude/agents';

// The OpenCode name of a band agent. The prefix keeps a render from overriding OpenCode's
// built-in `plan` agent or a host's own `code` or `docs` agent (FEAT-048 slice 6).
export const OPENCODE_AGENT_PREFIX = 'conductor-';

const OPENCODE_NOTE = 'A space was inserted after some exclamation marks and at signs, and between the arguments placeholder and an adjacent backtick, so OpenCode does not run or attach text; read the text as if the space were not there. A code-conductor agent this command names, such as audit, is the OpenCode subagent conductor-audit: add that prefix to the agent name you dispatch.';

export const AGENT_PREAMBLE = '> code-conductor: this agent was written for Claude Code. Where it names a Claude Code tool (Read, Grep, Glob, Edit, Write, Bash), use your closest equivalent.';

// Claude Code tool -> OpenCode permission key. A tool missing here throws, so a new tool in
// an agent's mask fails the drift test instead of being silently dropped.
const OPENCODE_PERMISSION = { Read: 'read', Grep: 'grep', Glob: 'glob', Write: 'edit', Edit: 'edit', Bash: 'bash' };

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n/;

// FEAT-048 slice 4: OpenCode runs every !`...` in a command template in the shell and attaches
// every @path, both outside any tool call, so the guard plugin never sees them. $ARGUMENTS is
// substituted before that pass, so an argument ending in `!` next to a backtick would form one.
function neutralizeForOpencode(body) {
  return body
    .replace(/!`/g, '! `')
    .replace(/\$ARGUMENTS`/g, '$ARGUMENTS `')
    .replace(/`\$ARGUMENTS/g, '` $ARGUMENTS')
    .replace(/(?<![\w`])@(?=[^\s`,])/g, '@ ');
}

export const OPENCODE_PREAMBLE = `${neutralizeForOpencode(PREAMBLE)} ${OPENCODE_NOTE}`;

function readField(name, frontmatter, key) {
  const line = frontmatter.split('\n').find((l) => l.startsWith(`${key}:`));
  if (!line) throw new Error(`${name}: missing frontmatter ${key}`);
  const raw = line.slice(key.length + 1).trim();
  const value = raw.startsWith('"') ? JSON.parse(raw) : raw;
  if (!value) throw new Error(`${name}: missing frontmatter ${key}`);
  return value;
}

// Some sources carry a UTF-8 BOM; it is not content and would hide the frontmatter.
function splitSource(name, text) {
  const source = text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const match = FRONTMATTER.exec(source);
  if (!match) throw new Error(`${name}: missing frontmatter description`);
  return { frontmatter: match[1], body: source.slice(match[0].length) };
}

// "*": deny comes first, so every tool the source does not list is denied (measured on 1.19.6).
function opencodePermission(name, toolsCsv) {
  const keys = [];
  for (const tool of toolsCsv.split(',').map((t) => t.trim()).filter(Boolean)) {
    const key = OPENCODE_PERMISSION[tool];
    if (!key) throw new Error(`${name}: tool "${tool}" has no OpenCode permission mapping`);
    if (!keys.includes(key)) keys.push(key);
  }
  return ['  "*": deny', ...keys.map((k) => `  ${k}: allow`)].join('\n');
}

export function renderAgent(name, text) {
  const { frontmatter, body } = splitSource(name, text);
  const description = readField(name, frontmatter, 'description');
  const permission = opencodePermission(name, readField(name, frontmatter, 'tools'));
  return `---\ndescription: ${JSON.stringify(description)}\nmode: subagent\npermission:\n${permission}\n---\n\n${AGENT_PREAMBLE}\n\n${body.replace(/^\n+/, '')}`;
}

// JSON string quoting is valid YAML double-quoted scalar syntax, so any description stays parseable.
export function renderCommand(name, text) {
  const { frontmatter, body: sourceBody } = splitSource(name, text);
  const description = readField(name, frontmatter, 'description');
  const body = `\n${PREAMBLE}\n\n${sourceBody}`;
  const skillDescription = `${description} Use when the user asks for /${name} or ${name}.`;
  const header = `---\ndescription: ${JSON.stringify(description)}\n---\n`;
  return {
    workflow: `${header}${body}`,
    skill: `---\nname: ${name}\ndescription: ${JSON.stringify(skillDescription)}\n---\n${body}`,
    opencode: `${header}\n${OPENCODE_PREAMBLE}\n\n${neutralizeForOpencode(sourceBody)}`,
  };
}

export function renderAll(repoRoot) {
  const out = new Map();
  for (const dir of SOURCE_DIRS) {
    for (const file of readdirSync(join(repoRoot, dir)).filter((f) => /^cc-.*\.md$/.test(f)).sort()) {
      const name = file.slice(0, -3);
      const { workflow, skill, opencode } = renderCommand(name, readFileSync(join(repoRoot, dir, file), 'utf8'));
      out.set(`.agents/workflows/${name}.md`, workflow);
      out.set(`.agents/skills/${name}/SKILL.md`, skill);
      out.set(`.opencode/command/${name}.md`, opencode);
    }
  }
  for (const file of readdirSync(join(repoRoot, AGENT_SOURCE_DIR)).filter((f) => f.endsWith('.md')).sort()) {
    const name = file.slice(0, -3);
    out.set(`.opencode/agent/${OPENCODE_AGENT_PREFIX}${name}.md`, renderAgent(name, readFileSync(join(repoRoot, AGENT_SOURCE_DIR, file), 'utf8')));
  }
  return out;
}

// cc-* renders present under project-template/ that renderAll no longer produces.
export function staleRenders(repoRoot, rendered) {
  const template = join(repoRoot, 'project-template');
  const stale = [];
  for (const [dir, prefix] of [['.agents/workflows', 'cc-'], ['.opencode/command', 'cc-'], ['.opencode/agent', OPENCODE_AGENT_PREFIX]]) {
    const abs = join(template, dir);
    if (!existsSync(abs)) continue;
    for (const f of readdirSync(abs)) if (f.startsWith(prefix) && !rendered.has(`${dir}/${f}`)) stale.push(`${dir}/${f}`);
  }
  const skills = join(template, '.agents', 'skills');
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
