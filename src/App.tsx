import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { OperatorKeys, WebHistory } from './ServicePanels';
import { ProjectComparison } from './ProjectComparison';
import { Activity, ArrowDownToLine, ArrowRight, ArrowUpRight, BarChart3, Check, ChevronDown, CircleHelp, Code2, Copy, Database, FileCheck2, Globe2, Layers3, Menu, Plus, RefreshCw, ShieldCheck, Sparkles, Terminal, X } from 'lucide-react';

type View = 'Overview' | 'Web analytics' | 'API analytics' | 'Evidence room' | 'Integrations' | 'Projects';
type Project = { id: string; name: string; domain: string; network: string; isDemo: boolean; createdAt: string; umamiWebsiteId?: string; enrollment?: "approved" | "pending" };
type Session = { user: { role: 'operator' | 'tenant'; name: string } };
type StatusCount = { status: number; count: number };
type Breakdown = { name: string; events?: number; views?: number; count?: number };
type Web = { visitors?: number; bounceRate?: number; avgDuration?: number; countries?: Breakdown[]; devices?: Breakdown[]; browsers?: Breakdown[]; referrers?: Breakdown[] };
type Event = { id: string; type: string; path: string; status?: number; duration?: number; timestamp: string; source: string; disposition: string };
type Overview = { project: Project; days: number; metrics: { pageviews: number; apiRequests: number; acceptedEvents: number; excludedEvents: number; errorRate: number; p95Latency: number | null; p50Latency?: number | null; activeDays: number } & Web; web?: Web; series: { date: string; web: number; api: number }[]; pages: { path: string; views: number }[]; statusCodes: StatusCount[]; endpoints: { path: string; requests: number; statusCodes: StatusCount[]; errorRate: number; p95Latency: number | null; p50Latency?: number | null }[]; sources: Breakdown[]; quality: { duplicate: number; bot: number; invalid: number; accepted: number; coverageDays: number; lastEventAt: string | null }; recentEvents: Event[]; methodology: { version: string; notes: string[] }; sourceStatus?: Record<string, unknown> };
type Integration = { script: string | null; canProvision: boolean; serverExample: string; endpoint: string; privacyNotes: string[] };
type Evidence = { digest?: string | Record<string, unknown>; generatedAt?: string; limitations?: string[];[key: string]: unknown };
const nav: { name: View; icon: typeof Activity }[] = [{ name: 'Overview', icon: Layers3 }, { name: 'Web analytics', icon: Globe2 }, { name: 'API analytics', icon: Terminal }, { name: 'Evidence room', icon: FileCheck2 }, { name: 'Integrations', icon: Code2 }, { name: 'Projects', icon: Database }];
const number = (n?: number | null) => n === undefined || n === null ? '—' : new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(n);
const percent = (n?: number | null) => n === undefined || n === null ? '—' : `${number(n)}%`;
const dateText = (s?: string | null) => s ? new Date(s).toLocaleDateString('en', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : 'No events yet';
async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options?.headers } });
  if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || data.message || `Request failed (${response.status})`); }
  return response.json();
}

const Metric = memo(function Metric({ label, value, suffix, note, icon: Icon }: { label: string; value: string; suffix?: string; note: string; icon: typeof Activity }) {
  return <article className="metric"><div className="metric-label">{label}<Icon size={16} /></div><div className="metric-value">{value}<span>{value === "—" ? "" : suffix}</span></div><div className="metric-note">{note}</div></article>;
});

const TrafficChart = memo(function TrafficChart({ series, mode }: { series: Overview['series']; mode: 'web' | 'api' }) {
  const { points, line, area, max } = useMemo(() => {
    const width = 880, height = 215, maxVal = Math.max(1, ...series.map(d => d[mode]));
    const pts = series.map((d, i) => [i * width / Math.max(1, series.length - 1), height - d[mode] / maxVal * (height - 16)]);
    const l = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const a = pts.length ? `${l} L${width},${height} L0,${height} Z` : '';
    return { points: pts, line: l, area: a, max: maxVal };
  }, [series, mode]);

  return (
    <div className="chart">
      <div className="chart-y">
        {[1, .75, .5, .25, 0].map(n => <span key={n}>{number(Math.round(max * n))}</span>)}
      </div>
      <div className="chart-plot">
        <svg viewBox="0 0 880 215" preserveAspectRatio="none" role="img" aria-label={`${mode === 'web' ? 'Page views' : 'API requests'} by day`}>
          <title>Daily {mode === 'web' ? 'page views' : 'API requests'}</title>
          {[0, 1, 2, 3, 4].map(i => <line key={i} x1="0" y1={i * 215 / 4} x2="880" y2={i * 215 / 4} stroke="#e8eae4" strokeDasharray="4 5" />)}
          <path d={area} fill="#e5efdc" opacity=".8" />
          <path d={line} fill="none" stroke="#356445" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
          {points.length > 0 && <circle cx={points.at(-1)![0]} cy={points.at(-1)![1]} r="4" fill="#356445" />}
        </svg>
        <div className="chart-x">
          {[0, .25, .5, .75, 1].map((fraction, i) => <span key={i}>{dateText(series[Math.min(series.length - 1, Math.round(fraction * (series.length - 1)))]?.date)}</span>)}
        </div>
      </div>
    </div>
  );
});

