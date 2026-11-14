import { describe, it, expect } from 'vitest';
import { clientColour, CLIENT_PALETTE } from '../lib/clientColour';

describe('clientColour', () => {
  it('gives the same client the same colour every time', () => {
    const id = 'd31eacd9-4291-4d30-963c-9dd5204716dd';
    expect(clientColour(id)).toBe(clientColour(id));
  });

  it('always picks from the palette', () => {
    for (let i = 0; i < 200; i++) {
      expect(CLIENT_PALETTE).toContain(clientColour(`client-${i}`));
    }
  });

  it('spreads clients across the palette rather than bunching them', () => {
    const used = new Set(Array.from({ length: 60 }, (_, i) => clientColour(`00000000-0000-0000-0000-${String(i).padStart(12, '0')}`)));
    expect(used.size).toBeGreaterThanOrEqual(7);
  });

  it('has no colour for a job without a client (training)', () => {
    expect(clientColour(null)).toBe(null);
    expect(clientColour('')).toBe(null);
  });

  it('keeps clear of the status colours', () => {
    // Missed / needs a cleaner and done / on site.
    for (const status of ['#D81E34', '#34C77B', '#FF6B5B']) {
      expect(CLIENT_PALETTE).not.toContain(status);
    }
  });
});
