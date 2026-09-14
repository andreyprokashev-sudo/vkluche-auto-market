create table if not exists public.listing_reservations (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  buyer_id uuid not null references auth.users(id) on delete cascade,
  seller_id uuid not null references auth.users(id) on delete cascade,
  requested_hours integer not null check (requested_hours in (2,4,12,24,48)),
  phone text not null,
  comment text,
  status text not null default 'requested' check (status in ('requested','confirmed','rejected','cancelled','expired')),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_reservation_parties() returns trigger language plpgsql security definer set search_path=public as $$
begin
  select owner_id into new.seller_id from public.listings where id=new.listing_id and active=true and status='published';
  if new.seller_id is null then raise exception 'Объявление недоступно для бронирования'; end if;
  new.buyer_id=auth.uid();
  if new.seller_id=new.buyer_id then raise exception 'Нельзя забронировать собственный автомобиль'; end if;
  if exists(select 1 from public.listing_reservations where listing_id=new.listing_id and buyer_id=new.buyer_id and status in ('requested','confirmed') and (expires_at is null or expires_at>now())) then raise exception 'У вас уже есть активный запрос на этот автомобиль'; end if;
  return new;
end $$;
drop trigger if exists set_reservation_parties_trigger on public.listing_reservations;
create trigger set_reservation_parties_trigger before insert on public.listing_reservations for each row execute function public.set_reservation_parties();

create or replace function public.respond_to_reservation(p_reservation_id uuid,p_accept boolean) returns public.listing_reservations language plpgsql security definer set search_path=public as $$
declare r public.listing_reservations;
begin
  select * into r from public.listing_reservations where id=p_reservation_id for update;
  if r.id is null or (auth.uid()<>r.seller_id and public.current_role()<>'admin') then raise exception 'Нет доступа к бронированию'; end if;
  if r.status<>'requested' then raise exception 'Запрос уже обработан'; end if;
  if p_accept and exists(select 1 from public.listing_reservations where listing_id=r.listing_id and status='confirmed' and expires_at>now()) then raise exception 'Автомобиль уже забронирован'; end if;
  update public.listing_reservations set status=case when p_accept then 'confirmed' else 'rejected' end,expires_at=case when p_accept then now()+(requested_hours||' hours')::interval else null end,updated_at=now() where id=r.id returning * into r;
  if p_accept then update public.listing_reservations set status='rejected',updated_at=now() where listing_id=r.listing_id and id<>r.id and status='requested'; end if;
  return r;
end $$;

alter table public.listing_reservations enable row level security;
create policy "reservation insert own" on public.listing_reservations for insert to authenticated with check (buyer_id=auth.uid());
create policy "reservation read parties" on public.listing_reservations for select to authenticated using (buyer_id=auth.uid() or seller_id=auth.uid() or public.current_role()='admin');
create policy "reservation buyer cancel" on public.listing_reservations for update to authenticated using (buyer_id=auth.uid() and status in ('requested','confirmed')) with check (buyer_id=auth.uid() and status='cancelled');
create index if not exists reservations_listing_idx on public.listing_reservations(listing_id,created_at desc);
create index if not exists reservations_parties_idx on public.listing_reservations(buyer_id,seller_id,created_at desc);
grant select,insert,update on public.listing_reservations to authenticated;
grant execute on function public.respond_to_reservation(uuid,boolean) to authenticated;
