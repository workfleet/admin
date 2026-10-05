import { NextResponse } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';
import { companyFromSettings } from '../../../../lib/companyBranding';
import { loadDetailedReport, photosToPrint, monthBounds } from '../../../../lib/detailedReport';
import ReportPdfDocument from '../../../../lib/reportPdfDocument';

// @react-pdf/renderer needs real Node APIs (fs, fontkit) - not the edge runtime.
export const runtime = 'nodejs';
// A month of visits means fetching a few dozen photos from storage.
export const maxDuration = 60;

// react-pdf prints JPEG and PNG only.
const PRINTABLE = { jpg: 'jpg', jpeg: 'jpg', png: 'png' };

async function caller(request) {
  const token = (request.headers.get('authorization') || '').replace('Bearer ', '');
  if (!token) return null;
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return null;
  const { data: profile } = await supabaseAdmin.from('profiles').select('role, client_id').eq('id', user.id).single();
  return profile || null;
}

function safeName(text) {
  return String(text || 'report').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 60);
}

// GET ?job=<id>                    one visit
// GET ?property=<id>&month=YYYY-MM one property, one month
//
// Admins and supervisors can download any of it. A single visit they
// download includes its report whether or not it's shared, because they
// asked for that report by name; the monthly report holds only shared
// reports so it matches what the client sees on the portal. Clients get
// their own properties only, shared reports only, and the monthly report
// only once detailed reports are switched on for them (0122).
export async function GET(request) {
  const profile = await caller(request);
  if (!profile) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const isStaff = profile.role === 'admin' || profile.role === 'supervisor';
  const isClient = profile.role === 'client' && !!profile.client_id;
  if (!isStaff && !isClient) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get('job');
  const propertyId = searchParams.get('property');
  const month = searchParams.get('month');

  if (!jobId && !(propertyId && monthBounds(month))) {
    return NextResponse.json({ error: 'missing_params' }, { status: 400 });
  }

  if (isClient && !jobId) {
    const { data: client } = await supabaseAdmin.from('clients').select('detailed_reports').eq('id', profile.client_id).single();
    if (!client?.detailed_reports) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const loaded = await loadDetailedReport(supabaseAdmin, {
    jobId,
    propertyId,
    month,
    sharedOnly: !(isStaff && jobId),
  });
  if (!loaded) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (isClient && loaded.property?.client_id !== profile.client_id) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  // A client asking for one visit with nothing shared on it gets nothing.
  if (isClient && jobId && !loaded.visits[0]?.report) {
    return NextResponse.json({ error: 'not_shared' }, { status: 404 });
  }

  const printed = new Map();
  const wanted = [];
  loaded.visits.forEach((v) => {
    if (v.status === 'missed') return;
    const list = photosToPrint(v);
    printed.set(v.id, list.map((p) => p.id));
    wanted.push(...list);
  });

  const photos = (await Promise.all(wanted.map(async (p) => {
    const format = PRINTABLE[p.url.split('.').pop().toLowerCase()];
    if (!format) return null;
    const { data: file } = await supabaseAdmin.storage.from('job-photos').download(p.url);
    if (!file) return null;
    return { id: p.id, format, data: Buffer.from(await file.arrayBuffer()) };
  }))).filter(Boolean);

  const { data: settings } = await supabaseAdmin.from('company_settings').select('*').limit(1).single();
  const company = companyFromSettings(settings);

  const buffer = await renderToBuffer(
    <ReportPdfDocument
      property={loaded.property}
      visits={loaded.visits}
      month={jobId ? null : month}
      photos={photos}
      printed={printed}
      company={company}
    />
  );

  const when = jobId ? (loaded.visits[0]?.scheduled_at || '').slice(0, 10) : month;
  const filename = `${safeName(loaded.property?.address)}-${when}.pdf`;

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
