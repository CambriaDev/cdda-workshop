import { useMemo, type ReactNode } from 'react';
import { stripColors, useApp } from '../../app/context';
import { describePart, type PartDetailField, type VehicleIndexes } from '../../domain/vehicle';
import { translationText } from '../../i18n/gettext';
import { getPartDetailLayout, isCapacityDetailField, type PartCapabilityGroup, type PartRole } from './partDetailLayout';

const labels: Record<string, [string, string]> = {
  rotor_effective_diameter: ['旋翼定义直径（基础＋参数）', 'Defined rotor diameter (base + parameter)'],
  rotor_diameter_bonus: ['旋翼直径功能参数', 'Rotor diameter parameter'], muffler_noise_reduction: ['噪声衰减', 'Noise reduction'], funnel_radius: ['集水半径', 'Funnel radius'], shock_absorption: ['减震参数', 'Shock absorption'], damage_reduction: ['伤害减免', 'Damage reduction'],
  connectable_tools: ['可连接的工具类型', 'Connectable tool types'], weight_per_charge: ['每份储量重量', 'Mass per charge'], volume_per_charge: ['每份储量体积', 'Volume per charge'],
  base_description: ['底层物品简介', 'Base item description'], part_qualities: ['部件能力', 'Installed-part qualities'], base_item_qualities: ['底层物品能力', 'Base item qualities'], pseudo_tools: ['伪工具', 'Pseudo-tools'], pocket_count: ['口袋数量', 'Pocket count'], container_watertight: ['防漏液', 'Watertight'], container_airtight: ['气密', 'Airtight'], container_rigid: ['刚性容器', 'Rigid container'],
  basic: ['基础参数', 'Basic specifications'], power: ['动力与能源', 'Power & energy'], capacity: ['储存与容量', 'Storage & capacity'], qualities: ['工具能力', 'Tool qualities'], wheel: ['行驶与车轮', 'Running gear'], protection: ['防护与舒适', 'Protection & comfort'],
  part_id: ['部件 ID', 'Part ID'], base_item_id: ['底层物品', 'Base item'], source: ['部件来源', 'Part source'], base_item_source: ['物品来源', 'Item source'], description: ['简介', 'Description'], weight: ['空部件重量', 'Empty part weight'], volume: ['物品自身占用体积', 'Base item volume'], durability: ['额定耐久', 'Rated durability'], folded_volume: ['折叠体积', 'Folded volume'], location: ['安装层', 'Mounting location'],
  wind_generation_coefficient: ['风力发电系数（非固定功率）', 'Wind generation coefficient (not fixed output)'], cable_loss_percent: ['线缆传输损耗', 'Cable transmission loss'], unclassified_epower: ['未归类 epower（不作运行功率）', 'Unclassified epower (not operating power)'], recharge_demand: ['充电设备条件负载', 'Conditional recharge load'],
  mechanical_output: ['额定机械输出', 'Rated mechanical output'], mechanical_output_hp: ['额定机械马力', 'Rated mechanical horsepower'], mechanical_load: ['机械功率占用', 'Mechanical power draw'], mechanical_load_hp: ['占用马力', 'Horsepower draw'], generation: ['额定发电功率', 'Rated generation'], fixed_consumption: ['固定耗电功率', 'Fixed electrical draw'], full_load_consumption: ['满载能耗功率', 'Full-load energy draw'], fuel_type: ['燃料／能源', 'Fuel / energy'], fuel_options: ['可用燃料', 'Fuel options'],
  cargo_capacity: ['货舱容积', 'Cargo capacity'], container_capacity: ['液体／容器容量', 'Liquid / container capacity'], container_weight_capacity: ['容器重量限制', 'Container weight limit'], ammo_capacity: ['弹药容量', 'Ammo capacity'], battery_capacity: ['电池容量', 'Battery capacity'],
  wheel_diameter: ['轮径', 'Wheel diameter'], wheel_width: ['轮宽', 'Wheel width'], wheel_rolling_resistance: ['滚动阻力系数', 'Rolling resistance'], wheel_contact_area: ['接地面积参数', 'Contact area parameter'], wheel_offroad_rating: ['越野参数', 'Off-road rating'], rotor_diameter: ['旋翼基础直径（另加功能参数）', 'Rotor base diameter (plus parameter)'], wheel_terrain_modifiers: ['地形修正', 'Terrain modifiers'],
  collision_damage_modifier: ['碰撞伤害修正', 'Collision damage modifier'], comfort: ['舒适度', 'Comfort'], floor_bedding_warmth: ['地板寝具保暖参数', 'Floor bedding warmth'], bonus_fire_warmth_feet: ['火源脚部保暖参数', 'Feet fire warmth'], bonus: ['专属功能参数', 'Special-purpose parameter'], cargo_weight_modifier: ['货物重量修正', 'Cargo weight modifier'], jack_capacity: ['JACK 额定顶升', 'JACK rated lifting'], lift_capacity: ['LIFT 额定起吊', 'LIFT rated lifting'], self_jack_capacity: ['SELF_JACK 自顶升', 'SELF_JACK self-jacking'],
  light_intensity: ['灯光亮度参数', 'Light intensity'], horn_volume: ['喇叭音量参数', 'Horn loudness'], muffler_reduction: ['噪声衰减', 'Noise reduction'], recharge_power: ['充电功率', 'Recharge power'], funnel_area: ['集水面积', 'Funnel collection area'], seatbelt_strength: ['安全带强度（当前游戏未启用）', 'Seatbelt strength (inactive in game)'],
};
const damageNames: Record<string, [string, string]> = { all: ['全部伤害', 'all damage'], bash: ['钝击', 'bash'], cut: ['切割', 'cut'], stab: ['穿刺', 'stab'], bullet: ['枪弹', 'bullet'], heat: ['热', 'heat'], acid: ['酸', 'acid'], electric: ['电', 'electric'], cold: ['冷', 'cold'], biological: ['生物', 'biological'], pure: ['纯粹', 'pure'] };

