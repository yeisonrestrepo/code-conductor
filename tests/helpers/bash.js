// The bash the suites run hooks with. The global setup (bash-setup.js) probes once per run
// and provides the result; null means no bash qualified. A run without that setup (a
// different config) gets undefined and probes here instead.
import { inject } from 'vitest';
import { probeBash } from './bash-probe.js';

export { findBash, gitForWindowsBash } from './bash-probe.js';

const provided = inject('bash');
export const BASH = provided === undefined ? probeBash() : provided;
