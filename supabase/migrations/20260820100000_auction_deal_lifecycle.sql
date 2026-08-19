alter table public.auctions drop constraint if exists auctions_status_check;
update public.auctions set status='awaiting_seller',winner_bid_id=null,updated_at=now() where status='winner_selected';
alter table public.auctions add constraint auctions_status_check check (status in (
  'scheduled','active','awaiting_seller','awaiting_buyer','deal_confirmed','no_sale','cancelled'
));

create table if not exists public.auction_deals (
  id uuid primary key default gen_random_uuid(),
  auction_id uuid not null references public.auctions(id) on delete cascade,
  bid_id uuid not null references public.auction_bids(id) on delete cascade,
  seller_id uuid references auth.users(id) on delete set null,
  buyer_id uuid not null references auth.users(id) on delete cascade,
  amount bigint not null check (amount > 0),
  status text not null check (status in ('awaiting_buyer','confirmed','declined','expired','cancelled')),
  response_deadline timestamptz not null,
  selected_at timestamptz not null default now(),
  responded_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists auction_deals_one_open_idx on public.auction_deals(auction_id) where status='awaiting_buyer';
create index if not exists auction_deals_deadline_idx on public.auction_deals(status,response_deadline);

alter table public.auction_deals enable row level security;
drop policy if exists "participants_read_auction_deals" on public.auction_deals;
create policy "participants_read_auction_deals" on public.auction_deals for select using (
  buyer_id=auth.uid() or seller_id=auth.uid() or public.current_role()='admin'
);

drop policy if exists "admins_read_auction_audit" on public.auction_audit_log;
drop policy if exists "participants_read_auction_audit" on public.auction_audit_log;
create policy "participants_read_auction_audit" on public.auction_audit_log for select using (
  public.current_role()='admin' or exists (
    select 1 from public.auctions a
    where a.id=auction_id and (
      a.seller_id=auth.uid() or exists (
        select 1 from public.auction_bids b where b.auction_id=a.id and b.bidder_id=auth.uid()
      )
    )
  )
);

create or replace function public.offer_next_auction_bid(p_auction_id uuid)
returns public.auction_deals language plpgsql security definer set search_path='' as $$
declare a public.auctions; b public.auction_bids; d public.auction_deals;
begin
  select * into a from public.auctions where id=p_auction_id for update;
  select b0.* into b from public.auction_bids b0
  where b0.auction_id=a.id
    and not exists (
      select 1 from public.auction_deals d0
      where d0.auction_id=a.id and d0.buyer_id=b0.bidder_id and d0.status in ('declined','expired')
    )
  order by b0.amount desc,b0.created_at asc limit 1;
  if b.id is null then
    update public.auctions set status='no_sale',winner_bid_id=null,updated_at=now() where id=a.id;
    insert into public.auction_audit_log(auction_id,action,details)
      values(a.id,'no_sale',jsonb_build_object('reason','no_available_bids'));
    return null;
  end if;
  update public.auctions set status='awaiting_buyer',winner_bid_id=b.id,updated_at=now() where id=a.id;
  insert into public.auction_deals(auction_id,bid_id,seller_id,buyer_id,amount,status,response_deadline)
    values(a.id,b.id,a.seller_id,b.bidder_id,b.amount,'awaiting_buyer',now()+interval '24 hours') returning * into d;
  insert into public.auction_audit_log(auction_id,action,details)
    values(a.id,'buyer_selected',jsonb_build_object('bid_id',b.id,'amount',b.amount,'deadline',d.response_deadline));
  insert into public.notifications(user_id,type,title,body,auction_id,dedupe_key)
    values(b.bidder_id,'auction_offer','Ваше предложение выбрано','Подтвердите покупку в течение 24 часов',a.id,'offer:'||d.id) on conflict do nothing;
  return d;
end $$;

drop function if exists public.select_auction_winner(uuid,uuid);
create function public.select_auction_winner(p_auction_id uuid,p_bid_id uuid)
returns public.auction_deals language plpgsql security definer set search_path='' as $$
declare a public.auctions; l public.listings; b public.auction_bids; d public.auction_deals;
begin
  select * into a from public.auctions where id=p_auction_id for update;
  select * into l from public.listings where id=a.listing_id;
  if not public.can_manage_listing(l) then raise exception 'Недостаточно прав'; end if;
  if a.status not in ('awaiting_seller','no_sale') or now()<a.ends_at then raise exception 'Выбрать покупателя можно только после завершения торгов'; end if;
  if exists(select 1 from public.auction_deals where auction_id=a.id and status='awaiting_buyer') then raise exception 'Ответ выбранного покупателя ещё не получен'; end if;
  select * into b from public.auction_bids where id=p_bid_id and auction_id=a.id;
  if b.id is null then raise exception 'Ставка не найдена'; end if;
  if exists(select 1 from public.auction_deals where auction_id=a.id and buyer_id=b.bidder_id and status in ('declined','expired')) then raise exception 'Этот покупатель уже отказался или не ответил'; end if;
  update public.auctions set status='awaiting_buyer',winner_bid_id=b.id,updated_at=now() where id=a.id;
  insert into public.auction_deals(auction_id,bid_id,seller_id,buyer_id,amount,status,response_deadline)
    values(a.id,b.id,a.seller_id,b.bidder_id,b.amount,'awaiting_buyer',now()+interval '24 hours') returning * into d;
  insert into public.auction_audit_log(auction_id,actor_id,action,details)
    values(a.id,auth.uid(),'buyer_selected',jsonb_build_object('bid_id',b.id,'amount',b.amount,'deadline',d.response_deadline));
  insert into public.notifications(user_id,type,title,body,auction_id,dedupe_key)
    values(b.bidder_id,'auction_offer','Ваше предложение выбрано','Подтвердите покупку в течение 24 часов',a.id,'offer:'||d.id) on conflict do nothing;
  return d;
end $$;

revoke execute on function public.offer_next_auction_bid(uuid) from public,anon,authenticated;

create or replace function public.respond_to_auction_offer(p_deal_id uuid,p_accept boolean)
returns public.auction_deals language plpgsql security definer set search_path='' as $$
declare d public.auction_deals; a public.auctions;
begin
  select * into d from public.auction_deals where id=p_deal_id for update;
  if d.id is null or d.buyer_id<>auth.uid() then raise exception 'Предложение не найдено'; end if;
  if d.status<>'awaiting_buyer' or now()>=d.response_deadline then raise exception 'Срок ответа истёк'; end if;
  if p_accept then
    update public.auction_deals set status='confirmed',responded_at=now() where id=d.id returning * into d;
    update public.auctions set status='deal_confirmed',updated_at=now() where id=d.auction_id returning * into a;
    insert into public.auction_audit_log(auction_id,actor_id,action,details) values(d.auction_id,auth.uid(),'buyer_confirmed',jsonb_build_object('amount',d.amount));
    insert into public.notifications(user_id,type,title,body,auction_id,dedupe_key)
      values(d.seller_id,'deal_confirmed','Покупатель подтвердил сделку','Можно связаться и согласовать осмотр и оформление',d.auction_id,'confirmed:'||d.id) on conflict do nothing;
  else
    update public.auction_deals set status='declined',responded_at=now() where id=d.id returning * into d;
    insert into public.auction_audit_log(auction_id,actor_id,action,details) values(d.auction_id,auth.uid(),'buyer_declined',jsonb_build_object('amount',d.amount));
    perform public.offer_next_auction_bid(d.auction_id);
  end if;
  return d;
end $$;

create or replace function public.close_auction_without_sale(p_auction_id uuid)
returns public.auctions language plpgsql security definer set search_path='' as $$
declare a public.auctions; l public.listings;
begin
  select * into a from public.auctions where id=p_auction_id for update;
  select * into l from public.listings where id=a.listing_id;
  if not public.can_manage_listing(l) then raise exception 'Недостаточно прав'; end if;
  if a.status not in ('awaiting_seller','no_sale') then raise exception 'Аукцион нельзя завершить на этом этапе'; end if;
  update public.auctions set status='no_sale',winner_bid_id=null,updated_at=now() where id=a.id returning * into a;
  insert into public.auction_audit_log(auction_id,actor_id,action,details) values(a.id,auth.uid(),'closed_without_sale','{}');
  return a;
end $$;

create or replace function public.advance_auction_statuses()
returns void language plpgsql security definer set search_path='' as $$
declare expired_deal record;
begin
  update public.auctions set status='active',updated_at=now() where status='scheduled' and starts_at<=now();
  update public.auctions a set status=case when exists(select 1 from public.auction_bids b where b.auction_id=a.id) then 'awaiting_seller' else 'no_sale' end,updated_at=now()
    where a.status='active' and a.ends_at<=now();
  for expired_deal in select id,auction_id from public.auction_deals where status='awaiting_buyer' and response_deadline<=now() for update skip locked loop
    update public.auction_deals set status='expired',responded_at=now() where id=expired_deal.id;
    insert into public.auction_audit_log(auction_id,action,details) values(expired_deal.auction_id,'buyer_response_expired','{}');
    perform public.offer_next_auction_bid(expired_deal.auction_id);
  end loop;
  perform public.generate_auction_reminders();
end $$;
