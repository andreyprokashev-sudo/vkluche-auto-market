create table if not exists public.credit_applications(
  id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
  listing_id uuid references public.listings(id) on delete set null,vehicle_name text not null,vehicle_price numeric not null,
  down_payment numeric not null default 0,term_months integer not null,interest_rate numeric not null,
  estimated_monthly_payment numeric not null,full_name text not null,phone text not null,email text not null,region text not null,
  employment text not null default 'other',monthly_income numeric,personal_data_consent boolean not null,
  consent_at timestamptz not null,status text not null default 'new' check(status in ('new','contacted','documents','sent_to_partner','approved','declined','completed')),
  admin_note text not null default '',created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
alter table public.credit_applications enable row level security;
create policy "users_create_credit_applications" on public.credit_applications for insert with check(user_id=auth.uid() and personal_data_consent);
create policy "users_read_own_credit_applications" on public.credit_applications for select using(user_id=auth.uid() or public.current_role()='admin');
create policy "admins_update_credit_applications" on public.credit_applications for update using(public.current_role()='admin') with check(public.current_role()='admin');
