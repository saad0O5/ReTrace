import { useEffect, useState } from 'react';
import { formatDate, shortHash, getArtifactTypeLabel, getArtifactTypeClass, getRelationLabel, timeAgo } from '../../utils/formatters';
import StatusBadge from '../common/StatusBadge';

const TABS = ['Overview', 'Versions', 'Relationships', 'Notes'];

export default function ArtifactDetailDrawer({ artifactId, onClose, addToast }) {
  const [artifact, setArtifact] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('Overview');

  useEffect(() => {
    if (!artifactId) return;
    setActiveTab('Overview');

    async function loadArtifact() {
      setLoading(true);
      try {
        const response = await fetch(`/api/artifacts/${artifactId}`);
        if (!response.ok) throw new Error('Artifact detail unavailable');
        const payload = await response.json();
        setArtifact(payload);
      } catch (err) {
        setArtifact({ error: String(err.message || err) });
      } finally {
        setLoading(false);
      }
    }

    loadArtifact();
  }, [artifactId]);

  if (!artifactId) return null;

  const versions = artifact?.versions || [];
  const relsFrom = artifact?.relationshipsFrom || [];
  const relsTo = artifact?.relationshipsTo || [];
  const totalRels = relsFrom.length + relsTo.length;

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="drawer-header">
          <div>
            <div className="section-eyebrow">ARTIFACT DETAIL</div>
            <h3 className="drawer-title">{loading ? 'Loading artifact…' : artifact?.title || 'Artifact'}</h3>
          </div>
          <button type="button" className="drawer-close" onClick={onClose}>Close</button>
        </div>

        {/* Tabs */}
        {!loading && !artifact?.error && (
          <div className="drawer-tabs">
            {TABS.map((tab) => (
              <button
                key={tab}
                className={`drawer-tab${activeTab === tab ? ' active' : ''}`}
                onClick={() => setActiveTab(tab)}
              >
                {tab}
                {tab === 'Versions' && versions.length > 0 ? ` (${versions.length})` : ''}
                {tab === 'Relationships' && totalRels > 0 ? ` (${totalRels})` : ''}
              </button>
            ))}
          </div>
        )}

        {/* Body */}
        <div className="drawer-body">
          {loading ? (
            <div className="loading-shell" style={{ minHeight: 200 }}>
              <div className="loading-spinner" />
              <div className="loading-text">Fetching provenance and metadata…</div>
            </div>
          ) : artifact?.error ? (
            <div className="empty-state">
              <div className="empty-icon">!</div>
              <div className="empty-title">Could not load artifact</div>
              <div className="empty-desc">{artifact.error}</div>
            </div>
          ) : (
            <>
              {activeTab === 'Overview' && <OverviewTab artifact={artifact} />}
              {activeTab === 'Versions' && <VersionsTab versions={versions} artifact={artifact} />}
              {activeTab === 'Relationships' && <RelationshipsTab relsFrom={relsFrom} relsTo={relsTo} />}
              {activeTab === 'Notes' && <NotesTab artifact={artifact} addToast={addToast} />}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

/* ─── Overview Tab ───────────────────────────────────────────────────────── */

function OverviewTab({ artifact }) {
  return (
    <>
      {/* Type + Source badges */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <span className={`badge badge-${getArtifactTypeClass(artifact.type)}`}>
          {getArtifactTypeLabel(artifact.type)}
        </span>
        <span className="badge badge-project">{artifact.source}</span>
        {artifact.lastSeen && (
          <span className="section-meta" style={{ alignSelf: 'center' }}>
            Last observed {timeAgo(artifact.lastSeen)}
          </span>
        )}
      </div>

      {/* Provenance Chain */}
      <div className="drawer-section">
        <div className="drawer-section-title">Provenance Chain</div>
        <div className="provenance-chain">
          <span className="provenance-node">Artifact</span>
          <span className="provenance-arrow">→</span>
          <span className="provenance-node">ArtifactVersion</span>
          <span className="provenance-arrow">→</span>
          <span className="provenance-node">Collection</span>
          <span className="provenance-arrow">→</span>
          <span className="provenance-node">Source</span>
        </div>
      </div>

      {/* Metadata */}
      <div className="drawer-section">
        <div className="drawer-section-title">Metadata</div>
        <div className="detail-row">
          <span className="detail-key">Canonical URL</span>
          <span className="detail-value">
            <a href={artifact.url} target="_blank" rel="noreferrer">{artifact.url}</a>
          </span>
        </div>
        {artifact.metadata?.rawUrl && artifact.metadata.rawUrl !== artifact.url && (
          <div className="detail-row">
            <span className="detail-key">Source URL</span>
            <span className="detail-value" style={{ wordBreak: 'break-all' }}>{artifact.metadata.rawUrl}</span>
          </div>
        )}
        <div className="detail-row">
          <span className="detail-key">Source</span>
          <span className="detail-value">{artifact.source}</span>
        </div>
        <div className="detail-row">
          <span className="detail-key">Published</span>
          <span className="detail-value">{formatDate(artifact.publishedAt)}</span>
        </div>
        <div className="detail-row">
          <span className="detail-key">First observed</span>
          <span className="detail-value">{formatDate(artifact.firstSeen)}</span>
        </div>
        <div className="detail-row">
          <span className="detail-key">Last observed</span>
          <span className="detail-value">{formatDate(artifact.lastSeen)}</span>
        </div>
        <div className="detail-row">
          <span className="detail-key">Artifact ID</span>
          <span className="detail-value mono">{artifact.id}</span>
        </div>
        {artifact.authors?.length > 0 && (
          <div className="detail-row">
            <span className="detail-key">Authors</span>
            <span className="detail-value">{artifact.authors.join(', ')}</span>
          </div>
        )}
      </div>

      {/* Description */}
      <div className="drawer-section">
        <div className="drawer-section-title">Description</div>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          {artifact.description || 'No description available for this artifact.'}
        </p>
      </div>
    </>
  );
}

/* ─── Versions Tab ───────────────────────────────────────────────────────── */

function VersionsTab({ versions, artifact }) {
  if (!versions.length) {
    return (
      <div className="empty-state">
        <div className="empty-icon">⧗</div>
        <div className="empty-title">No version history</div>
        <div className="empty-desc">Versions are created each time ReTrace observes this artifact during a collection.</div>
      </div>
    );
  }

  return (
    <div className="drawer-section">
      <div className="drawer-section-title">Version History ({versions.length})</div>
      {versions.map((version, index) => (
        <div key={version.id} className="version-item">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span className="version-hash">{shortHash(version.contentHash, 12)}</span>
            {index === 0 && <span className="badge badge-implementation">Latest</span>}
          </div>
          <div className="version-meta">
            {version.collection?.source?.name || artifact.source} · {formatDate(version.observedAt)}
          </div>
          {version.collection?.id && (
            <div className="version-meta" style={{ marginTop: 2 }}>
              Collection: <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}>{version.collection.id.slice(0, 12)}…</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ─── Relationships Tab ──────────────────────────────────────────────────── */

function RelationshipsTab({ relsFrom, relsTo }) {
  const allRels = [
    ...relsFrom.map((r) => ({ ...r, direction: 'outgoing' })),
    ...relsTo.map((r) => ({ ...r, direction: 'incoming' })),
  ];

  if (!allRels.length) {
    return (
      <div className="empty-state">
        <div className="empty-icon">⬡</div>
        <div className="empty-title">No relationships</div>
        <div className="empty-desc">No candidate relationships have been established for this artifact yet.</div>
      </div>
    );
  }

  return (
    <div className="drawer-section">
      <div className="drawer-section-title">Relationships ({allRels.length})</div>
      {allRels.map((rel) => {
        const isOutgoing = rel.direction === 'outgoing';
        const otherArtifact = isOutgoing ? rel.targetArtifact : rel.sourceArtifact;
        const confidence = Number(rel.confidence || 0);

        return (
          <div key={rel.id} className="relationship-card" style={{ marginBottom: 8 }}>
            <div className="rel-flow">
              <div className="rel-node">
                <div className="rel-node-label">{isOutgoing ? 'Source' : 'Target'}</div>
                <div className="rel-node-title">{isOutgoing ? 'This artifact' : otherArtifact?.title || 'Unknown'}</div>
              </div>
              <div className="rel-arrow">
                <span>{getRelationLabel(rel.relationshipType)}</span>
                <span className="rel-confidence">{confidence.toFixed(2)}</span>
              </div>
              <div className="rel-node">
                <div className="rel-node-label">{isOutgoing ? 'Target' : 'Source'}</div>
                <div className="rel-node-title">{isOutgoing ? otherArtifact?.title || 'Unknown' : 'This artifact'}</div>
              </div>
            </div>
            <div className="rel-footer">
              <span className="rel-evidence">
                {Array.isArray(rel.evidence) && rel.evidence.length
                  ? rel.evidence.join(' · ')
                  : 'Deterministic metadata matching'}
              </span>
              <div className="rel-confidence-bar">
                <div className="rel-confidence-fill" style={{ width: `${Math.round(confidence * 100)}%` }} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Notes Tab ─────────────────────────────────────────────────────── */

function NotesTab({ artifact, addToast }) {
  const [notes, setNotes] = useState(artifact?.notes || '');
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/artifacts/${artifact.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes }),
      });
      if (!res.ok) throw new Error('Failed to save notes');
      setLastSaved(new Date());
      addToast?.('Notes saved', 'success');
    } catch (err) {
      addToast?.(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleMarkReviewed = async () => {
    try {
      const res = await fetch(`/api/artifacts/${artifact.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewedAt: new Date().toISOString() }),
      });
      if (!res.ok) throw new Error('Failed to mark reviewed');
      addToast?.('Marked as reviewed', 'success');
    } catch (err) {
      addToast?.(err.message, 'error');
    }
  };

  return (
    <div className="drawer-section">
      <div className="drawer-section-title">Research Notes</div>
      <textarea
        className="notes-editor"
        placeholder="Add your research notes, observations, or annotations for this artifact…"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={6}
      />
      <div className="notes-actions">
        <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save Notes'}
        </button>
        <button className="btn btn-secondary btn-sm" onClick={handleMarkReviewed}>
          Mark Reviewed
        </button>
        {lastSaved && <span className="notes-saved">Saved {timeAgo(lastSaved)}</span>}
      </div>

      {artifact?.reviewedAt && (
        <div style={{ marginTop: 16 }}>
          <span className="reviewed-badge">✓ Reviewed {formatDate(artifact.reviewedAt)}</span>
        </div>
      )}
    </div>
  );
}
