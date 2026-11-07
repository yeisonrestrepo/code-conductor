// Probes once per run. Each test file loads tests/helpers/bash.js in its own worker, so
// probing there cost one probe per file, with a 10 s timeout each on a slow WSL start.
import { probeBash } from './bash-probe.js';

export default function setup({ provide }) {
  const bash = probeBash();
  if (!bash) {
    console.warn('[bash] no bash can run a script by its native path (on Windows, install Git for Windows); bash suites are skipped.');
  }
  provide('bash', bash);
}
