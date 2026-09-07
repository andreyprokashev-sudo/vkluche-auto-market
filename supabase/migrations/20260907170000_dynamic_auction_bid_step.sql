alter table public.auctions
  add column if not exists bid_step_mode text not null default 'fixed';
alter table public.auctions drop constraint if exists auctions_bid_step_mode_check;
alter table public.auctions add constraint auctions_bid_step_mode_check check (bid_step_mode in ('fixed','dynamic'));

create or replace function public.auction_effective_bid_step(p_auction public.auctions,p_current_price bigint)
returns bigint language sql immutable set search_path='' as $$
  select case when p_auction.bid_step_mode='fixed' then p_auction.bid_step else
    case
      when p_current_price < 1000000 then 10000
      when p_current_price < 3000000 then 25000
      when p_current_price < 7000000 then 50000
      else 100000
    end
  end
$$;

create or replace function public.start_auction_v2(p_listing_id uuid,p_start_price bigint,p_reserve_price bigint,p_bid_step bigint,p_bid_step_mode text,p_starts_at timestamptz,p_duration_minutes integer,p_auto_extend boolean,p_winner_mode text,p_participant_access text)
returns public.auctions language plpgsql security definer set search_path='' as $$
declare l public.listings;a public.auctions;effective_seller uuid;
begin
  select * into l from public.listings where id=p_listing_id and active for update;
  if l.id is null then raise exception 'Объявление не найдено';end if;
  if not public.can_manage_listing(l) then raise exception 'Недостаточно прав для запуска аукциона';end if;
  if p_start_price<1 or p_bid_step<1 or p_duration_minutes not between 30 and 10080 then raise exception 'Некорректные параметры аукциона';end if;
  if p_bid_step_mode not in ('fixed','dynamic') then raise exception 'Некорректный режим шага';end if;
  if p_reserve_price>0 and p_reserve_price<p_start_price then raise exception 'Резервная цена ниже стартовой';end if;
  if p_winner_mode not in ('highest','seller_choice') or p_participant_access not in ('all_verified','professional') then raise exception 'Некорректные правила аукциона';end if;
  effective_seller=coalesce(l.owner_id,auth.uid());
  insert into public.auctions(listing_id,seller_id,created_by,status,start_price,reserve_price,bid_step,bid_step_mode,starts_at,ends_at,auto_extend,winner_mode,participant_access)
  values(l.id,effective_seller,auth.uid(),case when p_starts_at>now() then 'scheduled' else 'active' end,p_start_price,p_reserve_price,p_bid_step,p_bid_step_mode,p_starts_at,p_starts_at+make_interval(mins=>p_duration_minutes),p_auto_extend,p_winner_mode,p_participant_access)
  on conflict(listing_id) do update set seller_id=effective_seller,created_by=auth.uid(),status=excluded.status,start_price=excluded.start_price,reserve_price=excluded.reserve_price,bid_step=excluded.bid_step,bid_step_mode=excluded.bid_step_mode,starts_at=excluded.starts_at,ends_at=excluded.ends_at,auto_extend=excluded.auto_extend,winner_mode=excluded.winner_mode,participant_access=excluded.participant_access,winner_bid_id=null,updated_at=now()
  returning * into a;return a;
end $$;
grant execute on function public.start_auction_v2(uuid,bigint,bigint,bigint,text,timestamptz,integer,boolean,text,text) to authenticated;

create or replace function public.place_bid(p_auction_id uuid,p_amount bigint,p_comment text default '')
returns public.auction_bids language plpgsql security definer set search_path='' as $$
declare a public.auctions; current_best bigint; effective_step bigint; b public.auction_bids; participant public.profiles;
begin
  if auth.uid() is null then raise exception 'Требуется авторизация'; end if;
  select * into a from public.auctions where id=p_auction_id for update;
  if a.status<>'active' or now()<a.starts_at or now()>=a.ends_at then raise exception 'Торги не активны'; end if;
  if a.seller_id=auth.uid() then raise exception 'Продавец не может делать ставку на свой автомобиль'; end if;
  select * into participant from public.profiles where id=auth.uid();
  if not coalesce(participant.auction_verified,false) then raise exception 'Для участия подтвердите профиль'; end if;
  if participant.auction_ban_until>now() then raise exception 'Участие временно ограничено'; end if;
  if a.participant_access='professional' and participant.account_type<>'professional' then raise exception 'Аукцион доступен профессиональным участникам'; end if;
  if exists(select 1 from public.auction_participant_blocks x where x.auction_seller_id=a.seller_id and x.user_id=auth.uid() and (x.blocked_until is null or x.blocked_until>now())) then raise exception 'Продавец ограничил участие в своих аукционах'; end if;
  select greatest(a.start_price,coalesce(max(amount),0)) into current_best from public.auction_bids where auction_id=a.id;
  effective_step=public.auction_effective_bid_step(a,current_best);
  if p_amount<current_best+effective_step then raise exception 'Минимальная ставка: %',current_best+effective_step; end if;
  insert into public.auction_bids(auction_id,bidder_id,amount,comment) values(a.id,auth.uid(),p_amount,left(coalesce(p_comment,''),80)) returning * into b;
  if a.auto_extend and a.ends_at-now()<interval '5 minutes' then
    update public.auctions set ends_at=ends_at+interval '5 minutes',updated_at=now() where id=a.id;
    insert into public.notifications(user_id,type,title,body,auction_id,dedupe_key)
      select distinct bidder_id,'auction_extended','Торги продлены','Новая ставка поступила в последние пять минут',a.id,'extended:'||b.id||':'||bidder_id from public.auction_bids where auction_id=a.id on conflict do nothing;
  end if;
  insert into public.notifications(user_id,type,title,body,auction_id,dedupe_key)
    select bidder_id,'outbid','Вашу ставку перебили','Новая ставка: '||p_amount||' ₽',a.id,'outbid:'||b.id||':'||bidder_id
    from public.auction_bids where auction_id=a.id and bidder_id<>auth.uid() order by amount desc limit 1 on conflict do nothing;
  return b;
end $$;