const roleLabels: Record<PartRole, [string, string]> = {
  engine: ['发动机', 'Engine'], alternator: ['交流发电机', 'Alternator'], generator: ['环境发电', 'Environmental generation'], reactor: ['反应堆', 'Reactor'], battery: ['电池', 'Battery'], tank: ['液体储罐', 'Liquid tank'], turret: ['车载武器', 'Turret'], wheel: ['车轮', 'Wheel'], rotor: ['旋翼', 'Rotor'], lighting: ['照明与信号', 'Lighting & signals'], utility: ['设备与工具', 'Appliances & tools'], passenger: ['乘员与寝具', 'Passenger & bedding'], protection: ['防护', 'Protection'], structure: ['结构', 'Structure'], cargo: ['货物储存', 'Cargo storage'], fallback: ['其它／未分类', 'Other / unclassified'],
};

export interface PartDetailsProps { partId: string; indexes: VehicleIndexes; installed?: boolean; testId?: string; afterFeatured?: ReactNode }
export function PartDetails({ partId, indexes, installed = false, testId, afterFeatured }: PartDetailsProps) {
  const { t, name, catalogs, locale, composition } = useApp();
  const model = useMemo(() => describePart(partId, indexes), [partId, indexes]);
  const layout = useMemo(() => getPartDetailLayout(model), [model]);
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
      full_load_battery_mode: ['仅在选用电池供能模式时为耗电；未假定当前选用该燃料。', 'Electrical input only in battery mode; that fuel selection is not assumed.'],
      transmission_loss_not_generation: ['这是传输损耗百分比，不是发电或固定用电功率。', 'A transmission-loss percentage, not generation or fixed electrical demand.'],
      wind_coefficient_not_fixed_generation: ['原始系数还需乘以当地风力，不能作为固定最大输出。', 'The raw coefficient is multiplied by local wind power, not a fixed maximum output.'],
      unclassified_not_generation_or_demand: ['尚未支持此标志组合的运行路径，不直接计为发电或持续用电。', 'This flag combination has no supported operating classification; not counted as generation or continuous draw.'],
      conditional_recharge_load: ['充电设备实际工作时的标称用电预算；另加其本身的运行开销。', 'Nominal demand while actively charging; device running overhead is additional.'],
      engine_running_auxiliary: ['包含发动机运行时的点火／ECU 用电，不是仅启动耗电；启动另有计算。', 'Includes engine-running ignition / ECU demand, not just starting demand; startup is calculated separately.'],
      classified_electrical_role: ['按游戏标志对应的供电路径解释；标称值不保证当前正在运行。', 'Interpreted through source-backed electrical roles; a nominal rating does not prove current operation.'],
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
  const sourcePart = model.advanced.part;
  const sourceBase = model.advanced.baseItem;
  const sourceDescription = (source: typeof sourcePart) => stripColors(translationText(source?.description, catalogs[typeof source?._package === 'string' ? source._package : ''], locale)).trim();
  const description = descriptionField && descriptionField.status !== 'unknown' ? sourceDescription(sourcePart) : '';
  const baseDescription = baseDescriptionField && baseDescriptionField.status !== 'unknown' ? sourceDescription(sourceBase) : '';
  const fallbackDescription = !description && !!baseDescription;
  const fieldsView = (fields: PartDetailField[]) => <dl className="part-properties">{fields.map((field, i) => <div key={`${field.id}-${i}`} data-detail={field.id} data-status={field.status} data-source={field.source} className={field.status === 'unknown' ? 'unknown-value' : ''}><dt>{label(field.id)}</dt><dd>{format(field)}{field.reference && (field.reference.includes('[') || /^(?:ammo_capacity|battery_capacity)/.test(field.id) || field.id === 'bonus') && <small className="detail-reference">{field.reference}</small>}{field.notes.some(code => code !== 'rated_not_actual') && <small className="detail-reference">{field.notes.filter(code => code !== 'rated_not_actual').map(note).join(' ')}</small>}</dd></div>)}</dl>;
  function capabilitiesView(group: PartCapabilityGroup) {
    if (group === 'partQualities' || group === 'baseItemQualities') {
      const source = group === 'partQualities' ? 'part' : 'base_item';
      return <div className="detail-capability-group" data-capability-group={group} key={group}><h4>{group === 'partQualities' ? t('工具能力与等级', 'Tool qualities & levels') : t('底层物品能力（不代表安装后可用）', 'Base item qualities (not necessarily usable when installed)')}</h4><ul className="part-capabilities">{model.qualities.filter(q => q.source === source).map((quality, i) => <li key={`${quality.source}-${quality.id}-${i}`} data-quality={quality.id} data-status={quality.status} data-source={quality.source}><div><strong>{quality.status === 'known' ? t(`${quality.level}级 `, `Level ${quality.level} `) : `${t('未知等级', 'Unknown level')} `}{name(composition?.byType.tool_quality?.[quality.id], quality.id)}</strong> <code>{quality.id}</code><small className="detail-reference">{source === 'part' ? t('安装部件提供；损坏时不可用', 'Provided by installed part; unavailable when broken') : t('底层物品能力；不代表安装后可用', 'Base item quality; not necessarily usable when installed')}{quality.liftingKg !== undefined && ` · ${quality.liftingKg.toLocaleString(locale)} kg`}</small></div></li>)}</ul></div>;
    }
    if (group === 'pseudoTools') return <div className="detail-capability-group" data-capability-group={group} key={group}><h4>{t('提供的伪工具', 'Provided pseudo-tools')}</h4><ul className="part-capabilities">{model.pseudoTools.map((id, index) => {
      const tool = model.pseudoToolDetails?.[index]?.id === id ? model.pseudoToolDetails[index] : model.pseudoToolDetails?.find(candidate => candidate.id === id);
      return <li key={`${id}-${index}`} data-pseudo-tool={id}><div><strong>{name(composition?.items[id], id)}</strong> <code>{id}</code>{tool?.qualities.map((quality, i) => <small key={`${quality.id}-${i}`} data-quality={quality.id} data-status={quality.status} className="detail-reference">{name(composition?.byType.tool_quality?.[quality.id], quality.id)} · {quality.status === 'unknown' ? t('等级未知', 'Unknown level') : t(`${quality.level}级`, `Level ${quality.level}`)}{quality.charged && ` · ${t('需充能', 'Requires charge')}`}</small>)}{tool?.notes.map(n => <small key={n} className="detail-reference">{note(n)}</small>)}</div></li>;
    })}</ul><p className="detail-note">{t('伪工具的用电、充能与动作条件仍受游戏规则限制；不等于人物技能。', 'Pseudo-tool power, charge and action requirements still apply in game; these are not character skills.')}</p></div>;
    return <div className="detail-capability-group" data-capability-group={group} key={group}><h4>{t('可连接的工具类型', 'Connectable tool types')}</h4><ul className="part-capabilities">{model.connectableTools?.map((id, i) => <li key={`${id}-${i}`} data-connectable-tool={id}><span>{name(composition?.items[id], id)} <code>{id}</code></span></li>)}</ul><p className="detail-note">{t('允许连接不代表已经安装或具备可用能力，当前工具仍取决于实例与游戏条件。', 'Compatibility does not mean a tool is installed or usable; actual tools depend on instance state and game conditions.')}</p></div>;
  }
  return <div className="part-specification" data-testid={testId ?? (installed ? 'installed-part-details' : 'library-part-details')}>
    <h3>{name(definition, stripColors(translationText(sourcePart?.name)) || partId)}</h3><code>{partId}</code>
    <p className="description" data-description-source={description ? 'part' : fallbackDescription ? 'base_item' : 'unavailable'}>{description || baseDescription || t('没有可用的可靠简介；可展开高级数据查看原始定义。', 'No reliable description is available; inspect the original definition in advanced data.')}</p>
    {fallbackDescription && <p className="detail-note">{t('简介来源：底层物品', 'Description source: base item')} <code>{model.baseItemId}</code></p>}
    {descriptionField?.notes.includes('field_unreliable') && <p className="detail-note">{t('部件简介的继承语义未解析，见高级数据。', 'Part description inheritance is unresolved; see advanced data.')}</p>}
    {description && baseDescription && baseDescription !== description && <details className="base-description"><summary>{t('底层物品简介', 'Base item description')}</summary><p>{baseDescription}</p></details>}
    <div className="part-role-labels" aria-label={t('部件用途', 'Part purposes')}>{layout.roles.map(role => <span className="part-role-label" key={role} data-role={role} data-primary={role === layout.primaryRole}>{t(...roleLabels[role])}</span>)}</div>
    <p className="detail-note">{t('以下为定义额定值，不是当前实际运行值。', 'Definition ratings below are not current operating values.')}</p>
    {model.notes.length > 0 && <ul className="detail-notes">{model.notes.map((n, i) => <li key={i}>{note(n)}</li>)}</ul>}
    {layout.featuredBlocks.map(block => <details className="spec-section part-featured-block" key={block.id} data-featured-role={block.role ?? block.id} open><summary>{block.role ? t(...roleLabels[block.role]) : block.id === 'essentials' ? t('重量与耐久', 'Weight & durability') : t('工具能力', 'Tool capabilities')}</summary>{block.fields.length > 0 && fieldsView(block.role === 'utility' ? block.fields.filter(field => !isCapacityDetailField(field)) : block.fields)}{block.role === 'utility' && <p className="detail-note detail-core-note">{t('固定耗电不等于全部操作能耗；操作、伪工具或连接工具可能另需供能、充能与启用条件。', 'Fixed draw is not total operating energy; actions, pseudo-tools or connected tools may require additional power, charge and activation conditions.')}</p>}{block.capabilities.map(capabilitiesView)}{block.role === 'utility' && block.fields.some(isCapacityDetailField) && fieldsView(block.fields.filter(isCapacityDetailField))}</details>)}
    {afterFeatured}
    {(layout.remainingSections.length > 0 || layout.secondaryCapabilities.length > 0) && <details className="spec-section part-secondary"><summary>{t('其它参数与底层物品能力', 'Other parameters & base item qualities')}</summary>{layout.remainingSections.map(section => <section key={section.id} data-secondary-section={section.id}><h4>{label(section.id)}</h4>{fieldsView(section.fields)}</section>)}{layout.secondaryCapabilities.map(capabilitiesView)}</details>}
    <details className="spec-section advanced-data"><summary>{t('高级数据与来源', 'Advanced data & sources')}</summary><p className="detail-note">{t('完整已组合的公共定义；未解释字段不代表无效果。原始单位与来源路径保留。', 'Complete composed public definitions. Uninterpreted fields may still have effects; source units and paths are retained.')}</p>{model.flags.length > 0 && <p><strong>{t('标志', 'Flags')}</strong><br />{model.flags.map(flag => <code key={flag} className="detail-flag">{flag}</code>)}</p>}<h4>{t('部件定义', 'Part definition')}</h4><pre>{JSON.stringify(model.advanced.part, null, 2)}</pre><h4>{t('底层物品定义', 'Base item definition')}</h4><pre>{JSON.stringify(model.advanced.baseItem, null, 2)}</pre></details>
  </div>;
}
