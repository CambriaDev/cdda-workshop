import { definitionFieldsReliable, type Definition, type PartDetailField, type PartDetails } from '../../domain/vehicle';

/** Presentation-only purpose ordering. Never derives performance or guesses from names/IDs. */
export const PART_ROLE_PRIORITY = ['engine', 'alternator', 'generator', 'reactor', 'battery', 'tank', 'turret', 'wheel', 'rotor', 'lighting', 'utility', 'passenger', 'protection', 'structure', 'cargo', 'fallback'] as const;
export type PartRole = typeof PART_ROLE_PRIORITY[number];
export type PartCapabilityGroup = 'partQualities' | 'baseItemQualities' | 'pseudoTools' | 'connectableTools';
export interface PartDetailBlock {
  id: string;
  role?: PartRole;
  fields: PartDetailField[];
  capabilities: PartCapabilityGroup[];
}
export interface PartDetailLayout {
  roles: PartRole[];
  primaryRole: PartRole;
  featuredBlocks: PartDetailBlock[];
  remainingSections: PartDetails['sections'];
  secondaryCapabilities: PartCapabilityGroup[];
  /** Count/lifting fields represented by capability lists instead of duplicate numeric rows. */
  representedFields: PartDetailField[];
  /** Description, identity and source are handled by the header/advanced view. */
  metadataFields: PartDetailField[];
}

const strings = (value: unknown): string[] => typeof value === 'string' ? [value] : Array.isArray(value) && value.every(v => typeof v === 'string') ? [...value] : [];
const trusted = (d: Readonly<Definition> | null, key: string): boolean => definitionFieldsReliable(d ?? undefined, [key]);
const hasAny = (values: readonly string[], candidates: readonly string[]) => candidates.some(value => values.includes(value));
const metadata = new Set(['part_id', 'description', 'base_description', 'source', 'base_item_source']);
const capacity = (id: string) => /^(?:cargo_capacity|cargo_weight_modifier|container_capacity|container_weight_capacity|container_watertight|container_airtight|container_rigid|ammo_capacity|battery_capacity)(?:_|$)/.test(id);
export const isCapacityDetailField = (field: PartDetailField): boolean => capacity(field.id);
const ordered = (role: PartRole, fields: PartDetailField[]): PartDetailField[] => {
  const order: Partial<Record<PartRole, string[]>> = {
    engine: ['mechanical_output', 'mechanical_output_hp', 'fuel_type', 'fuel_options', 'full_load_consumption'],
    alternator: ['generation', 'mechanical_load', 'mechanical_load_hp'],
    reactor: ['generation', 'fuel_type', 'fuel_options'],
    wheel: ['wheel_diameter', 'wheel_width', 'wheel_rolling_resistance', 'wheel_offroad_rating', 'wheel_contact_area'],
    protection: ['durability', 'damage_reduction', 'collision_damage_modifier', 'location'],
    structure: ['durability', 'damage_reduction', 'collision_damage_modifier', 'location'],
  };
  const ids = order[role];
  if (!ids) return fields;
  const rank = (id: string) => { const i = ids.findIndex(key => id === key || (key === 'damage_reduction' && id.startsWith('damage_reduction_'))); return i < 0 ? ids.length : i; };
  return [...fields].sort((a, b) => rank(a.id) - rank(b.id));
};
const energy = (id: string) => /^(?:mechanical_output|mechanical_load|generation|fixed_consumption|full_load_consumption|fuel_type|fuel_options)(?:_|$)/.test(id);
const lifting = (id: string) => ['jack_capacity', 'lift_capacity', 'self_jack_capacity'].includes(id);
const zeroDefault = (f: PartDetailField) => f.status === 'default' && f.value === 0;

/**
 * Organizes the existing immutable model only. Reliable flags, exact categories,
 * and base-item slots supply purpose; arbitrary labels, sign/size guesses and IDs do not.
 * A role-critical unknown stays featured. Default numeric zero noise is demoted, not discarded.
 * Boolean false remains meaningful (e.g. a non-watertight pocket), even when defaulted.
 */
