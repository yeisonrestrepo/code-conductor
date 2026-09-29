import { describe, it, expect } from 'vitest';
import { scanHeadings } from '../../tools/id-ceiling.mjs';

// The forward-reference decoy. This fixture IS the [BUG-044] failure, frozen: the
// retired max-scan counted id-shaped tokens anywhere, including a plan line stating
// the ceiling it expected to read after minting, and so read its own predicted
// output back as evidence. Only the filed heading may count.
const DECOY = [
  '### [ ] `[BUG-010]` A filed item',
  '',
  'Prose naming `[BUG-042]` as a forward reference.',
  'A scope fence mentioning `[BUG-099]`.',
  'The ceiling this check expects to read after minting is `[BUG-500]`.',
  '',
].join('\n');

describe('scanHeadings', () => {
  it('counts filed headings only, never a prose forward reference', () => {
    const r = scanHeadings(DECOY);
    expect(r.headings).toBe(1);
    expect(r.max).toEqual({ BUG: 10 });
  });

  it('sees a four-digit id, which an exact \\d{3} quantifier would hide forever', () => {
    const r = scanHeadings('### [ ] `[BUG-1000]` Beyond three digits');
    expect(r.max).toEqual({ BUG: 1000 });
  });

  it('reports duplicate ids with their counts', () => {
    const text = [
      '### [X] `[BUG-010]` First',
      '### [ ] `[BUG-010]` Second',
      '### [ ] `[FEAT-011]` Only once',
    ].join('\n');
    expect(scanHeadings(text).duplicates).toEqual([{ id: 'BUG-010', count: 2 }]);
  });

  it('counts a heading in any state, because the ceiling is about filing not state', () => {
    const text = ['[ ]', '[X]', '[~]', '[>]', '[!]']
      .map((s, i) => `### ${s} \`[BUG-0${10 + i}]\` Item`)
      .join('\n');
    const r = scanHeadings(text);
    expect(r.headings).toBe(5);
    expect(r.max).toEqual({ BUG: 14 });
  });

  // Review Focus 1: a CRLF record must not read as zero headings.
  it('reads CRLF line endings', () => {
    expect(scanHeadings('### [ ] `[BUG-010]` Item\r\n### [ ] `[BUG-011]` Item\r\n').headings).toBe(2);
  });

  // Review Focus 4: trailing whitespace must not hide a heading from the count.
  it('reads a heading with trailing whitespace after the closing backtick', () => {
    expect(scanHeadings('### [ ] `[BUG-010]` Item   ').headings).toBe(1);
  });
});
