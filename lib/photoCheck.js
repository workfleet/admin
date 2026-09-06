// Do the photos cover the checklist?
//
// A property checklist (0054) says what "done" looks like at a site, room by
// room. The photos a cleaner takes are the evidence it was done. This joins
// the two at the moment it is still cheap to act on - before check-out, while
// the cleaner can walk back into the room they missed - rather than a week
// later when a client asks for a picture of the bathroom and there isn't one.
//
// The question asked of the model is deliberately narrow: for each area, is
// there at least one photo that clearly shows it? It is not asked to grade
// the cleaning. A judgement on quality from a phone photo would be argued
// with, and the point here is a nudge the cleaner will act on, not a verdict.
// A short note per area is allowed for anything plainly visible - a bin
// still full, say - because that is worth a second look while on site.
//
// The pure parts live here so they can be tested without the API: which
// areas a job is checked against, and what to do with the model's answer.

// Enough to cover a house room by room without sending a whole album. The
// route takes the most recent photos, so the ones taken last - usually the
// finished rooms - are the ones seen.
export const MAX_PHOTOS_CHECKED = 12;

// The areas a job's photos are measured against. The property checklist is
// the authority where one exists: its rooms, in the order the office wrote
// them, with the tasks under each as context for what the room should look
// like. A property with no checklist falls back to the job's own to-do list,
// each item standing in as an area. Neither means there is nothing to check
// against, and the check is skipped.
export function areasForJob(checklistItems, tasks) {
  const byRoom = new Map();
  (checklistItems || []).forEach((item) => {
    const room = String(item.room || '').trim();
    if (!room) return;
    if (!byRoom.has(room)) byRoom.set(room, { area: room, details: [] });
    const task = String(item.task || '').trim();
    if (task) byRoom.get(room).details.push(task);
  });
  if (byRoom.size > 0) return [...byRoom.values()];

  return (tasks || [])
    .map((t) => String(t.description || '').trim())
    .filter(Boolean)
    .map((description) => ({ area: description, details: [] }));
}

export function buildPhotoCheckPrompt({ address, areas, photoCount }) {
  const areaList = areas
    .map((a, i) => `${i + 1}. ${a.area}${a.details.length > 0 ? ` (${a.details.join('; ')})` : ''}`)
    .join('\n');

  return `You are checking a cleaner's photos before they leave a property, for a cleaning company's own records.

Property: ${address || 'Unknown address'}
${photoCount} photo(s) taken at the end of the visit are attached.

The property's checklist has these areas:
${areaList}

For each area, decide whether at least one of the attached photos clearly shows that area. Mark it covered only if you can actually see it in a photo. A photo may show more than one area, and an area may have several photos. Phone photos can be dim or at odd angles - judge whether the area is shown, not whether the photo is good.

If something in a covered area is plainly not finished in the photo (a bin still full, a surface still cluttered, a floor obviously unswept), say so in a few words in the note. Otherwise leave the note empty. Do not comment on the cleaning quality beyond that, and do not invent details that are not visible.

Use the area names exactly as written above. Finish with a one-sentence summary for the cleaner.`;
}

// The shape the model is asked to return. Strict so the route never has to
// guess at a missing field.
export const PHOTO_CHECK_SCHEMA = {
  type: 'object',
  properties: {
    areas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          area: { type: 'string' },
          covered: { type: 'boolean' },
          note: { type: 'string' },
        },
        required: ['area', 'covered', 'note'],
        additionalProperties: false,
      },
    },
    summary: { type: 'string' },
  },
  required: ['areas', 'summary'],
  additionalProperties: false,
};

function normaliseName(name) {
  return String(name || '').trim().toLowerCase();
}

// Reconcile what the model said with what it was asked. Every requested area
// comes back exactly once, in the requested order, whether or not the model
// mentioned it - one it forgot is reported as not covered, because the
// alternative is a missing room silently passing. Anything the model added
// that was not on the list is dropped.
export function normalisePhotoCheck(raw, areas) {
  const answered = new Map();
  const answeredList = raw && Array.isArray(raw.areas) ? raw.areas : [];
  answeredList.forEach((a) => {
    const key = normaliseName(a && a.area);
    if (key && !answered.has(key)) answered.set(key, a);
  });

  const result = areas.map((requested) => {
    const found = answered.get(normaliseName(requested.area));
    return {
      area: requested.area,
      covered: found ? found.covered === true : false,
      note: found && typeof found.note === 'string' ? found.note.trim() : '',
    };
  });

  return {
    areas: result,
    summary: raw && typeof raw.summary === 'string' ? raw.summary.trim() : '',
  };
}

// Pull JSON out of a text response. The model is asked for JSON only, but a
// fence around it has happened before (see api/reports/generate).
export function parsePhotoCheckText(text) {
  const cleaned = String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  return JSON.parse(cleaned);
}

export function missingAreas(result) {
  return ((result && result.areas) || []).filter((a) => !a.covered).map((a) => a.area);
}

// One call, one answer. `client` is an Anthropic SDK client; passed in so the
// route owns the key and this stays testable.
export async function runPhotoCheck({ client, address, areas, imageBlocks, model = 'claude-opus-5' }) {
  const prompt = buildPhotoCheckPrompt({ address, areas, photoCount: imageBlocks.length });

  const message = await client.messages.create({
    model,
    max_tokens: 2000,
    // A yes/no per room from a handful of photos does not need the model's
    // deepest thought, and the cleaner is standing at the door waiting.
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: PHOTO_CHECK_SCHEMA },
    },
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, ...imageBlocks] }],
  });

  if (message.stop_reason === 'refusal') {
    return { ok: false, reason: 'refusal' };
  }

  const text = message.content.find((block) => block.type === 'text')?.text;
  if (!text) return { ok: false, reason: 'empty' };

  let raw;
  try {
    raw = parsePhotoCheckText(text);
  } catch {
    return { ok: false, reason: 'unparseable' };
  }

  return { ok: true, result: normalisePhotoCheck(raw, areas) };
}