export function getPartDetailLayout(model: PartDetails): PartDetailLayout {
  const part = model.advanced.part;
  const base = model.advanced.baseItem;
  const flags = trusted(part, 'flags') ? [...model.flags] : [];
  const categories = trusted(part, 'categories') && Array.isArray(part?.categories) ? strings(part.categories) : [];
  const baseTypes = trusted(base, 'type') ? strings(base?.type) : [];
  if (trusted(base, 'subtypes')) baseTypes.push(...strings(base?.subtypes));
  // Exact known category IDs supplement source traits, never broad "movement => engine" guesses.
  const purpose = (sourceFlags: readonly string[], categoryIds: readonly string[] = [], types: readonly string[] = []) => hasAny(flags, sourceFlags) || hasAny(categories, categoryIds) || hasAny(baseTypes, types);
  const installedQualities = model.qualities.filter(q => q.source === 'part');
  const hasPartQualities = trusted(part, 'qualities') && installedQualities.length > 0;
  const hasPseudoTools = trusted(part, 'pseudo_tools') && model.pseudoTools.length > 0;
  const hasConnectable = trusted(part, 'allowed_tools') && !!model.connectableTools?.length;
  const detected: Record<PartRole, boolean> = {
    engine: purpose(['ENGINE'], ['engines'], ['ENGINE']),
    alternator: purpose(['ALTERNATOR'], ['alternators']),
    generator: purpose(['SOLAR_PANEL', 'WIND_TURBINE', 'WATER_WHEEL'], ['solar_panels', 'wind_turbines', 'water_wheels']),
    reactor: purpose(['REACTOR'], ['reactors']),
    battery: purpose(['BATTERY'], ['batteries'], ['BATTERY']),
    tank: purpose(['FLUIDTANK'], ['tanks']),
    turret: purpose(['TURRET'], ['weapons', 'turrets'], ['GUN']),
    wheel: purpose(['WHEEL'], ['wheels'], ['WHEEL']),
    rotor: purpose(['ROTOR'], ['rotors'], ['ROTOR']),
    lighting: purpose(['LIGHT', 'CONE_LIGHT', 'WIDE_CONE_LIGHT', 'HALF_CIRCLE_LIGHT', 'CIRCLE_LIGHT', 'AISLE_LIGHT', 'ATOMIC_LIGHT', 'DOME_LIGHT', 'HORN', 'BEEPER'], ['lighting']),
    utility: purpose(['APPLIANCE', 'VEH_TOOLS', 'CRAFTING', 'KITCHEN', 'WELDRIG', 'CHEMLAB', 'FORGE', 'WORKBENCH', 'FAUCET', 'WATER_PURIFIER', 'FUNNEL', 'RECHARGE', 'MUFFLER', 'SHOCK_ABSORBER', 'JACK', 'SELF_JACK', 'FRIDGE', 'FREEZER', 'SPACE_HEATER', 'HEATED_TANK', 'COOLER', 'AUTOCLAVE', 'WASHING_MACHINE', 'DISHWASHER', 'ARCADE'], ['utility', 'tools', 'appliances']) || hasPartQualities || hasPseudoTools || hasConnectable,
    passenger: purpose(['SEAT', 'BED', 'SEATBELT', 'AISLE'], ['passengers', 'seats', 'beds']),
    protection: purpose(['ARMOR'], ['armor']),
    structure: purpose(['STRUCTURE', 'STRUCTURAL', 'DOOR', 'ROOF', 'WINDOW'], ['hull', 'frames']) || (trusted(part, 'location') && part?.location === 'structure'),
    cargo: purpose(['CARGO'], ['cargo']),
    fallback: false,
  };
  const roles = PART_ROLE_PRIORITY.filter(role => detected[role]);
  if (!roles.length) roles.push('fallback');
  const allFields = model.sections.flatMap(section => section.fields);
  const metadataFields = allFields.filter(f => metadata.has(f.id));
  const representedFields: PartDetailField[] = [];
  const represented = new Set<PartDetailField>();
  const represent = (field: PartDetailField) => { represented.add(field); representedFields.push(field); };
  const capabilityGroups: PartCapabilityGroup[] = [];
  if (model.pseudoTools.length) capabilityGroups.push('pseudoTools');
  if (installedQualities.length) capabilityGroups.push('partQualities');
  if (model.connectableTools?.length) capabilityGroups.push('connectableTools');
  const secondaryCapabilities: PartCapabilityGroup[] = model.qualities.some(q => q.source === 'base_item') ? ['baseItemQualities'] : [];
  for (const f of allFields) {
    if (f.status === 'unknown') continue;
    const countGroup: PartCapabilityGroup | undefined = f.id === 'part_qualities' ? 'partQualities' : f.id === 'base_item_qualities' ? 'baseItemQualities' : f.id === 'pseudo_tools' ? 'pseudoTools' : f.id === 'connectable_tools' ? 'connectableTools' : undefined;
    if (countGroup && [...capabilityGroups, ...secondaryCapabilities].includes(countGroup)) represent(f);
    if ((f.id === 'jack_capacity' || f.id === 'lift_capacity') && installedQualities.some(q => q.id === (f.id === 'jack_capacity' ? 'JACK' : 'LIFT') && q.status === 'known' && q.liftingKg === f.value)) represent(f);
  }
  const available = allFields.filter(f => !metadata.has(f.id) && !represented.has(f));
  const consumed = new Set<PartDetailField>();
  const take = (predicate: (field: PartDetailField) => boolean) => available.filter(f => {
    if (consumed.has(f) || zeroDefault(f) || !predicate(f)) return false;
    consumed.add(f);
    return true;
  });
  const core = (role: PartRole, field: PartDetailField): boolean => {
    const id = field.id;
    switch (role) {
      case 'engine': return /^(mechanical_output|fuel_type|fuel_options|full_load_consumption)(_|$)/.test(id);
      case 'alternator': return /^(generation|mechanical_load)(_|$)/.test(id);
      case 'generator': return id === 'generation';
      case 'reactor': return /^(generation|fuel_type|fuel_options)(_|$)/.test(id) || capacity(id);
      case 'battery': return /^(battery_capacity|recharge_power|ammo_capacity)(_|$)/.test(id);
      case 'tank': return /^(container_|ammo_capacity|battery_capacity)/.test(id);
      case 'turret': return /^(ammo_capacity|battery_capacity|fixed_consumption|full_load_consumption|fuel_type)(_|$)/.test(id);
      case 'wheel': return /^wheel_/.test(id);
      case 'rotor': return id === 'rotor_effective_diameter';
      case 'lighting': return /^(fixed_consumption|light_intensity|horn_volume)(_|$)/.test(id);
      case 'utility': return /^(fixed_consumption|full_load_consumption|recharge_power|funnel_radius|muffler_noise_reduction|shock_absorption)(_|$)/.test(id) || lifting(id) || capacity(id) || ['part_qualities', 'pseudo_tools', 'connectable_tools'].includes(id);
      case 'passenger': return /^(comfort|floor_bedding_warmth|bonus_fire_warmth_feet|seatbelt_strength)(_|$)/.test(id) || capacity(id);
      case 'protection': return id.startsWith('damage_reduction') || ['collision_damage_modifier', 'durability', 'location'].includes(id);
      case 'structure': return id.startsWith('damage_reduction') || ['collision_damage_modifier', 'durability', 'location'].includes(id);
      case 'cargo': return /^cargo_/.test(id);
      case 'fallback': return energy(id) || capacity(id) || lifting(id) || ['part_qualities', 'pseudo_tools', 'connectable_tools'].includes(id);
    }
  };
  const featuredBlocks: PartDetailBlock[] = [];
  let placedCapabilities = false;
  for (const role of roles) {
    const fields = ordered(role, take(f => core(role, f)));
    const capabilities = !placedCapabilities && (role === 'utility' || role === 'fallback') ? capabilityGroups : [];
    if (capabilities.length) placedCapabilities = true;
    if (fields.length || capabilities.length || role === 'utility') featuredBlocks.push({ id: role, role, fields, capabilities });
  }
  // Defensive model consumers may supply capability lists without a recognized source trait.
  if (!placedCapabilities && capabilityGroups.length) featuredBlocks.push({ id: 'capabilities', fields: [], capabilities: capabilityGroups });
  const primaryRole = roles[0];
  const weightRelevant = !['utility', 'lighting'].includes(primaryRole);
  const durabilityRelevant = ['wheel', 'rotor', 'turret', 'protection', 'structure', 'fallback'].includes(primaryRole);
  const essentials = take(f => (f.id === 'weight' && weightRelevant) || (f.id === 'durability' && durabilityRelevant));
  if (essentials.length) featuredBlocks.push({ id: 'essentials', fields: essentials, capabilities: [] });
  const remainingSections = model.sections.map(section => ({ ...section, fields: section.fields.filter(f => available.includes(f) && !consumed.has(f)) })).filter(section => section.fields.length > 0);
  return { roles, primaryRole: roles[0], featuredBlocks, remainingSections, secondaryCapabilities, representedFields, metadataFields };
}
