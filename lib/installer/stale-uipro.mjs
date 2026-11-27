import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { digestTree } from './file-digests.mjs';

// What `uipro init --ai claude` (uipro-cli 2.2.3, MIT) writes under .claude/skills/ui-ux-pro-max/,
// path -> sha256. Source: https://registry.npmjs.org/uipro-cli/-/uipro-cli-2.2.3.tgz, integrity
// sha512-bqeOGqeZOE2R6sze0XPf13OfKBjjlb2Mz0S5ImIhF+ypnt4ywkw5a60VkN4OU2yApTNDci2+yRDyzYkA4RkIUQ==.
// SKILL.md is the claude platform template rendered over base/skill-content.md and
// quick-reference.md, then assets/data/ and assets/scripts/ copied as they ship (three
// __pycache__ files included). Only digests live here: the third-party files are not copied.
export const UIPRO_CLAUDE_OUTPUT = new Map([
  ['2.2.3', Object.freeze({
    'SKILL.md': '07b87b8998b51b9c234df031e31aa2a85cf86abeaa05efd984c2f66ca7f06d68',
    'data/charts.csv': 'b754c0efffcf54cb889114a9314be1d5af6ceebe65c4c436d713b52018e752c9',
    'data/colors.csv': '4cc0df2785f340b8bd0ace50bd4068dc13a7c4c6fa4d9d2723271244ce904614',
    'data/icons.csv': '351fe61ba45b8146c66de6ea7d67297654639d79a94f537b4d0bad570058c28f',
    'data/landing.csv': '010e1e46db271b94e0af6f18973bea86ddba62feeccd62aeeaa6ed40e2ae2db1',
    'data/products.csv': '5359e3037dcb84e99c792ea13dd44f5b78ab6a53557afb309cf19140512aaf5b',
    'data/react-performance.csv': '904c8afcda229629545912dde0e8ac37503757131f0169f80b016f1f58c4fd3f',
    'data/stacks/astro.csv': 'ad18dae3ab6d148d37d144592df80dc1825b6c9e86d9d2d68fdda77434206a37',
    'data/stacks/flutter.csv': 'e470e6bc2bcd8562667cc764d1e1afb0be0a30ca4dc9ec12fa18b19d46f156bd',
    'data/stacks/html-tailwind.csv': '1f004891dd189f6bc2a7717401e3100244326e7e2f3963a79bf7b2349d85e091',
    'data/stacks/jetpack-compose.csv': '6c8fd4b0391c342c12b0af15610cd5becbeccaef0bbe8dcfc01d928c3195d93e',
    'data/stacks/nextjs.csv': '06a8e8c13bd44696c6ebb4cb6c4d8dea440e3de8cce77616512529ed29258f0c',
    'data/stacks/nuxt-ui.csv': '05d6e74501b2b6a636faed32450622759f49a5bcafad971f5f4e7eba0eb7be71',
    'data/stacks/nuxtjs.csv': 'f7a3f2d9542856d00199f85c6c023b7c284cc698e2e6e12d61afce2edacb24d6',
    'data/stacks/react-native.csv': 'a08ca77fcf6b6d9531982dce465366296013bfcf12d2938ac72ad57cf0c4f085',
    'data/stacks/react.csv': 'b6e3eb0e4c9c01bd00ffb951d5ca224a19d488b4544c75436f48cf92ff12bf45',
    'data/stacks/shadcn.csv': '395c2e415ef6f48a474acccdc8eb2c7258a6ed751a5037ba171a2d8823e02ded',
    'data/stacks/svelte.csv': 'bc8d158994a8bdf412830a9dd5e5a5534edd2f367a6e50e0ebd4d76f592dfa3f',
    'data/stacks/swiftui.csv': 'e87cb9eee208bb753bdab96d4a261c7f830c4317ee90ec098316b248fc32be85',
    'data/stacks/vue.csv': '9b793c3f4eec85f77a758c09322f2b62f3b3ca549bb713ccf0849ef885934395',
    'data/styles.csv': 'ad3c3236134d833bda01a2faf31ddeaaa1dbd5005fa430dec571fa91b26e5fea',
    'data/typography.csv': '64695e05ac335ba534aff396c4ba9241c642f80ea53b424251d2669b71c4772b',
    'data/ui-reasoning.csv': '58fc52fff69f62709f8c7dd460de6f6693699ea820f24287f3301a427c2b554e',
    'data/ux-guidelines.csv': '1870ee048f2a2bdd60709f8f7adf7f3b6dcad560bc005c8b2915a8ac8639820d',
    'data/web-interface.csv': '10bfc24e09a6a15db8309e6ef9b6881e1d4af97dffb7c99418aefb8e30df7d54',
    'scripts/__pycache__/core.cpython-314.pyc': 'f48bad01daeb2f69ad374fcd0ea69e137f4b3d8e2c68489ac1d82054e5a02217',
    'scripts/__pycache__/design_system.cpython-314.pyc': '4bd10a5f5c270d162a7392dc502e3a2b66688d15d0fdfc7ff64076a2d5f4ad61',
    'scripts/__pycache__/search.cpython-314.pyc': '73bde4bb8508dbe8206e7bbc3719bb953f83b2e47b37439d3f607aa670e8d189',
    'scripts/core.py': '5459d1f04eea03dfb913742d0c03edc5065ac67f6227e4807fa87699662588cb',
    'scripts/design_system.py': '4da1d341f3c7749df51b51db4a543a48a427c3c746eb0e9882a1ab86acf3bb54',
    'scripts/search.py': 'a449e57060ef5134e98e62fd11f6e240153afd68c27dab89cbb72a3ce55f1498',
  })],
]);

