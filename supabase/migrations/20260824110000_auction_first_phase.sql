alter table public.auctions
  add column if not exists winner_mode text not null default 'seller_choice'
  check (winner_mode in ('highest','seller_choice'));

create or replace function public.start_auction(
  p_listing_id uuid,
  p_start_price bigint,
  p_reserve_price bigint,
  p_bid_step bigint,
  p_starts_at timestamptz,
  p_duration_minutes integer,
  p_auto_extend boolean,
  p_winner_mode text default 'highest'
)
returns public.auctions language plpgsql security definer set search_path='' as $$
declare l public.listings; a public.auctions;
begin
  select * into l from public.listings where id=p_listing_id and active for update;
  if l.id is null then raise exception 'Объявление не найдено'; end if;
  if not public.can_manage_listing(l) then raise exception 'Недостаточно прав для запуска аукциона'; end if;
  if p_start_price < 1 or p_bid_step < 1 or p_duration_minutes not between 30 and 10080 then raise exception 'Некорректные параметры аукциона'; end if;
  if p_reserve_price > 0 and p_reserve_price < p_start_price then raise exception 'Резервная цена ниже стартовой'; end if;
  if p_winner_mode not in ('highest','seller_choice') then raise exception 'Некорректное правило определения победителя'; end if;
  insert into public.auctions(listing_id,seller_id,created_by,status,start_price,reserve_price,bid_step,starts_at,ends_at,auto_extend,winner_mode)
  values(l.id,l.owner_id,auth.uid(),case when p_starts_at>now() then 'scheduled' else 'active' end,p_start_price,p_reserve_price,p_bid_step,p_starts_at,p_starts_at+make_interval(mins=>p_duration_minutes),p_auto_extend,p_winner_mode)
  on conflict(listing_id) do update set created_by=auth.uid(),status=excluded.status,start_price=excluded.start_price,reserve_price=excluded.reserve_price,bid_step=excluded.bid_step,starts_at=excluded.starts_at,ends_at=excluded.ends_at,auto_extend=excluded.auto_extend,winner_mode=excluded.winner_mode,winner_bid_id=null,updated_at=now()
  returning * into a;
  return a;
end $$;

create or replace function public.advance_auction_statuses()
returns void language plpgsql security definer set search_path='' as $$
declare expired_deal record; ended_auction record; best_amount bigint;
begin
  update public.auctions set status='active',updated_at=now() where status='scheduled' and starts_at<=now();
  for ended_auction in select * from public.auctions where status='active' and ends_at<=now() for update skip locked loop
    select max(amount) into best_amount from public.auction_bids where auction_id=ended_auction.id;
    if best_amount is null or (ended_auction.reserve_price>0 and best_amount<ended_auction.reserve_price) then
      update public.auctions set status='no_sale',updated_at=now() where id=ended_auction.id;
    else
      update public.auctions set status='awaiting_seller',updated_at=now() where id=ended_auction.id;
      if ended_auction.winner_mode='highest' then perform public.offer_next_auction_bid(ended_auction.id); end if;
    end if;
  end loop;
  for expired_deal in select id,auction_id from public.auction_deals where status='awaiting_buyer' and response_deadline<=now() for update skip locked loop
    update public.auction_deals set status='expired',responded_at=now() where id=expired_deal.id;
    insert into public.auction_audit_log(auction_id,action,details) values(expired_deal.auction_id,'buyer_response_expired','{}');
    perform public.offer_next_auction_bid(expired_deal.auction_id);
  end loop;
  perform public.generate_auction_reminders();
end $$;

