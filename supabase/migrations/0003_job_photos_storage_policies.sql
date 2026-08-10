-- job-photos bucket existed (created in schema.sql) and is public, but
-- storage.objects has RLS enabled with zero policies, so uploads were
-- silently blocked. Path convention used by the app: "<job_id>/<timestamp>-<filename>".

create policy "job-photos: cleaner upload own job" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'job-photos'
    and exists (
      select 1 from jobs j
      where j.id::text = split_part(name, '/', 1)
        and j.cleaner_id = auth.uid()
    )
  );

create policy "job-photos: admin all" on storage.objects
  for all to authenticated
  using (bucket_id = 'job-photos' and is_admin())
  with check (bucket_id = 'job-photos' and is_admin());

create policy "job-photos: public read" on storage.objects
  for select using (bucket_id = 'job-photos');
