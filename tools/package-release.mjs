import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { zipSync, strToU8 } from 'fflate';
const root = new URL('../', import.meta.url);
const entries = {};
const { version } = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) throw new Error('Invalid release version');
async function collect(directory, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error(`Release must not include symbolic links: ${prefix}${entry.name}`);
    const path = `${prefix}${entry.name}`;
    const url = new URL(encodeURIComponent(entry.name) + (entry.isDirectory() ? '/' : ''), directory);
    if (entry.isDirectory()) await collect(url, `${path}/`);
    else if (entry.isFile()) entries[path] = new Uint8Array(await readFile(url));
  }
}
await collect(new URL('dist/', root));
if (!entries['index.html'] || !entries['sw.js'] || !entries['THIRD-PARTY-NOTICES.txt']) throw new Error('Build the complete static release first.');
entries['DEPLOYMENT.txt'] = strToU8(`CDDA Workshop ${version} / data 0.I-1\n\nExtract this entire archive to one static hosting directory. Use HTTPS, or serve it on localhost. Do not open index.html as a file URL.\n\nA local example if Python is installed:\n  python -m http.server 4173 --bind 127.0.0.1\nThen open http://127.0.0.1:4173/\n\nClick Prepare offline and wait for the verified READY status before going offline. A first page visit is not sufficient. The host should send Cache-Control: no-cache for index.html and sw.js; publish complete directories atomically.\n\nNo backend is needed. No game save write-back or upload exists. Character templates and blueprint mods are source-reviewed, NOT game-tested. Health reset is limited and opt-in; complex refill preserves unsupported structures. Use backed-up disposable worlds with matching content.\n\nGame data and translations have their own CC BY-SA 3.0 notices under datasets/. Browser dependency licenses are in THIRD-PARTY-NOTICES.txt. Application code has no separate open-source license grant. See docs/acceptance.md for verified checks and remaining limits. Source-code links in the reports refer to the development workspace, which is not included in this static archive.\n`);
for (const path of ['README.md', 'docs/acceptance.md', 'docs/compatibility.md', 'docs/datasets.md', 'docs/todo.sql']) entries[path] = new Uint8Array(await readFile(new URL(path, root)));
await mkdir(new URL('release/', root), { recursive: true });
const name = `cdda-workshop-${version}-static.zip`;
const archive = zipSync(entries, { level: 9 });
const hash = createHash('sha256').update(archive).digest('hex');
await writeFile(new URL(`release/${name}`, root), archive);
await writeFile(new URL(`release/${name}.sha256`, root), `${hash}  ${name}\n`);
console.log(`Static release: release/${name} (${archive.length} bytes; ${Object.keys(entries).length} entries)\nSHA-256: ${hash}`);
