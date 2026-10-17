// A short, realistic session driven through the patched hook: allows, denies from guards 1, 3
// and 4, and an ask from guard 2. Shared by the screenshot and edge-case probes.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function runSampleSession(flowHook, cwd) {
  mkdirSync(join(cwd, '.claude'), { recursive: true });
  mkdirSync(join(cwd, 'src'), { recursive: true });
  writeFileSync(join(cwd, 'src', 'app.js'), 'export const x = 1;\n');
  writeFileSync(join(cwd, 'src', 'big.js'), '//\n'.repeat(400));
  const p = (rel) => join(cwd, rel);
  const session = [
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
  for (const [tool_name, tool_input] of session) {
    spawnSync(process.execPath, [flowHook], { input: JSON.stringify({ tool_name, tool_input, cwd }), encoding: 'utf8' });
  }
}
