#!/usr/bin/env node
// Uploads the how-to videos into the training hub in one go, instead of
// eight trips through Admin -> Training.
//
// Usage:
//   node scripts/upload-training-videos.js ./videos            # dry run
//   node scripts/upload-training-videos.js ./videos --upload   # do it
//
// A dry run is the default on purpose: this writes to the live project and
// replaces whatever a slot is currently pointing at, so the mapping from
// file to slot gets shown and checked before anything moves.
//
// Files are matched to slots by the number they start with, which is the
// number the video carries on the cleaner's screen:
//
//   1-install.mp4  ->  slot 1, "Install the app"
//   02 find your jobs.mp4  ->  slot 2, "Find your jobs"
//
// A file with no leading number is matched on its name against the slot
// titles instead, and skipped if that is ambiguous.
//
// Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from
// .env.local. The service role key bypasses RLS - that is what lets this
// run without anybody logging in, and the reason not to paste this script
// anywhere it might run against a project you did not mean.

// Note on exits: this sets process.exitCode and returns rather than
// calling process.exit(). Killing the process outright while the Supabase
// client still has keep-alive sockets open trips a libuv assertion on
// Windows ("UV_HANDLE_CLOSING") and reports exit 127, which looks like a
// crash rather than the clean "nothing uploaded" this actually is.
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

function loadEnvLocal() {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
  }
}
loadEnvLocal();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const CONTENT_TYPES = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/x-m4v',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
};

// ---------------------------------------------------------------------------
// Duration, read straight out of the file
//
// The admin page gets this from a <video> element, which Node has not got.
// MP4 and MOV are both ISO base media files, so the length is in the mvhd
// box as a duration over a timescale - about thirty lines to read, against
// a dependency on ffprobe being installed. Anything it cannot parse comes
// back null, which is a blank duration label rather than a failed upload.
// ---------------------------------------------------------------------------

function findBox(buf, type, start, end) {
  let offset = start;
  while (offset + 8 <= end) {
    let size = buf.readUInt32BE(offset);
    const boxType = buf.toString('latin1', offset + 4, offset + 8);
    let headerSize = 8;

    if (size === 1) {
      if (offset + 16 > end) return null;
      size = Number(buf.readBigUInt64BE(offset + 8));
      headerSize = 16;
    } else if (size === 0) {
      size = end - offset; // box runs to the end of its parent
    }

    if (size < headerSize || offset + size > end) return null;
    if (boxType === type) return { start: offset + headerSize, end: offset + size };
    offset += size;
  }
  return null;
}

function readDurationSeconds(buf) {
  try {
    const moov = findBox(buf, 'moov', 0, buf.length);
    if (!moov) return null;
    const mvhd = findBox(buf, 'mvhd', moov.start, moov.end);
    if (!mvhd) return null;

    const version = buf[mvhd.start];
    let timescale;
    let duration;

    if (version === 1) {
      // version+flags(4) creation(8) modification(8) timescale(4) duration(8)
      timescale = buf.readUInt32BE(mvhd.start + 20);
      duration = Number(buf.readBigUInt64BE(mvhd.start + 24));
    } else {
      // version+flags(4) creation(4) modification(4) timescale(4) duration(4)
      timescale = buf.readUInt32BE(mvhd.start + 12);
      duration = buf.readUInt32BE(mvhd.start + 16);
    }

    if (!timescale || !duration) return null;
    return Math.round(duration / timescale);
  } catch {
    return null;
  }
}

