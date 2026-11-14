// The questions on the Company facts page, and how the answers are handed
// to the AI. Each answer is a fact the assistant may state as true; blank
// answers are left out, so the AI still asks or leaves a [CONFIRM: ...].

export const FACT_SECTIONS = [
  {
    title: 'About us',
    facts: [
      { key: 'services', label: 'What cleaning services do you offer?', hint: 'e.g. office cleaning, deep cleans, window cleaning, washroom services' },
      { key: 'sectors', label: 'Who are your clients?', hint: 'e.g. offices, the council, transport, letting agents' },
      { key: 'areas', label: 'Which areas do you cover?', hint: 'e.g. Swansea, Neath Port Talbot, Carmarthenshire' },
      { key: 'founded', label: 'When did the company start, and its story in a sentence or two', hint: '' },
      { key: 'staff', label: 'How many staff do you have?', hint: 'e.g. 25 cleaners, 3 supervisors, 2 office' },
      { key: 'hours', label: 'Office hours and out-of-hours contact', hint: '' },
    ],
  },
  {
    title: 'Cover and certificates',
    facts: [
      { key: 'insurance', label: 'Insurance cover', hint: 'Public liability, employer\'s liability, insurer, amounts' },
      { key: 'certifications', label: 'Certifications and memberships you DO hold', hint: 'e.g. SafeContractor, CHAS, Living Wage employer - only ones you have now' },
      { key: 'never_claim', label: 'Things the AI must NEVER claim', hint: 'e.g. certificates you are only working towards, services you don\'t offer', strong: true },
      { key: 'vetting', label: 'Staff vetting', hint: 'e.g. DBS checks, right to work, references' },
      { key: 'training', label: 'Training staff get', hint: 'e.g. induction, COSHH, manual handling, in-app training videos' },
    ],
  },
  {
    title: 'How we work',
    facts: [
      { key: 'quality', label: 'How you check quality', hint: 'Who inspects, how often, what is recorded' },
      { key: 'complaints', label: 'How complaints are handled, and how fast', hint: '' },
      { key: 'cover', label: 'Cover for sickness and holidays', hint: '' },
      { key: 'technology', label: 'What your app does for clients and staff', hint: 'Only features you actually use, e.g. clock-in with location, photos, client portal' },
      { key: 'health_safety', label: 'Health and safety', hint: 'Risk assessments, COSHH, PPE, lone working, accident reporting' },
      { key: 'environment', label: 'Products and environmental approach', hint: 'e.g. eco products, waste, reducing travel' },
      { key: 'social_value', label: 'Social value', hint: 'e.g. local hiring, pay, community work' },
    ],
  },
  {
    title: 'Letters and style',
    facts: [
      { key: 'signoff_name', label: 'Who signs letters? (name)', hint: '' },
      { key: 'signoff_title', label: 'Their job title', hint: '' },
      { key: 'style', label: 'House style', hint: 'e.g. friendly but professional, say "we", no jargon' },
      { key: 'other', label: 'Anything else the AI should know', hint: '' },
    ],
  },
];

export const FACT_KEYS = FACT_SECTIONS.flatMap((s) => s.facts.map((f) => f.key));

export function factLabel(key) {
  for (const s of FACT_SECTIONS) {
    const f = s.facts.find((x) => x.key === key);
    if (f) return f.label;
  }
  return key;
}

// rows: [{ key, value }] -> { key: value } for known keys with something in.
export function factsMap(rows) {
  const out = {};
  for (const r of rows || []) {
    if (FACT_KEYS.includes(r.key) && typeof r.value === 'string' && r.value.trim()) out[r.key] = r.value.trim();
  }
  return out;
}

export function factsFilled(map) {
  return FACT_KEYS.filter((k) => map[k]).length;
}

// The facts as a block for the prompt. never_claim is left out here - it
// goes into the rules instead (see neverClaimRule).
export function factsContext(map) {
  const lines = [];
  for (const s of FACT_SECTIONS) {
    for (const f of s.facts) {
      if (f.key === 'never_claim' || !map[f.key]) continue;
      lines.push(`- ${f.label.replace(/\?$/, '')}: ${map[f.key]}`);
    }
  }
  if (!lines.length) return '';
  return `Company facts, confirmed by the office - true, use them instead of leaving blanks:\n${lines.join('\n')}`;
}

export function neverClaimRule(map) {
  if (!map?.never_claim) return '';
  return `\n- The office has said the company must NEVER claim the following. Do not state or imply any of it, even if asked:\n${map.never_claim}`;
}
