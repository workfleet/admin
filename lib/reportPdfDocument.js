// The printable property report: one visit, or a month of visits at one
// property. Branded like the Swansea Bus Station document pack (SOPs, crew
// pack): the CrewConnect wordmark over a teal rule, Poppins throughout, a
// navy title, a details grid with grey label cells, and navy section bars -
// red where the landlord has something to deal with.
//
// Photos arrive already fetched, as { id, data, format }, so this file
// never touches storage and can be rendered from a test.
import path from 'path';
import {
  Document, Page, View, Text, Image, StyleSheet, Font,
} from '@react-pdf/renderer';
import { COMPANY, PLATFORM, legalFooterLine } from './companyBranding';
import {
  CONDITIONS, MAX_PHOTOS_PER_ROOM, formatDuration, isSafetyCheck, monthLabel, roomPhotos, shortAddress, summariseVisits,
} from './detailedReport';
import { REPORT_TEMPLATES, DEFAULT_TEMPLATE } from './reportTemplates';

// Poppins, embedded from lib/fonts (OFL - see lib/fonts/OFL.txt). Read from
// disk rather than fetched, so a report renders with no network.
const FONT_DIR = path.join(process.cwd(), 'lib', 'fonts');
Font.register({
  family: 'Poppins',
  fonts: [
    { src: path.join(FONT_DIR, 'Poppins-Regular.ttf'), fontWeight: 400 },
    { src: path.join(FONT_DIR, 'Poppins-Italic.ttf'), fontWeight: 400, fontStyle: 'italic' },
    { src: path.join(FONT_DIR, 'Poppins-Medium.ttf'), fontWeight: 500 },
    { src: path.join(FONT_DIR, 'Poppins-SemiBold.ttf'), fontWeight: 600 },
    { src: path.join(FONT_DIR, 'Poppins-Bold.ttf'), fontWeight: 700 },
  ],
});
// Long words (addresses, product names) break rather than hyphenate.
Font.registerHyphenationCallback((word) => [word]);

const NAVY = '#16313f';
const INK = '#1f2a30';
const MUTED = '#5b6870';
const FAINT = '#8a969c';
const LINE = '#d5dcdf';
const GREY_CELL = '#eef4f4';
const RED = '#9b2f25';
const RED_BG = '#fcefed';
const RED_LINE = '#e7b3ad';
const GREEN = '#2c7a4b';
const CALLOUT_BG = '#f0f7f7';

