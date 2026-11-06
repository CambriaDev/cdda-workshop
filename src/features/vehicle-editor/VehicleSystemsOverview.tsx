import { useId, useMemo, useState } from 'react';
import { useApp } from '../../app/context';
import type { VehicleIndexes, VehicleModel } from '../../domain/vehicle';
import { analyzeVehicleSystems, type SystemPart, type VehiclePurpose } from '../../domain/vehicle/systems';

interface Props { vehicle: VehicleModel; indexes: VehicleIndexes }
const HP_W = 745.6998715822702;
const checkLabels: Record<string, [string, string]> = {
  'empty-vehicle': ['空载具', 'Empty vehicle'], 'unknown-definitions': ['未解析部件', 'Unresolved parts'],
  'required-engine': ['驱动发动机', 'Propulsion engine'], 'fuel-supply': ['能源供应路径', 'Fuel / energy supply route'],
  'starter-battery': ['启动电源', 'Starter battery'], 'driving-controls': ['驾驶控制', 'Driving controls'],
  'wheel-count': ['车轮配置', 'Wheel configuration'], steering: ['转向配置', 'Steering configuration'],
  'boat-flotation': ['船体浮力', 'Boat flotation'], runtime: ['实际运行状态', 'Runtime state'],
};
const noteLabels: Record<string, [string, string]> = {
  recorded_damage: ['记录有损伤；额定值未按损伤折减。', 'Recorded damage; ratings are not adjusted for damage.'],
  recorded_faults: ['记录有故障；未模拟故障影响。', 'Recorded faults; their effects are not simulated.'],
  recorded_disabled: ['实例记录为关闭；不代表无法启用。', 'Recorded as disabled; this does not establish inability to enable it.'],
  unsupported_capacity: ['容量结构尚不支持或数据不可靠，容量未知。', 'Capacity structure is unsupported or unreliable; capacity is unknown.'],
  restricted_storage: ['储存空间有限制，兼容性不能仅凭容积判断。', 'Storage has restrictions; volume alone does not establish compatibility.'],
  nominal_volume_not_fuel_capacity: ['这是标称容积，并非特定燃料的可装量。', 'Nominal volume, not the usable capacity for a specific fuel.'],
  empty_design: ['尚未安装部件，不作完整性结论。', 'No installed parts; no completeness conclusion is made.'],
  unclassified_parts: ['部分部件定义缺失或不可靠；列表与小计可能不完整。', 'Some part definitions are missing or unreliable; lists and subtotals may be incomplete.'],
  passive_design: ['非自驱或固定设施不要求此项；这不是游戏校验豁免。', 'Not required for this passive / fixed design purpose; this does not bypass game validation.'],
  self_propulsion_only: ['仅检查自主行驶设计是否存在发动机，不保证可以运行。', 'Checks engine presence for self-propulsion only, not operability.'],
  unknown_fuel: ['燃料类型或备选燃料未知。', 'Fuel type or fuel alternatives are unknown.'],
  external_or_no_fuel: ['依赖肌肉、动物、风力或无需常规燃料；运行条件未核实。', 'Uses muscle, animals, wind or no conventional fuel; operating conditions are unverified.'],
  no_compatible_storage: ['未找到可确认兼容的车载储存路径。', 'No confirmed compatible onboard storage route was found.'],
  fuel_amount_not_verified: ['储存路径不代表有足够燃料；当前数量及可用性未核实。', 'A storage route does not establish sufficient fuel; current quantity and availability are unverified.'],
  external_power_not_verified: ['外部电网、跨车供电及可用电量未核实。', 'External grids, cross-vehicle power and available charge are unverified.'],
  starter_requires_battery: ['此启动器需要电池；仅检查车载储存路径。', 'This starter requires a battery; only onboard storage presence is checked.'],
  starter_requirement_unknown: ['无法确认此发动机的启动供电要求。', 'This engine’s starting power requirements are unknown.'],
  local_controls: ['存在本地驾驶控制；未核实可达性、占用及运行状态。', 'Local driving controls exist; access, occupancy and runtime state are unverified.'],
  remote_control_conditions: ['仅发现远程驾驶控制；依赖远程设备与连接条件。', 'Only remote driving controls found; remote equipment and connection conditions apply.'],
  animal_control_conditions: ['仅发现动物控制；依赖动物与操纵条件。', 'Only animal controls found; animal and handling conditions apply.'],
  electronic_is_not_driving: ['电子设备控制不等于驾驶控制。', 'Electronic equipment controls are not driving controls.'],
  boat_not_road_vehicle: ['此设计有浮体而无车轮，不按公路载具要求车轮。', 'This design has flotation and no wheels; road wheel requirements do not apply.'],
  aircraft_not_road_vehicle: ['此设计有旋翼，不按公路载具要求车轮或转向配置。', 'This design has a rotor; road wheel and steering requirements do not apply.'],
  flight_requires_runtime: ['旋翼不证明能够飞行；仍需满足质量、动力、控制及其他运行条件。', 'A rotor does not establish flight capability; mass, power, controls and other operating conditions still apply.'],
  water_steering_requires_flotation: ['水上转向依赖有效浮力及其他运行条件。', 'Water steering depends on adequate flotation and other operating conditions.'],
  intact_design_only: ['仅检查完整设计；不保证损伤后稳定、接地或可行驶。', 'Intact-design check only; stability, ground contact and driving after damage are not guaranteed.'],
  animal_steering_conditional: ['动物牵引等特殊转向路径需另行满足条件。', 'Special steering routes such as animal traction have additional conditions.'],
  flotation_requires_mass_and_state: ['仅有浮体不证明能漂浮；还需总质量、布局及部件状态。', 'Flotation parts alone do not prove buoyancy; total mass, layout and part state matter.'],
  runtime_not_simulated: ['不模拟实际功率、速度、续航、负载、电网缓存、环境或运行状态。', 'Actual power, speed, range, loads, power-network caches, environment and runtime state are not simulated.'],
};

