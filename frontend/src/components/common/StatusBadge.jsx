export default function StatusBadge({ status, type = 'default' }) {
  const tone = {
    healthy: 'healthy',
    HEALTHY: 'healthy',
    success: 'healthy',
    drifting: 'drifting',
    DRIFTING: 'drifting',
    warning: 'drifting',
    failed: 'failed',
    FAILED: 'failed',
    EXTRACTION_FAILED: 'extraction_failed',
    danger: 'failed',
    configured: 'configured',
    CONFIGURED: 'configured',
    info: 'configured',
    running: 'running',
    RUNNING: 'running',
    test_source: 'test_source',
    TEST_SOURCE: 'test_source',
    default: 'unset',
  }[type] || String(type).toLowerCase().replace(/\s+/g, '_');

  return <span className={`status-badge ${tone}`}>{status}</span>;
}
