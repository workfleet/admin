import { NextResponse } from 'next/server';
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, HeadingLevel, ShadingType } from 'docx';
import { supabaseAdmin } from '../../../../../lib/supabaseAdmin';
import { needsReorder } from '../../../../../lib/inventory';
import { COMPANY } from '../../../../../lib/companyBranding';

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

function headerCell(text, width) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: { type: ShadingType.CLEAR, fill: 'F0FDFD' },
    children: [new Paragraph({ children: [new TextRun({ text, bold: true, size: 18 })] })],
  });
}

function cell(text, width) {
  return new TableCell({ width: { size: width, type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun({ text: String(text), size: 18 })] })] });
}

export async function GET(request) {
  const user = await requireStaff(request);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: products } = await supabaseAdmin
    .from('products')
    .select('name, stock_level, reorder_threshold, location, supplier')
    .order('name');

  const lowStock = (products || []).filter(needsReorder);
  const widths = [3600, 1600, 1600, 2200, 1600];

  const rows = [
    new TableRow({
      children: [
        headerCell('Product', widths[0]), headerCell('Current', widths[1]), headerCell('Reorder At', widths[2]), headerCell('Supplier', widths[3]), headerCell('Location', widths[4]),
      ],
    }),
    ...lowStock.map((p) => new TableRow({
      children: [
        cell(p.name, widths[0]),
        cell(p.stock_level, widths[1]),
        cell(p.reorder_threshold, widths[2]),
        cell(p.supplier || '-', widths[3]),
        cell(p.location || '-', widths[4]),
      ],
    })),
  ];

  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ children: [new TextRun({ text: COMPANY.name, bold: true, size: 28, color: COMPANY.brandColor.replace('#', '') })], spacing: { after: 40 } }),
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: 'Shopping List' })], spacing: { after: 40 } }),
        new Paragraph({ children: [new TextRun({ text: new Date().toLocaleDateString('en-GB'), size: 18, color: '555555' })], spacing: { after: 240 } }),
        lowStock.length === 0
          ? new Paragraph({ children: [new TextRun({ text: 'Nothing needs reordering right now.' })] })
          : new Table({ width: { size: 10600, type: WidthType.DXA }, rows }),
      ],
    }],
  });

  const buffer = await Packer.toBuffer(doc);
  const stamp = new Date().toISOString().slice(0, 10);

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="shopping-list-${stamp}.docx"`,
    },
  });
}
