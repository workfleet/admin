-- job-photos was public (readable by anyone with the URL, no login needed).
-- Switch to private: reads now require a signed URL, generated only for
-- the cleaner assigned to that job, the client it belongs to, or an admin.

update storage.buckets set public = false where id = 'job-photos';

drop policy if exists "job-photos: public read" on storage.objects;

create policy "job-photos: cleaner read own job" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'job-photos'
    and exists (
      select 1 from jobs j
      where j.id::text = split_part(name, '/', 1)
        and j.cleaner_id = auth.uid()
    )
  );

create policy "job-photos: client read via job" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'job-photos'
    and exists (
      select 1 from jobs j
      join properties p on p.id = j.property_id
      join profiles pr on pr.client_id = p.client_id
      where j.id::text = split_part(name, '/', 1)
        and pr.id = auth.uid()
    )
  );

-- "job-photos: admin all" (from 0003) already covers admin read since it's FOR ALL.
