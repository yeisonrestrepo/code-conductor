import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PREAMBLE, SOURCE_DIRS, renderAll, renderCommand, staleRenders } from '../../lib/installer/harness-commands.mjs';

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
    for (const text of Object.values(renderCommand('cc-hi', SOURCE))) {
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

describe('rendered files stay in sync with the sources (drift)', () => {
  const rendered = renderAll(ROOT);
  it('renders one workflow and one skill per cc-* source', () => {
    const sources = SOURCE_DIRS.flatMap((d) => readdirSync(join(ROOT, d)).filter((f) => /^cc-.*\.md$/.test(f)));
    expect(rendered.size).toBe(sources.length * 2);
  });
  it.each([...rendered.keys()].map((k) => [k]))('%s matches its committed copy (run: node lib/installer/harness-commands.mjs --write)', (rel) => {
    expect(readFileSync(join(ROOT, 'project-template', rel), 'utf8')).toBe(rendered.get(rel));
  });
  it('leaves no stale cc-* render behind', () => {
    expect(staleRenders(ROOT, rendered)).toEqual([]);
  });
});
