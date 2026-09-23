// The signed worker contract, as a PDF filed into the new starter's
// documents. Rendered from the exact text stored on the submission rather
// than rebuilt from the terms, so the file and the record can never drift
// apart - if this ever has to be produced as evidence of what somebody
// agreed to, the two must say the same thing.
//
// Typeset like the quotation (lib/quotePdfDocument.js): serif body, hairline
// rules, no screen furniture. The only thing added to the text is the
// signature panel at the end, which is the part the text itself cannot
// carry - who typed their name, when, and from where.
import {
  Document, Page, View, Text, StyleSheet,
} from '@react-pdf/renderer';
import { COMPANY, PLATFORM, legalFooterLine } from './companyBranding';

const INK = '#1a1d1e';
const MUTED = '#55605f';
const FAINT = '#8b9697';
const RULE = '#c9d0cf';

const BODY = 'Times-Roman';
const BODY_BOLD = 'Times-Bold';
const HEAD = 'Helvetica-Bold';

const styles = StyleSheet.create({
  page: {
    paddingTop: 48, paddingBottom: 62, paddingHorizontal: 54,
    fontSize: 10.5, fontFamily: BODY, color: INK, lineHeight: 1.35,
  },

  footer: { position: 'absolute', bottom: 24, left: 54, right: 54, borderTopWidth: 0.5, borderTopColor: RULE, paddingTop: 6 },
  footerRow: { flexDirection: 'row', justifyContent: 'space-between' },
  footerText: { fontSize: 7.5, color: FAINT, fontFamily: 'Helvetica' },
  footerLegal: { fontSize: 6.5, color: FAINT, marginTop: 2, fontFamily: 'Helvetica' },

  titleBlock: { marginBottom: 18 },
  titleLine: { fontFamily: HEAD, fontSize: 16, letterSpacing: -0.2 },
  titleRule: { borderBottomWidth: 1, marginTop: 8 },

  heading: { fontFamily: BODY_BOLD, fontSize: 11.5, marginTop: 12, marginBottom: 3 },
  clause: { marginBottom: 3, textAlign: 'justify' },
  para: { marginBottom: 6 },
  gap: { height: 5 },

  signature: { marginTop: 22, borderTopWidth: 0.5, borderTopColor: RULE, paddingTop: 12 },
  signatureHeading: { fontFamily: HEAD, fontSize: 8, letterSpacing: 0.6, color: MUTED, marginBottom: 8 },
  signatureName: { fontFamily: BODY_BOLD, fontSize: 14 },
  signatureCaption: { fontSize: 8.5, color: MUTED, marginTop: 2 },
  metaRow: { flexDirection: 'row', marginTop: 8 },
  metaLabel: { width: 96, fontSize: 9, color: FAINT, fontFamily: 'Helvetica' },
  metaValue: { fontSize: 9.5, flex: 1 },
});

// Lines up to the first blank one are the document's own title block; after
// that, "1. Heading" is a section and "1.1 ..." is a clause under it.
function parseContract(contractText) {
  const lines = String(contractText || '').replace(/\r\n/g, '\n').split('\n');
  const title = [];
  let i = 0;
  while (i < lines.length && lines[i].trim() !== '') {
    title.push(lines[i].trim());
    i += 1;
  }

  const body = [];
  for (; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (line === '') {
      body.push({ type: 'gap' });
    } else if (/^\d+\.\s/.test(line)) {
      body.push({ type: 'heading', text: line });
    } else if (/^\d+\.\d+\s/.test(line)) {
      body.push({ type: 'clause', text: line });
    } else {
      body.push({ type: 'para', text: line });
    }
  }

  // Runs of blank lines collapse, and a gap immediately before a heading is
  // redundant next to the heading's own margin.
  return {
    title,
    body: body.filter((block, index) => {
      if (block.type !== 'gap') return true;
      const next = body[index + 1];
      return next && next.type !== 'gap' && next.type !== 'heading';
    }),
  };
}

function formatSignedAt(signedAt) {
  if (!signedAt) return null;
  const date = new Date(signedAt);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('en-GB', {
    timeZone: 'Europe/London',
    day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function ContractPdfDocument({ submission, company = COMPANY }) {
  const { title, body } = parseContract(submission.contract_text);
  const legal = legalFooterLine(company);
  const signedAt = formatSignedAt(submission.signed_at);

  return (
    <Document
      title={`Worker contract - ${submission.full_name}`}
      author={company.legalName}
      creator={PLATFORM.name}
      producer={PLATFORM.name}
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.footer} fixed>
          <View style={styles.footerRow}>
            <Text style={styles.footerText}>{company.name} · Worker contract · {submission.full_name}</Text>
            <Text
              style={styles.footerText}
              render={({ pageNumber, totalPages }) => `${pageNumber} of ${totalPages}`}
            />
          </View>
          {legal && <Text style={styles.footerLegal}>{legal}</Text>}
        </View>

        <View style={styles.titleBlock}>
          {title.map((line, i) => (
            <Text key={i} style={styles.titleLine}>{line}</Text>
          ))}
          <View style={[styles.titleRule, { borderBottomColor: company.brandColor || RULE }]} />
        </View>

        {body.map((block, i) => {
          if (block.type === 'gap') return <View key={i} style={styles.gap} />;
          if (block.type === 'heading') {
            return <Text key={i} style={styles.heading} minPresenceAhead={40}>{block.text}</Text>;
          }
          return (
            <Text key={i} style={block.type === 'clause' ? styles.clause : styles.para}>
              {block.text}
            </Text>
          );
        })}

        <View style={styles.signature} wrap={false}>
          <Text style={styles.signatureHeading}>SIGNED BY THE WORKER</Text>
          <Text style={styles.signatureName}>{submission.signed_name}</Text>
          <Text style={styles.signatureCaption}>
            Typed as an electronic signature when completing onboarding.
          </Text>
          {signedAt && (
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Signed</Text>
              <Text style={styles.metaValue}>{signedAt}</Text>
            </View>
          )}
          {submission.signed_ip && (
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>From IP</Text>
              <Text style={styles.metaValue}>{submission.signed_ip}</Text>
            </View>
          )}
          {submission.policies_agreed && (
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Policies</Text>
              <Text style={styles.metaValue}>Read and agreed at the same time.</Text>
            </View>
          )}
        </View>
      </Page>
    </Document>
  );
}
