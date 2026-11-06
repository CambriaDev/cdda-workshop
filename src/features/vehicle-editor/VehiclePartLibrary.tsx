import { useMemo, useState } from 'react';
import { Box, ChevronRight, Search } from 'lucide-react';
import { useApp } from '../../app/context';
import type { VehicleLibrary } from '../../domain/vehicle';
import { translationText } from '../../i18n/gettext';

const PAGE_SIZE = 160;

/** Presentation of the rebuilt vehicle-only catalog; item indexes never enter it. */
export function VehiclePartLibrary({ library, chosen, onChoose }: { library: VehicleLibrary; chosen: string; onChoose: (id: string) => void }) {
  const { t, name, locale } = useApp();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [source, setSource] = useState('');
  const definitions = useMemo(() => library.entries.map(entry => ({
    ...entry,
    label: name(entry.definition),
    english: translationText(entry.definition.name, undefined, 'en-US'),
  })).sort((a, b) => a.label.localeCompare(b.label, locale) || a.id.localeCompare(b.id, 'en')), [library, name, locale]);
  const categories = useMemo(() => [...new Set(definitions.flatMap(({ definition }) => Array.isArray(definition.categories) ? definition.categories.filter((value): value is string => typeof value === 'string') : []))].sort(), [definitions]);
  const sources = useMemo(() => [...new Set(definitions.map(({ definition }) => definition._package))].sort(), [definitions]);
  // A removed mod/category must not leave the newly generated catalog filtered to nothing.
  const activeCategory = categories.includes(category) ? category : '';
  const activeSource = sources.includes(source) ? source : '';
  const matches = useMemo(() => {
    const query = search.trim().toLowerCase();
    return definitions.filter(({ definition, id, label, english }) =>
      (!activeCategory || (Array.isArray(definition.categories) && definition.categories.includes(activeCategory))) &&
      (!activeSource || definition._package === activeSource) &&
      `${id} ${label} ${english}`.toLowerCase().includes(query));
  }, [definitions, activeCategory, activeSource, search]);
  const visible = matches.slice(0, PAGE_SIZE);

  return <aside className="library panel" aria-label={t('载具部件库', 'Vehicle part library')}>
    <div className="panel-heading"><span><Box size={15} />{t('载具部件库', 'VEHICLE PARTS')}</span><small>{library.entries.length}</small></div>
    <div className="library-filters">
      <label className="search"><Search size={15} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder={t('搜索名称 / ID', 'Search name / ID')} aria-label={t('搜索部件', 'Search parts')} /></label>
      <div className="filter-row">
        <select value={activeCategory} onChange={event => setCategory(event.target.value)} aria-label={t('分类', 'Category')}><option value="">{t('全部分类', 'All categories')}</option>{categories.map(value => <option key={value}>{value}</option>)}</select>
        <select value={activeSource} onChange={event => setSource(event.target.value)} aria-label={t('来源', 'Source')}><option value="">{t('全部来源', 'All sources')}</option>{sources.map(value => <option key={value}>{value}</option>)}</select>
      </div>
    </div>
    <div className="part-list">{visible.map(({ definition, id, label, playerInstallationForbidden }) => <button className={`part-row ${chosen === id ? 'active' : ''}`} key={id} onClick={() => onChoose(id)} title={playerInstallationForbidden ? t('仅预设设计：游戏禁止玩家手动安装', 'Prototype design only: player installation forbidden in game') : undefined}>
      <span className="part-glyph">{Array.isArray(definition.variants) && definition.variants[0] && typeof definition.variants[0] === 'object' ? [...String((definition.variants[0] as Record<string, unknown>).symbols ?? '?')][0] : '#'}</span>
      <span><strong>{label}</strong><small>{id}</small></span><ChevronRight size={13} />
    </button>)}{!matches.length && <div className="empty-small">{t('没有匹配部件', 'No matching parts')}</div>}</div>
    <div className="library-footer"><span>{matches.length > PAGE_SIZE ? t(`前 ${PAGE_SIZE} 项 / 共 ${matches.length} 项 · 搜索以缩小范围`, `FIRST ${PAGE_SIZE} OF ${matches.length} · REFINE SEARCH`) : `${matches.length} ${t('项结果', 'RESULTS')}`}</span></div>
  </aside>;
}