const styles = StyleSheet.create({
  page: {
    paddingTop: 36, paddingBottom: 54, paddingHorizontal: 40,
    fontFamily: 'Poppins', fontSize: 8.6, color: INK, lineHeight: 1.45,
  },

  footerText: { position: 'absolute', bottom: 30, left: 40, right: 40, fontSize: 7, color: FAINT },
  footerLegal: { position: 'absolute', bottom: 20, left: 40, right: 40, fontSize: 6, color: FAINT },

  // Wordmark left, document type right, teal rule under both.
  masthead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  wordmark: { fontSize: 17, fontWeight: 700, letterSpacing: -0.3, lineHeight: 1.1 },
  wordmarkSub: { fontSize: 6.5, letterSpacing: 2.4, color: MUTED, marginTop: 1 },
  docType: { fontSize: 8, color: MUTED, textAlign: 'right', lineHeight: 1.35 },
  mastRule: { borderBottomWidth: 2, marginTop: 6, marginBottom: 14 },

  title: { fontSize: 18, fontWeight: 700, color: NAVY, lineHeight: 1.2 },
  subtitle: { fontSize: 9.5, color: MUTED, marginTop: 1, marginBottom: 8 },

  grid: { borderWidth: 0.75, borderColor: LINE, marginBottom: 12 },
  gridRow: { flexDirection: 'row', borderBottomWidth: 0.75, borderColor: LINE },
  gridRowLast: { flexDirection: 'row' },
  gridLabel: { width: '15%', backgroundColor: GREY_CELL, fontWeight: 600, paddingVertical: 3.5, paddingHorizontal: 5, borderRightWidth: 0.75, borderColor: LINE },
  gridValue: { width: '35%', paddingVertical: 3.5, paddingHorizontal: 5, borderRightWidth: 0.75, borderColor: LINE },

  callout: { backgroundColor: CALLOUT_BG, borderLeftWidth: 3, paddingVertical: 7, paddingHorizontal: 9, marginBottom: 12 },
  calloutText: { fontSize: 9.5, lineHeight: 1.45 },

  // Section: a filled bar over a bordered body.
  section: { marginBottom: 11 },
  bar: { paddingVertical: 4, paddingHorizontal: 8 },
  barText: { color: '#ffffff', fontWeight: 600, fontSize: 10 },
  body: { borderWidth: 0.75, borderTopWidth: 0, paddingVertical: 6, paddingHorizontal: 8 },

  bulletRow: { flexDirection: 'row', marginBottom: 2 },
  bulletDot: { width: 9 },
  bulletText: { flex: 1 },

  pill: { fontSize: 7.2, fontWeight: 600, paddingVertical: 1, paddingHorizontal: 5, borderRadius: 6 },

  check: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 5, borderBottomWidth: 0.5, borderColor: LINE },
  checkLast: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 5 },
  checkImage: { width: 92, height: 69, objectFit: 'cover', borderRadius: 2 },

  room: { paddingVertical: 6, borderBottomWidth: 0.5, borderColor: LINE },
  roomLast: { paddingVertical: 6 },
  roomHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
  roomName: { fontSize: 10, fontWeight: 600, color: NAVY },
  line: { marginTop: 1.5 },
  lineLabel: { fontWeight: 600 },

  photoRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 5 },
  photo: { width: 120, height: 90, objectFit: 'cover', marginRight: 6, marginBottom: 6, borderRadius: 2 },
  tile: { width: 120, marginRight: 7, marginBottom: 4 },
  tileImage: { width: 120, height: 90, objectFit: 'cover', borderRadius: 2 },
  tileLabel: { fontSize: 7, fontWeight: 600, color: MUTED, marginTop: 2 },
  tileCaption: { fontSize: 6.6, color: FAINT, lineHeight: 1.3 },

  table: { borderWidth: 0.75, borderColor: LINE, marginBottom: 12 },
  tableHead: { flexDirection: 'row', backgroundColor: GREY_CELL, borderBottomWidth: 0.75, borderColor: LINE },
  tableHeadCell: { fontWeight: 600, paddingVertical: 3.5, paddingHorizontal: 5 },
  tableRow: { flexDirection: 'row', borderBottomWidth: 0.5, borderColor: LINE },
  tableCell: { paddingVertical: 3.5, paddingHorizontal: 5 },

  visitHead: { borderTopWidth: 2, borderColor: NAVY, paddingTop: 5, marginTop: 6, marginBottom: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  visitTitle: { fontSize: 12, fontWeight: 700, color: NAVY },
  visitMeta: { fontSize: 8, color: MUTED },

  muted: { color: MUTED },
  para: { marginBottom: 4 },
});

const COLUMN_WIDTHS = [0.26, 0.38, 0.18, 0.18];
const STATUS_LABELS = { completed: 'Completed', in_progress: 'In progress', missed: 'Missed' };

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' });
}

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
}

// "None noted." and its cousins add nothing to a printed page.
function hasContent(text) {
  const t = String(text || '').trim().toLowerCase().replace(/[.\s]+$/, '');
  return t !== '' && t !== 'none' && t !== 'none noted' && t !== 'n/a' && t !== 'not recorded';
}

const PILL = {
  good: { color: GREEN, backgroundColor: '#e7f3ec' },
  fair: { color: MUTED, backgroundColor: GREY_CELL },
  needs_attention: { color: RED, backgroundColor: RED_BG },
  not_photographed: { color: RED, backgroundColor: RED_BG },
};

function Pill({ condition, label }) {
  return <Text style={[styles.pill, PILL[condition] || PILL.fair]}>{label || CONDITIONS[condition] || CONDITIONS.fair}</Text>;
}

function Section({ title, tone = 'navy', children }) {
  const colour = tone === 'red' ? RED : tone === 'green' ? GREEN : NAVY;
  return (
    <View style={styles.section}>
      <View style={[styles.bar, { backgroundColor: colour }]} minPresenceAhead={50}>
        <Text style={styles.barText}>{title}</Text>
      </View>
      <View style={[styles.body, { borderColor: tone === 'red' ? RED_LINE : LINE, backgroundColor: tone === 'red' ? RED_BG : '#ffffff' }]}>
        {children}
      </View>
    </View>
  );
}

