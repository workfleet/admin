'use client';

import { CONDITIONS } from '../../lib/detailedReport';

const CONDITION_COLOURS = {
  good: 'var(--wf-verified)',
  fair: 'var(--muted)',
  needs_attention: 'var(--wf-overdue)',
};

// The room-by-room part of a detailed report (job_reports.rooms, 0122).
// photoUrls maps a photo id to a signed URL; a room whose photos aren't in
// it just shows its text.
export default function ReportRooms({ rooms, photoUrls = {} }) {
  if (!rooms?.length) return null;

  return (
    <div style={{ margin: '6px 0 12px' }}>
      {rooms.map((room, i) => (
        <div key={i} style={{ padding: '10px 0', borderTop: '1px solid var(--hairline)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
            <strong style={{ fontSize: 14.5 }}>{room.room}</strong>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: CONDITION_COLOURS[room.condition] || 'var(--muted)' }}>
              {CONDITIONS[room.condition] || CONDITIONS.fair}
            </span>
          </div>
          {room.work_done && <p style={{ margin: '4px 0 0', fontSize: 14 }}>{room.work_done}</p>}
          {room.issues && !/^none( noted)?\.?$/i.test(room.issues.trim()) && (
            <p style={{ margin: '4px 0 0', fontSize: 14, color: room.condition === 'needs_attention' ? 'var(--wf-overdue)' : 'inherit' }}>
              Issue: {room.issues}
            </p>
          )}
          {(room.photo_ids || []).some((id) => photoUrls[id]) && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              {room.photo_ids.filter((id) => photoUrls[id]).map((id) => (
                <a key={id} href={photoUrls[id]} target="_blank" rel="noopener noreferrer">
                  <img src={photoUrls[id]} alt={room.room} style={{ width: 96, height: 72, objectFit: 'cover', borderRadius: 6, display: 'block' }} />
                </a>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
