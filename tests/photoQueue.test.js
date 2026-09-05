import { describe, it, expect } from 'vitest';
import { makePhotoPath } from '../lib/photoQueue';

// The storage path is the load-bearing pure part of the photo queue. It is
// decided when the photo is taken, not when it uploads, which is what lets a
// half-finished flush be replayed without producing the photo twice - the
// retry writes to the same object. Get this wrong and every retry leaves a
// duplicate in the job's evidence.

const TAKEN = '2026-09-05T14:30:05.123Z';

describe('makePhotoPath', () => {
  it('files the photo under its job', () => {
    // Storage RLS keys off the first path segment being the job id, so this
    // is not cosmetic - get it wrong and the upload is refused.
    expect(makePhotoPath('job-1', TAKEN, 'IMG_0042.HEIC').startsWith('job-1/')).toBe(true);
  });

  it('carries the time it was taken, not the time it was sent', () => {
    // What a queued photo is filed under has to be when it was shot, or a
    // job's photos sort into the order the signal came back rather than the
    // order the rooms were done.
    expect(makePhotoPath('job-1', TAKEN, 'a.jpg')).toContain('2026-09-05T14-30-05');
  });

  it('always ends up a jpg, whatever came off the camera', () => {
    // Everything is re-encoded to JPEG before it gets here; an iPhone's .HEIC
    // extension surviving into the path would mislabel the object.
    expect(makePhotoPath('job-1', TAKEN, 'IMG_0042.HEIC').endsWith('.jpg')).toBe(true);
    expect(makePhotoPath('job-1', TAKEN, 'no-extension').endsWith('.jpg')).toBe(true);
  });

  it('strips characters that would break a storage key', () => {
    const path = makePhotoPath('job-1', TAKEN, 'kitchen /../ sink #1.jpg');
    expect(path.split('/')).toHaveLength(2); // job id, then one filename
    expect(path).not.toMatch(/\.\./);
    expect(path).not.toMatch(/[#?]/);
  });

  it('does not collide for two photos taken in the same millisecond', () => {
    // Burst-tapping the camera button is exactly how somebody photographs a
    // room, and a collision would have the second overwrite the first.
    const a = makePhotoPath('job-1', TAKEN, 'a.jpg');
    const b = makePhotoPath('job-1', TAKEN, 'a.jpg');
    expect(a).not.toBe(b);
  });

  it('copes with no filename at all', () => {
    // Some Android cameras hand over a blob with no name.
    const path = makePhotoPath('job-1', TAKEN, undefined);
    expect(path.startsWith('job-1/')).toBe(true);
    expect(path.endsWith('.jpg')).toBe(true);
  });
});
