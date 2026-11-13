import { useEffect, useState } from 'react';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Request failed');
  return body;
}
const format = (value?: number | null) => value == null ? '—' : new Intl.NumberFormat('en', {maximumFractionDigits: 1}).format(value);
type History = {
  status: string; pageviews: number; visitorDays: number; missingDays: string[];
  bounceRate?: number | null; avgDuration?: number | null;
  series: {date: string; pageviews: number; dailyVisitors: number; capturedAt: string}[];
};

export function WebHistory({projectId, days}: {projectId: string; days: number}) {
  const [data, setData] = useState<History | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setData(null); setError('');
    request<History>(`/api/projects/${projectId}/web-history?days=${days}`, {signal: controller.signal})
      .then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(err => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, [projectId, days]);
  return <section className="panel">
    <div className="panel-header"><div><h2>Stored daily history</h2><p>Completed UTC days in this period, retained for 24 months.</p></div></div>
    {error ? <p className="error-message" role="alert">{error}</p> : !data ? <p className="empty-small">Loading stored history…</p> : <>
      <div className="comparison-controls">
        <span>{format(data.pageviews)} recorded page views</span>
        <span>{format(data.visitorDays)} visitor-days</span>
        <span>{data.series.length} captured days · {data.missingDays.length} missing days</span>
      </div>
      <p className="empty-small">{data.status === 'not-configured' ? 'Connect website analytics to begin collecting history.' : data.status === 'awaiting-completed-day'
        ? 'The first snapshot is captured after a complete UTC day.'
        : 'Visitor-days add each day’s visitor estimate. They are not unique visitors over the whole period. Missing days are not counted as zero.'}</p>
      {!!data.series.length && <details className="history-details"><summary>Inspect captured daily totals</summary>
        <div className="table-wrap"><table><thead><tr><th>UTC day</th><th>Page views</th><th>Daily visitors</th><th>Captured at (UTC)</th></tr></thead>
          <tbody>{data.series.map(row => <tr key={row.date}><td>{row.date}</td><td>{format(row.pageviews)}</td><td>{format(row.dailyVisitors)}</td><td>{row.capturedAt.replace('T',' ').replace('.000Z','')}</td></tr>)}</tbody>
        </table></div>
      </details>}
      {!!data.missingDays.length && <details className="history-details"><summary>Inspect missing days</summary><p>{data.missingDays.join(', ')}</p></details>}
    </>}
  </section>;
}

type ReadKey = {id: string; createdAt: string; revoked: boolean};
export function OperatorKeys() {
  const [keys, setKeys] = useState<ReadKey[]>([]);
  const [secret, setSecret] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    request<{keys: ReadKey[]}>('/api/operator/read-keys', {signal: controller.signal})
      .then(result => { if (!controller.signal.aborted) setKeys(result.keys); })
      .catch(err => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, []);
  async function change(id?: string) {
    setBusy(true); setSecret(''); setError('');
    try {
      if (id) await request(`/api/operator/read-keys/${id}`, {method: 'DELETE'});
      else setSecret((await request<{apiKey: string}>('/api/operator/read-keys', {method: 'POST'})).apiKey);
      setKeys((await request<{keys: ReadKey[]}>('/api/operator/read-keys')).keys);
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="panel">
    <div className="panel-header"><div><h2>Metrics access keys</h2><p>Read-only access to approved projects through GET /api/metrics.</p></div>
      <button className="secondary-button" disabled={busy} onClick={() => void change()}>Create read key</button></div>
    {error && <p className="error-message" role="alert">{error}</p>}
    {secret && <div className="issued-key"><p>Save this key now. It will not be shown again.</p><div className="code-box"><pre>{secret}</pre></div></div>}
    <div className="table-wrap"><table><thead><tr><th>Key identifier</th><th>Created (UTC)</th><th>Status</th><th>Action</th></tr></thead><tbody>
      {keys.map(key => <tr key={key.id}><td>{key.id}</td><td>{key.createdAt.slice(0,10)}</td><td>{key.revoked ? 'Revoked' : 'Active'}</td>
        <td><button className="text-link" disabled={busy || key.revoked} onClick={() => void change(key.id)}>Revoke</button></td></tr>)}
    </tbody></table>{!keys.length && <p className="empty-small">No read keys created.</p>}</div>
  </section>;
}
