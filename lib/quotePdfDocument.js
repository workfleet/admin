// The printable quotation: page furniture, type scale and block drawing.
// Kept out of the route handler so the same document can be rendered
// from a preview or a test without going through auth and Supabase.
// Wording and section order come from quoteTemplate.js, shared with the
// Word version.
//
// Deliberately typeset as a business letter, not as a web page. The
// earlier version read as "a printed webpage" because it was built from
// screen furniture: a letterspaced kicker instead of a letterhead, a
// tinted rounded card for the price, a callout panel with an accent bar,
// uppercase micro-labels over the tables, coloured headings, and no
// rules anywhere. What signals "document" instead is a letterhead, an
// addressee block, hairline rules, a serif text face, money set right on
// a ruled table, and somewhere to sign. Colour appears exactly once, in
// the rule under the letterhead.
import {
  Document, Page, View, Text, Svg, Path, Circle, StyleSheet,
} from '@react-pdf/renderer';
import { COMPANY, PLATFORM, legalFooterLine } from './companyBranding';
import { quoteSections, quoteSummaryLines, quoteDocumentMeta } from './quoteTemplate';

const INK = '#1a1d1e';
const MUTED = '#55605f';
const FAINT = '#8b9697';
const RULE = '#c9d0cf';
const HAIRLINE = '#e3e8e7';

const BODY = 'Times-Roman';
const BODY_BOLD = 'Times-Bold';
const HEAD = 'Helvetica-Bold';

const styles = StyleSheet.create({
  page: {
    paddingTop: 46, paddingBottom: 62, paddingHorizontal: 54,
    fontSize: 10.5, fontFamily: BODY, color: INK, lineHeight: 1.35,
  },

  footer: { position: 'absolute', bottom: 24, left: 54, right: 54, borderTopWidth: 0.5, borderTopColor: RULE, paddingTop: 6 },
  footerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  footerLeft: { fontSize: 7.5, color: FAINT, fontFamily: 'Helvetica' },
  footerCredit: { flexDirection: 'row', alignItems: 'center' },
  footerCreditText: { fontSize: 6.5, color: FAINT, marginLeft: 3, fontFamily: 'Helvetica' },
  footerPage: { fontSize: 6.5, color: FAINT, fontFamily: 'Helvetica' },
  footerLegal: { fontSize: 6.5, color: FAINT, marginTop: 2, fontFamily: 'Helvetica' },

  // Letterhead: who is writing, and how to reach them.
  letterhead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  letterheadName: { fontFamily: HEAD, fontSize: 15, letterSpacing: -0.2 },
  letterheadLegal: { fontSize: 7.5, color: FAINT, fontFamily: 'Helvetica', marginTop: 2 },
  letterheadContact: { fontSize: 8.5, color: MUTED, textAlign: 'right', lineHeight: 1.4 },
  letterheadRule: { borderBottomWidth: 1, borderBottomColor: COMPANY.brandColor, marginTop: 7, marginBottom: 16 },

  // Addressee left, reference block right - the arrangement of a letter.
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

  section: { marginBottom: 12 },
  sectionTitle: { fontFamily: HEAD, fontSize: 10, marginBottom: 5 },
  para: { marginBottom: 6 },
  subhead: { fontFamily: BODY_BOLD, fontSize: 10.5, marginTop: 5, marginBottom: 3 },
  bulletRow: { flexDirection: 'row', marginBottom: 1.5, paddingLeft: 8 },
  bulletDot: { width: 10 },
  bulletText: { flex: 1 },

  // Plain indented pairs. No panel, no accent bar.
  kvRow: { flexDirection: 'row', marginBottom: 1.5, paddingLeft: 8 },
  kvLabel: { width: 132, color: MUTED },
  kvValue: { flex: 1 },
  kvSpacer: { height: 6 },

  // The total, ruled above and below the way an invoice line is.
  totalBlock: { borderTopWidth: 1, borderTopColor: INK, borderBottomWidth: 1, borderBottomColor: INK, paddingVertical: 6, marginTop: 4, marginBottom: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  totalLabel: { fontFamily: BODY_BOLD, fontSize: 11 },
  totalValue: { fontFamily: BODY_BOLD, fontSize: 14 },

  table: { marginBottom: 10 },
  tableHead: { flexDirection: 'row', borderBottomWidth: 0.75, borderBottomColor: INK, paddingBottom: 3 },
  tableHeadCell: { fontFamily: HEAD, fontSize: 8.5 },
  tableRow: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: HAIRLINE, paddingVertical: 3.5 },
  tableRowTotal: { flexDirection: 'row', borderTopWidth: 0.75, borderTopColor: INK, borderBottomWidth: 0, paddingVertical: 4 },
  tableCell: { fontSize: 10 },
  tableCellStrong: { fontSize: 10, fontFamily: BODY_BOLD },

  // Somewhere to sign. More than anything else this is what stops a
  // quote reading as a printout.
  signatureRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 },
  signatureCol: { width: '46%' },
  signatureHeading: { fontFamily: HEAD, fontSize: 8.5, marginBottom: 12 },
  signatureLine: { borderBottomWidth: 0.5, borderBottomColor: RULE, marginBottom: 3, height: 16 },
  signatureCaption: { fontSize: 8, color: FAINT, fontFamily: 'Helvetica', marginBottom: 10 },
});

