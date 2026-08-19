alter table public.listings add column if not exists owner_id uuid references auth.users(id) on delete set null;
alter table public.listings add column if not exists organization_id uuid;

create or replace function public.current_role()
returns text language sql stable security definer set search_path = ''
as $$ select coalesce((select role from public.profiles where id = auth.uid()), 'buyer') $$;

create or replace function public.can_manage_listing(listing public.listings)
returns boolean language sql stable security definer set search_path = ''
as $$ select public.current_role() = 'admin' or (auth.uid() is not null and listing.owner_id = auth.uid()) $$;

drop policy if exists "owners_insert_listings" on public.listings;
create policy "owners_insert_listings" on public.listings for insert
with check (owner_id = auth.uid() and public.current_role() in ('seller','admin'));
drop policy if exists "owners_update_listings" on public.listings;
create policy "owners_update_listings" on public.listings for update
using (owner_id = auth.uid() or public.current_role() = 'admin')
with check (owner_id = auth.uid() or public.current_role() = 'admin');

create table if not exists public.auctions (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null unique references public.listings(id) on delete cascade,
  seller_id uuid references auth.users(id) on delete set null,
  created_by uuid not null references auth.users(id),
  status text not null check (status in ('scheduled','active','awaiting_seller','winner_selected','cancelled')),
  start_price bigint not null check (start_price > 0),
  reserve_price bigint not null default 0 check (reserve_price >= 0),
  bid_step bigint not null check (bid_step > 0),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  auto_extend boolean not null default true,
  winner_bid_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.auction_bids (
  id uuid primary key default gen_random_uuid(),
  auction_id uuid not null references public.auctions(id) on delete cascade,
  bidder_id uuid not null references auth.users(id) on delete cascade,
  amount bigint not null check (amount > 0),
  comment text not null default '',
  created_at timestamptz not null default now()
);
alter table public.auctions drop constraint if exists auctions_winner_bid_id_fkey;
alter table public.auctions add constraint auctions_winner_bid_id_fkey foreign key (winner_bid_id) references public.auction_bids(id) on delete set null;

create table if not exists public.auction_watchers (
  auction_id uuid not null references public.auctions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (auction_id,user_id)
);

create table if not exists public.saved_searches (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Поиск автомобилей', filters jsonb not null default '{}'::jsonb,
  notify_in_app boolean not null default true, notify_email boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  auction_start boolean not null default true, auction_reminder boolean not null default true,
  outbid boolean not null default true, auction_result boolean not null default true,
  email_enabled boolean not null default true, push_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id bigint generated always as identity primary key, user_id uuid not null references auth.users(id) on delete cascade,
  type text not null, title text not null, body text not null default '', auction_id uuid references public.auctions(id) on delete cascade,
  read_at timestamptz, dedupe_key text unique, created_at timestamptz not null default now()
);

alter table public.auctions enable row level security;
alter table public.auction_bids enable row level security;
alter table public.auction_watchers enable row level security;
alter table public.saved_searches enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.notifications enable row level security;

create policy "auctions_are_visible" on public.auctions for select using (true);
create policy "bids_are_visible" on public.auction_bids for select using (true);
create policy "users_manage_own_watches" on public.auction_watchers for all using (user_id=auth.uid()) with check (user_id=auth.uid());
create policy "users_manage_saved_searches" on public.saved_searches for all using (user_id=auth.uid()) with check (user_id=auth.uid());
create policy "users_manage_notification_preferences" on public.notification_preferences for all using (user_id=auth.uid()) with check (user_id=auth.uid());
create policy "users_read_notifications" on public.notifications for select using (user_id=auth.uid());
create policy "users_mark_notifications_read" on public.notifications for update using (user_id=auth.uid()) with check (user_id=auth.uid());

create or replace function public.start_auction(p_listing_id uuid,p_start_price bigint,p_reserve_price bigint,p_bid_step bigint,p_starts_at timestamptz,p_duration_minutes integer,p_auto_extend boolean)
returns public.auctions language plpgsql security definer set search_path='' as $$
declare l public.listings; a public.auctions;
begin
  select * into l from public.listings where id=p_listing_id and active for update;
  if l.id is null then raise exception 'Объявление не найдено'; end if;
  if not public.can_manage_listing(l) then raise exception 'Недостаточно прав для запуска аукциона'; end if;
  if p_start_price < 1 or p_bid_step < 1 or p_duration_minutes not between 30 and 10080 then raise exception 'Некорректные параметры аукциона'; end if;
  if p_reserve_price > 0 and p_reserve_price < p_start_price then raise exception 'Резервная цена ниже стартовой'; end if;
  insert into public.auctions(listing_id,seller_id,created_by,status,start_price,reserve_price,bid_step,starts_at,ends_at,auto_extend)
  values(l.id,l.owner_id,auth.uid(),case when p_starts_at>now() then 'scheduled' else 'active' end,p_start_price,p_reserve_price,p_bid_step,p_starts_at,p_starts_at+make_interval(mins=>p_duration_minutes),p_auto_extend)
  on conflict(listing_id) do update set created_by=auth.uid(),status=excluded.status,start_price=excluded.start_price,reserve_price=excluded.reserve_price,bid_step=excluded.bid_step,starts_at=excluded.starts_at,ends_at=excluded.ends_at,auto_extend=excluded.auto_extend,updated_at=now()
  returning * into a;
  return a;
end $$;

create or replace function public.place_bid(p_auction_id uuid,p_amount bigint,p_comment text default '')
returns public.auction_bids language plpgsql security definer set search_path='' as $$
declare a public.auctions; current_best bigint; b public.auction_bids;
begin
  if auth.uid() is null then raise exception 'Требуется авторизация'; end if;
  select * into a from public.auctions where id=p_auction_id for update;
  if a.status<>'active' or now()<a.starts_at or now()>=a.ends_at then raise exception 'Торги не активны'; end if;
  if a.seller_id=auth.uid() then raise exception 'Продавец не может делать ставку на свой автомобиль'; end if;
  select greatest(a.start_price,coalesce(max(amount),0)) into current_best from public.auction_bids where auction_id=a.id;
  if p_amount<current_best+a.bid_step then raise exception 'Ставка ниже минимальной'; end if;
  insert into public.auction_bids(auction_id,bidder_id,amount,comment) values(a.id,auth.uid(),p_amount,left(coalesce(p_comment,''),80)) returning * into b;
  if a.auto_extend and a.ends_at-now()<interval '5 minutes' then update public.auctions set ends_at=ends_at+interval '5 minutes',updated_at=now() where id=a.id; end if;
  insert into public.notifications(user_id,type,title,body,auction_id,dedupe_key)
    select bidder_id,'outbid','Вашу ставку перебили','Новая ставка: '||p_amount||' ₽',a.id,'outbid:'||b.id||':'||bidder_id
    from public.auction_bids where auction_id=a.id and bidder_id<>auth.uid() order by amount desc limit 1 on conflict do nothing;
  return b;
end $$;

create or replace function public.notify_auction_start()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status in ('scheduled','active') then
    insert into public.notifications(user_id,type,title,body,auction_id,dedupe_key)
    select w.user_id,case when new.status='active' then 'auction_started' else 'auction_scheduled' end,
      case when new.status='active' then 'Аукцион начался' else 'Аукцион запланирован' end,
      case when new.status='active' then 'Можно сделать предложение' else 'Начало: '||to_char(new.starts_at,'DD.MM.YYYY HH24:MI') end,
      new.id,new.status||':'||new.id||':'||w.user_id from public.auction_watchers w where w.auction_id=new.id on conflict do nothing;
  end if; return new;
end $$;
drop trigger if exists auction_start_notifications on public.auctions;
create trigger auction_start_notifications after insert or update of status on public.auctions for each row execute function public.notify_auction_start();

create index if not exists auctions_status_time_idx on public.auctions(status,starts_at,ends_at);
create index if not exists auction_bids_auction_amount_idx on public.auction_bids(auction_id,amount desc);
create index if not exists notifications_user_created_idx on public.notifications(user_id,created_at desc);

do $$ begin
  alter publication supabase_realtime add table public.auctions;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.auction_bids;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null; end $$;

create or replace function public.advance_auction_statuses()
returns void language plpgsql security definer set search_path='' as $$
begin
  update public.auctions set status='active',updated_at=now() where status='scheduled' and starts_at<=now();
  update public.auctions set status='awaiting_seller',updated_at=now() where status='active' and ends_at<=now();
end $$;

do $$ begin
  perform cron.unschedule('vkluche-advance-auctions');
exception when others then null; end $$;
select cron.schedule('vkluche-advance-auctions','* * * * *','select public.advance_auction_statuses()');
