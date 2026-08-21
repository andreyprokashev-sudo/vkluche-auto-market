alter table public.listings
  add column if not exists withdrawal_reason text,
  add column if not exists withdrawal_comment text,
  add column if not exists withdrawn_at timestamptz;

alter table public.listings drop constraint if exists listings_withdrawal_reason_check;
alter table public.listings add constraint listings_withdrawal_reason_check check (
  withdrawal_reason is null or withdrawal_reason in (
    'sold_on_platform','sold_elsewhere','temporarily_unavailable',
    'changed_mind','duplicate_or_error','other'
  )
);

create table if not exists public.listing_status_history (
  id bigint generated always as identity primary key,
  listing_id uuid not null references public.listings(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check(action in ('withdrawn','restored')),
  reason text,
  comment text,
  created_at timestamptz not null default now()
);
alter table public.listing_status_history enable row level security;
drop policy if exists "managers_read_listing_history" on public.listing_status_history;
create policy "managers_read_listing_history" on public.listing_status_history for select using (
  exists(select 1 from public.listings l where l.id=listing_id and public.can_manage_listing(l))
);

drop function if exists public.archive_listing(uuid);
create function public.archive_listing(
  p_listing_id uuid,
  p_reason text default 'temporarily_unavailable',
  p_comment text default ''
)
returns public.listings language plpgsql security definer set search_path='' as $$
declare l public.listings; next_status text;
begin
  select * into l from public.listings where id=p_listing_id for update;
  if l.id is null then raise exception 'Объявление не найдено'; end if;
  if not public.can_manage_listing(l) then raise exception 'Недостаточно прав'; end if;
  if p_reason not in ('sold_on_platform','sold_elsewhere','temporarily_unavailable','changed_mind','duplicate_or_error','other') then raise exception 'Выберите причину снятия'; end if;
  if p_reason='other' and length(trim(coalesce(p_comment,'')))=0 then raise exception 'Укажите причину в комментарии'; end if;
  if exists(select 1 from public.auctions a where a.listing_id=l.id and a.status in ('scheduled','active','awaiting_seller','awaiting_buyer')) then raise exception 'Сначала завершите аукцион по этому автомобилю'; end if;
  next_status=case when p_reason in ('sold_on_platform','sold_elsewhere') then 'sold' else 'archived' end;
  update public.listings set active=false,status=next_status,withdrawal_reason=p_reason,
    withdrawal_comment=left(trim(coalesce(p_comment,'')),500),withdrawn_at=now(),updated_at=now()
  where id=l.id returning * into l;
  insert into public.listing_status_history(listing_id,actor_id,action,reason,comment)
  values(l.id,auth.uid(),'withdrawn',p_reason,left(trim(coalesce(p_comment,'')),500));
  return l;
end $$;

create or replace function public.restore_listing(p_listing_id uuid)
returns public.listings language plpgsql security definer set search_path='' as $$
declare l public.listings;
begin
  select * into l from public.listings where id=p_listing_id for update;
  if l.id is null then raise exception 'Объявление не найдено'; end if;
  if not public.can_manage_listing(l) then raise exception 'Недостаточно прав'; end if;
  if l.status<>'archived' then raise exception 'Восстановить можно только объявление из архива'; end if;
  update public.listings set active=true,status='published',withdrawal_reason=null,
    withdrawal_comment=null,withdrawn_at=null,updated_at=now()
  where id=l.id returning * into l;
  insert into public.listing_status_history(listing_id,actor_id,action)
  values(l.id,auth.uid(),'restored');
  return l;
end $$;
