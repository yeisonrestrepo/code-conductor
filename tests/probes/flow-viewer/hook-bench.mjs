// Probe for the emitter's cost, fail-open behavior, secret handling and locked rotation,
// run against the real hook. Measures; does not assert.
// Usage: node tests/probes/flow-viewer/hook-bench.mjs
import { spawnSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildPatchedHook } from './patched-hook.mjs';

const work = mkdtempSync(join(tmpdir(), 'flow-hook-'));
const hooks = buildPatchedHook(work);
const cwd = join(work, 'project');
mkdirSync(join(cwd, '.claude'), { recursive: true });
writeFileSync(join(cwd, 'small.txt'), 'hi\n');
writeFileSync(join(cwd, 'exists.txt'), 'x\n');
const EVENTS = join(cwd, '.claude', 'flow-events.js');

const PAYLOADS = {
  readAllow: { tool_name: 'Read', tool_input: { file_path: join(cwd, 'small.txt') } },
  bashAllow: { tool_name: 'Bash', tool_input: { command: 'git status --short' } },
  bashDeny: { tool_name: 'Bash', tool_input: { command: 'for f in *; do cat "$f"; done' } },
  writeAsk: { tool_name: 'Write', tool_input: { file_path: join(cwd, 'exists.txt'), content: 'y' } },
  secret: { tool_name: 'Bash', tool_input: { command: 'curl -H "Authorization: Bearer sk-PROBE-NOT-A-SECRET" https://example.invalid' } },
};

const run = (hook, payload, env = {}) => spawnSync(process.execPath, [hook],
  { input: JSON.stringify({ ...payload, cwd }), env: { ...process.env, ...env }, encoding: 'utf8' });
const pct = (a, q) => +a.slice().sort((x, y) => x - y)[Math.floor(q * (a.length - 1))].toFixed(1);
const timed = (fn) => { const t = performance.now(); fn(); return performance.now() - t; };

// Interleaved so machine noise lands on both columns equally.
function latency(samples = 40) {
  const out = {};
  for (const [name, p] of Object.entries(PAYLOADS)) {
    const base = [], flow = [];
    for (let i = 0; i < samples; i++) { base.push(timed(() => run(hooks.base, p))); flow.push(timed(() => run(hooks.flow, p))); }
    out[name] = { baseP50: pct(base, 0.5), flowP50: pct(flow, 0.5), baseP95: pct(base, 0.95), flowP95: pct(flow, 0.95) };
  }
  return out;
}

function events() {
  rmSync(EVENTS, { force: true });
  for (const p of Object.values(PAYLOADS)) run(hooks.flow, p);
  const text = readFileSync(EVENTS, 'utf8');
  return { events: text.trim().split('\n').map((l) => JSON.parse(l.slice(10, -2))), secretLeaked: text.includes('sk-PROBE') };
}

// AC2: with the event path occupied by a directory, output must match a CC_FLOW_OFF run byte for byte.
function failOpen() {
  rmSync(EVENTS, { force: true });
  mkdirSync(EVENTS);
  const out = {};
  for (const name of ['readAllow', 'bashDeny', 'writeAsk']) {
    const on = run(hooks.flow, PAYLOADS[name]), off = run(hooks.flow, PAYLOADS[name], { CC_FLOW_OFF: '1' });
    out[name] = on.stdout === off.stdout && on.stderr === off.stderr && on.status === off.status;
  }
  rmSync(EVENTS, { recursive: true, force: true });
  return out;
}

function spawnHook(env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [hooks.flow], { env: { ...process.env, ...env } });
    child.on('close', resolve);
    child.stdin.end(JSON.stringify({ ...PAYLOADS.bashAllow, cwd }));
  });
}

async function concurrent(procs, each, cap) {
  rmSync(EVENTS, { force: true });
  const t0 = performance.now();
  await Promise.all(Array.from({ length: procs }, async () => {
    for (let i = 0; i < each; i++) await spawnHook({ CC_FLOW_MAX: String(cap) });
  }));
  const ms = performance.now() - t0;
  const lines = readFileSync(EVENTS, 'utf8').split('\n').filter(Boolean);
  let torn = 0;
  for (const l of lines) { try { JSON.parse(l.slice(10, -2)); } catch { torn++; } }
  return { calls: procs * each, cap, linesInFile: lines.length, torn,
    leftovers: readdirSync(join(cwd, '.claude')).filter((f) => f !== 'flow-events.js'),
    perCallMsUnderContention: +((ms / each)).toFixed(1) };
}

const report = {
  hookLines: { shipped: hooks.baseLines, withEmitter: hooks.flowLines },
  latencyMs: latency(),
  events: events(),
  failOpenIdentical: failOpen(),
  lockedRotation: [await concurrent(16, 60, 16384), await concurrent(16, 60, 163840)],
};
console.log(JSON.stringify(report, null, 1));
rmSync(work, { recursive: true, force: true });
