// components/Logo.js
//
// WorkFleet — Route W mark
//
// Usage:
//   <Logo />                                  mark only, 32px, dark on light
//   <Logo size={44} showWordmark />           horizontal lockup
//   <Logo size={44} showWordmark tone="light" />   for the graphite sidebar
//   <Logo size={44} showWordmark stacked tone="light" />  square spaces
//   <Logo size={18} />                        auto-switches to the compact version
//
// The mark drops its four graphite nodes below 20px, because at that size
// they merge into the stroke and turn it into a blob.

export default function Logo({
  size = 32,
  tone = 'dark',        // 'dark' = graphite mark (use on white/ash)
                        // 'light' = white mark (use on graphite)
  showWordmark = false,
  stacked = false,
  className = '',
}) {
  const stroke = tone === 'light' ? '#FFFFFF' : '#202327';
  const textColour = tone === 'light' ? '#FFFFFF' : '#202327';
  const CORAL = '#FF6B5B';

  const compact = size < 20;

  const mark = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      // With the wordmark alongside, the mark is decorative - otherwise a
      // screen reader announces "WorkFleet" twice.
      {...(showWordmark
        ? { 'aria-hidden': true }
        : { role: 'img', 'aria-label': 'WorkFleet' })}
      style={{ flex: 'none', display: 'block' }}
    >
      <path
        d="M8 16 L20 48 L32 20 L44 48 L56 16"
        fill="none"
        stroke={stroke}
        strokeWidth={compact ? 6.5 : 4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {!compact && (
        <>
          <circle cx="8" cy="16" r="5.5" fill={stroke} />
          <circle cx="20" cy="48" r="5.5" fill={stroke} />
          <circle cx="32" cy="20" r="5.5" fill={stroke} />
          <circle cx="44" cy="48" r="5.5" fill={stroke} />
        </>
      )}

      {/* the last node is always coral — it's where the cleaner is now */}
      <circle cx="56" cy="16" r={compact ? 9 : 7} fill={CORAL} />
    </svg>
  );

  if (!showWordmark) {
    return <span className={className} style={{ display: 'inline-flex' }}>{mark}</span>;
  }

  const horizontalWordmark = (
    <span
      style={{
        fontFamily: 'var(--wf-display, Poppins, system-ui, sans-serif)',
        fontSize: size * 0.62,
        fontWeight: 600,
        letterSpacing: '-0.04em',
        color: textColour,
        lineHeight: 1,
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ fontWeight: 300 }}>Work</span>Fleet
    </span>
  );

  const stackedWordmark = (
    <span
      style={{
        fontFamily: 'var(--wf-display, Poppins, system-ui, sans-serif)',
        fontSize: size * 0.42,
        fontWeight: 500,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: textColour,
        lineHeight: 1,
      }}
    >
      Workfleet
    </span>
  );

  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        flexDirection: stacked ? 'column' : 'row',
        alignItems: stacked ? 'flex-start' : 'center',
        gap: stacked ? size * 0.28 : size * 0.32,
      }}
    >
      {mark}
      {stacked ? stackedWordmark : horizontalWordmark}
    </span>
  );
}
