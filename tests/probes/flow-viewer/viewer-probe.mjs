// Probe for the viewer side of D1: parse+eval cost of flow-events.js by event count, and what a
// single torn last line does to a page that loads the file as a <script> from file://.
// Usage: node tests/probes/flow-viewer/viewer-probe.mjs   (the torn-line case needs Chrome or Edge)
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

const TOOLS = ['Read', 'Write', 'Edit', 'Bash', 'Agent'];
const BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

function eventFile(count, torn) {
  let body = '';
  for (let i = 0; i < count; i++) {
    const deny = i % 7 === 0;
    body += 'flowEvent(' + JSON.stringify({ ts: 1760364151000 + i, tool: TOOLS[i % 5], verdict: deny ? 'deny' : 'allow',
      guard: deny ? 3 : null, code: deny ? 'P5 P9' : null, target: `src/some/path/file-${i}.js`, passed: [7] }) + ');\n';
  }
  return torn ? body + 'flowEvent({"ts":1,"tool":"Ba' : body;
}

function parseCost(count) {
  const src = eventFile(count, false);
  const samples = [];
  for (let k = 0; k < 7; k++) {
    const seen = [];
    const t = performance.now();
    vm.runInNewContext(src, { flowEvent: (e) => seen.push(e) });
    samples.push(performance.now() - t);
  }
  samples.sort((a, b) => a - b);
  return { events: count, kib: Math.round(src.length / 1024), parseEvalMedianMs: +samples[3].toFixed(1) };
}

// Viewer stub: counts the events a script-element load delivers, and the script errors it raised.
const VIEWER = `<!doctype html><meta charset="utf-8"><pre id="out">pending</pre><script>
let n = 0, errors = 0;
window.flowEvent = () => n++;
window.onerror = () => { errors++; };
const s = document.createElement('script');
s.src = './flow-events.js?t=' + Date.now();
s.onload = s.onerror = () => { document.getElementById('out').textContent = JSON.stringify({ events: n, errors }); };
document.head.append(s);
</script>`;

function tornLine(browser) {
  const dir = mkdtempSync(join(tmpdir(), 'flow-viewer-'));
  writeFileSync(join(dir, 'flow-events.js'), eventFile(500, true));
  writeFileSync(join(dir, 'viewer.html'), VIEWER);
  const dom = execFileSync(browser, ['--headless', '--disable-gpu', '--virtual-time-budget=5000', '--dump-dom',
    pathToFileURL(join(dir, 'viewer.html')).href], { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'ignore'] });
  rmSync(dir, { recursive: true, force: true });
  return { browser, linesWritten: 500, ...JSON.parse(dom.match(/<pre id="out">([^<]*)/)[1].replace(/&quot;/g, '"')) };
}

console.log(JSON.stringify({ parseCost: [250, 500, 5000, 50000].map(parseCost) }, null, 1));
const found = BROWSERS.filter((b) => existsSync(b));
if (found.length === 0) console.log('torn-line case skipped: no Chromium browser found');
for (const b of found) console.log(JSON.stringify(tornLine(b)));
