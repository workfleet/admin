import {
  KIND_LABELS, INCIDENT_TYPE_LABELS, INJURED_PARTY_LABELS, TREATMENT_LABELS, wasInjured,
} from '../../lib/incidents';

// What the person on site wrote, laid out the same for them and for the
// office. Read-only: the staff half of a report is never edited (0130).
// photoUrls are signed URLs, in the same order as report.photo_paths.

function Row({ label, children }) {
  if (children === null || children === undefined || children === '') return null;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)' }}>
        {label}
      </div>
      <div style={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>{children}</div>
    </div>
  );
}

export function formatWhen(value) {
  return new Date(value).toLocaleString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export default function IncidentDetails({ report, photoUrls = [] }) {
  const injured = wasInjured(report);
  const jobAddress = report.jobs?.properties?.address;
  const injuredWho = report.injured_party === 'me'
    ? `${report.reporter?.full_name || 'The person reporting'} (reported it themselves)`
    : [INJURED_PARTY_LABELS[report.injured_party], report.injured_name].filter(Boolean).join(': ');

  return (
    <div>
      <Row label="Type">{KIND_LABELS[report.kind]}</Row>
      {report.kind === 'incident' && <Row label="What kind">{INCIDENT_TYPE_LABELS[report.incident_type]}</Row>}
      <Row label="Told to the office by">{report.told_by}</Row>
      <Row label="When">{formatWhen(report.occurred_at)}</Row>
      <Row label="Where">{report.location}</Row>
      {jobAddress && jobAddress !== report.location && <Row label="On the job at">{jobAddress}</Row>}
      <Row label="What happened">{report.description}</Row>
      {report.kind === 'accident' && (
        <>
          <Row label="Who was hurt">{report.injured_party === 'nobody' ? 'Nobody' : injuredWho}</Row>
          {injured && <Row label="Their address">{report.injured_address}</Row>}
          {injured && <Row label="Their occupation">{report.injured_occupation}</Row>}
          {injured && <Row label="Injury">{report.injury_details}</Row>}
          {injured && <Row label="Treatment">{TREATMENT_LABELS[report.treatment]}</Row>}
        </>
      )}
      <Row label="Damage, loss or theft">{report.damage_details}</Row>
      <Row label="Done straight after">{report.immediate_action}</Row>
      <Row label="Witnesses">{report.witnesses}</Row>
      {photoUrls.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
          {photoUrls.map((url, i) => (url ? (
            <a key={url} href={url} target="_blank" rel="noreferrer" title="Open the photo full size">
              <img src={url} alt={`Photo ${i + 1} of the ${KIND_LABELS[report.kind].toLowerCase()}`} style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--hairline)' }} />
            </a>
          ) : null))}
        </div>
      )}
      <Row label="Reported">
        {`${formatWhen(report.created_at)}${report.reporter?.full_name ? ` by ${report.reporter.full_name}` : ''}`}
      </Row>
      {(report.recorded_by_address || report.recorded_by_occupation) && (
        <Row label="Recorder (for the accident book)">
          {[report.recorded_by_occupation, report.recorded_by_address].filter(Boolean).join(' - ')}
        </Row>
      )}
    </div>
  );
}
