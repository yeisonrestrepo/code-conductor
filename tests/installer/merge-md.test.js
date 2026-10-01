import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SENTINEL_START, SENTINEL_END, detectEol, normalizeHeading,
  mergeClaudeMdText, appendMissingLinesText,
} from '../../lib/installer/merge-md.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

// The contract, written out rather than computed by the code under test: the block is
// the sentinel lines and everything between them, plus one terminating newline.
const INTERIOR = ['## Agent Identity', '', 'You are an orchestrator.', '', '## Hard Constraints', '', '- Never hardcode secrets.'];
const BLOCK = [SENTINEL_START, ...INTERIOR, SENTINEL_END, ''].join('\n');
const TPL = ['# Project Claude Configuration', '', '## Project Identity', '', '- Name: TBD', '', '## Conventions', '', '- TBD', '', BLOCK].join('\n');

const crlf = (s) => s.replace(/\n/g, '\r\n');
const lf = (s) => s.replace(/\r\n/g, '\n');
const realTemplate = (rel) => lf(readFileSync(join(ROOT, rel), 'utf8'));
const blockOf = (tpl) => tpl.slice(tpl.indexOf(SENTINEL_START), tpl.indexOf(SENTINEL_END) + SENTINEL_END.length) + '\n';
// A conductor-shaped host with no sentinels: the template's own lines, one host line
// under every `## ` heading, so a lost section is a lost line.
const withHostLines = (tpl) => tpl.split('\n')
  .filter((l) => l !== SENTINEL_START && l !== SENTINEL_END)
  .flatMap((l) => (l.startsWith('## ') ? [l, `host line under ${l.slice(3)}`] : [l]))
  .join('\n');

describe('detectEol', () => {
  it('returns CRLF for a CRLF host and LF for an LF host', () => {
    expect(detectEol('a\r\nb')).toBe('\r\n');
    expect(detectEol('a\nb')).toBe('\n');
  });
  it('defaults to LF when the host has no terminator at all', () => {
    expect(detectEol('single line')).toBe('\n');
  });
});

describe('normalizeHeading', () => {
  it('ignores case, inner whitespace, trailing hashes and CR', () => {
    expect(normalizeHeading('## Agent   Identity ##\r')).toBe(normalizeHeading('## agent identity'));
  });
});

describe('mergeClaudeMdText — host preservation', () => {
  it('[AC3, LF] keeps every host byte and appends the managed block alone', () => {
    const host = ['# My Project', '', '## Project Identity', '', '- Name: acme', ''].join('\n');
    const { text, changed } = mergeClaudeMdText(TPL, host);
    expect(changed).toBe(true);
    expect(text).toBe(host + '\n' + BLOCK);
  });
  it('[AC3] never removes, rewrites, reorders or adds to a host section, known or not', () => {
    const host = ['# My Project', '', '## Deployment', '', 'kubectl apply', ''].join('\n');
    expect(mergeClaudeMdText(TPL, host).text).toBe(host + '\n' + BLOCK);
  });
  it('is idempotent — a second merge appends nothing and changes nothing', () => {
    const host = ['# My Project', '', '## Project Identity', '', '- Name: acme', ''].join('\n');
    const once = mergeClaudeMdText(TPL, host).text;
    const twice = mergeClaudeMdText(TPL, once);
    expect(twice.changed).toBe(false);
    expect(twice.text).toBe(once);
  });
});

