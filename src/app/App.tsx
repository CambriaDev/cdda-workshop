import { Component, useCallback, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { ArrowUpRight, Check, Database, DownloadCloud, Globe2, HardDrive, Info, LoaderCircle, ShieldCheck, TrainFront, WifiOff, Wrench } from 'lucide-react';
import { AppContext, stripColors, type Locale } from './context';
import { translationText, type Catalog } from '../i18n/gettext';
import { parseGameColors, type GameColorPalette, type Composition, type DatasetManifest, type ResolvedDefinition } from '../domain/data';
import type { VehicleProject } from '../domain/vehicle';
import { Workbench } from '../features/vehicle-editor/Workbench';
import { Datasets } from '../features/datasets/Datasets';
import { SaveWorkbench } from '../features/character-export/SaveWorkbench';
import { About } from '../features/about/About';
import { offlineAction, type OfflineStatus } from '../storage/offline';
import { loadLocal, saveLocal } from '../storage/local';
class ErrorBoundary extends Component<{ children: ReactNode }, { error: string }> {
  state = { error: '' };
  static getDerivedStateFromError(error: unknown) { return { error: String(error) }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('Application error', error.message, info.componentStack); }
  render() { return this.state.error ? <main className="fatal"><h1>应用遇到错误 / Application error</h1><p>{this.state.error}</p><p>原文件未修改。请重新打开应用或导入备份。 Source files are unchanged.</p><button onClick={() => location.reload()}>重新打开 / Reload</button></main> : this.props.children; }
}
function Shell() {
  const [locale, setLocale] = useState<Locale>('zh-CN'); const t = useCallback((zh: string, en: string) => locale === 'zh-CN' ? zh : en, [locale]);
  const [tab, setTab] = useState<'vehicle' | 'save' | 'data' | 'about'>('vehicle'); const [manifest, setManifest] = useState<DatasetManifest | null>(null); const [composition, setComposition] = useState<Composition | null>(null); const [catalogs, setCatalogs] = useState<Record<string, Catalog>>({}); const [enabled, setEnabled] = useState<string[]>(['dda']);
  const [busy, setBusy] = useState(false); const [progress, setProgress] = useState(''); const [error, setError] = useState(''); const [offline, setOffline] = useState<OfflineStatus>({ state: 'idle' }); const [online, setOnline] = useState(navigator.onLine); const [quota, setQuota] = useState<StorageEstimate | null>(null); const [incoming, setIncoming] = useState<VehicleProject>();
  const [colors, setColors] = useState<GameColorPalette>({});
  const worker = useRef<Worker | null>(null); const request = useRef(0);
  const name = useCallback((d: ResolvedDefinition | undefined, fallback?: string) => stripColors(translationText(d?.name, catalogs[d?._package ?? ''] ?? catalogs.dda, locale)) || d?.id || fallback || '?', [catalogs, locale]);
  const loadData = useCallback((dataManifest: DatasetManifest, ids: string[]) => {
    worker.current?.terminate(); const job = new Worker(new URL('../workers/data.worker.ts', import.meta.url), { type: 'module' }); worker.current = job; const id = ++request.current;
    setBusy(true); setError(''); setProgress('0 / …');
    job.onmessage = event => { if (event.data.id !== request.current) return; const result = event.data; if (result.type === 'progress') setProgress(`${result.done} / ${result.total}`); else if (result.type === 'error') { setError(result.message); setBusy(false); job.terminate(); } else if (result.type === 'result') { setComposition(result.composition); setCatalogs(result.catalogs); setEnabled(ids); setBusy(false); void saveLocal('enabled-mods', ids).catch(() => {}); job.terminate(); } };
    job.onerror = event => { setError(event.message); setBusy(false); };
    job.postMessage({ id, manifest: dataManifest, enabled: ids, base: new URL(`${import.meta.env.BASE_URL}datasets/`, location.href).href });
  }, []);
  useEffect(() => {
    let disposed = false;
    void loadLocal<Locale>('locale').then(value => { if (value && ['zh-CN', 'en-US'].includes(value) && !disposed) setLocale(value); }).catch(() => {});
    Promise.all([fetch(`${import.meta.env.BASE_URL}datasets/manifest.json`).then(r => { if (!r.ok) throw new Error(`Manifest HTTP ${r.status}`); return r.json() as Promise<DatasetManifest>; }), loadLocal<string[]>('enabled-mods').catch(() => undefined)]).then(([m, mods]) => { if (disposed) return; setManifest(m); void fetch(`${import.meta.env.BASE_URL}datasets/${m.gameVersion}/colors.json`).then(r => { if (!r.ok) throw new Error(`Colors HTTP ${r.status}`); return r.json(); }).then(raw => { if (!disposed) setColors(parseGameColors(raw)); }).catch(e => { if (!disposed) setError(String(e)); }); const ids = mods?.filter(id => m.packages.some(p => p.id === id && p.distributable && p.file)) ?? ['dda']; loadData(m, ids.includes('dda') ? ids : ['dda', ...ids]); }).catch(e => { if (!disposed) setError(String(e)); });
    void offlineAction('status', setOffline);
    const update = () => { setOnline(navigator.onLine); void offlineAction('status', setOffline); };
    window.addEventListener('online', update); window.addEventListener('offline', update);
    if (navigator.storage?.estimate) void navigator.storage.estimate().then(setQuota).catch(() => {});
    return () => { disposed = true; worker.current?.terminate(); window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, [loadData]);
  useEffect(() => { document.documentElement.lang = locale; void saveLocal('locale', locale).catch(() => {}); }, [locale]);
  const value = useMemo(() => ({ locale, t, manifest, composition, catalogs, name, colors }), [locale, t, manifest, composition, catalogs, name, colors]);
  return <AppContext.Provider value={value}><div className="app-shell">
    <aside className="sidebar"><a className="brand" href="./" aria-label="CDDA Workshop"><span className="brand-mark"><TrainFront size={21} /></span><span>CDDA<span className="brand-sub">WORKSHOP</span></span></a><div className="sidebar-label">{t('工作空间', 'WORKSPACE')}</div><nav><button className={tab === 'vehicle' ? 'active' : ''} onClick={() => setTab('vehicle')}><Wrench size={18} />{t('载具工坊', 'Vehicle workshop')}<span>01</span></button><button className={tab === 'save' ? 'active' : ''} onClick={() => setTab('save')}><HardDrive size={18} />{t('存档工作台', 'Save workbench')}<span>02</span></button><button className={tab === 'data' ? 'active' : ''} onClick={() => setTab('data')}><Database size={18} />{t('数据与模组', 'Data & mods')}<span>03</span></button><button className={tab === 'about' ? 'active' : ''} onClick={() => setTab('about')}><Info size={18} />{t('关于', 'About')}<span>04</span></button></nav><div className="sidebar-note"><ShieldCheck size={21} /><strong>{t('你的世界，只读访问。', 'Your world. Read-only.')}</strong><p>{t('全部处理在此设备完成。没有上传，没有自动写回。', 'Everything stays on this device. No uploads. No save-file writes.')}</p></div><div className="sidebar-bottom"><div className="version-line"><span className="status-dot" />0.I-1 <small>7b2efa5</small></div><span>LOCAL-FIRST FIELD TOOLS</span></div></aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumb">WORKSHOP <span>/</span> {tab === 'vehicle' ? t('载具编辑器', 'VEHICLE EDITOR') : tab === 'save' ? t('存档工作台', 'SAVE WORKBENCH') : tab === 'data' ? t('数据中心', 'DATA CENTER') : t('关于', 'ABOUT')}</div><div className="topbar-right"><span className="local-badge"><ShieldCheck size={13} />{t('本地处理', 'LOCAL ONLY')}</span><button className="locale" onClick={() => setLocale(l => l === 'zh-CN' ? 'en-US' : 'zh-CN')}><Globe2 size={14} />{locale === 'zh-CN' ? '简体中文' : 'English'}</button></div></header>
    <main>{error && <div className="error-banner" role="alert">{error}<button onClick={() => manifest ? loadData(manifest, enabled) : location.reload()}>{t('重试', 'Retry')}</button></div>}{busy && <div className="loading-banner"><LoaderCircle size={15} className="spin" />{t('正在 Worker 中解析数据组合', 'Resolving data composition in worker')} {progress}<button onClick={() => { worker.current?.terminate(); setBusy(false); setError(t('已取消，保留原组合', 'Cancelled; previous composition retained')); }}>{t('取消', 'Cancel')}</button></div>}
      <div hidden={tab !== 'vehicle'}><Workbench incoming={incoming} onConsumed={() => setIncoming(undefined)} /></div>
      {tab === 'save' && <SaveWorkbench onVehicle={project => { setIncoming(project); setTab('vehicle'); }} />}
      {tab === 'data' && <Datasets enabled={enabled} busy={busy} onChange={ids => manifest && loadData(manifest, ids)} />}
      {tab === 'about' && <About />}
      <section className="offline-strip"><div className={`offline-icon ${offline.state === 'ready' ? 'ready' : ''}`}>{offline.state === 'ready' ? <Check size={19} /> : !online ? <WifiOff size={19} /> : <DownloadCloud size={19} />}</div><div><strong>{offline.state === 'ready' ? t('离线资源已校验并就绪', 'Offline resources verified & ready') : offline.state === 'preparing' ? t('正在下载并逐项校验离线资源…', 'Downloading & verifying offline resources…') : t('让整个工坊离线可用', 'Take the whole workshop offline')}</strong><p>{offline.state === 'preparing' ? `${offline.done ?? 0} / ${offline.total ?? 0} · ${((offline.bytes ?? 0) / 1048576).toFixed(1)} MiB` : offline.state === 'ready' ? t('可断网重开。浏览器清理站点数据后需重新准备。', 'Reopen without a connection. Prepare again if browser storage is cleared.') : t('完整缓存应用与所有已交付数据后，才标记离线就绪。', 'Only marked ready after the app and every delivered dataset are cached.')}{quota?.quota ? ` · ${t('站点可用配额', 'Site quota')} ${(quota.quota / 1073741824).toFixed(1)} GiB` : ''}</p>{offline.message && <small className="warning-text">{offline.message}</small>}</div><button disabled={offline.state === 'preparing' || offline.state === 'unsupported'} onClick={() => void offlineAction('prepare', setOffline)}>{offline.state === 'ready' ? t('检查 / 更新缓存', 'Check / update cache') : t('准备离线使用', 'Prepare offline')}<ArrowUpRight size={14} /></button></section>
      <footer className="page-footer"><span>CDDA WORKSHOP <span>·</span> {t('独立社区工具 / 非官方', 'INDEPENDENT COMMUNITY TOOL / UNOFFICIAL')}</span><span>{t('游戏数据 CC BY-SA 3.0 · 实际游戏导入待验证', 'GAME DATA CC BY-SA 3.0 · GAME IMPORT UNVERIFIED')}</span></footer>
    </main></div></div></AppContext.Provider>;
}
export default function App() { return <ErrorBoundary><Shell /></ErrorBoundary>; }
