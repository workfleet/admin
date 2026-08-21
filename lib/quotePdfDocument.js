// The printable quotation: page furniture, type scale and block drawing.
// Kept out of the route handler so the same document can be rendered
// from a preview or a test without going through auth and Supabase.
// Wording and section order come from quoteTemplate.js, shared with the
// Word version.
import {
  Document, Page, View, Text, Svg, Path, Circle, StyleSheet,
} from '@react-pdf/renderer';
import { COMPANY, PLATFORM, legalFooterLines } from './companyBranding';
import { quoteSections, quoteSummaryLines, quoteDocumentMeta, QUOTE_STRAPLINE } from './quoteTemplate';

const INK = '#1e2526';
const MUTED = '#5b6768';
const FAINT = '#8b9697';
const RULE = '#dfe5e5';

const styles = StyleSheet.create({
  // Top padding clears the fixed legal header, bottom padding the footer.
  page: { paddingTop: 84, paddingBottom: 64, paddingHorizontal: 48, fontSize: 10.5, fontFamily: 'Helvetica', color: INK, lineHeight: 1.45 },

  legalHeader: { position: 'absolute', top: 28, left: 48, right: 48 },
  legalLine: { fontSize: 7.5, color: FAINT, lineHeight: 1.35 },
  legalRule: { borderBottomWidth: 1, borderBottomColor: RULE, marginTop: 8 },

  footer: { position: 'absolute', bottom: 26, left: 48, right: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: RULE, paddingTop: 7 },
  footerLeft: { fontSize: 7.5, color: FAINT },
  footerCredit: { flexDirection: 'row', alignItems: 'center' },
  footerCreditText: { fontSize: 7.5, color: FAINT, marginLeft: 4 },
  footerPage: { fontSize: 7.5, color: FAINT },

  eyebrow: { fontSize: 9, letterSpacing: 3, color: COMPANY.brandColor, fontFamily: 'Helvetica-Bold' },
  docTitle: { fontSize: 22, fontFamily: 'Helvetica-Bold', marginTop: 6 },
  docSubtitle: { fontSize: 12, color: MUTED, marginTop: 2 },
  titleRule: { borderBottomWidth: 2, borderBottomColor: COMPANY.brandColor, marginTop: 14, marginBottom: 14, width: 64 },

  summary: { marginBottom: 22 },
  summaryRow: { flexDirection: 'row', marginBottom: 2.5 },
  summaryLabel: { width: 110, fontSize: 9, color: FAINT },
  summaryValue: { flex: 1, fontSize: 9.5 },

  section: { marginBottom: 16 },
  sectionTitle: { fontSize: 12, fontFamily: 'Helvetica-Bold', color: COMPANY.brandColor, marginBottom: 7 },
  para: { marginBottom: 7 },
  subhead: { fontSize: 10, fontFamily: 'Helvetica-Bold', marginTop: 4, marginBottom: 4 },
  bulletRow: { flexDirection: 'row', marginBottom: 2.5, paddingLeft: 4 },
  bulletDot: { width: 10, color: COMPANY.brandColor },
  bulletText: { flex: 1 },

  kvBox: { backgroundColor: '#f6fafa', borderLeftWidth: 2, borderLeftColor: COMPANY.brandColor, paddingVertical: 9, paddingHorizontal: 12, marginBottom: 8 },
  kvRow: { flexDirection: 'row', marginBottom: 2.5 },
  kvLabel: { width: 130, color: MUTED },
  kvValue: { flex: 1 },

  priceBox: { backgroundColor: '#f0fdfd', borderRadius: 6, padding: 16, marginBottom: 12, alignItems: 'center' },
  priceLabel: { fontSize: 9, letterSpacing: 1, color: MUTED, textTransform: 'uppercase' },
  priceValue: { fontSize: 26, fontFamily: 'Helvetica-Bold', color: COMPANY.brandColor, marginTop: 4 },

  table: { marginBottom: 10 },
  tableHead: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: COMPANY.brandColor, paddingBottom: 4, marginBottom: 3 },
  tableHeadCell: { fontSize: 8.5, letterSpacing: 0.6, color: MUTED, textTransform: 'uppercase' },
  tableRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#eef2f2', paddingVertical: 4 },
  tableCell: { fontSize: 9.5 },
  tableCellStrong: { fontSize: 9.5, fontFamily: 'Helvetica-Bold' },

  closing: { marginTop: 20, alignItems: 'center' },
  closingName: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: COMPANY.brandColor },
  closingStrapline: { fontSize: 9, color: MUTED, marginTop: 3, letterSpacing: 0.8 },
});

