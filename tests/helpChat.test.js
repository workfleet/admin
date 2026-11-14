import { describe, it, expect } from 'vitest';
import { cleanHelpMessages, pageNote, parseAnswer, answerRuns, isAppLink, helpSystem } from '../lib/helpChat';
import { londonToUtcIso, utcToLondonLocal, overlaps, describeWhen, actionHeadline, actionDetails, ROTA_TOOLS, ROTA_ACTION_TYPES } from '../lib/rotaAssistant';

describe('London times', () => {
  it('converts winter times (GMT)', () => {
    expect(londonToUtcIso('2026-11-20T18:00')).toBe('2026-11-20T18:00:00.000Z');
  });

  it('converts summer times (BST is an hour ahead)', () => {
    expect(londonToUtcIso('2026-07-01T09:30')).toBe('2026-07-01T08:30:00.000Z');
  });

  it('round-trips both ways across the year', () => {
    for (const local of ['2026-03-29T12:00', '2026-10-25T09:00', '2027-01-03T06:00']) {
      expect(utcToLondonLocal(londonToUtcIso(local))).toBe(local);
    }
  });

  it('rejects nonsense', () => {
    expect(londonToUtcIso('next thursday')).toBeNull();
    expect(londonToUtcIso('2026-13-01T10:00')).toBeNull();
  });

  it('describes a visit in UK time', () => {
    expect(describeWhen('2026-11-20T18:00:00.000Z', 120)).toBe('Fri 20 Nov, 18:00-20:00');
  });

  it('spots overlaps but not back-to-back visits', () => {
    expect(overlaps('2026-11-20T18:00:00Z', 120, '2026-11-20T19:00:00Z', 60)).toBe(true);
    expect(overlaps('2026-11-20T18:00:00Z', 120, '2026-11-20T20:00:00Z', 60)).toBe(false);
  });
});

describe('action cards', () => {
  it('describes a booking', () => {
    const a = { type: 'create_job', site: 'Bus Station (Council)', start: '2026-11-23T18:00:00.000Z', duration_minutes: 90, staffNames: ['Sam'], notes: null };
    expect(actionHeadline(a)).toBe('Book a visit at Bus Station (Council)');
    expect(actionDetails(a)).toEqual(['Mon 23 Nov, 18:00-19:30 (1.5h)', 'Cleaners: Sam']);
  });

  it('says a change to a repeating visit is this visit only', () => {
    const a = { type: 'add_staff', site: 'X', staffName: 'Sam', jobStart: '2026-11-23T18:00:00Z', jobDuration: 60, inSeries: true };
    expect(actionDetails(a).at(-1)).toMatch(/This visit only/);
  });

  it('describes a new client and a new site', () => {
    const client = { type: 'create_client', name: 'Test Bakery Ltd', contact_name: 'Ann', phone: '07700 900123', email: null, billing_address: null, industry: 'Retail', notes: null };
    expect(actionHeadline(client)).toBe('Add a new client: Test Bakery Ltd');
    expect(actionDetails(client)).toEqual(['Contact: Ann', 'Phone: 07700 900123', 'Sector: Retail']);
    const site = { type: 'create_site', clientName: 'Test Bakery Ltd', address: '10 Wind Street, Swansea', lat: 51.6, lng: -3.9 };
    expect(actionHeadline(site)).toBe('Add a site for Test Bakery Ltd');
    expect(actionDetails(site)).toEqual(['10 Wind Street, Swansea', 'Map pin found - check it is the right place.']);
  });

  it('describes a change to this and every later visit', () => {
    const a = { type: 'move_job', scope: 'later', site: 'X', fromStart: '2026-11-17T06:00:00Z', fromDuration: 120, start: '2026-11-17T07:00:00Z', duration_minutes: 120, count: 12, lastAt: '2027-02-02T07:00:00Z', inSeries: true };
    expect(actionHeadline(a)).toBe('Change the time of the repeating visits at X');
    expect(actionDetails(a)).toEqual([
      'Time: 06:00-08:00 → 07:00-09:00, from Tue 17 Nov',
      'This visit and every later one: 12 visits, up to Tue 2 Feb. Finished visits are not changed.',
    ]);
  });

  it('offers this-visit or this-and-later for repeating visits', () => {
    const props = ROTA_TOOLS.find((t) => t.name === 'propose_changes').input_schema.properties.changes.items.properties;
    expect(props.scope.enum).toEqual(['this', 'later', null]);
  });

  it('shows a client edit as before and after', () => {
    const a = { type: 'update_client', clientName: 'Acme', diff: [{ label: 'Phone', from: '07700 900123', to: '07700 900456' }, { label: 'Email', from: '', to: 'a@acme.co.uk' }] };
    expect(actionHeadline(a)).toBe("Change Acme's details");
    expect(actionDetails(a)).toEqual(['Phone: 07700 900123 → 07700 900456', 'Email: (blank) → a@acme.co.uk']);
  });

  it('shows a site move as from and to', () => {
    const a = { type: 'update_site', clientName: 'Acme', fromAddress: '1 High St', address: '2 High St' };
    expect(actionHeadline(a)).toBe("Change a site's address for Acme");
    expect(actionDetails(a)).toEqual(['From: 1 High St', 'To: 2 High St', 'New map pin found - check it is the right place.']);
  });

  it('only lets the AI pick a sector from the New client list', () => {
    const props = ROTA_TOOLS.find((t) => t.name === 'propose_changes').input_schema.properties.changes.items.properties;
    expect(props.industry.anyOf[0].enum).toContain('Office / Commercial');
  });

  it('offers only the supported change types, and nothing that deletes', () => {
    const propose = ROTA_TOOLS.find((t) => t.name === 'propose_changes');
    expect(propose.input_schema.properties.changes.items.properties.type.enum).toEqual(ROTA_ACTION_TYPES);
    expect(ROTA_ACTION_TYPES.some((t) => /delete/.test(t))).toBe(false);
  });
});

describe('help chat messages', () => {
  it('starts on a user turn, alternates and ends on a user turn', () => {
    const out = cleanHelpMessages([
      { role: 'assistant', content: 'hi' },
      { role: 'user', content: 'a' },
      { role: 'user', content: 'b' },
      { role: 'assistant', content: 'c' },
      { role: 'system', content: 'ignore' },
      { role: 'user', content: 'd' },
      { role: 'assistant', content: 'e' },
    ]);
    expect(out.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(out[0].content).toBe('a\n\nb');
  });

  it('notes the page without ids or query strings', () => {
    expect(pageNote('/admin/clients/1f0c8e2a-1234-4abc-9def-0123456789ab?tab=x')).toBe('(They are on the page /admin/clients/[id].)');
    expect(pageNote('https://evil.example/x')).toBe('');
  });

  it('keeps links only inside the app', () => {
    expect(isAppLink('/admin/rota')).toBe(true);
    expect(isAppLink('https://example.com')).toBe(false);
    expect(answerRuns('Go to [Rota](/admin/rota) or [here](https://x.com)')).toEqual([
      { text: 'Go to ' }, { text: 'Rota', href: '/admin/rota' }, { text: ' or ' }, { text: 'here' },
    ]);
  });

  it('reads numbered steps', () => {
    expect(parseAnswer('Do this:\n1. Open **Rota**\n2. Click "+ New job"').map((b) => b.type)).toEqual(['p', 'numbered', 'numbered']);
  });

  it('wraps the guide in the system prompt', () => {
    expect(helpSystem('GUIDE TEXT')).toContain('<guide>\nGUIDE TEXT\n</guide>');
  });
});
