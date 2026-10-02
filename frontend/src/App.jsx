import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom';
import { useDashboardData } from './hooks/useDashboardData';
import {
  formatDate, timeAgo, formatNumber, truncate,
  getArtifactTypeLabel, getArtifactTypeClass, getRelationLabel,
  getSeverityClass, getSourceStatusClass, shortHash,
} from './utils/formatters';
import MetricCard from './components/common/MetricCard';
import StatusBadge from './components/common/StatusBadge';
import EmptyState from './components/common/EmptyState';
import ArtifactDetailDrawer from './components/layout/ArtifactDetailDrawer';
import RelationshipGraph from './components/relationships/RelationshipGraph';
import ErrorBoundary from './components/common/ErrorBoundary';

/* ─── Toast system ──────────────────────────────────────────────────────── */

function useToast() {
  const [toasts, setToasts] = useState([]);
  const addToast = useCallback((message, type = 'info', duration = 3000) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);
    if (duration > 0) {
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), duration);
    }
    return id;
  }, []);
  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);
  return { toasts, addToast, removeToast };
}

function ToastContainer({ toasts, onRemove }) {
  if (!toasts.length) return null;
  return (
    <div className="toast-container">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.type}`} onClick={() => onRemove(t.id)} style={{ cursor: 'pointer' }}>
          {t.message}
        </div>
      ))}
    </div>
  );
}

/* ─── Navigation config ─────────────────────────────────────────────────── */

const navSections = [
  {
    label: 'MONITOR',
    items: [
      { to: '/', label: 'Overview', icon: '⊞' },
      { to: '/landscape', label: 'Landscape', icon: '◎' },
      { to: '/signals', label: 'Signals', icon: '⚡' },
      { to: '/history', label: 'Change History', icon: '⟲' },
    ],
  },
  {
    label: 'EXPLORE',
    items: [
      { to: '/artifacts', label: 'Artifacts', icon: '◈' },
      { to: '/relationships', label: 'Relationships', icon: '⬡' },
      { to: '/analytics', label: 'Analytics', icon: '▥' },
    ],
  },
  {
    label: 'MANAGE',
    items: [
      { to: '/sources', label: 'Sources', icon: '⟐' },
      { to: '/literature', label: 'Literature', icon: '☰' },
      { to: '/review', label: 'Review Queue', icon: '✓' },
      { to: '/self-healing', label: 'Self-Healing', icon: '⟳' },
    ],
  },
];

const typeOptions = ['PAPER', 'IMPLEMENTATION', 'DATASET', 'BENCHMARK', 'PROJECT', 'RESOURCE'];

const pipelineSteps = ['Public web', 'Collect', 'Normalize', 'Version', 'Connect', 'Detect change', 'Analyze'];

/* ─── Page title mapping ────────────────────────────────────────────────── */

const pageMeta = {
  '/': { eyebrow: 'OVERVIEW', title: 'Research Dashboard' },
  '/landscape': { eyebrow: 'LANDSCAPE', title: 'Research Landscape' },
  '/artifacts': { eyebrow: 'ARTIFACTS', title: 'Artifact Explorer' },
  '/relationships': { eyebrow: 'RELATIONSHIPS', title: 'Evidence-Backed Links' },
  '/signals': { eyebrow: 'SIGNALS', title: 'Research Signals' },
  '/history': { eyebrow: 'CHANGE HISTORY', title: 'Observation Timeline' },
  '/sources': { eyebrow: 'SOURCES', title: 'Source Registry' },
  '/analytics': { eyebrow: 'ANALYTICS', title: 'Analytics Workspace' },
  '/literature': { eyebrow: 'LITERATURE', title: 'Literature Matrix' },
  '/review': { eyebrow: 'REVIEW QUEUE', title: 'Attention Queue' },
  '/self-healing': { eyebrow: 'SELF-HEALING', title: 'Repair Workflow' },
};

/* ─── App ───────────────────────────────────────────────────────────────── */

export default function App() {
  const { data, loading, error, refresh } = useDashboardData();
  const [selectedArtifactId, setSelectedArtifactId] = useState(null);
  const { toasts, addToast, removeToast } = useToast();
  const location = useLocation();
  const meta = pageMeta[location.pathname] || pageMeta['/'];

  if (loading) {
    return (
      <div className="loading-shell">
        <div className="loading-spinner" />
        <div className="loading-text">Initializing ReTrace workspace…</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="loading-shell error-shell">
        <div className="empty-icon">!</div>
        <div className="loading-text">{error || 'Unable to load the ReTrace dataset.'}</div>
        <button className="btn btn-secondary" onClick={refresh} style={{ marginTop: 12 }}>Retry</button>
      </div>
    );
  }

  const {
    researchSpace, generatedAt, sources = [], overview = {},
    changes = {}, artifacts = [], relationships = [], signals = [], analytics = {},
  } = data;

  const currentStatus = sources.some((s) => s.status === 'HEALTHY') ? 'Operational' : 'Configuring';
  const statusDotClass = sources.some((s) => s.status === 'HEALTHY') ? 'green'
    : sources.some((s) => s.status === 'EXTRACTION_FAILED') ? 'red' : 'yellow';

  return (
    <div className="app-shell">
      {/* ── Sidebar ─────────────────────────────────────────────── */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-label">RESEARCH / TRACE</div>
          <div className="brand-title">ReTrace</div>
          <div className="brand-subtitle">{researchSpace?.topic || 'Research workspace'}</div>
        </div>

        <nav className="sidebar-nav" aria-label="Main navigation">
          {navSections.map((section) => (
            <div key={section.label}>
              <div className="nav-section-label">{section.label}</div>
              {section.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
                >
                  <span className="nav-icon">{item.icon}</span>
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-meta">
            <span className={`status-dot ${statusDotClass}`} />
            <span>{currentStatus}</span>
          </div>
          <div className="sidebar-meta">
            <span>Snapshot</span>
            <span style={{ marginLeft: 'auto' }}>{timeAgo(generatedAt)}</span>
          </div>
        </div>
      </aside>

      {/* ── Main Panel ──────────────────────────────────────────── */}
      <main className="main-panel">
        <header className="topbar">
          <div className="topbar-left">
            <div>
              <div className="topbar-eyebrow">{meta.eyebrow}</div>
              <div className="topbar-title">{meta.title}</div>
            </div>
          </div>
          <div className="topbar-right">
            <div className="topbar-pill">
              <span>{formatNumber(artifacts.length)} artifacts</span>
            </div>
            <div className="topbar-pill">
              <span>{formatNumber(relationships.length)} relations</span>
            </div>
            <button className="btn btn-secondary btn-sm" onClick={refresh}>Refresh</button>
          </div>
        </header>

        <div className="page-content">
          <ErrorBoundary>
            <Routes>
            <Route path="/" element={
              <OverviewPage
                data={data}
                onSelect={setSelectedArtifactId}
              />
            } />
            <Route path="/landscape" element={
              <LandscapePage relationships={relationships} onSelect={setSelectedArtifactId} />
            } />
            <Route path="/artifacts" element={
              <ArtifactsPage artifacts={artifacts} onSelect={setSelectedArtifactId} addToast={addToast} />
            } />
            <Route path="/relationships" element={
              <RelationshipsPage relationships={relationships} onSelect={setSelectedArtifactId} />
            } />
            <Route path="/signals" element={
              <SignalsPage signals={signals} onSelect={setSelectedArtifactId} />
            } />
            <Route path="/history" element={
              <HistoryPage signals={signals} />
            } />
            <Route path="/sources" element={
              <SourcesPage sources={sources} addToast={addToast} onRefresh={refresh} />
            } />
            <Route path="/analytics" element={
              <AnalyticsPage analytics={analytics} artifacts={artifacts} relationships={relationships} />
            } />
            <Route path="/literature" element={
              <LiteraturePage artifacts={artifacts} signals={signals} analytics={analytics} onSelect={setSelectedArtifactId} />
            } />
            <Route path="/review" element={
              <ReviewPage analytics={analytics} onSelect={setSelectedArtifactId} addToast={addToast} onRefresh={refresh} />
            } />
            <Route path="/self-healing" element={<SelfHealingPage sources={sources} />} />
            <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </ErrorBoundary>
        </div>

        {selectedArtifactId && (
          <ArtifactDetailDrawer
            artifactId={selectedArtifactId}
            onClose={() => setSelectedArtifactId(null)}
            addToast={addToast}
          />
        )}

        <ToastContainer toasts={toasts} onRemove={removeToast} />
      </main>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   PAGE COMPONENTS
   ═══════════════════════════════════════════════════════════════════════════ */

/* ─── Overview ──────────────────────────────────────────────────────────── */

function OverviewPage({ data, onSelect }) {
  const { researchSpace, generatedAt, sources = [], overview = {}, changes = {},
    artifacts = [], relationships = [], signals = [], analytics = {} } = data;

  const metrics = [
    { label: 'Papers', value: overview.PAPER ?? 0 },
    { label: 'Implementations', value: overview.IMPLEMENTATION ?? 0 },
    { label: 'Datasets', value: overview.DATASET ?? 0 },
    { label: 'Benchmarks', value: overview.BENCHMARK ?? 0 },
    { label: 'Resources', value: overview.RESOURCE ?? 0 },
    { label: 'Projects', value: overview.PROJECT ?? 0 },
    { label: 'Signals', value: changes.signalsCount ?? signals.length, accent: true },
  ];

  return (
    <>
      {/* Hero */}
      <section className="hero-section">
        <div className="section-eyebrow">RETRACE</div>
        <h1 className="hero-title">Track research across papers, code, and datasets.</h1>
        <p className="hero-subtitle">
          Connected view of papers, implementations, datasets, and benchmarks from arXiv, GitHub, and more.
        </p>
        <div className="hero-stats">
          <div className="hero-stat">
            <span className="hero-stat-value">{artifacts.length}</span>
            <span className="hero-stat-label">artifacts tracked</span>
          </div>
          <span className="hero-stat-divider">·</span>
          <div className="hero-stat">
            <span className="hero-stat-value">{relationships.length}</span>
            <span className="hero-stat-label">relationships</span>
          </div>
          <span className="hero-stat-divider">·</span>
          <div className="hero-stat">
            <span className="hero-stat-value">{sources.length}</span>
            <span className="hero-stat-label">sources</span>
          </div>
        </div>
        <div className="pipeline-steps">
          {pipelineSteps.map((step, i) => (
            <div key={step} className={`pipeline-step${i < 7 ? ' active' : ''}`}>{step}</div>
          ))}
        </div>
      </section>

      {/* Metrics */}
      <section style={{ marginBottom: 24 }}>
        <div className="section-header">
          <div>
            <div className="section-eyebrow">RESEARCH LANDSCAPE</div>
            <h2>Overview</h2>
          </div>
          <div className="section-meta">Last observed {timeAgo(generatedAt)}</div>
        </div>
        <div className="metric-grid">
          {metrics.map((m) => <MetricCard key={m.label} label={m.label} value={m.value} accent={m.accent} />)}
        </div>
      </section>

      {/* Pulse + Relationships */}
      <div className="two-col" style={{ marginBottom: 24 }}>
        <div className="pulse-panel">
          <div className="pulse-header">
            <div className="pulse-title">Research Pulse</div>
            <div className="pulse-period">Recent activity</div>
          </div>
          <div className="pulse-counters">
            <div className="pulse-counter">
              <div className="pulse-counter-dot new" />
              <span className="pulse-counter-value">{changes.new ?? 0}</span>
              <span className="pulse-counter-label">New</span>
            </div>
            <div className="pulse-counter">
              <div className="pulse-counter-dot updated" />
              <span className="pulse-counter-value">{changes.updated ?? 0}</span>
              <span className="pulse-counter-label">Updated</span>
            </div>
            <div className="pulse-counter">
              <div className="pulse-counter-dot removed" />
              <span className="pulse-counter-value">{changes.removed ?? 0}</span>
              <span className="pulse-counter-label">Removed</span>
            </div>
          </div>
          <div className="pulse-summary">
            {signals.length
              ? `${signals.length} signal${signals.length !== 1 ? 's' : ''} from recent observations`
              : 'No changes detected since the current baseline.'}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3>Top Relationships</h3>
            <span className="section-meta">{relationships.length} total</span>
          </div>
          <div className="card-body">
            {relationships.slice(0, 4).map((rel, i) => (
              <div className="relationship-card" key={`${rel.paperTitle}-${i}`} style={{ marginBottom: 6, cursor: 'pointer' }}
                onClick={() => onSelect(rel.sourceArtifactId || rel.targetArtifactId)}>
                <div className="rel-flow">
                  <div className="rel-node">
                    <div className="rel-node-label">SOURCE</div>
                    <div className="rel-node-title">{truncate(rel.paperTitle, 35)}</div>
                  </div>
                  <div className="rel-arrow">
                    <span>{getRelationLabel(rel.relationshipType)}</span>
                    <span className="rel-confidence">{Number(rel.confidence).toFixed(2)}</span>
                  </div>
                  <div className="rel-node">
                    <div className="rel-node-label">TARGET</div>
                    <div className="rel-node-title">{truncate(rel.repoTitle, 35)}</div>
                  </div>
                </div>
              </div>
            ))}
            {!relationships.length && <EmptyState title="No relationships yet" description="Candidate links will appear here." icon="⬡" />}
          </div>
        </div>
      </div>

      {/* Recent Signals */}
      <section>
        <div className="section-header">
          <div>
            <div className="section-eyebrow">RECENT SIGNALS</div>
            <h2>Latest changes</h2>
          </div>
        </div>
        {signals.slice(0, 5).map((signal) => (
          <div className={`signal-card ${signal.type?.toLowerCase() || ''}`} key={signal.id || signal.title}
            onClick={() => onSelect(signal.evidence?.artifactId)} style={{ cursor: signal.evidence?.artifactId ? 'pointer' : 'default' }}>
            <div className="signal-top">
              <span className={`signal-type-badge ${signal.type?.toLowerCase()}`}>{signal.type}</span>
              <span className="signal-meta">{signal.sourceName || 'source'} · {timeAgo(signal.createdAt)}</span>
            </div>
            <div className="signal-title">{signal.title}</div>
            {signal.description && <div className="signal-desc">{truncate(signal.description, 120)}</div>}
          </div>
        ))}
        {!signals.length && <EmptyState title="No signals yet" description="No changes have been detected since the current baseline." icon="⚡" />}
      </section>

      {/* Review Queue Preview */}
      {analytics?.attentionQueue?.length > 0 && (
        <section style={{ marginTop: 24 }}>
          <div className="section-header">
            <div>
              <div className="section-eyebrow">REVIEW QUEUE</div>
              <h2>Highest-priority artifacts</h2>
            </div>
          </div>
          <div className="review-list">
            {analytics.attentionQueue.slice(0, 3).map((item) => (
              <div className="review-item" key={item.artifactId || item.title} onClick={() => onSelect(item.artifactId)} style={{ cursor: 'pointer' }}>
                <div className="review-score">{item.attentionScore?.toFixed(2) || '0.00'}</div>
                <div className="review-body">
                  <div className="review-title">{item.title}</div>
                  <div className="review-meta">{item.source} · {item.implementationStatus}</div>
                </div>
                <span className="badge badge-paper">{getArtifactTypeLabel('PAPER')}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

/* ─── Landscape ─────────────────────────────────────────────────────────── */

function LandscapePage({ relationships, onSelect }) {
  const relsWithCallback = relationships.map((r) => ({
    ...r,
    onSelect: () => onSelect(r.sourceArtifactId || r.targetArtifactId),
  }));

  return (
    <>
      <div className="section-header" style={{ marginBottom: 16 }}>
        <div>
          <div className="section-eyebrow">RESEARCH LANDSCAPE</div>
          <h2>Visual relationship graph</h2>
          <p className="section-description">
            Connected view of papers, implementations, datasets, projects and resources with evidence-backed candidate links.
          </p>
        </div>
      </div>
      <RelationshipGraph relationships={relsWithCallback} />
    </>
  );
}

/* ─── Artifacts ─────────────────────────────────────────────────────────── */

function ArtifactsPage({ artifacts, onSelect, addToast }) {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState(null);
  const [page, setPage] = useState(1);
  const [serverData, setServerData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(artifacts.length);
  const pageSize = 25;
  const debounceRef = useRef(null);

  // Compute type counts from the dashboard artifacts (full dataset)
  const typeCounts = useMemo(() => {
    const counts = {};
    artifacts.forEach((a) => { counts[a.type] = (counts[a.type] || 0) + 1; });
    return counts;
  }, [artifacts]);

  // Fetch from server when filters/page change
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const doFetch = () => {
      setLoading(true);
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', String(pageSize));
      if (search) params.set('search', search);
      if (typeFilter) params.set('type', typeFilter);
      params.set('sort', 'newest');

      fetch(`/api/artifacts?${params}`)
        .then((r) => r.json())
        .then((data) => {
          setServerData(data.artifacts || []);
          setTotal(data.pagination?.total ?? 0);
        })
        .catch(() => {
          setServerData(null);
        })
        .finally(() => setLoading(false));
    };
    debounceRef.current = setTimeout(doFetch, search ? 300 : 0);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search, typeFilter, page]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const displayItems = serverData || [];

  const handleExport = (format) => {
    window.open(`/api/export?format=${format}`, '_blank');
    addToast(`Exporting as ${format.toUpperCase()}…`, 'info');
  };

  return (
    <>
      <div className="section-header" style={{ marginBottom: 16 }}>
        <div>
          <div className="section-eyebrow">ARTIFACTS</div>
          <h2>Artifact explorer</h2>
          <p className="section-description">{total} artifact{total !== 1 ? 's' : ''}{loading ? ' · loading…' : ''}</p>
        </div>
        <div className="action-bar">
          <button className="btn btn-secondary btn-sm" onClick={() => handleExport('json')}>Export JSON</button>
          <button className="btn btn-secondary btn-sm" onClick={() => handleExport('csv')}>Export CSV</button>
          <button className="btn btn-secondary btn-sm" onClick={() => handleExport('bibtex')}>Export BibTeX</button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="filter-bar">
        <input
          className="input input-search"
          placeholder="Search artifacts…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          style={{ maxWidth: 280 }}
        />
        <button className={`filter-chip${!typeFilter ? ' active' : ''}`} onClick={() => { setTypeFilter(null); setPage(1); }}>
          All <span className="chip-count">{artifacts.length}</span>
        </button>
        {typeOptions.map((type) => (
          <button
            key={type}
            className={`filter-chip${typeFilter === type ? ' active' : ''}`}
            onClick={() => { setTypeFilter(typeFilter === type ? null : type); setPage(1); }}
          >
            {getArtifactTypeLabel(type)} <span className="chip-count">{typeCounts[type] || 0}</span>
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="table-container">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Type</th>
                <th>Source</th>
                <th>Last Observed</th>
                <th>Versions</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {displayItems.map((a) => (
                <tr key={a.id} className="clickable" onClick={() => onSelect(a.id)}>
                  <td className="td-title">{truncate(a.title, 80)}</td>
                  <td><span className={`badge badge-${getArtifactTypeClass(a.type)}`}>{getArtifactTypeLabel(a.type)}</span></td>
                  <td>{a.source}</td>
                  <td className="td-mono">{timeAgo(a.lastSeen || a.publishedAt)}</td>
                  <td className="td-mono">{a.versionsCount || 1}</td>
                  <td>
                    {a.reviewedAt
                      ? <span className="reviewed-badge">✓ Reviewed</span>
                      : a.notes?.includes('[dismissed]')
                      ? <span className="dismissed-badge">Dismissed</span>
                      : <span className="section-meta">—</span>}
                  </td>
                </tr>
              ))}
              {!displayItems.length && !loading && (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>No artifacts match your filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="table-footer">
          <span>Showing {total ? (page - 1) * pageSize + 1 : 0}–{Math.min(page * pageSize, total)} of {total}</span>
          <div className="pagination">
            <button disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>
            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
              const p = totalPages <= 5 ? i + 1 : Math.max(1, Math.min(page - 2 + i, totalPages));
              return <button key={p} className={p === page ? 'active' : ''} onClick={() => setPage(p)}>{p}</button>;
            })}
            <button disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</button>
          </div>
        </div>
      </div>
    </>
  );
}

/* ─── Relationships ─────────────────────────────────────────────────────── */

function RelationshipsPage({ relationships, onSelect }) {
  const [minConfidence, setMinConfidence] = useState(0);

  const filtered = relationships.filter(
    (r) => Number(r.confidence) >= minConfidence
  );

  if (!relationships.length) {
    return (
      <>
        <div className="section-header"><div><div className="section-eyebrow">RELATIONSHIPS</div><h2>Evidence-backed candidate links</h2></div></div>
        <EmptyState title="No relationships established yet" description="Candidate relationships are created by deterministic metadata matching during the pipeline." icon="⬡" />
      </>
    );
  }

  return (
    <>
      <div className="section-header" style={{ marginBottom: 16 }}>
        <div>
          <div className="section-eyebrow">RELATIONSHIPS</div>
          <h2>Evidence-backed candidate links</h2>
          <p className="section-description">Candidate relationships only — deterministic metadata similarity, confidence, and provenance-backed evidence.</p>
        </div>
        <div className="section-meta">{filtered.length} of {relationships.length}</div>
      </div>

      {/* Confidence filter */}
      <div className="filter-bar" style={{ marginBottom: 16, alignItems: 'center' }}>
        <label style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
          Min confidence: <strong style={{ color: 'var(--text-primary)' }}>{minConfidence.toFixed(2)}</strong>
        </label>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={minConfidence}
          onChange={(e) => setMinConfidence(Number(e.target.value))}
          style={{ flex: 1, maxWidth: 200, accentColor: 'var(--accent)' }}
        />
        <button className="filter-chip active" onClick={() => setMinConfidence(0)} style={{ fontSize: 11 }}>
          Reset
        </button>
        {[0.1, 0.2, 0.5].map((v) => (
          <button
            key={v}
            className={`filter-chip${minConfidence === v ? ' active' : ''}`}
            style={{ fontSize: 11 }}
            onClick={() => setMinConfidence(v)}
          >
            ≥ {v}
          </button>
        ))}
      </div>

      {!filtered.length && (
        <EmptyState title="No relationships match this threshold" description={`Lower the confidence filter below ${minConfidence.toFixed(2)}.`} icon="⬡" />
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filtered.map((rel, i) => (
          <div className="relationship-card" key={`${rel.paperTitle}-${i}`} style={{ cursor: 'pointer' }}
            onClick={() => onSelect(rel.sourceArtifactId || rel.targetArtifactId)}>
            <div className="rel-flow">
              <div className="rel-node">
                <div className="rel-node-label">SOURCE ARTIFACT</div>
                <div className="rel-node-title">{rel.paperTitle}</div>
              </div>
              <div className="rel-arrow">
                <span>{getRelationLabel(rel.relationshipType)}</span>
                <span className="rel-confidence">{Number(rel.confidence).toFixed(3)}</span>
              </div>
              <div className="rel-node">
                <div className="rel-node-label">TARGET ARTIFACT</div>
                <div className="rel-node-title">{rel.repoTitle}</div>
              </div>
            </div>
            <div className="rel-footer">
              <span className="rel-evidence">
                {Array.isArray(rel.evidence) && rel.evidence.length ? rel.evidence.join(' · ') : 'Deterministic metadata matching'}
              </span>
              <div className="rel-confidence-bar">
                <div className="rel-confidence-fill" style={{ width: `${Math.round(Number(rel.confidence) * 100)}%` }} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/* ─── Signals ───────────────────────────────────────────────────────────── */

function SignalsPage({ signals, onSelect }) {
  const [typeFilter, setTypeFilter] = useState(null);

  const filtered = typeFilter ? signals.filter((s) => s.type === typeFilter) : signals;

  const grouped = useMemo(() => {
    const groups = { NEW: [], UPDATED: [], REMOVED: [] };
    filtered.forEach((s) => {
      const key = s.type || 'UPDATED';
      if (groups[key]) groups[key].push(s);
    });
    return groups;
  }, [filtered]);

  const typeCounts = useMemo(() => {
    const c = { NEW: 0, UPDATED: 0, REMOVED: 0 };
    signals.forEach((s) => { if (c[s.type] != null) c[s.type]++; });
    return c;
  }, [signals]);

  if (!signals.length) {
    return (
      <>
        <div className="section-header"><div><div className="section-eyebrow">SIGNALS</div><h2>Research signals</h2></div></div>
        <EmptyState title="No signals" description="No changes have been detected since the current baseline. ReTrace needs at least two observations." icon="⚡" />
      </>
    );
  }

  return (
    <>
      <div className="section-header" style={{ marginBottom: 16 }}>
        <div>
          <div className="section-eyebrow">SIGNALS</div>
          <h2>Changes detected across the landscape</h2>
        </div>
        <div className="section-meta">{signals.length} signal{signals.length !== 1 ? 's' : ''}</div>
      </div>

      <div className="filter-bar">
        <button className={`filter-chip${!typeFilter ? ' active' : ''}`} onClick={() => setTypeFilter(null)}>
          All <span className="chip-count">{signals.length}</span>
        </button>
        {Object.entries(typeCounts).map(([type, count]) => (
          <button key={type} className={`filter-chip${typeFilter === type ? ' active' : ''}`} onClick={() => setTypeFilter(typeFilter === type ? null : type)}>
            {type} <span className="chip-count">{count}</span>
          </button>
        ))}
      </div>

      {Object.entries(grouped).map(([type, items]) => {
        if (!items.length) return null;
        const severityClass = type === 'NEW' ? 'low' : type === 'REMOVED' ? 'high' : 'medium';
        return (
          <div className="signal-group" key={type}>
            <div className="signal-group-header">
              <span className={`signal-group-label ${severityClass}`}>{type}</span>
              <span className="signal-group-count">{items.length}</span>
            </div>
            {items.map((signal) => (
              <div className={`signal-card ${signal.type?.toLowerCase()}`} key={signal.id || signal.title}
                onClick={() => onSelect(signal.evidence?.artifactId)} style={{ cursor: signal.evidence?.artifactId ? 'pointer' : 'default' }}>
                <div className="signal-top">
                  <span className={`signal-type-badge ${signal.type?.toLowerCase()}`}>{signal.type}</span>
                  <span className="signal-meta">{signal.sourceName} · {timeAgo(signal.createdAt)}</span>
                </div>
                <div className="signal-title">{signal.title}</div>
                {signal.description && <div className="signal-desc">{truncate(signal.description, 140)}</div>}
                {signal.changes?.length > 0 && (
                  <div className="signal-changes">
                    {signal.changes.map((c) => <span key={c} className="signal-change-tag">{c}</span>)}
                  </div>
                )}
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}

/* ─── Change History ────────────────────────────────────────────────────── */

function HistoryPage({ signals }) {
  if (!signals.length) {
    return (
      <>
        <div className="section-header"><div><div className="section-eyebrow">CHANGE HISTORY</div><h2>Observation timeline</h2></div></div>
        <EmptyState title="No historical changes observed" description="ReTrace needs at least two successful observations of the same source before changes can be detected." icon="⟲" />
      </>
    );
  }

  return (
    <>
      <div className="section-header" style={{ marginBottom: 16 }}>
        <div>
          <div className="section-eyebrow">CHANGE HISTORY</div>
          <h2>Observation timeline</h2>
          <p className="section-description">Chronological record of all detected changes across monitored sources.</p>
        </div>
        <div className="section-meta">{signals.length} events</div>
      </div>

      <div className="timeline">
        {signals.map((signal) => (
          <div className={`timeline-entry ${signal.type?.toLowerCase()}`} key={signal.id || signal.title}>
            <div className="timeline-date">{formatDate(signal.createdAt)}</div>
            <div className="timeline-title">
              <span className={`signal-type-badge ${signal.type?.toLowerCase()}`} style={{ marginRight: 8 }}>{signal.type}</span>
              {signal.title}
            </div>
            {signal.description && <div className="timeline-desc">{truncate(signal.description, 160)}</div>}
          </div>
        ))}
      </div>
    </>
  );
}

/* ─── Sources ───────────────────────────────────────────────────────────── */

function SourcesPage({ sources, addToast, onRefresh }) {
  const [triggering, setTriggering] = useState({});

  const handleTrigger = async (sourceName) => {
    setTriggering((prev) => ({ ...prev, [sourceName]: true }));
    addToast(`Triggering collection for ${sourceName}…`, 'loading', 0);
    try {
      const res = await fetch(`/api/collect/${sourceName}`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Collection failed');
      addToast(`${sourceName}: ${data.recordCount} records collected`, 'success');
      onRefresh();
    } catch (err) {
      addToast(`${sourceName}: ${err.message}`, 'error');
    } finally {
      setTriggering((prev) => ({ ...prev, [sourceName]: false }));
    }
  };

  const handleTriggerAll = async () => {
    setTriggering((prev) => ({ ...prev, _all: true }));
    addToast('Triggering all sources…', 'loading', 0);
    try {
      const res = await fetch('/api/collect/all', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Collection failed');
      addToast(`All sources triggered: ${data.triggered?.join(', ')}`, 'success');
      onRefresh();
    } catch (err) {
      addToast(`Trigger all failed: ${err.message}`, 'error');
    } finally {
      setTriggering((prev) => ({ ...prev, _all: false }));
    }
  };

  return (
    <>
      <div className="section-header" style={{ marginBottom: 16 }}>
        <div>
          <div className="section-eyebrow">SOURCES</div>
          <h2>Source registry &amp; health</h2>
          <p className="section-description">Monitored data sources and their current operational status.</p>
        </div>
        <div className="action-bar">
          <span className="section-meta">{sources.length} source{sources.length !== 1 ? 's' : ''}</span>
          <button className="btn btn-primary btn-sm" onClick={handleTriggerAll} disabled={triggering._all}>
            {triggering._all ? 'Running…' : 'Collect All'}
          </button>
        </div>
      </div>

      <div className="source-grid">
        {sources.map((source) => (
          <div className="source-card" key={source.name}>
            <div className="source-header">
              <div className="source-name">{source.name}</div>
              <StatusBadge status={source.status || 'UNSET'} type={source.status} />
            </div>
            <div className="source-stats">
              <div className="source-stat">
                <span className="source-stat-label">Artifacts</span>
                <span className="source-stat-value">{source.recordCount || 0}</span>
              </div>
              <div className="source-stat">
                <span className="source-stat-label">Last Success</span>
                <span className="source-stat-value">{timeAgo(source.lastSuccessAt)}</span>
              </div>
              <div className="source-stat">
                <span className="source-stat-label">Last Run</span>
                <span className="source-stat-value">{timeAgo(source.lastRun)}</span>
              </div>
              <div className="source-stat">
                <span className="source-stat-label">Types</span>
                <span className="source-stat-value">{source.artifactTypes || '—'}</span>
              </div>
            </div>
            <div className="source-collector">
              Collector: {source.collectorId || 'UNSET'}
            </div>
            {source.errorMessage && (
              <div style={{ marginTop: 8, padding: '6px 10px', background: 'var(--danger-dim)', borderRadius: 'var(--radius-sm)', fontSize: 11, color: 'var(--danger)' }}>
                {truncate(source.errorMessage, 80)}
              </div>
            )}
            <div style={{ marginTop: 12 }}>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => handleTrigger(source.name)}
                disabled={triggering[source.name] || source.collectorId === 'UNSET'}
              >
                {triggering[source.name] ? 'Running…' : 'Trigger Collection'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/* ─── Analytics ─────────────────────────────────────────────────────────── */

function AnalyticsPage({ analytics, artifacts, relationships }) {
  const totalArtifacts = analytics?.overview?.totalArtifacts ?? artifacts.length;
  const totalRels = analytics?.overview?.totalRelationships ?? relationships.length;
  const coveragePercent = analytics?.implementationCoverage?.coveragePercent ?? 0;
  const keywords = analytics?.keywords || [];
  const typeDistribution = analytics?.typeDistribution || {};
  const sourceDistribution = analytics?.sourceDistribution || {};

  // Build bar chart data from type distribution
  const typeBars = Object.entries(typeDistribution).map(([type, count]) => ({
    label: getArtifactTypeLabel(type),
    value: count,
    percent: totalArtifacts ? Math.round((count / totalArtifacts) * 100) : 0,
    colorClass: type === 'PAPER' ? '' : type === 'IMPLEMENTATION' ? 'success' : type === 'DATASET' ? 'warning' : '',
  }));

  // Completeness data
  const completenessData = [
    { label: 'Title present', value: artifacts.filter((a) => a.title).length, total: artifacts.length },
    { label: 'Description', value: artifacts.filter((a) => a.description).length, total: artifacts.length },
    { label: 'Has URL', value: artifacts.filter((a) => a.url).length, total: artifacts.length },
    { label: 'Has metadata', value: artifacts.filter((a) => a.metadata && Object.keys(a.metadata).length > 0).length, total: artifacts.length },
  ].map((d) => ({ ...d, percent: d.total ? Math.round((d.value / d.total) * 100) : 0 }));

  return (
    <>
      <div className="section-header" style={{ marginBottom: 16 }}>
        <div>
          <div className="section-eyebrow">ANALYTICS</div>
          <h2>Research analytics workspace</h2>
          <p className="section-description">Deterministic analytics derived from observed artifact metadata and relationships.</p>
        </div>
      </div>

      {/* Summary metrics */}
      <div className="metric-grid" style={{ marginBottom: 20 }}>
        <MetricCard label="Total Artifacts" value={totalArtifacts} />
        <MetricCard label="Coverage" value={`${coveragePercent}%`} accent />
        <MetricCard label="Relationships" value={totalRels} />
        <MetricCard label="Keywords" value={keywords.length} />
      </div>

      <div className="analytics-grid">
        {/* Type Distribution */}
        <div className="analytics-card">
          <div className="analytics-card-header">
            <div className="analytics-card-title">Type Distribution</div>
            <div className="analytics-card-sub">Artifact count by type</div>
          </div>
          <div className="analytics-card-body">
            {typeBars.length ? (
              <div className="bar-chart">
                {typeBars.map((bar) => (
                  <div key={bar.label} className="bar-row">
                    <span className="bar-label">{bar.label}</span>
                    <div className="bar-track">
                      <div className={`bar-fill ${bar.colorClass}`} style={{ width: `${bar.percent}%` }} />
                    </div>
                    <span className="bar-value">{bar.value}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="section-meta">No type data available</div>
            )}
          </div>
        </div>

        {/* Keywords */}
        <div className="analytics-card">
          <div className="analytics-card-header">
            <div className="analytics-card-title">Keywords</div>
            <div className="analytics-card-sub">Extracted from artifact metadata</div>
          </div>
          <div className="analytics-card-body">
            {keywords.length ? (
              <div className="keyword-cloud">
                {keywords.slice(0, 16).map((kw) => (
                  <span key={kw.term} className="keyword-tag">
                    {kw.term} <span className="kw-count">{kw.count}</span>
                  </span>
                ))}
              </div>
            ) : (
              <div className="section-meta">No keywords extracted yet</div>
            )}
          </div>
        </div>

        {/* Data Completeness */}
        <div className="analytics-card full-width">
          <div className="analytics-card-header">
            <div className="analytics-card-title">Data Completeness</div>
            <div className="analytics-card-sub">Field coverage across all artifacts</div>
          </div>
          <div className="analytics-card-body">
            {completenessData.map((row) => (
              <div key={row.label} className="completeness-row">
                <span className="completeness-label">{row.label}</span>
                <div className="completeness-bar">
                  <div className={`completeness-fill ${row.percent >= 80 ? 'high' : row.percent >= 50 ? 'medium' : 'low'}`}
                    style={{ width: `${row.percent}%` }} />
                </div>
                <span className="completeness-value">{row.percent}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

/* ─── Literature Matrix ─────────────────────────────────────────────────── */

function LiteraturePage({ artifacts, signals, analytics, onSelect }) {
  const papers = artifacts.filter((a) => a.type === 'PAPER');

  const getSignalStatus = (artifact) => {
    const match = signals.find((s) => s.evidence?.url === artifact.url || s.title?.includes(artifact.title));
    return match ? match.type : null;
  };

  const getAttention = (artifact) => {
    return analytics?.attentionQueue?.find((item) => item.artifactId === artifact.id)?.attentionScore ?? null;
  };

  return (
    <>
      <div className="section-header" style={{ marginBottom: 16 }}>
        <div>
          <div className="section-eyebrow">LITERATURE MATRIX</div>
          <h2>Research review workspace</h2>
          <p className="section-description">Papers with change status and attention scoring for systematic review.</p>
        </div>
        <div className="section-meta">{papers.length} paper{papers.length !== 1 ? 's' : ''}</div>
      </div>

      {!papers.length ? (
        <EmptyState title="No papers tracked" description="Papers will appear here once ReTrace collects and normalizes them from monitored sources." icon="☰" />
      ) : (
        <div className="table-container">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Paper</th>
                  <th>Source</th>
                  <th>Changed</th>
                  <th>Attention</th>
                  <th>Published</th>
                </tr>
              </thead>
              <tbody>
                {papers.slice(0, 20).map((paper) => {
                  const sigStatus = getSignalStatus(paper);
                  const attention = getAttention(paper);
                  return (
                    <tr key={paper.id} className="clickable" onClick={() => onSelect(paper.id)}>
                      <td className="td-title">{truncate(paper.title, 70)}</td>
                      <td>{paper.source}</td>
                      <td>
                        {sigStatus
                          ? <span className={`signal-type-badge ${sigStatus.toLowerCase()}`}>{sigStatus}</span>
                          : <span className="section-meta">—</span>}
                      </td>
                      <td className="td-mono">{attention != null ? attention.toFixed(2) : '—'}</td>
                      <td className="td-mono">{formatDate(paper.publishedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

/* ─── Review Queue ──────────────────────────────────────────────────────── */

function ReviewPage({ analytics, onSelect, addToast, onRefresh }) {
  const queue = analytics?.attentionQueue || [];
  const [dismissed, setDismissed] = useState(new Set());

  const handleDismiss = async (e, artifactId) => {
    e.stopPropagation();
    try {
      const res = await fetch(`/api/artifacts/${artifactId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dismissed: true }),
      });
      if (!res.ok) throw new Error('Failed to dismiss');
      setDismissed((prev) => new Set([...prev, artifactId]));
      addToast('Artifact dismissed', 'success');
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  const handleMarkReviewed = async (e, artifactId) => {
    e.stopPropagation();
    try {
      const res = await fetch(`/api/artifacts/${artifactId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewedAt: new Date().toISOString() }),
      });
      if (!res.ok) throw new Error('Failed to mark reviewed');
      addToast('Marked as reviewed', 'success');
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  const visibleQueue = queue.filter((item) => !dismissed.has(item.artifactId));

  return (
    <>
      <div className="section-header" style={{ marginBottom: 16 }}>
        <div>
          <div className="section-eyebrow">REVIEW QUEUE</div>
          <h2>Artifacts worth investigating</h2>
          <p className="section-description">Ranked by attention score. You can mark items as reviewed or dismiss them.</p>
        </div>
        <div className="section-meta">{visibleQueue.length} item{visibleQueue.length !== 1 ? 's' : ''}</div>
      </div>

      {!visibleQueue.length ? (
        <EmptyState title="Review queue clear" description="All items have been reviewed or dismissed. The queue repopulates after change detection." icon="✓" />
      ) : (
        <div className="review-list">
          {visibleQueue.slice(0, 20).map((item) => (
            <div className="review-item" key={item.artifactId || item.title} onClick={() => onSelect(item.artifactId)} style={{ cursor: 'pointer' }}>
              <div className="review-score">{item.attentionScore?.toFixed(2) || '0.00'}</div>
              <div className="review-body">
                <div className="review-title">{item.title}</div>
                <div className="review-meta">{item.source} · {item.implementationStatus}</div>
                {item.reason && <div className="review-reason">{item.reason}</div>}
              </div>
              <div className="action-bar" style={{ flexDirection: 'column', gap: 4 }}>
                <button className="btn btn-secondary btn-sm" onClick={(e) => handleMarkReviewed(e, item.artifactId)}>Reviewed</button>
                <button className="btn btn-ghost btn-sm" onClick={(e) => handleDismiss(e, item.artifactId)}>Dismiss</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/* ─── Self-Healing ──────────────────────────────────────────────────────── */

function SelfHealingPage({ sources }) {
  const failedSources = sources.filter((s) => s.status === 'EXTRACTION_FAILED');
  const healthySources = sources.filter((s) => s.status === 'HEALTHY');

  const steps = [
    { title: 'Detection', desc: 'Monitor identifies extraction failure', status: 'done' },
    { title: 'Diagnosis', desc: 'Analyze selector drift or schema change', status: 'done' },
    { title: 'Generated Fix', desc: 'Selector patch proposed automatically', status: 'done' },
    { title: 'Preview', desc: 'Recovered extraction validated against sample', status: 'done' },
    { title: 'Approval', desc: 'Production promotion requires Bright Data approval', status: 'pending' },
  ];

  return (
    <>
      <div className="section-header" style={{ marginBottom: 16 }}>
        <div>
          <div className="section-eyebrow">SELF-HEALING</div>
          <h2>Source health &amp; repair workflow</h2>
          <p className="section-description">
            ReTrace reflects the actual self-healing workflow: fix generation and preview validation are part of the system,
            while production promotion requires external Bright Data approval.
          </p>
        </div>
      </div>

      {/* Health Summary */}
      <div className="metric-grid" style={{ marginBottom: 20 }}>
        <MetricCard label="Healthy" value={healthySources.length} accent />
        <MetricCard label="Failed" value={failedSources.length} />
        <MetricCard label="Total Sources" value={sources.length} />
      </div>

      {/* Workflow Steps */}
      <div className="heal-card">
        <div className="heal-header">
          <div>
            <h3 className="heal-title">Extraction Failure → Repair → Preview Validation</h3>
            <p className="heal-desc">
              End-to-end self-healing pipeline for source extraction failures.
            </p>
          </div>
          <StatusBadge status="PREVIEW VALIDATED" type="warning" />
        </div>
        <div className="heal-steps">
          {steps.map((step) => (
            <div key={step.title} className={`heal-step ${step.status}`}>
              <div className="heal-step-title">{step.title}</div>
              <div className="heal-step-desc">{step.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Failed sources */}
      {failedSources.length > 0 && (
        <section style={{ marginTop: 20 }}>
          <div className="section-header">
            <h3>Sources needing repair</h3>
          </div>
          {failedSources.map((source) => (
            <div className="signal-card removed" key={source.name} style={{ marginBottom: 8 }}>
              <div className="signal-top">
                <span className="signal-type-badge removed">FAILED</span>
                <span className="signal-meta">{source.name}</span>
              </div>
              <div className="signal-title">{source.errorMessage || 'Extraction failed'}</div>
              <div className="signal-desc">Collector: {source.collectorId || 'UNSET'} · Last run: {timeAgo(source.lastRun)}</div>
            </div>
          ))}
        </section>
      )}
    </>
  );
}
