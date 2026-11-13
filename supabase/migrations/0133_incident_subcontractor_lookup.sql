-- Accident book: read a subcontractor from profile_private (fixes 0130/0131; 0132 is shared shift absences).
--
-- 0130 and 0131 looked for employment_type on profiles, through to_jsonb so
-- they would not fail if 0104 had not been run. But 0104 put the column on
-- profile_private (0088), and it has been run: five staff are marked as
-- subcontractors. So an injured subcontractor was recorded as an employee,
-- and their occupation lacked "(self-employed)". That matters because a
-- self-employed person hurt on a client's premises is usually reported to
-- HSE by the client, not by us. No reports had been made when this was
-- found (2026-11-13), so no rows need correcting.
--
-- Everything else is 0131's function as it was.

create or replace function incident_reports_fill_identity() returns trigger as $$
declare
  reporter_role text;
  reporter_address text;
  self_employed boolean;
  occupation text;
begin
  select p.role into reporter_role from public.profiles p where p.id = new.reported_by;
  select d.address into reporter_address from public.staff_details d where d.profile_id = new.reported_by;
  if reporter_address is null and reporter_role = 'admin' then
    select nullif(trim(c.registered_office), '') into reporter_address from public.company_settings c limit 1;
  end if;
  select coalesce(pp.employment_type, 'employee') = 'subcontractor' into self_employed
  from public.profile_private pp where pp.profile_id = new.reported_by;
  self_employed := coalesce(self_employed, false);
  occupation := case reporter_role
      when 'cleaner' then 'Cleaning Operative'
      when 'supervisor' then 'Cleaning Supervisor'
      when 'inventory' then 'Inventory Clerk'
      when 'admin' then 'Office staff'
      else initcap(coalesce(reporter_role, 'staff'))
    end || case when self_employed then ' (self-employed)' else '' end;

  if new.injured_party = 'me' then
    new.injured_address := coalesce(nullif(trim(new.injured_address), ''), reporter_address);
    new.injured_occupation := coalesce(nullif(trim(new.injured_occupation), ''), occupation);
    new.recorded_by_address := null;
    new.recorded_by_occupation := null;
  elsif new.kind = 'accident' and new.injured_party <> 'nobody' then
    new.recorded_by_address := reporter_address;
    new.recorded_by_occupation := occupation;
  else
    new.injured_address := null;
    new.injured_occupation := null;
    new.recorded_by_address := null;
    new.recorded_by_occupation := null;
  end if;

  if new.injured_status is null then
    new.injured_status := case
      when new.injured_party = 'me' then case when self_employed then 'self_employed' else 'employee' end
      when new.injured_party in ('client', 'public') then 'non_worker'
      else null
    end;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;
