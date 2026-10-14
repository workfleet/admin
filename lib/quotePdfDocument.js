// The printable quotation: page furniture, type scale and block drawing.
// Kept out of the route handler so the same document can be rendered
// from a preview or a test without going through auth and Supabase.
// Wording and section order come from quoteTemplate.js, shared with the
// Word version.
//
// Branded like the Swansea Bus Station document pack (SOPs, COSHH
// register, crew pack), so a quote reads as part of the same set as
// everything else a client is sent: the CrewConnect wordmark over a teal
// rule, Poppins throughout, a navy title, a details grid with grey label
// cells, navy section bars, tables with a teal header row, and a
// declaration grid to sign. Matches reportPdfDocument.js.
import path from 'path';
import {
  Document, Page, View, Text, Svg, Path, Circle, StyleSheet, Font,
} from '@react-pdf/renderer';
import { COMPANY, PLATFORM, legalFooterLine } from './companyBranding';
import { quoteSections, quoteSummaryLines, quoteDocumentMeta } from './quoteTemplate';

// Poppins, embedded from lib/fonts (OFL - see lib/fonts/OFL.txt). Read from
// disk rather than fetched, so a quote renders with no network.
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
Font.registerHyphenationCallback((word) => [word]);

const NAVY = '#16313f';
const INK = '#1f2a30';
const MUTED = '#5b6870';
const FAINT = '#8a969c';
const LINE = '#d5dcdf';
const GREY_CELL = '#eef4f4';
const PRICE_BG = '#f0f7f7';
// Body text. fontSize travels with lineHeight because react-pdf resolves
// a unitless lineHeight against the style's own fontSize, not the one it
// inherits - without it 1.45 comes out at 1.45 x 18pt.
const TEXT = { fontSize: 9, lineHeight: 1.45 };

