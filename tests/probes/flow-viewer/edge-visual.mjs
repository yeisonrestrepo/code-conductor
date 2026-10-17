// Visual edge cases for the HTML viewer and the CLI view, captured over the Chrome DevTools
// Protocol so the event file can change between polls. Writes PNGs to ./shots/.
// Usage: node tests/probes/flow-viewer/edge-visual.mjs
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildPatchedHook } from './patched-hook.mjs';
import { runSampleSession } from './sample-session.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(HERE, 'shots');
const PORT = 9333;
const BROWSERS = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const line = (e) => 'flowEvent(' + JSON.stringify(e) + ');\n';

async function connect() {
  for (let i = 0; i < 50; i++) {
    try { const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const page = list.find((t) => t.type === 'page'); if (page) return page.webSocketDebuggerUrl; } catch {}
    await sleep(200);
  }
  throw new Error('browser did not expose a page');
}

function cdpClient(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => { const msg = JSON.parse(m.data); pending.get(msg.id)?.(msg); pending.delete(msg.id); };
  const send = (method, params = {}) => new Promise((resolve) => { pending.set(++id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  return new Promise((resolve) => { ws.onopen = () => resolve({ send, close: () => ws.close() }); });
}

async function shoot(cdp, name, width, height) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: width < 600 });
  await sleep(300);
  const { result } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(join(SHOTS, name + '.png'), Buffer.from(result.data, 'base64'));
  console.log('shot', name);
}

async function open(cdp, dir, width = 1400, height = 760) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: width < 600 });
  await cdp.send('Page.navigate', { url: pathToFileURL(join(dir, '.claude', 'flow-viewer.html')).href });
  await sleep(1800);
}

function scenarioDir(work, name) {
  const dir = join(work, name);
  mkdirSync(join(dir, '.claude'), { recursive: true });
  copyFileSync(join(HERE, 'viewer-prototype.html'), join(dir, '.claude', 'flow-viewer.html'));
  return dir;
}

// Synthetic band-run events: guards 5-7 only decide inside an orchestrated run, which the sample session has no envelope for.
function bandEvents() {
  const t = Date.now() - 60000;
  return [
    { ts: t, tool: 'Write', verdict: 'deny', guard: 5, code: 'BAND_SCOPE_VIOLATION', target: 'lib/installer/deploy.mjs', passed: [] },
    { ts: t + 1000, tool: 'Edit', verdict: 'allow', guard: null, code: null, target: 'src/feature.js', passed: [5, 6] },
    { ts: t + 2000, tool: 'Agent', verdict: 'deny', guard: 6, code: 'ORCH_NESTED_DISPATCH', target: 'general-purpose', passed: [] },
    { ts: t + 3000, tool: 'Bash', verdict: 'deny', guard: 7, code: 'ROLE_SHELL_NOT_ALLOWED', target: 'rm', passed: [] },
    { ts: t + 4000, tool: 'Bash', verdict: 'allow', guard: null, code: null, target: 'npx', passed: [7, 3] },
    { ts: t + 5000, tool: 'Write', verdict: 'deny', guard: 6, code: 'ORCH_RUN_LIVE', target: 'docs/plan.md', passed: [5] },
  ].map(line).join('');
}

function volumeEvents(n) {
  const tools = [['Read', [4, 1]], ['Bash', [7, 3]], ['Edit', [5, 6]], ['Write', [5, 6, 2]]];
  let out = '';
  for (let i = 0; i < n; i++) {
    const [tool, guards] = tools[i % 4];
    const deny = i % 9 === 0, decider = guards[guards.length - 1];
    out += line({ ts: Date.now() - (n - i) * 500, tool, verdict: deny ? 'deny' : 'allow', guard: deny ? decider : null,
      code: deny ? 'P5 P9' : null, target: `src/module-${i % 37}/file-${i}.js`, passed: deny ? guards.slice(0, -1) : guards });
  }
  return out;
}