describe('mergeClaudeMdText — managed block', () => {
  it('replaces the block interior and leaves content outside untouched', () => {
    const host = mergeClaudeMdText(TPL, '# My Project\n\n## Project Identity\n\n- Name: acme\n').text;
    const next = TPL.replace('You are an orchestrator.', 'You are a senior architect.');
    const { text, changed } = mergeClaudeMdText(next, host);
    expect(changed).toBe(true);
    expect(text).toContain('You are a senior architect.');
    expect(text).not.toContain('You are an orchestrator.');
    expect(text).toContain('- Name: acme');
  });
  it('[AC4] refreshes only the interior: every byte outside the sentinels is identical, in LF and CRLF', () => {
    const before = '# Mine  \n\n\n## X\ttab\n';
    const after = 'trailing  \n\n';
    const host = `${before}${SENTINEL_START}\nold interior\n${SENTINEL_END}\n${after}`;
    expect(mergeClaudeMdText(TPL, host).text).toBe(`${before}${BLOCK}${after}`);
    expect(mergeClaudeMdText(TPL, crlf(host)).text).toBe(crlf(`${before}${BLOCK}${after}`));
  });
  it('[AC11, AC1] keeps a sentinel-less host\'s managed-name sections and appends the block beside them', () => {
    const host = [
      '# My Project', '', '## Project Identity', '', '- Name: acme', '',
      '## Agent Identity', '', 'stale conductor text', '',
    ].join('\n');
    expect(mergeClaudeMdText(TPL, host).text).toBe(host + '\n' + BLOCK);
  });
  it('leaves the file entirely untouched on every malformed sentinel count', () => {
    for (const bad of [
      `# H\n\n${SENTINEL_END}\n`,
      `# H\n\n${SENTINEL_START}\n`,
      `# H\n\n${SENTINEL_START}\n${SENTINEL_START}\n${SENTINEL_END}\n`,
      `# H\n\n${SENTINEL_START}\nA\n${SENTINEL_END}\n${SENTINEL_START}\nB\n${SENTINEL_END}\n`,
      `# H\n\n${SENTINEL_END}\nX\n${SENTINEL_START}\n`,
    ]) {
      const r = mergeClaudeMdText(TPL, bad);
      expect(r.changed).toBe(false);
      expect(r.text).toBe(bad);
      expect(r.warning).toBe('CLAUDE_MD_SENTINEL_UNBALANCED');
    }
  });
});

describe('mergeClaudeMdText — parsing', () => {
  it('[AC3] does not treat sentinels inside a ``` fence as sentinels, so the host is sentinel-less', () => {
    const host = ['# H', '', '```md', SENTINEL_START, '## Agent Identity', SENTINEL_END, '```', ''].join('\n');
    expect(mergeClaudeMdText(TPL, host).text).toBe(host + '\n' + BLOCK);
  });
  it('[AC3] handles ~~~ fences with an info string the same way', () => {
    const host = ['# H', '', '~~~text title', SENTINEL_START, '~~~', ''].join('\n');
    expect(mergeClaudeMdText(TPL, host).text).toBe(host + '\n' + BLOCK);
  });
  it('[AC6, Review Focus 2] writes nothing to a sentinel-less host that ends inside an unclosed fence', () => {
    const host = ['# H', '', '```js', '## Project Identity'].join('\n');
    const r = mergeClaudeMdText(TPL, host);
    expect(r.changed).toBe(false);
    expect(r.text).toBe(host);
    expect(r.warning).toBe('CLAUDE_MD_UNCLOSED_FENCE');
  });
});

describe('mergeClaudeMdText — EOL', () => {
  it('[AC3] adds the missing trailing newline, then one blank line, before the block', () => {
    const host = '# H\n\n## Project Identity\n\n- Name: acme';
    expect(mergeClaudeMdText(TPL, host).text).toBe(host + '\n\n' + BLOCK);
  });
  it('[AC3, CRLF] writes the block in CRLF for a CRLF host and in LF for an LF host', () => {
    const host = '# H\n\n## Project Identity\n\n- Name: acme\n';
    expect(mergeClaudeMdText(TPL, crlf(host)).text).toBe(crlf(host) + '\r\n' + crlf(BLOCK));
    expect(mergeClaudeMdText(TPL, host).text).toBe(host + '\n' + BLOCK);
  });
  it('converges on a CRLF host — the second merge is a no-op', () => {
    const once = mergeClaudeMdText(TPL, crlf('# H\n\n## Project Identity\n\n- Name: acme\n')).text;
    const twice = mergeClaudeMdText(TPL, once);
    expect(twice.changed).toBe(false);
    expect(twice.text).toBe(once);
  });
  it('[AC3, BOM] keeps the byte-order mark as the first bytes', () => {
    const host = '﻿# H\n\nprose\n';
    expect(mergeClaudeMdText(TPL, host).text).toBe(host + '\n' + BLOCK);
  });
  it('[AC3, Review Focus 3] leaves a mixed-EOL host\'s bytes alone and appends in the detected EOL', () => {
    const host = '# H\r\nlf line\ncrlf line\r\n';
    expect(mergeClaudeMdText(TPL, host).text).toBe(host + '\r\n' + crlf(BLOCK));
  });
});

