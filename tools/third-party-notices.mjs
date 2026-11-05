import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
const packages = ['react', 'react-dom', 'scheduler', 'fflate', 'lucide-react'];
const sections = ['THIRD-PARTY SOFTWARE NOTICES\n\nThese notices cover software included in the browser bundles. Game data, translations and mod licenses are documented separately under datasets/. No private save content is distributed.'];
for (const name of packages) {
  const manifest = JSON.parse(await readFile(new URL(`node_modules/${name}/package.json`, root), 'utf8'));
  const license = await readFile(new URL(`node_modules/${name}/LICENSE`, root), 'utf8');
  sections.push(`${'='.repeat(72)}\n${name} ${manifest.version}\nLicense: ${manifest.license ?? 'See below'}\n${'='.repeat(72)}\n${license.trim()}`);
}
const destination = new URL('public/THIRD-PARTY-NOTICES.txt', root);
await writeFile(destination, sections.join('\n\n') + '\n');
console.log(`Wrote ${packages.length} dependency notices: ${fileURLToPath(destination)}`);
