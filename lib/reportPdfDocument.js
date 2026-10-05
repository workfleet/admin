// The printable property report: one visit, or a month of visits at one
// property. Typeset in the same letter style as the quotation
// (quotePdfDocument.js) so the two look like they came from one company -
// letterhead, hairline rules, a serif text face, colour only in the rule
// under the letterhead.
//
// Photos arrive already fetched, as { id, data, format }, so this file
// never touches storage and can be rendered from a test.
import {
  Document, Page, View, Text, Image, StyleSheet,
} from '@react-pdf/renderer';
import { COMPANY, PLATFORM, legalFooterLine } from './companyBranding';
import { CONDITIONS, formatDuration, monthLabel, summariseVisits } from './detailedReport';
import { REPORT_TEMPLATES, DEFAULT_TEMPLATE } from './reportTemplates';

const INK = '#1a1d1e';
const MUTED = '#55605f';
const FAINT = '#8b9697';
const RULE = '#c9d0cf';
const HAIRLINE = '#e3e8e7';
const ATTENTION = '#a33a2e';

const BODY = 'Times-Roman';
const BODY_BOLD = 'Times-Bold';
const HEAD = 'Helvetica-Bold';

const styles = StyleSheet.create({
  page: {
    paddingTop: 46, paddingBottom: 62, paddingHorizontal: 54,
    fontSize: 10.5, fontFamily: BODY, color: INK, lineHeight: 1.35,
  },

  // Each footer line is placed on its own: a single absolute footer box
  // printed only its last line.
  footerRule: { position: 'absolute', bottom: 49, left: 54, right: 54, borderTopWidth: 0.5, borderTopColor: RULE },
  footerLeft: { position: 'absolute', bottom: 35, left: 54, fontSize: 7.5, color: FAINT, fontFamily: 'Helvetica' },
  footerLegal: { position: 'absolute', bottom: 24, left: 54, right: 54, fontSize: 6.5, color: FAINT, fontFamily: 'Helvetica' },

  letterhead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  letterheadName: { fontFamily: HEAD, fontSize: 15, letterSpacing: -0.2 },
  letterheadLegal: { fontSize: 7.5, color: FAINT, fontFamily: 'Helvetica', marginTop: 2 },
  letterheadContact: { fontSize: 8.5, color: MUTED, textAlign: 'right', lineHeight: 1.4 },
  letterheadRule: { borderBottomWidth: 1, marginTop: 7, marginBottom: 16 },

  addressRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 18 },
  addressee: { width: '58%' },
  addresseeLabel: { fontSize: 8, color: FAINT, fontFamily: 'Helvetica', marginBottom: 3 },
  addresseeName: { fontFamily: BODY_BOLD, fontSize: 11.5 },
  addresseeLine: { fontSize: 10, color: MUTED, marginTop: 1 },
  refBlock: { width: '38%' },
  refRow: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 1 },
  refLabel: { fontSize: 9, color: FAINT, fontFamily: 'Helvetica', marginRight: 8 },
  refValue: { fontSize: 9.5, textAlign: 'right' },

  subject: { fontFamily: BODY_BOLD, fontSize: 12, marginBottom: 3 },
  subjectRule: { borderBottomWidth: 0.5, borderBottomColor: RULE, marginBottom: 14 },

  section: { marginBottom: 14 },
  sectionTitle: { fontFamily: HEAD, fontSize: 10, marginBottom: 5 },
  para: { marginBottom: 6 },
  muted: { color: MUTED },
  label: { fontFamily: HEAD, fontSize: 8.5, color: MUTED, marginBottom: 2, marginTop: 4 },

  kvRow: { flexDirection: 'row', marginBottom: 1.5, paddingLeft: 8 },
  kvLabel: { width: 132, color: MUTED },
  kvValue: { flex: 1 },

  bulletRow: { flexDirection: 'row', marginBottom: 1.5, paddingLeft: 8 },
  bulletDot: { width: 10 },
  bulletText: { flex: 1 },

  table: { marginBottom: 10 },
  tableHead: { flexDirection: 'row', borderBottomWidth: 0.75, borderBottomColor: INK, paddingBottom: 3 },
  tableHeadCell: { fontFamily: HEAD, fontSize: 8.5 },
  tableRow: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: HAIRLINE, paddingVertical: 3.5 },
  tableCell: { fontSize: 10 },

  visitHead: { borderTopWidth: 0.75, borderTopColor: INK, paddingTop: 6, marginBottom: 6, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  visitTitle: { fontFamily: HEAD, fontSize: 11 },
  visitMeta: { fontSize: 9, color: MUTED, fontFamily: 'Helvetica' },

  room: { borderBottomWidth: 0.5, borderBottomColor: HAIRLINE, paddingVertical: 6 },
  roomHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 2 },
  roomName: { fontFamily: BODY_BOLD, fontSize: 11 },
  roomCondition: { fontFamily: 'Helvetica', fontSize: 8.5 },

  photoRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 5 },
  photo: { width: 150, height: 112, objectFit: 'cover', marginRight: 8, marginBottom: 8 },
});

