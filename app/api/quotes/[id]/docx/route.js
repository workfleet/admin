import fs from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';
import { Document, Packer, Paragraph, TextRun, ImageRun, AlignmentType, HeadingLevel, BorderStyle } from 'docx';
import { supabaseAdmin } from '../../../../../lib/supabaseAdmin';
import { COMPANY, QUOTE_NOTES, formatPriceGBP, quoteReference, quoteRecipientName, clientSafeBreakdown } from '../../../../../lib/companyBranding';

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

const BRAND_COLOR = COMPANY.brandColor.replace('#', '');

export async function GET(request, { params }) {
  const user = await requireStaff(request);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: quote } = await supabaseAdmin
    .from('quotes')
    .select('id, client_id, prospect_name, prospect_email, prospect_phone, description, price, valid_until, created_at, calculator_input, calculator_breakdown, clients(name)')
    .eq('id', params.id)
    .single();

  if (!quote) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const recipient = quoteRecipientName(quote);
  const reference = quoteReference(quote);
  const breakdown = clientSafeBreakdown(quote);

  const logoPath = path.join(process.cwd(), 'public', 'icon-512.png');
  const logoBuffer = fs.existsSync(logoPath) ? fs.readFileSync(logoPath) : null;

  const children = [];

  if (logoBuffer) {
    children.push(
      new Paragraph({
        children: [new ImageRun({ data: logoBuffer, transformation: { width: 56, height: 56 }, type: 'png' })],
      })
    );
  }

  children.push(
    new Paragraph({
      children: [new TextRun({ text: COMPANY.name, bold: true, size: 32, color: BRAND_COLOR })],
      spacing: { before: 100, after: 40 },
    }),
    new Paragraph({
      children: [new TextRun({ text: COMPANY.address, size: 18, color: '555555' })],
    }),
    new Paragraph({
      children: [new TextRun({ text: `${COMPANY.phone} · ${COMPANY.email}`, size: 18, color: '555555' })],
      spacing: { after: 300 },
    }),
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: `Quote for ${recipient}` })],
      spacing: { after: 80 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `Reference ${reference} · ${new Date(quote.created_at).toLocaleDateString('en-GB')}`
            + (quote.valid_until ? ` · Valid until ${new Date(quote.valid_until).toLocaleDateString('en-GB')}` : ''),
          size: 18,
          color: '555555',
        }),
      ],
      spacing: { after: 300 },
    })
  );

  if (quote.prospect_email || quote.prospect_phone) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: 'CONTACT', bold: true, size: 16, color: '888888' })],
        spacing: { before: 100, after: 60 },
      }),
      new Paragraph({
        children: [new TextRun({ text: [quote.prospect_email, quote.prospect_phone].filter(Boolean).join(' · ') })],
        spacing: { after: 200 },
      })
    );
  }

  children.push(
    new Paragraph({
      children: [new TextRun({ text: 'PROPOSED WORKS', bold: true, size: 16, color: '888888' })],
      spacing: { before: 100, after: 60 },
    }),
    new Paragraph({
      children: [new TextRun({ text: quote.description })],
      spacing: { after: 200 },
    }),
    new Paragraph({
      children: [new TextRun({ text: 'QUOTED PRICE', bold: true, size: 16, color: '888888' })],
      spacing: { before: 100, after: 60 },
    }),
    new Paragraph({
      children: [new TextRun({ text: formatPriceGBP(quote.price), bold: true, size: 48, color: BRAND_COLOR })],
      spacing: { after: 300 },
    }),
    ...(breakdown ? [
      new Paragraph({
        children: [new TextRun({ text: "WHAT'S INCLUDED", bold: true, size: 16, color: '888888' })],
        spacing: { before: 100, after: 60 },
      }),
      ...breakdown.map((item) => new Paragraph({
        children: [
          new TextRun({ text: `${item.label}: `, bold: true, size: 18 }),
          new TextRun({ text: item.value, size: 18 }),
        ],
        spacing: { after: 40 },
      })),
      new Paragraph({ spacing: { after: 160 } }),
    ] : []),
    new Paragraph({
      children: [new TextRun({ text: 'NOTES', bold: true, size: 16, color: '888888' })],
      spacing: { before: 100, after: 60 },
    }),
    ...QUOTE_NOTES.map((note) => new Paragraph({
      children: [new TextRun({ text: `• ${note}`, size: 18 })],
      spacing: { after: 40 },
    })),
    new Paragraph({
      border: { top: { style: BorderStyle.SINGLE, size: 6, color: 'E5E5E5' } },
      children: [
        new TextRun({
          text: `${COMPANY.name} · ${COMPANY.website} · ${COMPANY.phone} · ${COMPANY.email}`,
          size: 16,
          color: '888888',
        }),
      ],
      spacing: { before: 400 },
      alignment: AlignmentType.CENTER,
    })
  );

  const doc = new Document({
    sections: [{ children }],
  });

  const buffer = await Packer.toBuffer(doc);

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${reference}.docx"`,
    },
  });
}
