-- Text messages to staff when the rota changes (lib/sms.js).
--
-- Building a week on the rota means assigning someone to one shift, then
-- the next, then moving one - each its own save. Texting on every save
-- would send a cleaner six texts in five minutes. Instead each change
-- writes a line here, and the notify route sends a person everything
-- waiting for them as one text once their rota has been quiet for a
-- minute and a half (flushShiftTexts in app/api/notify/route.js).
--
-- Only the server reads or writes this, with the service key: RLS is on
-- and there are no policies, so no login can read anyone's messages or
-- queue a text.

create table sms_outbox (
  id bigint generated always as identity primary key,
  profile_id uuid not null references profiles(id) on delete cascade,
  line text not null,
  created_at timestamptz not null default now(),
  -- Set when the row is claimed for sending, before the text goes, so two
  -- sweeps at once cannot both send it.
  sent_at timestamptz,
  -- 'sent', 'failed', 'no_number' or 'inactive', with the Twilio message id
  -- or the error in detail.
  status text,
  detail text
);

create index sms_outbox_waiting on sms_outbox (created_at) where sent_at is null;

alter table sms_outbox enable row level security;
