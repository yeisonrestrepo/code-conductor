import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const wf = readFileSync(join(root, '.github', 'workflows', 'publish.yml'), 'utf8');

describe('publish workflow', () => {
  it('triggers on published releases', () => { expect(wf).toMatch(/release:\s*\n\s*types:\s*\[\s*published\s*\]/); });
  it('runs the tests before publishing', () => { expect(wf).toMatch(/vitest run|npm test/); });
  it('publishes with provenance to a public package', () => {
    expect(wf).toMatch(/npm publish[^\n]*--provenance/);
    expect(wf).toMatch(/--access public/);
  });
  it('grants id-token write for OIDC provenance', () => { expect(wf).toMatch(/id-token:\s*write/); });
  it('explicitly declares contents:read so checkout still authorizes when permissions are overridden', () => {
    expect(wf).toMatch(/contents:\s*read/);
  });
  it('pins ubuntu-latest and the protected environment', () => {
    expect(wf).toMatch(/runs-on:\s*ubuntu-latest/);
    expect(wf).toMatch(/environment:\s*npm-publish/);
  });
  it('authenticates with the NPM_TOKEN secret via NODE_AUTH_TOKEN', () => {
    expect(wf).toMatch(/NODE_AUTH_TOKEN:\s*\$\{\{\s*secrets\.NPM_TOKEN\s*\}\}/);
  });
  it('guards version==tag and blocks a duplicate publish before publishing', () => {
    expect(wf).toMatch(/release\.tag_name/);
    expect(wf).toMatch(/npm view "code-conductor@/);
  });
});
