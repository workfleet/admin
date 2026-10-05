'use client';

import { CONDITIONS, isSafetyCheck, roomPhotos } from '../../lib/detailedReport';

const CONDITION_COLOURS = {
  good: 'var(--wf-verified)',
  fair: 'var(--muted)',
  needs_attention: 'var(--wf-overdue)',
  not_photographed: 'var(--wf-overdue)',
};

const isNone = (text) => !text || /^(none( noted)?|not recorded|n\/a)\.?$/i.test(text.trim());

function Thumb({ photo, label, url, room }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" style={{ width: 112, textDecoration: 'none', color: 'inherit' }} title={photo.caption || room}>
      <img src={url} alt={photo.caption || room} style={{ width: 112, height: 84, objectFit: 'cover', borderRadius: 6, display: 'block' }} />
      <span style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginTop: 2 }}>{label}</span>
      {photo.caption && <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)', lineHeight: 1.3 }}>{photo.caption}</span>}
    </a>
  );
}

// The room-by-room part of a detailed report (job_reports.rooms, 0122):
// fire alarm panel, fire doors and bins first, then each room as it was
// found, what was done, anything wrong, and before/after photos. photoUrls
// maps a photo id to a signed URL; a photo missing from it is left out.
export default function ReportRooms({ rooms, photoUrls = {} }) {
  if (!rooms?.length) return null;
  const ordered = [...rooms.filter((r) => isSafetyCheck(r.room)), ...rooms.filter((r) => !isSafetyCheck(r.room))];

  return (
    <div style={{ margin: '6px 0 12px' }}>
      {ordered.map((room, i) => {
        const { before, after } = roomPhotos(room);
        const tiles = [
          ...before.map((p) => ({ p, label: 'Before' })),
          ...after.map((p) => ({ p, label: 'After' })),
        ].filter((t) => photoUrls[t.p.id]);
        return (
          <div key={i} style={{ padding: '10px 0', borderTop: '1px solid var(--hairline)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
              <strong style={{ fontSize: 14.5 }}>{room.room}</strong>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: CONDITION_COLOURS[room.condition] || 'var(--muted)' }}>
                {CONDITIONS[room.condition] || CONDITIONS.fair}
              </span>
            </div>
            {room.on_arrival && <p style={{ margin: '4px 0 0', fontSize: 14 }}><strong>Found:</strong> {room.on_arrival}</p>}
            {!isNone(room.work_done) && <p style={{ margin: '4px 0 0', fontSize: 14 }}><strong>Done:</strong> {room.work_done}</p>}
            {!isNone(room.issues) && (
              <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--wf-overdue)' }}><strong>Issue:</strong> {room.issues}</p>
            )}
            {tiles.length > 0 && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                {tiles.map(({ p, label }) => <Thumb key={p.id} photo={p} label={label} url={photoUrls[p.id]} room={room.room} />)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
