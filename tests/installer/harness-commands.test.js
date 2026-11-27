import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OPENCODE_PREAMBLE, PREAMBLE, SOURCE_DIRS, renderAll, renderCommand, staleRenders } from '../../lib/installer/harness-commands.mjs';

// FEAT-048 slice 3 (#97): agy workflows and Codex skills are rendered from the cc-* sources.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SOURCE = '---\ndescription: "(Conductor) Say hi"\n---\n\nSay hi to $ARGUMENTS.\n';
const frontmatter = (text) => text.split('\n---\n')[0];

describe('renderCommand', () => {
  it('writes a workflow with the source description', () => {
    const { workflow } = renderCommand('cc-hi', SOURCE);
    expect(frontmatter(workflow)).toBe('---\ndescription: "(Conductor) Say hi"');
  });
  it('writes a skill named after the command that says when to use it', () => {
    const { skill } = renderCommand('cc-hi', SOURCE);
    expect(frontmatter(skill)).toBe('---\nname: cc-hi\ndescription: "(Conductor) Say hi Use when the user asks for /cc-hi or cc-hi."');
  });
  it('adds the preamble once and keeps the source body unchanged', () => {
    const { workflow, skill } = renderCommand('cc-hi', SOURCE);
    for (const text of [workflow, skill]) {
      expect(text.split(PREAMBLE)).toHaveLength(2);
      expect(text.endsWith('\nSay hi to $ARGUMENTS.\n')).toBe(true);
    }
  });
  it('renders a CRLF source like its LF form', () => {
    expect(renderCommand('cc-hi', SOURCE.replace(/\n/g, '\r\n'))).toEqual(renderCommand('cc-hi', SOURCE));
  });
  it('renders a source with a UTF-8 BOM like one without', () => {
    expect(renderCommand('cc-hi', `﻿${SOURCE}`)).toEqual(renderCommand('cc-hi', SOURCE));
  });
  it('throws naming the file when the description is missing', () => {
    expect(() => renderCommand('cc-bad', '---\nmodel: x\n---\nbody\n')).toThrow('cc-bad: missing frontmatter description');
    expect(() => renderCommand('cc-bad', 'no frontmatter\n')).toThrow('cc-bad: missing frontmatter description');
  });
  it('keeps a description with a double quote parseable', () => {
    const { workflow } = renderCommand('cc-q', '---\ndescription: "Say \\"hi\\""\n---\nbody\n');
    const line = workflow.split('\n')[1];
    expect(JSON.parse(line.slice('description: '.length))).toBe('Say "hi"');
  });
});

// FEAT-048 slice 4 (#97): OpenCode runs `!`cmd`` and attaches `@path` from a command template
// outside any tool call, so the guard plugin never sees them. Regexes copied from OpenCode
// v1.19.6 (packages/opencode/src/config/markdown.ts, session/prompt.ts).
const OC_SHELL = /!`([^`]+)`/g;
const OC_FILE = /(?<![\w`])@(\.?[^\s`,.]*(?:\.[^\s`,.]+)*)/g;
const OC_PLACEHOLDER = /\$(\d+)/g;
const opencodeActs = (text) => [
  ...[...text.matchAll(OC_SHELL)].map((m) => `shell ${m[1]}`),
  ...[...text.matchAll(OC_FILE)].filter((m) => m[1]).map((m) => `file ${m[1]}`),
  ...(text.match(OC_PLACEHOLDER) ?? []).map((m) => `placeholder ${m}`),
];

describe('renderCommand: OpenCode command', () => {
  it('writes the source description as frontmatter', () => {
    expect(frontmatter(renderCommand('cc-hi', SOURCE).opencode)).toBe('---\ndescription: "(Conductor) Say hi"');
  });
  it('adds the OpenCode preamble once and keeps a plain body unchanged', () => {
    const { opencode } = renderCommand('cc-hi', SOURCE);
    expect(opencode.split(OPENCODE_PREAMBLE)).toHaveLength(2);
    expect(opencode.endsWith('\nSay hi to $ARGUMENTS.\n')).toBe(true);
  });
  it('spaces out a shell trigger so OpenCode does not run it', () => {
    const { opencode } = renderCommand('cc-x', '---\ndescription: d\n---\nstate (`X` or `!`): then `run`\n');
    expect(opencode.endsWith('\nstate (`X` or `! `): then `run`\n')).toBe(true);
    expect(opencodeActs(opencode)).toEqual([]);
  });
  it('spaces out an attachable @name and leaves an e-mail-like or code-span @ alone', () => {
    const { opencode } = renderCommand('cc-x', '---\ndescription: d\n---\nsee @docs and {@code x} and `@keep` and a@b\n');
    expect(opencode.endsWith('\nsee @ docs and {@ code x} and `@keep` and a@b\n')).toBe(true);
    expect(opencodeActs(opencode)).toEqual([]);
  });
  it('spaces out a dot-led @name, which OpenCode also attaches', () => {
    const { opencode } = renderCommand('cc-x', '---\ndescription: d\n---\nread @.env and @.\n');
    expect(opencode.endsWith('\nread @ .env and @ .\n')).toBe(true);
    expect(opencodeActs(opencode)).toEqual([]);
  });
  it('separates $ARGUMENTS from an adjacent backtick, preamble included', () => {
    const { opencode } = renderCommand('cc-x', '---\ndescription: d\n---\nrun `$ARGUMENTS` now\n');
    expect(opencode.endsWith('\nrun ` $ARGUMENTS ` now\n')).toBe(true);
    expect(opencode).not.toMatch(/`\$ARGUMENTS|\$ARGUMENTS`/);
  });
});

describe('rendered files stay in sync with the sources (drift)', () => {
  const rendered = renderAll(ROOT);
  it('renders one workflow, one skill and one OpenCode command per cc-* source', () => {
    const sources = SOURCE_DIRS.flatMap((d) => readdirSync(join(ROOT, d)).filter((f) => /^cc-.*\.md$/.test(f)));
    expect(rendered.size).toBe(sources.length * 3);
    expect([...rendered.keys()].filter((k) => k.startsWith('.opencode/command/'))).toHaveLength(sources.length);
  });
  it.each([...rendered.keys()].filter((k) => k.startsWith('.opencode/')).map((k) => [k]))('%s gives OpenCode nothing to run, attach or substitute', (rel) => {
    expect(opencodeActs(readFileSync(join(ROOT, 'project-template', rel), 'utf8'))).toEqual([]);
  });
  // OpenCode substitutes $ARGUMENTS before its shell pass, so a backtick next to it plus an
  // ordinary argument ending in `!` would form a trigger the user never typed.
  it.each([...rendered.keys()].filter((k) => k.startsWith('.opencode/')).flatMap((k) => [[k, 'add login!'], [k, 'mail me@']]))('%s gives OpenCode nothing to run or attach after substituting %j', (rel, args) => {
    const text = readFileSync(join(ROOT, 'project-template', rel), 'utf8').replaceAll('$ARGUMENTS', args);
    expect(opencodeActs(text)).toEqual([]);
  });
  it.each([...rendered.keys()].map((k) => [k]))('%s matches its committed copy (run: node lib/installer/harness-commands.mjs --write)', (rel) => {
    expect(readFileSync(join(ROOT, 'project-template', rel), 'utf8')).toBe(rendered.get(rel));
  });
  it('leaves no stale cc-* render behind', () => {
    expect(staleRenders(ROOT, rendered)).toEqual([]);
  });
});