const COLUMN_WIDTHS = [0.26, 0.38, 0.18, 0.18];

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' });
}

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
}

const STATUS_LABELS = { completed: 'Completed', in_progress: 'In progress', missed: 'Missed' };

// "None noted." and its cousins add nothing to a printed page.
function hasContent(text) {
  const t = String(text || '').trim().toLowerCase().replace(/[.\s]+$/, '');
  return t !== '' && t !== 'none' && t !== 'none noted' && t !== 'n/a';
}

function Photos({ ids, photosById }) {
  const images = (ids || []).map((id) => photosById.get(id)).filter(Boolean);
  if (images.length === 0) return null;
  return (
    <View style={styles.photoRow}>
      {images.map((p) => (
        <Image key={p.id} style={styles.photo} src={{ data: p.data, format: p.format }} />
      ))}
    </View>
  );
}

function Room({ room, photosById }) {
  const attention = room.condition === 'needs_attention';
  return (
    <View style={styles.room} wrap={false}>
      <View style={styles.roomHead}>
        <Text style={styles.roomName}>{room.room}</Text>
        <Text style={[styles.roomCondition, { color: attention ? ATTENTION : MUTED }]}>
          {CONDITIONS[room.condition] || CONDITIONS.fair}
        </Text>
      </View>
      {room.work_done ? <Text>{room.work_done}</Text> : null}
      {hasContent(room.issues) && (
        <Text style={{ marginTop: 2, color: attention ? ATTENTION : INK }}>Issue: {room.issues}</Text>
      )}
      <Photos ids={room.photo_ids} photosById={photosById} />
    </View>
  );
}

function Visit({ visit, photosById, printedPhotoIds, showHeading }) {
  const report = visit.report;
  const labels = (REPORT_TEMPLATES[report?.template] || REPORT_TEMPLATES[DEFAULT_TEMPLATE]).sectionLabels;

  return (
    <View style={styles.section}>
      {showHeading && (
        <View style={styles.visitHead} minPresenceAhead={80}>
          <Text style={styles.visitTitle}>{fmtDate(visit.scheduled_at)}</Text>
          <Text style={styles.visitMeta}>
            {[visit.staff.join(', '), visit.minutes > 0 ? formatDuration(visit.minutes) + ' on site' : null].filter(Boolean).join(' · ')}
          </Text>
        </View>
      )}

      {visit.status === 'missed' && <Text style={styles.muted}>This visit did not go ahead.</Text>}

      {visit.status !== 'missed' && !report && (
        <>
          <Text style={[styles.para, styles.muted]}>No written report for this visit.</Text>
          <Photos ids={printedPhotoIds} photosById={photosById} />
        </>
      )}

      {report && (
        <>
          {hasContent(report.summary) && (
            <>
              <Text style={styles.label} minPresenceAhead={30}>{labels.summary.toUpperCase()}</Text>
              <Text style={styles.para}>{report.summary}</Text>
            </>
          )}

          {report.rooms?.length > 0
            ? report.rooms.map((room, i) => <Room key={i} room={room} photosById={photosById} />)
            : <Photos ids={printedPhotoIds} photosById={photosById} />}

          {hasContent(report.issues) && (
            <>
              <Text style={styles.label} minPresenceAhead={30}>{labels.issues.toUpperCase()}</Text>
              <Text style={styles.para}>{report.issues}</Text>
            </>
          )}
          {hasContent(report.suggestions) && (
            <>
              <Text style={styles.label} minPresenceAhead={30}>{labels.suggestions.toUpperCase()}</Text>
              <Text style={styles.para}>{report.suggestions}</Text>
            </>
          )}
        </>
      )}
    </View>
  );
}

