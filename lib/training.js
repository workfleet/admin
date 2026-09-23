// Training sessions on the rota.
//
// A training session is a job with kind = 'training' (0115) rather than a
// second kind of thing the rota has to draw. What it does not have is a
// property, so every screen that reads a job for "where is this and whose
// is it" needs one answer for training and one for a clean. These are
// those answers, in one place, because the week grid, the by-cleaner
// sheet, the cleaner's rota and the job page all ask the same questions
// and must not drift into giving different ones.

export function isTraining(job) {
  return job?.kind === 'training';
}

// The line a block leads with: the client's address for a clean, what the
// training is for a training. Never empty - a block with no words on it is
// worse than one naming a job whose address has gone missing.
export function jobHeadline(job) {
  if (isTraining(job)) return job.training_title?.trim() || 'Training';
  return job?.properties?.address || 'No address';
}

// Who the work is for. A clean belongs to a client; a training belongs to
// nobody, and saying so is better than borrowing a client's name for it.
export function jobSubtitle(job) {
  if (isTraining(job)) return job.training_location?.trim() || '';
  return job?.properties?.clients?.name || '';
}

// "Training" as a word the office scans for on a busy week. Clean jobs get
// no tag, because a rota of cleans that all say "Clean" says nothing.
export function jobTag(job) {
  return isTraining(job) ? 'Training' : null;
}

// The one-line "who is running this", for the modal and the cleaner's
// view. Null when nobody was named, so the caller can drop the row rather
// than print a label with nothing after it.
export function trainerLine(job) {
  if (!isTraining(job)) return null;
  const trainer = job.training_trainer?.trim();
  return trainer ? `Run by ${trainer}` : null;
}

// What the office is promised when it names a certificate on the session:
// said back to them on the form, so "this writes to their record" is
// visible before they book it rather than discovered afterwards.
export function certificationLine(job) {
  const name = job?.training_certification_name?.trim();
  if (!isTraining(job) || !name) return null;
  const expiry = job.training_certification_expiry;
  if (!expiry) return `Recorded as "${name}" for everyone who attends`;
  const when = new Date(`${expiry}T00:00:00`);
  if (Number.isNaN(when.getTime())) return `Recorded as "${name}" for everyone who attends`;
  return `Recorded as "${name}" for everyone who attends, expiring ${when.toLocaleDateString()}`;
}

// The fields a training job carries, for an insert. Kept next to the
// readers so a column added to one is obvious in the other, and so the
// constraint in 0115 - training text only on training jobs - is satisfied
// by construction rather than by remembering.
export function trainingJobFields({ title, location, trainer, certificationName, certificationExpiry }) {
  const cert = certificationName?.trim() || null;
  return {
    kind: 'training',
    property_id: null,
    training_title: title?.trim() || null,
    training_location: location?.trim() || null,
    training_trainer: trainer?.trim() || null,
    training_certification_name: cert,
    // An expiry with no certificate to hang it on is a date nobody will
    // ever read, and 0115 would reject it on a clean job anyway.
    training_certification_expiry: cert ? certificationExpiry || null : null,
  };
}

// The columns every job read needs now that jobs come in two kinds. Kept
// as a string so the select lists that already exist can append it rather
// than each growing their own spelling of the same six columns.
export const TRAINING_JOB_COLUMNS =
  'kind, training_title, training_location, training_trainer, training_certification_name, training_certification_expiry';
