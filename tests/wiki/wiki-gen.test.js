import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateWiki, listPages, readFrontmatter, BLOCKS, PAGES_DIR } from '../../.github/wiki/wiki-gen.mjs';
import { CAPS, V3_CAPS } from '../../scripts/snap-contract.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(ROOT, '.github/wiki/wiki-gen.mjs');
const EXPECTED_PAGES = [
  'Architecture-Overview', 'Band-Roles-and-Agents', 'C4-Components', 'Commands-Reference', 'Contributing', 'FAQ',
  'Getting-Started', 'Guards-Reference', 'Home', 'Memory-Architecture', 'Orchestrator-Guide',
  'SNAP-Protocol', 'Skills', '_Sidebar',
];

let tmp;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'cc-wiki-')); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

const write = (path, text) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); };
const mdNames = (dir) => readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)).sort();

// A minimal project: one page per block, and one source for each block to read.
function fixture(pages = {}) {
  const root = join(tmp, 'project');
  write(join(root, 'scripts/snap-contract.mjs'), "export const CAPS = { 'ops.n': [3, 200] };\nexport const V3_CAPS = { 'ops.scope': [20, 300] };\n");
  write(join(root, 'skills/alpha/SKILL.md'), '---\nname: alpha\ndescription: "First | skill costs $1"\n---\nbody\n');
  write(join(root, '.claude/agents/qa.md'), '---\nname: qa\ntools: Read, Bash\n---\nbody\n');
  const all = { Home: '# Home\n', Caps: '# Caps\n\n<!-- wiki-gen:snap-caps -->\n', ...pages };
  for (const [name, text] of Object.entries(all)) write(join(root, PAGES_DIR, `${name}.md`), text);
  return root;
}

describe('generateWiki on this repository', () => {
  it('[AC-6] writes the 13 pages and the sidebar', async () => {
    const out = join(tmp, 'out');
    expect(await generateWiki({ outDir: out, projectRoot: ROOT })).toEqual(EXPECTED_PAGES);
    expect(mdNames(out)).toEqual(EXPECTED_PAGES);
  });

  it('leaves no marker behind, and uses every block it defines', async () => {
    const out = join(tmp, 'out');
    await generateWiki({ outDir: out, projectRoot: ROOT });
    const built = EXPECTED_PAGES.map((p) => readFileSync(join(out, `${p}.md`), 'utf8')).join('\n');
    expect(built).not.toContain('<!-- wiki-gen:');
    const templates = EXPECTED_PAGES.map((p) => readFileSync(join(ROOT, PAGES_DIR, `${p}.md`), 'utf8')).join('\n');
    expect(Object.keys(BLOCKS).filter((b) => !templates.includes(`<!-- wiki-gen:${b} -->`))).toEqual([]);
  });

  it('reads the SNAP caps from the contract, not from prose', async () => {
    const out = join(tmp, 'out');
    await generateWiki({ outDir: out, projectRoot: ROOT, pages: ['SNAP-Protocol'] });
    const page = readFileSync(join(out, 'SNAP-Protocol.md'), 'utf8');
    for (const [field, [count, chars]] of Object.entries({ ...CAPS, ...V3_CAPS })) {
      expect(page).toContain(`| \`${field}\` | ${count} | ${chars} |`);
    }
  });

  it('lists every skill and every agent that exists', async () => {
    const out = join(tmp, 'out');
    await generateWiki({ outDir: out, projectRoot: ROOT, pages: ['Skills', 'Band-Roles-and-Agents'] });
    const skills = readFileSync(join(out, 'Skills.md'), 'utf8');
    for (const dir of readdirSync(join(ROOT, 'skills'))) expect(skills).toContain(`| \`${dir}\` |`);
    const agents = readFileSync(join(out, 'Band-Roles-and-Agents.md'), 'utf8');
    for (const file of readdirSync(join(ROOT, '.claude/agents'))) expect(agents).toContain(`| \`${file}\` |`);
  });
});

// The prose in a template is hand-written, so nothing regenerates it. These fail the PR
// that adds a command, a skill or a page without saying so in the wiki.
describe('template drift', () => {
  const page = (name) => readFileSync(join(ROOT, PAGES_DIR, `${name}.md`), 'utf8').replace(/\r\n/g, '\n');

  it('names every shipped command in Commands-Reference', () => {
    const dirs = ['global/commands', 'project-template/.claude/commands'];
    const commands = dirs.flatMap((d) => mdNames(join(ROOT, d))).map((n) => `/${n}`);
    expect(commands.length).toBeGreaterThan(0);
    expect(commands.filter((c) => !page('Commands-Reference').includes(`\`${c}`))).toEqual([]);
  });

  it('gives every skill a heading in Skills', () => {
    const skills = readdirSync(join(ROOT, 'skills'));
    expect(skills.filter((s) => !page('Skills').includes(`### ${s}\n`))).toEqual([]);
  });

  it('links every page from the sidebar and from Home', () => {
    const linked = listPages(ROOT).filter((p) => p !== 'Home' && p !== '_Sidebar');
    expect(linked.filter((p) => !page('_Sidebar').includes(`](${p})`))).toEqual([]);
    expect(linked.filter((p) => !page('Home').includes(`](${p})`))).toEqual([]);
  });
});