function formatDuration(seconds) {
  if (seconds === null) return '?:??';
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Matching files to slots
// ---------------------------------------------------------------------------

const normalise = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function matchToSlot(fileName, slots) {
  const base = path.basename(fileName, path.extname(fileName));

  // Not \b after the digits: an underscore is a word character, so "8_help"
  // has no boundary after the 8 and the number would be missed entirely.
  // A negative lookahead instead, which also stops "2026-08-19" being read
  // as slot 20.
  const leadingNumber = base.match(/^\s*(\d{1,2})(?!\d)/);
  if (leadingNumber) {
    const position = parseInt(leadingNumber[1], 10);
    const slot = slots.find((s) => s.position === position);
    return slot
      ? { slot, how: `number ${position}` }
      : { slot: null, how: `no slot at position ${position}` };
  }

  // No number to go on, so fall back to the title. Only accepted when
  // exactly one slot matches - two candidates means guessing, and guessing
  // puts the wrong video in front of somebody.
  const name = normalise(base);
  const hits = slots.filter((s) => {
    const title = normalise(s.title);
    return name.includes(title) || title.includes(name);
  });

  if (hits.length === 1) return { slot: hits[0], how: `title "${hits[0].title}"` };
  if (hits.length > 1) return { slot: null, how: 'matches more than one slot' };
  return { slot: null, how: 'no leading number and no title match' };
}

// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const commit = args.includes('--upload');
  const folder = args.find((a) => !a.startsWith('--'));

  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local');
    { process.exitCode = 1; return; }
  }
  if (!folder) {
    console.error('Usage: node scripts/upload-training-videos.js <folder> [--upload]');
    { process.exitCode = 1; return; }
  }
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
    console.error(`Not a folder: ${folder}`);
    { process.exitCode = 1; return; }
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: slots, error } = await supabase
    .from('training_videos')
    .select('id, title, position, storage_path')
    .order('position');

  if (error) {
    console.error(`Could not read training_videos: ${error.message}`);
    console.error('If this says the table does not exist, apply supabase/migrations/0077_training_videos.sql first.');
    { process.exitCode = 1; return; }
  }
  if (!slots || slots.length === 0) {
    console.error('No training video slots exist. Apply 0077_training_videos.sql, which seeds them.');
    { process.exitCode = 1; return; }
  }

  const files = fs
    .readdirSync(folder)
    .filter((f) => CONTENT_TYPES[path.extname(f).toLowerCase()])
    .sort();

  if (files.length === 0) {
    console.error(`No video files in ${folder} (looking for ${Object.keys(CONTENT_TYPES).join(', ')}).`);
    { process.exitCode = 1; return; }
  }

  console.log(`${commit ? 'Uploading' : 'Dry run'} - ${files.length} file(s) against ${slots.length} slot(s)\n`);

  const planned = [];
  const skipped = [];
  const claimed = new Set();

  for (const file of files) {
    const { slot, how } = matchToSlot(file, slots);
    if (!slot) { skipped.push({ file, why: how }); continue; }
    if (claimed.has(slot.id)) { skipped.push({ file, why: `slot ${slot.position} already taken by another file` }); continue; }
    claimed.add(slot.id);
    planned.push({ file, slot, how });
  }

  for (const { file, slot, how } of planned) {
    const full = path.join(folder, file);
    const size = fs.statSync(full).size;
    const replacing = slot.storage_path ? ' (replaces existing)' : '';
    console.log(`  ${slot.position}. ${slot.title}`);
    console.log(`     <- ${file}  ${formatBytes(size)}  matched on ${how}${replacing}`);
  }

  for (const { file, why } of skipped) {
    console.log(`  -- skipped ${file}: ${why}`);
  }

  const untouched = slots.filter((s) => !claimed.has(s.id));
  if (untouched.length > 0) {
    console.log(`\n  Slots with no file in this folder: ${untouched.map((s) => s.position).join(', ')}`);
  }

  if (!commit) {
    console.log('\nDry run only - nothing uploaded. Re-run with --upload to apply.');
    return;
  }

  console.log('');
  let uploaded = 0;

  for (const { file, slot } of planned) {
    const full = path.join(folder, file);
    const buffer = fs.readFileSync(full);
    const extension = path.extname(file).toLowerCase();
    const duration = readDurationSeconds(buffer);
    const storagePath = `${slot.id}/${Date.now()}-${file.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`;

    const { error: uploadError } = await supabase.storage
      .from('training-videos')
      .upload(storagePath, buffer, { contentType: CONTENT_TYPES[extension] });

    if (uploadError) {
      console.error(`  FAILED ${file}: ${uploadError.message}`);
      continue;
    }

    const previousPath = slot.storage_path;
    const { error: updateError } = await supabase
      .from('training_videos')
      .update({
        storage_path: storagePath,
        file_name: file,
        file_size: buffer.length,
        duration_seconds: duration,
      })
      .eq('id', slot.id);

    if (updateError) {
      // The row still points at the old file, so the slot is not broken -
      // but the object just uploaded is now orphaned, so take it back out.
      await supabase.storage.from('training-videos').remove([storagePath]);
      console.error(`  FAILED ${file}: uploaded but could not save (${updateError.message}) - rolled back`);
      continue;
    }

    // Only once the row points at the new file, so a failure above leaves
    // the old video still playing rather than leaving the slot empty.
    if (previousPath) await supabase.storage.from('training-videos').remove([previousPath]);

    uploaded += 1;
    console.log(`  ${slot.position}. ${slot.title} - live (${formatDuration(duration)}${duration === null ? ', duration unreadable' : ''})`);
  }

  console.log(`\n${uploaded} of ${planned.length} uploaded.`);
  if (uploaded < planned.length) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

module.exports = { readDurationSeconds, matchToSlot, formatDuration };
