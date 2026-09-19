-- The office can mark someone as on holiday or unavailable themselves.
--
-- Until now every time_off_requests row came from the cleaner's own rota
-- page; the office could only approve or decline. When a cleaner rings in
-- sick or agrees holiday over the phone, the office now enters it from
-- Requests > Time Off (or the cleaner's profile), and it arrives already
-- approved with them as the decider - the balance check (0026/0104) and
-- the payroll holiday line (0108) apply exactly as they would to a request
-- the cleaner made.
--
-- The cleaner is told on their bell. 0025 only tells them when a row
-- changes status, and 0109 covers the row it approves automatically, so
-- this fills the one gap: a row inserted already decided by a person.
create or replace function notify_cleaner_on_time_off_entered() returns trigger as $$
begin
  if new.status not in ('approved', 'declined') or new.decided_by is null then return new; end if;

  insert into notifications (user_id, message)
  values (
    new.cleaner_id,
    'The office has marked you as '
      || (case when new.type = 'holiday' then 'on holiday' else 'unavailable' end)
      || ' for ' || to_char(new.start_date, 'DD Mon')
      || (case when new.end_date <> new.start_date then '–' || to_char(new.end_date, 'DD Mon') else '' end)
      || (case when new.type = 'holiday' and new.hours is not null then ' (' || trim(to_char(new.hours, 'FM999990.##')) || 'h)' else '' end)
      || coalesce(' - "' || left(new.admin_note, 80) || '"', '') || '.'
  );

  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists time_off_requests_notify_cleaner_entered on time_off_requests;
create trigger time_off_requests_notify_cleaner_entered
  after insert on time_off_requests
  for each row execute procedure notify_cleaner_on_time_off_entered();
