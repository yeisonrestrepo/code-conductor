// Builds a throwaway copy of the shipped pre-tool-use hook with a candidate emitter spliced into
// main(), so the probes measure the real hook. The shipped hook is never modified.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const SHIPPED_HOOK = join(ROOT, 'project-template', '.claude', 'hooks', 'pre-tool-use.mjs');

// Differs from D7 on purpose: rotation takes a 'wx' lock file and cleans up its temp file,
// the mitigation the append-race probe argues for.
const EMITTER = `
import { appendFileSync as flowAppend, openSync as flowOpen, closeSync as flowClose, unlinkSync as flowUnlink, writeFileSync as flowWrite, renameSync as flowRename, readSync as flowRead } from 'node:fs';
const GUARD_NUMBER = new Map([[guard1LargeRead, 1], [guard2DuplicateWrite, 2], [guard3BashScan, 3], [guard4BlockedRead, 4], [guard5BandScope, 5], [guard6OrchestratorRun, 6], [guard7RoleShell, 7]]);
const FLOW_MAX = Number(process.env.CC_FLOW_MAX || 163840);
function flowTarget(name, input, payload) {
  // Leading VAR=value assignments are skipped: "TOKEN=sk-... curl" must record "curl", never the token.
  if (name === 'Bash') return String(input.command || '').trim().split(/\\s+/).find((w) => w && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) || '';
  if (name === 'Agent' || name === 'SendMessage') return String(input.subagent_type || input.to || '');
  const p = String(input.file_path || input.path || '');
  return payload.cwd && isAbsolute(p) ? relative(payload.cwd, p) : p;
}
// A lock older than this belongs to a hook that died mid-rotation; without the cutoff the file grows forever.
const FLOW_LOCK_STALE_MS = 10000;
function takeFlowLock(lock) {
  try { return flowOpen(lock, 'wx'); } catch {}
  try { if (Date.now() - statSync(lock).mtimeMs < FLOW_LOCK_STALE_MS) return null; flowUnlink(lock); return flowOpen(lock, 'wx'); }
  catch { return null; }
}
function isFlowLine(line) {
  if (!line.startsWith('flowEvent(') || !line.endsWith(');')) return false;
  try { JSON.parse(line.slice(10, -2)); return true; } catch { return false; }
}
// True when the file does not end in a newline: a torn tail that the next append would fuse onto.
function flowTailTorn(path, size) {
  if (!size) return false;
  const fd = flowOpen(path, 'r');
  try { const b = Buffer.alloc(1); flowRead(fd, b, 0, 1, size - 1); return b[0] !== 10; } finally { flowClose(fd); }
}
function rotateFlowEvents(path) {
  const lock = path + '.lock';
  const fd = takeFlowLock(lock);
  if (fd === null) return;
  const tmp = path + '.' + process.pid + '.tmp';
  try {
    // Rotation also repairs: unparseable lines are dropped, so one torn write cannot blind the viewer for good.
    const lines = readFileSync(path, 'utf8').split('\\n').filter(isFlowLine);
    flowWrite(tmp, lines.slice(-250).join('\\n') + '\\n');
    flowRename(tmp, path);
  } catch (e) { try { flowUnlink(tmp); } catch {} debug('flow rotate: ' + e.message); }
  finally { flowClose(fd); try { flowUnlink(lock); } catch {} }
}
function flowCode(verdict, reason) {
  if (verdict === 'allow') return null;
  return (reason.match(/Pattern ids: ([A-Z0-9 ]+)/)?.[1] || reason.match(/\\b[A-Z][A-Z0-9_]{5,}\\b/)?.[0] || '').slice(0, 80);
}
function recordFlowEvent(payload, decision, passed, guard) {
  try {
    if (process.env.CC_FLOW_OFF || !payload.cwd) return;
    const dir = join(payload.cwd, '.claude');
    if (!existsSync(dir)) return;
    const path = join(dir, 'flow-events.js');
    const input = (payload.tool_input && typeof payload.tool_input === 'object') ? payload.tool_input : {};
    const verdict = decision ? (decision.permissionDecision || 'allow') : 'allow';
    const ev = { ts: Date.now(), tool: payload.tool_name, verdict, guard: verdict === 'allow' ? null : guard,
      code: flowCode(verdict, String(decision?.permissionDecisionReason || '')),
      target: flowTarget(payload.tool_name, input, payload).slice(0, 200), passed };
    const size = statSync(path, { throwIfNoEntry: false })?.size || 0;
    if (size > FLOW_MAX || flowTailTorn(path, size)) rotateFlowEvents(path);
    flowAppend(path, 'flowEvent(' + JSON.stringify(ev) + ');\\n');
  } catch (e) { debug('flow event: ' + e.message); }
}
`;

const OLD_LOOP = `  for (const guard of guards) {
    const decision = guard(input, payload);
    if (decision) { emit(decision); return; }
  }
  if (warning) emit(null);
}`;

const NEW_LOOP = `  const passed = [];
  for (const guard of guards) {
    const decision = guard(input, payload);
    if (decision) { emit(decision); recordFlowEvent(payload, decision, passed, GUARD_NUMBER.get(guard)); return; }
    passed.push(GUARD_NUMBER.get(guard));
  }
  if (warning) emit(null);
  recordFlowEvent(payload, null, passed, null);
}`;

// Writes hook-base.mjs (shipped bytes) and hook-flow.mjs (with emitter) into outDir.
export function buildPatchedHook(outDir) {
  const shipped = readFileSync(SHIPPED_HOOK, 'utf8');
  const src = shipped.replace(/\r\n/g, '\n');
  if (!src.includes(OLD_LOOP)) throw new Error('main() loop not found: the shipped hook changed, update this probe');
  const patched = src.replace(OLD_LOOP, NEW_LOOP).replace('\nfunction main() {', EMITTER + '\nfunction main() {');
  const base = join(outDir, 'hook-base.mjs'), flow = join(outDir, 'hook-flow.mjs');
  writeFileSync(base, shipped);
  writeFileSync(flow, patched);
  return { base, flow, baseLines: src.split('\n').length, flowLines: patched.split('\n').length };
}
