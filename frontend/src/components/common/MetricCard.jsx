export default function MetricCard({ label, value, helpText, accent, delta }) {
  return (
    <div className="metric-card">
      <div className="metric-label">{label}</div>
      <div className={`metric-value${accent ? ' accent' : ''}`}>{value}</div>
      {helpText ? <div className="metric-sub">{helpText}</div> : null}
      {delta != null ? (
        <div className={`metric-delta ${delta > 0 ? 'up' : delta < 0 ? 'down' : 'neutral'}`}>
          {delta > 0 ? `+${delta}` : delta}
        </div>
      ) : null}
    </div>
  );
}
