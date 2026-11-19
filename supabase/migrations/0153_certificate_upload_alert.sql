-- Tell the office when a member of staff uploads a certificate (0152).
--
-- Bell row for every admin; the push sweep in /api/notify sends the same
-- words to their phones. Admins only, like client requests (0147): the
-- certificate is on the Cleaners profile, which supervisors can't open.
-- Only for staff uploads - a record the office adds itself needs no alert.

create or replace function notify_admins_on_certificate_upload() returns trigger as $$
declare
  staff_name text;
  msg text;
begin
  if new.created_by is distinct from new.staff_id then
    return new;
  end if;

  select full_name into staff_name from profiles where id = new.staff_id;

  msg := coalesce(staff_name, 'A member of staff') || ' uploaded a certificate: ' || left(new.name, 80)
    || case
         when new.expiry_date is not null
           then ' (expires ' || to_char(new.expiry_date, 'DD Mon YYYY') || ')'
         else ''
       end
    || '. It''s on their profile under Certifications.';

  insert into notifications (user_id, message)
  select id, msg from profiles where role = 'admin' and active is not false;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists notify_admins_on_certificate_upload on staff_certifications;
create trigger notify_admins_on_certificate_upload after insert on staff_certifications
  for each row execute function notify_admins_on_certificate_upload();

-- A trigger function, never meant to be called directly.
revoke execute on function notify_admins_on_certificate_upload() from public, anon, authenticated;
