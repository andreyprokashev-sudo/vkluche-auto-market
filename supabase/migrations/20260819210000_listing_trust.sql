alter table public.listings
  add column if not exists status text not null default 'published',
  add column if not exists verification_status text not null default 'unverified',
  add column if not exists vin text,
  add column if not exists registration_plate text,
  add column if not exists moderation_note text;

alter table public.listings drop constraint if exists listings_status_check;
alter table public.listings add constraint listings_status_check
  check (status in ('draft','pending','published','rejected','sold','archived'));
alter table public.listings drop constraint if exists listings_verification_status_check;
alter table public.listings add constraint listings_verification_status_check
  check (verification_status in ('unverified','submitted','verified','failed'));
alter table public.listings drop constraint if exists listings_vin_check;
alter table public.listings add constraint listings_vin_check
  check (vin is null or vin ~ '^[A-HJ-NPR-Z0-9]{17}$');

drop policy if exists "active_listings_are_public" on public.listings;
drop policy if exists "published_listings_are_public" on public.listings;
create policy "published_listings_are_public" on public.listings for select
using ((active and status='published') or owner_id=auth.uid() or public.current_role()='admin');

create index if not exists listings_public_catalog_idx
  on public.listings(status,active,updated_at desc);
create index if not exists listings_vin_idx on public.listings(vin) where vin is not null;
