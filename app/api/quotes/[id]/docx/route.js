import { NextResponse } from 'next/server';
import { Packer } from 'docx';
import { supabaseAdmin } from '../../../../../lib/supabaseAdmin';
import { quoteReference, companyFromSettings } from '../../../../../lib/companyBranding';
import { buildQuoteDocx } from '../../../../../lib/quoteDocxDocument';

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

export async function GET(request, { params }) {
  const user = await requireStaff(request);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: quote } = await supabaseAdmin
    .from('quotes')
    .select('id, client_id, prospect_name, prospect_email, prospect_phone, description, price, valid_until, created_at, calculator_input, calculator_breakdown, shift_schedule, clients(name)')
    .eq('id', params.id)
    .single();

  if (!quote) return NextResponse.json({ error: 'not_found' }, { status: 404 });


  // Letterhead and statutory detail come from settings, not from code.
  // A missing row falls back to the compiled defaults rather than
  // failing the download.
  const { data: settings } = await supabaseAdmin.from('company_settings').select('*').limit(1).single();
  const company = companyFromSettings(settings);

  const buffer = await Packer.toBuffer(buildQuoteDocx(quote, company));

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${quoteReference(quote)}.docx"`,
    },
  });
}
