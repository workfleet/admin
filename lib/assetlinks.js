// Digital Asset Links: the file that tells Android an APK and this site are
// the same product.
//
// A Trusted Web Activity is Chrome rendering this site full-screen inside an
// app shell. Chrome only drops its address bar if it can fetch
// /.well-known/assetlinks.json from the site and find, listed there, the exact
// package name and signing certificate of the app asking. Get it wrong and the
// app still runs - it just runs with a browser URL bar pinned across the top,
// which is the one thing wrapping the site in an app was meant to remove.
//
// The values live in env rather than in a committed file because neither is
// known until the app has been built and uploaded, and Play re-signs uploads
// with a different certificate than the one used to build them - so this ends
// up holding two fingerprints, and which two changes over the app's life. They
// are not secrets; the whole point is that anyone can fetch them.
// docs/android-play-store.md is the walkthrough.

const FINGERPRINT_HEX_CHARS = 64; // SHA-256, two hex characters per byte

// Accepts a fingerprint however it arrives from the tool that printed it:
// keytool colon-separates it, Play Console offers a copy button that sometimes
// does not, and a value pasted through a spreadsheet picks up stray spaces.
// Anything that is not 32 hex bytes comes back null, because a typo here fails
// silently at install time and is miserable to track down from the phone end.
export function normaliseFingerprint(raw) {
  if (typeof raw !== 'string') return null;

  const hex = raw.replace(/[\s:]/g, '').toUpperCase();
  if (hex.length !== FINGERPRINT_HEX_CHARS) return null;
  if (!/^[0-9A-F]+$/.test(hex)) return null;

  return hex.match(/.{2}/g).join(':');
}

// One env var holds however many fingerprints are in play, separated by commas
// or newlines - Vercel's env editor allows both, and during a Play submission
// there are two: the upload key, so a locally built APK verifies, and Play's
// own signing key, so the installed one does.
export function parseFingerprints(value) {
  if (!value) return [];

  const seen = new Set();
  for (const part of String(value).split(/[,\n]/)) {
    const fingerprint = normaliseFingerprint(part);
    if (fingerprint) seen.add(fingerprint);
  }
  return [...seen];
}

// The shape Google's spec asks for. An app with no fingerprints is not a claim
// worth publishing, so it is left out entirely rather than half-stated.
export function buildAssetLinks({ packageName, fingerprints } = {}) {
  if (!packageName || !fingerprints?.length) return [];

  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: packageName,
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ];
}

export function assetLinksFromEnv(env = process.env) {
  return buildAssetLinks({
    packageName: env.ANDROID_PACKAGE_NAME,
    fingerprints: parseFingerprints(env.ANDROID_CERT_FINGERPRINTS),
  });
}
