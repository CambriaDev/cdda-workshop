import { useApp } from '../../app/context';
import { nestedItems, type ItemInstance, type VehiclePart } from '../../domain/vehicle';

/** Only recorded instance state, never inferred from rated definitions or spawn rules. */
export function PartInstanceState({ part }: { part: VehiclePart }) {
  const { t, name, composition } = useApp();
  const unknown = t('未记录', 'Not recorded');
  const value = (v: unknown) => v === undefined || v === null ? unknown : typeof v === 'boolean' ? (v ? t('是', 'Yes') : t('否', 'No')) : String(v);
  const contents: ItemInstance[] = [];
  let unsupported = false;
  function visit(item: ItemInstance, depth: number) {
    if (depth > 12 || contents.length >= 100) { unsupported = true; return; }
    const nested = nestedItems(item); unsupported ||= nested.unsupported;
    for (const child of nested.items) {
      if (contents.length >= 100) { unsupported = true; break; }
      contents.push(child); visit(child, depth + 1);
    }
  }
  if (part.base) visit(part.base, 0);
  return <section className="instance-state" aria-label={t('已记录实例状态', 'Recorded instance state')}>
    <h4>{t('已记录实例状态', 'Recorded instance state')}</h4>
    <dl className="part-properties">
      <div><dt>{t('损伤（原始值）', 'Damage (raw)')}</dt><dd>{value(part.base?.damaged)}</dd></div>
      <div><dt>{t('老化（原始值）', 'Degradation (raw)')}</dt><dd>{value(part.base?.degradation)}</dd></div>
      <div><dt>{t('启用状态', 'Enabled')}</dt><dd>{value(part.enabled)}</dd></div>
      <div><dt>{t('基础物品储量（charges）', 'Base item charges')}</dt><dd>{value(part.base?.charges)}</dd></div>
      {part.base?.faults && <div><dt>{t('已记录故障', 'Recorded faults')}</dt><dd>{part.base.faults.map(String).join(', ') || t('无', 'None')}</dd></div>}
    </dl>
    {!!contents.length && <details><summary>{t('内部物品／储量记录', 'Contained items / recorded charges')} ({contents.length}{unsupported ? '+' : ''})</summary><ul className="part-capabilities">{contents.map((item, i) => <li key={i}><span>{name(composition?.items[item.typeid ?? ''], item.typeid)} <code>{item.typeid}</code></span><strong>{value(item.charges)} charges</strong></li>)}</ul></details>}
    {!!part.tools?.length && <details><summary>{t('已记录的附加工具', 'Recorded attached tools')} ({part.tools.length})</summary><ul className="part-capabilities">{part.tools.map((item, i) => <li key={i}><span>{name(composition?.items[item.typeid ?? ''], item.typeid)} <code>{item.typeid}</code></span><strong>{value(item.charges)} charges</strong></li>)}</ul></details>}
    {unsupported && <p className="warning-text">{t('内部物品存在未支持结构或超出展示上限；原始数据保留，未推算总储量。', 'Some contents are unsupported or exceed the display limit; originals are retained and no total is inferred.')}</p>}
    <p className="detail-note">{t('未记录不等于零或关闭。额定参数不代表当前实际输出；损伤、故障、供能、环境及游戏规则仍会影响使用。', 'Not recorded does not mean zero or disabled. Ratings are not current output: damage, faults, energy supply, environment and game rules affect operation.')}</p>
  </section>;
}