// The WorkFleet mark, drawn rather than embedded so it stays crisp at
// footer size and doesn't depend on the PWA icon files (which are sized
// for app launchers, not print).
function WorkFleetMark({ size = 9 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <Path d="M14 16 L50 22 L44 52 L16 44 Z" fill="none" stroke={PLATFORM.ink} strokeWidth="4" strokeLinejoin="round" />
      <Circle cx="14" cy="16" r="7" fill={PLATFORM.ink} />
      <Circle cx="50" cy="22" r="7" fill={PLATFORM.ink} />
      <Circle cx="44" cy="52" r="7" fill={PLATFORM.ink} />
      <Circle cx="16" cy="44" r="8.5" fill={PLATFORM.accent} />
    </Svg>
  );
}

function Bullets({ items }) {
  return items.map((item, i) => (
    <View key={i} style={styles.bulletRow} wrap={false}>
      <Text style={styles.bulletDot}>•</Text>
      <Text style={styles.bulletText}>{item}</Text>
    </View>
  ));
}

// Proportions per column count - the money column always sits right and
// stays wide enough for a five-figure total.
const COLUMN_WIDTHS = {
  2: [0.6, 0.4],
  3: [0.38, 0.37, 0.25],
  4: [0.32, 0.22, 0.19, 0.27],
};

function Table({ block }) {
  const widths = COLUMN_WIDTHS[block.columns.length] || COLUMN_WIDTHS[2];
  const lastIndex = block.rows.length - 1;

  return (
    <View style={styles.table}>
      <View style={styles.tableHead}>
        {block.columns.map((col, i) => (
          <Text key={i} style={[styles.tableHeadCell, { flex: widths[i], textAlign: i === block.columns.length - 1 ? 'right' : 'left' }]}>
            {col}
          </Text>
        ))}
      </View>
      {block.rows.map((row, r) => (
        <View key={r} style={styles.tableRow} wrap={false}>
          {row.map((cell, c) => (
            <Text
              key={c}
              style={[
                block.strongLastRow && r === lastIndex ? styles.tableCellStrong : styles.tableCell,
                { flex: widths[c], textAlign: c === row.length - 1 ? 'right' : 'left' },
              ]}
            >
              {cell}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

function Block({ block }) {
  switch (block.type) {
    case 'para':
      return <Text style={styles.para}>{block.text}</Text>;
    case 'subhead':
      return <Text style={styles.subhead} minPresenceAhead={40}>{block.text}</Text>;
    case 'bullets':
      return <Bullets items={block.items} />;
    case 'kv':
      return (
        <View style={styles.kvBox}>
          {block.items.map((item, i) => (
            <View key={i} style={styles.kvRow}>
              <Text style={styles.kvLabel}>{item.label}</Text>
              <Text style={styles.kvValue}>{item.value}</Text>
            </View>
          ))}
        </View>
      );
    case 'price':
      return (
        <View style={styles.priceBox} wrap={false}>
          <Text style={styles.priceLabel}>{block.label}</Text>
          <Text style={styles.priceValue}>{block.value}</Text>
        </View>
      );
    case 'table':
      return <Table block={block} />;
    default:
      return null;
  }
}

export default function QuotePdfDocument({ quote }) {
  const meta = quoteDocumentMeta(quote);
  const summary = quoteSummaryLines(quote);
  const sections = quoteSections(quote);
  const legal = legalFooterLines();

  return (
    <Document
      title={`Quotation ${meta.reference} - ${meta.recipient}`}
      author={COMPANY.legalName}
      creator={PLATFORM.name}
      producer={PLATFORM.name}
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.legalHeader} fixed>
          {legal.map((line, i) => (
            <Text key={i} style={styles.legalLine}>{line}</Text>
          ))}
          <View style={styles.legalRule} />
        </View>

        <View style={styles.footer} fixed>
          <Text style={styles.footerLeft}>{COMPANY.name} · {COMPANY.website} · {COMPANY.phone}</Text>
          <View style={styles.footerCredit}>
            <WorkFleetMark />
            <Text style={styles.footerCreditText}>{PLATFORM.credit}</Text>
          </View>
          <Text style={styles.footerPage} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>

        <Text style={styles.eyebrow}>QUOTATION</Text>
        <Text style={styles.docTitle}>{meta.recipient}</Text>
        <Text style={styles.docSubtitle}>{meta.serviceLabel}</Text>
        <View style={styles.titleRule} />

        <View style={styles.summary}>
          {summary.map((line, i) => (
            <View key={i} style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>{line.label}</Text>
              <Text style={styles.summaryValue}>{line.value}</Text>
            </View>
          ))}
        </View>

        {sections.map((section) => (
          <View key={section.number} style={styles.section}>
            <Text style={styles.sectionTitle} minPresenceAhead={50}>
              {section.number}. {section.title}
            </Text>
            {section.blocks.map((block, i) => (
              <Block key={i} block={block} />
            ))}
          </View>
        ))}

        <View style={styles.closing} wrap={false}>
          <Text style={styles.closingName}>{COMPANY.name}</Text>
          <Text style={styles.closingStrapline}>{QUOTE_STRAPLINE}</Text>
        </View>
      </Page>
    </Document>
  );
}

