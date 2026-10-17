// Drives a short sample session through the patched hook, opens viewer-prototype.html on the
// events it wrote, from file://, and saves a headless Chrome/Edge screenshot next to this script.
// Usage: node tests/probes/flow-viewer/screenshot.mjs
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildPatchedHook } from './patched-hook.mjs';

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
mkdirSync(join(cwd, '.claude'), { recursive: true });
mkdirSync(join(cwd, 'src'));
writeFileSync(join(cwd, 'src', 'app.js'), 'export const x = 1;\n');
writeFileSync(join(cwd, 'src', 'big.js'), '//\n'.repeat(400));

const p = (rel) => join(cwd, rel);
const SESSION = [
  ['Read', { file_path: p('src/app.js') }],
  ['Bash', { command: 'git status --short' }],
  ['Read', { file_path: p('src/big.js') }],
  ['Read', { file_path: p('src/big.js'), offset: 1, limit: 80 }],
  ['Edit', { file_path: p('src/app.js'), old_string: '1', new_string: '2' }],
  ['Bash', { command: 'npm test' }],
  ['Write', { file_path: p('src/app.js'), content: 'export const x = 3;\n' }],
  ['Write', { file_path: p('src/new.js'), content: 'export {};\n' }],
  ['Read', { file_path: p('node_modules/lodash/index.js') }],
  ['Bash', { command: 'for f in src/*; do cat "$f"; done' }],
  ['Agent', { subagent_type: 'Explore', prompt: 'find callers' }],
  ['Bash', { command: 'git diff --stat' }],
];
for (const [tool_name, tool_input] of SESSION) {
  spawnSync(process.execPath, [flow], { input: JSON.stringify({ tool_name, tool_input, cwd }), encoding: 'utf8' });
}

copyFileSync(join(HERE, 'viewer-prototype.html'), join(cwd, '.claude', 'flow-viewer.html'));
const browser = BROWSERS.find((b) => existsSync(b));
if (!browser) throw new Error('no Chromium browser found');
const out = join(HERE, 'viewer-prototype.png');
execFileSync(browser, ['--headless', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=2', '--window-size=1100,560',
  '--virtual-time-budget=3000', `--screenshot=${out}`, pathToFileURL(join(cwd, '.claude', 'flow-viewer.html')).href],
  { stdio: 'ignore', timeout: 60000 });
console.log('wrote', out);
rmSync(work, { recursive: true, force: true });
