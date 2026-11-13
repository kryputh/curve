import { useState } from 'react';

type Metric = 'pageviews' | 'visitors' | 'bounceRate' | 'avgDuration' | 'apiRequests' | 'errorRate' | 'p50Latency' | 'p95Latency';
type Row = {
  project: {id: string; name: string; domain: string};
  metrics: Partial<Record<Metric,number | null>>;
  sourceStatus?: Record<string, unknown>;
};
const fields: Record<'web' | 'api', {key: Metric; label: string; unit?: string}[]> = {
  web: [{key:'pageviews',label:'Page views'},{key:'visitors',label:'Visitors'},{key:'bounceRate',label:'Bounce rate',unit:'%'},{key:'avgDuration',label:'Avg. session',unit:'s'}],
  api: [{key:'apiRequests',label:'Requests'},{key:'errorRate',label:'Error rate',unit:'%'},{key:'p50Latency',label:'P50 latency',unit:'ms'},{key:'p95Latency',label:'P95 latency',unit:'ms'}],
};
const format = (value: number, unit='') => `${new Intl.NumberFormat('en',{maximumFractionDigits:1}).format(value)}${unit ? ' '+unit : ''}`;

export function ProjectComparison({rows, loading, search, onSearch, onSelect}: {
  rows: Row[]; loading: boolean; search: string; onSearch: (value: string) => void;
  onSelect: (id: string, source: 'web' | 'api') => void;
}) {
  const [source, setSource] = useState<'web' | 'api'>('web');
  const [sort, setSort] = useState<Metric | 'name'>('name');
  const available = (row: Row) => ['connected','synthetic'].includes(String(row.sourceStatus?.[source]));
  const filtered = rows.filter(row => `${row.project.name} ${row.project.domain}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a,b) => sort === 'name' ? a.project.name.localeCompare(b.project.name)
      : (available(b) ? b.metrics[sort] ?? -Infinity : -Infinity) - (available(a) ? a.metrics[sort] ?? -Infinity : -Infinity));
  return <>
    <div className="comparison-controls">
      <input aria-label="Filter projects" placeholder="Find a project or domain…" value={search} onChange={event => onSearch(event.target.value)} />
      <select aria-label="Metrics to compare" value={source} onChange={event => {setSource(event.target.value as 'web' | 'api');setSort('name');}}><option value="web">Web metrics</option><option value="api">API metrics</option></select>
      <select aria-label="Sort projects" value={sort} onChange={event => setSort(event.target.value as Metric | 'name')}><option value="name">Name A–Z</option>{fields[source].map(field => <option key={field.key} value={field.key}>{field.label}: highest first</option>)}</select>
    </div>
    <div className="table-wrap comparison-table"><table><thead><tr><th>Project</th>{fields[source].map(field => <th key={field.key}>{field.label}</th>)}<th>Source status</th></tr></thead><tbody>
      {filtered.map(row => <tr key={row.project.id}><td><button className="comparison-name" onClick={() => onSelect(row.project.id, source)}>{row.project.name}</button></td>
        {fields[source].map(field => <td key={field.key}>{available(row) && row.metrics[field.key] != null ? format(row.metrics[field.key]!,field.unit) : '—'}</td>)}
        <td>{String(row.sourceStatus?.[source] ?? 'unknown').replaceAll('-',' ')}</td></tr>)}
    </tbody></table>{loading ? <p className="empty-small">Loading project metrics…</p> : !filtered.length ? <p className="empty-small">No matching projects.</p> : null}</div>
  </>;
}
