create table if not exists public.trade_in_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  target_listing_id uuid references public.listings(id) on delete set null,
  target_vehicle text,
  brand text not null,
  model text not null,
  production_year integer not null check (production_year between 1950 and 2100),
  mileage integer not null check (mileage >= 0),
  city text not null,
  condition text not null default 'good' check (condition in ('excellent','good','requires_repair','damaged')),
  phone text not null,
  comment text,
  status text not null default 'new' check (status in ('new','contacted','inspection','valued','accepted','declined','closed')),
  estimated_price bigint check (estimated_price is null or estimated_price >= 0),
  personal_data_consent boolean not null default false check (personal_data_consent),
  consent_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.trade_in_requests enable row level security;
drop policy if exists "trade in insert own" on public.trade_in_requests;
create policy "trade in insert own" on public.trade_in_requests for insert to authenticated with check (user_id=auth.uid());
drop policy if exists "trade in read own or admin" on public.trade_in_requests;
create policy "trade in read own or admin" on public.trade_in_requests for select to authenticated using (user_id=auth.uid() or public.current_role()='admin');
drop policy if exists "trade in update admin" on public.trade_in_requests;
create policy "trade in update admin" on public.trade_in_requests for update to authenticated using (public.current_role()='admin') with check (public.current_role()='admin');
create index if not exists trade_in_requests_user_created_idx on public.trade_in_requests(user_id,created_at desc);
create index if not exists trade_in_requests_status_created_idx on public.trade_in_requests(status,created_at desc);

grant select,insert on public.trade_in_requests to authenticated;
grant update on public.trade_in_requests to authenticated;