/** Presentation-only purpose and disclosure state never enters the vehicle or undo history. */
export function VehicleSystemsOverview({ vehicle, indexes }: Props) {
  const { t, locale, name, composition } = useApp();
  const [purpose, setPurpose] = useState<VehiclePurpose>('self-propelled');
  const id = useId();
  const report = useMemo(() => analyzeVehicleSystems(vehicle, indexes, purpose), [vehicle, indexes, purpose]);
  const number = (value: number, digits = 2) => value.toLocaleString(locale, { maximumFractionDigits: digits });
  const value = (n: number | null, unit: string, divisor = 1) => n === null ? t('未知', 'Unknown') : `${number(n / divisor, unit === 'kWh' ? 6 : 2)} ${unit}`;
  const subtotal = (known: number, missing: number, unit: string, divisor = 1) => `${value(known, unit, divisor)}${missing ? ` · ${t('已知小计', 'known subtotal')} (${missing} ${t('项未知', 'unknown entries')})` : ''}`;
  const sum = (values: (number | null)[]) => values.reduce<{ known: number; missing: number }>((total, n) => {
    const next = total.known + (n ?? 0);
    if (n === null || !Number.isFinite(next) || Math.abs(next) > Number.MAX_SAFE_INTEGER) total.missing++;
    else total.known = next;
    return total;
  }, { known: 0, missing: report.unknownParts });
  const enginePower = sum(report.engines.map(engine => engine.conditional || engine.fuelOptions === null ? null : engine.ratedPowerW));
  const generation = sum(report.electrical.map(component => component.generationW));
  const consumption = sum(report.electrical.map(component => component.consumptionW));
  const fuelName = (fuel: string) => {
    const special: Record<string, [string, string]> = { muscle: ['肌肉', 'Muscle'], animal: ['动物', 'Animal'], wind: ['风力', 'Wind'], null: ['无需常规燃料', 'No conventional fuel'], battery: ['电池', 'Battery'] };
    return special[fuel] ? t(...special[fuel]) : name(composition?.items[fuel], fuel);
  };
  const notes = (codes: string[]) => codes.length > 0 && <ul className="systems-notes">{codes.map((code, i) => <li key={`${code}:${i}`}>{noteLabels[code] ? t(...noteLabels[code]) : <>{t('未识别的说明：', 'Unrecognized note: ')}<code>{code}</code></>}</li>)}</ul>;
  const identity = (part: SystemPart) => <>
    <strong className="systems-component-name">{name(composition?.parts[part.partId], part.partId)}</strong>
    <p className="systems-component-meta">#{part.partIndex + 1} · ({part.x}, {part.y}) · <code>{part.partId}</code><br />{t('基础物品：', 'Base item: ')}{part.baseItemId ? <code>{part.baseItemId}</code> : t('未知', 'Unknown')}</p>
  </>;
  const statuses = { present: t('存在', 'Present'), missing: t('缺失', 'Missing'), conditional: t('有条件', 'Conditional'), unknown: t('未知', 'Unknown'), 'not-applicable': t('不适用', 'Not applicable') };
  return <section className="vehicle-systems" aria-label={t('动力、能源与完整性', 'Power, energy & completeness')}>
    <header className="systems-heading"><div><h2>{t('动力、能源与完整性', 'Power, energy & completeness')}</h2><p>{t('车上已安装系统 · 额定设计概览，不是可行驶认证。', 'Installed systems · nominal design overview, not a roadworthiness certificate.')}</p></div>
      <label className="systems-purpose" htmlFor={`${id}-purpose`}>{t('校验用途', 'Validation purpose')}<select id={`${id}-purpose`} aria-label={t('校验用途', 'Validation purpose')} value={purpose} onChange={event => setPurpose(event.target.value as VehiclePurpose)}><option value="self-propelled">{t('自主行驶', 'Self-propelled')}</option><option value="passive">{t('非自驱或固定设施', 'Passive / fixed facility')}</option></select></label>
    </header>
    <dl className="systems-summary">
      <div><dt>{t('发动机 · 额定合计', 'ENGINES · RATED SUM')}</dt><dd>{report.engines.length}<small>{subtotal(enginePower.known, enginePower.missing, 'W')} · {subtotal(enginePower.known, enginePower.missing, 'kW', 1000)} · {subtotal(enginePower.known, enginePower.missing, 'hp', HP_W)}</small></dd></div>
      <div><dt>{t('储罐 · 标称容积', 'TANKS · NOMINAL VOLUME')}</dt><dd>{subtotal(report.tankVolume.known, report.tankVolume.missing, 'L', 1000)}</dd></div>
      <div><dt>{t('电池 · 标称容量', 'BATTERIES · NOMINAL CAPACITY')}</dt><dd>{subtotal(report.batteryCapacity.known, report.batteryCapacity.missing, t('充能单位', 'charges'))}<small>{subtotal(report.batteryCapacity.known, report.batteryCapacity.missing, 'kWh', 3600)}</small></dd></div>
      <div><dt>{t('电气组件 · 标称值', 'ELECTRICAL · NOMINAL')}</dt><dd>{report.electrical.length}<small>{t('发电', 'Generation')}: {subtotal(generation.known, generation.missing, 'W')}<br />{t('标称电力负载', 'Nominal electrical load')}: {subtotal(consumption.known, consumption.missing, 'W')}</small></dd></div>
    </dl>
    <p className="systems-limitations">{t('用途仅影响下方提示，不修改载具、项目、导出或撤销历史。零表示已知为零；“已知小计”不把未知项当作零。存在或有条件均不保证实际可运行。', 'Purpose changes these hints only, not the vehicle, project, export or undo history. Zero means known zero; known subtotals do not treat unknown entries as zero. Present or conditional never guarantees operation.')}</p>
    {report.unknownParts > 0 && <p className="systems-unresolved">{t('无法可靠分类的部件：', 'Parts that cannot be reliably classified: ')}{report.unknownParts}</p>}
    <ul className="systems-checks" aria-label={t('完整性提示', 'Completeness hints')}>{report.checks.map((check, i) => <li key={`${check.code}:${i}`} data-system-check={check.code} data-status={check.status} data-severity={check.severity}>
      <div className="systems-check-heading"><strong>{checkLabels[check.code] ? t(...checkLabels[check.code]) : <>{t('系统检查', 'System check')} <code>{check.code}</code></>}{check.partIndices.length > 0 && <span> · #{check.partIndices.map(index => index + 1).join(', #')}</span>}</strong><span className="systems-status" data-status={check.status}>{statuses[check.status]}</span></div>
      {notes(check.notes)}<p>{t('源码参考：', 'Source reference: ')}<code>{check.reference}</code></p>
    </li>)}</ul>
    <details className="systems-details"><summary>{t('发动机完整列表', 'Full engine list')} <small>{report.engines.length}</small></summary>
      <p className="systems-limitations">{t('额定输出不等于当前输出；全负载消耗是能量速率，不是实际油耗或续航。多发动机折减、燃料供给、操作条件与损伤未模拟。', 'Rated output is not current output; full-load consumption is an energy rate, not actual fuel use or range. Multi-engine reduction, fuel supply, operating conditions and damage are not simulated.')}</p>
      {!report.engines.length && <p className="systems-empty">{t('未识别到已安装发动机。', 'No installed engines identified.')}</p>}
      <ul className="systems-component-list">{report.engines.map(engine => <li key={engine.partIndex} data-system-kind="engine" data-system-part-index={engine.partIndex}>{identity(engine)}<dl className="systems-values">
        <div><dt>{t('额定机械输出', 'Rated mechanical output')}</dt><dd>{value(engine.ratedPowerW, 'W')}<br />{value(engine.ratedPowerW, 'kW', 1000)} / {value(engine.ratedPowerW, 'hp', HP_W)}</dd></div>
        <div><dt>{t('额定全负载能源消耗', 'Rated full-load energy consumption')}</dt><dd>{value(engine.fullLoadConsumptionW, 'W')}</dd></div>
        <div><dt>{t('燃料 / 能源选项', 'Fuel / energy alternatives')}</dt><dd>{engine.fuelOptions === null ? t('未知', 'Unknown') : engine.fuelOptions.length ? engine.fuelOptions.map(fuel => <span key={fuel}>{fuelName(fuel)} <code>{fuel}</code><br /></span>) : t('无已知选项', 'No known alternatives')}</dd></div>
      </dl>{engine.conditional && <p className="systems-notes">{t('条件性动力：肌肉、动物或风力的额定值不保证实际输出，在合计中作为未知项，不计入已知小计。', 'Conditional power: muscle, animal or wind ratings do not guarantee actual output; they remain unknown in the aggregate and are excluded from the known subtotal.')}</p>}{notes(engine.notes)}</li>)}</ul>
    </details>
    <details className="systems-details"><summary>{t('储罐、电池与燃料储存完整列表', 'Full tank, battery & fuel storage list')} <small>{report.stores.length}</small></summary>
      <p className="systems-limitations">{t('容量为标称上限；记录的资源数量与当前可用量不同。电池每充能单位按 1 kJ 换算；储罐资源仍显示原始充能数量，不推算液位。', 'Capacity is nominal, not current availability. Battery charges are converted at 1 kJ per charge. Tank resources retain raw charge counts; liquid level is not inferred.')}</p>
      {!report.stores.length && <p className="systems-empty">{t('未识别到已安装储存系统。', 'No installed storage systems identified.')}</p>}
      <ul className="systems-component-list">{report.stores.map(store => <li key={store.partIndex} data-system-kind={store.kind} data-system-part-index={store.partIndex}>{identity(store)}<dl className="systems-values">
        <div><dt>{t('储存类型', 'Storage type')}</dt><dd>{store.kind === 'battery' ? t('电池', 'Battery') : store.kind === 'tank' ? t('储罐', 'Tank') : t('燃料 / 弹药', 'Fuel / ammunition')}</dd></div>
        <div><dt>{store.kind === 'tank' ? t('标称容积', 'Nominal volume') : t('标称容量', 'Nominal capacity')}</dt><dd>{value(store.capacity, store.unit === 'ml' ? 'L' : t('充能单位', 'charges'), store.unit === 'ml' ? 1000 : 1)}{store.kind === 'battery' && <><br />{value(store.capacity, 'kWh', 3600)}</>}</dd></div>
        {store.kind !== 'battery' && <div><dt>{t('部件燃料限定', 'Part fuel restriction')}</dt><dd>{!store.fuelRestrictionKnown ? t('未知', 'Unknown') : store.allowedFuel ? <>{fuelName(store.allowedFuel)} <code>{store.allowedFuel}</code></> : t('未指定；仍受口袋规则限制', 'Unspecified; pocket rules still apply')}</dd></div>}
        {store.ammoTypes.length > 0 && <div><dt>{t('允许的弹药类型', 'Accepted ammo types')}</dt><dd>{store.ammoTypes.map(type => <span key={type}>{fuelName(type)} <code>{type}</code><br /></span>)}</dd></div>}
        <div><dt>{t('记录的资源', 'Recorded resources')}</dt><dd>{store.recordedResources.length ? store.recordedResources.map((resource, i) => <span key={`${resource.itemId}:${i}`}>{name(composition?.items[resource.itemId], resource.itemId)} <code>{resource.itemId}</code>: {value(resource.charges, t('充能单位', 'charges'))}{store.kind === 'battery' && resource.itemId === 'battery' && <> / {value(resource.charges, 'kWh', 3600)}</>}<br /></span>) : store.contentsUnknown ? t('未知', 'Unknown') : t('无记录资源', 'No recorded resources')}</dd></div>
      </dl>{store.contentsUnknown && <p className="systems-notes">{t('资源记录不完整，不能据此判断为空或可供能。', 'Resource records are incomplete; neither emptiness nor usable energy is established.')}</p>}{notes(store.notes)}</li>)}</ul>
    </details>
    <details className="systems-details"><summary>{t('电气与机械负载完整列表', 'Full electrical & mechanical load list')} <small>{report.electrical.length}</small></summary>
      <p className="systems-limitations">{t('以下全部是标称值，不是实时发电、耗电或净功率。电力负载可能仅在启动或特定操作时发生，不代表持续耗电。日照、风、水、发动机驱动、燃料、启用状态及连接条件未模拟；未包含所有动态负载，电动发动机全负载消耗见发动机列表。', 'All values below are nominal, not live generation, consumption or net power. Electrical loads may apply only at startup or during specific operations, not as a continuous drain. Sun, wind, water, engine drive, fuel, enabled state and connections are not simulated. Not all dynamic loads are included; see engines for electric motor full-load consumption.')}</p>
      {!report.electrical.length && <p className="systems-empty">{t('未识别到相关电气或机械负载组件。', 'No relevant electrical or mechanical load components identified.')}</p>}
      <ul className="systems-component-list">{report.electrical.map(component => <li key={component.partIndex} data-system-kind="electrical" data-system-part-index={component.partIndex}>{identity(component)}<dl className="systems-values">
        <div><dt>{t('标称发电', 'Nominal generation')}</dt><dd>{value(component.generationW, 'W')}</dd></div>
        <div><dt>{t('标称电力负载', 'Nominal electrical load')}</dt><dd>{value(component.consumptionW, 'W')}</dd></div>
        <div><dt>{t('额定机械负载', 'Rated mechanical load')}</dt><dd>{value(component.mechanicalLoadW, 'W')}<br />{value(component.mechanicalLoadW, 'hp', HP_W)}</dd></div>
      </dl>{notes(component.notes)}</li>)}</ul>
    </details>
  </section>;
}
