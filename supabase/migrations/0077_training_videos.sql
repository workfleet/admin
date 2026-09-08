-- Eight short how-to videos, so "how do I do that" stops being a message
-- to the office.
--
-- The Help tab already answers these questions in prose (HELP_SECTIONS in
-- app/cleaner/policies/page.js), and that text stays - it is searchable,
-- it costs nothing to read on a bad signal, and it is the only version of
-- this that works when someone has data switched off. Video is added
-- alongside it rather than instead of it because the two fail in opposite
-- conditions, and because a minute of someone actually pressing Check In
-- lands where a paragraph about pressing Check In does not.
--
-- Deliberately NOT modelled as courses/lessons/quizzes. Nobody is being
-- examined here and there is no pass mark to record - this is a manual you
-- can watch, so it is a flat ordered list with headings, which is what the
-- design shows and all the domain actually has. staff_certifications (0050)
-- remains the place where anything with a compliance meaning is recorded;
-- watching a video is not that, and the two must not get confused.

insert into storage.buckets (id, name, public) values ('training-videos', 'training-videos', false);

create table training_videos (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  -- The one line under the title on the index. Named for what it is on the
  -- screen rather than "description", because it has a job: it says what
  -- the video covers so somebody can skip it.
  blurb text,
  -- Fixed set, matching the headings on the index. A check constraint
  -- rather than free text so two videos cannot end up under "On the job"
  -- and "On The Job" and render as two headings; same call as
  -- company_documents.category (0048). A fifth heading is a one-line
  -- migration, which is the right amount of friction for something that
  -- changes the shape of the page.
  section text not null check (section in ('getting_started', 'on_the_job', 'your_week', 'staying_in_touch')),
  -- Global order, not per-section. The videos are numbered 1-8 straight
  -- through on the index and the copy tells people to watch them in order
  -- the first time, so the number has to be continuous across headings -
  -- which means one sequence for the whole list, with the headings falling
  -- where the section changes.
  position integer not null,
  -- Read off the file at upload rather than typed, so it cannot drift from
  -- the video it labels. Nullable because a row can exist before its file
  -- finishes uploading and because a browser can fail to report it.
  duration_seconds integer,
  -- Null until the file lands. The eight rows below are seeded from the
  -- agreed running order, so the curriculum exists as a list of slots
  -- before any filming has happened and the titles never have to be
  -- retyped from the design. A slot with no file is simply not shown to
  -- cleaners - see app/cleaner/training/page.js - so a half-filmed set
  -- never puts a dead row in front of somebody.
  storage_path text,
  file_name text,
  file_size bigint,
  uploaded_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index training_videos_position_idx on training_videos(position);

alter table training_videos enable row level security;

-- Same split as company_documents: any staff member can watch, only
-- admin/supervisor can add, reorder or remove.
create policy "training_videos: staff select" on training_videos
  for select using (is_staff());

create policy "training_videos: admin or supervisor manage" on training_videos
  for all using (is_admin_or_supervisor());

create policy "training-videos: staff read" on storage.objects
  for select to authenticated
  using (bucket_id = 'training-videos' and is_staff());

create policy "training-videos: admin or supervisor manage" on storage.objects
  for all to authenticated
  using (bucket_id = 'training-videos' and is_admin_or_supervisor())
  with check (bucket_id = 'training-videos' and is_admin_or_supervisor());

-- The running order, seeded empty. Copy is the agreed wording from the
-- design rather than anything invented here, so what a cleaner reads is
-- what was signed off. Durations are deliberately NOT seeded from the
-- design's mock timings - they are read off each real file at upload, so
-- the number beside a video is always that video's actual length.
insert into training_videos (title, blurb, section, position) values
  ('Install the app', 'Put WorkFleet on your home screen and allow notifications', 'getting_started', 1),
  ('Find your jobs', 'See today''s jobs and open one - time, address, how to get in', 'getting_started', 2),
  ('Check in and out', 'Start and finish a job so your hours are recorded', 'on_the_job', 3),
  ('Tick off your tasks', 'The to-do list, and adding photos before you leave', 'on_the_job', 4),
  ('Read your rota', 'Badges, missed jobs, history and your hours', 'your_week', 5),
  ('Book a holiday', 'Request time off and see it approved', 'your_week', 6),
  ('Message the office', 'Read, reply and start a new chat', 'staying_in_touch', 7),
  ('Help and your profile', 'Guides, policies, documents and your details', 'staying_in_touch', 8);

-- Who has watched what, so the office can tell "nobody told me" from
-- "you were told and it is on the record" - and, more usefully, can see
-- which video everybody skipped and fix that video.
--
-- One row per person per video, updated on rewatch rather than appended
-- to: this answers "have you seen it", not "how many times", and an
-- append-only view log on eight videos across a whole workforce would grow
-- for no question anyone is asking.
create table training_video_views (
  video_id uuid references training_videos(id) on delete cascade not null,
  viewer_id uuid references profiles(id) on delete cascade not null,
  first_viewed_at timestamptz not null default now(),
  last_viewed_at timestamptz not null default now(),
  -- Set when playback actually reaches the end. Starting a video and
  -- closing it after four seconds is not having watched it, and the
  -- office should be able to see the difference.
  completed_at timestamptz,
  primary key (video_id, viewer_id)
);

create index training_video_views_viewer_id_idx on training_video_views(viewer_id);

alter table training_video_views enable row level security;

-- A cleaner writes their own view rows and can see their own history.
-- Deliberately no update path for anyone else's, and no delete: this is a
-- record of something that happened.
create policy "training_video_views: viewer insert own" on training_video_views
  for insert with check (viewer_id = auth.uid() and is_staff());

create policy "training_video_views: viewer update own" on training_video_views
  for update using (viewer_id = auth.uid()) with check (viewer_id = auth.uid());

create policy "training_video_views: viewer select own" on training_video_views
  for select using (viewer_id = auth.uid());

create policy "training_video_views: admin or supervisor select" on training_video_views
  for select using (is_admin_or_supervisor());
