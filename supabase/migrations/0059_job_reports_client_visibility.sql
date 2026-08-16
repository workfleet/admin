-- Lets admin selectively share a generated job report to that job's
-- client portal - off by default (existing reports stay admin-only
-- until explicitly shared), and toggleable back off in case the wrong
-- report gets attached to the wrong client.
alter table job_reports add column visible_to_client boolean not null default false;

create policy "job_reports: client select if shared" on job_reports
  for select using (
    visible_to_client = true
    and exists (
      select 1 from jobs j
      join properties p on p.id = j.property_id
      where j.id = job_reports.job_id
        and p.client_id in (select client_id from profiles where id = auth.uid())
    )
  );
