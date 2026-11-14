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

import { FESTIVE } from '../../lib/festive';

// Snow for the festive lockup: fixed positions, so the server and the
// browser draw the same flakes. [x, y, radius, opacity] in a 200 x 60 box.
const SNOW = [
  [6, 9, 1.4, 0.5], [17, 41, 1, 0.7], [24, 18, 0.8, 0.4], [33, 52, 1.5, 0.5],
  [41, 6, 1, 0.7], [52, 30, 0.7, 0.4], [58, 47, 1.2, 0.6], [69, 12, 1.5, 0.4],
  [77, 55, 0.8, 0.7], [86, 26, 1, 0.4], [94, 4, 1.2, 0.6], [103, 44, 1.5, 0.4],
  [111, 16, 0.8, 0.7], [122, 54, 1, 0.5], [129, 8, 1.4, 0.4], [138, 36, 0.8, 0.6],
  [147, 50, 1.2, 0.4], [155, 14, 1, 0.7], [164, 29, 1.5, 0.4], [172, 56, 0.8, 0.6],
  [181, 7, 1.2, 0.5], [189, 40, 1, 0.7], [196, 21, 1.4, 0.4], [12, 28, 0.7, 0.6],
];

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
  // The white trim needs an edge on a light ground, and a graphite one on dark.
  const hatOutline = tone === 'light' ? '#202327' : '#C9CDD2';

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
      // overflow: the festive hat sits above and to the right of the box.
      style={{ flex: 'none', display: 'block', overflow: 'visible' }}
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

      {FESTIVE && (
        <g transform={compact ? 'translate(56 12) scale(1.4) translate(-56 -13)' : 'translate(56 13) scale(1.12) translate(-56 -13)'}>
          <path d="M49.2 10.2 C48.5 1.5 56 -4.5 66.5 -2.2 C62.8 0.2 63.2 5.2 63.6 8.2 Z" fill="#D7263D" />
          <rect
            x="46.6" y="6.9" width="19" height="5.2" rx="2.6"
            transform="rotate(-8 56 9.5)"
            fill="#FFFFFF" stroke={hatOutline} strokeWidth="0.8"
          />
          <circle cx="67" cy="-2" r="3" fill="#FFFFFF" stroke={hatOutline} strokeWidth="0.8" />
        </g>
      )}
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

  // Behind the lockup and a little beyond it. isolation keeps the negative
  // z-index inside this span, so the snow lands behind the logo but in front
  // of whatever the logo is sitting on.
  const snow = FESTIVE && (
    <svg
      aria-hidden
      viewBox="0 0 200 60"
      preserveAspectRatio="xMidYMid slice"
      style={{
        position: 'absolute',
        top: -size * 0.5,
        bottom: -size * 0.4,
        left: -size * 0.4,
        right: -size * 0.5,
        width: 'auto',
        height: 'auto',
        zIndex: -1,
        pointerEvents: 'none',
      }}
    >
      {SNOW.map(([x, y, r, o], i) => (
        <circle key={i} cx={x} cy={y} r={r} fill={tone === 'light' ? '#FFFFFF' : '#B4C3D3'} opacity={o} />
      ))}
    </svg>
  );

  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        flexDirection: stacked ? 'column' : 'row',
        alignItems: stacked ? 'flex-start' : 'center',
        gap: stacked ? size * 0.28 : size * 0.32,
        ...(FESTIVE ? { position: 'relative', isolation: 'isolate' } : null),
      }}
    >
      {snow}
      {mark}
      {stacked ? stackedWordmark : horizontalWordmark}
    </span>
  );
}
