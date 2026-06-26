#!/usr/bin/env node
// tests/scripts/_fill_helper.js
// Test-only helper: implements the same fill logic as _fill_claude_md in install.sh
// Usage: node _fill_helper.js <md_path> <json_string>
'use strict';
const fs = require('fs');
const [, , mdPath, jsonArg] = process.argv;
let d;
try {
  // Accept either a raw JSON string (starts with '{') or a path to a .json file
  const src = jsonArg && jsonArg.trimStart().startsWith('{')
    ? jsonArg
    : fs.readFileSync(jsonArg, 'utf8');
  d = JSON.parse(src || '{}');
} catch { process.exit(0); }
const FIELDS = {
  name:'Name', description:'Description', stack:'Stack',
  build:'Build', test:'Test', lint:'Lint', format:'Format', setup:'Setup'
};
let content;
try { content = fs.readFileSync(mdPath, 'utf8').replace(/^﻿/, ''); } catch { process.exit(0); }
for (const [key, label] of Object.entries(FIELDS)) {
  const val = d[key];
  if (typeof val !== 'string' || !val.trim()) continue;
  const clean = val.trim().replace(/\r?\n/g, ' ').replace(/\\[ntr]/g, ' ');
  const re = new RegExp('^(\\s*-?\\s*' + label + ':)\\s*(<[^>]*>)?\\s*(\\r?)$', 'im');
  if (!re.test(content)) continue;
  content = content.replace(re, '$1 ' + clean.replace(/\$/g, '$$') + '$3');
}
const tmp = mdPath + '.tmp.' + process.pid;
fs.writeFileSync(tmp, content, 'utf8');
try { fs.renameSync(tmp, mdPath); } catch {
  fs.writeFileSync(mdPath, content, 'utf8');
  try { fs.unlinkSync(tmp); } catch {}
}
