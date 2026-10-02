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

  // [BUG-050] Sub-shaped ids are seen, never silently skipped.
  it('sees a sub-shaped id like ARCH-008-S1 and reports it', () => {
    const text = '### [X] `[ARCH-008-S1]` Sub-shaped item';
    const r = scanHeadings(text);
    expect(r.headings).toBe(0);
    expect(r.subShaped).toEqual(['ARCH-008-S1']);
  });

  it('sees multiple sub-shaped ids alongside normal ones', () => {
    const text = [
      '### [X] `[BUG-010]` Normal item',
      '### [ ] `[ARCH-008-S1]` Sub one',
      '### [ ] `[ARCH-009-A]` Sub two',
      '### [X] `[FEAT-020]` Another normal',
    ].join('\n');
    const r = scanHeadings(text);
    expect(r.headings).toBe(2);
    expect(r.max).toEqual({ BUG: 10, FEAT: 20, ARCH: 9 });
    expect(r.subShaped).toEqual(['ARCH-008-S1', 'ARCH-009-A']);
  });

  it('does not report a top-level id as sub-shaped', () => {
    expect(scanHeadings('### [ ] `[BUG-050]` Normal').subShaped).toEqual([]);
  });

  // The ceiling's one job is that no id is minted twice: a sub-item consumes its parent's
  // number even when the parent has no heading of its own.
  it('lifts the ceiling to a sub-shaped heading\'s parent number when the parent is absent', () => {
    const text = ['### [X] `[ARCH-010]` Top', '### [X] `[ARCH-011-S1]` Orphan sub-item'].join('\n');
    expect(scanHeadings(text).max).toEqual({ ARCH: 11 });
  });

  it('reports a duplicated sub-shaped heading', () => {
    const text = ['### [X] `[ARCH-008-S1]` One', '### [ ] `[ARCH-008-S1]` Two'].join('\n');
    expect(scanHeadings(text).duplicates).toEqual([{ id: 'ARCH-008-S1', count: 2 }]);
  });
});
