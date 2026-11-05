import { compose, type Composition, type DataPackage, type DatasetManifest } from '../domain/data';
import { loadLocal, saveLocal } from '../storage/local';
import type { Catalog } from '../i18n/gettext';
const loaded = new Map<string, DataPackage>();
self.onmessage = async (event: MessageEvent<{ id: number; manifest: DatasetManifest; enabled: string[]; base: string }>) => {
  const { id, manifest, enabled, base } = event.data;
  try {
    const wanted = new Set(enabled); wanted.add('dda');
    function dependencies(mod: string, visiting = new Set<string>()) {
      if (visiting.has(mod)) throw new Error(`Dependency cycle: ${[...visiting, mod].join(' → ')}`);
      const entry = manifest.packages.find(p => p.id === mod);
      if (!entry?.file || !entry.distributable) throw new Error(`Unavailable package: ${mod}`);
      visiting.add(mod);
      for (const dep of entry.dependencies) { wanted.add(dep); dependencies(dep, new Set(visiting)); }
    }
    for (const mod of enabled) dependencies(mod);
    // Persist only the latest PUBLIC composition, never private save trees.
    // Include parser code, source identity, ordered packages and catalog hashes.
    const cacheKey = JSON.stringify([import.meta.env.VITE_DATA_PARSER_REVISION, manifest.gameVersion, manifest.commit, [...wanted].map(mod => { const entry = manifest.packages.find(p => p.id === mod)!; return [mod, entry.hash, entry.translationHash]; })]);
    const cached = await loadLocal<{ key: string; composition: Composition; catalogs: Record<string, Catalog> }>('public-composition-cache').catch(() => undefined);
    if (cached?.key === cacheKey) { self.postMessage({ id, type: 'result', composition: cached.composition, catalogs: cached.catalogs }); return; }
    const packages: DataPackage[] = [];
    let done = 0;
    for (const mod of wanted) {
      const entry = manifest.packages.find(p => p.id === mod)!;
      if (!entry?.file) throw new Error(`Missing package ${mod}`);
      const key = `${manifest.commit}:${mod}:${entry.hash}`;
      let pack = loaded.get(key);
      if (!pack) {
        const response = await fetch(new URL(entry.file, base));
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${entry.file}`);
        const bytes = await response.arrayBuffer();
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(b => b.toString(16).padStart(2, '0')).join('');
        if (entry.hash && hash !== entry.hash) throw new Error(`Data integrity check failed: ${entry.id}`);
        pack = JSON.parse(new TextDecoder().decode(bytes));
        loaded.set(key, pack!);
      }
      packages.push(pack!);
      self.postMessage({ id, type: 'progress', done: ++done, total: wanted.size });
    }
    const composition = compose(packages, [...wanted]);
    const catalogs: Record<string, Catalog> = {};
    for (const pack of packages) if (pack.translations) catalogs[pack.id] = pack.translations;
    for (const entry of manifest.packages.filter(p => wanted.has(p.id) && p.translationFile)) {
      const response = await fetch(new URL(entry.translationFile!, base));
      if (!response.ok) throw new Error(`Translation unavailable: ${entry.id}`);
      const bytes = await response.arrayBuffer();
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(b => b.toString(16).padStart(2, '0')).join('');
      if (entry.translationHash && hash !== entry.translationHash) throw new Error(`Translation integrity check failed: ${entry.id}`);
      catalogs[entry.id] = JSON.parse(new TextDecoder().decode(bytes));
    }
    await saveLocal('public-composition-cache', { key: cacheKey, composition, catalogs }).catch(() => { /* Cache failure must not prevent editing/export. */ });
    self.postMessage({ id, type: 'result', composition, catalogs });
  } catch (error) { self.postMessage({ id, type: 'error', message: String(error) }); }
};
