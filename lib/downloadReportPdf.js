import { supabase } from './supabaseClient';

// Fetches a property report PDF (api/reports/pdf) and saves it. The route
// needs the bearer token, so a plain link won't do. Returns an error
// message, or null when the file was saved.
export async function downloadReportPdf(params) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return 'Your session has ended - sign in again.';

  const res = await fetch(`/api/reports/pdf?${new URLSearchParams(params)}`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (!res.ok) return 'Could not make the PDF. Try again in a moment.';

  const blob = await res.blob();
  const match = (res.headers.get('Content-Disposition') || '').match(/filename="(.+)"/);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = match ? match[1] : 'report.pdf';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return null;
}
