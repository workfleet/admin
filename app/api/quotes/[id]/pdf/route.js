import { NextResponse } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { supabaseAdmin } from '../../../../../lib/supabaseAdmin';
import { quoteReference, companyFromSettings } from '../../../../../lib/companyBranding';
import QuotePdfDocument from '../../../../../lib/quotePdfDocument';

// @react-pdf/renderer needs real Node APIs (fs, fontkit) - not the edge runtime.
export const runtime = 'nodejs';

// The office, or a client downloading a quote we've sent them from the
// portal (0148). Returns { user, clientId } - clientId set for a client.
async function requireCaller(request) {
  const authHeader = request.headers.get('authorization') || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) return null;

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return null;

  const { data: profile } = await supabaseAdmin.from('profiles').select('role, client_id, active').eq('id', user.id).single();
  if (profile?.role === 'admin' || profile?.role === 'supervisor') return { user, clientId: null };
  if (profile?.role === 'client' && profile.client_id && profile.active !== false) return { user, clientId: profile.client_id };
  return null;
}

export async function GET(request, { params }) {
  const caller = await requireCaller(request);
  if (!caller) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: quote } = await supabaseAdmin
    .from('quotes')
    .select('id, client_id, prospect_name, prospect_email, prospect_phone, description, price, price_period, status, archived_at, valid_until, created_at, calculator_input, calculator_breakdown, shift_schedule, clients(name)')
    .eq('id', params.id)
    .single();

  if (!quote) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // A client sees only its own quotes once sent - never a draft. Same
  // rule as client_quotes().
  if (caller.clientId && (
    quote.client_id !== caller.clientId
    || !['sent', 'accepted', 'declined'].includes(quote.status)
    || quote.archived_at
  )) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }


  // Letterhead and statutory detail come from settings, not from code.
  // A missing row falls back to the compiled defaults rather than
  // failing the download.
  const { data: settings } = await supabaseAdmin.from('company_settings').select('*').limit(1).single();
  const company = companyFromSettings(settings);

  const { data: template } = await supabaseAdmin
    .from('quote_template_sections')
    .select('key, title, body, position, document, service_types, generated, enabled')
    .order('position');

  const buffer = await renderToBuffer(<QuotePdfDocument quote={quote} company={company} template={template} />);

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${quoteReference(quote)}.pdf"`,
    },
  });
}
