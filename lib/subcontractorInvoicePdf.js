// A subcontractor's invoice to us (0154), as a PDF: from them, addressed to
// the company, with the shifts from payroll listed underneath. What the
// accountant files. Built only from the saved row - the figures on it are
// the ones the database worked out, never recomputed here.
import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer';
import { COMPANY } from './companyBranding';
import { formatMoney } from './subcontractorInvoices';
import { periodLabel, monthLabelIfWhole } from './payroll';

// Same as formatHours in lib/hoursWorked.js, kept here so this server-side
// file doesn't pull in the browser Supabase client.
function formatHours(hours) {
  const total = Math.round(hours * 60);
  const h = Math.floor(Math.abs(total) / 60) * Math.sign(total || 1);
  const m = Math.abs(total) % 60;
  if (total === 0) return '0h';
  if (h === 0) return `${total < 0 ? '-' : ''}${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

const INK = '#1a1d1e';
const MUTED = '#55605f';
const RULE = '#c9d0cf';

const s = StyleSheet.create({
  page: { paddingTop: 48, paddingBottom: 56, paddingHorizontal: 54, fontSize: 10, fontFamily: 'Helvetica', color: INK, lineHeight: 1.35 },
  title: { fontFamily: 'Helvetica-Bold', fontSize: 22, marginBottom: 2 },
  sub: { color: MUTED, fontSize: 9.5 },
  cols: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 22, marginBottom: 18 },
  col: { width: '48%' },
  label: { fontFamily: 'Helvetica-Bold', fontSize: 8, color: MUTED, letterSpacing: 0.6, marginBottom: 3 },
  meta: { flexDirection: 'row', marginBottom: 2 },
  metaKey: { width: 90, color: MUTED },
  tableHead: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: INK, paddingBottom: 4, fontFamily: 'Helvetica-Bold', fontSize: 9 },
  row: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: RULE, paddingVertical: 5 },
  desc: { flex: 1, paddingRight: 8 },
  amt: { width: 90, textAlign: 'right' },
  totals: { marginTop: 8, marginLeft: 'auto', width: 220 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  grand: { fontFamily: 'Helvetica-Bold', fontSize: 12, borderTopWidth: 1, borderTopColor: INK, paddingTop: 5, marginTop: 3 },
  section: { fontFamily: 'Helvetica-Bold', fontSize: 10, marginTop: 22, marginBottom: 6 },
  shift: { flexDirection: 'row', paddingVertical: 2, fontSize: 8.5 },
  shiftDate: { width: 90, color: MUTED },
  footer: { position: 'absolute', bottom: 24, left: 54, right: 54, fontSize: 7.5, color: MUTED, borderTopWidth: 0.5, borderTopColor: RULE, paddingTop: 6 },
});

const longDate = (value) => (value
  ? new Date(String(value).length <= 10 ? `${value}T12:00:00` : value).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  : '');

export default function SubcontractorInvoicePdf({ invoice, shifts = [], company = COMPANY }) {
  const period = { start: invoice.period_start, end: invoice.period_end };
  const periodText = monthLabelIfWhole(period) || periodLabel(period);
  const vat = Number(invoice.vat_rate) > 0;
  const fromLines = [invoice.business_name || invoice.subcontractor_name, invoice.business_name && invoice.business_name !== invoice.subcontractor_name ? invoice.subcontractor_name : null, invoice.business_address]
    .filter(Boolean);

  return (
    <Document title={`Invoice ${invoice.invoice_number}`} author={invoice.subcontractor_name}>
      <Page size="A4" style={s.page}>
        <Text style={s.title}>Invoice</Text>
        <Text style={s.sub}>{invoice.invoice_number}{invoice.status === 'paid' ? ' · PAID' : ''}</Text>

        <View style={s.cols}>
          <View style={s.col}>
            <Text style={s.label}>FROM</Text>
            {fromLines.map((line, i) => <Text key={i}>{line}</Text>)}
            {vat && invoice.vat_number && <Text>VAT no. {invoice.vat_number}</Text>}
          </View>
          <View style={s.col}>
            <Text style={s.label}>TO</Text>
            <Text>{company.legalName || company.name}</Text>
            {company.registeredOffice && <Text>{company.registeredOffice}</Text>}
          </View>
        </View>

        <View style={{ marginBottom: 16 }}>
          <View style={s.meta}><Text style={s.metaKey}>Invoice date</Text><Text>{longDate(invoice.submitted_at)}</Text></View>
          <View style={s.meta}><Text style={s.metaKey}>Work period</Text><Text>{periodText}</Text></View>
          {invoice.paid_at && <View style={s.meta}><Text style={s.metaKey}>Paid</Text><Text>{longDate(invoice.paid_at)}</Text></View>}
        </View>

        <View style={s.tableHead}><Text style={s.desc}>Description</Text><Text style={s.amt}>Amount</Text></View>
        <View style={s.row}>
          <Text style={s.desc}>Cleaning services, {periodText}: {formatHours(Number(invoice.minutes) / 60)} at {formatMoney(invoice.hourly_rate)} per hour</Text>
          <Text style={s.amt}>{formatMoney(invoice.hours_amount)}</Text>
        </View>
        {(invoice.extras || []).map((e, i) => (
          <View key={i} style={s.row}><Text style={s.desc}>{e.description}</Text><Text style={s.amt}>{formatMoney(e.amount)}</Text></View>
        ))}

        <View style={s.totals}>
          {vat && (
            <>
              <View style={s.totalRow}><Text>Subtotal</Text><Text>{formatMoney(invoice.subtotal)}</Text></View>
              <View style={s.totalRow}><Text>VAT at {Number(invoice.vat_rate)}%</Text><Text>{formatMoney(invoice.vat_amount)}</Text></View>
            </>
          )}
          <View style={[s.totalRow, s.grand]}><Text>Total</Text><Text>{formatMoney(invoice.total)}</Text></View>
          {!vat && <Text style={{ color: MUTED, fontSize: 8, marginTop: 4 }}>Not VAT registered - no VAT charged.</Text>}
        </View>

        {invoice.notes && (
          <>
            <Text style={s.section}>Notes</Text>
            <Text>{invoice.notes}</Text>
          </>
        )}

        {shifts.length > 0 && (
          <>
            <Text style={s.section}>Shifts ({shifts.length})</Text>
            {shifts.map((sh, i) => (
              <View key={i} style={s.shift} wrap={false}>
                <Text style={s.shiftDate}>{sh.date ? new Date(`${sh.date}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : ''}</Text>
                <Text style={s.desc}>{sh.label}</Text>
                <Text style={{ width: 50, textAlign: 'right' }}>{formatHours(sh.minutes / 60)}</Text>
              </View>
            ))}
          </>
        )}

        <Text style={s.footer} fixed>
          Submitted through {company.name}'s staff app. Hours are as recorded on payroll for the period.
        </Text>
      </Page>
    </Document>
  );
}