// property: { address, clients: { name } }
// visits: as loaded by loadDetailedReport, in date order
// month: '2026-10' for a monthly report, null for a single visit
// photos: [{ id, data, format }] - every photo to print, already fetched
// printed: Map(visitId -> photo ids) for visits with no room report
export default function ReportPdfDocument({ property, visits, month = null, photos = [], printed = new Map(), company = COMPANY, now = new Date() }) {
  const photosById = new Map(photos.map((p) => [p.id, p]));
  const legal = legalFooterLine(company);
  const monthly = !!month;
  const summary = summariseVisits(visits);
  const title = monthly
    ? `Monthly property report - ${monthLabel(month)}`
    : `Visit report - ${visits[0] ? fmtDate(visits[0].scheduled_at) : ''}`;

  const reference = monthly
    ? [{ label: 'Period', value: monthLabel(month) }, { label: 'Prepared', value: now.toLocaleDateString('en-GB', { timeZone: 'Europe/London' }) }]
    : [
      { label: 'Visit', value: visits[0] ? new Date(visits[0].scheduled_at).toLocaleDateString('en-GB', { timeZone: 'Europe/London' }) : '' },
      { label: 'Booked for', value: visits[0] ? fmtTime(visits[0].scheduled_at) : '' },
      { label: 'Cleaners', value: visits[0]?.staff.join(', ') || '—' },
      { label: 'On site', value: formatDuration(visits[0]?.minutes) },
    ];

  return (
    <Document title={`${title} - ${property.address}`} author={company.legalName} creator={PLATFORM.name} producer={PLATFORM.name}>
      <Page size="A4" style={styles.page}>
        <View style={styles.footerRule} fixed />
        <Text style={styles.footerLeft} fixed>{company.name} · {company.website} · {company.phone}</Text>
        <Text style={styles.footerLegal} fixed>{legal}</Text>

        <View style={styles.letterhead}>
          <View>
            <Text style={styles.letterheadName}>{company.name}</Text>
            <Text style={styles.letterheadLegal}>{company.legalName}</Text>
          </View>
          <Text style={styles.letterheadContact}>
            {company.address}{'\n'}{company.phone} · {company.email}
          </Text>
        </View>
        <View style={[styles.letterheadRule, { borderBottomColor: company.brandColor }]} />

        <View style={styles.addressRow}>
          <View style={styles.addressee}>
            <Text style={styles.addresseeLabel}>PROPERTY</Text>
            <Text style={styles.addresseeName}>{property.address}</Text>
            {property.clients?.name && <Text style={styles.addresseeLine}>For {property.clients.name}</Text>}
          </View>
          <View style={styles.refBlock}>
            {reference.map((line) => (
              <View key={line.label} style={styles.refRow}>
                <Text style={styles.refLabel}>{line.label}</Text>
                <Text style={styles.refValue}>{line.value}</Text>
              </View>
            ))}
          </View>
        </View>

        <Text style={styles.subject}>{title}</Text>
        <View style={styles.subjectRule} />

        {monthly && (
          <>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Summary</Text>
              <View style={styles.kvRow}><Text style={styles.kvLabel}>Visits completed</Text><Text style={styles.kvValue}>{summary.visitCount}</Text></View>
              {summary.missedCount > 0 && (
                <View style={styles.kvRow}><Text style={styles.kvLabel}>Visits missed</Text><Text style={styles.kvValue}>{summary.missedCount}</Text></View>
              )}
              <View style={styles.kvRow}><Text style={styles.kvLabel}>Time on site</Text><Text style={styles.kvValue}>{formatDuration(summary.minutes)}</Text></View>
              <View style={styles.kvRow}><Text style={styles.kvLabel}>Visits with a report</Text><Text style={styles.kvValue}>{summary.reportCount} of {summary.visitCount}</Text></View>
            </View>

            {summary.roomsNeedingAttention.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Needs attention</Text>
                {summary.roomsNeedingAttention.map((r, i) => (
                  <View key={i} style={styles.bulletRow} wrap={false}>
                    <Text style={styles.bulletDot}>—</Text>
                    <Text style={styles.bulletText}>
                      {new Date(r.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' })}, {r.room}{hasContent(r.issues) ? `: ${r.issues}` : ''}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {visits.length > 0 && (
              <View style={styles.table}>
                <View style={styles.tableHead}>
                  {['Date', 'Cleaners', 'On site', 'Status'].map((c, i) => (
                    <Text key={c} style={[styles.tableHeadCell, { flex: COLUMN_WIDTHS[i] }]}>{c}</Text>
                  ))}
                </View>
                {visits.map((v) => (
                  <View key={v.id} style={styles.tableRow} wrap={false}>
                    <Text style={[styles.tableCell, { flex: COLUMN_WIDTHS[0] }]}>
                      {new Date(v.scheduled_at).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London' })}
                    </Text>
                    <Text style={[styles.tableCell, { flex: COLUMN_WIDTHS[1] }]}>{v.staff.join(', ') || '—'}</Text>
                    <Text style={[styles.tableCell, { flex: COLUMN_WIDTHS[2] }]}>{formatDuration(v.minutes)}</Text>
                    <Text style={[styles.tableCell, { flex: COLUMN_WIDTHS[3] }]}>{STATUS_LABELS[v.status] || v.status}</Text>
                  </View>
                ))}
              </View>
            )}

            {visits.length === 0 && <Text style={styles.muted}>No visits at this property in {monthLabel(month)}.</Text>}
          </>
        )}

        {visits.map((v) => (
          <Visit key={v.id} visit={v} photosById={photosById} printedPhotoIds={printed.get(v.id)} showHeading={monthly} />
        ))}
      </Page>
    </Document>
  );
}