// The Route W mark, drawn rather than embedded so it stays crisp at
// footer size and doesn't depend on the PWA icon files (which are sized
// for app launchers, not print).
//
// This is the compact form the app itself uses below 20px: no graphite
// nodes, heavier stroke. At footer size the nodes merge into the stroke
// and turn the mark into a blob. Mirrors app/components/Logo.js.
function WorkFleetMark({ size = 9 }) {
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
  return items.map((item, i) => (
    <View key={i} style={styles.bulletRow} wrap={false}>
      <Text style={styles.bulletDot}>—</Text>
      <Text style={styles.bulletText}>{item}</Text>
    </View>
  ));
}

// Proportions per column count - the money column always sits right and
// stays wide enough for a five-figure total.
const COLUMN_WIDTHS = {
  2: [0.62, 0.38],
  3: [0.4, 0.36, 0.24],
  4: [0.33, 0.22, 0.19, 0.26],
};

function Table({ block }) {
  const widths = COLUMN_WIDTHS[block.columns.length] || COLUMN_WIDTHS[2];
  const lastIndex = block.rows.length - 1;

  return (
    <View style={styles.table} wrap={false}>
      <View style={styles.tableHead}>
        {block.columns.map((col, i) => (
          <Text key={i} style={[styles.tableHeadCell, { flex: widths[i], textAlign: i === block.columns.length - 1 ? 'right' : 'left' }]}>
            {col}
          </Text>
        ))}
      </View>
      {block.rows.map((row, r) => {
        const isTotal = block.strongLastRow && r === lastIndex;
        return (
          <View key={r} style={isTotal ? styles.tableRowTotal : styles.tableRow} wrap={false}>
            {row.map((cell, c) => (
              <Text
                key={c}
                style={[
                  isTotal ? styles.tableCellStrong : styles.tableCell,
                  { flex: widths[c], textAlign: c === row.length - 1 ? 'right' : 'left' },
                ]}
              >
                {cell}
              </Text>
            ))}
          </View>
        );
      })}
    </View>
  );
}

