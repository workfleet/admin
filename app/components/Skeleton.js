// Loading placeholders.
//
// Every page used to show a bare "Loading..." line (and the three app shells
// showed nothing at all) until its data arrived. These grey shapes stand in
// for the layout that is about to appear, so the page feels like it is
// filling in rather than blinking from blank to full.
//
// Screen readers get a single "Loading" status instead of the shapes.

const WIDTHS = ['72%', '54%', '86%', '63%', '78%', '48%'];
const TITLE_WIDTHS = ['40%', '30%', '47%', '35%', '43%', '26%'];

function Bar({ width, height, className = '', style }) {
  return <span className={`sk ${className}`} style={{ width, height, ...style }} />;
}

function Header() {
  return (
    <div className="sk-head">
      <Bar className="sk-title" />
      <Bar className="sk-sub" />
    </div>
  );
}

function ListBody({ rows }) {
  return Array.from({ length: rows }, (_, i) => (
    <div key={i} className="card sk-card">
      <Bar width={TITLE_WIDTHS[i % TITLE_WIDTHS.length]} height={16} />
      <Bar width={WIDTHS[(i + 2) % WIDTHS.length]} />
      <Bar width={88} height={20} style={{ borderRadius: 999 }} />
    </div>
  ));
}

function TableBody({ rows }) {
  return (
    <div className="card sk-card" style={{ padding: 0 }}>
      <div className="sk-table-head">
        {[22, 14, 16, 12].map((w, i) => <Bar key={i} width={`${w}%`} height={10} />)}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="sk-table-row">
          {[28, 12, 18, 10].map((w, i) => <Bar key={i} width={`${w + ((r + i) % 3) * 4}%`} />)}
        </div>
      ))}
    </div>
  );
}

function DashboardBody() {
  return (
    <>
      <div className="sk-stat-row">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card sk-card sk-stat">
            <Bar width={48} height={26} />
            <Bar width="62%" />
          </div>
        ))}
      </div>
      <div className="sk-grid">
        <div className="card sk-card">
          <Bar width="30%" height={16} />
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="sk-row">
              <Bar width={44} />
              <Bar width={WIDTHS[i]} />
            </div>
          ))}
        </div>
        <div className="card sk-card">
          <Bar width="45%" height={16} />
          {[0, 1, 2].map((i) => (
            <div key={i} className="sk-row">
              <Bar className="sk-circle" />
              <Bar width={WIDTHS[i + 2]} />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function DetailBody({ rows }) {
  return (
    <>
      <div className="card sk-card">
        <div className="sk-row" style={{ borderBottom: 'none', padding: 0 }}>
          <Bar className="sk-circle" />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Bar width="38%" height={16} />
            <Bar width="58%" />
          </div>
        </div>
      </div>
      <div className="sk-tabs">
        {[90, 70, 110, 80].map((w, i) => <Bar key={i} width={w} height={12} />)}
      </div>
      <ListBody rows={rows} />
    </>
  );
}

// variant: 'list' (default), 'table', 'dashboard' or 'detail'.
// className is the page's own wrapper - 'page-inner' in the office app,
// 'container' in the cleaner app, none in the client portal.
export function PageSkeleton({ variant = 'list', className = 'page-inner', rows }) {
  return (
    <div className={className} role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading</span>
      <div aria-hidden="true">
        <Header />
        {variant === 'dashboard' && <DashboardBody />}
        {variant === 'table' && <TableBody rows={rows ?? 8} />}
        {variant === 'detail' && <DetailBody rows={rows ?? 2} />}
        {variant === 'list' && <ListBody rows={rows ?? 4} />}
      </div>
    </div>
  );
}

// For one section of a page that loads on its own (a tab, a panel), in place
// of a "Loading..." line.
export function SkeletonLines({ rows = 3, label = 'Loading' }) {
  return (
    <div className="sk-lines" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <Bar key={i} width={WIDTHS[i % WIDTHS.length]} />
      ))}
    </div>
  );
}

// Grey menu rows for an app shell's sidebar while the sign-in is checked -
// the real items depend on the person's role, so none are guessed.
export function SkeletonNav({ rows = 9 }) {
  return (
    <div className="sk-nav" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="sk-nav-row">
          <Bar width={18} height={18} style={{ borderRadius: 5 }} />
          <Bar width={`${45 + ((i * 17) % 35)}%`} />
        </div>
      ))}
    </div>
  );
}
