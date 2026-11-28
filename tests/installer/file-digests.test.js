import { describe, it, expect, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { digestTree, SYMLINK } from '../../lib/installer/file-digests.mjs';

const RM = { recursive: true, force: true, maxRetries: 10, retryDelay: 200 };
const sha = (text) => createHash('sha256').update(text).digest('hex');
const temps = [];
const tempDir = () => { const d = realpathSync(mkdtempSync(join(tmpdir(), 'cc-digest-'))); temps.push(d); return d; };
afterEach(() => { for (const d of temps.splice(0)) rmSync(d, RM); });

describe('digestTree', () => {
  it('D1 gives sorted, slash-separated keys and the sha256 of each file; empty directories are not entries', () => {
    const root = tempDir();
    mkdirSync(join(root, 'a', 'nested'), { recursive: true });
    mkdirSync(join(root, 'empty'));
    writeFileSync(join(root, 'b.txt'), 'bee');
    writeFileSync(join(root, 'A.md'), 'ay');
    writeFileSync(join(root, 'a', 'nested', 'c.txt'), 'sea');
    const digests = digestTree(root);
    expect(Object.keys(digests)).toEqual(['A.md', 'a/nested/c.txt', 'b.txt']);
    expect(digests).toEqual({ 'A.md': sha('ay'), 'a/nested/c.txt': sha('sea'), 'b.txt': sha('bee') });
  });

  it('D2 records a junction as a symlink and never follows it', () => {
    const root = tempDir();
    const outside = tempDir();
    writeFileSync(join(outside, 'secret.txt'), 'outside');
    symlinkSync(outside, join(root, 'link'), 'junction');
    const digests = digestTree(root);
    expect(digests).toEqual({ link: SYMLINK });
    expect(Object.keys(digests).some((k) => k.startsWith('link/'))).toBe(false);
  });

  it('D3 records an unreadable file by its error code and still digests the others', () => {
    const root = tempDir();
    writeFileSync(join(root, 'ok.txt'), 'fine');
    writeFileSync(join(root, 'locked.txt'), 'nope');
    const readFile = (path) => {
      if (path.endsWith('locked.txt')) throw Object.assign(new Error('denied'), { code: 'EACCES' });
      return readFileSync(path);
    };
    expect(digestTree(root, { readFile })).toEqual({ 'locked.txt': 'unreadable (EACCES)', 'ok.txt': sha('fine') });
  });
});
