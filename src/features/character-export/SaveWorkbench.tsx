import { useEffect, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { createProject, parseJsonSafely, type VehicleProject } from '../../domain/vehicle';
import type { CompatibilityWarning, NearbyVehicle } from '../../domain/save';
import { download, safeFilename } from '../../storage/local';
import type { CharacterSummary, ReadDirectoryHandle, SaveReply, SaveRequest } from '../../workers/save.worker';
import './save.css';

type TemplatePreview = Extract<SaveReply, { type: 'template' }>['result'];
type DirectoryPickerWindow = Window & { showDirectoryPicker?: (options: { mode: 'read' }) => Promise<ReadDirectoryHandle> };
export function SaveWorkbench({ onVehicle }: { onVehicle: (project: VehicleProject) => void }) {
  const { t, composition, manifest, name } = useApp();
  const worker = useRef<Worker | null>(null);
  const [characters, setCharacters] = useState<CharacterSummary[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [directory, setDirectory] = useState(false);
  const [mapCount, setMapCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ phase: string; completed: number; total: number | null } | null>(null);
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState<CompatibilityWarning[]>([]);
  const [vehicles, setVehicles] = useState<NearbyVehicle[]>([]);
  const [scanInfo, setScanInfo] = useState<string | null>(null);
  const [radius, setRadius] = useState(60);
  const [sameZ, setSameZ] = useState(true);
  const [clean, setClean] = useState(true);
  const [health, setHealth] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [template, setTemplate] = useState<TemplatePreview | null>(null);
  const selected = characters.find(character => character.id === selectedId);
  useEffect(() => () => { worker.current?.terminate(); }, []);
  const startWorker = () => {
    worker.current?.terminate();
    const next = new Worker(new URL('../../workers/save.worker.ts', import.meta.url), { type: 'module' });
    worker.current = next;
    next.onmessage = (event: MessageEvent<SaveReply>) => {
      if (worker.current !== next) return;
      const message = event.data;
      if (message.type === 'progress') { setProgress(message); return; }
      setBusy(false); setProgress(null);
      if (message.type === 'error') { setError(message.message); setTemplate(null); setVehicles([]); setScanInfo(null); return; }
      if (message.type === 'opened') {
        setCharacters(message.characters); setSelectedId(message.characters[0]?.id ?? ''); setDirectory(message.directory); setMapCount(message.mapCount); setWarnings(message.warnings);
        if (!message.characters.length) setError(t('没有可读取的角色 .sav 文件。请选择世界目录或 .sav 文件。', 'No readable character .sav files found. Choose a world directory or .sav files.'));
      } else if (message.type === 'scanned') {
        setVehicles(message.vehicles); setWarnings(message.warnings);
        setScanInfo(t(`已扫描 ${message.scannedFiles} 个地图文件、${message.scannedSubmaps} 个子地图；找到 ${message.vehicles.length} 辆车辆。`, `Scanned ${message.scannedFiles} map files / ${message.scannedSubmaps} submaps; found ${message.vehicles.length} vehicles.`));
      } else if (message.type === 'template') setTemplate(message.result);
    };
    next.onerror = () => { if (worker.current !== next) return; next.terminate(); worker.current = null; setBusy(false); setProgress(null); setError(t('Worker 失败，请重新选择存档。', 'Worker failed. Select the source again.')); };
    return next;
  };
  const open = (request: Extract<SaveRequest, { type: 'open' }>) => {
    setCharacters([]); setSelectedId(''); setTemplate(null); setVehicles([]); setScanInfo(null); setWarnings([]); setError(''); setBusy(true); setProgress({ phase: 'enumerating', completed: 0, total: null });
    try { startWorker().postMessage(request); }
    catch { setBusy(false); setProgress(null); setError(t('浏览器无法读取此来源。可改用 .sav 文件导入。', 'This browser cannot read that source. Try importing .sav files instead.')); }
  };
  const chooseDirectory = async () => {
    const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
    if (!picker) { setError(t('浏览器不支持目录选择；请使用下方 .sav 文件导入（无地图扫描）。', 'Directory picker is unavailable; import .sav files below (without map scanning).')); return; }
    try { const handle = await picker.call(window, { mode: 'read' }); open({ type: 'open', directory: handle }); }
    catch (err) { if (!(err instanceof DOMException && err.name === 'AbortError')) setError(t('目录读取未获授权或不可用。未请求写入权限。', 'Directory read permission was denied or unavailable. No write permission was requested.')); }
  };
  const send = (request: SaveRequest) => {
    if (!worker.current) { setError(t('请重新选择存档。', 'Select the source again.')); return; }
    setError(''); setBusy(true); setProgress({ phase: request.type === 'scan' ? 'maps' : 'template', completed: 0, total: null });
    if (request.type === 'scan') { setVehicles([]); setScanInfo(null); }
    if (request.type === 'template') setTemplate(null);
    worker.current.postMessage(request);
  };
  const cancel = () => {
    worker.current?.terminate(); worker.current = null;
    setBusy(false); setProgress(null); setCharacters([]); setSelectedId(''); setTemplate(null); setVehicles([]); setScanInfo(null); setWarnings([]);
    setError(t('已终止 Worker 并释放存档。继续前请重新选择来源。', 'Worker terminated and save data released. Select the source again to continue.'));
  };
  const changeCharacter = (id: string) => { setSelectedId(id); setTemplate(null); setVehicles([]); setScanInfo(null); setWarnings([]); setError(''); };
  const itemName = (id: string) => name(composition?.items[id], id);
  const definitionName = (type: string, id: string) => name(composition?.byType[type]?.[id], id);
  const renderWarnings = (items: CompatibilityWarning[]) => !!items.length && <ul className="issue-list">{items.slice(0, 100).map((warning, index) => <li key={`${warning.code}-${index}`}><code>{warning.code}</code> — {warning.message}</li>)}{items.length > 100 && <li>{t(`另有 ${items.length - 100} 条诊断。`, `${items.length - 100} more diagnostics.`)}</li>}</ul>;
  const openVehicle = (nearby: NearbyVehicle) => {
    try {
      const project = createProject(parseJsonSafely(nearby.snapshot) as Parameters<typeof createProject>[0], { gameVersion: manifest?.gameVersion, saveVersion: selected?.version ?? undefined, modOrder: selected?.mods ?? [], source: { kind: 'read-only-nearby-snapshot', absolute: [...nearby.absolute] } });
      onVehicle(project);
    } catch { setError(t('车辆快照不符合编辑器结构；未修改或写回存档。', 'Vehicle snapshot is incompatible with the editor structure. No save data was changed.')); }
  };
  return <section className="save-workbench">
    <header className="page-heading"><div><div className="eyebrow">SAVE / TRANSFER</div><h1>{t('存档与角色迁移', 'Save & character transfer')}</h1><p>{t('只读本地世界，提取角色模板与附近车辆快照。', 'Read a local world to prepare character templates and nearby vehicle snapshots.')}</p></div></header>
    <div className="notice">{t('隐私：完整存档只保留在当前 Worker 内存，不上传、不写入浏览器持久化存储、不回写游戏文件。请先退出游戏并备份。目录选择只请求 read 权限。', 'Privacy: full saves remain in this Worker’s memory only: no upload, browser persistence, or writes to game files. Exit the game and back up first. Directory selection requests read permission only.')}</div>
    <section className="panel"><h2>{t('1 · 选择来源与角色', '1 · Select source & character')}</h2><div className="heading-actions"><button className="primary" disabled={busy} onClick={() => void chooseDirectory()}>{t('只读打开世界目录', 'Open world directory (read-only)')}</button><label className="save-file-input">{t('或选择 .sav 文件（可多选）', 'Or choose .sav files (multiple allowed)')}<input type="file" accept=".sav" multiple disabled={busy} onChange={event => { const files = Array.from(event.target.files ?? []); if (files.length) open({ type: 'open', files }); event.target.value = ''; }} /></label></div>
      <p className="save-muted">{t('推荐选择包含 mods.json、角色 .sav 和 maps/ 的单个世界目录；普通文件导入仍可导出角色，但不扫描地图。', 'Choose one world folder containing mods.json, character .sav files and maps/. File-only import can export characters but cannot scan maps.')}</p>
      {busy && <div className="save-progress" role="status" aria-live="polite"><span>{t('处理中', 'Working')}: {progress ? `${progress.phase} · ${progress.completed}${progress.total === null ? '' : ` / ${progress.total}`}` : '…'}</span><progress value={progress?.total ? progress.completed : undefined} max={progress?.total || undefined} /><button onClick={cancel}>{t('取消并终止 Worker', 'Cancel & terminate Worker')}</button></div>}
      {error && <div className="callout" role="alert">{error}</div>}
      {!!characters.length && <label className="save-field">{t('角色', 'Character')}<select value={selectedId} disabled={busy} onChange={event => changeCharacter(event.target.value)}>{characters.map(character => <option key={character.id} value={character.id}>{character.name} · v{character.version ?? '?'}</option>)}</select></label>}
      {renderWarnings(warnings)}
    </section>
    {selected && <>
      <section className="panel"><h2>{selected.name}</h2><dl className="save-summary"><div><dt>{t('力量 / 敏捷 / 智力 / 感知', 'STR / DEX / INT / PER')}</dt><dd>{selected.stats.join(' / ')}</dd></div><div><dt>{t('配方 / 背包顶层条目', 'Recipes / top-level inventory entries')}</dt><dd>{selected.recipes} / {selected.inventoryEntries}</dd></div><div><dt>{t('世界模组顺序（mods.json）', 'World mod order (mods.json)')}</dt><dd>{selected.mods.join(' → ') || t('未读取或为空；未验证依赖', 'Unavailable or empty; dependencies unverified')}</dd></div><div><dt>{t('绝对坐标', 'Absolute coordinates')}</dt><dd>{selected.coordinates?.join(', ') ?? t('不可用', 'Unavailable')}</dd></div></dl>
        {!!selected.mods.length && <p className="save-muted">{t('当前数据集未启用的模组：', 'Mods not enabled in the current dataset: ')}{selected.mods.filter(id => !composition?.enabledIds.includes(id)).join(', ') || t('无（不代表游戏加载验证）', 'None (not game-load verification)')}</p>}
        <h3 className="section-label">{t('成长摘要', 'Progression summary')}</h3><p>{t('技能', 'Skills')}: {selected.skills.map(skill => `${definitionName('skill', skill.id)} ${skill.level}`).join(' · ') || '—'}</p><p>{t('特性 / 变异', 'Traits / mutations')}: {selected.traits.map(id => definitionName('mutation', id)).join(' · ') || '—'}</p><p>{t('仿生装置', 'Bionics')}: {selected.bionics.map(id => definitionName('bionic', id)).join(' · ') || '—'}</p>
        <h3 className="section-label">{t('装备摘要', 'Equipment summary')}</h3><p>{selected.equipment.map(item => `${item.slot === 'weapon' ? t('手持', 'Wielded') : t('穿戴', 'Worn')}: ${itemName(item.id)}`).join(' · ') || t('无已识别装备；原始背包与嵌套内容仍原样保留在模板中。', 'No recognized equipment; original inventory and nested content are still preserved in the template.')}</p>
        {!!selected.issues.length && <ul className="issue-list">{selected.issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}{renderWarnings(selected.warnings)}
      </section>
      <section className="panel"><h2>{t('2 · 原生 TRANSFER 角色模板', '2 · Native TRANSFER character template')}</h2><label className="save-field">{t('模板文件名', 'Template filename')}<input aria-label={t('模板文件名', 'Template filename')} value={templateName} placeholder={selected.name} maxLength={120} onChange={event => setTemplateName(event.target.value)} /></label><div className="callout">{t('这是原生双对象数组模板（limit: 3），不是修改后的 .sav。已对照源码，尚未在游戏中验证；需相同内容与模组，在备份 / 测试世界中加载。未知字段被保留不等于已理解或兼容。', 'This is a native two-object template array (limit: 3), not an edited .sav. Source-reviewed, NOT game-tested. Matching content/mods are required; test in a backed-up world. Preserving unknown fields does not prove compatibility.')}</div>
        <div className="save-options"><label><input type="checkbox" checked={clean} disabled={busy} onChange={event => { setClean(event.target.checked); setTemplate(null); }} />{t('清理已审查的旧世界引用（推荐）', 'Clean reviewed old-world references (recommended)')}</label><label><input type="checkbox" checked={health} disabled={busy} onChange={event => { setHealth(event.target.checked); setTemplate(null); }} />{t('明确启用：有限生命状态重置', 'Explicit opt-in: limited health reset')}</label></div>
        <p className="save-muted">{t('生命重置并非完整医疗模拟：按现有 hp_max 恢复、仅清理可识别的临时 effects 和部分状态（永久/未知效果保留）；不重新计算最大生命，也不重置维生素、热量或全部模组疾病。默认不启用。清理旧世界引用是编辑器策略，并非原生导出自动行为。', 'Health reset is not a full medical simulation: it restores existing hp_max, clears recognized temporary effects and selected states (permanent/unknown effects are retained). It does not recalculate max HP or reset vitamins, calories, or every mod disease. Off by default. World-reference cleanup is editor policy, not native export behavior.')}</p>
        <div className="heading-actions"><button className="primary" disabled={busy || !selected.valid} onClick={() => send({ type: 'template', characterId: selected.id, options: { cleanWorldReferences: clean, restoreHealth: health } })}>{t('生成预览', 'Generate preview')}</button>{template && <button disabled={busy} onClick={() => download(safeFilename(`${templateName.trim() || selected.name}.template`), template.text)}>{t('下载 .template', 'Download .template')}</button>}</div>
        {template && <><p>{t('把下载文件放入游戏的角色模板目录；创建角色时选择该模板。不要覆盖源存档。', 'Place the downloaded file in the game’s character-template directory and select it during character creation. Do not overwrite source saves.')}</p>{renderWarnings(template.warnings)}<details><summary>{t(`变更审计（${template.changes.length}）`, `Change audit (${template.changes.length})`)}</summary><ul className="issue-list">{template.changes.map((change, i) => <li key={i}><code>{change.path}</code> · {change.action} — {change.reason}</li>)}</ul></details><details open><summary>{t('模板文本预览', 'Template text preview')}</summary><pre className="preview save-preview">{template.text.length > 120000 ? `${template.text.slice(0, 120000)}\n… ${t('预览截断；下载包含完整无损文本。', 'Preview truncated; download contains the complete lossless text.')}` : template.text}</pre></details></>}
      </section>
      <section className="panel"><h2>{t('3 · 附近车辆（只读快照）', '3 · Nearby vehicles (read-only snapshots)')}</h2><p>{t('默认全扫当前世界所有 .map，读取并发为 2，不根据地图文件名过滤以避免漏车。距离按车辆锚点的平面欧氏距离（含边界），不是车辆边缘。', 'Scans every .map in this world by default, with two concurrent readers and no filename filtering to avoid missing vehicles. Distance is inclusive planar Euclidean distance to the vehicle anchor, not its edge.')}</p><div className="save-options"><label>{t('半径（格）', 'Radius (tiles)')} <input type="number" min="0" max="1000000" step="1" value={radius} disabled={busy} onChange={event => { setRadius(Number(event.target.value)); setVehicles([]); setScanInfo(null); }} /></label><label><input type="checkbox" checked={sameZ} disabled={busy} onChange={event => { setSameZ(event.target.checked); setVehicles([]); setScanInfo(null); }} />{t('仅同一 Z 层', 'Same Z level only')}</label><button disabled={busy || !directory || !selected.coordinates || !Number.isSafeInteger(radius) || radius < 0 || radius > 1000000} onClick={() => send({ type: 'scan', characterId: selected.id, radius, sameZ })}>{t(`扫描地图（已枚举 ${mapCount} 个）`, `Scan maps (${mapCount} enumerated)`)}</button></div>
        {!directory && <p className="notice">{t('当前为普通 .sav 导入，无目录访问权限；角色导出不受影响。', 'File-only .sav import has no directory access; character export remains available.')}</p>}<p className="save-muted">{t('读取前后及扫描结束会核对文件大小 / 修改时间；这不是原子快照，无法发现被还原为相同时间与大小的修改。请关闭游戏；出现变化会丢弃结果。取消会真正终止 Worker。', 'Size and modification time are checked around reads and at scan completion. This is not an atomic snapshot and cannot detect edits restored to identical metadata. Close the game; detected changes discard results. Cancel actually terminates the Worker.')}</p>
        {scanInfo && <p role="status">{scanInfo}</p>}<div className="save-vehicles">{vehicles.map((vehicle, index) => <article className="save-vehicle" key={`${vehicle.inputId}-${vehicle.submapIndex}-${vehicle.vehicleIndex}`}><div><h3>{vehicle.name || vehicle.type || t(`车辆 ${index + 1}`, `Vehicle ${index + 1}`)}</h3><p>{t('距离', 'Distance')}: {vehicle.distance.toFixed(1)} · {vehicle.absolute.join(', ')} · {vehicle.partCount ?? '?'} {t('部件', 'parts')}</p></div><button disabled={busy} onClick={() => openVehicle(vehicle)}>{t('在车辆编辑器中打开副本', 'Open a copy in vehicle editor')}</button></article>)}</div>
      </section>
    </>}
    <section className="panel"><h2>{t('其他存档编辑功能 · 施工中', 'Other save editors · Under construction')}</h2><p className="save-muted">{t('本期只提供角色模板导出与附近车辆快照；背包直接修改、NPC / 地图 / 世界编辑暂不开放，也不会写回存档。', 'This release only offers character templates and nearby vehicle snapshots. Direct inventory, NPC, map and world editing are not available; no save write-back is provided.')}</p><div className="heading-actions"><button disabled>{t('背包编辑 · 施工中', 'Inventory editor · Planned')}</button><button disabled>{t('地图 / NPC 编辑 · 施工中', 'Map / NPC editors · Planned')}</button></div></section>
  </section>;
}