const BreakdownCard = memo(function BreakdownCard({ title, data, label = 'Events' }: { title: string; data?: Breakdown[]; label?: string }) {
  const max = Math.max(1, ...(data || []).map(d => d.events ?? d.views ?? d.count ?? 0));
  return <section className="panel breakdown"><div className="panel-title"><h3>{title}</h3><span>{label}</span></div>{data?.length ? data.slice(0, 6).map((row, i) => { const count = row.events ?? row.views ?? row.count ?? 0; return <div className="breakdown-row" key={`${row.name}-${i}`}><div className="breakdown-fill" style={{ width: `${count / max * 100}%` }} /><span>{row.name}</span><strong>{number(count)}</strong></div>; }) : <div className="empty-small">No data for this period.</div>}</section>;
});

export default function App() {
  const [view, setView] = useState<View>('Overview');
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState('');
  const [role, setRole] = useState<'operator' | 'tenant'>('operator');
  const [days, setDays] = useState(30);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [integration, setIntegration] = useState<Integration | null>(null);
  const [connectingWeb, setConnectingWeb] = useState(false);
  const selectedProjectRef = useRef(projectId);
  selectedProjectRef.current = projectId;
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [booted, setBooted] = useState(false);
  const [serviceMode, setServiceMode] = useState(false);
  const [developerMode, setDeveloperMode] = useState(false);
  const [register, setRegister] = useState(false);
  const [mode, setMode] = useState<'web' | 'api'>('web');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [modal, setModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createdKey, setCreatedKey] = useState('');
  const [toast, setToast] = useState('');
  const [eventFilter, setEventFilter] = useState('all');
  const [comparisons, setComparisons] = useState<Overview[]>([]);
  const [projectSearch, setProjectSearch] = useState('');
  const [projectSort, setProjectSort] = useState<'name' | 'pageviews' | 'apiRequests'>('name');
  const [comparing, setComparing] = useState(false);
  const [issuedKey, setIssuedKey] = useState('');
  const [keyBusy, setKeyBusy] = useState(false);
  const fetchController = useRef<AbortController | null>(null);
  const modalRef = useRef<HTMLElement | null>(null);

  const loadProjects = useCallback(async () => {
    const result = await api<{ projects: Project[] }>('/api/projects');
    setProjects(result.projects);
    setProjectId(id => result.projects.some(p => p.id === id) ? id : result.projects[0]?.id || '');
  }, []);
  const enterDemo = useCallback(async (nextRole: 'operator' | 'tenant') => {
    fetchController.current?.abort(); setBooted(false); setLoading(true); setError(''); setOverview(null);
    try { await api('/api/auth/demo', { method: 'POST', body: JSON.stringify({ role: nextRole }) }); setRole(nextRole); await loadProjects(); setBooted(true); }
    catch (err) { setError((err as Error).message); }
    finally { setLoading(false); }
  }, [loadProjects]);
  const initialize = useCallback(async () => {
    try {
      const health = await api<{ mode: string }>('/api/health');
      if (health.mode === 'development') {
        setDeveloperMode(true);
        setServiceMode(false);
        setRole('operator');
        await loadProjects();
        setBooted(true);
        setLoading(false);
        return;
      }
      if (health.mode !== 'service') return enterDemo('operator');
      setServiceMode(true);
      const response = await fetch('/api/auth/me');
      if (response.status === 401) { setLoading(false); return; }
      if (!response.ok) throw new Error('Could not load your session.');
      const session: Session = await response.json();
      setRole(session.user.role);
      await loadProjects();
      setBooted(true);
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  }, [enterDemo, loadProjects]);
  useEffect(() => { void initialize(); }, [initialize]);

  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setLoading(true);
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const session = await api<Session>(register ? '/api/auth/register' : '/api/auth/login',
        { method: 'POST', body: JSON.stringify(data) });
      setRole(session.user.role);
      await loadProjects();
      setBooted(true);
    } catch (err) { setError((err as Error).message); }
    finally { setLoading(false); }
  }

  async function approveProject(id: string) {
    setError('');
    try {
      await api(`/api/projects/${id}/approve`, { method: 'POST' });
      await loadProjects();
      setToast('Project approved');
    } catch (err) { setError((err as Error).message); }
  }

  async function connectWeb() {
    const id = projectId;
    setConnectingWeb(true);
    setError('');
    try {
      await api(`/api/projects/${id}/web`, { method: 'POST' });
      const details = await api<Integration>(`/api/projects/${id}/integration`);
      await loadProjects();
      if (selectedProjectRef.current === id) {
        setIntegration(details);
        setToast('Website analytics connected');
      }
    } catch (err) { setError((err as Error).message); }
    finally { setConnectingWeb(false); }
  }

  async function signOut() {
    await api('/api/auth/logout', { method: 'POST' });
    fetchController.current?.abort();
    setBooted(false);
    setLoading(false);
    setProjects([]);
    setProjectId('');
    setOverview(null);
    setView('Overview');
  }
  const load = useCallback(async () => {
    if (!projectId || !booted) return;
    fetchController.current?.abort();
    const controller = new AbortController(); fetchController.current = controller;
    setLoading(true); setError('');
    try { const data = await api<Overview>(`/api/projects/${projectId}/overview?days=${days}`, { signal: controller.signal }); if (!controller.signal.aborted) setOverview(data); }
    catch (err) { if (!controller.signal.aborted) { setError((err as Error).message); setOverview(null); } }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }, [projectId, days, booted]);
  useEffect(() => { setOverview(null); void load(); return () => fetchController.current?.abort(); }, [load]);
  useEffect(() => {
    setEvidence(null); setIntegration(null);
    if (!projectId) return;
    const controller = new AbortController();
    const handleError = (err: Error) => { if (!controller.signal.aborted) setError(err.message); };
    if (view === 'Integrations') api<Integration>(`/api/projects/${projectId}/integration`, { signal: controller.signal }).then(data => { if (!controller.signal.aborted) setIntegration(data); }).catch(handleError);
    if (view === 'Evidence room') api<Evidence>(`/api/projects/${projectId}/evidence?days=${days}`, { signal: controller.signal }).then(data => { if (!controller.signal.aborted) setEvidence(data); }).catch(handleError);
    return () => controller.abort();
  }, [view, projectId, days]);
  useEffect(() => {
    if (view !== 'Projects' || !booted) return;
    const controller = new AbortController(); setComparing(true); setComparisons([]);
    const queue = [...projects];
    const results: Overview[] = [];
    const worker = async () => {
      while (queue.length && !controller.signal.aborted) {
        const p = queue.shift()!;
        results.push(await api<Overview>(`/api/projects/${p.id}/overview?days=${days}`, { signal: controller.signal }));
      }
    };
    Promise.all(Array.from({length: Math.min(4, queue.length)}, worker))
      .then(() => { if (!controller.signal.aborted) setComparisons(results); })
      .catch(err => { if (!controller.signal.aborted) setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setComparing(false); });
    return () => controller.abort();
  }, [view, days, projects, booted]);
  useEffect(() => { setIssuedKey(''); }, [projectId, role]);
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusable = () => [...(modalRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,a[href],[tabindex="0"]') || [])];
    const initial = modalRef.current?.querySelector<HTMLElement>('input') || focusable()[0]; initial?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setModal(false);
      if (event.key === 'Tab') { const items = focusable(); const first = items[0], last = items.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }
    };
    document.addEventListener('keydown', handleKey); const previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', handleKey); document.body.style.overflow = previousOverflow; previous?.focus(); };
  }, [modal, createdKey]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 3200); return () => clearTimeout(timer); }, [toast]);
  async function copy(text: string) { try { await navigator.clipboard.writeText(text); setToast('Copied to clipboard'); } catch { setToast('Clipboard unavailable. Select and copy the text.'); } }
  async function download(kind: 'evidence' | 'export') {
    try { const res = await fetch(`/api/projects/${projectId}/${kind}?days=${days}`); if (!res.ok) throw new Error('Export could not be created.'); const url = URL.createObjectURL(await res.blob()); const link = document.createElement('a'); link.href = url; link.download = `curve-${projectId}-${days}d.${kind === 'evidence' ? 'json' : 'csv'}`; link.click(); URL.revokeObjectURL(url); setToast('Your export is ready'); }
    catch (err) { setError((err as Error).message); }
  }
  async function createProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setCreating(true); setError('');
    const form = new FormData(event.currentTarget);
    try { const result = await api<{ project: Project; apiKey: string }>('/api/projects', { method: 'POST', body: JSON.stringify(Object.fromEntries(form)) }); await loadProjects(); setProjectId(result.project.id); setCreatedKey(result.apiKey); setView('Integrations'); setToast('Project created'); }
    catch (err) { setError((err as Error).message); }
    finally { setCreating(false); }
  }
  async function changeKey(action: 'rotate' | 'revoke') {
    const message = action === 'rotate' ? 'Rotate this project’s API key? The existing key will stop working immediately. Update your exporter with the replacement.' : 'Revoke this project’s API key? API metric ingestion will stop until you rotate a new key.';
    if (!window.confirm(message)) return;
    setKeyBusy(true); setError(''); setIssuedKey('');
    try { const result = await api<{ apiKey?: string }>(`/api/projects/${projectId}/keys${action === 'rotate' ? '/rotate' : ''}`, { method: action === 'rotate' ? 'POST' : 'DELETE' }); if (result.apiKey) setIssuedKey(result.apiKey); setToast(action === 'rotate' ? 'API key rotated. Save it now.' : 'API key revoked'); }
    catch (err) { setError((err as Error).message); }
    finally { setKeyBusy(false); }
  }
  async function removeProject() {
    if (!window.confirm(`Remove ${project?.name} and all its locally stored metrics? This cannot be undone.`)) return;
    setError('');
    try { await api(`/api/projects/${projectId}`, { method: 'DELETE' }); setOverview(null); await loadProjects(); setToast('Project and stored metrics removed'); }
    catch (err) { setError((err as Error).message); }
  }
  const project = projects.find(p => p.id === projectId);
  const web = { ...overview?.metrics, ...overview?.web };
  const webStatus = String(overview?.sourceStatus?.web || 'unknown');
  const apiStatus = String(overview?.sourceStatus?.api || 'unknown');
  const webAvailable = webStatus === 'synthetic' || webStatus === 'connected';
  const apiAvailable = apiStatus === 'synthetic' || apiStatus === 'connected';
  const webNumber = (value?: number) => webAvailable ? number(value) : '—';
  const apiNumber = (value?: number | null) => apiAvailable ? number(value) : '—';
  const selectView = (next: View) => { setView(next); setSidebarOpen(false); };
  const titleCopy: Record<View, string> = { Overview: 'Website and API usage for your project.', 'Web analytics': 'Understand how people discover and use your project.', 'API analytics': 'A clear view of the services behind your product.', 'Evidence room': 'Export usage totals, collection status and metric definitions.', Integrations: 'Install website tracking and configure API metric exports.', Projects: 'A shared view of the projects building on Stellar.' };

  if (serviceMode && !booted) return <main className="account-screen">
    <section className="modal">
      <h1>{register ? 'Create a Curve account' : 'Sign in to Curve'}</h1>
      <form onSubmit={signIn}>
        <label>Username<input name="username" autoComplete="username" required /></label>
        <label>Password<input name="password" type="password" minLength={12} maxLength={128}
          autoComplete={register ? 'new-password' : 'current-password'} required /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary-button full" disabled={loading}>{register ? 'Create account' : 'Sign in'}</button>
      </form>
      <button className="text-link" onClick={() => { setRegister(!register); setError(''); }}>
        {register ? 'Already registered? Sign in' : 'Register as a project owner'}
      </button>
    </section>
  </main>;

  return <div className="app-shell">
    {sidebarOpen && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}
    <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
      <a className="brand" href="#" onClick={e => { e.preventDefault(); selectView('Overview'); }} aria-label="Curve home"><span className="brand-mark"><i /><i /><i /></span>curve<span className="brand-dot">.</span></a>
      <div className="workspace"><div className="workspace-avatar">S<span>✦</span></div><div><strong>Stellar ecosystem</strong><span>Analytics workspace</span></div><ChevronDown size={15} /></div>
      <div className="nav-label">WORKSPACE</div>
      <nav>{nav.map(({ name, icon: Icon }) => <button key={name} className={`nav-item ${view === name ? 'active' : ''}`} onClick={() => selectView(name)}><Icon size={19} /><span>{name}</span>{name === 'Evidence room' && <span className="nav-dot" />}</button>)}</nav>
      <div className="sidebar-bottom"><div className="trust-card"><ShieldCheck size={22} /><strong>Good data. Less exposure.</strong><p>Privacy-conscious analytics, built for shared stewardship.</p><button onClick={() => selectView('Evidence room')}>Explore the methodology <ArrowUpRight size={14} /></button></div><div className="sidebar-session"><div className="avatar">{role === 'operator' ? 'SC' : 'TB'}</div><div><strong>{developerMode ? 'Developer workspace' : role === 'operator' ? 'SCF operator' : 'Tenant builder'}</strong><span>{developerMode ? 'Full local access' : serviceMode ? 'Signed in' : 'Local demo session'}</span></div>{developerMode ? null : serviceMode ? <button aria-label="Sign out" onClick={() => void signOut().catch(err => setError(err.message))}>Exit</button> : <button aria-label="Switch demo role" title="Switch demo role" onClick={() => void enterDemo(role === 'operator' ? 'tenant' : 'operator')}><RefreshCw size={15} /></button>}</div></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb"><button className="mobile-menu icon-button" aria-label="Open navigation" onClick={() => setSidebarOpen(true)}><Menu size={20} /></button><span>Workspace</span><span className="slash">/</span><strong>{view}</strong></div><div className="topbar-right"><span className="local-badge"><i />{developerMode ? 'Development' : serviceMode ? 'Curve service' : 'Local preview'}</span><button className="icon-button" aria-label="View methodology" onClick={() => selectView('Evidence room')}><CircleHelp size={19} /></button><span className="top-avatar">{role === 'operator' ? 'SC' : 'TB'}</span></div></header>
      <main>
        <div className="page-heading"><div><div className="eyebrow">STELLAR PROJECT ANALYTICS</div><h1>{view}</h1><p>{titleCopy[view]}</p></div><button className="primary-button" onClick={() => { setCreatedKey(''); setModal(true); }}><Plus size={16} />Add project</button></div>
        <div className="toolbar"><label className="project-select"><span className="project-icon"><Globe2 size={17} /></span><select value={projectId} onChange={e => setProjectId(e.target.value)} aria-label="Select project">{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}{!projects.length && <option>No projects</option>}</select><ChevronDown size={14} /></label><div className="toolbar-right"><div className="range-switch" aria-label="Date range"><select aria-label="Reporting period" value={days} onChange={event => setDays(Number(event.target.value))}>
          <option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option>
          <option value={365}>365 days</option><option value={731}>731 days</option>
        </select></div><button className="secondary-button export-button" disabled={!projectId} onClick={() => void download('export')}><ArrowDownToLine size={15} />Export CSV</button><button className="icon-button refresh" aria-label="Refresh analytics" disabled={loading} onClick={() => void load()}><RefreshCw size={16} className={loading ? 'spinning' : ''} /></button></div></div>
        {project?.isDemo && <div className="demo-notice"><Sparkles size={14} /><span><strong>Demo workspace</strong> · All activity shown is synthetic. Explore the workflow; these are not adoption claims.</span><span className="demo-network">{project.network}</span></div>}
        {error && <div className="error-message" role="alert"><span>{error}</span><button onClick={() => void (booted ? load() : initialize())}>Retry</button></div>}
        {loading && !overview && <div className="loading-state"><RefreshCw size={24} className="spinning" /><h3>Preparing your workspace</h3><p>Loading metrics and their evidence.</p></div>}
        {!loading && !overview && !error && <div className="empty-state"><Layers3 size={32} /><h2>Your next project starts here.</h2><p>Add a project to connect web and API analytics.</p><button className="primary-button" onClick={() => setModal(true)}><Plus size={16} />Add project</button></div>}
        {overview && <div className={loading ? 'content refreshing' : 'content'}>{!project?.isDemo && <div className="source-notice"><Activity size={15} /><span><strong>Source status</strong> · Web: {webStatus.replaceAll('-', ' ')} · API: {apiStatus.replaceAll('-', ' ')}. Unavailable sources are not zero traffic.</span></div>}
          {(view === 'Overview' || view === 'Web analytics' || view === 'API analytics') && <>
            <div className="metric-grid">{view === 'API analytics' ? <><Metric label="API requests" value={apiNumber(overview.metrics.apiRequests)} note="Accepted metric observations" icon={Terminal} /><Metric label="Error rate" value={apiAvailable ? percent(overview.metrics.errorRate) : '—'} note="Responses with status 400–599" icon={Activity} /><Metric label="P50 latency" value={apiNumber(overview.metrics.p50Latency)} suffix="ms" note="Median request duration" icon={BarChart3} /><Metric label="P95 latency" value={apiNumber(overview.metrics.p95Latency)} suffix="ms" note="95th percentile duration" icon={Activity} /></> : view === 'Web analytics' ? <><Metric label="Page views" value={webNumber(overview.metrics.pageviews)} note="Frontend instrumentation" icon={Globe2} /><Metric label="Unique visitors" value={webNumber(web.visitors)} note="Privacy-limited estimate" icon={Layers3} /><Metric label="Bounce rate" value={webAvailable ? percent(web.bounceRate) : '—'} note="Single-page sessions" icon={Activity} /><Metric label="Avg. session" value={webNumber(web.avgDuration)} suffix="s" note="Session duration estimate" icon={BarChart3} /></> : <><Metric label="Page views" value={webNumber(overview.metrics.pageviews)} note="From connected web properties" icon={Globe2} /><Metric label="API requests" value={apiNumber(overview.metrics.apiRequests)} note="From reported service metrics" icon={Terminal} /><Metric label="P95 API latency" value={apiNumber(overview.metrics.p95Latency)} suffix="ms" note="95th percentile request duration" icon={Activity} /><Metric label="Observation days" value={number(overview.quality.coverageDays)} suffix={`/ ${days}`} note="Days with received activity" icon={ShieldCheck} /></>}</div>
            <section className="panel traffic-panel"><div className="panel-header"><div><h2>Activity over time</h2><p>{view === 'API analytics' || mode === 'api' ? 'Accepted API request observations' : 'Accepted page views'} across the selected period</p></div>{view === 'Overview' ? <div className="chart-tabs"><button className={mode === 'web' ? 'active' : ''} onClick={() => setMode('web')}><i />Web</button><button className={mode === 'api' ? 'active' : ''} onClick={() => setMode('api')}><i />API</button></div> : <span className="subtle-badge">Daily totals</span>}</div>{(view === 'API analytics' || (view === 'Overview' && mode === 'api') ? apiAvailable : webAvailable) ? <TrafficChart series={overview.series} mode={view === 'API analytics' ? 'api' : view === 'Web analytics' ? 'web' : mode} /> : <div className="chart-unavailable"><Activity size={27} /><h3>Waiting for a connected source</h3><p>No reliable series is available. Configure your integration to begin collecting.</p><button className="text-link" onClick={() => selectView('Integrations')}>Open integrations <ArrowRight size={14} /></button></div>}<div className="chart-footer"><span><span className="tiny-dot" />{project?.isDemo ? 'Synthetic sample activity' : 'Received activity'}</span><span>Last event {dateText(overview.quality.lastEventAt)} <span className="footer-dot">·</span> UTC reporting</span></div></section>
          </>}
          {view === 'Overview' && <><div className="overview-lower"><section className="panel pages-panel"><div className="panel-header"><div><h2>Top pages</h2><p>Where attention lands</p></div><button className="text-link" onClick={() => selectView('Web analytics')}>View web analytics <ArrowUpRight size={14} /></button></div><div className="table-wrap"><table><thead><tr><th>Page path</th><th className="align-right">Views</th><th className="share-column">Share</th></tr></thead><tbody>{overview.pages.slice(0, 5).map(row => <tr key={row.path}><td><span className="path-text">{row.path}</span></td><td className="align-right">{number(row.views)}</td><td><div className="mini-bar"><i style={{ width: `${Math.min(100, row.views / Math.max(1, overview.metrics.pageviews) * 100)}%` }} /></div></td></tr>)}</tbody></table>{!overview.pages.length && <div className="empty-small">No page views received.</div>}</div></section><section className="panel quality-panel"><div className="panel-header"><div><h2>Every number has a story.</h2><p>See what made it into your metrics.</p></div><ShieldCheck size={21} /></div><div className="quality-number">{number(overview.metrics.acceptedEvents)}<p>accepted requests &amp; page views · selected period</p></div><div className="quality-scope"><span><i className="tiny-dot excluded" />{number(overview.metrics.excludedEvents)} excluded metric data points · lifetime</span><p>Different scopes and units. Exclusions are shown separately, not as an acceptance percentage.</p></div><button className="quality-link" onClick={() => selectView('Evidence room')}>Inspect the evidence <ArrowRight size={16} /></button></section></div><div className="bottom-note"><ShieldCheck size={16} /><span>No raw IP addresses in Curve’s stored metric records. Source trust and collection limits stay visible.</span><button onClick={() => selectView('Integrations')}>How it works <ArrowUpRight size={13} /></button></div></>}
          {view === 'Web analytics' && <div className="breakdown-grid"><BreakdownCard title="Top pages" data={overview.pages.map(p => ({ name: p.path, events: p.views }))} label="Views" /><BreakdownCard title="Referrers" data={web.referrers} /><BreakdownCard title="Countries" data={web.countries} /><BreakdownCard title="Devices" data={web.devices} /><BreakdownCard title="Browsers" data={web.browsers} /><section className="panel info-card"><ShieldCheck size={24} /><h3>A lighter footprint</h3><p>Visitor and session metrics carry the privacy limitations of the connected Umami source. Missing data is shown as unavailable, never inferred.</p><button className="text-link" onClick={() => selectView('Evidence room')}>Read methodology <ArrowRight size={14} /></button></section></div>}
          {view === 'API analytics' && <BreakdownCard title="HTTP response codes" label="Requests" data={overview.statusCodes.map(code => ({ name: String(code.status), count: code.count }))} />}
          {view === 'API analytics' && <section className="panel"><div className="panel-header"><div><h2>Endpoint performance</h2><p>Normalized routes keep identifiers out of your reports.</p></div><span className="subtle-badge">OTel metrics</span></div><div className="table-wrap"><table><thead><tr><th>Route</th><th>Requests</th><th>HTTP statuses</th><th>Error rate</th><th>P50</th><th>P95</th></tr></thead><tbody>{overview.endpoints.map(row => <tr key={row.path}><td><code>{row.path}</code></td><td>{number(row.requests)}</td><td><details><summary>{number(row.statusCodes.length)} codes</summary><ul className="status-list">{row.statusCodes.map(code => <li key={code.status}><code>{code.status}</code> <strong>{number(code.count)}</strong></li>)}</ul></details></td><td>{percent(row.errorRate)}</td><td>{number(row.p50Latency)} ms</td><td>{number(row.p95Latency)} ms</td></tr>)}</tbody></table>{!overview.endpoints.length && <div className="empty-small">No API metrics received. Connect an OpenTelemetry exporter to get started.</div>}</div><div className="panel-footnote">API metrics are authenticated tenant reports. Authentication does not independently verify the underlying traffic.</div></section>}
          {view === 'Evidence room' && <><section className="evidence-hero"><div className="evidence-icon"><FileCheck2 size={30} /></div><div><span className="eyebrow">REVIEW-READY, NOT TRUST-BY-DEFAULT</span><h2>Put the evidence beside the claim.</h2><p>A portable report with metric definitions, collection limits, and an integrity digest. Built to make a reviewer’s next question easier to answer.</p></div><button className="primary-button" onClick={() => void download('evidence')}><ArrowDownToLine size={16} />Download evidence</button></section><div className="evidence-grid"><section className="panel"><div className="panel-header"><div><h2>Collection quality</h2><p>Period totals and lifetime ingestion diagnostics</p></div><ShieldCheck size={20} /></div><div className="quality-list">{[{ label: 'Accepted requests + views (period)', value: overview.quality.accepted, status: 'Included' }, { label: 'Duplicate data points (lifetime)', value: overview.quality.duplicate, status: 'Excluded' }, { label: 'Suspected bots', value: null, status: 'Unavailable' }, { label: 'Invalid data points (lifetime)', value: overview.quality.invalid, status: 'Excluded' }].map(row => <div key={row.label}><span>{row.label}</span><strong>{number(row.value)}</strong><span className={`pill ${row.status === 'Included' ? 'green' : ''}`}>{row.status}</span></div>)}</div></section><section className="panel methodology"><div className="panel-header"><div><h2>Know the boundaries</h2><p>Methodology {overview.methodology.version}</p></div></div><ul>{overview.methodology.notes.map((note, i) => <li key={i}>{note}</li>)}</ul><p className="integrity-note">An integrity digest detects changes to a report. It does not prove that traffic is human or independently verified.</p></section></div><section className="panel digest-panel"><div><span className="eyebrow">REPORT INTEGRITY · SHA-256</span><code>{typeof evidence?.digest === 'string' ? evidence.digest : evidence?.digest ? JSON.stringify(evidence.digest) : 'Preparing report digest…'}</code><p>Generated {evidence?.generatedAt ? new Date(evidence.generatedAt).toLocaleString() : 'on export'} · covers the exported report contents</p></div><button className="secondary-button" disabled={!evidence} onClick={() => void copy(JSON.stringify(evidence, null, 2))}><Copy size={15} />Copy report</button></section><section className="panel"><div className="panel-header"><div><h2>Observation ledger</h2><p>Recent observations and how they were classified</p></div><select aria-label="Filter event disposition" value={eventFilter} onChange={e => setEventFilter(e.target.value)} className="filter-select"><option value="all">All observations</option><option value="accepted">Accepted</option><option value="excluded">Excluded</option></select></div><div className="table-wrap"><table><thead><tr><th>Route</th><th>Type</th><th>Source</th><th>Disposition</th><th>Received</th></tr></thead><tbody>{overview.recentEvents.filter(e => eventFilter === 'all' || (eventFilter === 'accepted' ? e.disposition === 'accepted' : e.disposition !== 'accepted')).map((e, i) => <tr key={`${e.id}-${i}`}><td><code>{e.path}</code></td><td>{e.type}</td><td>{e.source}</td><td><span className={`pill ${e.disposition === 'accepted' ? 'green' : ''}`}>{e.disposition}</span></td><td>{dateText(e.timestamp)}</td></tr>)}</tbody></table>{!overview.recentEvents.length && <div className="empty-small">No observations in this period.</div>}</div></section></>}
          {view === 'Integrations' && <><div className="integration-intro"><div><span className="pill green">TWO SOURCES. ONE CLEAR PICTURE.</span><h2>Connect your data sources</h2><p>Use Umami for frontend analytics and dual-export your API metrics with OpenTelemetry. Keep your existing monitoring.</p></div><Code2 size={50} strokeWidth={1.2} /></div>{integration ? <div className="integration-grid"><section className="panel integration-card"><div className="step-label">01 <span>WEB ANALYTICS</span></div><h2>Connect your frontend</h2><p>Use the version-pinned Umami tracker from your deployment. Upgrade intentionally after reviewing a new release.</p>        {project?.enrollment === 'pending' && <p>This project is awaiting operator approval. Collection is paused.</p>}
            {integration.script ? <div className="code-box">
              <button aria-label="Copy web integration" onClick={() => void copy(integration.script!)}><Copy size={15} /></button>
              <pre>{integration.script}</pre>
            </div> : <p>{project?.umamiWebsiteId
              ? 'The operator must configure a pinned tracker before installation.'
              : 'Connect a website to generate the installation snippet.'}</p>}
            {integration.canProvision && <button className="secondary-button" disabled={connectingWeb} onClick={() => void connectWeb()}>
              {connectingWeb ? 'Connecting…' : 'Connect website analytics'}
            </button>}
            <div className="integration-status"><Globe2 size={15} />{project?.isDemo ? 'Synthetic web source' : project?.umamiWebsiteId ? 'Umami website linked' : 'Website pending connection'}</div></section><section className="panel integration-card"><div className="step-label">02 <span>API ANALYTICS</span></div><h2>Connect your services</h2><p>Export metric counters and histograms to Curve alongside your APM provider. Heavy traces and logs are not retained.</p><div className="code-box"><button aria-label="Copy server integration" onClick={() => void copy(integration.serverExample)}><Copy size={15} /></button><pre>{integration.serverExample}</pre></div><div className="integration-status"><Terminal size={15} />Endpoint: <code>{integration.endpoint}</code></div></section><section className="panel key-management"><div><h3>Project API key</h3><p>Keys authenticate metric exports from this service. A replacement is displayed once. Keep it in server secret storage.</p></div><div className="key-actions"><button className="secondary-button" disabled={keyBusy || project?.isDemo} onClick={() => void changeKey('rotate')}><RefreshCw size={14} />Rotate key</button><button className="secondary-button danger-button" disabled={keyBusy || project?.isDemo} onClick={() => void changeKey('revoke')}>Revoke key</button></div>{project?.isDemo && <p className="key-note">Create a project to manage a live ingestion key. Demo fixture keys cannot be managed here.</p>}{issuedKey && <div className="issued-key"><p>Save this replacement now. It will disappear when you change projects or reload.</p><div className="code-box"><pre>{issuedKey}</pre><button aria-label="Copy replacement API key" onClick={() => void copy(issuedKey)}><Copy size={15} /></button></div></div>}</section><section className="panel privacy-card"><ShieldCheck size={24} /><div><h3>Small payloads. Explicit limits.</h3><ul>{integration.privacyNotes.map((note, i) => <li key={i}>{note}</li>)}</ul></div></section></div> : <div className="loading-state">Loading integration instructions…</div>}</>}
          {view === 'Web analytics' && project && !project.isDemo && <WebHistory key={project.id} projectId={project.id} days={days} />}
          {view === 'Projects' && role === 'operator' && <OperatorKeys />}
          {view === 'Projects' && <section className="panel"><div className="panel-header"><div><h2>{role === 'operator' ? 'Ecosystem projects' : 'Your projects'}</h2><p>{projects.length} projects visible to this session</p></div></div>
            <ProjectComparison rows={comparisons} loading={comparing} search={projectSearch} onSearch={setProjectSearch}
              onSelect={(id, source) => {setProjectId(id);selectView(source === 'web' ? 'Web analytics' : 'API analytics');}} />
            {role === 'operator' && projects.some(item => item.enrollment === 'pending') && <section className="project-danger">
            <div><strong>Pending applications</strong>
              {projects.filter(item => item.enrollment === 'pending').map(item =>
                <div key={item.id} className="integration-status">
                  <span>{item.name} · {item.domain}</span>
                  <button className="secondary-button" onClick={() => void approveProject(item.id)}>Approve</button>
                </div>)}
            </div>
          </section>}
            <div className="project-cards">{projects.filter(p => `${p.name} ${p.domain}`.toLowerCase().includes(projectSearch.toLowerCase())).map(p => <button key={p.id} className={`project-card ${p.id === projectId ? 'current' : ''}`} onClick={() => { setProjectId(p.id); selectView('Overview'); }}><div className="project-card-top"><span className="project-card-avatar">{p.name.slice(0, 1).toUpperCase()}</span><ArrowUpRight size={18} /></div><h3>{p.name}</h3><p>{p.domain}</p><div><span className="pill">{p.network}</span><span className={`pill ${p.isDemo ? '' : 'green'}`}>{p.isDemo ? 'Synthetic demo' : 'Your project'}</span></div></button>)}</div>{role === 'operator' && project && !project.isDemo && <div className="project-danger"><div><strong>Remove {project.name}</strong><p>Remove this property and its locally stored metrics.</p></div><button className="secondary-button danger-button" onClick={() => void removeProject()}>Remove selected project</button></div>}</section>}
        </div>}
        <footer className="page-footer"><span>curve<span className="footer-brand-dot">.</span> <span>Built for builders. Designed for accountability.</span></span><span>Open source <span className="footer-dot">·</span> Stellar ecosystem</span></footer>
      </main>
    </div>
    {toast && <div className="toast" role="status"><Check size={16} />{toast}</div>}
    {modal && <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) setModal(false); }}><section ref={modalRef} className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button className="modal-close icon-button" aria-label="Close dialog" onClick={() => setModal(false)}><X size={20} /></button>{createdKey ? <><span className="modal-icon"><Check size={26} /></span><h2 id="modal-title">Your project is ready.</h2><p>Save this API key now. It is shown only once and belongs in your server’s secret storage.</p><div className="code-box"><pre>{createdKey}</pre></div><button className="secondary-button full" onClick={() => void copy(createdKey)}><Copy size={16} />Copy API key</button><button className="primary-button full" onClick={() => setModal(false)}>Continue to integrations <ArrowRight size={16} /></button></> : <><span className="eyebrow">A NEW SIGNAL IN THE ECOSYSTEM</span><h2 id="modal-title">Add your project</h2><p>Create a property for web and API analytics.</p><form onSubmit={createProject}><label>Project name<input name="name" required maxLength={80} placeholder="e.g. Orbit Payments" autoFocus /></label><label>Website domain<input name="domain" required placeholder="app.example.org" /></label><label>Stellar network<select name="network"><option value="mainnet">Mainnet</option><option value="testnet">Testnet</option></select></label>{role === 'operator' && <label>Umami website ID <span>(optional; verify ownership first)</span><input name="umamiWebsiteId" placeholder="Link a verified Umami property" /></label>}<p className="form-note">New properties start empty. No demonstration data is added to your project.</p>{error && <p className="form-error">{error}</p>}<button className="primary-button full" disabled={creating}>{creating ? 'Creating project…' : 'Create project'}<ArrowRight size={16} /></button></form></>}</section></div>}
  </div>;
}
