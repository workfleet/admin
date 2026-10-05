// Writes a room-by-room (detailed) report for one visit: reads the visit,
// its to-do list, check-in times and photos, asks the model, and returns the
// columns for job_reports. Shared by the report route and anything that
// needs to see a report without saving one.
//
// Server-only: it downloads photos with the service key.
import Anthropic from '@anthropic-ai/sdk';
import {
  MAX_DETAILED_PHOTOS, checklistRooms, photoTimeline, buildDetailedPrompt,
  DETAILED_REPORT_SCHEMA, parseDetailedReport, shortAddress,
} from './detailedReport';

// The most capable current model: reading a phone photo of a fire alarm
// panel or telling a "before" kitchen from an "after" one is where a weaker
// model gets it wrong. Medium effort: low was tried (28s against 47s on a
// 13-photo visit) and invented work and missed damage. Medium, with the
// photo cap in detailedReport.js, keeps a report inside the route's sixty
// seconds.
export const DETAILED_REPORT_MODEL = 'claude-opus-5-5';

const IMAGE_MEDIA_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };

// Oldest first, so the timeline reads in order. Past the limit, half from
// the start of the visit and half from the end: the before and after
// photos matter more than the middle.
function choosePhotos(photos) {
  if (photos.length <= MAX_DETAILED_PHOTOS) return photos;
  const half = Math.floor(MAX_DETAILED_PHOTOS / 2);
  return [...photos.slice(0, MAX_DETAILED_PHOTOS - half), ...photos.slice(-half)];
}

export async function generateDetailedReport({ sb, jobId, notes, photoCheckText = '', apiKey = process.env.ANTHROPIC_API_KEY }) {
  const { data: job, error: jobError } = await sb
    .from('jobs')
    .select('id, scheduled_at, property_id, properties(address), job_assignments(profiles(full_name))')
    .eq('id', jobId)
    .single();
  if (jobError || !job) throw new Error('job_not_found');

  const [{ data: tasks }, { data: photoRows }, { data: checkins }, { data: checklistItems }] = await Promise.all([
    sb.from('tasks').select('description, completed').eq('job_id', jobId),
    sb.from('photos').select('id, url, created_at').eq('job_id', jobId).order('created_at', { ascending: true }),
    sb.from('checkins').select('checked_in_at, checked_out_at').eq('job_id', jobId),
    job.property_id
      ? sb.from('property_checklist_items').select('room, sort_order').eq('property_id', job.property_id).order('sort_order', { ascending: true })
      : Promise.resolve({ data: [] }),
  ]);

  // The report points at photos by their number in this list, so ids, times
  // and image blocks are kept in step.
  const sent = [];
  const imageBlocks = [];
  for (const photo of choosePhotos(photoRows || [])) {
    const { data: file } = await sb.storage.from('job-photos').download(photo.url);
    if (!file) continue;
    const ext = photo.url.split('.').pop().toLowerCase();
    const buffer = Buffer.from(await file.arrayBuffer());
    sent.push(photo);
    imageBlocks.push({ type: 'image', source: { type: 'base64', media_type: IMAGE_MEDIA_TYPES[ext] || 'image/jpeg', data: buffer.toString('base64') } });
  }

  const prompt = buildDetailedPrompt({
    address: shortAddress(job.properties?.address) || 'Unknown address',
    date: new Date(job.scheduled_at).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' }),
    staff: (job.job_assignments || []).map((a) => a.profiles?.full_name).filter(Boolean),
    timeline: photoTimeline(sent, checkins),
    taskList: (tasks || []).map((t) => `- [${t.completed ? 'x' : ' '}] ${t.description}`).join('\n') || '(no to-do list on this visit)',
    notes,
    rooms: checklistRooms(checklistItems),
    photoCount: sent.length,
    photoCheckText,
  });

  const client = new Anthropic({ apiKey });
  // fallbacks: "default" - if a safety check declines the request, the API
  // re-runs it on its recommended fallback model rather than failing.
  const message = await client.beta.messages.create({
    model: DETAILED_REPORT_MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: DETAILED_REPORT_SCHEMA } },
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, ...imageBlocks] }],
  });

  if (message.stop_reason === 'refusal') throw new Error('The report request was declined.');
  if (message.stop_reason === 'max_tokens') throw new Error('The report was cut off before it finished.');
  const text = message.content.find((b) => b.type === 'text')?.text;
  if (!text) throw new Error('No report came back.');

  const parsed = parseDetailedReport(JSON.parse(text), sent.map((p) => p.id));
  return {
    summary: parsed.summary || null,
    issues: parsed.landlord || null,
    suggestions: parsed.housekeeping || null,
    rooms: parsed.rooms,
  };
}
