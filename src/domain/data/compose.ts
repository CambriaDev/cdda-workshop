import type { Composition, DataPackage, Definition, Diagnostic, JsonRecord, ResolvedDefinition } from './types';
export const ITEM_TYPES = new Set(['ITEM', 'GENERIC', 'AMMO', 'ARMOR', 'BOOK', 'COMESTIBLE', 'ENGINE', 'GUN', 'GUNMOD', 'MAGAZINE', 'TOOL', 'TOOL_ARMOR', 'BIONIC_ITEM', 'PET_ARMOR', 'WHEEL', 'BATTERY']);
const COPY_TYPES = new Set([...ITEM_TYPES, 'vehicle_part', 'vehicle', 'mutation', 'skill', 'proficiency', 'bionic', 'effect_type', 'body_part', 'profession', 'scenario', 'martial_art', 'SPELL', 'item_category', 'ITEM_CATEGORY', 'AMMO_TYPE', 'ammunition_type', 'json_flag', 'material']);
const ITEM_NUMBERS = new Set(['weight', 'volume', 'integral_weight', 'integral_volume', 'price', 'price_postapoc', 'longest_side', 'stack_size', 'charges', 'count', 'capacity', 'reload', 'recoil', 'dispersion', 'sight_dispersion', 'durability', 'loudness', 'barrel_length', 'handling', 'ammo_to_fire', 'energy_drain', 'to_hit']);
const PART_NUMBERS = new Set(['durability', 'damage_modifier', 'energy_consumption', 'power', 'epower', 'folded_volume', 'size', 'bonus', 'cargo_weight_modifier', 'comfort', 'floor_bedding_warmth', 'bonus_fire_warmth_feet']);
const ITEM_SETS = new Set(['flags', 'qualities', 'techniques', 'faults', 'effects', 'ammo', 'materials', 'material']);
const PART_SETS = new Set(['flags', 'categories', 'emissions', 'exhaust']);
export function isRecord(v: unknown): v is JsonRecord { return !!v && typeof v === 'object' && !Array.isArray(v); }
const clone = <T>(v: T): T => structuredClone(v);
// Explicit unit dimensions, not a generic numeric-string parser. Values remain in their source units.
const UNITS: Record<string, [string, number]> = { mg: ['mass', .001], g: ['mass', 1], kg: ['mass', 1000], ml: ['volume', 1], L: ['volume', 1000], mm: ['length', 1], cm: ['length', 10], m: ['length', 1000], W: ['power', 1], kW: ['power', 1000], J: ['energy', 1], kJ: ['energy', 1000], USD: ['money', 100], cent: ['money', 1] };
export function quantity(value: unknown): { value: number; dimension: string } | undefined {
  if (typeof value === 'number') return { value, dimension: 'number' };
  if (typeof value !== 'string') return undefined;
  const tokens = [...value.matchAll(/(-?\d+(?:\.\d+)?)\s*([A-Za-z]+)/g)];
  if (!tokens.length || value.replace(/(-?\d+(?:\.\d+)?)\s*([A-Za-z]+)/g, '').trim()) return undefined;
  let total = 0; let dimension = '';
  for (const t of tokens) { const u = UNITS[t[2]]; if (!u || (dimension && dimension !== u[0])) return undefined; dimension = u[0]; total += Number(t[1]) * u[1]; }
  return { value: total, dimension };
}
function arithmetic(base: unknown, operand: unknown, mode: 'relative' | 'proportional'): unknown {
  if (typeof base === 'number' && typeof operand === 'number') return mode === 'relative' ? base + operand : base * operand;
  const b = quantity(base); const o = quantity(operand);
  if (!b || !o || (mode === 'relative' && b.dimension !== o.dimension) || (mode === 'proportional' && o.dimension !== 'number')) return undefined;
  const result = mode === 'relative' ? b.value + o.value : b.value * o.value;
  const unit = Object.entries(UNITS).find(([, [dim, scale]]) => dim === b.dimension && scale === 1)?.[0];
  return unit ? `${result} ${unit}` : undefined;
}
// veh_type.cpp parse_vp_reqs: absent operations inherit; present operations keep
// missing/empty skills and missing time, but REPLACE material/tool requirement sources.
function partRequirements(parent: unknown, raw: JsonRecord, unsupported: (message: string) => void): JsonRecord {
  const result = isRecord(parent) ? clone(parent) : {};
  for (const [operation, value] of Object.entries(raw)) {
    if (operation.startsWith('//')) continue;
    if (!['install', 'removal', 'repair'].includes(operation) || !isRecord(value)) { unsupported(`Unsupported vehicle_part.requirements.${operation}`); result[operation] = clone(value); continue; }
    const old = isRecord(result[operation]) ? result[operation] : {};
    const next: JsonRecord = {};
    if (old.skills !== undefined) next.skills = clone(old.skills);
    if (old.time !== undefined) next.time = clone(old.time);
    if (Array.isArray(value.skills) && value.skills.length) {
      if (value.skills.every(skill => Array.isArray(skill) && skill.length === 2 && typeof skill[0] === 'string' && Number.isInteger(skill[1]))) next.skills = clone(value.skills).filter((skill, i, all) => all.findIndex(other => other[0] === skill[0]) === i);
      else unsupported('Malformed vehicle_part requirement skills');
    } else if (value.skills !== undefined && !Array.isArray(value.skills)) unsupported('Malformed vehicle_part requirement skills');
    if (typeof value.time === 'string' || Number.isInteger(value.time)) next.time = clone(value.time);
    else if (value.time !== undefined) unsupported('Malformed vehicle_part requirement time');
    if (typeof value.using === 'string' || Array.isArray(value.using)) next.using = clone(value.using);
    else for (const field of ['components', 'qualities', 'tools']) if (field in value) next[field] = clone(value[field]);
    for (const field of Object.keys(value)) if (!['skills', 'time', 'using', 'components', 'qualities', 'tools'].includes(field) && !field.startsWith('//')) unsupported(`Unsupported vehicle_part requirement field ${field}`);
    result[operation] = next;
  }
  return result;
}
export function compose(packages: DataPackage[], enabledIds: string[]): Composition {
  const diagnostics: Diagnostic[] = []; const byType: Composition['byType'] = Object.create(null); const allItems: Record<string, ResolvedDefinition> = Object.create(null);
  const available = new Map(packages.map(p => [p.id, p])); const ordered = [...new Set(available.has('dda') ? ['dda', ...enabledIds] : enabledIds)];
  const table = (type: string) => ITEM_TYPES.has(type) ? allItems : (byType[type] ??= Object.create(null));
  type Pending = { definition: Definition; pkg: string };
  const pending: Pending[] = [];
  const diag = (code: string, message: string, d: Definition, pkg: string, id?: string) => diagnostics.push({ severity: 'warning', code, message, source: d.source, package: pkg, id });
  function apply({ definition: d, pkg }: Pending): boolean {
    const raw = d.data; const type = String(raw.type ?? '');
    const ids = Array.isArray(raw.id) ? raw.id : [raw.id ?? raw.abstract ?? (type === 'vehicle' ? raw.name : undefined)];
    if (!type || !ids.some(id => typeof id === 'string')) return true;
    const target = table(type); const parentId = typeof raw['copy-from'] === 'string' ? raw['copy-from'] : undefined;
    const parent = parentId ? target[parentId] : undefined;
    if (parentId && !parent) return false;
    for (const idValue of ids) {
      if (typeof idValue !== 'string') continue;
      const id = idValue; const out = (parent ? clone(parent) : {}) as ResolvedDefinition;
      const incompleteFields = new Set(parent?._incompleteFields ?? (parent?._incomplete ? ['*'] : []));
      const unsupported = (message: string, field = '*') => { incompleteFields.add(field); diag('unsupported-rule', message, d, pkg, id); };
      if (parent && !COPY_TYPES.has(type)) unsupported(`Inheritance for ${type} is not implemented; inherited fields are a preview only.`);
      // Top-level replacement is deliberate. Nested loader rules are NOT substituted by deep merge.
      for (const [key, value] of Object.entries(raw)) {
        if (['copy-from', 'relative', 'proportional', 'extend', 'delete', 'abstract'].includes(key)) continue;
        if (type === 'vehicle') {
          // veh_type.cpp:1287–1395 appends prototype vectors after explicit copy-from.
          // generic_factory.h:338–350 starts with a NEW object without copy-from,
          // even when replacing an existing ID; there is no implicit same-ID append.
          if (['parts', 'items', 'zones'].includes(key)) {
            if (Array.isArray(value) && (out[key] === undefined || Array.isArray(out[key]))) out[key] = [...clone((out[key] ?? []) as unknown[]), ...clone(value)];
            else { unsupported(`Malformed vehicle.${key}; expected an array`, key); out[key] = clone(value); }
            continue;
          }
          if (!['id', 'type', 'name', 'blueprint'].includes(key) && !key.startsWith('//')) {
            unsupported(`Unsupported vehicle.${key}; field retained as preview, not engine-applied`, key); out[key] = clone(value); continue;
          }
        }
        const numericKeys = type === 'vehicle_part' ? PART_NUMBERS : ITEM_TYPES.has(type) ? ITEM_NUMBERS : new Set<string>();
        if (numericKeys.has(key) && ((isRecord(raw.relative) && key in raw.relative) || (isRecord(raw.proportional) && key in raw.proportional))) continue;
        if (type === 'vehicle_part' && key === 'requirements' && isRecord(value)) {
          out[key] = partRequirements(parent?.[key], value, message => unsupported(message, key)); continue;
        }
        if (parent && isRecord(value) && isRecord(parent[key]) && !['name', 'description'].includes(key)) unsupported(`Nested ${type}.${key} replaces the source object; field-specific inheritance is not implemented.`, key);
        out[key] = clone(value);
        // A direct supported scalar assignment resolves uncertainty in that field only.
        if (numericKeys.has(key) && quantity(value)) incompleteFields.delete(key);
      }
      if (parent && type === 'vehicle_part' && !raw.looks_like) out.looks_like = parent._abstract ? (parent.looks_like ?? parent.id) : parent.id;
      for (const mode of ['relative', 'proportional', 'extend', 'delete'] as const) {
        const operations = raw[mode]; if (!isRecord(operations)) continue;
        for (const [key, operand] of Object.entries(operations)) {
          if (mode === 'proportional' && isRecord(raw.relative) && key in raw.relative) continue; // assign.h: relative takes precedence
          const numeric = type === 'vehicle_part' ? PART_NUMBERS : ITEM_TYPES.has(type) ? ITEM_NUMBERS : new Set<string>();
          const sets = type === 'vehicle_part' ? PART_SETS : ITEM_TYPES.has(type) ? ITEM_SETS : new Set<string>();
          if ((mode === 'relative' || mode === 'proportional') && numeric.has(key)) {
            const result = arithmetic(out[key], operand, mode);
            if (result === undefined) unsupported(`Cannot apply ${mode} to ${type}.${key}; incompatible/missing quantity or nested value.`, key); else out[key] = result;
          } else if ((mode === 'extend' || mode === 'delete') && sets.has(key) && Array.isArray(operand) && (out[key] === undefined || Array.isArray(out[key]))) {
            const current = (out[key] ?? []) as unknown[];
            out[key] = mode === 'extend' ? [...current, ...clone(operand)].filter((v, i, a) => a.findIndex(x => JSON.stringify(x) === JSON.stringify(v)) === i) : current.filter(v => !operand.some(x => JSON.stringify(x) === JSON.stringify(v)));
          } else unsupported(`Unsupported ${mode} operation ${type}.${key}; operation retained in original definitions, not applied.`, key);
        }
      }
      out.id = id; out.type = type; out._source = d.source; out._package = pkg; out._abstract = typeof raw.abstract === 'string'; out._incomplete = incompleteFields.size > 0; out._incompleteFields = [...incompleteFields];
      // Neither a child nor an override inherits the parent's abstract identity.
      delete out.abstract; target[id] = out; (byType[type] ??= Object.create(null))[id] = out;
    }
    return true;
  }
  for (const pkgId of ordered) {
    const pkg = available.get(pkgId); if (!pkg) { diagnostics.push({ severity: 'error', code: 'missing-package', message: `Package ${pkgId} is not installed`, package: pkgId }); continue; }
    if (pkg.obsolete) diagnostics.push({ severity: 'warning', code: 'obsolete-package', message: `${pkgId} is declared obsolete by its source`, package: pkgId });
    for (const conflict of pkg.conflicts ?? []) if (ordered.includes(conflict)) diagnostics.push({ severity: 'error', code: 'package-conflict', message: `${pkgId} conflicts with ${conflict}`, package: pkgId });
    for (const dependency of pkg.dependencies ?? []) {
      if (!ordered.includes(dependency)) diagnostics.push({ severity: 'error', code: 'missing-dependency', message: `${pkgId} requires ${dependency}`, package: pkgId });
      else if (ordered.indexOf(dependency) > ordered.indexOf(pkgId)) diagnostics.push({ severity: 'warning', code: 'dependency-order', message: `${pkgId} loads before dependency ${dependency}; user order preserved`, package: pkgId });
    }
    for (const definition of pkg.definitions) if (!apply({ definition, pkg: pkgId })) pending.push({ definition, pkg: pkgId });
  }
  let queue = pending; while (queue.length) { const retry: Pending[] = []; for (const p of queue) if (!apply(p)) retry.push(p); if (retry.length === queue.length) { for (const p of retry) diag('unresolved-parent', `Missing or cyclic copy-from ${String(p.definition.data['copy-from'])}`, p.definition, p.pkg, String(p.definition.data.id ?? p.definition.data.abstract)); break; } queue = retry; }
  const parts = byType.vehicle_part ?? Object.create(null);
  finalize(parts, allItems, byType, diagnostics);
  const concrete = (values: Record<string, ResolvedDefinition>) => Object.fromEntries(Object.entries(values).filter(([, v]) => !v._abstract));
  return { parts: concrete(parts), items: concrete(allItems), vehicles: concrete(byType.vehicle ?? {}), byType, diagnostics, enabledIds: ordered };
}
function finalize(parts: Record<string, ResolvedDefinition>, items: Record<string, ResolvedDefinition>, byType: Composition['byType'], diagnostics: Diagnostic[]) {
  const ammoTypeIndex = byType.ammunition_type ?? byType.AMMO_TYPE ?? {};
  const generic = parts.turret_generic;
  if (generic) {
    for (const item of Object.values(items)) {
      const subtypes = Array.isArray(item.subtypes) ? item.subtypes : [];
      if (!(item.type === 'GUN' || subtypes.includes('GUN')) || subtypes.includes('GUNMOD') || item._abstract || ['BIONIC_WEAPON', 'NO_TURRET', 'NO_UNWIELD', 'PSEUDO', 'RELOAD_AND_SHOOT', 'STR_DRAW'].some(f => Array.isArray(item.flags) && item.flags.includes(f))) continue;
      const id = `turret_${item.id}`; const flags = [...(Array.isArray(generic.flags) ? generic.flags : [])];
      const ammoTypes = Array.isArray(item.ammo) ? item.ammo : [item.ammo];
      const liquid = ammoTypes.some(a => { const type = ammoTypeIndex[String(a)]; return items[String(type?.default)]?.phase === 'liquid'; });
      if (liquid) flags.push('USE_TANKS');
      const pockets = Array.isArray(item.pocket_data) ? item.pocket_data : []; let batteryDrain = 0;
      for (const pocket of pockets) if (isRecord(pocket) && Array.isArray(pocket.item_restriction)) for (const restricted of pocket.item_restriction) {
        const mag = items[String(restricted)]; for (const p of Array.isArray(mag?.pocket_data) ? mag.pocket_data : []) if (isRecord(p) && isRecord(p.ammo_restriction)) {
          if ('battery' in p.ammo_restriction) batteryDrain = Math.max(batteryDrain, Number(item.ammo_to_fire ?? 1));
          if (Object.keys(p.ammo_restriction).some(a => items[String(ammoTypeIndex[a]?.default)]?.phase === 'liquid') && !flags.includes('USE_TANKS')) flags.push('USE_TANKS');
        }
      }
      if (batteryDrain) flags.push('USE_BATTERIES');
      const energy = (quantity(item.energy_drain)?.value ?? 0) > 0;
      const lightAmmo = ammoTypes.some(a => { const mass = quantity(items[String(ammoTypeIndex[String(a)]?.default)]?.weight); return mass?.dimension === 'mass' && mass.value > 3 && mass.value < 15; });
      const looks = energy && lightAmmo ? 'mounted_hk_g80' : batteryDrain || energy ? 'laser_rifle' : flags.includes('USE_TANKS') ? 'watercannon' : item.skill === 'launcher' ? 'tow_launcher' : 'm249';
      const weight = quantity(item.weight); const mechanics = Math.min(8, 3 + (weight?.dimension === 'mass' ? Math.trunc(weight.value / 10000) : 0) + (liquid ? 1 : 0)); const electronics = Math.min(8, Math.ceil(batteryDrain / 15));
      const skills: unknown[] = [[String(item.skill ?? 'gun'), 3], ['mechanics', mechanics]]; if (electronics) skills.push(['electronics', electronics]);
      const quality = Array.isArray(item.qualities) ? item.qualities : []; const foldable = quality.some(q => Array.isArray(q) && ['PISTOL', 'SMG'].includes(String(q[0])));
      parts[id] = { ...clone(generic), id, item: item.id, description: item.description, color: item.color, flags, looks_like: looks, _source: item._source, _package: item._package, _abstract: false, _generated: true, _incomplete: true, _incompleteFields: ['*'],
        requirements: { install: { skills, time: `${10 * (3 + mechanics + electronics * 2)} m` }, removal: { skills: skills.map(s => { const p = s as [string, number]; return [p[0], Math.trunc(p[1] / 2)]; }), time: `${5 * (3 + mechanics + electronics * 2)} m` } }, ...(foldable ? { folded_volume: item.volume } : {}) };
    }
    generic.flags = [...(Array.isArray(generic.flags) ? generic.flags : []), 'NO_INSTALL_HIDDEN'];
    diagnostics.push({ severity: 'info', code: 'turret-finalize-limits', message: 'Generated turrets follow veh_type.cpp:473–635 filter/base/flags/appearance/requirements. Item migration/blacklist hiding and complex pocket finalization are not complete; generated entries are marked _incomplete.' });
  }
  const layers: Record<string, [number, number]> = { on_roof: [9, 3], on_cargo: [8, 6], center: [7, 7], under: [6, 10], structure: [5, 1], engine_block: [4, 8], on_battery_mount: [3, 10], fuel_source: [3, 9], roof: [-1, 4], armor: [-2, 2] };
  for (const part of Object.values(parts)) {
    if (part._abstract) continue;
    part.color ??= 'light_gray'; part.broken_color ??= 'light_gray'; // veh_type.h:382–383
    if (Array.isArray(part.flags) && part.flags.includes('APPLIANCE')) part.location = 'structure';
    [part.z_order, part.list_order] = layers[String(part.location)] ?? [0, 5];
    const variants = Array.isArray(part.variants) ? clone(part.variants).filter(isRecord).map(v => ({ ...v, id: String(v.id ?? ''), label: String(v.label ?? '') })) : [];
    const bases = Array.isArray(part.variants_bases) ? part.variants_bases.filter(isRecord) : [];
    for (const base of bases) for (const variant of [...variants].slice(0, Array.isArray(part.variants) ? part.variants.length : 0)) variants.push({ ...variant, id: variant.id ? `${String(base.id)}_${String(variant.id)}` : String(base.id), label: variant.label ? `${String(base.label)} ${String(variant.label)}` : String(base.label) });
    part.variants = variants.length ? variants : [{ id: '', label: 'Default', symbols: '?', symbols_broken: '?' }];
    part.variant_default = (part.variants as JsonRecord[])[0]?.id ?? '';
    const item = items[String(part.item)]; if (!part.name && item) part.name = item.name;
  }
}
export function compositionKey(packages: DataPackage[], enabledIds: string[]): string { return JSON.stringify(enabledIds.map(id => { const p = packages.find(x => x.id === id); return [id, p?.gameVersion, p?.commit, p?.hash]; })); }
