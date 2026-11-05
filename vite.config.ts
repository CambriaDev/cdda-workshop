import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
async function files(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map(e => e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]))).flat();
}
const parserRevision = createHash('sha256').update(['src/domain/data/compose.ts', 'src/i18n/gettext.ts', 'src/workers/data.worker.ts'].map(file => readFileSync(file, 'utf8')).join('\n')).digest('hex');
export default defineConfig({ base: './', define: { 'import.meta.env.VITE_DATA_PARSER_REVISION': JSON.stringify(parserRevision) }, plugins: [react(), {
  name: 'verified-offline-release',
  async closeBundle() {
    const assets = await Promise.all((await files('dist')).filter(p => !p.endsWith('sw.js')).map(async p => {
      const bytes = await readFile(p);
      return { path: path.relative('dist', p).replaceAll('\\', '/'), hash: createHash('sha256').update(bytes).digest('hex'), size: bytes.length };
    }));
    assets.sort((a, b) => a.path.localeCompare(b.path));
    const template = await readFile('tools/offline-worker.js', 'utf8');
    const release = createHash('sha256').update(JSON.stringify(assets)).update(template).digest('hex').slice(0, 20);
    await writeFile('dist/sw.js', template.replace('__RELEASE__', JSON.stringify(release)).replace('__ASSETS__', JSON.stringify(assets)));
  },
}], test: { include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'], environment: 'node' } });
