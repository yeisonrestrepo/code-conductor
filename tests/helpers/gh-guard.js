// BUG-059 vitest setup file. Arms the gh intercept in this worker and, through NODE_OPTIONS, in
// every node child it spawns. Then the suspenders: whatever the preload cannot see (a shell
// string, a script) meets a gh with no credentials, which exits 4 before any request.
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GH_HOOK } from './fake-gh.js';
import './gh-intercept.mjs';

const options = process.env.NODE_OPTIONS ?? '';
if (!options.includes(GH_HOOK)) process.env.NODE_OPTIONS = `${options} ${GH_HOOK}`.trim();

const emptyConfig = join(tmpdir(), 'cc-gh-guard-empty-config');
mkdirSync(emptyConfig, { recursive: true });
process.env.GH_CONFIG_DIR = emptyConfig;
// Deleted, not set to a dummy: gh treats any token as a login and sends the request.
for (const key of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN']) delete process.env[key];