describe('mergeClaudeMdText — whole copy', () => {
  it('writes the whole template for an empty or whitespace-only host', () => {
    for (const host of ['', '   \n\n\t\n']) {
      const { text, changed } = mergeClaudeMdText(TPL, host);
      expect(changed).toBe(true);
      expect(text).toBe(TPL);
    }
  });
  it('[AC3] appends the block alone to a host with no ## headings', () => {
    const host = '# H\n\nJust prose.\n';
    expect(mergeClaudeMdText(TPL, host).text).toBe(host + '\n' + BLOCK);
  });
});

describe('mergeClaudeMdText — BUG-049 red cases, on the shipped templates', () => {
  it('[AC1, AC6] keeps all 15 host lines of a sentinel-less conductor-shaped file and appends the block alone', () => {
    const tpl = realTemplate('project-template/CLAUDE.md');
    const host = withHostLines(tpl) + '## Migration Skills\nhost line under Migration Skills\n';
    expect(host.match(/^host line under /gm)).toHaveLength(15);
    const once = mergeClaudeMdText(tpl, host);
    expect(once.text).toBe(host + '\n' + blockOf(tpl));
    expect(mergeClaudeMdText(tpl, once.text).changed).toBe(false);
  });
  it('[AC9b, AC6] preserves field-damaged input byte for byte: no repair, no relabelling', () => {
    // Field-verbatim: the head of the nymbl backup, supplied by the owner 2026-09-30.
    const fieldHead = readFileSync(join(HERE, 'fixtures', 'bug049-field-head.md'), 'utf8');
    // Reconstruction: lines 16 onward of project-template/CLAUDE.md at 2a3a811, the
    // template byte-identical to the 1.23.0-1.23.3 tarballs (sha1 3d0ee6dfc962).
    const reconstruction = readFileSync(join(HERE, 'fixtures', 'bug049-2a3a811-tail.md'), 'utf8');
    const host = fieldHead + reconstruction;
    const tpl = realTemplate('project-template/CLAUDE.md');
    const once = mergeClaudeMdText(tpl, host);
    expect(once.text).toBe(host + '\n' + blockOf(tpl));
    expect(mergeClaudeMdText(tpl, once.text).changed).toBe(false);
  });
});

describe('appendMissingLinesText', () => {
  it('retains host lines and appends only absent non-blank, non-comment template lines', () => {
    const tpl = '# comment\n\nnode_modules\n.claude/memory/turn-count.txt\n';
    const host = 'dist\nnode_modules\n';
    const { text, changed } = appendMissingLinesText(tpl, host);
    expect(changed).toBe(true);
    expect(text).toBe('dist\nnode_modules\n.claude/memory/turn-count.txt\n');
    expect(text).not.toContain('# comment');
  });
  it('is idempotent and reports no change when every line is present', () => {
    const tpl = 'node_modules\n';
    const r = appendMissingLinesText(tpl, 'node_modules\n');
    expect(r.changed).toBe(false);
    expect(r.text).toBe('node_modules\n');
  });
  it('matches on trimmed, CR-stripped lines and appends in host EOL', () => {
    const r = appendMissingLinesText('node_modules\ndist\n', 'node_modules  \r\n');
    expect(r.changed).toBe(true);
    expect(r.text).toBe('node_modules  \r\ndist\r\n');
  });
});
