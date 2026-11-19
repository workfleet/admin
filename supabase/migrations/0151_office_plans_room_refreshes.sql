-- 0151: the office plans and confirms room refreshes, not the cleaner.
--
-- 0150 had cleaners tick each room on the visit. Jess (19 Nov 2026): that
-- puts the onus on the cleaner - it has to be the office's responsibility.
-- So the office plans which rooms each visit covers (the Rooms tracker and
-- the rota), the cleaner just sees the list, and after the visit the office
-- marks any room that wasn't done. A room marked not done stays on the visit
-- with "skipped": true, so it isn't charged and the tracker shows it as
-- still due, and the cleaner's pay for the booked visit isn't touched.
--
-- set_room_plan(job, room, action):
--   'add'    a scheduled visit: add the room at the client's minutes per
--            room and make the visit that much longer.
--   'remove' a scheduled visit: take the room off and the visit shorter.
--   'skip'   a started or finished visit: the room wasn't done.
--   'unskip' undo a skip.
-- Office (admin or supervisor) only. Returns the visit's room list and length.

drop function if exists set_room_refresh(uuid, text, boolean);

create or replace function set_room_plan(target_job_id uuid, room_name text, action text)
returns jsonb as $$
declare
  job_status text;
  current_list jsonb;
  booked integer;
  house_rooms text[];
  per_room integer;
  existing jsonb;
  new_list jsonb;
  new_length integer;
begin
  if not is_admin_or_supervisor() then
    raise exception 'Only the office can plan room refreshes';
  end if;

  select j.status, coalesce(j.room_refreshes, '[]'::jsonb), j.duration_minutes, p.rooms, coalesce(c.room_refresh_minutes, 15)
    into job_status, current_list, booked, house_rooms, per_room
  from jobs j
  join properties p on p.id = j.property_id
  left join clients c on c.id = p.client_id
  where j.id = target_job_id;

  if not found then
    raise exception 'That visit no longer exists';
  end if;

  select e.item into existing
  from jsonb_array_elements(current_list) as e(item)
  where e.item->>'room' = room_name
  limit 1;

  select coalesce(jsonb_agg(e.item), '[]'::jsonb) into new_list
  from jsonb_array_elements(current_list) as e(item)
  where e.item->>'room' is distinct from room_name;

  new_length := booked;

  if action = 'add' then
    if job_status <> 'scheduled' then
      raise exception 'Rooms can only be added to a visit that has not started';
    end if;
    if room_name is null or not (room_name = any(house_rooms)) then
      raise exception 'That room is not on this property''s room list';
    end if;
    if existing is not null then
      return jsonb_build_object('room_refreshes', current_list, 'duration_minutes', booked);
    end if;
    new_list := new_list || jsonb_build_array(jsonb_build_object('room', room_name, 'minutes', per_room));
    new_length := booked + per_room;
  elsif action = 'remove' then
    if job_status <> 'scheduled' then
      raise exception 'This visit has started - mark the room as not done instead';
    end if;
    if existing is null then
      return jsonb_build_object('room_refreshes', current_list, 'duration_minutes', booked);
    end if;
    new_length := greatest(15, booked - coalesce((existing->>'minutes')::integer, 0));
  elsif action in ('skip', 'unskip') then
    if job_status not in ('in_progress', 'completed') then
      raise exception 'Only a started or finished visit can have a room marked not done';
    end if;
    if existing is null then
      raise exception 'That room was not planned on this visit';
    end if;
    new_list := new_list || jsonb_build_array(
      case when action = 'skip'
        then existing || jsonb_build_object('skipped', true, 'skipped_at', now(), 'skipped_by', auth.uid())
        else existing - 'skipped' - 'skipped_at' - 'skipped_by'
      end
    );
  else
    raise exception 'Unknown action %', action;
  end if;

  update jobs set room_refreshes = new_list, duration_minutes = new_length where id = target_job_id;
  return jsonb_build_object('room_refreshes', new_list, 'duration_minutes', new_length);
end;
$$ language plpgsql security definer set search_path = public;

-- Definer functions are callable by anyone with the anon key unless revoked.
revoke all on function set_room_plan(uuid, text, text) from public;
revoke all on function set_room_plan(uuid, text, text) from anon;
grant execute on function set_room_plan(uuid, text, text) to authenticated;
