-- Subcontractors invoice us through the app (Jess, 2026-11-19).
--
-- A subcontractor (profile_private.employment_type, 0104) picks a closed pay
-- period, and the hours on the invoice are the hours payroll closed under
-- their name for it - the lines (0082) plus any adjustments carried on that
-- run - so the invoice and payroll can never disagree about the time. They
-- type their own hourly rate (Jess's choice), can add extra lines such as
-- materials or travel, charge VAT if they are registered, and can attach an
-- invoice of their own as a file as well.
--
-- Only Jess's own login handles them, the same rule as the client Invoices
-- page (lib/invoiceAccess.js) - but enforced here too, not only by hiding
-- the menu link.
--
-- Money is worked out in the trigger below, not trusted from the browser:
-- minutes come from payroll, and subtotal / VAT / total are recomputed on
-- every write. lib/subcontractorInvoices.js mirrors the arithmetic for the
-- form's running total and must stay in step with it.
--
-- Run before pushing the pages that read it, or they hit 42703 / 42P01.

-- ---------------------------------------------------------------------------
-- Who handles them
-- ---------------------------------------------------------------------------

create or replace function is_invoice_owner() returns boolean as $$
  select is_admin()
    and lower(coalesce(auth.jwt() ->> 'email', '')) = 'jess@crewconnect.ltd';
$$ language sql security definer stable set search_path = public;

revoke execute on function is_invoice_owner() from public, anon;
grant execute on function is_invoice_owner() to authenticated;

-- ---------------------------------------------------------------------------
-- The table
-- ---------------------------------------------------------------------------

-- One foreign key to profiles only (subcontractor_id): a second one makes
-- every bare profiles embed ambiguous and blanks pages (PGRST201). Who in the
-- office decided is not recorded by id - there is only one person who can.
create table if not exists subcontractor_invoices (
  id uuid primary key default gen_random_uuid(),
  subcontractor_id uuid references profiles(id) on delete set null,
  subcontractor_name text not null default '',
  period_id uuid references payroll_periods(id) on delete restrict not null,
  period_start date,
  period_end date,

  -- Their side of the invoice.
  invoice_number text not null check (length(btrim(invoice_number)) between 1 and 40),
  business_name text check (business_name is null or length(business_name) <= 120),
  business_address text check (business_address is null or length(business_address) <= 400),
  vat_number text check (vat_number is null or length(vat_number) <= 30),
  hourly_rate numeric(10,2) not null check (hourly_rate > 0 and hourly_rate <= 200),
  extras jsonb not null default '[]'::jsonb check (jsonb_typeof(extras) = 'array'),
  vat_rate numeric(5,2) not null default 0 check (vat_rate in (0, 20)),
  notes text check (notes is null or length(notes) <= 2000),
  attachment_path text,
  attachment_name text,

  -- Worked out by the trigger.
  minutes numeric not null default 0,
  hours_amount numeric(10,2) not null default 0,
  extras_total numeric(10,2) not null default 0,
  subtotal numeric(10,2) not null default 0,
  vat_amount numeric(10,2) not null default 0,
  total numeric(10,2) not null default 0,

  -- The office's side.
  status text not null default 'submitted'
    check (status in ('submitted', 'queried', 'approved', 'paid', 'withdrawn')),
  office_note text check (office_note is null or length(office_note) <= 2000),
  submitted_at timestamptz not null default now(),
  decided_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists subcontractor_invoices_subcontractor_idx on subcontractor_invoices(subcontractor_id);
create index if not exists subcontractor_invoices_status_idx on subcontractor_invoices(status);

-- One live invoice per person per pay period. A withdrawn one frees the
-- period up to be invoiced again.
create unique index if not exists subcontractor_invoices_one_per_period
  on subcontractor_invoices(subcontractor_id, period_id)
  where status <> 'withdrawn';

-- ---------------------------------------------------------------------------
-- Guard and arithmetic
-- ---------------------------------------------------------------------------

create or replace function subcontractor_invoice_before_write() returns trigger as $$
declare
  office boolean := is_invoice_owner();
  -- The SQL editor and the service key have no auth.uid(); they are trusted.
  trusted boolean := auth.uid() is null;
  employment text;
  p record;
  item jsonb;
  amount numeric;
  extras_sum numeric := 0;
  -- An office decision leaves the money exactly as it was sent.
  recompute boolean := true;
begin
  if tg_op = 'INSERT' then
    if not trusted then
      if new.subcontractor_id is distinct from auth.uid() then
        raise exception 'You can only invoice for yourself';
      end if;
      select employment_type into employment from profile_private where profile_id = auth.uid();
      if coalesce(employment, 'employee') <> 'subcontractor' then
        raise exception 'Only subcontractors can send invoices';
      end if;
    end if;
    new.status := 'submitted';
    new.office_note := null;
    new.decided_at := null;
    new.paid_at := null;
    new.submitted_at := now();
    new.created_at := now();
    select full_name into new.subcontractor_name from profiles where id = new.subcontractor_id;
    new.subcontractor_name := coalesce(new.subcontractor_name, '');
  else
    -- Fixed once made, whoever is writing.
    if new.subcontractor_id is distinct from old.subcontractor_id
       or new.period_id is distinct from old.period_id
       or new.created_at is distinct from old.created_at then
      raise exception 'Who and which pay period an invoice is for cannot be changed - withdraw it and send a new one';
    end if;

    if not trusted and office and old.subcontractor_id is distinct from auth.uid() then
      -- The office decides; it does not rewrite someone else's invoice.
      if new.invoice_number is distinct from old.invoice_number
         or new.business_name is distinct from old.business_name
         or new.business_address is distinct from old.business_address
         or new.vat_number is distinct from old.vat_number
         or new.hourly_rate is distinct from old.hourly_rate
         or new.extras is distinct from old.extras
         or new.vat_rate is distinct from old.vat_rate
         or new.notes is distinct from old.notes
         or new.attachment_path is distinct from old.attachment_path
         or new.attachment_name is distinct from old.attachment_name then
        raise exception 'The office can approve, query or mark an invoice paid, but not change what it says';
      end if;
      if old.status = 'withdrawn' then
        raise exception 'This invoice was withdrawn';
      end if;
      if new.status not in ('submitted', 'queried', 'approved', 'paid') then
        raise exception 'The office cannot withdraw an invoice';
      end if;
      if new.status is distinct from old.status then
        if new.status in ('queried', 'approved') then new.decided_at := now(); end if;
        if new.status = 'paid' then
          new.paid_at := now();
          new.decided_at := coalesce(old.decided_at, now());
        end if;
        if new.status = 'submitted' then
          new.decided_at := null;
          new.paid_at := null;
        end if;
      else
        new.decided_at := old.decided_at;
        new.paid_at := old.paid_at;
      end if;
      new.submitted_at := old.submitted_at;
      recompute := false;
    elsif not trusted then
      -- The subcontractor: edit, resubmit or withdraw while it is still open.
      if old.subcontractor_id is distinct from auth.uid() then
        raise exception 'This is not your invoice';
      end if;
      if old.status not in ('submitted', 'queried') then
        raise exception 'This invoice has been % and can no longer be changed', old.status;
      end if;
      if new.status not in ('submitted', 'withdrawn') then
        raise exception 'Only the office can approve an invoice or mark it paid';
      end if;
      new.office_note := old.office_note;
      new.decided_at := old.decided_at;
      new.paid_at := old.paid_at;
      new.submitted_at := case when new.status = 'submitted' then now() else old.submitted_at end;
    end if;
    new.subcontractor_name := old.subcontractor_name;
  end if;

  if not recompute then
    new.updated_at := now();
    return new;
  end if;

  -- The period and its hours, from payroll.
  select id, period_start, period_end into p from payroll_periods where id = new.period_id;
  if p.id is null then
    raise exception 'That pay period has not been closed yet';
  end if;
  new.period_start := p.period_start;
  new.period_end := p.period_end;

  select coalesce(sum(minutes), 0) into new.minutes
  from payroll_period_lines
  where period_id = new.period_id and cleaner_id = new.subcontractor_id;
  new.minutes := new.minutes + coalesce((
    select sum(minutes) from payroll_adjustments
    where included_in_period_id = new.period_id and cleaner_id = new.subcontractor_id
  ), 0);

  -- Extra lines: [{ "description": text, "amount": number }], up to 20.
  if jsonb_array_length(new.extras) > 20 then
    raise exception 'An invoice can have at most 20 extra lines';
  end if;
  for item in select * from jsonb_array_elements(new.extras) loop
    if jsonb_typeof(item) <> 'object'
       or length(btrim(coalesce(item ->> 'description', ''))) = 0
       or length(item ->> 'description') > 200
       or jsonb_typeof(item -> 'amount') <> 'number' then
      raise exception 'Each extra line needs a description and an amount';
    end if;
    amount := round((item ->> 'amount')::numeric, 2);
    if amount < -10000 or amount > 10000 then
      raise exception 'An extra line cannot be more than £10,000';
    end if;
    extras_sum := extras_sum + amount;
  end loop;

  if new.minutes <= 0 and extras_sum = 0 then
    raise exception 'There is nothing to invoice for that pay period';
  end if;

  new.invoice_number := btrim(new.invoice_number);
  new.hours_amount := round(new.minutes / 60.0 * new.hourly_rate, 2);
  new.extras_total := extras_sum;
  new.subtotal := new.hours_amount + new.extras_total;
  new.vat_amount := round(new.subtotal * new.vat_rate / 100.0, 2);
  new.total := new.subtotal + new.vat_amount;
  if new.vat_rate = 0 then new.vat_number := null; end if;
  if new.vat_rate > 0 and length(btrim(coalesce(new.vat_number, ''))) = 0 then
    raise exception 'Add your VAT number to charge VAT';
  end if;
  new.updated_at := now();

  return new;
end;
$$ language plpgsql security definer set search_path = public;

revoke execute on function subcontractor_invoice_before_write() from public, anon, authenticated;

drop trigger if exists subcontractor_invoice_before_write on subcontractor_invoices;
create trigger subcontractor_invoice_before_write
  before insert or update on subcontractor_invoices
  for each row execute function subcontractor_invoice_before_write();

-- ---------------------------------------------------------------------------
-- Bell notifications
-- ---------------------------------------------------------------------------

create or replace function subcontractor_invoice_notify() returns trigger as $$
declare
  owner_id uuid;
  label text := 'invoice ' || new.invoice_number || ' (£' || to_char(new.total, 'FM999,990.00') || ')';
begin
  select id into owner_id from auth.users where lower(email) = 'jess@crewconnect.ltd' limit 1;

  if tg_op = 'INSERT' or (new.status = 'submitted' and old.status = 'queried') then
    if owner_id is not null then
      insert into notifications (user_id, message)
      values (owner_id, coalesce(nullif(new.subcontractor_name, ''), 'A subcontractor')
        || case when tg_op = 'INSERT' then ' sent ' else ' resent ' end || label);
    end if;
  elsif new.status = 'withdrawn' and old.status <> 'withdrawn' then
    if owner_id is not null then
      insert into notifications (user_id, message)
      values (owner_id, coalesce(nullif(new.subcontractor_name, ''), 'A subcontractor') || ' withdrew ' || label);
    end if;
  elsif new.status is distinct from old.status and new.subcontractor_id is not null then
    insert into notifications (user_id, message)
    values (new.subcontractor_id, case new.status
      when 'approved' then 'Your ' || label || ' has been approved'
      when 'paid' then 'Your ' || label || ' has been paid'
      when 'queried' then 'The office has a question about your ' || label
        || coalesce(': ' || left(new.office_note, 120), '')
      else 'Your ' || label || ' is back with the office'
    end);
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

revoke execute on function subcontractor_invoice_notify() from public, anon, authenticated;

drop trigger if exists subcontractor_invoice_notify on subcontractor_invoices;
create trigger subcontractor_invoice_notify
  after insert or update on subcontractor_invoices
  for each row execute function subcontractor_invoice_notify();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table subcontractor_invoices enable row level security;

drop policy if exists "subcontractor_invoices: own or invoice owner" on subcontractor_invoices;
create policy "subcontractor_invoices: own or invoice owner" on subcontractor_invoices
  for select to authenticated
  using (subcontractor_id = auth.uid() or is_invoice_owner());

drop policy if exists "subcontractor_invoices: own insert" on subcontractor_invoices;
create policy "subcontractor_invoices: own insert" on subcontractor_invoices
  for insert to authenticated
  with check (subcontractor_id = auth.uid());

drop policy if exists "subcontractor_invoices: own or invoice owner update" on subcontractor_invoices;
create policy "subcontractor_invoices: own or invoice owner update" on subcontractor_invoices
  for update to authenticated
  using (subcontractor_id = auth.uid() or is_invoice_owner())
  with check (subcontractor_id = auth.uid() or is_invoice_owner());

-- No delete policy: an invoice is withdrawn, never removed, so what was sent
-- stays on record.

-- ---------------------------------------------------------------------------
-- Their own invoice files
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public) values ('subcontractor-invoices', 'subcontractor-invoices', false)
on conflict (id) do nothing;

-- Files sit under <subcontractor id>/. The person manages their own folder;
-- Jess reads everyone's.
drop policy if exists "subcontractor-invoices: own folder" on storage.objects;
create policy "subcontractor-invoices: own folder" on storage.objects
  for all to authenticated
  using (bucket_id = 'subcontractor-invoices' and split_part(name, '/', 1) = auth.uid()::text)
  with check (bucket_id = 'subcontractor-invoices' and split_part(name, '/', 1) = auth.uid()::text);

drop policy if exists "subcontractor-invoices: invoice owner reads" on storage.objects;
create policy "subcontractor-invoices: invoice owner reads" on storage.objects
  for select to authenticated
  using (bucket_id = 'subcontractor-invoices' and is_invoice_owner());