function SignatureBlock() {
  return (
    <View style={styles.signatureRow} wrap={false}>
      <View style={styles.signatureCol}>
        <Text style={styles.signatureHeading}>FOR AND ON BEHALF OF {COMPANY.name.toUpperCase()}</Text>
        <View style={styles.signatureLine} />
        <Text style={styles.signatureCaption}>Signature</Text>
        <View style={styles.signatureLine} />
        <Text style={styles.signatureCaption}>Name and date</Text>
      </View>
      <View style={styles.signatureCol}>
        <Text style={styles.signatureHeading}>ACCEPTED BY THE CLIENT</Text>
        <View style={styles.signatureLine} />
        <Text style={styles.signatureCaption}>Signature</Text>
        <View style={styles.signatureLine} />
        <Text style={styles.signatureCaption}>Name and date</Text>
      </View>
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
        <View>
          {block.items.map((item, i) => (
            <View key={i} style={styles.kvRow}>
              <Text style={styles.kvLabel}>{item.label}</Text>
              <Text style={styles.kvValue}>{item.value}</Text>
            </View>
          ))}
          <View style={styles.kvSpacer} />
        </View>
      );
    case 'price':
      return (
        <View style={styles.totalBlock} wrap={false}>
          <Text style={styles.totalLabel}>{block.label}</Text>
          <Text style={styles.totalValue}>{block.value}</Text>
        </View>
      );
    case 'table':
      return <Table block={block} />;
    case 'signature':
      return <SignatureBlock />;
    default:
      return null;
  }
}

export default function QuotePdfDocument({ quote }) {
  const meta = quoteDocumentMeta(quote);
  const sections = quoteSections(quote);
  const legal = legalFooterLine();

  // The letter's reference block takes the short facts; anything longer
  // (frequency, contracted hours) stays in the body where it has room.
  const reference = quoteSummaryLines(quote).filter(
    (line) => !['Prepared by', 'Prepared for', 'Site'].includes(line.label)
  );

  return (
    <Document
      title={`Quotation ${meta.reference} - ${meta.recipient}`}
      author={COMPANY.legalName}
      creator={PLATFORM.name}
      producer={PLATFORM.name}
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.footer} fixed>
          <View style={styles.footerRow}>
            <Text style={styles.footerLeft}>{COMPANY.name} · {COMPANY.website} · {COMPANY.phone}</Text>
            <View style={styles.footerCredit}>
              <WorkFleetMark size={7.5} />
              <Text style={styles.footerCreditText}>{PLATFORM.credit} · </Text>
              <Text style={styles.footerPage} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
            </View>
          </View>
          <Text style={styles.footerLegal}>{legal}</Text>
        </View>

        <View style={styles.letterhead}>
          <View>
            <Text style={styles.letterheadName}>{COMPANY.name}</Text>
            <Text style={styles.letterheadLegal}>{COMPANY.legalName}</Text>
          </View>
          <Text style={styles.letterheadContact}>
            {COMPANY.address}{'\n'}{COMPANY.phone} · {COMPANY.email}
          </Text>
        </View>
        <View style={styles.letterheadRule} />

        <View style={styles.addressRow}>
          <View style={styles.addressee}>
            <Text style={styles.addresseeLabel}>QUOTATION FOR</Text>
            <Text style={styles.addresseeName}>{meta.recipient}</Text>
            {meta.siteAddress && <Text style={styles.addresseeLine}>{meta.siteAddress}</Text>}
          </View>
          <View style={styles.refBlock}>
            {reference.map((line, i) => (
              <View key={i} style={styles.refRow}>
                <Text style={styles.refLabel}>{line.label}</Text>
                <Text style={styles.refValue}>{line.value}</Text>
              </View>
            ))}
          </View>
        </View>

        <Text style={styles.subject}>Quotation for {meta.serviceLabel}</Text>
        <View style={styles.subjectRule} />

        {sections.map((section) => (
          <View key={section.number} style={styles.section}>
            <Text style={styles.sectionTitle} minPresenceAhead={46}>
              {section.number}. {section.title}
            </Text>
            {section.blocks.map((block, i) => (
              <Block key={i} block={block} />
            ))}
          </View>
        ))}
      </Page>
    </Document>
  );
}
