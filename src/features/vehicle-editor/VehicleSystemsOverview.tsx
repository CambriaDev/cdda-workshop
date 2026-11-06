import { useId, useMemo, useState, type ReactNode } from 'react';
import { useApp } from '../../app/context';
import { summarizeVehicleSystems, type Metric, type SystemGroup, type VehicleIndexes, type VehicleModel } from '../../domain/vehicle';
import { analyzeVehicleSystems, type ElectricalSystem, type EngineSystem, type StorageSystem, type SystemPart, type VehiclePurpose } from '../../domain/vehicle/systems';

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
  const value = (n: number | null, unit: string, divisor = 1) => n === null ? t('未知', 'Unknown') : `${number(n / divisor, ['W', 'kW', 'kWh'].includes(unit) ? 6 : 2)} ${unit}`;
  const summary = useMemo(() => summarizeVehicleSystems(report), [report]);
  const { totals, groups, loadComponents } = summary;
  const subtotal = (metric: Metric, unit: string, divisor = 1) => metric.missing && metric.known === 0
    ? `${t('未知', 'Unknown')} (${metric.missing} ${t('项未知', 'unknown entries')})`
    : `${value(metric.known, unit, divisor)}${metric.missing ? ` · ${t('已知小计', 'known subtotal')} (${metric.missing} ${t('项未知', 'unknown entries')})` : ''}`;
  const power = (metric: Metric) => `${subtotal(metric, 'W')} · ${subtotal(metric, 'kW', 1000)}`;
  const count = (parts: number, models: number) => t(`${parts} 件 · ${models} 种型号`, `${parts} ${parts === 1 ? 'part' : 'parts'} · ${models} ${models === 1 ? 'model' : 'models'}`);
  const metricBlock = (key: string, label: string, metric: Metric, unit = 'W', divisor = 1) => <div data-system-total={key} key={key}><dt>{label}</dt><dd>{subtotal(metric, unit, divisor)}{unit === 'W' && <><br />{subtotal(metric, 'kW', 1000)}</>}{key === 'enginePower' && <><br />{subtotal(metric, 'hp', HP_W)}</>}{key === 'batteryCapacity' && <><br />{subtotal(metric, 'kWh', 3600)}</>}</dd></div>;
  const fuelName = (fuel: string) => {
    const special: Record<string, [string, string]> = { muscle: ['肌肉', 'Muscle'], animal: ['动物', 'Animal'], wind: ['风力', 'Wind'], null: ['无需常规燃料', 'No conventional fuel'], battery: ['电池', 'Battery'] };
    return special[fuel] ? t(...special[fuel]) : name(composition?.items[fuel], fuel);
  };
  const notes = (codes: string[]) => codes.length > 0 && <ul className="systems-notes">{codes.map((code, i) => <li key={`${code}:${i}`}>{noteLabels[code] ? t(...noteLabels[code]) : <>{t('未识别的说明：', 'Unrecognized note: ')}<code>{code}</code></>}</li>)}</ul>;
  const identity = (part: SystemPart) => <>
    <strong className="systems-component-name">{name(composition?.parts[part.partId], part.partId)}</strong>
    <p className="systems-component-meta">#{part.partIndex + 1} · ({part.x}, {part.y}) · <code>{part.partId}</code><br />{t('基础物品：', 'Base item: ')}{part.baseItemId ? <code>{part.baseItemId}</code> : t('未知', 'Unknown')}</p>
  </>;
  const renderEngine = (engine: EngineSystem) => <li key={engine.partIndex} data-system-kind="engine" data-system-part-index={engine.partIndex}>{identity(engine)}<dl className="systems-values">
    <div><dt>{t('额定机械输出', 'Rated mechanical output')}</dt><dd>{value(engine.ratedPowerW, 'W')}<br />{value(engine.ratedPowerW, 'kW', 1000)} / {value(engine.ratedPowerW, 'hp', HP_W)}</dd></div>
    <div><dt>{t('额定全负载能源消耗', 'Rated full-load energy consumption')}</dt><dd>{value(engine.fullLoadConsumptionW, 'W')}</dd></div>
    <div><dt>{t('燃料 / 能源选项', 'Fuel / energy alternatives')}</dt><dd>{engine.fuelOptions === null ? t('未知', 'Unknown') : engine.fuelOptions.length ? engine.fuelOptions.map(fuel => <span key={fuel}>{fuelName(fuel)} <code>{fuel}</code><br /></span>) : t('无已知选项', 'No known alternatives')}</dd></div>
  </dl>{engine.conditional && <p className="systems-notes">{t('肌肉、动物或风力依赖额外条件，机械输出合计将其作为未知贡献。', 'Muscle, animal or wind power depends on additional conditions and remains an unknown contribution to mechanical output.')}</p>}{notes(engine.notes)}</li>;
  const renderStore = (store: StorageSystem) => <li key={store.partIndex} data-system-kind={store.kind} data-system-part-index={store.partIndex}>{identity(store)}<dl className="systems-values">
    <div><dt>{t('储存类型', 'Storage type')}</dt><dd>{store.kind === 'battery' ? t('电池', 'Battery') : store.kind === 'tank' ? t('储罐', 'Tank') : t('燃料 / 弹药', 'Fuel / ammunition')}</dd></div>
    <div><dt>{store.kind === 'tank' ? t('标称容积', 'Nominal volume') : t('标称容量', 'Nominal capacity')}</dt><dd>{value(store.capacity, store.unit === 'ml' ? 'L' : t('充能单位', 'charges'), store.unit === 'ml' ? 1000 : 1)}{store.kind === 'battery' && <><br />{value(store.capacity, 'kWh', 3600)}</>}</dd></div>
    {store.kind !== 'battery' && <div><dt>{t('部件燃料限定', 'Part fuel restriction')}</dt><dd>{!store.fuelRestrictionKnown ? t('未知', 'Unknown') : store.allowedFuel ? <>{fuelName(store.allowedFuel)} <code>{store.allowedFuel}</code></> : t('未指定；仍受口袋规则限制', 'Unspecified; pocket rules still apply')}</dd></div>}
    {store.ammoTypes.length > 0 && <div><dt>{t('允许的弹药类型', 'Accepted ammo types')}</dt><dd>{store.ammoTypes.map(type => <span key={type}>{fuelName(type)} <code>{type}</code><br /></span>)}</dd></div>}
    <div><dt>{t('记录的资源', 'Recorded resources')}</dt><dd>{store.recordedResources.length ? store.recordedResources.map((resource, i) => <span key={`${resource.itemId}:${i}`}>{name(composition?.items[resource.itemId], resource.itemId)} <code>{resource.itemId}</code>: {value(resource.charges, t('充能单位', 'charges'))}{store.kind === 'battery' && resource.itemId === 'battery' && <> / {value(resource.charges, 'kWh', 3600)}</>}<br /></span>) : store.contentsUnknown ? t('未知', 'Unknown') : t('无记录资源', 'No recorded resources')}</dd></div>
  </dl>{store.contentsUnknown && <p className="systems-notes">{t('资源记录不完整，不能据此判断为空或可供能。', 'Resource records are incomplete; neither emptiness nor usable energy is established.')}</p>}{notes(store.notes)}</li>;
  const renderElectrical = (component: ElectricalSystem) => <li key={component.partIndex} data-system-kind="electrical" data-system-part-index={component.partIndex}>{identity(component)}<dl className="systems-values">
    {!component.roles.includes('cable') && <><div><dt>{t('标称发电', 'Nominal generation')}</dt><dd>{value(component.generationW, 'W')}</dd></div>
    <div><dt>{t('标称运行电力负载', 'Nominal running electrical load')}</dt><dd>{value(component.consumptionW, 'W')}</dd></div></>}
    {component.roles.includes('wind') && <div><dt>{t('风力发电系数（非固定功率）', 'Wind generation coefficient (not fixed output)')}</dt><dd>{value(component.windCoefficientW, 'W')}</dd></div>}
    {component.roles.includes('cable') && <div><dt>{t('线缆传输损耗（非发电）', 'Cable transmission loss (not generation)')}</dt><dd>{value(component.cableLossPercent, '%')}</dd></div>}
    {component.roles.includes('unclassified') && <div><dt>{t('未归类 epower（运行贡献未知）', 'Unclassified epower (unknown operating contribution)')}</dt><dd>{value(component.rawEpowerW, 'W')}</dd></div>}
    {(component.electricDriveLoadW !== 0 || component.electricDriveUnknown) && <div><dt>{t('纯电发动机满载输入', 'Battery-only engine full-load input')}</dt><dd>{value(component.electricDriveLoadW, 'W')}</dd></div>}
    {component.roles.includes('recharge') && <div><dt>{t('充电设备条件负载', 'Conditional recharge load')}</dt><dd>{value(component.rechargeLoadW, 'W')}</dd></div>}
    {component.batteryModeInputW !== 0 && <div><dt>{t('可选电力模式满载输入（未假定已选）', 'Optional battery-mode full-load input (not assumed selected)')}</dt><dd>{value(component.batteryModeInputW, 'W')}</dd></div>}
    <div><dt>{t('额定机械负载', 'Rated mechanical load')}</dt><dd>{value(component.mechanicalLoadW, 'W')}<br />{value(component.mechanicalLoadW, 'hp', HP_W)}</dd></div>
  </dl>{notes(component.notes)}</li>;
  function groupsView<T extends SystemPart>(items: SystemGroup<T>[], kind: string, render: (member: T) => ReactNode, groupMetrics: (group: SystemGroup<T>) => ReactNode) {
    return <ul className="systems-group-list">{items.map(group => {
      const first = group.members[0]!;
      const disabled = group.members.filter(member => member.notes.includes('recorded_disabled')).length;
      const damaged = group.members.filter(member => member.notes.includes('recorded_damage')).length;
      const faults = group.members.filter(member => member.notes.includes('recorded_faults')).length;
      const unknownContents = group.members.filter(member => 'contentsUnknown' in member && member.contentsUnknown).length;
      const warnings = [disabled && t(`${disabled} 件关闭`, `${disabled} disabled`), damaged && t(`${damaged} 件损伤`, `${damaged} damaged`), faults && t(`${faults} 件有故障`, `${faults} with faults`), unknownContents && t(`${unknownContents} 件资源记录不完整`, `${unknownContents} with incomplete contents`)].filter(Boolean).join(' · ');
      const members = <ul className="systems-component-list">{group.members.map(render)}</ul>;
      return <li key={group.key}>{group.members.length === 1 ? members : <details className="systems-group" data-system-group={group.key} data-system-group-part-id={first.partId} data-system-group-kind={kind}>
        <summary><strong>{name(composition?.parts[first.partId], first.partId)}</strong><span className="systems-group-count">× {group.members.length}</span><br /><span className="systems-group-meta"><code>{first.partId}</code> · {t('基础物品：', 'Base item: ')}<code>{first.baseItemId ?? t('未知', 'Unknown')}</code></span><span className="systems-group-metrics">{groupMetrics(group)}</span>{warnings && <span className="systems-group-state">{warnings}</span>}</summary>
        {members}
      </details>}</li>;
    })}</ul>;
  }
  const storageGroups = (kind: StorageSystem['kind']) => groups.stores.filter(group => group.members[0]?.kind === kind);
  const fuelCapacityText = (capacities: { ammoType: string; capacity: Metric }[]) => capacities.length ? capacities.map(capacity => `${fuelName(capacity.ammoType)} (${capacity.ammoType}): ${subtotal(capacity.capacity, t('充能单位', 'charges'))}`).join(' · ') : t('容量未知；不同燃料不可混加', 'Capacity unknown; unlike fuels cannot be added');
  const statuses = { present: t('存在', 'Present'), missing: t('缺失', 'Missing'), conditional: t('有条件', 'Conditional'), unknown: t('未知', 'Unknown'), 'not-applicable': t('不适用', 'Not applicable') };
  return <section className="vehicle-systems" aria-label={t('动力、能源与完整性', 'Power, energy & completeness')}>
    <header className="systems-heading"><div><h2>{t('动力、能源与完整性', 'Power, energy & completeness')}</h2><p>{t('车上已安装系统 · 额定设计概览，不是可行驶认证。', 'Installed systems · nominal design overview, not a roadworthiness certificate.')}</p></div>
      <label className="systems-purpose" htmlFor={`${id}-purpose`}>{t('校验用途', 'Validation purpose')}<select id={`${id}-purpose`} aria-label={t('校验用途', 'Validation purpose')} value={purpose} onChange={event => setPurpose(event.target.value as VehiclePurpose)}><option value="self-propelled">{t('自主行驶', 'Self-propelled')}</option><option value="passive">{t('非自驱或固定设施', 'Passive / fixed facility')}</option></select></label>
    </header>
    <dl className="systems-summary">
      {metricBlock('enginePower', t(`发动机 · ${report.engines.length} 台`, `ENGINES · ${report.engines.length} installed`), totals.enginePower)}
      {metricBlock('tankVolume', t('储罐 · 标称总容量', 'TANKS · TOTAL NOMINAL VOLUME'), totals.tankVolume, 'L', 1000)}
      {metricBlock('batteryCapacity', t('电池 · 总额定容量', 'BATTERIES · TOTAL RATED CAPACITY'), totals.batteryCapacity, t('充能单位', 'charges'))}
      <div><dt>{t('全开标称耗电 / 标称发电', 'ALL-ON DEMAND / NOMINAL GENERATION')}</dt><dd><span data-system-total="electricalDemand">{subtotal(totals.electricalDemand, 'kW', 1000)}</span><small>{t('发电', 'Generation')}: <span data-system-total="generation">{subtotal(totals.generation, 'kW', 1000)}</span></small></dd></div>
    </dl>
    <p className="systems-limitations">{t('用途仅影响下方提示，不修改载具、项目、导出或撤销历史。零表示已知为零；“已知小计”不把未知项当作零。存在或有条件均不保证实际可运行。', 'Purpose changes these hints only, not the vehicle, project, export or undo history. Zero means known zero; known subtotals do not treat unknown entries as zero. Present or conditional never guarantees operation.')}</p>
    {report.unknownParts > 0 && <p className="systems-unresolved">{t('无法可靠分类的部件：', 'Parts that cannot be reliably classified: ')}{report.unknownParts}</p>}
    <ul className="systems-checks" aria-label={t('完整性提示', 'Completeness hints')}>{report.checks.map((check, i) => <li key={`${check.code}:${i}`} data-system-check={check.code} data-status={check.status} data-severity={check.severity}>
      <div className="systems-check-heading"><strong>{checkLabels[check.code] ? t(...checkLabels[check.code]) : <>{t('系统检查', 'System check')} <code>{check.code}</code></>}{check.partIndices.length > 0 && <span> · #{check.partIndices.map(index => index + 1).join(', #')}</span>}</strong><span className="systems-status" data-status={check.status}>{statuses[check.status]}</span></div>
      {notes(check.notes)}<p>{t('源码参考：', 'Source reference: ')}<code>{check.reference}</code></p>
    </li>)}</ul>
    <details className="systems-details" data-system-category="engine"><summary>{t('发动机完整列表', 'Full engine list')} · {count(report.engines.length, groups.engines.length)}<span className="systems-category-summary">{t('总标称机械输出：', 'Total rated mechanical output: ')}{power(totals.enginePower)}</span></summary>
      <dl className="systems-category-totals">
        {metricBlock('enginePower', t('总标称机械输出', 'Total rated mechanical output'), totals.enginePower)}
        {metricBlock('fullLoadInput', t('总满载能源输入（非总耗电）', 'Total full-load energy input (not total electricity)'), totals.fullLoadInput)}
      </dl>
      <p className="systems-limitations">{t('额定输出不等于当前输出；总能源输入可能混合燃油与电力，不可再次加入电气耗电合计。多发动机折减、燃料供给、操作条件与损伤未模拟。', 'Rated output is not current output. Total energy input may mix fuel and electricity and must not be added again to electrical demand. Multi-engine reduction, supply, operating conditions and damage are not simulated.')}</p>
      {!report.engines.length && <p className="systems-empty">{t('未识别到已安装发动机。', 'No installed engines identified.')}</p>}
      {groupsView(groups.engines, 'engine', renderEngine, group => <>{t('总机械输出：', 'Mechanical output: ')}{power(group.totals.enginePower)} / {subtotal(group.totals.enginePower, 'hp', HP_W)}<br />{t('总满载能源输入：', 'Full-load energy input: ')}{power(group.totals.fullLoadInput)}</>)}
    </details>
    <details className="systems-details" data-system-category="storage"><summary>{t('储罐、电池与燃料储存完整列表', 'Full tank, battery & fuel storage list')} · {count(report.stores.length, groups.stores.length)}<span className="systems-category-summary">{t('标称液体总容量：', 'Total nominal liquid volume: ')}{subtotal(totals.tankVolume, 'L', 1000)} · {t('电池总容量：', 'Total battery capacity: ')}{subtotal(totals.batteryCapacity, 'kWh', 3600)}</span></summary>
      <p className="systems-limitations">{t('最大储备按全部容器的标称容量之和展示，不是最大单个容器，也不是当前油量或特定燃料的精确可装量。电池每充能单位按 1 kJ 换算。记录电量不是当前可用电量；未记录的内容保持未知。', 'Reserve capacity is the sum of nominal container capacities, not the largest single container, current fuel, or precise usable capacity for a specific fuel. Battery charges convert at 1 kJ per charge. Recorded charge is not usable energy; absent contents remain unknown.')}</p>
      {!report.stores.length && <p className="systems-empty">{t('未识别到已安装储存系统。', 'No installed storage systems identified.')}</p>}
      {(['tank', 'battery', 'fuel'] as const).map(kind => {
        const items = storageGroups(kind);
        if (!items.length) return null;
        return <section className="systems-storage-kind" data-system-storage-kind={kind} key={kind}>
          <h3>{kind === 'tank' ? t('储液容器', 'Liquid containers') : kind === 'battery' ? t('电池', 'Batteries') : t('其他燃料 / 弹药', 'Other fuel / ammunition')} · {count(items.reduce((total, group) => total + group.members.length, 0), items.length)}</h3>
          <dl className="systems-category-totals">
            {kind === 'tank' && metricBlock('tankVolume', t('标称液体总容量', 'Total nominal liquid capacity'), totals.tankVolume, 'L', 1000)}
            {kind === 'battery' && <>{metricBlock('batteryCapacity', t('总额定储电容量', 'Total rated battery capacity'), totals.batteryCapacity, t('充能单位', 'charges'))}{metricBlock('recordedBattery', t('已记录电量（非可用量）', 'Recorded charge (not usable energy)'), totals.recordedBattery, 'kWh', 3600)}</>}
            {kind === 'fuel' && <div><dt>{t('按兼容弹药类型分别合计', 'Capacity by compatible ammo type')}</dt><dd>{fuelCapacityText(summary.fuelCapacities)}</dd></div>}
          </dl>
          {groupsView(items, kind, renderStore, group => kind === 'tank' ? <>{t('标称总容量：', 'Nominal capacity: ')}{subtotal(group.totals.tankVolume, 'L', 1000)}</> : kind === 'battery' ? <>{t('总额定容量：', 'Rated capacity: ')}{subtotal(group.totals.batteryCapacity, t('充能单位', 'charges'))} / {subtotal(group.totals.batteryCapacity, 'kWh', 3600)}<br />{t('已记录电量：', 'Recorded charge: ')}{subtotal(group.totals.recordedBattery, 'kWh', 3600)}</> : fuelCapacityText(group.fuelCapacities))}
        </section>;
      })}
    </details>
    <details className="systems-details" data-system-category="electrical"><summary>{t('电气与机械负载完整列表', 'Full electrical & mechanical load list')} · {count(report.electrical.length, groups.electrical.length)}<span className="systems-category-summary">{t('全开耗电：', 'All-on demand: ')}{power(totals.electricalDemand)} · {t('标称发电：', 'Nominal generation: ')}{power(totals.generation)}</span></summary>
      <dl className="systems-category-totals">
        {metricBlock('electricalDemand', t('全开标称耗电（含电驱满载、充电设备工作）', 'All-on nominal demand (full-load electric drive + active chargers)'), totals.electricalDemand)}
        {metricBlock('generation', t('总标称发电（非同时保证值）', 'Total nominal generation (not guaranteed simultaneous)'), totals.generation)}
        {metricBlock('mechanicalLoad', t('总机械负载（不计入耗电）', 'Total mechanical load (not electrical demand)'), totals.mechanicalLoad)}
        {metricBlock('accessoryLoad', t('普通设备运行耗电', 'Accessory running demand'), loadComponents.accessoryLoad)}
        {metricBlock('engineAuxiliaryLoad', t('发动机运行辅助耗电', 'Engine-running auxiliary demand'), loadComponents.engineAuxiliaryLoad)}
        {metricBlock('electricDriveLoad', t('纯电发动机满载输入', 'Battery-only engine full-load input'), loadComponents.electricDriveLoad)}
        {metricBlock('rechargeLoad', t('充电设备工作负载', 'Active battery-charger demand'), loadComponents.rechargeLoad)}
        {(loadComponents.batteryModeInput.known > 0 || loadComponents.batteryModeInput.missing > 0) && metricBlock('batteryModeInput', t('可选电力模式满载输入（未假定已选）', 'Optional battery-mode full-load input (not assumed selected)'), loadComponents.batteryModeInput)}
      </dl>
      <p className="systems-limitations">{t('按已安装设备完好、全部开启的标称设计能力统计；已关闭、损坏的设备仍包含在内，并非当前负载。发动机辅助耗电包含运行供电，启动浪涌另未模拟；电驱满载输入只计一次。混合燃料未假定选用电池，因此相关主合计保持不完整。工具、炮塔、外接网络等动态操作耗电不在本固定额定统计范围。', 'Installed design ratings assume intact, all-on equipment; disabled or damaged parts remain included, not current load. Engine auxiliaries include running supply; startup surge is unmodeled. Electric-drive input is counted once. Mixed-fuel battery selection is not assumed, leaving relevant totals incomplete. Dynamic tool, turret and external-network demand is outside this fixed-rating inventory.')}</p>
      <p className="systems-limitations">{t('日照、风、水、发动机驱动、燃料与连接条件未模拟；发电不是可同时达到的最大功率或净充电速度。风力系数不直接当发电功率，输电损耗参数不当发电量。', 'Sun, wind, water, engine drive, fuel and connections are unmodeled. Generation is not a simultaneous maximum or net charge rate. Wind coefficients are not fixed generation, and transfer-loss parameters are not generation.')}</p>
      {!report.electrical.length && <p className="systems-empty">{t('未识别到相关电气或机械负载组件。', 'No relevant electrical or mechanical load components identified.')}</p>}
      {groupsView(groups.electrical, 'electrical', renderElectrical, group => <>{t('全开耗电：', 'All-on demand: ')}{power(group.totals.electricalDemand)} · {t('标称发电：', 'Nominal generation: ')}{power(group.totals.generation)}<br />{t('机械负载：', 'Mechanical load: ')}{power(group.totals.mechanicalLoad)}</>)}
    </details>
  </section>;
}
