create table if not exists public.service_programs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  program_type text not null check (program_type in ('warranty','roadside','maintenance','inspection','return','other')),
  name text not null check (char_length(name) between 2 and 120),
  description text not null check (char_length(description) between 3 and 1200),
  duration_months integer check (duration_months is null or duration_months between 1 and 120),
  mileage_limit integer check (mileage_limit is null or mileage_limit >= 0),
  provider_name text,
  terms_url text check (terms_url is null or terms_url ~ '^https?://'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.listing_service_programs (
  listing_id uuid not null references public.listings(id) on delete cascade,
  program_id uuid not null references public.service_programs(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key(listing_id,program_id)
);
alter table public.service_programs enable row level security;
alter table public.listing_service_programs enable row level security;
create policy "service programs public read" on public.service_programs for select using (active or public.can_manage_organization(organization_id));
create policy "service programs organization manage" on public.service_programs for all using (public.can_manage_organization(organization_id)) with check (public.can_manage_organization(organization_id));
create policy "listing programs public read" on public.listing_service_programs for select using (true);
create policy "listing programs organization manage" on public.listing_service_programs for all using (exists(select 1 from public.listings l where l.id=listing_id and public.can_manage_organization(l.organization_id))) with check (exists(select 1 from public.listings l join public.service_programs p on p.id=program_id where l.id=listing_id and l.organization_id=p.organization_id and public.can_manage_organization(l.organization_id)));
grant select,insert,update,delete on public.service_programs,public.listing_service_programs to authenticated;
grant select on public.service_programs,public.listing_service_programs to anon;

create or replace function public.public_listing_service_programs(p_listing_id uuid) returns table(id uuid,program_type text,name text,description text,duration_months integer,mileage_limit integer,provider_name text,terms_url text) language sql stable security definer set search_path=public as $$
  select p.id,p.program_type,p.name,p.description,p.duration_months,p.mileage_limit,p.provider_name,p.terms_url from public.listing_service_programs a join public.service_programs p on p.id=a.program_id where a.listing_id=p_listing_id and p.active order by p.program_type,p.name
$$;
grant execute on function public.public_listing_service_programs(uuid) to anon,authenticated;
