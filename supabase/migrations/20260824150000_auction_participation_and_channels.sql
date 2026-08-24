alter table public.profiles add column if not exists auction_verified boolean not null default true;
alter table public.profiles add column if not exists auction_wins integer not null default 0;
alter table public.profiles add column if not exists auction_declines integer not null default 0;
alter table public.profiles add column if not exists auction_ban_until timestamptz;

alter table public.auctions add column if not exists participant_access text not null default 'all_verified';
alter table public.auctions drop constraint if exists auctions_participant_access_check;
alter table public.auctions add constraint auctions_participant_access_check check (participant_access in ('all_verified','professional'));

create or replace function public.start_auction(p_listing_id uuid,p_start_price bigint,p_reserve_price bigint,p_bid_step bigint,p_starts_at timestamptz,p_duration_minutes integer,p_auto_extend boolean,p_winner_mode text,p_participant_access text)
returns public.auctions language plpgsql security definer set search_path='' as $$
declare l public.listings; a public.auctions;
begin
  select * into l from public.listings where id=p_listing_id and active for update;
  if l.id is null then raise exception 'Объявление не найдено'; end if;
  if not public.can_manage_listing(l) then raise exception 'Недостаточно прав для запуска аукциона'; end if;
  if p_start_price<1 or p_bid_step<1 or p_duration_minutes not between 30 and 10080 then raise exception 'Некорректные параметры аукциона'; end if;
  if p_reserve_price>0 and p_reserve_price<p_start_price then raise exception 'Резервная цена ниже стартовой'; end if;
  if p_winner_mode not in ('highest','seller_choice') or p_participant_access not in ('all_verified','professional') then raise exception 'Некорректные правила аукциона'; end if;
  insert into public.auctions(listing_id,seller_id,created_by,status,start_price,reserve_price,bid_step,starts_at,ends_at,auto_extend,winner_mode,participant_access)
  values(l.id,l.owner_id,auth.uid(),case when p_starts_at>now() then 'scheduled' else 'active' end,p_start_price,p_reserve_price,p_bid_step,p_starts_at,p_starts_at+make_interval(mins=>p_duration_minutes),p_auto_extend,p_winner_mode,p_participant_access)
  on conflict(listing_id) do update set created_by=auth.uid(),status=excluded.status,start_price=excluded.start_price,reserve_price=excluded.reserve_price,bid_step=excluded.bid_step,starts_at=excluded.starts_at,ends_at=excluded.ends_at,auto_extend=excluded.auto_extend,winner_mode=excluded.winner_mode,participant_access=excluded.participant_access,winner_bid_id=null,updated_at=now()
  returning * into a; return a;
end $$;

alter table public.notification_preferences add column if not exists in_app_enabled boolean not null default true;
alter table public.notification_preferences add column if not exists telegram_enabled boolean not null default false;
alter table public.notification_preferences add column if not exists telegram_chat_id text;
alter table public.notification_preferences add column if not exists max_enabled boolean not null default false;
alter table public.notification_preferences add column if not exists max_chat_id text;
alter table public.notification_preferences add column if not exists auction_extended boolean not null default true;
alter table public.notification_preferences add column if not exists inspection_updates boolean not null default true;
alter table public.notification_preferences add column if not exists question_updates boolean not null default true;

