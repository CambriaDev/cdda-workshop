import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { compose, type DataPackage, type DatasetManifest } from '../src/domain/data';
import { buildVehicleLibrary } from '../src/domain/vehicle/library';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataset = path.join(project, 'public/datasets');
const output = path.join(project, 'docs/generated/vehicle-library.json');
const manifest: DatasetManifest = JSON.parse(await readFile(path.join(dataset, 'manifest.json'), 'utf8'));
const packages: DataPackage[] = [];
for (const entry of manifest.packages) {
  if (!entry.distributable || !entry.file) continue;
  const text = await readFile(path.join(dataset, entry.file), 'utf8');
  if (createHash('sha256').update(text).digest('hex') !== entry.hash) throw new Error(`Dataset hash mismatch: ${entry.id}`);
  packages.push(JSON.parse(text) as DataPackage);
}
const byId = new Map(packages.map(pkg => [pkg.id, pkg]));
function dependencyOrder(id: string): string[] {
  const ordered: string[] = [];
  const visiting = new Set<string>();
  function visit(current: string) {
    if (ordered.includes(current)) return;
    if (visiting.has(current)) throw new Error(`Cyclic package dependency: ${current}`);
    const pkg = byId.get(current);
    if (!pkg) throw new Error(`Unavailable package dependency: ${current}`);
    visiting.add(current);
    for (const dependency of pkg.dependencies ?? []) visit(dependency);
    visiting.delete(current);
    ordered.push(current);
  }
  visit('dda');
  visit(id);
  return ordered;
}
const coreComposition = compose(packages, ['dda']);
const core = buildVehicleLibrary(coreComposition);
const coreIds = new Set(core.byId.keys());
const combinations = packages.map(pkg => {
  const enabledIds = dependencyOrder(pkg.id);
  const composition = compose(packages, enabledIds);
  const library = buildVehicleLibrary(composition);
  return {
    package: pkg.id,
    enabledIds,
    resolvedParts: Object.keys(composition.parts).length,
    libraryParts: library.entries.length,
    excludedParts: library.excluded.length,
    playerInstallationForbidden: library.entries.filter(entry => entry.playerInstallationForbidden).map(entry => entry.id),
    addedToCore: library.entries.filter(entry => !coreIds.has(entry.id)).map(entry => entry.id),
    removedFromCore: core.entries.filter(entry => !library.byId.has(entry.id)).map(entry => entry.id),
    excluded: library.excluded,
    diagnostics: { errors: composition.diagnostics.filter(d => d.severity === 'error').length, warnings: composition.diagnostics.filter(d => d.severity === 'warning').length },
  };
});
const report = {
  formatVersion: 1,
  gameVersion: manifest.gameVersion,
  sourceCommit: manifest.commit,
  rules: { namespace: 'vehicle_part', excludeAbstract: true, excludedFlags: ['APPLIANCE', 'NO_INSTALL_HIDDEN'], noInstallPlayer: 'visible for prototype design, with warning; not player-installable in game', identity: 'vpart ID retained; item is an association, not a conversion' },
  inputs: manifest.packages.filter(entry => entry.distributable && entry.file).map(entry => ({ id: entry.id, hash: entry.hash })),
  core: {
    resolvedParts: Object.keys(coreComposition.parts).length,
    libraryParts: core.entries.length,
    entries: core.entries.map(({ id, definition, baseItemId, playerInstallationForbidden }) => ({ id, baseItemId, location: definition.location ?? '', package: definition._package, source: definition._source, ...(playerInstallationForbidden ? { playerInstallationForbidden } : {}) })),
    excluded: core.excluded,
  },
  combinations,
};
const text = `${JSON.stringify(report, null, 2)}\n`;
if (process.argv.includes('--check')) {
  if (await readFile(output, 'utf8') !== text) throw new Error('Vehicle library report is stale. Run npm run rebuild:library.');
  console.log('Vehicle library report matches the current data and rules.');
} else {
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, text, 'utf8');
  console.log(`Rebuilt vehicle library: ${core.entries.length} core entries, ${core.excluded.length} exclusions, ${combinations.length} dependency-resolved package combinations.`);
  console.log('Report: docs/generated/vehicle-library.json (audit only; runtime always rebuilds from the active composition).');
}
