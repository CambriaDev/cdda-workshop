import { useMemo } from 'react';
import { stripColors, useApp } from '../../app/context';
import { describePart, type PartDetailField, type VehicleIndexes } from '../../domain/vehicle';
import { translationText } from '../../i18n/gettext';

const labels: Record<string, [string, string]> = {
  rotor_effective_diameter: ['旋翼定义直径（基础＋参数）', 'Defined rotor diameter (base + parameter)'],
  rotor_diameter_bonus: ['旋翼直径功能参数', 'Rotor diameter parameter'], muffler_noise_reduction: ['噪声衰减', 'Noise reduction'], funnel_radius: ['集水半径', 'Funnel radius'], shock_absorption: ['减震参数', 'Shock absorption'], damage_reduction: ['伤害减免', 'Damage reduction'],
  connectable_tools: ['可连接的工具类型', 'Connectable tool types'], weight_per_charge: ['每份储量重量', 'Mass per charge'], volume_per_charge: ['每份储量体积', 'Volume per charge'],
  base_description: ['底层物品简介', 'Base item description'], part_qualities: ['部件能力', 'Installed-part qualities'], base_item_qualities: ['底层物品能力', 'Base item qualities'], pseudo_tools: ['伪工具', 'Pseudo-tools'], pocket_count: ['口袋数量', 'Pocket count'], container_watertight: ['防漏液', 'Watertight'], container_airtight: ['气密', 'Airtight'], container_rigid: ['刚性容器', 'Rigid container'],
  basic: ['基础参数', 'Basic specifications'], power: ['动力与能源', 'Power & energy'], capacity: ['储存与容量', 'Storage & capacity'], qualities: ['工具能力', 'Tool qualities'], wheel: ['行驶与车轮', 'Running gear'], protection: ['防护与舒适', 'Protection & comfort'],
  part_id: ['部件 ID', 'Part ID'], base_item_id: ['底层物品', 'Base item'], source: ['部件来源', 'Part source'], base_item_source: ['物品来源', 'Item source'], description: ['简介', 'Description'], weight: ['空部件重量', 'Empty part weight'], volume: ['物品自身占用体积', 'Base item volume'], durability: ['额定耐久', 'Rated durability'], folded_volume: ['折叠体积', 'Folded volume'], location: ['安装层', 'Mounting location'],
  mechanical_output: ['额定机械输出', 'Rated mechanical output'], mechanical_output_hp: ['额定机械马力', 'Rated mechanical horsepower'], mechanical_load: ['机械功率占用', 'Mechanical power draw'], mechanical_load_hp: ['占用马力', 'Horsepower draw'], generation: ['额定发电功率', 'Rated generation'], fixed_consumption: ['固定耗电功率', 'Fixed electrical draw'], full_load_consumption: ['满载能耗功率', 'Full-load energy draw'], fuel_type: ['燃料／能源', 'Fuel / energy'], fuel_options: ['可用燃料', 'Fuel options'],
  cargo_capacity: ['货舱容积', 'Cargo capacity'], container_capacity: ['液体／容器容量', 'Liquid / container capacity'], container_weight_capacity: ['容器重量限制', 'Container weight limit'], ammo_capacity: ['弹药容量', 'Ammo capacity'], battery_capacity: ['电池容量', 'Battery capacity'],
  wheel_diameter: ['轮径', 'Wheel diameter'], wheel_width: ['轮宽', 'Wheel width'], wheel_rolling_resistance: ['滚动阻力系数', 'Rolling resistance'], wheel_contact_area: ['接地面积参数', 'Contact area parameter'], wheel_offroad_rating: ['越野参数', 'Off-road rating'], rotor_diameter: ['旋翼基础直径（另加功能参数）', 'Rotor base diameter (plus parameter)'], wheel_terrain_modifiers: ['地形修正', 'Terrain modifiers'],
  collision_damage_modifier: ['碰撞伤害修正', 'Collision damage modifier'], comfort: ['舒适度', 'Comfort'], floor_bedding_warmth: ['地板寝具保暖参数', 'Floor bedding warmth'], bonus_fire_warmth_feet: ['火源脚部保暖参数', 'Feet fire warmth'], bonus: ['专属功能参数', 'Special-purpose parameter'], cargo_weight_modifier: ['货物重量修正', 'Cargo weight modifier'], jack_capacity: ['JACK 额定顶升', 'JACK rated lifting'], lift_capacity: ['LIFT 额定起吊', 'LIFT rated lifting'], self_jack_capacity: ['SELF_JACK 自顶升', 'SELF_JACK self-jacking'],
  light_intensity: ['灯光亮度参数', 'Light intensity'], horn_volume: ['喇叭音量参数', 'Horn loudness'], muffler_reduction: ['噪声衰减', 'Noise reduction'], recharge_power: ['充电功率', 'Recharge power'], funnel_area: ['集水面积', 'Funnel collection area'], seatbelt_strength: ['安全带强度（当前游戏未启用）', 'Seatbelt strength (inactive in game)'],
};
const damageNames: Record<string, [string, string]> = { all: ['全部伤害', 'all damage'], bash: ['钝击', 'bash'], cut: ['切割', 'cut'], stab: ['穿刺', 'stab'], bullet: ['枪弹', 'bullet'], heat: ['热', 'heat'], acid: ['酸', 'acid'], electric: ['电', 'electric'], cold: ['冷', 'cold'], biological: ['生物', 'biological'], pure: ['纯粹', 'pure'] };

