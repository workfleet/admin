import { describe, it, expect } from 'vitest';
import { shortAddress } from '../lib/shortAddress';

// Real addresses from the rota, in the shapes they actually arrive in:
// typed by hand, or filled in by the address lookup with the town, county
// and country on the end.
describe('shortAddress', () => {
  it('keeps a house number with its street', () => {
    expect(shortAddress('7 Clarice Street, Aberavon, Neath Port Talbot, Wales, SA12 6BQ, United Kingdom')).toBe('7 Clarice Street');
    expect(shortAddress('33, Gwendoline Street, Aberavon, Neath Port Talbot, Wales')).toBe('33 Gwendoline Street');
    expect(shortAddress('18, Swansea Road, Llangyfelach, Swansea')).toBe('18 Swansea Road');
  });

  it('keeps a flat or unit with the part that says where it is', () => {
    expect(shortAddress('Flat 2, 3 The Promenade, Mount pleasant SA1 6EN')).toBe('Flat 2, 3 The Promenade');
    expect(shortAddress('Unit 3, Kenfig Industrial Estate, Margam')).toBe('Unit 3, Kenfig Industrial Estate');
    expect(shortAddress('Unit 1-2, J Shed Arcade, Kings road, Swansea SA1 8PL')).toBe('Unit 1-2, J Shed Arcade');
    expect(shortAddress('unit 4 ash court, Viking way SA1 7DA')).toBe('unit 4 ash court');
  });

  it('skips a postcode at the front', () => {
    expect(shortAddress('SA7 9AG, Llansamlet, Tregof, Swansea, Wales, United Kingdom')).toBe('Llansamlet');
  });

  it('leaves a named building or a bare street alone', () => {
    expect(shortAddress('The Eagle Inn, 855, Llangyfelach Road')).toBe('The Eagle Inn');
    expect(shortAddress('Beechtree Lane')).toBe('Beechtree Lane');
  });

  it('copes with nothing', () => {
    expect(shortAddress(null)).toBe('');
    expect(shortAddress('')).toBe('');
  });
});
