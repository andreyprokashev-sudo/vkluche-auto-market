create table if not exists public.auction_participant_actions (
  id uuid primary key default gen_random_uuid(),
  auction_id uuid not null references public.auctions(id) on delete cascade,
  seller_id uuid references auth.users(id) on delete set null,
  participant_id uuid references auth.users(id) on delete set null,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('blocked','unblocked')),
  reason text,
  blocked_until timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists auction_participant_actions_auction_idx on public.auction_participant_actions(auction_id,created_at desc);
alter table public.auction_participant_actions enable row level security;
drop policy if exists "auction_managers_read_participant_actions" on public.auction_participant_actions;
create policy "auction_managers_read_participant_actions" on public.auction_participant_actions for select using (
  seller_id=auth.uid() or participant_id=auth.uid() or public.current_role()='admin'
);

create or replace function public.auction_participant_summaries(p_auction_id uuid)
returns table(bid_id uuid,participant_id uuid,account_type text,verified boolean,wins integer,declines integer,reliability_score integer,is_blocked boolean,blocked_until timestamptz,last_action text,last_reason text)
language plpgsql security definer set search_path='' as $$
declare a public.auctions;l public.listings;
begin
  select * into a from public.auctions where id=p_auction_id;
  select * into l from public.listings where id=a.listing_id;
  if a.id is null or not public.can_manage_listing(l) then raise exception 'Недостаточно прав'; end if;
  return query
  select b.id,b.bidder_id,p.account_type,coalesce(p.auction_verified,false),coalesce(p.auction_wins,0),coalesce(p.auction_declines,0),
    case when coalesce(p.auction_wins,0)+coalesce(p.auction_declines,0)=0 then 100 else round(100.0*coalesce(p.auction_wins,0)/(coalesce(p.auction_wins,0)+coalesce(p.auction_declines,0)))::integer end,
    (bl.user_id is not null),bl.blocked_until,pa.action,pa.reason
  from public.auction_bids b join public.profiles p on p.id=b.bidder_id
  left join public.auction_participant_blocks bl on bl.auction_seller_id=a.seller_id and bl.user_id=b.bidder_id and (bl.blocked_until is null or bl.blocked_until>now())
  left join lateral(select x.action,x.reason from public.auction_participant_actions x where x.auction_id=a.id and x.participant_id=b.bidder_id order by x.created_at desc limit 1)pa on true
  where b.auction_id=a.id order by b.amount desc,b.created_at;
end $$;

create or replace function public.manage_auction_participant(p_auction_id uuid,p_bid_id uuid,p_action text,p_days integer default 30,p_reason text default '')
returns void language plpgsql security definer set search_path='' as $$
declare a public.auctions;l public.listings;b public.auction_bids;until_at timestamptz;
begin
  select * into a from public.auctions where id=p_auction_id;
  select * into l from public.listings where id=a.listing_id;
  select * into b from public.auction_bids where id=p_bid_id and auction_id=a.id;
  if a.id is null or b.id is null or not public.can_manage_listing(l) then raise exception 'Недостаточно прав'; end if;
  if p_action not in ('blocked','unblocked') then raise exception 'Некорректное действие'; end if;
  if p_action='blocked' then
    if length(trim(coalesce(p_reason,'')))<3 then raise exception 'Укажите причину ограничения'; end if;
    until_at=case when p_days=0 then null else now()+make_interval(days=>least(greatest(p_days,1),365)) end;
    insert into public.auction_participant_blocks(auction_seller_id,user_id,reason,blocked_until)
      values(a.seller_id,b.bidder_id,trim(p_reason),until_at)
      on conflict(auction_seller_id,user_id) do update set reason=excluded.reason,blocked_until=excluded.blocked_until,created_at=now();
  else
    delete from public.auction_participant_blocks where auction_seller_id=a.seller_id and user_id=b.bidder_id;
  end if;
  insert into public.auction_participant_actions(auction_id,seller_id,participant_id,actor_id,action,reason,blocked_until)
    values(a.id,a.seller_id,b.bidder_id,auth.uid(),p_action,nullif(trim(coalesce(p_reason,'')),''),until_at);
end $$;
grant execute on function public.auction_participant_summaries(uuid) to authenticated;
grant execute on function public.manage_auction_participant(uuid,uuid,text,integer,text) to authenticated;
