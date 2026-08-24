create or replace function public.update_auction_reliability()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.status='awaiting_buyer' and new.status='confirmed' then
    update public.profiles set auction_wins=auction_wins+1 where id=new.buyer_id;
  elsif old.status='awaiting_buyer' and new.status in ('declined','expired') then
    update public.profiles set auction_declines=auction_declines+1,
      auction_ban_until=case when auction_declines+1>=3 then greatest(coalesce(auction_ban_until,now()),now()+interval '30 days') else auction_ban_until end
    where id=new.buyer_id;
  end if;
  return new;
end $$;

create or replace function public.block_auction_participant(p_auction_id uuid,p_bid_id uuid,p_days integer default 30)
returns void language plpgsql security definer set search_path='' as $$
declare a public.auctions; b public.auction_bids; l public.listings;
begin
  select * into a from public.auctions where id=p_auction_id;
  select * into l from public.listings where id=a.listing_id;
  if not public.can_manage_listing(l) then raise exception 'Недостаточно прав'; end if;
  select * into b from public.auction_bids where id=p_bid_id and auction_id=a.id;
  if b.id is null then raise exception 'Участник не найден'; end if;
  insert into public.auction_participant_blocks(auction_seller_id,user_id,reason,blocked_until)
    values(a.seller_id,b.bidder_id,'Решение продавца',case when p_days>0 then now()+make_interval(days=>least(p_days,365)) end)
    on conflict(auction_seller_id,user_id) do update set reason=excluded.reason,blocked_until=excluded.blocked_until,created_at=now();
end $$;
