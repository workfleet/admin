// An empty list that looks intentional: an icon, a short heading, a line
// saying what will appear here, and - where there is an obvious first step -
// the button to take it. Replaces bare "Nothing here." lines.
//
// icon:   a lucide-react component (Inbox, CheckCircle2, Users...)
// tone:   'neutral' (default) or 'good' - green for "all clear" states like
//         "Every shift is covered", so an empty list can read as good news.
// action: { label, onClick } for the first-step button (optional).
// compact: for an empty list inside a card or tab rather than a whole page.
export default function EmptyState({ icon: Icon, title, body, action, tone = 'neutral', compact = false }) {
  return (
    <div className={`empty-block${compact ? ' is-compact' : ''}${tone === 'good' ? ' is-good' : ''}`}>
      {Icon && (
        <span className="empty-block-icon" aria-hidden="true">
          <Icon size={compact ? 18 : 22} strokeWidth={1.8} />
        </span>
      )}
      <p className="empty-block-title">{title}</p>
      {body && <p className="empty-block-body">{body}</p>}
      {action && (
        <button type="button" className="btn-secondary empty-block-action" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}
