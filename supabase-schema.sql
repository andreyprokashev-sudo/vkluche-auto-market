-- Выполните этот файл один раз в Supabase SQL Editor.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  role text not null default 'buyer' check (role in ('buyer', 'seller', 'admin')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles_are_publicly_readable" on public.profiles;
create policy "profiles_are_publicly_readable"
on public.profiles for select using (true);

drop policy if exists "users_update_own_profile" on public.profiles;
create policy "users_update_own_profile"
on public.profiles for update using (auth.uid() = id)
with check (auth.uid() = id and role in ('buyer', 'seller'));

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    case when new.raw_user_meta_data ->> 'role' = 'seller' then 'seller' else 'buyer' end
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Администратора назначайте только вручную в SQL Editor:
-- update public.profiles set role = 'admin' where id = '<user uuid>';

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists(select 1 from public.profiles where id = auth.uid() and role = 'admin') $$;

create table if not exists public.feed_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  url text not null unique check (url ~ '^https?://'),
  interval_minutes integer not null default 60 check (interval_minutes between 15 and 10080),
  missing_threshold integer not null default 2 check (missing_threshold between 1 and 10),
  active boolean not null default true,
  last_run_at timestamptz,
  last_success_at timestamptz,
  last_status text,
  last_error text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.listings (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references public.feed_sources(id) on delete cascade,
  external_id text not null,
  data jsonb not null,
  active boolean not null default true,
  missing_runs integer not null default 0,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_id, external_id)
);

create table if not exists public.feed_import_runs (
  id bigint generated always as identity primary key,
  source_id uuid references public.feed_sources(id) on delete cascade,
  status text not null check (status in ('running', 'success', 'error')),
  total integer not null default 0,
  added integer not null default 0,
  updated integer not null default 0,
  hidden integer not null default 0,
  errors jsonb not null default '[]'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

alter table public.feed_sources enable row level security;
alter table public.listings enable row level security;
alter table public.feed_import_runs enable row level security;

drop policy if exists "active_listings_are_public" on public.listings;
create policy "active_listings_are_public" on public.listings for select using (active);
drop policy if exists "admins_manage_listings" on public.listings;
create policy "admins_manage_listings" on public.listings for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admins_manage_feed_sources" on public.feed_sources;
create policy "admins_manage_feed_sources" on public.feed_sources for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admins_read_import_runs" on public.feed_import_runs;
create policy "admins_read_import_runs" on public.feed_import_runs for select using (public.is_admin());
create index if not exists listings_active_idx on public.listings(active);
create index if not exists listings_source_idx on public.listings(source_id, external_id);

-- После публикации Edge Function создайте в Dashboard задачу Cron:
-- расписание: 0 * * * * (каждый час)
-- метод: POST
-- URL: https://whlszhqkmvfwynwgiqnq.supabase.co/functions/v1/import-feeds
-- заголовок x-cron-secret должен совпадать с секретом CRON_SECRET функции.
