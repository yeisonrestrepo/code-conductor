// Antigravity CLI 1.5.15 PreToolUse payloads, recorded live on 2026-11-23 and trimmed to
// the fields the adapter reads. Paths are rebuilt against the test's project directory.
import { join } from 'node:path';

const event = (dir, toolCall) => ({ cwd: dir, hookEventName: 'PreToolUse', workspacePaths: [dir], toolCall });

export const runCommand = (dir, args) =>
  event(dir, { id: 'call_run', name: 'run_command', args: { toolSummary: 'run a command', WaitMsBeforeAsync: 0, BypassSandbox: false, IsDaemon: false, ...args } });

export const readFile = (dir, rel, range = {}) =>
  event(dir, { id: 'call_read', name: 'read_file', args: { Path: join(dir, rel), ...range } });

export const writeFile = (dir, rel) =>
  event(dir, { id: 'call_write', name: 'write_file', args: { Path: join(dir, rel), Content: 'hello\n', toolSummary: 'write a file' } });

export const editFile = (dir, rel) =>
  event(dir, { id: 'call_edit', name: 'edit_file', args: { Path: join(dir, rel), Target: 'hello', Replacement: 'bye', toolSummary: 'edit a file' } });
