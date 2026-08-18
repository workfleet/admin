import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { supabaseAdmin } from '../../../../../lib/supabaseAdmin';

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

export async function GET(request) {
  const user = await requireStaff(request);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: products } = await supabaseAdmin
    .from('products')
    .select('name, stock_level, reorder_threshold, location, supplier, unit_price')
    .order('name');

  const lowStock = (products || []).filter((p) => p.stock_level <= p.reorder_threshold);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Shopping List');

  sheet.columns = [
    { header: 'Product', key: 'name', width: 32 },
    { header: 'Current Stock', key: 'stock_level', width: 14 },
    { header: 'Reorder At', key: 'reorder_threshold', width: 12 },
    { header: 'Supplier', key: 'supplier', width: 20 },
    { header: 'Location', key: 'location', width: 16 },
    { header: 'Unit Price', key: 'unit_price', width: 12 },
  ];

  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0FDFD' } };

  lowStock.forEach((p) => {
    sheet.addRow({
      name: p.name,
      stock_level: p.stock_level,
      reorder_threshold: p.reorder_threshold,
      supplier: p.supplier || '',
      location: p.location || '',
      unit_price: p.unit_price != null ? Number(p.unit_price) : '',
    });
  });

  sheet.getColumn('unit_price').numFmt = '£#,##0.00';

  const buffer = await workbook.xlsx.writeBuffer();
  const stamp = new Date().toISOString().slice(0, 10);

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="shopping-list-${stamp}.xlsx"`,
    },
  });
}
