import { describe, it, expect } from 'vitest';
import {
  SENTINEL_START, SENTINEL_END, detectEol, normalizeHeading,
  mergeClaudeMdText, appendMissingLinesText,
} from '../../lib/installer/merge-md.mjs';

const TPL = [
  '# Project Claude Configuration',
  '',
  '## Project Identity',
  '',
  '- Name: TBD',
  '',
  '## Conventions',
  '',
  '- TBD',
  '',
  SENTINEL_START,
  '## Agent Identity',
  '',
  'You are an orchestrator.',
  '',
  '## Hard Constraints',
  '',
  '- Never hardcode secrets.',
  SENTINEL_END,
  '',
].join('\n');

const crlf = (s) => s.replace(/\n/g, '\r\n');

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
  it('keeps every host-owned line byte-identical and appends only missing sections', () => {
    const host = ['# My Project', '', '## Project Identity', '', '- Name: acme', ''].join('\n');
    const { text, changed } = mergeClaudeMdText(TPL, host);
    expect(changed).toBe(true);
    expect(text).toContain('- Name: acme');
    expect(text).not.toContain('- Name: TBD');
    expect(text).toContain('## Conventions');
    expect(text).toContain(SENTINEL_START);
    expect(text.indexOf('## Conventions')).toBeLessThan(text.indexOf(SENTINEL_START));
  });
  it('never removes, rewrites or reorders a host section the template lacks', () => {
    const host = ['# My Project', '', '## Deployment', '', 'kubectl apply', ''].join('\n');
    const { text } = mergeClaudeMdText(TPL, host);
    expect(text).toContain('## Deployment\n\nkubectl apply');
    expect(text.indexOf('## Deployment')).toBeLessThan(text.indexOf('## Project Identity'));
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
  it('migrates a sentinel-less host without producing duplicate headings', () => {
    const host = [
      '# My Project', '', '## Project Identity', '', '- Name: acme', '',
      '## Agent Identity', '', 'stale conductor text', '',
    ].join('\n');
    const { text } = mergeClaudeMdText(TPL, host);
    const count = text.split('\n').filter(l => normalizeHeading(l) === 'agent identity' && l.startsWith('## ')).length;
    expect(count).toBe(1);
    expect(text).not.toContain('stale conductor text');
    expect(text).toContain('- Name: acme');
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
  it('does not treat ## inside a fence as a heading, on either side', () => {
    const host = ['# H', '', '```md', '## Conventions', '```', ''].join('\n');
    const { text } = mergeClaudeMdText(TPL, host);
    expect(text.split('## Conventions').length - 1).toBe(2); // the fenced one + the appended real one
  });
  it('handles ~~~ fences, info strings and an unclosed fence at EOF', () => {
    const host = ['# H', '', '~~~text title', '## Conventions', '~~~', '', '```js', '## Project Identity'].join('\n');
    const { text } = mergeClaudeMdText(TPL, host);
    expect(text).toContain('## Conventions\n\n- TBD');
    expect(text).toContain('## Project Identity\n\n- Name: TBD');
  });
  it('treats ### and indented ## as body text', () => {
    const host = ['# H', '', '### Conventions', '', '  ## Project Identity', ''].join('\n');
    const { text } = mergeClaudeMdText(TPL, host);
    expect(text).toContain('## Conventions\n\n- TBD');
    expect(text).toContain('## Project Identity\n\n- Name: TBD');
  });
});

describe('mergeClaudeMdText — EOL', () => {
  it('adds the missing trailing newline before appending', () => {
    const host = '# H\n\n## Project Identity\n\n- Name: acme';
    const { text } = mergeClaudeMdText(TPL, host);
    expect(text).not.toContain('- Name: acme## ');
    expect(text).toContain('- Name: acme\n');
  });
  it('writes CRLF for a CRLF host and never introduces CRLF into an LF host', () => {
    const host = crlf('# H\n\n## Project Identity\n\n- Name: acme\n');
    const { text } = mergeClaudeMdText(TPL, host);
    expect(text).toContain('\r\n');
    expect(text.replace(/\r\n/g, '')).not.toContain('\n');
    const lf = mergeClaudeMdText(TPL, '# H\n\n## Project Identity\n\n- Name: acme\n').text;
    expect(lf).not.toContain('\r');
  });
  it('converges on a CRLF host — the second merge is a no-op', () => {
    const once = mergeClaudeMdText(TPL, crlf('# H\n\n## Project Identity\n\n- Name: acme\n')).text;
    const twice = mergeClaudeMdText(TPL, once);
    expect(twice.changed).toBe(false);
    expect(twice.text).toBe(once);
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
  it('appends every template section to a host with no ## headings', () => {
    const { text } = mergeClaudeMdText(TPL, '# H\n\nJust prose.\n');
    expect(text).toContain('Just prose.');
    expect(text).toContain('## Project Identity');
    expect(text).toContain('## Conventions');
    expect(text).toContain(SENTINEL_END);
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
