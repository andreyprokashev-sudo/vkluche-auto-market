create table if not exists public.auction_audit_log (
  id bigint generated always as identity primary key, auction_id uuid references public.auctions(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null, action text not null, details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.auction_audit_log enable row level security;
create policy "admins_read_auction_audit" on public.auction_audit_log for select using (public.current_role()='admin');

create or replace function public.log_auction_change()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.auction_audit_log(auction_id,actor_id,action,details)
  values(new.id,auth.uid(),case when tg_op='INSERT' then 'created' else 'status_changed' end,jsonb_build_object('status',new.status));
  return new;
end $$;
drop trigger if exists auction_audit on public.auctions;
create trigger auction_audit after insert or update of status on public.auctions for each row execute function public.log_auction_change();

create or replace function public.notify_auction_start()
returns trigger language plpgsql security definer set search_path='' as $$
declare l public.listings;
begin
  select * into l from public.listings where id=new.listing_id;
  if new.status in ('scheduled','active') then
    insert into public.notifications(user_id,type,title,body,auction_id,dedupe_key)
    select w.user_id,case when new.status='active' then 'auction_started' else 'auction_scheduled' end,
      case when new.status='active' then 'Аукцион начался' else 'Аукцион запланирован' end,
      case when new.status='active' then 'Можно сделать предложение' else 'Начало: '||to_char(new.starts_at,'DD.MM.YYYY HH24:MI') end,
      new.id,new.status||':'||new.id||':'||w.user_id from public.auction_watchers w where w.auction_id=new.id on conflict do nothing;
    insert into public.notifications(user_id,type,title,body,auction_id,dedupe_key)
    select s.user_id,'saved_search_match','Новый аукцион по вашему поиску',coalesce(l.data->>'name','Подходящий автомобиль'),new.id,'search:'||new.id||':'||s.user_id
    from public.saved_searches s where
      (not(s.filters ? 'filterBrand') or (s.filters->'filterBrand') ? coalesce(l.data#>>'{details,brand}','')) and
      (not(s.filters ? 'filterCity') or (s.filters->'filterCity') ? coalesce(l.data->>'city',''))
    on conflict do nothing;
  end if; return new;
end $$;

create or replace function public.select_auction_winner(p_auction_id uuid,p_bid_id uuid)
returns public.auctions language plpgsql security definer set search_path='' as $$
declare a public.auctions; l public.listings; b public.auction_bids;
begin
  select * into a from public.auctions where id=p_auction_id for update;
  select * into l from public.listings where id=a.listing_id;
  if not public.can_manage_listing(l) then raise exception 'Недостаточно прав'; end if;
  select * into b from public.auction_bids where id=p_bid_id and auction_id=a.id;
  if b.id is null then raise exception 'Ставка не найдена'; end if;
  update public.auctions set status='winner_selected',winner_bid_id=b.id,updated_at=now() where id=a.id returning * into a;
  insert into public.notifications(user_id,type,title,body,auction_id,dedupe_key)
  values(b.bidder_id,'auction_won','Вы победили в аукционе','Продавец выбрал ваше предложение',a.id,'winner:'||a.id||':'||b.bidder_id) on conflict do nothing;
  insert into public.notifications(user_id,type,title,body,auction_id,dedupe_key)
  select distinct bidder_id,'auction_finished','Аукцион завершён','Выбрано другое предложение',a.id,'finished:'||a.id||':'||bidder_id
  from public.auction_bids where auction_id=a.id and bidder_id<>b.bidder_id on conflict do nothing;
  return a;
end $$;
