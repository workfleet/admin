// Server-only helpers for the AI routes (/api/ai/draft, /api/projects/ai):
// who may call them, the company's details, real facts about a client, and
// reading a file from storage into a message block.
import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from './supabaseAdmin';
import { companyFromSettings } from './companyBranding';
import { averageRating } from './aiDrafting';
import { factsMap } from './companyFacts';
import { readableKind, unreadableReason, contentBlockFor, MAX_FILE_BYTES } from './projectAi';
import { officeToText } from './officeText';

export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

// Admins and supervisors who are still active.
export async function requireOffice(request) {
  const token = (request.headers.get('authorization') || '').replace('Bearer ', '');
  if (!token) return null;
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return null;
  const { data: profile } = await supabaseAdmin.from('profiles').select('role, active').eq('id', user.id).single();
  if (!profile || profile.active === false) return null;
  if (profile.role !== 'admin' && profile.role !== 'supervisor') return null;
  // Which office role, for the few things only admins may do.
  return { ...user, officeRole: profile.role };
}

export function fail(error, message, status = 400) {
  return NextResponse.json({ error, message }, { status });
}

export async function loadCompany() {
  const { data } = await supabaseAdmin.from('company_settings').select('*').limit(1).maybeSingle();
  return companyFromSettings(data);
}

// The Company facts page (0140) as { key: value }. Empty if the table
// isn't there yet - drafting still works, just with more blanks.
export async function loadFacts() {
  const { data, error } = await supabaseAdmin.from('company_facts').select('key, value');
  return error ? {} : factsMap(data);
}

export function londonToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
}

// Name, contact, site addresses, visit counts (90 days) and ratings
// (12 months). Never access details or notes - they can hold door codes.
export async function loadClientFacts(clientId) {
  if (!clientId) return null;
  const { data: client } = await supabaseAdmin.from('clients').select('id, name, contact_name, industry').eq('id', clientId).maybeSingle();
  if (!client) return null;
  const { data: properties } = await supabaseAdmin.from('properties').select('id, address').eq('client_id', clientId).order('address');
  const ids = (properties || []).map((p) => p.id);

  let visits = null;
  if (ids.length) {
    const since = new Date(Date.now() - 90 * 86400000).toISOString();
    const now = new Date().toISOString();
    const base = () => supabaseAdmin.from('jobs').select('id', { count: 'exact', head: true }).in('property_id', ids).gte('scheduled_at', since).lte('scheduled_at', now);
    const [total, completed, missed] = await Promise.all([base(), base().eq('status', 'completed'), base().eq('status', 'missed')]);
    visits = { total: total.count || 0, completed: completed.count || 0, missed: missed.count || 0 };
  }

  const yearAgo = new Date(Date.now() - 365 * 86400000).toISOString();
  const { data: ratingRows } = await supabaseAdmin.from('job_ratings').select('rating').eq('client_id', clientId).gte('created_at', yearAgo).limit(500);

  return { client, properties: properties || [], visits, ratings: averageRating(ratingRows) };
}

async function downloadBlock(bucket, storagePath, fileName, fileSize) {
  if (!readableKind(fileName)) return { error: `${fileName}: ${unreadableReason(fileName)}` };
  if (fileSize && fileSize > MAX_FILE_BYTES) return { error: `${fileName} is too big to read (over 20 MB).` };
  const { data: blob, error } = await supabaseAdmin.storage.from(bucket).download(storagePath);
  if (error || !blob) return { error: `Couldn't open ${fileName}.` };
  const buffer = Buffer.from(await blob.arrayBuffer());
  const kind = readableKind(fileName);
  if (kind === 'word' || kind === 'excel') {
    let text;
    try { text = await officeToText(kind, buffer); } catch { return { error: `${fileName} couldn't be opened - it may be damaged or password-protected. Try saving it again, or as a PDF.` }; }
    if (!text.trim()) return { error: `${fileName} has no text in it that can be read.` };
    return { block: contentBlockFor(fileName, buffer, text), name: fileName };
  }
  return { block: contentBlockFor(fileName, buffer), name: fileName };
}

export async function loadProjectFile(projectId, fileId) {
  const { data: row } = await supabaseAdmin
    .from('project_files').select('file_name, storage_path, file_size').eq('id', fileId).eq('project_id', projectId).maybeSingle();
  if (!row) return { error: 'That file is no longer on this project.' };
  return downloadBlock('project-files', row.storage_path, row.file_name, row.file_size);
}

// A file from the Documents library (policies, contracts...).
export async function loadLibraryFile(documentId) {
  const { data: row } = await supabaseAdmin
    .from('company_documents').select('file_name, storage_path, file_size').eq('id', documentId).maybeSingle();
  if (!row) return { error: 'That document is no longer in the library.' };
  return downloadBlock('company-documents', row.storage_path, row.file_name, row.file_size);
}

export function anthropicClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

export function textOf(message) {
  return message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
}

// The same plain-English errors for every AI route.
export function aiErrorResponse(err) {
  if (err instanceof Anthropic.RateLimitError) return fail('busy', 'The AI is busy right now. Please try again in a minute.', 503);
  if (err instanceof Anthropic.BadRequestError) return fail('rejected', `The AI couldn't take this request: ${err.message}`, 422);
  if (err instanceof Anthropic.APIConnectionError) return fail('timeout', 'The AI took too long or couldn\'t be reached. Please try again.', 504);
  if (err instanceof Anthropic.APIError) return fail('ai_error', 'The AI had a problem. Please try again.', 502);
  return fail('error', 'Something went wrong. Please try again.', 500);
}
