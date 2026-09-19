-- Holiday that needs no decision is approved on arrival.
--
-- A holiday request with nothing booked on those days, made more than two
-- weeks ahead, has already passed every check the office would make: the
-- balance is enforced on insert (0026), there is no shift to cover, and
-- there is time to plan around it. Making someone open Requests to press
-- Approve on it is work with no judgement in it. Those are approved here
-- as they are inserted, and the office is told rather than asked.
-- Anything else - shifts booked, short notice, an unavailability request,
-- a request made by the office on someone's behalf - still waits for a
-- person, exactly as before.

create or replace function auto_approve_easy_holiday() returns trigger as $$
declare
  cleaner_name text;
begin
  if new.type <> 'holiday' or new.status <> 'pending' then return new; end if;
  -- The office entering a request for someone decides it themselves.
  if auth.uid() is null or auth.uid() <> new.cleaner_id then return new; end if;
  -- More than two weeks' notice, measured in UK days.
  if new.start_date <= payroll_local_date(now()) + 14 then return new; end if;
  -- Any shift at all on those days, whatever its state, means a person looks.
  if exists (
    select 1 from job_assignments a
    join jobs j on j.id = a.job_id
    where a.cleaner_id = new.cleaner_id
      and payroll_local_date(j.scheduled_at) between new.start_date and new.end_date
  ) then return new; end if;

  new.status := 'approved';
  new.decided_at := now();
  new.decided_by := null;
  new.admin_note := 'Approved automatically: nothing booked on those days and more than two weeks'' notice.';

  select full_name into cleaner_name from profiles where id = new.cleaner_id;

  -- 0025 tells the cleaner only on update, so this insert tells them here.
  insert into notifications (user_id, message)
  values (new.cleaner_id,
    'Your holiday request for ' || to_char(new.start_date, 'DD Mon')
    || case when new.end_date <> new.start_date then '–' || to_char(new.end_date, 'DD Mon') else '' end
    || ' was approved.');

  insert into notifications (user_id, message)
  select p.id,
    coalesce(cleaner_name, 'A cleaner') || '''s holiday on ' || to_char(new.start_date, 'DD Mon')
    || case when new.end_date <> new.start_date then '–' || to_char(new.end_date, 'DD Mon') else '' end
    || ' (' || trim(to_char(new.hours, 'FM999990.##')) || 'h) was approved automatically - nothing was booked on those days.'
  from profiles p
  where p.role in ('admin', 'supervisor');

  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- Named to run after the balance check (triggers fire alphabetically):
-- a request over the balance is refused before it can be approved.
create trigger time_off_requests_zz_auto_approve
  before insert on time_off_requests
  for each row execute procedure auto_approve_easy_holiday();

-- The "X requested holiday" bell (0086) is for something awaiting a
-- decision. A request that arrived already approved gets the one line
-- above instead, not both.
create or replace function notify_office_on_time_off_requested() returns trigger as $$
declare
  requester_name text;
begin
  if new.status <> 'pending' then return new; end if;

  select full_name into requester_name from public.profiles where id = new.cleaner_id;

  insert into public.notifications (user_id, message)
  select p.id,
    coalesce(requester_name, 'A cleaner') || ' requested '
    || (case when new.type = 'holiday' then 'holiday' else 'time off' end)
    || ' ' || to_char(new.start_date, 'DD Mon')
    || (case when new.end_date <> new.start_date then ' – ' || to_char(new.end_date, 'DD Mon') else '' end)
    || coalesce(' - "' || left(new.reason, 80) || '"', '')
  from public.profiles p
  where p.role in ('admin', 'supervisor');

  return new;
end;
$$ language plpgsql security definer set search_path = public;
