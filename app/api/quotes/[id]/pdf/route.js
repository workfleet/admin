import fs from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';
import { Document, Page, View, Text, Image, StyleSheet, Font, renderToBuffer } from '@react-pdf/renderer';
import { supabaseAdmin } from '../../../../../lib/supabaseAdmin';
import { COMPANY, QUOTE_NOTES, formatPriceGBP, quoteReference, quoteRecipientName, clientSafeBreakdown } from '../../../../../lib/companyBranding';

// @react-pdf/renderer needs real Node APIs (fs, fontkit) - not the edge runtime.
export const runtime = 'nodejs';

async function requireStaff(request) {
  const authHeader = request.headers.get('authorization') || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) return null;

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return null;

  const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', user.id).single();
  if (profile?.role !== 'admin' && profile?.role !== 'supervisor') return null;
  return user;
}

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 11, fontFamily: 'Helvetica', color: '#1e2526' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  logo: { width: 56, height: 56 },
  companyName: { fontSize: 16, fontWeight: 700, color: COMPANY.brandColor },
  companyDetail: { fontSize: 9, color: '#555', marginTop: 2 },
  title: { fontSize: 20, fontWeight: 700, marginBottom: 4 },
  subtitle: { fontSize: 10, color: '#555', marginBottom: 20 },
  section: { marginBottom: 16 },
  sectionLabel: { fontSize: 9, textTransform: 'uppercase', color: '#888', marginBottom: 4, letterSpacing: 0.5 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  priceBox: { backgroundColor: '#f0fdfd', borderRadius: 8, padding: 16, marginVertical: 16, alignItems: 'center' },
  priceLabel: { fontSize: 10, color: '#555' },
  priceValue: { fontSize: 28, fontWeight: 700, color: COMPANY.brandColor, marginTop: 4 },
  notesList: { marginTop: 8 },
  noteItem: { fontSize: 9.5, color: '#444', marginBottom: 3 },
  footer: { position: 'absolute', bottom: 30, left: 40, right: 40, fontSize: 8.5, color: '#888', textAlign: 'center', borderTopWidth: 1, borderTopColor: '#e5e5e5', paddingTop: 8 },
  breakdownBox: { backgroundColor: '#f8fafc', borderRadius: 8, padding: 12 },
  breakdownRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3, fontSize: 9.5 },
  breakdownLabel: { color: '#555' },
  breakdownValue: { color: '#1e2526' },
  breakdownDivider: { borderTopWidth: 1, borderTopColor: '#e2e8f0', marginVertical: 6 },
});

function BreakdownRow({ label, value }) {
  return (
    <View style={styles.breakdownRow}>
      <Text style={styles.breakdownLabel}>{label}</Text>
      <Text style={styles.breakdownValue}>{value}</Text>
    </View>
  );
}

function QuotePdf({ quote, logoBase64 }) {
  const recipient = quoteRecipientName(quote);
  const reference = quoteReference(quote);
  const breakdown = clientSafeBreakdown(quote);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.companyName}>{COMPANY.name}</Text>
            <Text style={styles.companyDetail}>{COMPANY.address}</Text>
            <Text style={styles.companyDetail}>{COMPANY.phone} · {COMPANY.email}</Text>
          </View>
          {logoBase64 && <Image src={logoBase64} style={styles.logo} />}
        </View>

        <Text style={styles.title}>Quote for {recipient}</Text>
        <Text style={styles.subtitle}>
          Reference {reference} · {new Date(quote.created_at).toLocaleDateString('en-GB')}
          {quote.valid_until ? ` · Valid until ${new Date(quote.valid_until).toLocaleDateString('en-GB')}` : ''}
        </Text>

        {(quote.prospect_email || quote.prospect_phone) && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Contact</Text>
            <Text>{[quote.prospect_email, quote.prospect_phone].filter(Boolean).join(' · ')}</Text>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Proposed Works</Text>
          <Text>{quote.description}</Text>
        </View>

        <View style={styles.priceBox}>
          <Text style={styles.priceLabel}>Quoted price</Text>
          <Text style={styles.priceValue}>{formatPriceGBP(quote.price)}</Text>
        </View>

        {breakdown && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>What's Included</Text>
            <View style={styles.breakdownBox}>
              {breakdown.map((item, i) => (
                <BreakdownRow key={i} label={item.label} value={item.value} />
              ))}
            </View>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Notes</Text>
          <View style={styles.notesList}>
            {QUOTE_NOTES.map((note, i) => (
              <Text key={i} style={styles.noteItem}>• {note}</Text>
            ))}
          </View>
        </View>

        <Text style={styles.footer}>
          {COMPANY.name} · {COMPANY.website} · {COMPANY.phone} · {COMPANY.email}
        </Text>
      </Page>
    </Document>
  );
}

export async function GET(request, { params }) {
  const user = await requireStaff(request);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: quote } = await supabaseAdmin
    .from('quotes')
    .select('id, client_id, prospect_name, prospect_email, prospect_phone, description, price, valid_until, created_at, calculator_input, calculator_breakdown, clients(name)')
    .eq('id', params.id)
    .single();

  if (!quote) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const logoPath = path.join(process.cwd(), 'public', 'icon-512.png');
  const logoBase64 = fs.existsSync(logoPath)
    ? `data:image/png;base64,${fs.readFileSync(logoPath).toString('base64')}`
    : null;

  const buffer = await renderToBuffer(<QuotePdf quote={quote} logoBase64={logoBase64} />);

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${quoteReference(quote)}.pdf"`,
    },
  });
}
