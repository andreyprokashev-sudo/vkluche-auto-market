create table if not exists public.auction_proxy_bids (
  auction_id uuid not null references public.auctions(id) on delete cascade,
  bidder_id uuid not null references auth.users(id) on delete cascade,
  max_amount bigint not null check (max_amount > 0),
  comment text not null default '', active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key (auction_id,bidder_id)
);
alter table public.auction_proxy_bids enable row level security;
drop policy if exists "users_read_own_proxy_bids" on public.auction_proxy_bids;
create policy "users_read_own_proxy_bids" on public.auction_proxy_bids for select using (bidder_id=auth.uid());

create or replace function public.my_auction_proxy_bid(p_auction_id uuid)
returns table(max_amount bigint,active boolean,updated_at timestamptz)
language sql security definer set search_path='' stable as $$
  select p.max_amount,p.active,p.updated_at from public.auction_proxy_bids p
  where p.auction_id=p_auction_id and p.bidder_id=auth.uid()
$$;
grant execute on function public.my_auction_proxy_bid(uuid) to authenticated;

create or replace function public.place_proxy_bid(p_auction_id uuid,p_max_amount bigint,p_comment text default '')
returns public.auction_bids language plpgsql security definer set search_path='' as $$
declare a public.auctions;participant public.profiles;current_best bigint;current_bidder uuid;effective_step bigint;
  old_limit bigint;leader public.auction_proxy_bids;runner_up public.auction_proxy_bids;target bigint;
  first_bid public.auction_bids;result_bid public.auction_bids;
begin
  if auth.uid() is null then raise exception 'Требуется авторизация';end if;
  select * into a from public.auctions where id=p_auction_id for update;
  if a.status<>'active' or now()<a.starts_at or now()>=a.ends_at then raise exception 'Торги не активны';end if;
  if a.seller_id=auth.uid() then raise exception 'Продавец не может делать ставку на свой автомобиль';end if;
  select * into participant from public.profiles where id=auth.uid();
  if not coalesce(participant.auction_verified,false) then raise exception 'Для участия подтвердите профиль';end if;
  if participant.auction_ban_until>now() then raise exception 'Участие временно ограничено';end if;
  if a.participant_access='professional' and participant.account_type<>'professional' then raise exception 'Аукцион доступен профессиональным участникам';end if;
  if exists(select 1 from public.auction_participant_blocks x where x.auction_seller_id=a.seller_id and x.user_id=auth.uid() and (x.blocked_until is null or x.blocked_until>now())) then raise exception 'Продавец ограничил участие в своих аукционах';end if;
  select b.amount,b.bidder_id into current_best,current_bidder from public.auction_bids b where b.auction_id=a.id order by b.amount desc,b.created_at asc limit 1;
  current_best=greatest(a.start_price,coalesce(current_best,0));effective_step=public.auction_effective_bid_step(a,current_best);
  select p.max_amount into old_limit from public.auction_proxy_bids p where p.auction_id=a.id and p.bidder_id=auth.uid();
  if old_limit is not null and p_max_amount<old_limit then raise exception 'Лимит можно только увеличить или отключить';end if;
  if current_bidder is distinct from auth.uid() and p_max_amount<current_best+effective_step then raise exception 'Минимальный лимит: %',current_best+effective_step;end if;
  if current_bidder=auth.uid() and p_max_amount<current_best then raise exception 'Лимит ниже вашей текущей ставки';end if;
  insert into public.auction_proxy_bids(auction_id,bidder_id,max_amount,comment,active,updated_at)
  values(a.id,auth.uid(),p_max_amount,left(coalesce(p_comment,''),80),true,now())
  on conflict(auction_id,bidder_id) do update set max_amount=excluded.max_amount,comment=excluded.comment,active=true,updated_at=now();
  select * into leader from public.auction_proxy_bids p where p.auction_id=a.id and p.active order by p.max_amount desc,p.created_at asc limit 1;
  select * into runner_up from public.auction_proxy_bids p where p.auction_id=a.id and p.active and p.bidder_id<>leader.bidder_id order by p.max_amount desc,p.created_at asc limit 1;
  if leader.bidder_id=auth.uid() then
    target=least(leader.max_amount,greatest(current_best,coalesce(runner_up.max_amount,0))+public.auction_effective_bid_step(a,greatest(current_best,coalesce(runner_up.max_amount,0))));
    if current_bidder is distinct from auth.uid() then
      insert into public.auction_bids(auction_id,bidder_id,amount,comment) values(a.id,auth.uid(),target,'Автоматическая ставка') returning * into result_bid;
    end if;
  else
    target=least(p_max_amount,current_best+effective_step);
    insert into public.auction_bids(auction_id,bidder_id,amount,comment) values(a.id,auth.uid(),target,left(coalesce(p_comment,''),80)) returning * into first_bid;
    target=least(leader.max_amount,p_max_amount+public.auction_effective_bid_step(a,p_max_amount));
    if target>first_bid.amount then
      insert into public.auction_bids(auction_id,bidder_id,amount,comment) values(a.id,leader.bidder_id,target,'Автоматическая ставка') returning * into result_bid;
      insert into public.notifications(user_id,type,title,body,auction_id,dedupe_key) values(auth.uid(),'proxy_limit_reached','Достигнут лимит автоставки','Другой участник предложил больше. Увеличьте лимит, чтобы продолжить торги.',a.id,'proxy-limit:'||first_bid.id) on conflict do nothing;
    else result_bid=first_bid;end if;
  end if;
  if result_bid.id is null then select * into result_bid from public.auction_bids where auction_id=a.id and bidder_id=auth.uid() order by amount desc,created_at asc limit 1;end if;
  if a.auto_extend and a.ends_at-now()<interval '5 minutes' and result_bid.id is not null then
    update public.auctions set ends_at=ends_at+interval '5 minutes',updated_at=now() where id=a.id;
    insert into public.notifications(user_id,type,title,body,auction_id,dedupe_key)
      select distinct bidder_id,'auction_extended','Торги продлены','Автоматическая ставка поступила в последние пять минут',a.id,'proxy-extended:'||result_bid.id||':'||bidder_id from public.auction_bids where auction_id=a.id on conflict do nothing;
  end if;
  return result_bid;