describe('generateWiki on a fixture', () => {
  it('fills a block from its source, escaping a pipe and keeping a dollar literal', async () => {
    const root = fixture({ Skills: '<!-- wiki-gen:skills-index -->\n', Agents: '<!-- wiki-gen:agent-tools -->\n' });
    const out = join(tmp, 'out');
    await generateWiki({ outDir: out, projectRoot: root });
    expect(readFileSync(join(out, 'Caps.md'), 'utf8')).toBe(
      '# Caps\n\n| Field | Max entries | Max chars per entry |\n|---|---|---|\n| `ops.n` | 3 | 200 |\n| `ops.scope` | 20 | 300 |\n');
    expect(readFileSync(join(out, 'Skills.md'), 'utf8')).toContain('| `alpha` | First \\| skill costs $1 |');
    expect(readFileSync(join(out, 'Agents.md'), 'utf8')).toContain('| `qa.md` | Read, Bash |');
  });

  it('generates only the pages asked for, and refuses a page that does not exist', async () => {
    const root = fixture();
    const out = join(tmp, 'out');
    expect(await generateWiki({ outDir: out, projectRoot: root, pages: ['Home'] })).toEqual(['Home']);
    expect(mdNames(out)).toEqual(['Home']);
    await expect(generateWiki({ outDir: out, projectRoot: root, pages: ['Nope'] })).rejects.toThrow('no such page: Nope');
  });

  it('publishes LF from a CRLF template', async () => {
    const root = fixture({ Win: '# Win\r\n\r\n<!-- wiki-gen:snap-caps -->\r\n' });
    const out = join(tmp, 'out');
    await generateWiki({ outDir: out, projectRoot: root });
    const text = readFileSync(join(out, 'Win.md'), 'utf8');
    expect(text).not.toContain('\r');
    expect(text).toContain('| `ops.n` | 3 | 200 |');
  });

  it('writes nothing at all when one page names an unknown block', async () => {
    const root = fixture({ Zed: '<!-- wiki-gen:no-such-block -->\n' });
    const out = join(tmp, 'out');
    await expect(generateWiki({ outDir: out, projectRoot: root })).rejects.toThrow('Zed: unknown block "no-such-block"');
    expect(existsSync(out)).toBe(false);
  });

  it('writes nothing when a source has no frontmatter, and names the file', async () => {
    const root = fixture({ Skills: '<!-- wiki-gen:skills-index -->\n' });
    write(join(root, 'skills/beta/SKILL.md'), 'no frontmatter here\n');
    const out = join(tmp, 'out');
    await expect(generateWiki({ outDir: out, projectRoot: root })).rejects.toThrow(/beta.*no frontmatter block/);
    expect(existsSync(out)).toBe(false);
  });

  it('refuses a source whose frontmatter lacks the field the table needs', async () => {
    const root = fixture({ Agents: '<!-- wiki-gen:agent-tools -->\n' });
    write(join(root, '.claude/agents/bare.md'), '---\nname: bare\n---\n');
    await expect(generateWiki({ outDir: join(tmp, 'out'), projectRoot: root })).rejects.toThrow(/bare\.md.*no "tools"/);
  });

  it('reads quoted and unquoted frontmatter values alike', () => {
    const root = fixture();
    expect(readFrontmatter(join(root, 'skills/alpha/SKILL.md')).name).toBe('alpha');
    expect(readFrontmatter(join(root, '.claude/agents/qa.md')).tools).toBe('Read, Bash');
  });
});

describe('the CLI', () => {
  const run = (cwd, args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' });

  it('writes the pages and exits 0', () => {
    const r = run(fixture(), ['--out', 'wiki-out']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('wrote 2 pages');
  });

  it('exits 1 with the reason and no output directory when generation fails', () => {
    const root = fixture({ Zed: '<!-- wiki-gen:no-such-block -->\n' });
    const r = run(root, ['--out', 'wiki-out']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('nothing written, Zed: unknown block "no-such-block"');
    expect(existsSync(join(root, 'wiki-out'))).toBe(false);
  });

  it('exits 2 on a missing --out', () => {
    expect(run(fixture(), []).status).toBe(2);
  });
});

describe('wiki-sync.yml', () => {
  const workflow = readFileSync(join(ROOT, '.github/workflows/wiki-sync.yml'), 'utf8').replace(/\r\n/g, '\n');

  it('[AC-5] uses only actions/checkout and actions/setup-node', () => {
    const used = [...workflow.matchAll(/uses:\s*(\S+)@/g)].map((m) => m[1]).sort();
    expect(used).toEqual(['actions/checkout', 'actions/setup-node']);
  });

  it('[AC-3] is fail-open, and runs on pushes to main only', () => {
    expect(workflow).toContain('continue-on-error: true');
    expect(workflow).toContain('branches: [main]');
    expect(workflow).not.toContain('pull_request');
  });

  it('[AC-1] [AC-7] triggers on every source the generator reads, and only through a path filter', () => {
    const paths = ["'.github/wiki/**'", "'scripts/snap-contract.mjs'", "'skills/*/SKILL.md'", "'.claude/agents/*.md'"];
    expect(paths.filter((p) => !workflow.includes(`- ${p}`))).toEqual([]);
    expect(workflow).toMatch(/^ {4}paths:$/m);
  });

  it('[AC-4] denies every token scope but contents:write, and never runs on a fork', () => {
    expect(workflow).toMatch(/^permissions: \{\}$/m);
    // Every scope granted anywhere in the file: the job block must be the only grant.
    const grants = [...workflow.matchAll(/^ +permissions:\n((?: {6}\S.*\n)+)/gm)].map((m) => m[1].trim());
    expect(grants).toEqual(['contents: write']);
    expect(workflow).toContain("if: github.repository == 'yeisonrestrepo/code-conductor'");
  });

  it('removes the wiki pages before copying, so a deleted template is deleted from the wiki', () => {
    const remove = workflow.indexOf('rm -f wiki-repo/*.md');
    expect(remove).toBeGreaterThan(workflow.indexOf('git clone'));
    expect(remove).toBeLessThan(workflow.indexOf('cp wiki-out/*.md wiki-repo/'));
    expect(workflow).toContain('git add -A');
  });
});
