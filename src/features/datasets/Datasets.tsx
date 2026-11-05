import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, Check, Database, FileCheck2, Layers, Search, ShieldCheck } from 'lucide-react';
import { useApp } from '../../app/context';
import type { Diagnostic, PackageEntry } from '../../domain/data';
import './Datasets.css';

export function Datasets({ enabled, onChange, busy }: { enabled: string[]; onChange: (ids: string[]) => void; busy: boolean }) {
  const { t, manifest, composition } = useApp();
  const [draft, setDraft] = useState(() => [...new Set(['dda', ...enabled])]); const [search, setSearch] = useState(''); const [diagnosticLimit, setDiagnosticLimit] = useState(100);
  useEffect(() => { setDraft([...new Set(['dda', ...enabled])]); }, [enabled]);
  const entries = manifest?.packages ?? [];
  const byId = useMemo(() => new Map(entries.map(p => [p.id, p])), [entries]);
  const delivered = entries.filter(p => p.distributable && !!p.file); const audit = entries.filter(p => !p.distributable || !p.file);
  const draftIssues = useMemo(() => {
    const issues: string[] = [];
    for (const id of draft) {
      const entry = byId.get(id); if (!entry) { issues.push(`${id}: ${t('没有已交付包', 'No delivered package')}`); continue; }
      for (const dependency of entry.dependencies) {
        if (!draft.includes(dependency)) issues.push(`${id}: ${t('未启用依赖', 'Dependency not enabled')} ${dependency}`);
        else if (draft.indexOf(dependency) > draft.indexOf(id)) issues.push(`${id}: ${t('依赖加载顺序在后', 'Dependency loads later')} ${dependency}`);
      }
      for (const conflict of entry.conflicts ?? []) if (draft.includes(conflict)) issues.push(`${id}: ${t('与以下包冲突', 'Conflicts with')} ${conflict}`);
      if (entry.obsolete) issues.push(`${id}: ${t('源码已声明过期', 'Source declares this package obsolete')}`);
    }
    return issues;
  }, [draft, byId, t]);
  const changed = JSON.stringify(draft) !== JSON.stringify(enabled);
  const filtered = (values: PackageEntry[]) => values.filter(p => `${p.name} ${p.id} ${p.source}`.toLowerCase().includes(search.toLowerCase()));
  const allDiagnostics = [...(manifest?.diagnostics ?? []), ...(composition?.diagnostics ?? [])];
  const counts = allDiagnostics.reduce((result, diagnostic) => ({ ...result, [diagnostic.severity]: result[diagnostic.severity] + 1 }), { error: 0, warning: 0, info: 0 });
  function toggle(id: string, checked: boolean) { setDraft(previous => checked ? [...new Set(['dda', ...previous, id])] : previous.filter(value => value !== id)); }
  function move(index: number, offset: number) { setDraft(previous => { const next = [...previous]; const to = index + offset; if (index <= 0 || to <= 0 || to >= next.length) return previous; [next[index], next[to]] = [next[to], next[index]]; return next; }); }
  function addDependencies() {
    const next: string[] = []; const visited = new Set<string>();
    const visit = (id: string) => { if (visited.has(id)) return; visited.add(id); const entry = byId.get(id); if (!entry?.distributable || !entry.file) return; entry.dependencies.forEach(visit); next.push(id); };
    ['dda', ...draft].forEach(visit); setDraft(next);
  }
  function PackageCard({ entry, auditOnly = false }: { entry: PackageEntry; auditOnly?: boolean }) {
    const checked = draft.includes(entry.id); const active = enabled.includes(entry.id);
    return <article className={`dataset-card ${checked ? 'is-selected' : ''} ${auditOnly ? 'audit-only' : ''}`}>
      <div className="dataset-card-top"><label className="dataset-choice"><input type="checkbox" checked={checked} disabled={busy || auditOnly || entry.id === 'dda'} onChange={event => toggle(entry.id, event.target.checked)} aria-label={`${t('启用', 'Enable')} ${entry.name}`} /><span><strong>{entry.name}</strong><code>{entry.id}</code></span></label><span className={`dataset-badge ${auditOnly ? 'restricted' : active ? 'enabled' : ''}`}>{auditOnly ? t('仅审计 · 未交付', 'AUDIT ONLY · NOT DELIVERED') : active ? t('已交付 · 已启用', 'DELIVERED · ENABLED') : t('已交付 · 未启用', 'DELIVERED · DISABLED')}</span></div>
      <div className="dataset-card-meta"><span><FileCheck2 size={13} />{entry.license ?? t('许可未确认', 'License unconfirmed')}</span><span>{entry.definitionCount.toLocaleString()} {t('条定义', 'definitions')}</span>{entry.obsolete && <span className="warning-text"><AlertTriangle size={13} />{t('源码声明过期', 'Obsolete in source')}</span>}</div>
      <p className="dataset-dependencies">{t('依赖', 'Dependencies')}: {entry.dependencies.join(' → ') || t('无', 'None')}{entry.conflicts?.length ? ` · ${t('冲突', 'Conflicts')}: ${entry.conflicts.join(', ')}` : ''}</p>
      {entry.reasons.length > 0 && <ul className="dataset-reasons">{entry.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>}
      <details><summary>{t('来源与完整性', 'Source & integrity')}</summary><div className="dataset-integrity"><span>{t('只读来源', 'Read-only source')}</span><code>{entry.source}</code><span>SHA-256</span><code>{entry.hash ?? t('未分发，无内容哈希', 'No distributed content hash')}</code>{entry.authors != null && <><span>{t('作者', 'Authors')}</span><span>{Array.isArray(entry.authors) ? entry.authors.join(', ') : String(entry.authors)}</span></>}</div></details>
    </article>;
  }
  return <div className="datasets-page">
    <div className="page-heading"><div><div className="eyebrow">03 / DATA & MODS</div><h1>{t('每一条定义，都有来源。', 'Every definition has a source.')}</h1><p>{t('真实游戏数据、明确许可、可追溯的组合顺序。安装与启用是两回事。', 'Real game data, explicit licenses, traceable load order. Delivered is not enabled.')}</p></div><span className="dataset-trust"><ShieldCheck size={17} />{t('源码与模组只读', 'SOURCE & MODS READ-ONLY')}</span></div>
    {!manifest ? <section className="panel dataset-empty"><Database size={30} /><h2>{t('等待真实数据清单', 'Waiting for dataset manifest')}</h2><p>{t('加载失败时请使用页面上方重试，不会显示虚构包。', 'Use Retry above if loading fails. No placeholder packages are shown.')}</p></section> : <>
      <section className="dataset-version panel"><div><span className="section-label">{t('游戏数据版本', 'GAME DATA VERSION')}</span><h2>{manifest.gameVersion} <span className="tag">{t('已提取', 'EXTRACTED')}</span></h2><code>{manifest.commit}</code></div><div><label>{t('可用版本', 'Available version')}<select value={manifest.gameVersion} aria-label={t('游戏数据版本', 'Game dataset version')} onChange={() => {}}><option value={manifest.gameVersion}>{manifest.gameVersion}</option></select></label><p>{t('只提供此真实提交，不制造其他版本选项。', 'Only this real commit is delivered. No invented versions.')}</p></div></section>
      <div className="dataset-layout"><section className="dataset-catalog"><div className="dataset-section-title"><div><h2><Database size={18} />{t('已交付的数据包', 'Delivered packages')}</h2><p>{delivered.length} {t('个包 · 可分别缓存，启用后才参与解析', 'packages · cacheable separately; only enabled packages are composed')}</p></div><label className="search"><Search size={15} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder={t('搜索名称 / ID', 'Search name / ID')} aria-label={t('搜索数据包', 'Search datasets')} /></label></div>
        <div className="dataset-cards">{filtered(delivered).map(entry => <PackageCard key={entry.id} entry={entry} />)}</div>
        <details className="dataset-audit" open={!!search}><summary>{t('第三方许可与依赖审计', 'Third-party license & dependency audit')} <span className="tag">{audit.length}</span></summary><p className="muted">{t('扫描全部 28 个目录。许可不明的原始内容与翻译不分发、不缓存，也不能勾选。可解析不代表游戏兼容。', 'All 28 directories scanned. Unlicensed originals and translations are neither distributed nor cached and cannot be selected. Parseable does not mean game-compatible.')}</p><div className="dataset-cards">{filtered(audit).map(entry => <PackageCard key={`${entry.source}/${entry.id}`} entry={entry} auditOnly />)}</div></details>
      </section>
      <aside className="dataset-order panel"><div className="panel-heading"><span><Layers size={15} />{t('启用与加载顺序', 'ENABLED LOAD ORDER')}</span><small>{draft.length}</small></div><p>{t('从上到下解析。核心固定最先；顺序会影响覆写与继承。', 'Resolved top to bottom. Core stays first; order affects overrides and inheritance.')}</p><ol>{draft.map((id, index) => <li key={id}><span className="dataset-order-number">{String(index + 1).padStart(2, '0')}</span><span><strong>{byId.get(id)?.name ?? id}</strong><code>{id}</code></span><div><button disabled={busy || index < 2} onClick={() => move(index, -1)} aria-label={`${t('上移', 'Move up')} ${id}`}><ArrowUp size={14} /></button><button disabled={busy || index === 0 || index === draft.length - 1} onClick={() => move(index, 1)} aria-label={`${t('下移', 'Move down')} ${id}`}><ArrowDown size={14} /></button></div></li>)}</ol>
        <div className="dataset-order-actions"><button disabled={busy} onClick={addDependencies}>{t('补齐依赖并排序', 'Add dependencies & sort')}</button><button className="primary" disabled={busy || !changed} onClick={() => onChange([...draft])}>{busy ? t('正在组合…', 'Composing…') : t('应用组合', 'Apply composition')}</button>{changed ? <span className="warning-text">{t('尚未应用 · 当前部件库未改变', 'Not applied · current library is unchanged')}</span> : <span className="dataset-applied"><Check size={13} />{t('与当前组合一致', 'Matches active composition')}</span>}</div>
        {draftIssues.length > 0 && <div className="dataset-draft-warnings" role="status"><strong><AlertTriangle size={14} />{t('待应用组合的警告', 'Draft composition warnings')}</strong><ul>{draftIssues.map((issue, index) => <li key={index}>{issue}</li>)}</ul><small>{t('可带警告应用，解析器会保留缺失项诊断；不是游戏兼容证明。', 'May apply with warnings. Missing data stays diagnostic; this is not game certification.')}</small></div>}
        <p className="dataset-readonly"><ShieldCheck size={15} />{t('仅调整此编辑器的组合，不修改游戏世界 mods.json 或原模组。', 'Changes only this editor’s composition, never the game world or original mods.')}</p>
      </aside></div>
      <section className="dataset-diagnostics panel"><div className="panel-heading"><span><AlertTriangle size={15} />{t('当前组合诊断', 'ACTIVE COMPOSITION DIAGNOSTICS')}</span><small>{allDiagnostics.length}</small></div><div className="dataset-diagnostic-summary"><span>{counts.error} {t('错误', 'errors')}</span><span>{counts.warning} {t('警告', 'warnings')}</span><span>{counts.info} {t('提示', 'notes')}</span><span>{Object.keys(composition?.parts ?? {}).length.toLocaleString()} {t('部件', 'parts')} · {Object.keys(composition?.items ?? {}).length.toLocaleString()} {t('物品', 'items')}</span></div><p>{t('未适配的类型规则不会静默深合并。以下诊断属于已应用组合，不是未应用草案。', 'Unsupported typed rules are not silently deep-merged. Diagnostics below describe the active composition, not the unapplied draft.')}</p>
        <ul className="issue-list dataset-diagnostic-list">{allDiagnostics.slice(0, diagnosticLimit).map((diagnostic: Diagnostic, index) => <li className={diagnostic.severity} key={index}><code>{diagnostic.code}</code><span>{diagnostic.package && <strong>{diagnostic.package} · </strong>}{diagnostic.message}</span>{diagnostic.source && <small>{diagnostic.source}</small>}</li>)}</ul>{allDiagnostics.length > diagnosticLimit && <button onClick={() => setDiagnosticLimit(limit => limit + 100)}>{t('继续显示 100 条', 'Show next 100')} ({diagnosticLimit} / {allDiagnostics.length})</button>}{!allDiagnostics.length && <p className="muted">{composition ? t('当前无解析诊断；不代表已通过真实游戏验收。', 'No current diagnostics; this does not imply real-game validation.') : t('组合尚未加载。', 'Composition is not loaded yet.')}</p>}
      </section>
    </>}
  </div>;
}