const styles = StyleSheet.create({
  page: {
    paddingTop: 36, paddingBottom: 54, paddingHorizontal: 40,
    fontFamily: 'Poppins', fontSize: 9, color: INK,
  },
  // No lineHeight on the Page: inherited from there it stops the
  // render-prop page number drawing at all (react-pdf 4.6), which is why
  // quotes went out with no page numbers. It goes on the text styles
  // instead, via TEXT.
  footerLeft: { position: 'absolute', bottom: 30, left: 40, right: 195, fontSize: 7, color: FAINT },
  footerRight: { position: 'absolute', bottom: 30, right: 40, flexDirection: 'row', alignItems: 'center' },
  footerMark: { marginRight: 3 },
  footerText: { fontSize: 7, color: FAINT },
  footerLegal: { position: 'absolute', bottom: 20, left: 40, right: 40, fontSize: 6, color: FAINT },

  // Wordmark left, document type right, teal rule under both.
  masthead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  wordmark: { fontSize: 17, fontWeight: 700, letterSpacing: -0.3, lineHeight: 1.1 },
  wordmarkSub: { fontSize: 6.5, letterSpacing: 2.4, color: MUTED, marginTop: 1 },
  docType: { fontSize: 8, color: MUTED, textAlign: 'right', lineHeight: 1.35 },
  mastRule: { borderBottomWidth: 2, marginTop: 6, marginBottom: 14 },

  title: { fontSize: 18, fontWeight: 700, color: NAVY },
  subtitle: { fontSize: 10, color: MUTED, marginTop: 1, marginBottom: 8 },

  grid: { borderWidth: 0.75, borderColor: LINE, marginBottom: 12 },
  gridRow: { flexDirection: 'row', borderBottomWidth: 0.75, borderColor: LINE },
  gridRowLast: { flexDirection: 'row' },
  gridLabel: { ...TEXT, width: '38%', backgroundColor: GREY_CELL, fontWeight: 600, paddingVertical: 3.5, paddingHorizontal: 5, borderRightWidth: 0.75, borderColor: LINE },
  gridValue: { ...TEXT, width: '62%', paddingVertical: 3.5, paddingHorizontal: 5, borderColor: LINE },

  // Section: a filled navy bar, the body running on beneath it. The body
  // isn't boxed - a box split across pages leaves its sides running down
  // the margins, and the duties and RAMS sections often split.
  section: { marginBottom: 11 },
  bar: { backgroundColor: NAVY, paddingVertical: 4, paddingHorizontal: 8, marginBottom: 6 },
  barText: { color: '#ffffff', fontWeight: 600, fontSize: 10, lineHeight: 1.3 },
  body: { paddingHorizontal: 8 },

  para: { ...TEXT, marginBottom: 5 },
  subhead: { ...TEXT, fontWeight: 600, color: NAVY, marginTop: 4, marginBottom: 2 },
  bullets: { marginBottom: 4 },
  bulletRow: { flexDirection: 'row', marginBottom: 1.5, paddingLeft: 4 },
  bulletDot: { width: 9 },
  bulletText: { ...TEXT, flex: 1 },

  kv: { borderWidth: 0.75, borderColor: LINE, marginBottom: 8 },
  kvRow: { flexDirection: 'row', borderBottomWidth: 0.75, borderColor: LINE },
  kvRowLast: { flexDirection: 'row' },
  kvLabel: { ...TEXT, width: '32%', backgroundColor: GREY_CELL, fontWeight: 600, paddingVertical: 3, paddingHorizontal: 5, borderRightWidth: 0.75, borderColor: LINE },
  kvValue: { ...TEXT, width: '68%', paddingVertical: 3, paddingHorizontal: 5 },

  // The quoted price: a tinted panel with a teal edge, as the pack's
  // callouts are.
  price: { backgroundColor: PRICE_BG, borderLeftWidth: 3, paddingVertical: 7, paddingHorizontal: 9, marginBottom: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  priceLabel: { fontWeight: 600, fontSize: 10, color: NAVY },
  priceValue: { fontWeight: 700, fontSize: 14, color: NAVY },

  table: { borderWidth: 0.75, borderColor: LINE, marginBottom: 8 },
  tableHead: { flexDirection: 'row' },
  tableHeadCell: { ...TEXT, color: '#ffffff', fontWeight: 600, paddingVertical: 4, paddingHorizontal: 5 },
  tableRow: { flexDirection: 'row', borderTopWidth: 0.75, borderColor: LINE },
  tableCell: { ...TEXT, paddingVertical: 3.5, paddingHorizontal: 5 },
  tableTotal: { backgroundColor: GREY_CELL, fontWeight: 700 },

  // Declaration grid, as on the COSHH register.
  sign: { borderWidth: 0.75, borderColor: LINE, marginTop: 4 },
  signRow: { flexDirection: 'row', borderBottomWidth: 0.75, borderColor: LINE },
  signRowLast: { flexDirection: 'row' },
  signLabel: { ...TEXT, backgroundColor: GREY_CELL, fontWeight: 600, paddingVertical: 9, paddingHorizontal: 5, borderRightWidth: 0.75, borderColor: LINE },
  signBlank: { borderRightWidth: 0.75, borderColor: LINE },
});

// The Route W mark for the platform credit, drawn rather than embedded so
// it stays crisp at footer size. The compact form, without the graphite
// nodes, which merge into the stroke this small. Mirrors
// app/components/Logo.js.
function WorkFleetMark({ size = 7 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <Path
        d="M8 16 L20 48 L32 20 L44 48 L56 16"
        fill="none"
        stroke={PLATFORM.ink}
        strokeWidth="6.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx="56" cy="16" r="9" fill={PLATFORM.accent} />
    </Svg>
  );
}

function Bullets({ items }) {
  return (
    <View style={styles.bullets}>
      {items.map((item, i) => (
        <View key={i} style={styles.bulletRow} wrap={false}>
          <Text style={styles.bulletDot}>•</Text>
          <Text style={styles.bulletText}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

// Proportions per column count - the money column always sits right and
// stays wide enough for a five-figure total.
const COLUMN_WIDTHS = {
  2: [0.62, 0.38],
  3: [0.4, 0.36, 0.24],
  4: [0.33, 0.22, 0.19, 0.26],
};

function Table({ block, teal }) {
  const widths = COLUMN_WIDTHS[block.columns.length] || COLUMN_WIDTHS[2];
  const lastIndex = block.rows.length - 1;
  const align = (i, n) => (i === n - 1 ? 'right' : 'left');

  return (
    <View style={styles.table} wrap={false}>
      <View style={[styles.tableHead, { backgroundColor: teal }]}>
        {block.columns.map((col, i) => (
          <Text key={i} style={[styles.tableHeadCell, { flex: widths[i], textAlign: align(i, block.columns.length) }]}>
            {col}
          </Text>
        ))}
      </View>
      {block.rows.map((row, r) => {
        const isTotal = block.strongLastRow && r === lastIndex;
        return (
          <View key={r} style={[styles.tableRow, isTotal ? styles.tableTotal : null]} wrap={false}>
            {row.map((cell, c) => (
              <Text key={c} style={[styles.tableCell, { flex: widths[c], textAlign: align(c, row.length) }]}>
                {cell}
              </Text>
            ))}
          </View>
        );
      })}
    </View>
  );
}

function Kv({ items }) {
  return (
    <View style={styles.kv} wrap={false}>
      {items.map((item, i) => (
        <View key={i} style={i === items.length - 1 ? styles.kvRowLast : styles.kvRow}>
          <Text style={styles.kvLabel}>{item.label}</Text>
          <Text style={styles.kvValue}>{item.value}</Text>
        </View>
      ))}
    </View>
  );
}

function SignatureBlock({ company }) {
  const rows = [`For ${company.name}`, 'Accepted by the client'];
  return (
    <View style={styles.sign} wrap={false}>
      {rows.map((who, i) => (
        <View key={who} style={i === rows.length - 1 ? styles.signRowLast : styles.signRow}>
          <Text style={[styles.signLabel, { width: '24%' }]}>{who}</Text>
          <Text style={[styles.signLabel, { width: '13%' }]}>Signature</Text>
          <View style={[styles.signBlank, { width: '30%' }]} />
          <Text style={[styles.signLabel, { width: '9%' }]}>Date</Text>
          <View style={{ width: '24%' }} />
        </View>
      ))}
    </View>
  );
}

function Block({ block, company, teal }) {
  switch (block.type) {
    case 'para':
      return <Text style={styles.para}>{block.text}</Text>;
    case 'subhead':
      return <Text style={styles.subhead} minPresenceAhead={40}>{block.text}</Text>;
    case 'bullets':
      return <Bullets items={block.items} />;
    case 'kv':
      return <Kv items={block.items} />;
    case 'price':
      return (
        <View style={[styles.price, { borderLeftColor: teal }]} wrap={false}>
          <Text style={styles.priceLabel}>{block.label}</Text>
          <Text style={styles.priceValue}>{block.value}</Text>
        </View>
      );
    case 'table':
      return <Table block={block} teal={teal} />;
    case 'signature':
      return <SignatureBlock company={company} />;
    default:
      return null;
  }
}

function Grid({ cells }) {
  // Two label/value pairs per row.
  const rows = [];
  for (let i = 0; i < cells.length; i += 2) rows.push(cells.slice(i, i + 2));
  return (
    <View style={styles.grid}>
      {rows.map((row, r) => (
        <View key={r} style={r === rows.length - 1 ? styles.gridRowLast : styles.gridRow}>
          {row.map((c, i) => (
            <View key={c.label} style={{ flexDirection: 'row', width: '50%', borderRightWidth: i === 0 ? 0.75 : 0, borderColor: LINE }}>
              <Text style={styles.gridLabel}>{c.label}</Text>
              <Text style={styles.gridValue}>{c.value}</Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

export default function QuotePdfDocument({ quote, company = COMPANY, template = null }) {
  const meta = quoteDocumentMeta(quote);
  const sections = quoteSections(quote, company, template);
  const legal = legalFooterLine(company);
  const teal = company.brandColor || COMPANY.brandColor;

  // Who it's from is the masthead; who it's for and where are the
  // title and subtitle. Everything else goes in the grid.
  const cells = quoteSummaryLines(quote, company).filter(
    (line) => !['Prepared by', 'Site'].includes(line.label)
  );

  return (
    <Document
      title={`Quotation ${meta.reference} - ${meta.recipient}`}
      author={company.legalName}
      creator={PLATFORM.name}
      producer={PLATFORM.name}
    >
      <Page size="A4" style={styles.page}>
        <Text style={styles.footerLeft} fixed>{company.name} — Quotation — {meta.reference} — {company.phone} · {company.email}</Text>
        <View style={styles.footerRight} fixed>
          <View style={styles.footerMark}><WorkFleetMark /></View>
          <Text style={styles.footerText} render={({ pageNumber, totalPages }) => `${PLATFORM.credit} · Page ${pageNumber} of ${totalPages}`} />
        </View>
        <Text style={styles.footerLegal} fixed>{legal}</Text>

        <View style={styles.masthead}>
          <View>
            <Text style={styles.wordmark}>
              <Text style={{ color: NAVY }}>Crew</Text><Text style={{ color: teal }}>Connect</Text>
            </Text>
            <Text style={styles.wordmarkSub}>CLEANING</Text>
          </View>
          <Text style={styles.docType}>Quotation{'\n'}{meta.recipient}</Text>
        </View>
        <View style={[styles.mastRule, { borderBottomColor: teal }]} />

        <Text style={styles.title}>Quotation — {meta.serviceLabel}</Text>
        <Text style={styles.subtitle}>{meta.siteAddress || meta.recipient}</Text>
        <Grid cells={cells} />

        {sections.map((section) => (
          <View key={section.number} style={styles.section}>
            <View style={styles.bar} minPresenceAhead={46}>
              <Text style={styles.barText}>{section.number}. {section.title}</Text>
            </View>
            <View style={styles.body}>
              {section.blocks.map((block, i) => (
                <Block key={i} block={block} company={company} teal={teal} />
              ))}
            </View>
          </View>
        ))}
      </Page>
    </Document>
  );
}
