import { describe, it, expect } from 'vitest';
import {
  normaliseFingerprint,
  parseFingerprints,
  buildAssetLinks,
  assetLinksFromEnv,
} from '../lib/assetlinks';

// A wrong assetlinks.json does not throw and does not 500. The site serves it
// happily, Chrome reads it, disagrees quietly, and every phone that installs
// the app gets a URL bar across the top of it - with nothing on this end to
// say why. These tests are the only place the shape gets checked before it
// reaches a phone.

describe('normaliseFingerprint', () => {
  const canonical =
    '14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42:E6:1D:BE:A8:8A:04:96:B2:3F:CF:44:E5';

  it('keeps a keytool fingerprint as it is', () => {
    expect(normaliseFingerprint(canonical)).toBe(canonical);
  });

  it('adds the colons back when they were stripped on copy', () => {
    const bare = canonical.replace(/:/g, '');
    expect(normaliseFingerprint(bare)).toBe(canonical);
  });

  it('upper-cases and trims what a copy-paste picks up on the way', () => {
    expect(normaliseFingerprint(`  ${canonical.toLowerCase()}\n`)).toBe(canonical);
  });

  it('rejects a fingerprint with a byte missing rather than serving it', () => {
    // The failure worth catching: a value short of 32 bytes is a truncated
    // paste, and publishing it means the app never verifies.
    expect(normaliseFingerprint(canonical.slice(0, -3))).toBe(null);
  });

  it('rejects non-hex characters', () => {
    expect(normaliseFingerprint(canonical.replace('14', 'ZZ'))).toBe(null);
  });

  it('rejects an empty or missing value', () => {
    expect(normaliseFingerprint('')).toBe(null);
    expect(normaliseFingerprint(undefined)).toBe(null);
  });
});

describe('parseFingerprints', () => {
  const upload =
    '14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42:E6:1D:BE:A8:8A:04:96:B2:3F:CF:44:E5';
  const playSigning =
    'A4:0D:A8:0A:59:D1:70:CA:A9:50:CF:15:C1:8C:45:4D:47:A3:9B:26:98:9D:8B:64:0E:CD:74:5B:A7:1B:F5:DC';

  it('reads the two-key case a Play submission actually needs', () => {
    expect(parseFingerprints(`${upload},${playSigning}`)).toEqual([upload, playSigning]);
  });

  it('accepts newlines, which is how they paste into Vercel', () => {
    expect(parseFingerprints(`${upload}\n${playSigning}`)).toEqual([upload, playSigning]);
  });

  it('drops a duplicate rather than claiming the same key twice', () => {
    expect(parseFingerprints(`${upload}, ${upload.toLowerCase()}`)).toEqual([upload]);
  });

  it('drops the bad one and keeps the good one', () => {
    expect(parseFingerprints(`not-a-fingerprint,${upload}`)).toEqual([upload]);
  });

  it('is empty when nothing is set', () => {
    expect(parseFingerprints(undefined)).toEqual([]);
    expect(parseFingerprints('')).toEqual([]);
  });
});

describe('buildAssetLinks', () => {
  const fingerprints = [
    '14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42:E6:1D:BE:A8:8A:04:96:B2:3F:CF:44:E5',
  ];

  it('builds the statement Google looks for', () => {
    expect(buildAssetLinks({ packageName: 'app.workfleet.twa', fingerprints })).toEqual([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: 'app.workfleet.twa',
          sha256_cert_fingerprints: fingerprints,
        },
      },
    ]);
  });

  it('claims nothing when only half the pair is known', () => {
    // Either half alone verifies no app, and a malformed statement is harder
    // to debug from a phone than an obviously empty one.
    expect(buildAssetLinks({ packageName: 'app.workfleet.twa', fingerprints: [] })).toEqual([]);
    expect(buildAssetLinks({ fingerprints })).toEqual([]);
    expect(buildAssetLinks()).toEqual([]);
  });
});

describe('assetLinksFromEnv', () => {
  it('serves an empty list before the Android app exists', () => {
    expect(assetLinksFromEnv({})).toEqual([]);
  });

  it('serves both keys when both are set', () => {
    const links = assetLinksFromEnv({
      ANDROID_PACKAGE_NAME: 'app.workfleet.twa',
      ANDROID_CERT_FINGERPRINTS:
        '14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42:E6:1D:BE:A8:8A:04:96:B2:3F:CF:44:E5,A4:0D:A8:0A:59:D1:70:CA:A9:50:CF:15:C1:8C:45:4D:47:A3:9B:26:98:9D:8B:64:0E:CD:74:5B:A7:1B:F5:DC',
    });

    expect(links).toHaveLength(1);
    expect(links[0].target.package_name).toBe('app.workfleet.twa');
    expect(links[0].target.sha256_cert_fingerprints).toHaveLength(2);
  });
});
