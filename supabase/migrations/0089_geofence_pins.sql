-- When the pin is in the wrong place, let the people at the door say so.
--
-- A property's coordinates come from an OpenStreetMap address lookup when
-- it is added (0011). OSM's UK coverage often has the street but not the
-- house, so the pin can land a couple of hundred metres from the front
-- door, and the 75 m check-in geofence then refuses a cleaner who is
-- standing on the step. Until now the only fix was to delete the property
-- and add it again, hoping the lookup did better.
--
-- Three things change. A property can carry its own radius, for the school
-- or the farm where 75 m is simply wrong. A cleaner refused at the door can
-- check in anyway, with the check-in marked as outside the fence and their
-- position recorded as a proposed pin. And the office can accept that
-- proposal with one tap, which moves the pin for every visit after.

-- Per-property radius; null means the app default (lib/geo.js, 75 m).
alter table properties
  add column if not exists geofence_radius_m integer
    check (geofence_radius_m is null or geofence_radius_m between 25 and 2000);

-- The attendance record says so when a check-in was allowed from outside
-- the fence, and how far outside. Same reasoning as auto_checked_out (0072)
-- and self_declared (0076): the three ways a check-in can come to exist
-- must not look identical afterwards.
alter table checkins
  add column if not exists outside_geofence boolean not null default false,
  add column if not exists distance_m numeric;

create table property_location_proposals (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references properties(id) on delete cascade not null,
  job_id uuid references jobs(id) on delete set null,
  cleaner_id uuid references profiles(id) on delete set null,
  lat double precision not null,
  lng double precision not null,
  accuracy_m numeric,
  -- Distance from the pin the property had at the time; null when it had
  -- none, which is the "no pin yet" case rather than the "wrong pin" case.
  distance_from_pin_m numeric,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  decided_by uuid references profiles(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create index property_location_proposals_property_idx on property_location_proposals(property_id, created_at desc);

-- One open proposal per cleaner per property. A second visit to a site
-- whose pin is still wrong should not stack a second identical request.
create unique index property_location_proposals_one_pending_idx
  on property_location_proposals(property_id, cleaner_id)
  where status = 'pending';

alter table property_location_proposals enable row level security;

create policy "property_location_proposals: cleaner insert own" on property_location_proposals
  for insert with check (
    cleaner_id = auth.uid()
    and is_active_cleaner()
    and (job_id is null or is_assigned_to_job(job_id))
  );

create policy "property_location_proposals: cleaner select own" on property_location_proposals
  for select using (cleaner_id = auth.uid());

create policy "property_location_proposals: office manage" on property_location_proposals
  for all using (is_admin_or_supervisor());

-- The office hears about it straight away - the bell row is pushed by the
-- sweep in api/notify (0086).
create or replace function notify_office_on_location_proposal() returns trigger as $$
declare
  cleaner_name text;
  addr text;
begin
  select full_name into cleaner_name from public.profiles where id = new.cleaner_id;
  select address into addr from public.properties where id = new.property_id;

  insert into public.notifications (user_id, message)
  select p.id,
    coalesce(cleaner_name, 'A cleaner')
    || case when new.distance_from_pin_m is null
         then ' checked in at ' || coalesce(addr, 'a property') || ', which has no pin yet - accept their position to set one'
         else ' says the pin for ' || coalesce(addr, 'a property') || ' is about '
              || round(new.distance_from_pin_m) || 'm out - accept their position to move it'
       end
  from public.profiles p
  where p.role in ('admin', 'supervisor');

  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger location_proposal_notifies_office
  after insert on property_location_proposals
  for each row execute procedure notify_office_on_location_proposal();

-- Accepting moves the pin. Definer, because a supervisor's update on
-- properties is allowed but the decision has to land on both rows in one
-- go, and so the proposal's own coordinates are what get written rather
-- than whatever the client sent alongside.
create or replace function decide_location_proposal(target_proposal_id uuid, decision text)
returns text as $$
declare
  target property_location_proposals;
  addr text;
begin
  if not is_admin_or_supervisor() then return 'not_allowed'; end if;
  if decision not in ('approved', 'declined') then return 'bad_decision'; end if;

  select * into target from property_location_proposals where id = target_proposal_id for update;
  if not found then return 'not_found'; end if;
  if target.status <> 'pending' then return 'already_decided'; end if;

  update property_location_proposals
  set status = decision, decided_by = auth.uid(), decided_at = now()
  where id = target_proposal_id;

  if decision = 'approved' then
    update properties set lat = target.lat, lng = target.lng where id = target.property_id;

    -- Any other open proposal for the same property is answered by this
    -- one - the pin has moved to where somebody stood.
    update property_location_proposals
    set status = 'declined', decided_by = auth.uid(), decided_at = now()
    where property_id = target.property_id and status = 'pending' and id <> target_proposal_id;
  end if;

  if target.cleaner_id is not null then
    select address into addr from properties where id = target.property_id;
    insert into notifications (user_id, message)
    values (target.cleaner_id,
      case when decision = 'approved'
        then 'The pin for ' || coalesce(addr, 'the property') || ' has been moved to where you checked in. Check-in there should just work now.'
        else 'The office kept the existing pin for ' || coalesce(addr, 'the property') || '. If check-in keeps refusing you there, message them.'
      end);
  end if;

  return 'ok';
end;
$$ language plpgsql security definer set search_path = public;

revoke execute on function decide_location_proposal(uuid, text) from public, anon;
grant execute on function decide_location_proposal(uuid, text) to authenticated;
