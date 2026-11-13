// What to do in the moment, shown above the report form on the staff page.
//
// Basic first aid for the things that actually happen on cleaning jobs,
// in plain steps, written from NHS and HSE guidance. It is a reminder, not
// training: the product label and the person's own first-aid training come
// first, and whoever runs the company's first-aid training should check
// this wording before anyone relies on it. Keep each card short enough to
// read with wet hands on a phone.

export const RIGHT_NOW = [
  { title: 'Make it safe', text: "Stop work. Stop anyone else getting hurt: put a sign out, unplug it, close the area off. Don't put yourself at risk." },
  { title: 'Get help', text: 'Badly hurt: call 999. Need the office now: use the emergency button. Not sure how serious: call NHS 111.' },
  { title: 'First aid', text: 'Use the first aid kit. The cards below say what to do for the usual cleaning injuries.' },
  { title: 'Leave things as they are', text: "Don't clear up or move anything unless it's dangerous. The office may need to see what happened." },
  { title: 'Take photos', text: "If it's safe to, photograph the place, what caused it and any damage." },
  { title: 'Report it today', text: 'Use the buttons below, even if it seems minor. Nobody gets in trouble for reporting.' },
];

export const FIRST_AID_CARDS = [
  {
    key: 'eyes',
    title: 'Chemical in the eyes',
    steps: [
      'Rinse the eye with clean running water for at least 20 minutes. Hold the eye open.',
      "Take out contact lenses if they come out easily. Don't rub the eye.",
      'Then call 111 or go to A&E. Take the product, or a photo of its label, with you.',
    ],
  },
  {
    key: 'skin',
    title: 'Chemical on the skin',
    steps: [
      'Take off gloves or clothing with the chemical on, carefully, without touching it.',
      'Rinse the skin under running water for at least 20 minutes.',
      'If it is burning, blistering or a large area, call 111, or 999 if it is serious.',
    ],
  },
  {
    key: 'swallowed',
    title: 'Product swallowed',
    steps: [
      "Don't make them sick.",
      "Call 111 straight away, or 999 if they are struggling to breathe, drowsy or fitting.",
      'Keep the product with you so you can read out what is in it.',
    ],
  },
  {
    key: 'fumes',
    title: 'Breathed in fumes',
    steps: [
      'Get out into fresh air and open windows if you can do it safely. Leave the room.',
      'Call 111, or 999 if they are struggling to breathe.',
      'Never mix products - bleach with other cleaners can make toxic gas.',
    ],
  },
  {
    key: 'sharps',
    title: 'Needle or sharp',
    steps: [
      "Found one: don't pick it up with your hands. Leave it, warn others, tell the office.",
      "Pricked or cut by one: let it bleed gently under running water, don't suck it, wash with soap and water, and cover it.",
      "Call 111 or go to A&E straight away - treatment works best within hours. Then report it here.",
    ],
  },
  {
    key: 'fluids',
    title: 'Blood or body fluids',
    steps: [
      'Put on gloves before you touch it, and use the spill kit or the right disinfectant.',
      'If any gets in your eyes, mouth or a cut, rinse with plenty of water and call 111.',
    ],
  },
  {
    key: 'cuts',
    title: 'Cuts',
    steps: [
      'Press on the cut with a clean dressing to stop the bleeding.',
      'Clean small cuts with water and cover them with a plaster.',
      "Bleeding that won't stop, or a deep cut: keep pressing and call 999.",
    ],
  },
  {
    key: 'falls',
    title: 'Falls and head bumps',
    steps: [
      "If they might have hurt their neck or back, don't move them. Call 999.",
      'After a bang to the head, watch for drowsiness, being sick, confusion or a bad headache. If you see any, call 999 or go to A&E.',
    ],
  },
  {
    key: 'burns',
    title: 'Burns from hot water or steam',
    steps: [
      'Cool the burn under cool running water for 20 minutes. Take off rings or watches nearby.',
      "Cover it loosely with cling film. Don't use creams, ice or butter.",
      'Large or deep burns, or burns on the face: call 999.',
    ],
  },
  {
    key: 'lifting',
    title: 'Hurt while lifting',
    steps: [
      "Stop. Don't carry on with the job.",
      'Report it here, even if it feels minor - back injuries often get worse the next day.',
    ],
  },
  {
    key: 'aggression',
    title: 'Someone is aggressive',
    steps: [
      "Don't argue. Leave, and get somewhere safe.",
      'Use the emergency button, or call 999 if you are in danger.',
      'Report it here once you are safe.',
    ],
  },
];

export const GUIDANCE_NOTE = 'Basic steps only. The product label and your first-aid training come first.';