create table if not exists public.notification_delivery_queue (
  id bigint generated always as identity primary key,
  notification_id bigint not null references public.notifications(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null check (channel in ('email','telegram','max')),
  destination text,
  status text not null default 'pending' check (status in ('pending','sent','failed','skipped')),
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique(notification_id,channel)
);
alter table public.notification_delivery_queue enable row level security;
create policy "users_read_own_delivery_queue" on public.notification_delivery_queue for select using (user_id=auth.uid());

create or replace function public.queue_external_notification()
returns trigger language plpgsql security definer set search_path='' as $$
declare p public.notification_preferences; user_email text;
begin
  select * into p from public.notification_preferences where user_id=new.user_id;
  select email into user_email from auth.users where id=new.user_id;
  if (new.type in ('auction_started','auction_scheduled') and not coalesce(p.auction_start,true))
    or (new.type in ('auction_reminder','auction_ending') and not coalesce(p.auction_reminder,true))
    or (new.type='outbid' and not coalesce(p.outbid,true))
    or (new.type='auction_extended' and not coalesce(p.auction_extended,true))
    or (new.type in ('auction_offer','auction_won','auction_finished','deal_confirmed') and not coalesce(p.auction_result,true))
    or (new.type like 'inspection_%' and not coalesce(p.inspection_updates,true))
    or (new.type like 'question_%' and not coalesce(p.question_updates,true)) then return new; end if;
  if coalesce(p.email_enabled,true) then insert into public.notification_delivery_queue(notification_id,user_id,channel,destination) values(new.id,new.user_id,'email',user_email) on conflict do nothing; end if;
  if coalesce(p.telegram_enabled,false) and nullif(p.telegram_chat_id,'') is not null then insert into public.notification_delivery_queue(notification_id,user_id,channel,destination) values(new.id,new.user_id,'telegram',p.telegram_chat_id) on conflict do nothing; end if;
  if coalesce(p.max_enabled,false) and nullif(p.max_chat_id,'') is not null then insert into public.notification_delivery_queue(notification_id,user_id,channel,destination) values(new.id,new.user_id,'max',p.max_chat_id) on conflict do nothing; end if;
  return new;
end $$;
drop trigger if exists queue_external_notification on public.notifications;
create trigger queue_external_notification after insert on public.notifications for each row execute function public.queue_external_notification();

create table if not exists public.auction_inspections (
  id uuid primary key default gen_random_uuid(), auction_id uuid not null references public.auctions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade, requested_at timestamptz not null,
  comment text not null default '', status text not null default 'requested' check (status in ('requested','confirmed','declined','completed','cancelled')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists auction_inspection_open_idx on public.auction_inspections(auction_id,user_id) where status in ('requested','confirmed');
alter table public.auction_inspections enable row level security;
create policy "participants_read_inspections" on public.auction_inspections for select using (user_id=auth.uid() or exists(select 1 from public.auctions a where a.id=auction_id and (a.seller_id=auth.uid() or public.is_admin())));
create policy "users_request_inspections" on public.auction_inspections for insert with check (user_id=auth.uid());
create policy "participants_update_inspections" on public.auction_inspections for update using (user_id=auth.uid() or exists(select 1 from public.auctions a where a.id=auction_id and (a.seller_id=auth.uid() or public.is_admin())));

create table if not exists public.auction_questions (
  id uuid primary key default gen_random_uuid(), auction_id uuid not null references public.auctions(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade, question text not null check (char_length(question) between 2 and 1000),
  answer text, answered_by uuid references auth.users(id), answered_at timestamptz, created_at timestamptz not null default now()
);
alter table public.auction_questions enable row level security;
create policy "auction_questions_are_visible" on public.auction_questions for select using (true);
create policy "users_ask_questions" on public.auction_questions for insert with check (author_id=auth.uid());
create policy "seller_answers_questions" on public.auction_questions for update using (exists(select 1 from public.auctions a where a.id=auction_id and (a.seller_id=auth.uid() or public.is_admin())));

create or replace function public.notify_auction_interaction()
returns trigger language plpgsql security definer set search_path='' as $$
declare seller uuid;
begin
  select seller_id into seller from public.auctions where id=new.auction_id;
  if tg_table_name='auction_inspections' and tg_op='INSERT' then
    insert into public.notifications(user_id,type,title,body,auction_id,dedupe_key) values(seller,'inspection_requested','Новая заявка на осмотр',to_char(new.requested_at,'DD.MM.YYYY HH24:MI'),new.auction_id,'inspection:'||new.id) on conflict do nothing;
  elsif tg_table_name='auction_inspections' and tg_op='UPDATE' and old.status<>new.status then
    insert into public.notifications(user_id,type,title,body,auction_id,dedupe_key) values(new.user_id,'inspection_updated',case when new.status='confirmed' then 'Осмотр подтверждён' else 'Статус осмотра изменён' end,to_char(new.requested_at,'DD.MM.YYYY HH24:MI'),new.auction_id,'inspection-status:'||new.id||':'||new.status) on conflict do nothing;
  elsif tg_table_name='auction_questions' and tg_op='INSERT' then
    insert into public.notifications(user_id,type,title,body,auction_id,dedupe_key) values(seller,'question_received','Новый вопрос по лоту',left(new.question,160),new.auction_id,'question:'||new.id) on conflict do nothing;
  elsif tg_table_name='auction_questions' and tg_op='UPDATE' and old.answer is null and new.answer is not null then
    insert into public.notifications(user_id,type,title,body,auction_id,dedupe_key) values(new.author_id,'question_answered','Продавец ответил на вопрос',left(new.answer,160),new.auction_id,'answer:'||new.id) on conflict do nothing;
  end if; return new;
end $$;
drop trigger if exists notify_inspection_request on public.auction_inspections;
create trigger notify_inspection_request after insert or update of status on public.auction_inspections for each row execute function public.notify_auction_interaction();
drop trigger if exists notify_auction_question on public.auction_questions;
create trigger notify_auction_question after insert or update of answer on public.auction_questions for each row execute function public.notify_auction_interaction();

create or replace function public.update_auction_reliability()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.status='awaiting_buyer' and new.status='confirmed' then update public.profiles set auction_wins=auction_wins+1 where id=new.buyer_id;
  elsif old.status='awaiting_buyer' and new.status in ('declined','expired') then
    update public.profiles set auction_declines=auction_declines+1,
      auction_ban_until=case when auction_declines+1>=3 then greatest(coalesce(auction_ban_until,now()),now()+interval '30 days') else auction_ban_until end
    where id=new.buyer_id;
  end if;
  return new;
end $$;
drop trigger if exists auction_deal_reliability on public.auction_deals;
create trigger auction_deal_reliability after update of status on public.auction_deals for each row execute function public.update_auction_reliability();

create or replace function public.block_auction_participant(p_auction_id uuid,p_bid_id uuid,p_days integer default 30)
returns void language plpgsql security definer set search_path='' as $$
declare a public.auctions; b public.auction_bids; l public.listings;
begin
  select * into a from public.auctions where id=p_auction_id; select * into l from public.listings where id=a.listing_id;
  if not public.can_manage_listing(l) then raise exception 'Недостаточно прав'; end if;
  select * into b from public.auction_bids where id=p_bid_id and auction_id=a.id;if b.id is null then raise exception 'Участник не найден'; end if;
  insert into public.auction_participant_blocks(auction_seller_id,user_id,reason,blocked_until)
    values(a.seller_id,b.bidder_id,'Решение продавца',case when p_days>0 then now()+make_interval(days=>least(p_days,365)) end)
    on conflict(auction_seller_id,user_id) do update set reason=excluded.reason,blocked_until=excluded.blocked_until,created_at=now();
end $$;

create table if not exists public.auction_participant_blocks (
  auction_seller_id uuid not null references auth.users(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reason text not null default '', blocked_until timestamptz, created_at timestamptz not null default now(),
  primary key(auction_seller_id,user_id)
);
alter table public.auction_participant_blocks enable row level security;
create policy "sellers_manage_blocks" on public.auction_participant_blocks for all using (auction_seller_id=auth.uid() or public.is_admin()) with check (auction_seller_id=auth.uid() or public.is_admin());
create policy "users_read_own_blocks" on public.auction_participant_blocks for select using (user_id=auth.uid());

create or replace function public.place_bid(p_auction_id uuid,p_amount bigint,p_comment text default '')
returns public.auction_bids language plpgsql security definer set search_path='' as $$
declare a public.auctions; current_best bigint; b public.auction_bids; participant public.profiles;
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
  if p_amount<current_best+a.bid_step then raise exception 'Ставка ниже минимальной'; end if;
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
