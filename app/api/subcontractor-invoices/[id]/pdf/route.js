import { NextResponse } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { supabaseAdmin } from '../../../../../lib/supabaseAdmin';
import { companyFromSettings } from '../../../../../lib/companyBranding';
import { INVOICE_COLUMNS, invoiceFileName, shiftsFromPayroll } from '../../../../../lib/subcontractorInvoices';
import { INVOICE_OWNER_EMAIL } from '../../../../../lib/invoiceAccess';
import SubcontractorInvoicePdf from '../../../../../lib/subcontractorInvoicePdf';

// @react-pdf/renderer needs real Node APIs - not the edge runtime.
export const runtime = 'nodejs';

// A subcontractor invoice (0154) as a PDF, for the subcontractor who sent it
// or Jess - the same two people the table's select policy lets read it.
export async function GET(request, { params }) {
  const token = (request.headers.get('authorization') || '').replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: invoice } = await supabaseAdmin.from('subcontractor_invoices')
    .select(INVOICE_COLUMNS).eq('id', params.id).maybeSingle();
  if (!invoice) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  let allowed = invoice.subcontractor_id === user.id;
  if (!allowed && (user.email || '').toLowerCase() === INVOICE_OWNER_EMAIL) {
    const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', user.id).maybeSingle();
    allowed = profile?.role === 'admin';
  }
  if (!allowed) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const [{ data: lines }, { data: adjustments }, { data: settings }] = await Promise.all([
    supabaseAdmin.from('payroll_period_lines').select('minutes, kind, job_date, job_address')
      .eq('period_id', invoice.period_id).eq('cleaner_id', invoice.subcontractor_id).order('job_date'),
    supabaseAdmin.from('payroll_adjustments').select('minutes, reason, job_address, job_date')
      .eq('included_in_period_id', invoice.period_id).eq('cleaner_id', invoice.subcontractor_id),
    supabaseAdmin.from('company_settings').select('*').limit(1).maybeSingle(),
  ]);

  const shifts = shiftsFromPayroll(lines, adjustments);

  const buffer = await renderToBuffer(
    <SubcontractorInvoicePdf invoice={invoice} shifts={shifts} company={companyFromSettings(settings)} />
  );

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${invoiceFileName(invoice)}"`,
    },
  });
}