end $$;
grant execute on function public.place_proxy_bid(uuid,bigint,text) to authenticated;

create or replace function public.place_bid(p_auction_id uuid,p_amount bigint,p_comment text default '')
returns public.auction_bids language plpgsql security definer set search_path='' as $$
declare a public.auctions;participant public.profiles;current_best bigint;effective_step bigint;previous_bidder uuid;
  b public.auction_bids;auto_bid public.auction_bids;proxy public.auction_proxy_bids;auto_amount bigint;
begin
  if auth.uid() is null then raise exception 'Требуется авторизация';end if;
  select * into a from public.auctions where id=p_auction_id for update;
  if a.status<>'active' or now()<a.starts_at or now()>=a.ends_at then raise exception 'Торги не активны';end if;
  if a.seller_id=auth.uid() then raise exception 'Продавец не может делать ставку на свой автомобиль';end if;
  select * into participant from public.profiles where id=auth.uid();
  if not coalesce(participant.auction_verified,false) then raise exception 'Для участия подтвердите профиль';end if;
  if participant.auction_ban_until>now() then raise exception 'Участие временно ограничено';end if;
  if a.participant_access='professional' and participant.account_type<>'professional' then raise exception 'Аукцион доступен профессиональным участникам';end if;
  if exists(select 1 from public.auction_participant_blocks x where x.auction_seller_id=a.seller_id and x.user_id=auth.uid() and (x.blocked_until is null or x.blocked_until>now())) then raise exception 'Продавец ограничил участие в своих аукционах';end if;
  select x.amount,x.bidder_id into current_best,previous_bidder from public.auction_bids x where x.auction_id=a.id order by x.amount desc,x.created_at asc limit 1;
  current_best=greatest(a.start_price,coalesce(current_best,0));effective_step=public.auction_effective_bid_step(a,current_best);
  if p_amount<current_best+effective_step then raise exception 'Минимальная ставка: %',current_best+effective_step;end if;
  insert into public.auction_bids(auction_id,bidder_id,amount,comment) values(a.id,auth.uid(),p_amount,left(coalesce(p_comment,''),80)) returning * into b;
  select * into proxy from public.auction_proxy_bids p where p.auction_id=a.id and p.active and p.bidder_id<>auth.uid() and p.max_amount>=p_amount+public.auction_effective_bid_step(a,p_amount) order by p.max_amount desc,p.created_at asc limit 1;
  if proxy.bidder_id is not null then
    auto_amount=least(proxy.max_amount,p_amount+public.auction_effective_bid_step(a,p_amount));
    insert into public.auction_bids(auction_id,bidder_id,amount,comment) values(a.id,proxy.bidder_id,auto_amount,'Автоматическая ставка') returning * into auto_bid;
    insert into public.notifications(user_id,type,title,body,auction_id,dedupe_key) values(auth.uid(),'outbid','Вашу ставку перебили автоматически','У другого участника был установлен более высокий скрытый лимит.',a.id,'proxy-outbid:'||auto_bid.id||':'||auth.uid()) on conflict do nothing;
  elsif previous_bidder is not null and previous_bidder<>auth.uid() then
    insert into public.notifications(user_id,type,title,body,auction_id,dedupe_key) values(previous_bidder,'outbid','Вашу ставку перебили','Новая ставка: '||p_amount||' ₽',a.id,'outbid:'||b.id||':'||previous_bidder) on conflict do nothing;
  end if;
  insert into public.notifications(user_id,type,title,body,auction_id,dedupe_key)
    select p.bidder_id,'proxy_limit_reached','Достигнут лимит автоматической ставки','Текущая цена превысила ваш лимит. Увеличьте его, чтобы продолжить торги.',a.id,'proxy-limit:'||b.id||':'||p.bidder_id
    from public.auction_proxy_bids p where p.auction_id=a.id and p.active and p.bidder_id<>auth.uid() and p.max_amount<p_amount on conflict do nothing;
  if a.auto_extend and a.ends_at-now()<interval '5 minutes' then
    update public.auctions set ends_at=ends_at+interval '5 minutes',updated_at=now() where id=a.id;
    insert into public.notifications(user_id,type,title,body,auction_id,dedupe_key)
      select distinct bidder_id,'auction_extended','Торги продлены','Новая ставка поступила в последние пять минут',a.id,'extended:'||b.id||':'||bidder_id from public.auction_bids where auction_id=a.id on conflict do nothing;
  end if;
  return b;
