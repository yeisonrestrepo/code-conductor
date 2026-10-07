import { describe, it, expect } from 'vitest';
import { checkParity, parseBacklog, parseChangelog } from '../../tools/record-parity.mjs';

const run = (backlogText, changelogText, versionFile = '1.32.2') =>
  checkParity({ backlogText, changelogText, versionFile });

const CLAIMED = [
  '# Changelog', '',
  '## [1.32.2] - 2026-09-29', '',
  '### Fixed',
  '- **[BUG-046]** Release-critical instruments are tracked.', '',
].join('\n');

describe('checkParity', () => {
  it('passes when the claim, the heading, the DONE bullet and VERSION all agree', () => {
    const backlog = [
      '### [X] `[BUG-046]` Release-Critical Instruments Are Repo Infrastructure',
      '* **DONE, shipped as `1.32.2`** on 2026-09-29.',
    ].join('\n');
    expect(run(backlog, CLAIMED).ok).toBe(true);
  });

  // The [BUG-044] state itself, frozen as the deliberate-defect fixture: a heading
  // reading [ ] while the CHANGELOG claims the version shipped.
  it('fails and names the heading when a claimed id is still open', () => {
    const backlog = '### [ ] `[BUG-046]` Release-Critical Instruments Are Repo Infrastructure';
    const r = run(backlog, CLAIMED);
    expect(r.ok).toBe(false);
    expect(r.violations).toContainEqual(
      expect.objectContaining({ direction: 'A', id: 'BUG-046', version: '1.32.2' }),
    );
  });

  // The reverse direction, so the instrument reports on more than a missing flip.
  it('fails naming the disagreement when a DONE bullet names a version VERSION denies', () => {
    const backlog = [
      '### [X] `[BUG-046]` Release-Critical Instruments Are Repo Infrastructure',
      '* **DONE, shipped as `1.31.9`** on 2026-09-29.',
    ].join('\n');
    const r = run(backlog, CLAIMED, '1.32.2');
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => v.direction === 'B' && v.detail.includes('1.31.9'))).toBe(true);
  });

  // THE CONTROL. The single-level (bullet-start only) form reported exactly this as a
  // violation against the real CHANGELOG. It is not one: `### Filed` records a minted
  // item, not a shipped one.
  it('does not read a `### Filed` bullet as a claim', () => {
    const changelog = [
      '# Changelog', '',
      '## [1.32.2] - 2026-09-29', '',
      '### Fixed',
      '- **[BUG-046]** Shipped.', '',
      '### Filed',
      '- **[BUG-048]** Minted, not shipped.', '',
    ].join('\n');
    const backlog = [
      '### [X] `[BUG-046]` Shipped',
      '* **DONE, shipped as `1.32.2`**.',
      '### [ ] `[BUG-048]` Minted but open',
    ].join('\n');
    expect(run(backlog, changelog).ok).toBe(true);
  });

  it('accepts [~] as terminal beside [X]', () => {
    const changelog = [
      '# Changelog', '', '## [1.30.0] - 2026-09-01', '',
      '### Fixed', '- **[BUG-035]** Superseded work.', '',
    ].join('\n');
    const backlog = '### [~] `[BUG-035]` Superseded';
    expect(run(backlog, changelog, '1.30.0').ok).toBe(true);
  });

  it('reports a claim with no heading differently from a heading in the wrong state', () => {
    const r = run('', CLAIMED);
    expect(r.ok).toBe(false);
    expect(r.violations[0].detail).toMatch(/no backlog heading/i);
  });

  // Review Focus 5: a record that disagrees with itself must be reported, not
  // silently resolved to whichever heading came first.
  it('reports two CHANGELOG headings naming the same version', () => {
    const changelog = [
      '# Changelog', '', '## [1.32.2] - 2026-09-29', '', '### Fixed', '- **[BUG-046]** One.', '',
      '## [1.32.2] - 2026-09-28', '', '### Fixed', '- **[BUG-046]** Again.', '',
    ].join('\n');
    expect(parseChangelog(changelog).duplicates).toEqual(['1.32.2']);
  });

  // Vacuous-pass closure: zero claims because the file could not be parsed is a
  // failure, not a pass. This is the shape every retired instrument shared.
  it('fails rather than passing vacuously when the CHANGELOG has no version heading', () => {
    const r = run('### [X] `[BUG-046]` Item', '# Changelog\n\nNothing here.\n');
    expect(r.ok).toBe(false);
    expect(r.violations[0].detail).toMatch(/no version heading/i);
  });

  // Review Focus 1: CRLF must not read as zero claims.
  it('reads CRLF records', () => {
    const backlog = '### [X] `[BUG-046]` Item\r\n* **DONE, shipped as `1.32.2`**.\r\n';
    expect(run(backlog, CLAIMED.replace(/\n/g, '\r\n')).ok).toBe(true);
  });

  // [BUG-050] repair (b), owner-ruled: an existing sub-shaped heading is legitimate history,
  // so it is seen and named, never failed; only a sub-shaped CLAIM is a failure.
  it('sees a sub-shaped backlog heading without failing on it', () => {
    const backlog = [
      '### [X] `[BUG-046]` Normal item',
      '* **DONE, shipped as `1.32.2`**.',
      '### [X] `[ARCH-008-S1]` Sub-shaped item',
    ].join('\n');
    const r = run(backlog, CLAIMED);
    expect(r.ok).toBe(true);
    expect(r.subShaped).toEqual(['ARCH-008-S1']);
  });

  it('fails a sub-shaped claim under a shipped section, naming it', () => {
    const changelog = [
      '# Changelog', '',
      '## [1.32.2] - 2026-09-29', '',
      '### Fixed',
      '- **[BUG-046]** Normal claim.',
      '- **[ARCH-009-S1]** Sub-shaped claim.', '',
    ].join('\n');
    const backlog = [
      '### [X] `[BUG-046]` Normal',
      '* **DONE, shipped as `1.32.2`**.',
    ].join('\n');
    const r = run(backlog, changelog);
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => v.direction === 'SUB' && v.id === 'ARCH-009-S1' && v.version === '1.32.2')).toBe(true);
  });

  it('does not report a top-level id as sub-shaped', () => {
    const backlog = [
      '### [X] `[BUG-046]` Normal item',
      '* **DONE, shipped as `1.32.2`**.',
    ].join('\n');
    expect(run(backlog, CLAIMED).violations.filter((v) => v.direction === 'SUB')).toEqual([]);
  });

  // BUG-046's two-level rule holds for sub-shaped ids too: under Filed or Notes a bullet
  // records a minted item, not a shipped one, and reading it as a claim is the false
  // positive the single-level form produced on this repository's own CHANGELOG.
  it.each(['Filed', 'Notes'])('ignores a sub-shaped bullet under ### %s', (section) => {
    const changelog = CLAIMED + `\n### ${section}\n- **[ARCH-009-S1]** Minted, not shipped.\n`;
    const backlog = '### [X] `[BUG-046]` Normal\n* **DONE, shipped as `1.32.2`**.\n';
    expect(run(backlog, changelog).violations).toEqual([]);
  });

  it('keeps a sub-shaped entry\'s body out of its parent\'s entry', () => {
    const backlog = [
      '### [X] `[ARCH-008]` Parent',
      '* Parent body.',
      '### [X] `[ARCH-008-S1]` Sub-item',
      '* **DONE, shipped as `9.9.9`**.',
    ].join('\n');
    const entries = parseBacklog(backlog);
    expect(entries.get('ARCH-008').body).not.toContain('9.9.9');
    expect(entries.get('ARCH-008-S1').body).toContain('9.9.9');
  });
});
