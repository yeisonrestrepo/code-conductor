// Drives the sample session through the patched hook, opens viewer-prototype.html on the
// events it wrote, from file://, and saves a headless Chrome/Edge screenshot next to this script.
// Usage: node tests/probes/flow-viewer/screenshot.mjs
import { execFileSync } from 'node:child_process';
import { mkdtempSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildPatchedHook } from './patched-hook.mjs';
import { runSampleSession } from './sample-session.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
];

const work = mkdtempSync(join(tmpdir(), 'flow-shot-'));
const { flow } = buildPatchedHook(work);
const cwd = join(work, 'project');
runSampleSession(flow, cwd);

copyFileSync(join(HERE, 'viewer-prototype.html'), join(cwd, '.claude', 'flow-viewer.html'));
const browser = BROWSERS.find((b) => existsSync(b));
if (!browser) throw new Error('no Chromium browser found');
const out = join(HERE, 'viewer-prototype.png');
execFileSync(browser, ['--headless', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=2', '--window-size=1400,760',
  '--virtual-time-budget=3000', `--screenshot=${out}`, pathToFileURL(join(cwd, '.claude', 'flow-viewer.html')).href],
  { stdio: 'ignore', timeout: 60000 });
console.log('wrote', out);
rmSync(work, { recursive: true, force: true });
