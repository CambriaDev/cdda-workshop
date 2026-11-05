import { asSafeInteger, cloneLosslessJSON, isJsonObject, SaveFormatError, stringifyLosslessJSON } from './losslessJson';
import type { JsonObject, JsonValue } from './losslessJson';
import type { CompatibilityWarning } from './protocol';

export interface ValidationIssue { path: string; message: string }
export interface CharacterValidation { valid: boolean; issues: ValidationIssue[]; warnings: CompatibilityWarning[] }
export interface TransferOptions {
  cleanWorldReferences?: boolean;
  /** Explicit opt-in. This is a limited, destructive source-field reset, not full medical simulation. */
  restoreHealth?: boolean;
  randomStartLocation?: boolean;
  startLocation?: string;
  outfitGender?: boolean;
}
export interface TransferChange { path: string; action: 'replace' | 'remove'; reason: string }
export interface TransferTemplateResult {
  template: [JsonObject, JsonObject];
  text: string;
  warnings: CompatibilityWarning[];
  changes: TransferChange[];
  validation: CharacterValidation;
  verification: 'source-reviewed-not-runtime-verified';
}

/** Scope is deliberately structural; content IDs/mod dependencies require the game data loader. */
export function validateCharacterSave(root: unknown): CharacterValidation {
  const issues: ValidationIssue[] = [];
  const warnings: CompatibilityWarning[] = [];
  if (!isJsonObject(root) || !isJsonObject(root.player)) {
    return { valid: false, issues: [{ path: 'player', message: 'Expected a player object inside a save object.' }], warnings };
  }
  const player = root.player;
  if (root.savegame_loading_version !== undefined) {
    const version = asSafeInteger(root.savegame_loading_version);
    if (version === undefined || version < 0) issues.push({ path: 'savegame_loading_version', message: 'Expected a nonnegative safe integer.' });
    else if (version !== 36) warnings.push({ code: 'UNVERIFIED_VERSION', message: 'Transfer policy was inspected against source save version 36 only.' });
  } else warnings.push({ code: 'VERSION_MISSING', message: 'No body save version was supplied. Transfer compatibility is unverified.' });
  if (typeof player.name !== 'string' || !player.name.trim() || player.name.length > 1024 || /[\x00-\x1f]/.test(player.name)) {
    issues.push({ path: 'player.name', message: 'Name must be nonempty text without control characters (max 1024 UTF-16 units).' });
  }
  for (const key of ['str_max', 'dex_max', 'int_max', 'per_max']) {
    if (player[key] !== undefined) {
      const n = asSafeInteger(player[key]);
      if (n === undefined || n < 0 || n > 2147483647) issues.push({ path: `player.${key}`, message: 'Expected a nonnegative signed 32-bit integer.' });
    }
  }
  for (const key of ['skills', 'body', 'vitamin_levels', 'daily_vitamins']) {
    if (player[key] !== undefined && !isJsonObject(player[key])) issues.push({ path: `player.${key}`, message: 'Expected an object in the inspected source format.' });
  }
  for (const key of ['assigned_invlet', 'known_traps', 'camps', 'overmap_time', 'queued_effect_on_conditions', 'damage_over_time_map']) {
    if (player[key] !== undefined && !Array.isArray(player[key])) issues.push({ path: `player.${key}`, message: 'Expected an array.' });
  }
  const requiredNativeFields = ['skills', 'body', 'vitamin_levels', 'daily_vitamins', 'assigned_invlet'];
  if (requiredNativeFields.some(key => player[key] === undefined)) {
    warnings.push({ code: 'INCOMPLETE_AVATAR', message: 'Some native avatar fields are missing. This may be a partial fixture or older schema; game loading is not guaranteed.' });
  }
  try { stringifyLosslessJSON(root, 0); }
  catch { issues.push({ path: '$', message: 'Tree contains unsupported/cyclic values or unsafe JavaScript numbers.' }); }
  return { valid: issues.length === 0, issues, warnings };
}

