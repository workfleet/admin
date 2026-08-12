-- Lets a cleaner request a kit top-up (supplies) or flag an issue (broken
-- equipment, access problems, etc.) without needing to phone/text the
-- office. Optionally tied to a specific job, but not required - a kit
-- request is often general ("need more spray bottles for the van") rather
-- than about one property.
create table staff_requests (
  id uuid primary key default gen_random_uuid(),
  cleaner_id uuid references profiles(id) not null,
  job_id uuid references jobs(id) on delete set null,
  type text not null check (type in ('kit_topup', 'issue')),
  description text not null,
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz default now(),
  resolved_at timestamptz
);

alter table staff_requests enable row level security;

-- Cleaner can create and view their own requests (so they can see if
-- something's been actioned), but not edit/delete once submitted.
create policy "staff_requests: cleaner insert own" on staff_requests
  for insert with check (cleaner_id = auth.uid() and is_active_cleaner());

create policy "staff_requests: cleaner select own" on staff_requests
  for select using (cleaner_id = auth.uid());

-- Admin manages everything (view all, mark resolved).
create policy "staff_requests: admin all" on staff_requests
  for all using (is_admin());
