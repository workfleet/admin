import { NextResponse } from 'next/server';
import { assetLinksFromEnv } from '../../../lib/assetlinks';

export const runtime = 'nodejs';

// Read the env at request time, not at build time. Setting the fingerprint in
// Vercel already forces a redeploy, so this changes little in practice - but a
// statically baked answer is the kind of thing that makes an already fiddly
// verification step fail for a reason nobody thinks to check.
export const dynamic = 'force-dynamic';

// Served at /.well-known/assetlinks.json via a rewrite in next.config.js,
// because the leading dot makes that a hidden directory and the App Router
// will not route a folder it treats as hidden.
//
// Google fetches this over HTTPS, follows no redirects, and wants
// application/json. Before the Android app exists the answer is an empty list:
// valid, honest - nothing is claimed yet - and it means the URL can be opened
// today to confirm the plumbing works, leaving only the fingerprint to add.
export async function GET() {
  return NextResponse.json(assetLinksFromEnv(), {
    headers: {
      'Content-Type': 'application/json',
      // Short enough that a corrected fingerprint takes effect while you are
      // still sitting there wondering why the URL bar has not gone away.
      'Cache-Control': 'public, max-age=300',
    },
  });
}
