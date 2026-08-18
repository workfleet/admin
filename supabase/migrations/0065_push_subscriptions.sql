-- Web Push subscriptions, one row per device a user has enabled
-- notifications on (a user can have several - phone, laptop, etc).
-- Currently only used to reach admin/supervisor on their phones for
-- emergency alerts, but kept generic (any signed-in user, any device)
-- rather than admin-only, so other notification types can reuse it
-- later without a schema change.
create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade not null,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

create index push_subscriptions_user_id_idx on push_subscriptions(user_id);

alter table push_subscriptions enable row level security;

create policy "push_subscriptions: user manage own" on push_subscriptions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "push_subscriptions: admin all" on push_subscriptions
  for all using (is_admin());