end $$;
grant execute on function public.place_bid(uuid,bigint,text) to authenticated;

create or replace function public.cancel_proxy_bid(p_auction_id uuid)
returns void language sql security definer set search_path='' as $$
  update public.auction_proxy_bids set active=false,updated_at=now() where auction_id=p_auction_id and bidder_id=auth.uid()
$$;
grant execute on function public.cancel_proxy_bid(uuid) to authenticated;

create or replace function public.queue_external_notification()
returns trigger language plpgsql security definer set search_path='' as $$
declare p public.notification_preferences;user_email text;
begin
  select * into p from public.notification_preferences where user_id=new.user_id;
  select email into user_email from auth.users where id=new.user_id;
  if (new.type in ('auction_started','auction_scheduled') and not coalesce(p.auction_start,true))
    or (new.type in ('auction_reminder','auction_ending') and not coalesce(p.auction_reminder,true))
    or (new.type in ('outbid','proxy_limit_reached') and not coalesce(p.outbid,true))
    or (new.type='auction_extended' and not coalesce(p.auction_extended,true))
    or (new.type in ('auction_offer','auction_won','auction_finished','deal_confirmed') and not coalesce(p.auction_result,true))
    or (new.type like 'inspection_%' and not coalesce(p.inspection_updates,true))
    or (new.type like 'question_%' and not coalesce(p.question_updates,true)) then return new;end if;
  if coalesce(p.email_enabled,true) then insert into public.notification_delivery_queue(notification_id,user_id,channel,destination) values(new.id,new.user_id,'email',user_email) on conflict do nothing;end if;
  if coalesce(p.telegram_enabled,false) and nullif(p.telegram_chat_id,'') is not null and (new.auction_id is null or not exists(select 1 from public.telegram_auction_mutes m where m.user_id=new.user_id and m.auction_id=new.auction_id)) then insert into public.notification_delivery_queue(notification_id,user_id,channel,destination) values(new.id,new.user_id,'telegram',p.telegram_chat_id) on conflict do nothing;end if;
  if coalesce(p.max_enabled,false) and nullif(p.max_chat_id,'') is not null and (new.auction_id is null or not exists(select 1 from public.max_auction_mutes m where m.user_id=new.user_id and m.auction_id=new.auction_id)) then insert into public.notification_delivery_queue(notification_id,user_id,channel,destination) values(new.id,new.user_id,'max',p.max_chat_id) on conflict do nothing;end if;
  return new;
end $$;
