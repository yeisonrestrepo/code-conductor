// Edge cases for the candidate emitter, run against the patched copy of the real hook.
// Prints one PASS/FAIL line per case; exits 1 if any case fails.
// Usage: node tests/probes/flow-viewer/hook-edge-cases.mjs
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildPatchedHook } from './patched-hook.mjs';

const work = mkdtempSync(join(tmpdir(), 'flow-edge-'));
const hooks = buildPatchedHook(work);
let failures = 0;

function project(name, withClaude = true) {
  const cwd = join(work, name);
  mkdirSync(withClaude ? join(cwd, '.claude') : cwd, { recursive: true });
  return { cwd, events: join(cwd, '.claude', 'flow-events.js') };
}

function run(hook, input, env = {}) {
  return spawnSync(process.execPath, [hook], { input, env: { ...process.env, ...env }, encoding: 'utf8' });
}

function readEvents(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l.slice(10, -2)));
}

function check(name, ok, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

function bash(cwd, command) {
  return JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd });
}

const cases = {
  'CC_FLOW_OFF writes no file'() {
    const p = project('off');
    run(hooks.flow, bash(p.cwd, 'git status'), { CC_FLOW_OFF: '1' });
    check(this.name, !existsSync(p.events));
  },
  'no .claude/ directory: no file and no directory created'() {
    const p = project('bare', false);
    run(hooks.flow, bash(p.cwd, 'git status'));
    check(this.name, !existsSync(join(p.cwd, '.claude')));
  },
  'unparseable payload still fails closed and writes no event'() {
    const p = project('garbage');
    const r = run(hooks.flow, '{not json');
    check(this.name, r.stdout.includes('"deny"') && !existsSync(p.events), `stdout ${r.stdout.length} bytes`);
  },
  'unknown tool writes no event'() {
    const p = project('unknown');
    run(hooks.flow, JSON.stringify({ tool_name: 'NotebookEdit', tool_input: {}, cwd: p.cwd }));
    check(this.name, !existsSync(p.events));
  },
  'payload without cwd writes nothing and still decides'() {
    const r = run(hooks.flow, JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'for f in *; do cat "$f"; done' } }));
    check(this.name, r.stdout.includes('"deny"'));
  },
  'empty Bash command records an empty target'() {
    const p = project('empty');
    run(hooks.flow, bash(p.cwd, '   '));
    const [e] = readEvents(p.events);
    check(this.name, e && e.target === '', JSON.stringify(e && e.target));
  },
  'secret-shaped Bash arguments never reach the file'() {
    const p = project('secret');
    run(hooks.flow, bash(p.cwd, 'TOKEN=sk-PROBE-123 curl -H "Authorization: Bearer sk-PROBE-456" x'));
    const text = readFileSync(p.events, 'utf8');
    check(this.name, !text.includes('sk-PROBE') && !text.includes('Bearer'), JSON.stringify(readEvents(p.events)[0].target));
  },
  // An Agent type, not a path: path.relative rewrites "/" on Windows, which would hide the case.
  'target with </script>, quote and newline round-trips'() {
    const p = project('inject');
    const nasty = 'a</script><img src=x onerror=alert(1)>"\nb';
    run(hooks.flow, JSON.stringify({ tool_name: 'Agent', tool_input: { subagent_type: nasty, prompt: 'x' }, cwd: p.cwd }));
    const raw = readFileSync(p.events, 'utf8');
    const [e] = readEvents(p.events);
    check(this.name, raw.split('\n').filter(Boolean).length === 1 && e.target.includes('</script>') && e.target.includes('\n'));
  },
  'target capped at 200 characters'() {
    const p = project('long');
    run(hooks.flow, bash(p.cwd, 'x'.repeat(5000)));
    const [e] = readEvents(p.events);
    check(this.name, e.target.length === 200, `length ${e.target.length}`);
  },
  'unicode and spaces in paths survive'() {
    const p = project('unicode');
    const file = join(p.cwd, 'carpeta ñandú', 'añadir 日本.md');
    run(hooks.flow, JSON.stringify({ tool_name: 'Write', tool_input: { file_path: file, content: 'x' }, cwd: p.cwd }));
    const [e] = readEvents(p.events);
    check(this.name, e && e.target.includes('ñandú') && e.target.includes('日本'), JSON.stringify(e && e.target));
  },
  'path outside cwd is recorded relative, not absolute'() {
    const p = project('outside');
    run(hooks.flow, JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: join(work, 'elsewhere.js'), old_string: 'a', new_string: 'b' }, cwd: p.cwd }));
    const [e] = readEvents(p.events);
    check(this.name, e && e.target.startsWith('..'), JSON.stringify(e && e.target));
  },
  'event path is a directory: decision unchanged, no crash'() {
    const p = project('dir');
    mkdirSync(p.events);
    const on = run(hooks.flow, bash(p.cwd, 'for f in *; do cat "$f"; done'));
    const off = run(hooks.flow, bash(p.cwd, 'for f in *; do cat "$f"; done'), { CC_FLOW_OFF: '1' });
    check(this.name, on.stdout === off.stdout && on.status === off.status && on.stderr === off.stderr);
  },
  'a torn tail is repaired on the next call, not fused onto'() {
    const p = project('torn');
    writeFileSync(p.events, 'flowEvent({"ts":1,"tool":"Read"});\nflowEvent({"ts":1,"tool":"Ba');
    run(hooks.flow, bash(p.cwd, 'git status'));
    const lines = readFileSync(p.events, 'utf8').split('\n').filter(Boolean);
    let parses = true;
    try { lines.forEach((l) => JSON.parse(l.slice(10, -2))); } catch { parses = false; }
    check(this.name, parses && lines.length === 2, `${lines.length} lines, all parse: ${parses}`);
  },
  'a fresh lock is respected: rotation skipped, the append still lands'() {
    const p = project('fresh');
    writeFileSync(p.events, 'flowEvent({"ts":1});\n'.repeat(2000));
    writeFileSync(p.events + '.lock', '');
    run(hooks.flow, bash(p.cwd, 'git status'), { CC_FLOW_MAX: '1024' });
    const lines = readFileSync(p.events, 'utf8').split('\n').filter(Boolean).length;
    check(this.name, lines === 2001, `${lines} lines`);
  },
  'a stale lock from a dead hook is broken and rotation resumes'() {
    const p = project('stale');
    writeFileSync(p.events, 'flowEvent({"ts":1});\n'.repeat(2000));
    writeFileSync(p.events + '.lock', '');
    const old = new Date(Date.now() - 60000);
    utimesSync(p.events + '.lock', old, old);
    for (let i = 0; i < 3; i++) run(hooks.flow, bash(p.cwd, 'git status'), { CC_FLOW_MAX: '1024' });
    const lines = readFileSync(p.events, 'utf8').split('\n').filter(Boolean).length;
    check(this.name, lines <= 251, `${lines} lines with a stale lock`);
  },
  'rotation leaves no temp or lock files behind'() {
    const p = project('rotate');
    writeFileSync(p.events, 'flowEvent({"ts":1});\n'.repeat(2000));
    run(hooks.flow, bash(p.cwd, 'git status'), { CC_FLOW_MAX: '1024' });
    const extra = readdirSync(join(p.cwd, '.claude')).filter((f) => f !== 'flow-events.js');
    const lines = readFileSync(p.events, 'utf8').split('\n').filter(Boolean).length;
    check(this.name, extra.length === 0 && lines === 251, `${lines} lines, extra: ${extra.join(',') || 'none'}`);
  },
};

for (const [name, fn] of Object.entries(cases)) fn.call({ name });
rmSync(work, { recursive: true, force: true });
console.log(failures ? `\n${failures} failing` : '\nall cases pass');
process.exitCode = failures ? 1 : 0;