// "Kitchen: dishes left out.\nBins: overflowing." -> one bullet per line.
function Lines({ text }) {
  const lines = String(text || '').split('\n').map((l) => l.replace(/^[-•*—]\s*/, '').trim()).filter(Boolean);
  if (lines.length <= 1) return <Text>{lines[0] || ''}</Text>;
  return lines.map((line, i) => (
    <View key={i} style={styles.bulletRow} wrap={false}>
      <Text style={styles.bulletDot}>•</Text>
      <Text style={styles.bulletText}>{line}</Text>
    </View>
  ));
}

function imageOf(photosById, id) {
  const p = photosById.get(id);
  return p ? { data: p.data, format: p.format } : null;
}

function Photos({ ids, photosById }) {
  const images = (ids || []).filter((id) => photosById.has(id));
  if (images.length === 0) return null;
  return (
    <View style={styles.photoRow}>
      {images.map((id) => <Image key={id} style={styles.photo} src={imageOf(photosById, id)} />)}
    </View>
  );
}

// Before and after side by side, each labelled, with what it shows under it.
function BeforeAfter({ room, photosById }) {
  const { before, after } = roomPhotos(room);
  const tiles = [
    ...before.slice(0, MAX_PHOTOS_PER_ROOM).map((p) => ({ ...p, label: 'Before' })),
    ...after.slice(0, MAX_PHOTOS_PER_ROOM).map((p) => ({ ...p, label: 'After' })),
  ].filter((p) => photosById.has(p.id));
  if (tiles.length === 0) return null;
  return (
    <View style={styles.photoRow}>
      {tiles.map((p) => (
        <View key={p.id} style={styles.tile}>
          <Image style={styles.tileImage} src={imageOf(photosById, p.id)} />
          <Text style={styles.tileLabel}>{p.label}</Text>
          {p.caption ? <Text style={styles.tileCaption}>{p.caption}</Text> : null}
        </View>
      ))}
    </View>
  );
}

function Room({ room, photosById, last }) {
  return (
    <View style={last ? styles.roomLast : styles.room} wrap={false}>
      <View style={styles.roomHead}>
        <Text style={styles.roomName}>{room.room}</Text>
        <Pill condition={room.condition} />
      </View>
      {hasContent(room.on_arrival) && <Text style={styles.line}><Text style={styles.lineLabel}>Found: </Text>{room.on_arrival}</Text>}
      {hasContent(room.work_done) && <Text style={styles.line}><Text style={styles.lineLabel}>Done: </Text>{room.work_done}</Text>}
      {hasContent(room.issues) && <Text style={[styles.line, { color: RED }]}><Text style={styles.lineLabel}>Issue: </Text>{room.issues}</Text>}
      <BeforeAfter room={room} photosById={photosById} />
    </View>
  );
}

// The heading is kept on the page with the first room, and the rooms run
// on without a surrounding box - a box split across pages leaves its sides
// running down the margins.
function RoomByRoom({ rooms, photosById }) {
  return (
    <View style={styles.section}>
      <View wrap={false}>
        <View style={[styles.bar, { backgroundColor: NAVY }]}>
          <Text style={styles.barText}>Room by room</Text>
        </View>
        <View style={{ paddingHorizontal: 8 }}>
          <Room room={rooms[0]} photosById={photosById} last={rooms.length === 1} />
        </View>
      </View>
      <View style={{ paddingHorizontal: 8 }}>
        {rooms.slice(1).map((room, i) => <Room key={i} room={room} photosById={photosById} last={i === rooms.length - 2} />)}
      </View>
    </View>
  );
}