/** Reviewed policy keys, not an exhaustive claim of understanding every avatar field. */
const reviewedPreserved = new Set([
  'name', 'play_name', 'male', 'base_age', 'base_height', 'blood_type', 'blood_rh_factor',
  'str_max', 'dex_max', 'int_max', 'per_max', 'str_cur', 'dex_cur', 'int_cur', 'per_cur',
  'profession', 'scenario', 'hobbies', 'skills', 'mutations', 'my_mutations', 'cached_mutations',
  'my_bionics', 'power_level', 'max_power_level', 'magic', 'learned_recipes', 'proficiencies',
  'inv', 'worn', 'weapon', 'inventory', 'items_identified', 'snippets_read', 'assigned_invlet', 'invcache',
  'vitamin_levels', 'daily_vitamins', 'body', 'stored_calories', 'healthy', 'healthy_mod',
  'effects', 'damage_over_time_map', 'pain', 'radiation', 'hunger', 'thirst', 'sleepiness', 'sleep_deprivation',
  'pkill', 'stim', 'stamina', 'oxygen', 'lifestyle', 'cardio_acc', 'healed_total',
]);

const effectFields = new Set(['eff_type', 'duration', 'bp', 'permanent', 'intensity', 'start_turn', 'source']);
const sourceFields = new Set(['character_id', 'faction_id', 'mfaction_id']);
const int32 = (value: JsonValue | undefined): boolean => {
  const n = asSafeInteger(value);
  return n !== undefined && n >= -2147483648 && n <= 2147483647;
};

/** Recognize the complete source-written shape, including the attribution object. */
function recognizedTemporaryEffect(value: JsonValue, type: string, bp: string): boolean {
  if (!isJsonObject(value) || value.permanent !== false || value.eff_type !== type || value.bp !== bp ||
      Object.keys(value).length !== effectFields.size || Object.keys(value).some(key => !effectFields.has(key)) ||
      !int32(value.duration) || !int32(value.intensity) || !int32(value.start_turn) || !isJsonObject(value.source)) return false;
  const source = value.source;
  return Object.hasOwn(source, 'character_id') && Object.hasOwn(source, 'faction_id') &&
    Object.keys(source).every(key => sourceFields.has(key)) &&
    (source.character_id === null || int32(source.character_id)) &&
    (source.faction_id === null || typeof source.faction_id === 'string') &&
    (source.mfaction_id === undefined || typeof source.mfaction_id === 'string');
}

/** Never replace the complete effect map: permanent/unknown state may encode CBMs or mutations. */
function clearRecognizedTemporaryEffects(player: JsonObject, warnings: CompatibilityWarning[], changes: TransferChange[], onlyRiding = false): void {
  if (player.effects === undefined) return;
  if (!isJsonObject(player.effects)) {
    warnings.push({ code: 'UNKNOWN_EFFECTS_PRESERVED', message: 'Unrecognized effects container retained verbatim; no healing claim can be made for it.', path: 'player.effects' });
    return;
  }
  let removed = 0, retainedPermanent = 0, retainedUnknown = 0;
  for (const [type, group] of Object.entries(player.effects)) {
    if (onlyRiding && type !== 'riding') continue;
    if (!isJsonObject(group)) { retainedUnknown++; continue; }
    const removedBeforeGroup = removed;
    for (const [bp, instance] of Object.entries(group)) {
      if (recognizedTemporaryEffect(instance, type, bp)) {
        delete group[bp];
        removed++;
        changes.push({ path: `player.effects.${type}.${bp}`, action: 'remove', reason: 'Complete source-known effect instance explicitly has permanent=false; preserve all permanent and unknown instances.' });
      } else if (isJsonObject(instance) && instance.permanent === true) retainedPermanent++;
      else retainedUnknown++;
    }
    if (Object.keys(group).length === 0 && removed > removedBeforeGroup) delete player.effects[type];
  }
  if (removed) warnings.push({ code: 'TEMPORARY_EFFECTS_REMOVED', message: 'Removed only complete source-recognized explicitly nonpermanent effect instances; these can include beneficial temporary effects.', path: 'player.effects' });
  if (retainedPermanent) warnings.push({ code: 'PERMANENT_EFFECTS_PRESERVED', message: 'Permanent effects retained unchanged to protect mutation/bionic state. Associated source/start-turn data remain unrebased and need target-build review.', path: 'player.effects' });
  if (retainedUnknown) warnings.push({ code: 'UNKNOWN_EFFECTS_PRESERVED', message: 'Unknown effect shapes/fields and instances without an explicit false permanent flag retained unchanged; health/world cleanup is incomplete.', path: 'player.effects' });
}

