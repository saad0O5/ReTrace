export default function EmptyState({ title, description, icon }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon || '∅'}</div>
      <div className="empty-title">{title}</div>
      {description ? <div className="empty-desc">{description}</div> : null}
    </div>
  );
}
