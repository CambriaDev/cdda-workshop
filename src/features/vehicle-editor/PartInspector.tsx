import { useEffect, useId, useRef, useState } from 'react';
import { Layers, Plus, Trash2 } from 'lucide-react';
import { useApp } from '../../app/context';
import { flags, isVehicleLibraryPart, type Issue, type VehicleIndexes, type VehicleModel } from '../../domain/vehicle';
import { PartDetails } from './PartDetails';
import { PartInstanceState } from './PartInstanceState';

interface Props {
  chosen: string; indexes: VehicleIndexes; vehicle: VehicleModel; selected: [number, number]; partIndex: number | null;
  onSelectPart: (index: number) => void; onInstall: () => void; onRemove: (index: number) => void;
  onVariant: (index: number, variant: string) => void; issues: Issue[]; validation: Issue[];
}

/** View-only comparison state is deliberately absent from projects, exports and undo history. */
export function PartInspector({ chosen, indexes, vehicle, selected, partIndex, onSelectPart, onInstall, onRemove, onVariant, issues, validation }: Props) {
  const { t, name, composition } = useApp();
  const [mode, setMode] = useState<'installed' | 'compare'>('installed');
  const [reference, setReference] = useState<string | null>(null);
  const [mobilePane, setMobilePane] = useState<'a' | 'b'>('a');
  const left = useRef<HTMLDivElement>(null); const right = useRef<HTMLDivElement>(null);
  const id = useId();
  const current = indexes.parts.get(chosen);
  const canInstall = isVehicleLibraryPart(current);
  const here = vehicle.parts.map((part, index) => ({ part, index })).filter(({ part }) => part.mount_dx === selected[0] && part.mount_dy === selected[1]);
  const inspected = partIndex !== null && here.some(({ index }) => index === partIndex) ? vehicle.parts[partIndex] : undefined;
  const definition = inspected ? indexes.parts.get(inspected.id) : undefined;
  useEffect(() => { left.current?.scrollTo({ top: 0 }); }, [chosen, indexes]);
  useEffect(() => { right.current?.scrollTo({ top: 0 }); }, [mode, reference, partIndex, selected[0], selected[1], indexes]);
  const pin = () => { setReference(chosen); setMode('compare'); };
  return <aside className="inspector panel dual-inspector" aria-label={t('部件检查与对比', 'Part inspection & comparison')}>
    <div className="panel-heading"><span><Layers size={15} />{t('检查与对比', 'INSPECT & COMPARE')}</span><small>{selected[0]}, {selected[1]}</small></div>
    <div className="inspector-mode-bar" role="group" aria-label={t('检查模式', 'Inspection mode')}>
      <button aria-pressed={mode === 'installed'} onClick={() => setMode('installed')}>{t('部件库 + 车上部件', 'Library + installed')}</button>
      <button aria-pressed={mode === 'compare'} onClick={() => setMode('compare')}>{t('部件库 A / B 对比', 'Library A / B')}</button>
    </div>
    <div className="inspector-mobile-tabs" role="group" aria-label={t('显示哪一列', 'Visible column')}>
      <button aria-controls={`${id}-a`} aria-pressed={mobilePane === 'a'} onClick={() => setMobilePane('a')}>{t('部件库 A', 'Library A')}</button>
      <button aria-controls={`${id}-b`} aria-pressed={mobilePane === 'b'} onClick={() => setMobilePane('b')}>{mode === 'installed' ? t('车上部件', 'Installed part') : t('对照 B', 'Reference B')}</button>
    </div>
    <div className="inspector-columns">
      <section className="inspector-column" id={`${id}-a`} aria-label={t('部件库 A', 'Library A')} data-mobile-active={mobilePane === 'a'}>
        <header className="inspector-column-heading"><strong>{t('部件库 A · 额定详情', 'LIBRARY A · RATINGS')}</strong><div className="inspector-column-actions">
          <button className="install-button" disabled={!canInstall} onClick={onInstall}><Plus size={15} />{t('安装到当前格', 'Install on selected tile')}</button>
          <button disabled={!current} onClick={pin}>{t('将当前部件设为对照 B', 'Use current part as B')}</button>
        </div></header>
        <div className="inspector-column-body" ref={left}>
          <p className="detail-note">{t('安装对象是载具部件 ID；底层物品 ID 表示关联物品，不用于自动转换部件。独立家电不列入此库。', 'Installation uses the vehicle part ID. The base item ID identifies the associated item, not a part conversion. Standalone appliances are excluded.')}</p>
          {flags(current).includes('NO_INSTALL_PLAYER') && <p className="detail-note">{t('此部件在游戏中禁止玩家手动安装；编辑器保留其预设设计能力，不模拟玩家技能、工具或材料。', 'The game forbids manual player installation of this part. The editor permits prototype design, not a simulation of player skills, tools or materials.')}</p>}
          {current && !canInstall && <p className="warning-text">{t('当前条目不属于可添加的载具部件库；请选择其他部件。已导入的同类部件仍保留。', 'This entry is not addable from the vehicle library. Choose another part; imported instances are preserved.')}</p>}
          <PartDetails key={chosen} partId={chosen} indexes={indexes} />
          {current?._incomplete === true && <p className="warning-text">{t('此定义包含未适配语义；受影响字段标为未知，原始定义可在高级数据中查看。', 'This definition has unsupported semantics; affected fields are unknown. See advanced data for the definition.')}</p>}
        </div>
      </section>
      <section className="inspector-column" id={`${id}-b`} aria-label={mode === 'installed' ? t('车上部件', 'Installed part') : t('对照 B', 'Reference B')} data-mobile-active={mobilePane === 'b'}>
        <header className="inspector-column-heading"><strong>{mode === 'installed' ? t('车上部件 · 额定值与实例', 'INSTALLED · RATINGS & INSTANCE') : t('对照 B · 固定的部件库条目', 'REFERENCE B · PINNED LIBRARY PART')}</strong>
          {mode === 'compare' && <div className="inspector-column-actions"><button disabled={!current} onClick={pin}>{t('用当前部件替换 B', 'Replace B with current part')}</button><button disabled={!reference} onClick={() => setReference(null)}>{t('清空 B', 'Clear B')}</button></div>}
        </header>
        <div className="inspector-column-body" ref={right}>
          {mode === 'compare' ? reference ? <>
            {reference === chosen && <p className="detail-note" role="status">{t('A 与 B 是同一个部件。', 'A and B are the same part.')}</p>}
            {!indexes.parts.has(reference) && <p className="warning-text" role="status">{t('对照部件在当前数据中不可用；原 ID 保留，请重新选择。', 'Reference unavailable in current data; its ID is retained. Choose another reference.')}</p>}
            <PartDetails key={reference} partId={reference} indexes={indexes} testId="comparison-part-details" />
          </> : <p className="inspector-empty">{t('在部件库选择一个部件，点击“将当前部件设为对照 B”，再选择另一个部件作为 A。', 'Choose a library part, use it as B, then choose another part as A.')}</p> : <>
            <div className="tile-part-picker"><div className="section-label">{t('同格部件 · 安装顺序', 'TILE PARTS · INSTALL ORDER')} <span>{here.length}</span></div>
              {!here.length && <p className="muted">{t('此格暂无部件', 'No parts on this tile')}</p>}
              <div className="tile-part-list">{here.map(({ part, index }) => <div className={`installed-row ${partIndex === index ? 'active' : ''}`} key={index}>
                <button onClick={() => onSelectPart(index)} aria-pressed={partIndex === index}><small>{String(index + 1).padStart(2, '0')}</small><span>{name(composition?.parts[part.id], part.id)}</span></button>
                <button aria-label={`${t('拆除', 'Remove')} ${part.id}`} onClick={() => onRemove(index)}><Trash2 size={13} /></button>
              </div>)}</div>
            </div>
            {inspected ? <div className="part-detail">
              <p className="detail-note">{t('已安装部件', 'Installed part')} #{partIndex! + 1} · ({inspected.mount_dx}, {inspected.mount_dy})</p>
              <PartDetails key={`${partIndex}:${inspected.id}`} partId={inspected.id} indexes={indexes} installed afterFeatured={<PartInstanceState part={inspected} />} />
              {Array.isArray(definition?.variants) && <label className="variant-picker">{t('外观变体', 'Visual variant')}<select value={inspected.variant ?? ''} onChange={event => onVariant(partIndex!, event.target.value)}>{definition.variants.map((value, i) => { const variant = value as Record<string, unknown>; return <option key={i} value={String(variant.id ?? '')}>{String(variant.id || 'default')} · {String(variant.symbols ?? '')}</option>; })}</select></label>}
            </div> : here.length > 0 && <p className="inspector-empty">{t('选择上方同格部件以查看额定详情与已记录实例状态。', 'Select a tile part above to inspect its ratings and recorded instance state.')}</p>}
          </>}
        </div>
      </section>
    </div>
    <details className="inspector-section inspector-diagnostics" open={issues.some(issue => issue.severity === 'error')}><summary>{t('校验与诊断', 'Validation & diagnostics')} <span className="tag">{validation.length + issues.length}</span></summary><ul className="issue-list">{[...issues, ...validation].slice(0, 40).map((issue, i) => <li className={issue.severity} key={i}><code>{issue.code}</code>{issue.message}</li>)}</ul></details>
  </aside>;
}
