-- Staff onboarding: admin-generated invite links for new starters to fill in
-- their details, upload an ID document photo, and sign their contract.
-- No auth account needed by the new starter — the link's token IS the access
-- control, validated server-side (never via anon-key RLS) using the service
-- role key, since RLS has no concept of "unauthenticated but holds a valid
-- token" and forcing that through policies would be fragile.

create table staff_invites (
  id uuid primary key default gen_random_uuid(),
  token uuid not null default gen_random_uuid() unique,
  expected_name text,
  status text not null default 'pending' check (status in ('pending', 'submitted')),
  created_by uuid references profiles(id),
  created_at timestamptz default now(),
  expires_at timestamptz default (now() + interval '14 days')
);

create table staff_onboarding_submissions (
  id uuid primary key default gen_random_uuid(),
  invite_id uuid references staff_invites(id) on delete cascade unique,
  full_name text not null,
  date_of_birth date,
  address text,
  phone text,
  email text,
  ni_number text,
  emergency_contact_name text,
  emergency_contact_phone text,
  id_document_path text,
  contract_text text not null,
  signed_name text not null,
  signed_at timestamptz not null default now(),
  signed_ip text,
  created_at timestamptz default now()
);

alter table staff_invites enable row level security;
alter table staff_onboarding_submissions enable row level security;

-- Only admins can see invites/submissions via the normal app (anon/authenticated
-- roles). The onboarding page itself never talks to Supabase directly — it only
-- calls this app's own server routes, which use the service role key and so
-- bypass RLS entirely by design.
create policy "staff_invites: admin all" on staff_invites
  for all using (is_admin());

create policy "staff_onboarding_submissions: admin all" on staff_onboarding_submissions
  for all using (is_admin());

-- Private bucket for ID document photos — NOT public, unlike job-photos.
insert into storage.buckets (id, name, public) values ('staff-documents', 'staff-documents', false)
on conflict (id) do nothing;

-- No storage.objects policies for anon/authenticated roles on this bucket:
-- all reads/writes happen server-side via the service role key, which
-- bypasses RLS. That's intentional — ID photos should never be reachable
-- by a public URL the way job-photos are.