/**
 * Exact native envelope, with an explicitly separate editor cleanup policy.
 * Native character_to_template itself does NOT perform these cleanup/healing edits.
 */
export function generateTransferTemplate(root: JsonObject, options: TransferOptions = {}): TransferTemplateResult {
  const validation = validateCharacterSave(root);
  if (!validation.valid) throw new SaveFormatError('Character validation failed: ' + validation.issues.map(issue => issue.path).join(', '));
  for (const key of ['cleanWorldReferences', 'restoreHealth', 'randomStartLocation', 'outfitGender'] as const) {
    if (options[key] !== undefined && typeof options[key] !== 'boolean') throw new SaveFormatError(`${key} must be boolean`);
  }
  const random = options.randomStartLocation ?? true;
  if (options.startLocation !== undefined && (typeof options.startLocation !== 'string' || !/^[A-Za-z0-9_:+.\-]+$/.test(options.startLocation))) {
    throw new SaveFormatError('startLocation must be a nonempty content ID');
  }
  if (!random && !options.startLocation) throw new SaveFormatError('Explicit startLocation is required for nonrandom start');
  const player = cloneLosslessJSON(root.player as JsonObject);
  const warnings = [...validation.warnings];
  const changes: TransferChange[] = [];
  const reviewed = new Set(reviewedPreserved);
  const replace = (key: string, value: JsonValue, reason: string) => {
    reviewed.add(key);
    // Always produce explicit safe sentinels where the loader accepts them.
    player[key] = value;
    changes.push({ path: `player.${key}`, action: 'replace', reason });
  };
  const remove = (key: string, reason: string) => {
    reviewed.add(key);
    if (Object.hasOwn(player, key)) {
      delete player[key];
      changes.push({ path: `player.${key}`, action: 'remove', reason });
    }
  };
  if (options.cleanWorldReferences ?? true) {
    replace('id', -1, 'Character::load only assigns valid IDs (>0); a new world must assign a new ID.');
    replace('active_mission', -1, 'avatar::load treats -1 as no active mission.');
    for (const key of ['active_missions', 'completed_missions', 'failed_missions', 'followers', 'known_traps', 'camps', 'omt_path', 'overmap_time', 'backlog', 'queued_effect_on_conditions']) {
      replace(key, [], 'Discard old-world IDs, absolute map positions or pending activity/EOC references.');
    }
    replace('controlling_vehicle', false, 'Do not control an old-world vehicle.');
    replace('in_vehicle', false, 'Do not retain boarding state without its vehicle.');
    replace('grab_point', [0, 0, 0], 'Zero grab point prevents avatar::load from inferring a grabbed vehicle.');
    replace('grab_type', 'OBJECT_NONE', 'No object is grabbed in the new world.');
    for (const key of ['activity', 'destination_activity', 'stashed_outbounds_activity', 'fetch_data', 'activity_vehicle_part_index', 'mounted_creature', 'last_target', 'last_target_type', 'last_target_pos', 'destination_point', 'ammo_location', 'translocators', 'shadow_npc', 'location', 'posx', 'posy', 'posz', 'may_activity_occupancy_after_end_items_loc']) {
      remove(key, 'Omit optional loader input and use fresh-avatar defaults instead of stale world handles.');
    }
    for (const key of ['last_updated', 'last_sleep_check', 'lifespan_end']) {
      remove(key, 'Audited fresh defaults: omitted last_updated loads calendar::turn; last_sleep_check is constructed at turn_zero; lifespan_end is nullopt. Never invent numeric world epochs.');
    }
    replace('faction_warnings', [], 'Clear old faction IDs and fac_warning_time timestamps; fresh warning_record is empty.');
    if (!options.restoreHealth) clearRecognizedTemporaryEffects(player, warnings, changes, true);
    warnings.push({ code: 'NESTED_TIME_REFERENCES_PRESERVED', message: 'Only source-audited top-level clocks were reset via fresh-avatar defaults. Unknown/nested clocks (including retained effects, inventory, CBMs, magic and mod data) remain unchanged and may refer to the old world.' });
    warnings.push({ code: 'CLEANUP_IS_EDITOR_POLICY', message: 'World-reference cleanup is an editor policy, not performed by native save_template. Unknown nested world references (including item ownership, EOC variables and mod fields) may remain.' });
  } else {
    warnings.push({ code: 'WORLD_REFERENCES_RETAINED', message: 'Native avatar fields were retained, including old-world IDs, missions, vehicles and positions; unsafe cross-world references may remain.' });
  }
  if (options.restoreHealth) {
    if (player.hp_cur !== undefined || player.hp_max !== undefined) throw new SaveFormatError('Health reset does not support legacy hp_cur/hp_max arrays that override current body data');
    if (!isJsonObject(player.body) || Object.keys(player.body).length === 0) throw new SaveFormatError('Health reset requires a nonempty current-format body object');
    // Validate every part before touching any: no guessed max HP, no unknown body schema conversion.
    for (const part of Object.values(player.body)) {
      if (!isJsonObject(part) || asSafeInteger(part.hp_max) === undefined || (asSafeInteger(part.hp_max) ?? 0) <= 0 || (asSafeInteger(part.hp_max) ?? 0) > 2147483647) {
        throw new SaveFormatError('Health reset requires a positive signed 32-bit hp_max in every body part');
      }
    }
    for (const [id, partValue] of Object.entries(player.body)) {
      const part = partValue as JsonObject;
      part.hp_cur = part.hp_max;
      for (const key of ['damage_bandaged', 'damage_disinfected', 'healed_total', 'frostbite_timer']) part[key] = 0;
      changes.push({ path: `player.body.${id}`, action: 'replace', reason: 'Restore stored max HP and zero treatment damage/healing/frostbite counters; preserve part IDs and all unknown part fields.' });
    }
    clearRecognizedTemporaryEffects(player, warnings, changes);
    replace('damage_over_time_map', [], 'Remove pending damage-over-time vector entries (Creature::damage_over_time_map).');
    for (const key of ['pain', 'radiation', 'hunger', 'thirst', 'sleepiness', 'sleep_deprivation', 'pkill', 'stim']) replace(key, 0, 'Limited opt-in source-field health reset.');
    warnings.push({ code: 'LIMITED_HEALTH_RESET', message: 'Restored stored body HP, basic distress and only complete source-recognized nonpermanent effects (which may be beneficial). Permanent and unknown effects are retained. Vitamins, calories, addictions, mutations, bionics, temperature, blood loss and mod mechanics are not normalized; full health is NOT verified.' });
  }
  const unreviewed = Object.keys(player).filter(key => !reviewed.has(key));
  if (unreviewed.length) warnings.push({ code: 'UNREVIEWED_FIELDS_PRESERVED', message: 'Unreviewed avatar fields and all unknown nested data were preserved, not silently dropped. Review against the exact game/mod build before importing.', path: 'player' });
  warnings.push({ code: 'NOT_RUNTIME_VERIFIED', message: 'Envelope/field strategy was checked against local 0.I-branch source (save version 36), but no game executable was found. Game loading, mod IDs and runtime migrations are unverified.' });
  const metadata: JsonObject = { limit: 3, random_start_location: random, outfit_gender: options.outfitGender ?? true };
  if (!random) metadata.start_location = options.startLocation as string;
  const template: [JsonObject, JsonObject] = [metadata, player];
  return { template, text: stringifyLosslessJSON(template, 2), warnings, changes, validation, verification: 'source-reviewed-not-runtime-verified' };
}