export function PartDetails({ partId, indexes, installed = false }: { partId: string; indexes: VehicleIndexes; installed?: boolean }) {
  const { t, name, catalogs, locale, composition } = useApp();
  const model = useMemo(() => describePart(partId, indexes), [partId, indexes]);
  const definition = composition?.parts[partId];
  const base = composition?.items[model.baseItemId ?? ''];
  const label = (id: string) => {
    if (id.startsWith('damage_reduction_')) { const damage = id.slice('damage_reduction_'.length); const d = damageNames[damage]; return `${t('伤害减免', 'Damage reduction')} · ${d ? t(...d) : damage}`; }
    const key = id.replace(/_\d+$/, '');
    return labels[id] ? t(...labels[id]) : labels[key] ? t(...labels[key]) : id;
  };
  function format(field: PartDetailField) {
    if (field.status === 'unknown' || field.value === null) return field.notes.includes('field_absent') ? t('未提供', 'Not specified') : t('未知', 'Unknown');
    if (field.id === 'base_item_id') return name(base, String(field.value));
    if (field.id === 'fuel_type') return name(composition?.items[String(field.value)], String(field.value));
    if (typeof field.value === 'boolean') return field.value ? t('是', 'Yes') : t('否', 'No');
    if (typeof field.value !== 'number') return stripColors(String(field.value));
    let value = field.value; let unit = field.unit ?? '';
    if (unit === 'g' && Math.abs(value) >= 1000) { value /= 1000; unit = 'kg'; }
    if (unit === 'ml' && Math.abs(value) >= 1000) { value /= 1000; unit = 'L'; }
    if (unit === 'W' && Math.abs(value) >= 1000) { value /= 1000; unit = 'kW'; }
    return `${value.toLocaleString(locale, { maximumFractionDigits: 3 })}${unit ? ` ${unit}` : ''}`;
  }
  const note = (code: string) => {
    const notes: Record<string, [string, string]> = {
      definition_missing: ['找不到部件或底层物品定义。', 'Part or base item definition is unavailable.'],
      field_unreliable: ['继承或字段语义未解析，不能提供可靠数值。', 'Inheritance or field semantics are unresolved; no reliable value is available.'],
      field_absent: ['源数据未提供该值。', 'The source does not provide this value.'],
      invalid_value: ['字段值或单位未能可靠解释。', 'The field value or unit could not be reliably interpreted.'],
      source_default: ['源码默认值。', 'Source default.'],
      empty_base_item: ['不含货物、燃料和附加工具的空部件。', 'Empty part, excluding cargo, fuel and attached tools.'],
      per_charge_base_item: ['按单份储量计重；不能当作整个部件重量。', 'Mass is per charge; it is not a complete part weight.'],
      rated_not_actual: ['额定值，不代表当前实际运行值。', 'A rating, not a current operating value.'],
      conditional_power: ['受启用状态、驱动或环境条件限制。', 'Depends on activation, drive or environmental conditions.'],
      operating_conditions: ['供能、损伤、故障和游戏环境会影响实际性能。', 'Energy supply, damage, faults and environment affect actual performance.'],
      full_load_electric: ['满载耗电，随动力需求变化；不同于固定耗电。', 'Full-load electrical draw varies with demand; distinct from fixed draw.'],
      full_load_fuel: ['满载燃料能耗功率，不是电池耗电。', 'Full-load fuel energy draw, not electrical draw.'],
      fuel_unknown: ['燃料类型未确定，不能归类为耗电。', 'Fuel is unresolved; this cannot be classified as electrical draw.'],
      nominal_capacity: ['标称上限，不代表当前储量。', 'Nominal maximum, not current contents.'],
      restricted_pocket: ['口袋有物品或弹药限制，不能视为通用空间。', 'Pocket item or ammo restrictions apply; not general-purpose space.'],
      multiple_pockets: ['多个口袋分别列示，不合并为通用容量。', 'Pockets are listed separately, not summed as general capacity.'],
      unsupported_pocket: ['复杂口袋或最终化规则未适配，容量未知。', 'Complex pocket or finalization rules are unsupported; capacity is unknown.'],
      alternative_ammo: ['弹药类型是互斥选择，容量不可相加。', 'Ammo types are alternatives; their capacities cannot be added.'],
      installed_quality: ['安装部件提供；损坏时不可用。', 'Provided by installed part; unavailable when broken.'],
      base_item_quality: ['仅为底层物品能力，不保证安装后可用。', 'A base item quality, not necessarily usable when installed.'],
      self_jack_separate: ['自顶升（SELF_JACK）与通用顶升／起吊不同，不推算通用起重质量。', 'SELF_JACK differs from general JACK/LIFT; no general lifting mass is inferred.'],
      pseudo_tools_not_included: ['伪工具另行列示，未并入部件能力等级。', 'Pseudo-tools are listed separately, not merged into part quality levels.'],
      bonus_contextual: ['功能参数按部件标志解释；未知用途请核对高级数据。', 'Special-purpose parameter interpreted by part flags; see advanced data for unknown uses.'],
      collision_outgoing_percent: ['碰撞时对其他实体的伤害百分比，不是自身减伤。', 'Outgoing collision damage percentage, not protection of this part.'],
      flat_damage_reduction: ['对应伤害类型的固定减免，不是百分比。', 'Flat reduction for this damage type, not a percentage.'],
      comfort_sleeping: ['用于在载具内睡眠的舒适度参数。', 'Comfort parameter for sleeping in the vehicle.'],
    };
    return notes[code] ? t(...notes[code]) : code;
  };
  const basics = model.sections.find(section => section.id === 'basic')?.fields ?? [];
  const descriptionField = basics.find(field => field.id === 'description');
  const baseDescriptionField = basics.find(field => field.id === 'base_description');
  const description = descriptionField?.status !== 'unknown' ? stripColors(translationText(definition?.description, catalogs[definition?._package ?? ''], locale)) : '';
  const baseDescription = baseDescriptionField?.status !== 'unknown' ? stripColors(translationText(base?.description, catalogs[base?._package ?? ''], locale)) : '';
  return <div className="part-specification" data-testid={installed ? 'installed-part-details' : 'library-part-details'}>
    <h3>{name(definition, partId)}</h3><code>{partId}</code>
    <p className="description">{description || (descriptionField?.notes.includes('field_unreliable') ? t('部件简介的继承语义未解析，见高级数据。', 'Description inheritance is unresolved; see advanced data.') : t('没有部件专用简介', 'No part-specific description'))}</p>
    {baseDescription && baseDescription !== description && <details className="base-description"><summary>{t('底层物品简介', 'Base item description')}</summary><p>{baseDescription}</p></details>}
    <p className="detail-note">{t('以下为定义额定值，不是当前实际运行值。', 'Definition ratings below are not current operating values.')}</p>
    {model.sections.map(section => {
      const fields = section.fields.filter(field => !['description', 'base_description', 'part_id', 'source', 'base_item_source'].includes(field.id));
      if (!fields.length) return null;
      return <details className="spec-section" key={section.id} open><summary>{label(section.id)}</summary><dl className="part-properties">{fields.map((field, i) => <div key={`${field.id}-${i}`} data-detail={field.id} data-status={field.status} data-source={field.source} className={field.status === 'unknown' ? 'unknown-value' : ''}><dt>{label(field.id)}</dt><dd>{format(field)}{field.reference && (field.reference.includes('[') || /^(?:ammo_capacity|battery_capacity)/.test(field.id) || field.id === 'bonus') && <small className="detail-reference">{field.reference}</small>}{field.notes.length > 0 && <small className="detail-reference">{field.notes.map(note).join(' ')}</small>}</dd></div>)}</dl></details>;
    })}
    {model.qualities.length > 0 && <details className="spec-section" open><summary>{t('工具能力与等级', 'Tool qualities & levels')}</summary><ul className="part-capabilities">{model.qualities.map((quality, i) => {
      const qualityDef = composition?.byType.tool_quality?.[quality.id];
      return <li key={`${quality.source}-${quality.id}-${i}`} data-quality={quality.id}><div><strong>{quality.status === 'known' ? t(`${quality.level}级 `, `Level ${quality.level} `) : `${t('未知等级', 'Unknown level')} `}{name(qualityDef, quality.id)}</strong> <code>{quality.id}</code><small className="detail-reference">{quality.source === 'part' ? t('安装部件提供；损坏时不可用', 'Provided by installed part; unavailable when broken') : t('底层物品能力；不代表安装后可用', 'Base item quality; not necessarily usable when installed')}{quality.liftingKg !== undefined && ` · ${quality.liftingKg.toLocaleString(locale)} kg`}</small></div></li>;
    })}</ul></details>}
    {!!model.pseudoTools.length && <details className="spec-section" open><summary>{t('提供的伪工具', 'Provided pseudo-tools')}</summary><ul className="part-capabilities">{model.pseudoTools.map((id, index) => {
      const tool = model.pseudoToolDetails?.find(candidate => candidate.id === id);
      return <li key={`${id}-${index}`}><div><strong>{name(composition?.items[id], id)}</strong> <code>{id}</code>{tool?.qualities.map((quality, i) => <small key={`${quality.id}-${i}`} className="detail-reference">{name(composition?.byType.tool_quality?.[quality.id], quality.id)} · {quality.status === 'unknown' ? t('等级未知', 'Unknown level') : t(`${quality.level}级`, `Level ${quality.level}`)}{quality.charged && ` · ${t('需充能', 'Requires charge')}`}</small>)}{tool?.notes.map(n => <small key={n} className="detail-reference">{note(n)}</small>)}</div></li>;
    })}</ul><p className="detail-note">{t('伪工具的用电、充能与动作条件仍受游戏规则限制；不等于人物技能。', 'Pseudo-tool power, charge and action requirements still apply in game; these are not character skills.')}</p></details>}
    {!!model.connectableTools?.length && <details className="spec-section" open><summary>{t('可连接的工具类型', 'Connectable tool types')}</summary><ul className="part-capabilities">{model.connectableTools.map(id => <li key={id}><span>{name(composition?.items[id], id)} <code>{id}</code></span></li>)}</ul><p className="detail-note">{t('允许连接不代表已经安装或具备可用能力，当前工具仍取决于实例与游戏条件。', 'Compatibility does not mean a tool is installed or usable; actual tools depend on instance state and game conditions.')}</p></details>}
    {model.notes.length > 0 && <ul className="detail-notes">{model.notes.map((n, i) => <li key={i}>{note(n)}</li>)}</ul>}
    <details className="spec-section advanced-data"><summary>{t('高级数据与来源', 'Advanced data & sources')}</summary><p className="detail-note">{t('完整已组合的公共定义；未解释字段不代表无效果。原始单位与来源路径保留。', 'Complete composed public definitions. Uninterpreted fields may still have effects; source units and paths are retained.')}</p>{model.flags.length > 0 && <p><strong>{t('标志', 'Flags')}</strong><br />{model.flags.map(flag => <code key={flag} className="detail-flag">{flag}</code>)}</p>}<h4>{t('部件定义', 'Part definition')}</h4><pre>{JSON.stringify(model.advanced.part, null, 2)}</pre><h4>{t('底层物品定义', 'Base item definition')}</h4><pre>{JSON.stringify(model.advanced.baseItem, null, 2)}</pre></details>
  </div>;
}