// Fire alarm panel, fire doors and bins: one row each, a missing photo
// called out, with the after photo beside it where there is one.
function SafetyChecks({ rooms, photosById }) {
  return (
    <Section title="Safety checks">
      {rooms.map((room, i) => {
        const { after } = roomPhotos(room);
        const photo = after.find((p) => photosById.has(p.id));
        const text = [room.issues, room.work_done].find(hasContent) || '';
        return (
          <View key={i} style={i === rooms.length - 1 ? styles.checkLast : styles.check} wrap={false}>
            <View style={{ flex: 1, paddingRight: 8 }}>
              <View style={styles.roomHead}>
                <Text style={styles.roomName}>{room.room}</Text>
                <Pill condition={room.condition} label={room.condition === 'not_photographed' ? 'No photo taken this visit' : undefined} />
              </View>
              {text ? <Text style={[styles.line, hasContent(room.issues) ? { color: RED } : null]}>{text}</Text> : null}
            </View>
            {photo && <Image style={styles.checkImage} src={imageOf(photosById, photo.id)} />}
          </View>
        );
      })}
    </Section>
  );
}

function Visit({ visit, photosById, printedPhotoIds, showHeading }) {
  const report = visit.report;
  const labels = (REPORT_TEMPLATES[report?.template] || REPORT_TEMPLATES[DEFAULT_TEMPLATE]).sectionLabels;
  const detailed = REPORT_TEMPLATES[report?.template]?.roomByRoom && report?.rooms?.length > 0;
  const checks = detailed ? report.rooms.filter((r) => isSafetyCheck(r.room)) : [];
  const rooms = detailed ? report.rooms.filter((r) => !isSafetyCheck(r.room)) : report?.rooms || [];
  const landlord = hasContent(report?.issues);

  return (
    <View>
      {showHeading && (
        <View style={styles.visitHead} minPresenceAhead={90}>
          <Text style={styles.visitTitle}>{fmtDate(visit.scheduled_at)}</Text>
          <Text style={styles.visitMeta}>
            {[visit.staff.join(', '), visit.minutes > 0 ? formatDuration(visit.minutes) + ' on site' : null].filter(Boolean).join(' · ')}
          </Text>
        </View>
      )}

      {visit.status === 'missed' && <Text style={[styles.para, styles.muted]}>This visit did not go ahead.</Text>}

      {visit.status !== 'missed' && !report && (
        <View style={{ marginBottom: 10 }}>
          <Text style={[styles.para, styles.muted]}>No written report for this visit.</Text>
          <Photos ids={printedPhotoIds} photosById={photosById} />
        </View>
      )}

      {report && hasContent(report.summary) && (
        <View style={[styles.callout, { borderLeftColor: COMPANY_TEAL.value }]}>
          <Text style={styles.calloutText}>{report.summary}</Text>
        </View>
      )}

      {report && detailed && (
        <>
          {checks.length > 0 && <SafetyChecks rooms={checks} photosById={photosById} />}
          <Section title={labels.issues} tone={landlord ? 'red' : 'green'}>
            <Lines text={landlord ? report.issues : 'Nothing for the landlord to arrange.'} />
          </Section>
          {hasContent(report.suggestions) && (
            <Section title={labels.suggestions}>
              <Lines text={report.suggestions} />
            </Section>
          )}
          {rooms.length > 0 && <RoomByRoom rooms={rooms} photosById={photosById} />}
        </>
      )}

      {report && !detailed && (
        <>
          {rooms.length > 0
            ? <Section title="Rooms">{rooms.map((room, i) => <Room key={i} room={room} photosById={photosById} last={i === rooms.length - 1} />)}</Section>
            : <Photos ids={printedPhotoIds} photosById={photosById} />}
          {landlord && <Section title={labels.issues} tone="red"><Lines text={report.issues} /></Section>}
          {hasContent(report.suggestions) && <Section title={labels.suggestions}><Lines text={report.suggestions} /></Section>}
        </>
      )}
    </View>
  );
}

// The company teal is an editable setting, read at render time.
const COMPANY_TEAL = { value: COMPANY.brandColor };

