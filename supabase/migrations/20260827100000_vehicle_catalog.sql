create table if not exists public.vehicle_catalog (
  id uuid primary key default gen_random_uuid(),
  catalog_key text not null unique,
  brand text not null,
  model text not null,
  generation text not null default '',
  year_from integer,
  year_to integer,
  modification text not null default '',
  trim_name text not null default '',
  body text,
  engine_type text,
  engine_volume numeric,
  power_hp integer,
  gearbox text,
  drive text,
  doors integer,
  seats integer,
  equipment jsonb not null default '[]'::jsonb,
  source text not null default 'feed',
  confidence numeric not null default 0.8,
  updated_at timestamptz not null default now()
);

alter table public.vehicle_catalog enable row level security;
drop policy if exists "vehicle_catalog_is_public" on public.vehicle_catalog;
create policy "vehicle_catalog_is_public" on public.vehicle_catalog
  for select using (true);

create index if not exists vehicle_catalog_lookup_idx
  on public.vehicle_catalog (brand, model, year_from, year_to);

comment on table public.vehicle_catalog is
  'Внутренний справочник ВКЛЮЧЕ, пополняемый фидами и подтвержденными данными; не является результатом проверки автомобиля.';
