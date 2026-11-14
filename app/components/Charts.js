'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';

// Small, dependency-free charts for the Insights page.
//
// Specs (see the dataviz guidance this was built to): thin columns capped at
// 24px with a 4px rounded top and a square baseline; a 2px surface gap
// between stacked parts; hairline solid gridlines; text in text colours,
// never the series colour; a legend whenever there are two series; a
// tooltip on hover and keyboard focus; every value also reachable in a
// table, so nothing is hover-only.
//
// Colours were checked with the palette validator on white: blue #1F6FEF
// and red #D81E34 pass lightness, chroma, colour-blind separation and
// contrast together.
export const VIZ = {
  blue: '#1F6FEF',
  blueTrack: '#DCE7FC',
  red: '#D81E34',
  grid: '#ECEDEF',
};

function useWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return undefined;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

// Round numbers for the axis: 0, 50, 100... reaching just past the top.
function niceTicks(max, count = 4) {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
  const top = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(Math.round(v * 100) / 100);
  return ticks;
}

// A column with a 4px rounded top and a square foot.
function columnPath(x, y, w, h, r = 4) {
  if (h <= 0) return '';
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}

export function Legend({ series }) {
  return (
    <div className="viz-legend">
      {series.map((s) => (
        <span key={s.key}><i style={{ background: s.colour }} />{s.label}</span>
      ))}
    </div>
  );
}

