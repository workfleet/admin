import { describe, it, expect } from 'vitest';
import { crc32, buildZip, photoFileName, photoNamePrefix } from '../lib/photoDownload';

describe('photoNamePrefix', () => {
  it('uses the first address line and the job date', () => {
    expect(photoNamePrefix('12 High Street, Leeds, LS1 1AA', '2026-10-05T09:00:00')).toBe('12 High Street 2026-10-05');
  });
  it('strips characters files cannot have', () => {
    expect(photoNamePrefix('Flat 3/4 "Axis" Court', null)).toBe('Flat 3 4 Axis Court');
  });
  it('falls back when there is no address', () => {
    expect(photoNamePrefix('', null)).toBe('Job');
  });
});

describe('photoFileName', () => {
  it('numbers photos and keeps the stored extension', () => {
    expect(photoFileName('12 High Street 2026-10-05', 'job-1/1700000000.PNG', 0)).toBe('12 High Street 2026-10-05 - 01.png');
  });
  it('defaults to jpg', () => {
    expect(photoFileName('X', 'job-1/abc', 11)).toBe('X - 12.jpg');
  });
});

describe('buildZip', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('writes local headers, a central directory and an end record for every file', () => {
    const files = [
      { name: 'a.jpg', bytes: new Uint8Array([1, 2, 3]) },
      { name: 'b.jpg', bytes: new Uint8Array([4, 5]) },
    ];
    const zip = buildZip(files);
    const v = new DataView(zip.buffer);
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    const end = zip.length - 22;
    expect(v.getUint32(end, true)).toBe(0x06054b50);
    expect(v.getUint16(end + 10, true)).toBe(2);
    const cdOffset = v.getUint32(end + 16, true);
    expect(v.getUint32(cdOffset, true)).toBe(0x02014b50);
    expect(zip.length).toBe((30 + 5 + 3) + (30 + 5 + 2) + 2 * (46 + 5) + 22);
  });
});

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import JobPhotoGrid from '../app/components/JobPhotoGrid';

describe('JobPhotoGrid', () => {
  it('renders a download button per photo and a download-all button', () => {
    const photos = [
      { id: 'p1', url: 'job/1.jpg', caption: null, signedUrl: 'https://x/1.jpg' },
      { id: 'p2', url: 'job/2.jpg', caption: 'Kitchen', signedUrl: 'https://x/2.jpg' },
      { id: 'p3', url: 'job/3.jpg', caption: null, signedUrl: undefined },
    ];
    const html = renderToStaticMarkup(createElement(JobPhotoGrid, { photos, namePrefix: '12 High Street 2026-10-05' }));
    expect(html.match(/aria-label="Download this photo"/g)).toHaveLength(2);
    expect(html).toContain('Download all (2)');
  });
});
