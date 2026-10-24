// File symlinks need Developer Mode or elevation on win32; a host that can make one runs the tests.
import { mkdtempSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function probe() {
  const dir = mkdtempSync(join(tmpdir(), 'cc-symlink-probe-'));
  try { symlinkSync(join(dir, 'target'), join(dir, 'link')); return true; }
  catch { return false; }
  finally { rmSync(dir, { recursive: true, force: true }); }
}

export const CAN_SYMLINK = probe();
