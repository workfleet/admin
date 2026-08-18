import { NextResponse } from 'next/server';
import { Document, Page, View, Text, StyleSheet, renderToBuffer } from '@react-pdf/renderer';
import { supabaseAdmin } from '../../../../../lib/supabaseAdmin';
import { COMPANY } from '../../../../../lib/companyBranding';

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
  page: { padding: 40, fontSize: 10, fontFamily: 'Helvetica', color: '#1e2526' },
  companyName: { fontSize: 16, fontWeight: 700, color: COMPANY.brandColor, marginBottom: 2 },
  title: { fontSize: 20, fontWeight: 700, marginTop: 12, marginBottom: 4 },
  subtitle: { fontSize: 10, color: '#555', marginBottom: 20 },
  tableHeader: { flexDirection: 'row', backgroundColor: '#f0fdfd', paddingVertical: 6, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  tableRow: { flexDirection: 'row', paddingVertical: 6, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  headerCell: { fontSize: 9, fontWeight: 700, color: '#555', textTransform: 'uppercase' },
  colProduct: { width: '34%' },
  colStock: { width: '14%' },
  colReorder: { width: '14%' },
  colSupplier: { width: '20%' },
  colLocation: { width: '18%' },
  empty: { fontSize: 11, color: '#555', marginTop: 20 },
});

function ShoppingListPdf({ items }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.companyName}>{COMPANY.name}</Text>
        <Text style={styles.title}>Shopping List</Text>
        <Text style={styles.subtitle}>{new Date().toLocaleDateString('en-GB')}</Text>

        {items.length === 0 ? (
          <Text style={styles.empty}>Nothing needs reordering right now.</Text>
        ) : (
          <View>
            <View style={styles.tableHeader}>
              <Text style={[styles.headerCell, styles.colProduct]}>Product</Text>
              <Text style={[styles.headerCell, styles.colStock]}>Current</Text>
              <Text style={[styles.headerCell, styles.colReorder]}>Reorder At</Text>
              <Text style={[styles.headerCell, styles.colSupplier]}>Supplier</Text>
              <Text style={[styles.headerCell, styles.colLocation]}>Location</Text>
            </View>
            {items.map((p, i) => (
              <View key={i} style={styles.tableRow}>
                <Text style={styles.colProduct}>{p.name}</Text>
                <Text style={styles.colStock}>{p.stock_level}</Text>
                <Text style={styles.colReorder}>{p.reorder_threshold}</Text>
                <Text style={styles.colSupplier}>{p.supplier || '-'}</Text>
                <Text style={styles.colLocation}>{p.location || '-'}</Text>
              </View>
            ))}
          </View>
        )}
      </Page>
    </Document>
  );
}

export async function GET(request) {
  const user = await requireStaff(request);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: products } = await supabaseAdmin
    .from('products')
    .select('name, stock_level, reorder_threshold, location, supplier')
    .order('name');

  const lowStock = (products || []).filter((p) => p.stock_level <= p.reorder_threshold);

  const buffer = await renderToBuffer(<ShoppingListPdf items={lowStock} />);
  const stamp = new Date().toISOString().slice(0, 10);

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="shopping-list-${stamp}.pdf"`,
    },
  });
}
