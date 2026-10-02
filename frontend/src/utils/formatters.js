export const formatDate = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
};

export const formatShortDate = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(date);
};

export const timeAgo = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
};

export const formatNumber = (n) => {
  if (n == null) return '0';
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
};

export const shortHash = (hash, length = 8) => {
  if (!hash) return '—';
  return `${hash.slice(0, length)}…`;
};

export const truncate = (str, maxLen = 80) => {
  if (!str) return '';
  return str.length > maxLen ? `${str.slice(0, maxLen)}…` : str;
};

export const getArtifactTypeLabel = (type = '') => {
  const labels = {
    PAPER: 'Paper',
    IMPLEMENTATION: 'Implementation',
    DATASET: 'Dataset',
    BENCHMARK: 'Benchmark',
    PROJECT: 'Project',
    RESOURCE: 'Resource',
  };
  return labels[type] || type || 'Unknown';
};

export const getArtifactTypeClass = (type = '') => {
  return (type || 'unknown').toLowerCase();
};

export const getRelationLabel = (type = '') => {
  const labels = {
    IMPLEMENTED_BY: 'Implemented by',
    USES: 'Uses',
    EVALUATED_ON: 'Evaluated on',
    PRODUCED_BY: 'Produced by',
    REFERENCES: 'References',
    BENCHMARKED_BY: 'Benchmarked by',
  };
  return labels[type] || type || 'Related';
};

export const getSeverityClass = (severity) => {
  if (!severity) return 'info';
  const s = String(severity).toLowerCase();
  if (s === 'high' || s === 'critical') return 'high';
  if (s === 'medium') return 'medium';
  if (s === 'low') return 'low';
  return 'info';
};

export const getSourceStatusClass = (status = '') => {
  const map = {
    HEALTHY: 'healthy',
    DRIFTING: 'drifting',
    EXTRACTION_FAILED: 'failed',
    CONFIGURED: 'configured',
    UNSET: 'unset',
    RUNNING: 'running',
    TEST_SOURCE: 'test_source',
  };
  return map[status] || 'unset';
};
