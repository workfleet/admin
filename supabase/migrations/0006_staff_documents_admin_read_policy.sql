-- Amendment to 0005: admins need to view uploaded ID documents through
-- their own authenticated session (e.g. generating a signed URL from the
-- Onboarding admin page), not only via the service-role server routes.
create policy "staff-documents: admin read" on storage.objects
  for select to authenticated
  using (bucket_id = 'staff-documents' and is_admin());
