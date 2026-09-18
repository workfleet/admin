-- Run after 0104_subcontractors.sql. Salih and Laura invoice for their
-- hours rather than being on the payroll, so holiday stops for them. The
-- same change can be made from each person's page under Cleaners; this is
-- here so the two are done together and the reason is written down.
update profile_private pp
set employment_type = 'subcontractor', updated_at = now()
from profiles p
where p.id = pp.profile_id
  and p.full_name in ('Salih Eray', 'Laura Dingsdale');