async function htmlScenarios(cdp, work, flowHook) {
  const normal = scenarioDir(work, 'normal');
  runSampleSession(flowHook, normal);
  await open(cdp, normal); await shoot(cdp, '01-normal-session', 1400, 760);

  const empty = scenarioDir(work, 'empty');
  await open(cdp, empty); await shoot(cdp, '02-empty-no-events', 1400, 760);

  const torn = scenarioDir(work, 'torn');
  runSampleSession(flowHook, torn);
  await open(cdp, torn);
  const events = join(torn, '.claude', 'flow-events.js');
  writeFileSync(events, readFileSync(events, 'utf8') + 'flowEvent({"ts":1,"tool":"Ba');
  await sleep(2000); await shoot(cdp, '03-torn-line-keeps-last-state', 1400, 760);

  const xss = scenarioDir(work, 'xss');
  for (const sub of ['<img src=x onerror=alert(1)>', '</script><b>bold?</b>', '"quoted"\nnewline']) {
    execFileSync(process.execPath, [flowHook], { input: JSON.stringify({ tool_name: 'Agent', tool_input: { subagent_type: sub, prompt: 'x' }, cwd: xss }) });
  }
  await open(cdp, xss); await shoot(cdp, '04-hostile-targets-render-as-text', 1400, 760);

  const band = scenarioDir(work, 'band');
  writeFileSync(join(band, '.claude', 'flow-events.js'), bandEvents());
  await open(cdp, band); await shoot(cdp, '05-band-run-guards-5-6-7', 1400, 760);

  const volume = scenarioDir(work, 'volume');
  writeFileSync(join(volume, '.claude', 'flow-events.js'), volumeEvents(5000));
  await open(cdp, volume); await shoot(cdp, '06-volume-5000-events', 1400, 760);

  await open(cdp, normal, 420, 900); await shoot(cdp, '07-narrow-420px', 420, 900);
  return normal;
}

// Renders the CLI's ANSI output in a terminal-styled page so it can be captured like the others.
const ANSI = { 1: 'font-weight:700', 2: 'color:#8a92a3', 31: 'color:#f85149', 32: 'color:#3fb950', 33: 'color:#d29922' };
function terminalPage(text, title) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const body = esc(text).replace(/\x1b\[(\d+)m([\s\S]*?)\x1b\[0m/g, (_, c, s) => `<span style="${ANSI[c] || ''}">${s}</span>`);
  return `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#0c0c0c;color:#d7dbe3;font:14px/1.5 Consolas,ui-monospace,monospace">
<div style="background:#1f1f1f;color:#9aa;padding:6px 12px;font:12px system-ui">${esc(title)}</div><pre style="margin:0;padding:14px 16px">${body}</pre>`;
}

async function cliScenarios(cdp, work, normalDir) {
  const cli = join(HERE, 'flow-cli.mjs');
  const env = { ...process.env, FORCE_COLOR: '1' };
  const run = (...a) => execFileSync(process.execPath, [cli, ...a, normalDir], { encoding: 'utf8', env }).trimEnd();
  const transcript = '\x1b[1m> \x1b[0mrefactor the parser and run the tests\n\n' +
    '\x1b[32m●\x1b[0m Read(src/parser.js)\n  \x1b[2m⎿  Read 120 lines\x1b[0m\n\n\x1b[32m●\x1b[0m Bash(npm test)\n  \x1b[2m⎿  42 passed\x1b[0m\n\n';
  const composer = (band) => `${band}${' '.repeat(4)}\x1b[2m[-]\x1b[0m\n${'─'.repeat(100)}\n\x1b[1m>\x1b[0m \n${'─'.repeat(100)}\n\x1b[2m  ? for shortcuts\x1b[0m`;
  const pages = [
    ['08-cli-band-collapsed', transcript + composer(run('--band')), 'Claude Code (mock-up) — cc-flow band, collapsed (default)', 330],
    ['09-cli-band-expanded', transcript + composer(run('--band', '--expanded')), 'Claude Code (mock-up) — cc-flow band, expanded with e or /cc-flow', 600],
    ['10-cli-cc-flow-full', `$ node flow-cli.mjs\n\n${run()}`, 'Terminal — full view on demand (flow-cli.mjs)', 560],
  ];
  for (const [name, text, title, height] of pages) {
    const file = join(work, name + '.html');
    writeFileSync(file, terminalPage(text, title));
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1180, height, deviceScaleFactor: 2, mobile: false });
    await cdp.send('Page.navigate', { url: pathToFileURL(file).href });
    await sleep(500);
    await shoot(cdp, name, 1180, height);
  }
}

const browser = BROWSERS.find((b) => existsSync(b));
if (!browser) throw new Error('no Chromium browser found');
const work = mkdtempSync(join(tmpdir(), 'flow-visual-'));
mkdirSync(SHOTS, { recursive: true });
const { flow } = buildPatchedHook(work);
const proc = spawn(browser, ['--headless', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${join(work, 'profile')}`, '--allow-file-access-from-files=false', 'about:blank'], { stdio: 'ignore' });
try {
  const cdp = await cdpClient(await connect());
  await cdp.send('Page.enable');
  const normal = await htmlScenarios(cdp, work, flow);
  await cliScenarios(cdp, work, normal);
  cdp.close();
} finally {
  proc.kill();
  await sleep(500);
  rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
