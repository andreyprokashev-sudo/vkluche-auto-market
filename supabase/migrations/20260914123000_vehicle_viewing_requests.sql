create table if not exists public.vehicle_viewing_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  listing_id uuid not null references public.listings(id) on delete cascade,
  seller_id uuid not null references auth.users(id) on delete cascade,
  preferred_at timestamptz not null,
  alternate_at timestamptz,
  phone text not null,
  comment text,
  status text not null default 'requested' check (status in ('requested','confirmed','reschedule','completed','cancelled')),
  seller_note text,
  personal_data_consent boolean not null default false check (personal_data_consent),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (preferred_at > created_at)
);

create or replace function public.set_viewing_request_seller() returns trigger language plpgsql security definer set search_path=public as $$
begin
  select owner_id into new.seller_id from public.listings where id=new.listing_id and active=true and status='published';
  if new.seller_id is null then raise exception 'Объявление недоступно для записи на осмотр'; end if;
  if new.seller_id=auth.uid() then raise exception 'Нельзя записаться на осмотр собственного автомобиля'; end if;
  new.user_id=auth.uid();
  return new;
end $$;
drop trigger if exists set_viewing_request_seller_trigger on public.vehicle_viewing_requests;
create trigger set_viewing_request_seller_trigger before insert on public.vehicle_viewing_requests for each row execute function public.set_viewing_request_seller();

alter table public.vehicle_viewing_requests enable row level security;
drop policy if exists "viewing insert own" on public.vehicle_viewing_requests;
create policy "viewing insert own" on public.vehicle_viewing_requests for insert to authenticated with check (user_id=auth.uid());
drop policy if exists "viewing read parties" on public.vehicle_viewing_requests;
create policy "viewing read parties" on public.vehicle_viewing_requests for select to authenticated using (user_id=auth.uid() or seller_id=auth.uid() or public.current_role()='admin');
drop policy if exists "viewing seller update" on public.vehicle_viewing_requests;
create policy "viewing seller update" on public.vehicle_viewing_requests for update to authenticated using (seller_id=auth.uid() or public.current_role()='admin') with check (seller_id=auth.uid() or public.current_role()='admin');
create unique index if not exists viewing_active_user_listing_idx on public.vehicle_viewing_requests(user_id,listing_id) where status in ('requested','confirmed','reschedule');
create index if not exists viewing_seller_created_idx on public.vehicle_viewing_requests(seller_id,created_at desc);
grant select,insert,update on public.vehicle_viewing_requests to authenticated;