// data:   [{ label, sublabel?, values: { [seriesKey]: number }, partial? }]
// series: [{ key, label, colour }] - more than one stacks, first at the foot
// format: value -> string, for tooltip, table and the one direct label
export function ColumnChart({ data, series, format = (v) => String(v), height = 200, caption }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const pad = { top: 18, right: 4, bottom: 26, left: 36 };
  const plotW = Math.max(0, width - pad.left - pad.right);
  const plotH = height - pad.top - pad.bottom;
  const totals = data.map((d) => series.reduce((s, x) => s + (d.values[x.key] || 0), 0));
  const ticks = niceTicks(Math.max(...totals, 0));
  const top = ticks[ticks.length - 1] || 1;
  const band = data.length ? plotW / data.length : 0;
  const barW = Math.min(24, Math.max(6, band * 0.55));
  const y = (v) => pad.top + plotH - (v / top) * plotH;
  // One direct label: the latest full week, the figure people look for.
  const labelAt = data.length > 1 && data[data.length - 1].partial ? data.length - 2 : data.length - 1;
  // Axis labels thin out when the columns are too narrow for them ("24 Aug"
  // needs about 52px), counting back from the latest so it is always shown.
  const labelEvery = band > 0 ? Math.max(1, Math.ceil(52 / band)) : 1;
  const showLabel = (i) => (data.length - 1 - i) % labelEvery === 0;

  const tip = hover != null ? data[hover] : null;
  const tipLeft = hover != null ? pad.left + band * hover + band / 2 : 0;

  return (
    <div className="viz-chart" ref={ref}>
      {series.length > 1 && <Legend series={series} />}
      <div className="viz-plot" style={{ height }}>
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label={caption}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} stroke={VIZ.grid} strokeWidth="1" />
                <text x={pad.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="viz-tick">{format(t)}</text>
              </g>
            ))}
            {data.map((d, i) => {
              const cx = pad.left + band * i + band / 2;
              let base = 0;
              const parts = series.map((s, si) => {
                const v = d.values[s.key] || 0;
                if (v <= 0) return null;
                const y0 = y(base + v);
                const h = y(base) - y0 - (base > 0 ? 2 : 0); // 2px surface gap above the part below
                base += v;
                const isTop = series.slice(si + 1).every((n) => !(d.values[n.key] > 0));
                return isTop
                  ? <path key={s.key} d={columnPath(cx - barW / 2, y0, barW, h)} fill={s.colour} opacity={d.partial ? 0.45 : 1} />
                  : <rect key={s.key} x={cx - barW / 2} y={y0} width={barW} height={Math.max(0, h)} fill={s.colour} opacity={d.partial ? 0.45 : 1} />;
              });
              return (
                <g key={i}>
                  {parts}
                  {i === labelAt && totals[i] > 0 && (
                    <text x={cx} y={y(totals[i]) - 6} textAnchor="middle" className="viz-value">{format(totals[i])}</text>
                  )}
                  {showLabel(i) && <text x={cx} y={height - 8} textAnchor="middle" className="viz-tick">{d.label}</text>}
                  {/* The whole column band is the hover / focus target, not just the bar. */}
                  <rect
                    x={pad.left + band * i}
                    y={pad.top}
                    width={band}
                    height={plotH}
                    fill={hover === i ? 'rgba(32,35,39,0.04)' : 'transparent'}
                    tabIndex={0}
                    aria-label={`${d.sublabel || d.label}: ${series.map((s) => `${s.label} ${format(d.values[s.key] || 0)}`).join(', ')}${d.partial ? ' (so far)' : ''}`}
                    onPointerEnter={() => setHover(i)}
                    onPointerLeave={() => setHover(null)}
                    onFocus={() => setHover(i)}
                    onBlur={() => setHover(null)}
                    style={{ outline: 'none', cursor: 'default' }}
                  />
                </g>
              );
            })}
            <line x1={pad.left} x2={width - pad.right} y1={y(0)} y2={y(0)} stroke="#D5D8DC" strokeWidth="1" />
          </svg>
        )}
        {tip && (
          <div className="viz-tip" style={{ left: Math.min(Math.max(tipLeft, 70), width - 70), top: 0 }}>
            <div className="viz-tip-head">{tip.sublabel || tip.label}{tip.partial ? ' · so far' : ''}</div>
            {[...series].reverse().map((s) => (
              <div key={s.key} className="viz-tip-row">
                <i style={{ background: s.colour }} />
                <b>{format(tip.values[s.key] || 0)}</b>
                <span>{s.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <details className="viz-table">
        <summary>View as table</summary>
        <table className="wf-table">
          <thead>
            <tr><th>{caption}</th>{series.map((s) => <th key={s.key} className="num">{s.label}</th>)}</tr>
          </thead>
          <tbody>
            {data.map((d, i) => (
              <tr key={i}>
                <td>{d.sublabel || d.label}{d.partial ? ' (so far)' : ''}</td>
                {series.map((s) => <td key={s.key} className="num">{format(d.values[s.key] || 0)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

// Ranked horizontal bars, one hue, largest first, the value at each tip.
// rows: [{ key, label, value, note? }]
export function RankedBars({ rows, format = (v) => String(v), colour = VIZ.blue }) {
  const max = Math.max(...rows.map((r) => r.value), 0) || 1;
  return (
    <div className="viz-ranked">
      {rows.map((r) => (
        <div key={r.key} className="viz-ranked-row" title={r.note ? `${r.label} · ${format(r.value)} · ${r.note}` : `${r.label} · ${format(r.value)}`}>
          <span className="viz-ranked-label">{r.label}</span>
          <span className="viz-ranked-track">
            <span className="viz-ranked-bar" style={{ width: `${(r.value / max) * 100}%`, background: colour }} />
          </span>
          <span className="viz-ranked-value">{format(r.value)}</span>
        </div>
      ))}
    </div>
  );
}

// A meter per row: name, a bar against its own whole, and the figure.
// rows: [{ key, label, value (0-1), figure }]
export function MeterList({ rows }) {
  return (
    <div className="viz-meters">
      {rows.map((r) => (
        <div key={r.key} className="viz-meter-row">
          <span className="viz-meter-label">{r.label}</span>
          <span className="viz-meter-track" style={{ background: VIZ.blueTrack }}>
            <span className="viz-meter-fill" style={{ width: `${Math.round(r.value * 100)}%`, background: VIZ.blue }} />
          </span>
          <span className="viz-meter-figure">{r.figure}</span>
        </div>
      ))}
    </div>
  );
}

// A headline figure with its change against the previous period.
// upIsGood: whether a rise is good news (more visits) or bad (more missed).
export function StatTile({ label, value, now, before, upIsGood = true, formatDelta, period }) {
  let delta = null;
  if (now != null && before != null) {
    const diff = now - before;
    const flat = Math.abs(diff) < 1e-9;
    const good = flat ? null : (diff > 0) === upIsGood;
    const Icon = flat ? Minus : diff > 0 ? ArrowUpRight : ArrowDownRight;
    delta = (
      <span className={`viz-delta ${good == null ? '' : good ? 'is-good' : 'is-bad'}`}>
        <Icon size={14} aria-hidden />
        {flat ? 'No change' : formatDelta(diff)}
        <span className="viz-delta-period"> vs {period}</span>
      </span>
    );
  }
  return (
    <div className="viz-stat">
      <span className="viz-stat-label">{label}</span>
      <span className="viz-stat-value">{value}</span>
      {delta}
    </div>
  );
}
