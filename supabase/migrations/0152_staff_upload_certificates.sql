-- Staff upload their own certificates (DBS, training, food hygiene...).
--
-- 0050 kept staff_certifications as dates and notes only, written by the
-- office. Staff now add their own from Help > Documents, with a photo or
-- PDF of the certificate, and the office sees it on the person's
-- Certifications card (and in the dashboard's expiring list, which already
-- reads this table).
--
-- No new foreign key to profiles: this table already has two (staff_id,
-- created_by), and the embeds that read it name staff_certifications_staff_id_fkey.

alter table staff_certifications
  add column if not exists storage_path text,
  add column if not exists file_name text,
  add column if not exists file_size bigint;

-- Staff add certificates for themselves only, as themselves.
drop policy if exists "staff_certifications: self insert" on staff_certifications;
create policy "staff_certifications: self insert" on staff_certifications
  for insert to authenticated
  with check (
    staff_id = auth.uid()
    and created_by = auth.uid()
    and is_active_cleaner()
  );

-- ...and can take back one they added (a wrong photo), but not one the
-- office recorded against them.
drop policy if exists "staff_certifications: self delete own upload" on staff_certifications;
create policy "staff_certifications: self delete own upload" on staff_certifications
  for delete to authenticated
  using (staff_id = auth.uid() and created_by = auth.uid());

-- Private bucket. Files sit under <staff id>/..., like incident-photos.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'staff-certificates', 'staff-certificates', false, 15728640,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do nothing;

drop policy if exists "staff-certificates: staff upload own" on storage.objects;
create policy "staff-certificates: staff upload own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'staff-certificates'
    and split_part(name, '/', 1) = auth.uid()::text
    and is_active_cleaner()
  );

drop policy if exists "staff-certificates: own or office read" on storage.objects;
create policy "staff-certificates: own or office read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'staff-certificates'
    and (split_part(name, '/', 1) = auth.uid()::text or is_admin_or_supervisor())
  );

drop policy if exists "staff-certificates: own or office delete" on storage.objects;
create policy "staff-certificates: own or office delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'staff-certificates'
    and (split_part(name, '/', 1) = auth.uid()::text or is_admin_or_supervisor())
  );
