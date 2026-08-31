'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { ChevronLeft, Camera, Lock, Check, ChevronDown } from 'lucide-react';
import { supabase } from '../../../../lib/supabaseClient';
import { getSessionWithRetry } from '../../../../lib/authGate';
import { notify } from '../../../../lib/notify';
import { distanceMeters, GEOFENCE_RADIUS_METERS } from '../../../../lib/geo';
import {
  INSIDE_PERSIST_INTERVAL_MS,
  autoCheckoutTimestamp,
  classifyFix,
  closeCheckin,
  markSeenInside,
  nextDepartureState,
  shouldAutoCheckOut,
  withinAutoCheckoutGrace,
} from '../../../../lib/autoCheckout';
import {
  claimWindowError,
  defaultClaimWindow,
  isClaimableMissedJob,
} from '../../../../lib/missedClockin';
import { useConfirm } from '../../../components/ConfirmProvider';
import { useToast } from '../../../components/ToastProvider';

// Leaflet touches `window` at load time, so it can't run during SSR.
const PropertyMap = dynamic(() => import('../../../components/PropertyMap'), { ssr: false });

function clock(value) {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatSpan(totalMinutes) {
  const mins = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

// <input type="time"> wants "HH:MM" in the phone's own timezone, which is
// also the timezone the cleaner read the shift time off the rota in.
function timeValue(date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

// A time typed against the day the job was booked for. A finish earlier in
// the clock than the start is a shift that ran past midnight, not a typo -
// commercial work does that - so it rolls onto the next day rather than
// being rejected.
function dateAtTime(baseDate, value, { rollPastMidnightFrom } = {}) {
  const [hours, minutes] = (value || '').split(':').map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  const result = new Date(baseDate);
  result.setHours(hours, minutes, 0, 0);
  if (rollPastMidnightFrom && result <= rollPastMidnightFrom) result.setDate(result.getDate() + 1);
  return result;
}

const EXTENSION_PILL = {
  approved: 'wf-pill-verified',
  declined: 'wf-pill-overdue',
};

export default function JobDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const [job, setJob] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [checkin, setCheckin] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [userId, setUserId] = useState(null);
  const [extensionRequests, setExtensionRequests] = useState([]);
  const [showExtensionForm, setShowExtensionForm] = useState(false);
  const [requestMinutes, setRequestMinutes] = useState('');
  const [requestReason, setRequestReason] = useState('');
  const [submittingExtension, setSubmittingExtension] = useState(false);
  const [checkInError, setCheckInError] = useState('');
  const [checkingIn, setCheckingIn] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [checklistItems, setChecklistItems] = useState([]);
  const [showChecklist, setShowChecklist] = useState(false);
  const [coverOffer, setCoverOffer] = useState(null);
  const [showCoverForm, setShowCoverForm] = useState(false);
  const [coverReason, setCoverReason] = useState('');
  const [submittingCover, setSubmittingCover] = useState(false);
  const [nextJob, setNextJob] = useState(null);
  // Putting right a shift they worked but never clocked into. See
  // lib/missedClockin.js and migration 0076 for why this exists at all.
  const [claim, setClaim] = useState(null);
  const [showClaimForm, setShowClaimForm] = useState(false);
  const [claimFrom, setClaimFrom] = useState('');
  const [claimTo, setClaimTo] = useState('');
  const [claimReason, setClaimReason] = useState('');
  const [claimError, setClaimError] = useState('');
  const [submittingClaim, setSubmittingClaim] = useState(false);
  // Starts null so the server and the first client render agree - the
  // on-site timer only starts once we're on the client.
  const [now, setNow] = useState(null);

  useEffect(() => {
    loadJob();
  }, [id]);

  // The status strip counts up while someone is on site, so it needs its own
  // clock. Every 30s is enough for a figure shown to the minute.
  useEffect(() => {
    setNow(new Date());
    const tick = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(tick);
  }, []);

  // Read inside the auto check-out path, which runs from a watch set up
  // several renders earlier and would otherwise close over a stale count.
  const photoCountRef = useRef(0);
  photoCountRef.current = photos.length;

  // Auto check-out. While this page is open on a job they're checked into,
  // watch where they are and close the shift once they've actually left.
  //
  // This only covers the case where the app is still awake as they walk
  // out - the web has no background geofencing, and a pocketed phone stops
  // reporting within seconds of locking. Someone who locks their phone and
  // drives off is caught instead by AutoCheckoutWatcher, next time they
  // open the app. See lib/autoCheckout.js.
  useEffect(() => {
    const property = job?.properties;
    if (!checkin || checkin.checked_out_at) return;
    if (property?.lat == null || property?.lng == null) return;
    if (!navigator.geolocation) return;

    let state = { lastInsideAt: null, outsideSince: null };
    let lastPersistedInside = 0;
    let finished = false;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (finished) return;
        const now = new Date();
        const where = classifyFix(
          { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy },
          property
        );
        state = nextDepartureState(state, where, now);

        // Persisted as they work, so if this page dies the catch-up pass
        // still knows roughly how long they were on site.
        if (where === 'inside' && now - lastPersistedInside > INSIDE_PERSIST_INTERVAL_MS) {
          lastPersistedInside = now;
          markSeenInside(checkin.id, now.toISOString());
        }

        if (!shouldAutoCheckOut(state, checkin.checked_in_at, now)) return;
        finished = true;
        navigator.geolocation.clearWatch(watchId);
        autoCheckOut(state.lastInsideAt);
      },
      // A refused or failed fix just means no auto check-out - they check
      // out by hand as before, rather than being told something is wrong.
      () => {},
      { enableHighAccuracy: true, maximumAge: 30000, timeout: 30000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkin?.id, checkin?.checked_out_at, job?.properties?.lat, job?.properties?.lng]);

  const loadJob = async () => {
    const session = await getSessionWithRetry();
    if (!session) { router.push('/'); return; }
    setUserId(session.user.id);

    const { data: jobData } = await supabase
      .from('jobs')
      .select('id, scheduled_at, status, duration_minutes, property_id, properties(address, notes, client_access_notes, lat, lng, clients(name))')
      .eq('id', id)
      .single();

    const { data: checklistData } = jobData?.property_id
      ? await supabase
          .from('property_checklist_items')
          .select('id, room, task')
          .eq('property_id', jobData.property_id)
          .order('sort_order', { ascending: true })
      : { data: [] };

    const { data: extensionData } = await supabase
      .from('time_extension_requests')
      .select('*')
      .eq('job_id', id)
      .eq('cleaner_id', session.user.id)
      .order('created_at', { ascending: false });

    const { data: taskData } = await supabase
      .from('tasks')
      .select('*')
      .eq('job_id', id);

    const { data: photoData } = await supabase
      .from('photos')
      .select('*')
      .eq('job_id', id)
      .order('created_at', { ascending: false });

    const { data: checkinData } = await supabase
      .from('checkins')
      .select('*')
      .eq('job_id', id)
      .eq('cleaner_id', session.user.id)
      .maybeSingle();

    const { data: offerData } = await supabase
      .from('shift_offers')
      .select('id, status, released_by, created_at')
      .eq('job_id', id)
      .eq('status', 'open')
      .maybeSingle();

    // Newest first rather than maybeSingle: a declined claim doesn't block a
    // corrected one (0076's unique index only covers pending), so there can
    // legitimately be more than one and the latest is the one they're owed
    // an answer about.
    const { data: claimData } = await supabase
      .from('missed_clockin_claims')
      .select('*')
      .eq('job_id', id)
      .eq('cleaner_id', session.user.id)
      .order('created_at', { ascending: false })
      .limit(1);

    // What to send them to once this one is finished. Without it the end of
    // a job is a dead end and they go hunting through the rota for the next.
    const { data: nextData } = await supabase
      .from('job_assignments')
      .select('jobs!inner(id, scheduled_at, properties(address, clients(name)))')
      .eq('cleaner_id', session.user.id)
      .gt('jobs.scheduled_at', new Date().toISOString())
      .neq('jobs.id', id)
      .order('scheduled_at', { referencedTable: 'jobs', ascending: true })
      .limit(1);

    setJob(jobData);
    setTasks(taskData || []);
    setPhotos(await withSignedUrls(photoData || []));
    setCheckin(checkinData);
    setExtensionRequests(extensionData || []);
    setChecklistItems(checklistData || []);
    setCoverOffer(offerData || null);
    setNextJob(nextData?.[0]?.jobs || null);
    setClaim(claimData?.[0] || null);

    // Prefilled from the booked times, which is the right answer on nearly
    // every claim - they still have to look at it and can change it.
    if (jobData) {
      const { from, to } = defaultClaimWindow(jobData);
      setClaimFrom(timeValue(from));
      setClaimTo(timeValue(to));
    }
  };

  // photos.url stores the job-photos storage path (not a public URL) since
  // the bucket is private — every photo needs a freshly signed URL to view.
  const withSignedUrls = async (rows) =>
    Promise.all(
      rows.map(async (p) => {
        const { data } = await supabase.storage.from('job-photos').createSignedUrl(p.url, 3600);
        return { ...p, signedUrl: data?.signedUrl };
      })
    );

  // Downscales + re-encodes as JPEG in the browser before upload, so
  // cleaners on mobile data aren't sending full-resolution photos.
  const compressImage = (file, maxDimension = 1600, quality = 0.75) =>
    new Promise((resolve) => {
      if (!file.type.startsWith('image/')) return resolve(file);
      const img = new Image();
      const reader = new FileReader();
      reader.onload = (e) => {
        img.onload = () => {
          let { width, height } = img;
          if (width > maxDimension || height > maxDimension) {
            const scale = maxDimension / Math.max(width, height);
            width = Math.round(width * scale);
            height = Math.round(height * scale);
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          canvas.getContext('2d').drawImage(img, 0, 0, width, height);
          canvas.toBlob(
            (blob) => resolve(blob ? new File([blob], file.name, { type: 'image/jpeg' }) : file),
            'image/jpeg',
            quality
          );
        };
        img.onerror = () => resolve(file);
        img.src = e.target.result;
      };
      reader.onerror = () => resolve(file);
      reader.readAsDataURL(file);
    });

  const getLocation = () =>
    new Promise((resolve) => {
      if (!navigator.geolocation) return resolve({ lat: null, lng: null });
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => resolve({ lat: null, lng: null })
      );
    });

  // jobs.status is no longer set from here - with multiple cleaners
  // possibly assigned to the same job, a database trigger derives it from
  // everyone's check-in state (in_progress once anyone's checked in,
  // completed only once everyone has checked out), so it's re-read after
  // each check-in/out rather than guessed at client-side.
  const handleCheckIn = async () => {
    setCheckInError('');
    setCheckingIn(true);
    const { lat, lng } = await getLocation();

    // Only enforce the geofence when both the property and this check-in
    // have real coordinates - properties added before geolocation existed
    // (or a check-in with GPS unavailable) fall back to the old
    // no-verification behaviour rather than blocking someone from working.
    const propertyLat = job.properties?.lat;
    const propertyLng = job.properties?.lng;
    if (propertyLat != null && propertyLng != null && lat != null && lng != null) {
      const distance = distanceMeters(lat, lng, propertyLat, propertyLng);
      if (distance > GEOFENCE_RADIUS_METERS) {
        setCheckInError(`You're too far from this property to check in (about ${Math.round(distance)}m away). Move closer and try again.`);
        setCheckingIn(false);
        return;
      }
    }

    const { data, error } = await supabase
      .from('checkins')
      .insert({ job_id: id, cleaner_id: userId, checked_in_at: new Date().toISOString(), lat, lng })
      .select()
      .single();

    setCheckingIn(false);
    if (!error) {
      setCheckin(data);
      const { data: jobRow } = await supabase.from('jobs').select('status').eq('id', id).single();
      if (jobRow) setJob((j) => ({ ...j, status: jobRow.status }));
    }
  };

  const handleCheckOut = async () => {
    if (photos.length === 0) {
      const proceed = await confirm(
        "You haven't added any photos for this job. Once you check out you won't be able to add any later. Check out anyway?",
        { title: 'No photos added', danger: true, confirmLabel: 'Check out anyway' }
      );
      if (!proceed) return;
    }

    setCheckingOut(true);
    const { error } = await supabase
      .from('checkins')
      .update({ checked_out_at: new Date().toISOString() })
      .eq('id', checkin.id);

    setCheckingOut(false);
    if (error) { toast.error('Could not check out. Please try again.'); return; }

    const { data: jobRow } = await supabase.from('jobs').select('status').eq('id', id).single();
    if (jobRow) setJob((j) => ({ ...j, status: jobRow.status }));
    setCheckin((c) => ({ ...c, checked_out_at: new Date().toISOString() }));
    toast.success('Checked out.');
  };

  // Walking back in after the app decided they'd gone. Only ever offered
  // for its own guesses - a cleaner who pressed Check Out made a decision,
  // and that stands. resume_auto_checkout() re-checks all of this server
  // side, since reopening the job means writing to a table cleaners can't.
  const handleResume = async () => {
    setCheckInError('');
    setResuming(true);
    const { lat, lng } = await getLocation();

    // Deliberately the same test as checking in, fallback included: with
    // no property coordinates or no fix, it just goes through. Getting
    // back to where you already were shouldn't be harder than arriving.
    const propertyLat = job.properties?.lat;
    const propertyLng = job.properties?.lng;
    if (propertyLat != null && propertyLng != null && lat != null && lng != null) {
      const distance = distanceMeters(lat, lng, propertyLat, propertyLng);
      if (distance > GEOFENCE_RADIUS_METERS) {
        setCheckInError(`You're too far from this property to check back in (about ${Math.round(distance)}m away). Move closer and try again.`);
        setResuming(false);
        return;
      }
    }

    const { data: outcome, error } = await supabase.rpc('resume_auto_checkout', { target_checkin_id: checkin.id });
    setResuming(false);

    if (error || (outcome !== 'ok' && outcome !== 'already_open')) {
      // 'expired' is the one a cleaner can actually act on - it means the
      // shift has settled and the office has to reopen it. The rest are
      // states they can't have caused and can't fix from here.
      toast.error(
        outcome === 'expired'
          ? "It's been too long since you were checked out to undo it - tell the office and they'll sort the hours."
          : "Couldn't check you back in. Please try again."
      );
      await loadJob();
      return;
    }

    await loadJob();
    toast.success('Checked back in - carry on where you left off.');
  };

  // Telling the office they worked a shift the app has written off. This
  // pays nothing on its own - an admin has to approve it (0076) - so it
  // deliberately promises no more than "we've asked".
  const handleSubmitClaim = async () => {
    setClaimError('');

    const base = new Date(job.scheduled_at);
    const from = dateAtTime(base, claimFrom);
    const to = dateAtTime(base, claimTo, { rollPastMidnightFrom: from });
    const problem = claimWindowError({ from, to });
    if (problem) { setClaimError(problem); return; }

    setSubmittingClaim(true);
    const { data, error } = await supabase
      .from('missed_clockin_claims')
      .insert({
        job_id: id,
        cleaner_id: userId,
        worked_from: from.toISOString(),
        worked_to: to.toISOString(),
        reason: claimReason.trim() || null,
      })
      .select()
      .single();
    setSubmittingClaim(false);

    if (error) {
      // The insert policy is the only thing that knows whether this job is
      // still claimable, so a refusal here usually means it stopped being
      // one while the form was open - somebody else on the job clocked in,
      // or an admin fixed it. Reloading shows them the state that won.
      setClaimError("Couldn't send that to the office. Pull down to refresh and try again.");
      await loadJob();
      return;
    }

    setClaim(data);
    setShowClaimForm(false);

    // The trigger in 0076 already puts this in the admin notification feed.
    // This is the push and the email on top, because the feed only helps
    // somebody who opens the app, and an unapproved claim quietly turns into
    // an unpaid shift the moment payroll runs.
    const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', userId).single();
    notify({
      type: 'missed_clockin_claimed',
      jobId: id,
      cleanerName: profile?.full_name || 'A cleaner',
      address: job.properties?.address,
      scheduledAt: job.scheduled_at,
      reason: claimReason.trim() || null,
    });

    setClaimReason('');
    toast.success("Sent to the office - they'll confirm your hours.");
  };

  // The automatic path skips the "no photos yet?" confirm that guards the
  // manual button - there's nobody watching the screen to answer it. They
  // get told afterwards instead, and told about the photos specifically,
  // because that's the part of checking out they can't undo.
  const autoCheckOut = async (observedDepartureAt) => {
    const at = autoCheckoutTimestamp({ observedDepartureAt, checkin, job, now: new Date() });
    const { closed } = await closeCheckin(checkin.id, at);
    if (!closed) return; // they beat us to it by hand, or it failed - leave their time alone

    setCheckin((c) => ({ ...c, checked_out_at: at, auto_checked_out: true, auto_checked_out_at: new Date().toISOString() }));
    const { data: jobRow } = await supabase.from('jobs').select('status').eq('id', id).single();
    if (jobRow) setJob((j) => ({ ...j, status: jobRow.status }));

    const time = new Date(at).toLocaleTimeString();
    toast.success(
      photoCountRef.current === 0
        ? `Checked out at ${time} - you've left the property. No photos were added and the job is now closed.`
        : `Checked out at ${time} - you've left the property.`
    );
  };

  const submitExtensionRequest = async (e) => {
    e.preventDefault();
    const minutes = Number(requestMinutes);
    if (!minutes || minutes <= 0) return;
    setSubmittingExtension(true);

    const { data, error } = await supabase
      .from('time_extension_requests')
      .insert({
        job_id: id,
        cleaner_id: userId,
        requested_minutes: minutes,
        reason: requestReason.trim() || null,
      })
      .select('*')
      .single();

    setSubmittingExtension(false);
    if (error || !data) return;

    setExtensionRequests((prev) => [data, ...prev]);
    setShowExtensionForm(false);
    setRequestMinutes('');
    setRequestReason('');

    const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', userId).single();
    notify({
      type: 'time_extension_requested',
      cleanerName: profile?.full_name || 'A cleaner',
      address: job.properties?.address,
      requestedMinutes: minutes,
      reason: requestReason.trim() || null,
    });
  };

  // Releasing a shift for cover does NOT unassign this cleaner - they
  // stay on it until someone actually claims it, so an unfilled request
  // can never leave the client with nobody booked in. See 0070.
  const requestCover = async (e) => {
    e.preventDefault();
    const confirmed = await confirm(
      "Ask for cover on this shift? It stays yours until someone else picks it up, and the office will be told straight away.",
      { title: "Can't make this shift" }
    );
    if (!confirmed) return;

    setSubmittingCover(true);
    const { data, error } = await supabase
      .from('shift_offers')
      .insert({
        job_id: id,
        released_by: userId,
        opened_by: userId,
        reason: coverReason.trim() || null,
      })
      .select('id, status, released_by, created_at')
      .single();

    setSubmittingCover(false);
    if (error || !data) {
      toast.error("Couldn't send that - cover may already have been requested for this shift.");
      return;
    }

    setCoverOffer(data);
    setShowCoverForm(false);
    setCoverReason('');
    toast.success('Sent. Other cleaners can now pick this shift up.');

    const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', userId).single();
    notify({
      type: 'shift_cover_needed',
      cleanerName: profile?.full_name || 'A cleaner',
      releasedByCleanerId: userId,
      address: job.properties?.address,
      scheduledAt: job.scheduled_at,
      reason: coverReason.trim() || null,
    });
  };

  // Ticks straight away and puts the tick back if the save didn't land.
  // Waiting on the round trip on a doorstep with one bar of signal makes
  // the row feel broken; failing silently, as this used to, is worse -
  // the list says done and the office never hears about it.
  const toggleTask = async (task) => {
    const updated = {
      completed: !task.completed,
      completed_at: !task.completed ? new Date().toISOString() : null,
    };
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, ...updated } : t)));

    const { error } = await supabase.from('tasks').update(updated).eq('id', task.id);
    if (error) {
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, ...task } : t)));
      toast.error("Couldn't save that - check your signal and tap it again.");
    }
  };

  const handlePhotoUpload = async (e) => {
    const rawFile = e.target.files[0];
    if (!rawFile) return;
    setUploading(true);

    const file = await compressImage(rawFile);
    const fileName = `${id}/${Date.now()}-${rawFile.name.replace(/\.[^.]+$/, '.jpg')}`;
    const { error: uploadError } = await supabase.storage
      .from('job-photos')
      .upload(fileName, file, { contentType: 'image/jpeg' });

    if (uploadError) {
      setUploading(false);
      toast.error("Couldn't send that photo - check your signal and try again.");
      return;
    }

    const { data: photoRow } = await supabase
      .from('photos')
      .insert({ job_id: id, uploaded_by: userId, url: fileName })
      .select()
      .single();

    const [withUrl] = await withSignedUrls([photoRow]);
    setPhotos((prev) => [withUrl, ...prev]);
    setUploading(false);
  };

  if (!job) return <div className="container">Loading...</div>;

  // A completed job is history, not something to keep editing - no
  // re-checking-in, no toggling tasks, no adding photos weeks later.
  // Also locks down once THIS cleaner has personally checked out, even if
  // the job as a whole is still in_progress because a teammate on the
  // same job hasn't checked out yet - their part is done either way.
  // A check-out normally makes the job read-only. An automatic one holds
  // that off for the grace window, so a wrong guess costs them nothing:
  // the shift is recorded as closed, but the photos and tasks they were
  // in the middle of are still there when they walk back in. Computed at
  // render, so the lock reappears on the next re-render after it lapses -
  // it's an affordance, not a security boundary (RLS is that).
  const resumable = withinAutoCheckoutGrace(checkin);
  const isHistory = (job.status === 'completed' || !!checkin?.checked_out_at) && !resumable;
  // The grace window renders as a variant of being on site rather than a
  // fourth state: the job is still workable, which is the entire point of
  // holding the lock off. Without the `resumable` limb here a cleaner in
  // the window matches none of the three states and gets an empty page.
  const onSite = !!checkin && (!checkin.checked_out_at || resumable) && !isHistory;
  const beforeCheckIn = !checkin && !isHistory;

  // A job whose time has run out with no check-in against it. Not a fourth
  // state - it's still beforeCheckIn, and Check In stays the primary action,
  // because turning up late is far commoner than forgetting entirely and a
  // real clock-in is always the better record. This only adds a second way
  // out for the cleaner who has already gone home. A pending claim hides the
  // offer: they've asked, and asking twice is not a thing to invite.
  // Gated on `now` rather than reading the clock inline: half of what makes
  // a job claimable is that its time has run out, which the server can't
  // agree with the client about. Same reason the on-site timer waits.
  const jobTimePassed = !!now && isClaimableMissedJob(job, now);
  const canClaimMissed = jobTimePassed
    && beforeCheckIn
    && claim?.status !== 'pending'
    && claim?.status !== 'approved';

  const placeName = job.properties?.clients?.name || job.properties?.address || 'This job';
  const scheduled = new Date(job.scheduled_at);
  const duration = job.duration_minutes || 120;
  const approvedExtra = extensionRequests
    .filter((r) => r.status === 'approved')
    .reduce((sum, r) => sum + (r.requested_minutes || 0), 0);

  const doneTasks = tasks.filter((t) => t.completed).length;
  const mapsHref = job.properties?.lat != null && job.properties?.lng != null
    ? `https://www.google.com/maps/dir/?api=1&destination=${job.properties.lat},${job.properties.lng}`
    : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(job.properties?.address || '')}`;

  // Minutes on site, and how much of the allowance is left. Both null until
  // the client clock has started.
  const onSiteMinutes = now && checkin ? (now - new Date(checkin.checked_in_at)) / 60000 : null;
  const remainingMinutes = onSiteMinutes === null ? null : duration + approvedExtra - onSiteMinutes;

  return (
    <div className="visit-screen">
      <div className="visit-appbar">
        <div className="visit-appbar-row">
          <button type="button" className="visit-appbar-back" onClick={() => router.back()} aria-label="Back">
            <ChevronLeft size={24} strokeWidth={2.5} />
          </button>
          <span className="visit-appbar-title">{placeName}</span>
        </div>

        {onSite && !resumable && (
          <div className="visit-status-strip">
            <span className="visit-status-dot" />
            <span className="visit-status-time">
              On site {onSiteMinutes === null ? '—' : formatSpan(onSiteMinutes)}
            </span>
            {remainingMinutes !== null && (
              <span className={`visit-status-left${remainingMinutes < 0 ? ' is-over' : ''}`}>
                {remainingMinutes < 0
                  ? `${formatSpan(-remainingMinutes)} over`
                  : `${formatSpan(remainingMinutes)} left`}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="visit-body">
        {/* ---- State 1: not checked in yet ---- */}
        {beforeCheckIn && (
          <>
            <div className="visit-title-block">
              <div className="visit-when">
                {clock(scheduled)} – {clock(new Date(scheduled.getTime() + duration * 60000))} · {formatSpan(duration)}
              </div>
              <h1 className="visit-place">{placeName}</h1>
              <p className="visit-address">{job.properties?.address}</p>
            </div>

            {job.properties?.lat != null && job.properties?.lng != null && (
              <div className="visit-map">
                <PropertyMap
                  lat={job.properties.lat}
                  lng={job.properties.lng}
                  address={job.properties.address}
                  showDirections={false}
                />
                <a className="visit-map-chip" href={mapsHref} target="_blank" rel="noreferrer">Directions</a>
              </div>
            )}

            {/* On a doorstep this is the most-needed thing on the screen, so
                it sits above the task list rather than below the map. */}
            {job.properties?.client_access_notes && (
              <div className="visit-card visit-access">
                <div className="visit-card-label">How to get in</div>
                <p className="visit-access-body">{job.properties.client_access_notes}</p>
              </div>
            )}

            {job.properties?.notes && (
              <div className="visit-card">
                <div className="visit-card-label">Notes for this property</div>
                <p className="visit-access-body">{job.properties.notes}</p>
              </div>
            )}

            {/* The full list is deliberately held back until check-in - it's
                a job to do on site, not a thing to read on the bus. */}
            <div className="visit-card">
              <div className="visit-card-label">
                {tasks.length} task{tasks.length === 1 ? '' : 's'} on this job
              </div>
              <p className="visit-task-preview">
                {tasks.length === 0
                  ? 'No tasks have been added to this job yet.'
                  : `${tasks.slice(0, 2).map((t) => t.description).join(', ')}${tasks.length > 2 ? ` and ${tasks.length - 2} more` : ''}. The full list opens when you check in.`}
              </p>
            </div>

            {coverOffer && (
              <div className="visit-card">
                <div className="visit-card-label">Cover requested</div>
                <p className="visit-task-preview">
                  This shift has been offered to the rest of the team. It's still yours until
                  someone picks it up - you'll be told as soon as they do.
                </p>
              </div>
            )}

            {showCoverForm && !coverOffer && (
              <form className="visit-card" onSubmit={requestCover}>
                <div className="visit-card-label">Why can't you make it? (optional)</div>
                <input
                  value={coverReason}
                  onChange={(e) => setCoverReason(e.target.value)}
                  placeholder="e.g. Off sick, childcare fell through"
                />
                <button type="submit" className="visit-btn-secondary" disabled={submittingCover}>
                  {submittingCover ? 'Sending...' : 'Request cover'}
                </button>
              </form>
            )}

            {/* Says out loud what the rota has quietly decided. Without this
                the only sign that a worked shift is about to go unpaid is a
                job that looks the same as any other and a total on the hours
                page that is short - which nobody spots until payday. */}
            {jobTimePassed && !claim && (
              <div className="visit-card">
                <div className="visit-card-label">Nobody clocked in</div>
                <p className="visit-task-preview">
                  This shift's booked time has passed with no clock-in against it, so it
                  won't count towards your hours or your holiday. If you worked it, tell
                  the office below and they'll put it right.
                </p>
              </div>
            )}

            {claim?.status === 'pending' && (
              <div className="visit-card">
                <div className="visit-card-label">With the office</div>
                <p className="visit-task-preview">
                  You've told the office you worked {clock(claim.worked_from)} – {clock(claim.worked_to)}
                  {' '}on this shift. It doesn't count towards your hours until they confirm it —
                  you'll get a notification either way.
                </p>
              </div>
            )}

            {claim?.status === 'declined' && (
              <div className="visit-card">
                <div className="visit-card-label">Not confirmed</div>
                <p className="visit-task-preview">
                  The office didn't confirm this shift{claim.admin_note ? ` — "${claim.admin_note}"` : '.'}
                  {' '}If that's not right, message them.
                </p>
              </div>
            )}

            {showClaimForm && canClaimMissed && (
              <div className="visit-card">
                <div className="visit-card-label">What did you actually work?</div>
                <p className="visit-task-preview">
                  Filled in from the booked times — change them if the day ran differently.
                  An admin has to confirm this before it counts.
                </p>
                <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                  <label style={{ flex: 1, fontSize: 13 }}>
                    Started
                    <input
                      type="time"
                      value={claimFrom}
                      onChange={(e) => setClaimFrom(e.target.value)}
                      style={{ width: '100%' }}
                    />
                  </label>
                  <label style={{ flex: 1, fontSize: 13 }}>
                    Finished
                    <input
                      type="time"
                      value={claimTo}
                      onChange={(e) => setClaimTo(e.target.value)}
                      style={{ width: '100%' }}
                    />
                  </label>
                </div>
                <input
                  value={claimReason}
                  onChange={(e) => setClaimReason(e.target.value)}
                  placeholder="What happened? (optional)"
                  style={{ marginTop: 10 }}
                />
                {claimError && <p className="visit-action-error">{claimError}</p>}
                <button
                  type="button"
                  className="visit-btn-secondary"
                  onClick={handleSubmitClaim}
                  disabled={submittingClaim}
                >
                  {submittingClaim ? 'Sending...' : 'Send to the office'}
                </button>
              </div>
            )}
          </>
        )}

        {/* ---- State 2: on site (and the auto check-out grace window) ---- */}
        {onSite && (
          <>
            {resumable && (
              <div className="visit-resume">
                <div className="visit-resume-text">
                  You were checked out automatically because you left the property. Still here?
                  Check back in and carry on - your photos and tasks are as you left them.
                </div>
                {checkInError && <p className="visit-action-error">{checkInError}</p>}
              </div>
            )}
            <div className="visit-progress">
              <div className="visit-progress-head">
                <span className="visit-progress-count">{doneTasks} of {tasks.length} done</span>
                <span className="visit-progress-hint">Tap to tick off</span>
              </div>
              <div className="visit-progress-track">
                <div
                  className="visit-progress-fill"
                  style={{ width: tasks.length ? `${(doneTasks / tasks.length) * 100}%` : '0%' }}
                />
              </div>
            </div>

            <div className="visit-card visit-card-flush">
              {tasks.length === 0 && <p className="visit-empty">No tasks added yet.</p>}
              {tasks.map((task) => (
                // The whole row is the hit target, not the circle - a 24px
                // circle is not something to aim at with cold hands.
                <button
                  type="button"
                  key={task.id}
                  className={`visit-task${task.completed ? ' is-done' : ''}`}
                  onClick={() => toggleTask(task)}
                >
                  <span className="visit-task-check">{task.completed && <Check size={14} strokeWidth={3} />}</span>
                  <span className="visit-task-text">{task.description}</span>
                </button>
              ))}
            </div>

            {extensionRequests.length > 0 && (
              <div className="visit-card">
                <div className="visit-card-label">Extra time</div>
                {extensionRequests.map((r) => (
                  <div key={r.id} className="visit-extension">
                    <div className="visit-extension-row">
                      <span className="visit-extension-text">
                        +{r.requested_minutes} min{r.reason ? ` — ${r.reason}` : ''}
                      </span>
                      <span className={`wf-pill ${EXTENSION_PILL[r.status] || 'wf-pill-progress'}`}>
                        {r.status === 'alternative_suggested' ? 'alternative suggested' : r.status}
                      </span>
                    </div>
                    {r.status === 'alternative_suggested' && r.suggested_scheduled_at && (
                      <div className="visit-extension-note">
                        Suggested: {new Date(r.suggested_scheduled_at).toLocaleString()}
                        {r.suggested_duration_minutes ? ` · ${r.suggested_duration_minutes} min` : ''}
                      </div>
                    )}
                    {r.admin_note && <div className="visit-extension-note">&ldquo;{r.admin_note}&rdquo;</div>}
                  </div>
                ))}
              </div>
            )}

            {showExtensionForm && (
              <form className="visit-card" onSubmit={submitExtensionRequest}>
                <div className="visit-card-label">How much longer do you need?</div>
                <label>Extra minutes</label>
                <input
                  type="number"
                  min="1"
                  value={requestMinutes}
                  onChange={(e) => setRequestMinutes(e.target.value)}
                  placeholder="e.g. 30"
                  required
                />
                <label>Reason (optional)</label>
                <input
                  value={requestReason}
                  onChange={(e) => setRequestReason(e.target.value)}
                  placeholder="e.g. Extra mess in the kitchen"
                />
                <button type="submit" className="visit-btn-secondary" disabled={submittingExtension}>
                  {submittingExtension ? 'Sending...' : 'Send request'}
                </button>
              </form>
            )}

            <div className="visit-card">
              <div className="visit-card-label">Photos</div>
              <div className="visit-photo-row">
                <label className="visit-photo-add">
                  <Camera size={20} />
                  <span>{uploading ? 'Sending' : 'Photo'}</span>
                  <input type="file" accept="image/*" capture="environment" onChange={handlePhotoUpload} disabled={uploading} />
                </label>
                {photos.map((p) => (
                  <img key={p.id} className="visit-photo-thumb" src={p.signedUrl} alt="job" />
                ))}
              </div>
              {photos.length === 0 ? (
                <p className="visit-photo-warning">
                  Take photos before you check out — you won't be able to add them afterwards.
                </p>
              ) : (
                <p className="visit-photo-count">{photos.length} photo{photos.length === 1 ? '' : 's'} added</p>
              )}
            </div>

            {/* Collapsed, so a long room-by-room reference can't push the
                actual task list off the screen. */}
            {checklistItems.length > 0 && (
              <div className="visit-card visit-card-flush">
                <button
                  type="button"
                  className={`visit-disclosure${showChecklist ? ' is-open' : ''}`}
                  onClick={() => setShowChecklist((v) => !v)}
                  aria-expanded={showChecklist}
                >
                  <span>Property checklist</span>
                  <ChevronDown size={18} />
                </button>
                {showChecklist && (
                  <div className="visit-checklist">
                    {Object.entries(
                      checklistItems.reduce((acc, item) => {
                        (acc[item.room] = acc[item.room] || []).push(item);
                        return acc;
                      }, {})
                    ).map(([room, items]) => (
                      <div key={room} className="visit-checklist-room">
                        <div className="visit-card-label">{room}</div>
                        {items.map((item) => (
                          <div key={item.id} className="visit-checklist-item">{item.task}</div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* ---- State 3: checked out ---- */}
        {isHistory && (
          <>
            <div className="visit-done-banner">
              <span className="visit-done-mark"><Check size={22} strokeWidth={3} /></span>
              <div>
                <div className="visit-done-title">Job done</div>
                <div className="visit-done-sub">
                  {checkin?.checked_in_at ? (
                    <>
                      {clock(checkin.checked_in_at)} – {clock(checkin.checked_out_at)}
                      {' · '}{formatSpan((new Date(checkin.checked_out_at) - new Date(checkin.checked_in_at)) / 60000)} on site
                      {checkin.auto_checked_out && ' · checked out automatically when you left'}
                    </>
                  ) : 'No check-in was recorded.'}
                </div>
              </div>
            </div>

            <div className="visit-card visit-card-flush">
              <div className="visit-receipt">
                <span>Tasks completed</span>
                <strong>{doneTasks} of {tasks.length}</strong>
              </div>
              <div className="visit-receipt">
                <span>Photos sent to client</span>
                <strong>{photos.length}</strong>
              </div>
              {approvedExtra > 0 && (
                <div className="visit-receipt">
                  <span>Extra time approved</span>
                  <strong>+{approvedExtra} min</strong>
                </div>
              )}
            </div>

            {photos.length > 0 && (
              <div>
                <div className="visit-card-label visit-photos-label">Your photos</div>
                <div className="visit-photo-grid">
                  {photos.map((p) => (
                    <img key={p.id} src={p.signedUrl} alt="job" />
                  ))}
                </div>
              </div>
            )}

            {/* Says out loud the read-only rule the code already enforces -
                it used to be a bare "completed" badge and a list that
                silently stopped responding. */}
            <div className="visit-card visit-locked">
              <Lock size={18} />
              <p>
                This job is locked now — tasks and photos can't be changed.
                Something wrong? Message the office.
              </p>
            </div>
          </>
        )}
      </div>

      {/* One primary action, always in the same place, always reachable
          without scrolling to the end of the page. */}
      <div className="visit-actions">
        {beforeCheckIn && (
          <>
            {checkInError && <p className="visit-action-error">{checkInError}</p>}
            <button type="button" className="visit-btn-primary" onClick={handleCheckIn} disabled={checkingIn}>
              {checkingIn ? 'Checking location...' : 'Check in'}
            </button>
            <p className="visit-action-help">
              {jobTimePassed
                ? "Still here? Check in — it's never too late to start the clock."
                : 'Your location is checked — you need to be at the property.'}
            </p>
            {/* Offering to release a shift that has already been and gone is
                nonsense, and the wrong door for someone who worked it. */}
            {!coverOffer && !jobTimePassed && (
              <button type="button" className="visit-btn-secondary" onClick={() => setShowCoverForm((v) => !v)}>
                {showCoverForm ? 'Cancel' : "Can't make this shift"}
              </button>
            )}
            {canClaimMissed && (
              <button type="button" className="visit-btn-secondary" onClick={() => setShowClaimForm((v) => !v)}>
                {showClaimForm ? 'Cancel' : 'I worked this — I forgot to clock in'}
              </button>
            )}
          </>
        )}

        {onSite && resumable && (
          <button type="button" className="visit-btn-primary" onClick={handleResume} disabled={resuming}>
            {resuming ? 'Checking location...' : 'Check back in'}
          </button>
        )}

        {onSite && !resumable && (
          <div className="visit-action-row">
            <button
              type="button"
              className="visit-btn-secondary visit-btn-narrow"
              onClick={() => setShowExtensionForm((v) => !v)}
            >
              {showExtensionForm ? 'Cancel' : 'More time'}
            </button>
            <button type="button" className="visit-btn-primary" onClick={handleCheckOut} disabled={checkingOut}>
              {checkingOut ? 'Checking out...' : 'Check out'}
            </button>
          </div>
        )}

        {isHistory && (
          <>
            {nextJob ? (
              <button
                type="button"
                className="visit-btn-primary"
                onClick={() => router.push(`/cleaner/jobs/${nextJob.id}`)}
              >
                Next job · {clock(nextJob.scheduled_at)} {nextJob.properties?.clients?.name || nextJob.properties?.address}
              </button>
            ) : (
              <button type="button" className="visit-btn-primary" onClick={() => router.push('/cleaner')}>
                Back to today's jobs
              </button>
            )}
            <button type="button" className="visit-btn-secondary" onClick={() => router.push('/cleaner/messages')}>
              Message the office
            </button>
          </>
        )}
      </div>
    </div>
  );
}