// sha256 -> era label of a flat ~/.claude/skills/ui-ux-pro-max.md the old shell installers
// wrote. Empty by owner decision: no flat file is removed, every one is named and left.
export const UIPRO_FLAT_HASHES = new Map();

const LEFT_UNKNOWN = (path) => `left ui-ux-pro-max in place (does not match a known install; review and remove it yourself): ${path}`;
const LEFT_ERROR = (code, path) => `left ui-ux-pro-max in place (${code}): ${path}`;
const REMOVED = (label, path) => `removed stale ui-ux-pro-max skill (${label} content): ${path}`;

// A symlink, unreadable or non-regular value never equals a hex digest, so it never matches.
export function matchKnownVersion(digests, known) {
  const keys = Object.keys(digests);
  for (const [version, table] of known) {
    const tableKeys = Object.keys(table);
    if (tableKeys.length === keys.length && tableKeys.every((k) => digests[k] === table[k])) return version;
  }
  return null;
}

function statOrNull(path) {
  try { return lstatSync(path); } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

function sweepProjectCopy(dir, known, rm, report) {
  const stat = statOrNull(dir);
  if (!stat) return;
  if (!stat.isDirectory()) return report.stderr.push(LEFT_UNKNOWN(dir));
  const version = matchKnownVersion(digestTree(dir), known);
  if (!version) return report.stderr.push(LEFT_UNKNOWN(dir));
  rm(dir, { recursive: true, force: false });
  report.stdout.push(REMOVED(`uipro-cli ${version}`, dir));
}

function sweepFlatFile(file, flatHashes, unlink, report) {
  const stat = statOrNull(file);
  if (!stat) return;
  if (!stat.isFile()) return report.stderr.push(LEFT_UNKNOWN(file));
  const label = flatHashes.get(createHash('sha256').update(readFileSync(file)).digest('hex'));
  if (!label) return report.stderr.push(LEFT_UNKNOWN(file));
  unlink(file);
  report.stdout.push(REMOVED(label, file));
}

// Removes only content this repository can prove it knows; everything else stays and is named,
// like the 1.23.3 root-scripts sweep. Never throws: each copy's failure is one report line.
export function sweepStaleUipro({ cwd, home, known = UIPRO_CLAUDE_OUTPUT, flatHashes = UIPRO_FLAT_HASHES, rm = rmSync, unlink = unlinkSync }) {
  const report = { stdout: [], stderr: [] };
  const projectDir = join(cwd, '.claude', 'skills', 'ui-ux-pro-max');
  const flatFile = join(home, '.claude', 'skills', 'ui-ux-pro-max.md');
  const attempts = [
    [projectDir, () => sweepProjectCopy(projectDir, known, rm, report)],
    [flatFile, () => sweepFlatFile(flatFile, flatHashes, unlink, report)],
  ];
  for (const [path, attempt] of attempts) {
    try { attempt(); } catch (e) { report.stderr.push(LEFT_ERROR(e.code ?? e.message, path)); }
  }
  return report;
}