function Grid({ cells }) {
  // Two label/value pairs per row.
  const rows = [];
  for (let i = 0; i < cells.length; i += 2) rows.push(cells.slice(i, i + 2));
  return (
    <View style={styles.grid}>
      {rows.map((row, r) => (
        <View key={r} style={r === rows.length - 1 ? styles.gridRowLast : styles.gridRow}>
          {row.map((c, i) => (
            <View key={c.label} style={{ flexDirection: 'row', width: '50%' }}>
              <Text style={[styles.gridLabel, { width: '30%' }]}>{c.label}</Text>
              <Text style={[styles.gridValue, { width: '70%', borderRightWidth: i === row.length - 1 ? 0 : 0.75 }]}>{c.value}</Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

// property: { address, clients: { name } }
// visits: as loaded by loadDetailedReport, in date order
// month: '2026-10' for a monthly report, null for a single visit
// photos: [{ id, data, format }] - every photo to print, already fetched
// printed: Map(visitId -> photo ids) for visits with no room report
export default function ReportPdfDocument({ property, visits, month = null, photos = [], printed = new Map(), company = COMPANY, now = new Date() }) {
  COMPANY_TEAL.value = company.brandColor || COMPANY.brandColor;
  const teal = COMPANY_TEAL.value;
  const photosById = new Map(photos.map((p) => [p.id, p]));
  const monthly = !!month;
  const summary = summariseVisits(visits);
  const address = shortAddress(property.address);
  const docType = monthly ? 'Monthly Property Report' : 'Property Visit Report';
  const visit = visits[0];

  // A visit's arrival and departure come from its check-ins; the loader
  // gives minutes on site, so the grid shows the booking time and that.
  const cells = monthly
    ? [
      { label: 'Period', value: monthLabel(month) },
      { label: 'Client', value: property.clients?.name || '—' },
      { label: 'Visits', value: `${summary.visitCount}${summary.missedCount ? ` (${summary.missedCount} missed)` : ''}` },
      { label: 'Time on site', value: formatDuration(summary.minutes) },
      { label: 'Reports', value: `${summary.reportCount} of ${summary.visitCount}` },
      { label: 'Prepared', value: now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' }) },
    ]
    : [
      { label: 'Visit date', value: visit ? fmtDate(visit.scheduled_at) : '—' },
      { label: 'Client', value: property.clients?.name || '—' },
      { label: 'Cleaner', value: visit?.staff.join(', ') || '—' },
      { label: 'Booked for', value: visit ? fmtTime(visit.scheduled_at) : '—' },
      { label: 'Time on site', value: formatDuration(visit?.minutes) },
      { label: 'Prepared', value: now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' }) },
    ];

  return (
    <Document title={`${docType} - ${address}`} author={company.legalName} creator={PLATFORM.name} producer={PLATFORM.name}>
      <Page size="A4" style={styles.page}>
        <Text style={styles.footerText} fixed>{company.name} — {docType} — {address}</Text>
        <Text style={styles.footerLegal} fixed>{legalFooterLine(company)}</Text>

        <View style={styles.masthead}>
          <View>
            <Text style={styles.wordmark}>
              <Text style={{ color: NAVY }}>Crew</Text><Text style={{ color: teal }}>Connect</Text>
            </Text>
            <Text style={styles.wordmarkSub}>CLEANING</Text>
          </View>
          <Text style={styles.docType}>{docType}{'\n'}{property.clients?.name || ''}</Text>
        </View>
        <View style={[styles.mastRule, { borderBottomColor: teal }]} />

        <Text style={styles.title}>{address}</Text>
        <Text style={styles.subtitle}>
          {monthly ? `Monthly report — ${monthLabel(month)}` : `Visit report — ${visit ? fmtDate(visit.scheduled_at) : ''}`}
        </Text>
        <Grid cells={cells} />

        {monthly && (
          <>
            {(summary.roomsNeedingAttention.length > 0 || summary.missingChecks.length > 0) && (
              <Section title="Needs attention this month" tone="red">
                {summary.roomsNeedingAttention.map((r, i) => (
                  <View key={i} style={styles.bulletRow} wrap={false}>
                    <Text style={styles.bulletDot}>•</Text>
                    <Text style={styles.bulletText}>
                      {new Date(r.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' })}, {r.room}{hasContent(r.issues) ? `: ${r.issues}` : ''}
                    </Text>
                  </View>
                ))}
                {summary.missingChecks.map((r, i) => (
                  <View key={`m${i}`} style={styles.bulletRow} wrap={false}>
                    <Text style={styles.bulletDot}>•</Text>
                    <Text style={styles.bulletText}>
                      {new Date(r.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' })}, {r.room}: no photo taken
                    </Text>
                  </View>
                ))}
              </Section>
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
