create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(), name text not null check(char_length(name) between 2 and 160),
  inn text, owner_id uuid not null references auth.users(id), created_at timestamptz not null default now()
);
create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  member_role text not null default 'viewer' check(member_role in ('owner','administrator','manager','viewer')),
  active boolean not null default true, created_at timestamptz not null default now(), primary key(organization_id,user_id)
);
create table if not exists public.organization_branches (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null, city text not null, address text not null default '', active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.listings drop constraint if exists listings_organization_id_fkey;
alter table public.listings add constraint listings_organization_id_fkey foreign key(organization_id) references public.organizations(id) on delete set null;
alter table public.listings add column if not exists branch_id uuid references public.organization_branches(id) on delete set null;
alter table public.feed_sources add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.feed_sources add column if not exists branch_id uuid references public.organization_branches(id) on delete set null;

create or replace function public.organization_role(p_organization_id uuid)
returns text language sql stable security definer set search_path='' as $$
  select member_role from public.organization_members where organization_id=p_organization_id and user_id=auth.uid() and active limit 1
$$;
create or replace function public.can_manage_organization(p_organization_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select public.is_admin() or coalesce(public.organization_role(p_organization_id) in ('owner','administrator','manager'),false)
$$;
create or replace function public.is_organization_member(p_organization_id uuid)
returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.organization_members where organization_id=p_organization_id and user_id=auth.uid() and active) $$;

alter table public.organizations enable row level security;alter table public.organization_members enable row level security;alter table public.organization_branches enable row level security;
create policy "members_read_organizations" on public.organizations for select using (public.is_admin() or public.is_organization_member(id));
create policy "owners_update_organizations" on public.organizations for update using (public.is_admin() or public.organization_role(id) in ('owner','administrator'));
create policy "members_read_members" on public.organization_members for select using (public.is_admin() or public.is_organization_member(organization_id));
create policy "admins_manage_members" on public.organization_members for all using (public.is_admin() or public.organization_role(organization_id) in ('owner','administrator')) with check (public.is_admin() or public.organization_role(organization_id) in ('owner','administrator'));
create policy "members_read_branches" on public.organization_branches for select using (public.is_admin() or public.organization_role(organization_id) is not null);
create policy "managers_manage_branches" on public.organization_branches for all using (public.can_manage_organization(organization_id)) with check (public.can_manage_organization(organization_id));

create or replace function public.create_organization(p_name text,p_inn text default '')
returns public.organizations language plpgsql security definer set search_path='' as $$
declare o public.organizations; profile public.profiles;
begin
  select * into profile from public.profiles where id=auth.uid();if profile.account_type<>'professional' and not public.is_admin() then raise exception 'Организация доступна профессиональному участнику';end if;
  if exists(select 1 from public.organization_members where user_id=auth.uid() and active) then raise exception 'Вы уже состоите в организации';end if;
  insert into public.organizations(name,inn,owner_id) values(trim(p_name),nullif(trim(p_inn),''),auth.uid()) returning * into o;
  insert into public.organization_members(organization_id,user_id,member_role) values(o.id,auth.uid(),'owner');return o;
end $$;

create or replace function public.add_organization_member(p_organization_id uuid,p_email text,p_role text)
returns void language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
  if public.organization_role(p_organization_id) not in ('owner','administrator') and not public.is_admin() then raise exception 'Недостаточно прав';end if;
  if p_role not in ('administrator','manager','viewer') then raise exception 'Некорректная роль';end if;
  select id into target from auth.users where lower(email)=lower(trim(p_email));if target is null then raise exception 'Пользователь с такой почтой ещё не зарегистрирован';end if;
  insert into public.organization_members(organization_id,user_id,member_role,active) values(p_organization_id,target,p_role,true)
    on conflict(organization_id,user_id) do update set member_role=excluded.member_role,active=true;
end $$;

create or replace function public.assign_listing_to_branch(p_listing_id uuid,p_branch_id uuid)
returns public.listings language plpgsql security definer set search_path='' as $$
declare l public.listings;b public.organization_branches;
begin select * into l from public.listings where id=p_listing_id;select * into b from public.organization_branches where id=p_branch_id;
  if b.id is null or not public.can_manage_organization(b.organization_id) then raise exception 'Недостаточно прав';end if;
  if l.owner_id<>auth.uid() and not public.is_admin() then raise exception 'Можно добавить только свой автомобиль';end if;
  update public.listings set organization_id=b.organization_id,branch_id=b.id,updated_at=now() where id=l.id returning * into l;return l;
end $$;

create or replace function public.can_manage_listing(listing public.listings)
returns boolean language sql stable security definer set search_path=''
as $$ select public.current_role()='admin' or (auth.uid() is not null and listing.owner_id=auth.uid()) or (listing.organization_id is not null and public.can_manage_organization(listing.organization_id)) $$;

create or replace function public.organization_auction_analytics(p_organization_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if public.organization_role(p_organization_id) is null and not public.is_admin() then raise exception 'Недостаточно прав';end if;
  select jsonb_build_object(
    'inventory',count(distinct l.id),'active_listings',count(distinct l.id) filter(where l.active and l.status='published'),
    'auctions',count(distinct a.id),'active_auctions',count(distinct a.id) filter(where a.status in ('scheduled','active','awaiting_seller','awaiting_buyer')),
    'confirmed_deals',count(distinct d.id) filter(where d.status='confirmed'),'revenue',coalesce(sum(distinct d.amount) filter(where d.status='confirmed'),0),
    'bids',count(distinct b.id),'participants',count(distinct b.bidder_id),
    'branches',coalesce((select jsonb_agg(x) from (select br.id,br.name,br.city,count(distinct l2.id) inventory,count(distinct a2.id) auctions,count(distinct d2.id) filter(where d2.status='confirmed') deals from public.organization_branches br left join public.listings l2 on l2.branch_id=br.id left join public.auctions a2 on a2.listing_id=l2.id left join public.auction_deals d2 on d2.auction_id=a2.id where br.organization_id=p_organization_id group by br.id order by br.name)x),'[]'::jsonb)
  ) into result from public.listings l left join public.auctions a on a.listing_id=l.id left join public.auction_bids b on b.auction_id=a.id left join public.auction_deals d on d.auction_id=a.id where l.organization_id=p_organization_id;
  return result;
end $$;

create or replace function public.start_auction(p_listing_id uuid,p_start_price bigint,p_reserve_price bigint,p_bid_step bigint,p_starts_at timestamptz,p_duration_minutes integer,p_auto_extend boolean,p_winner_mode text,p_participant_access text)
returns public.auctions language plpgsql security definer set search_path='' as $$
declare l public.listings;a public.auctions;effective_seller uuid;
begin
  select * into l from public.listings where id=p_listing_id and active for update;if l.id is null then raise exception 'Объявление не найдено';end if;
  if not public.can_manage_listing(l) then raise exception 'Недостаточно прав для запуска аукциона';end if;
  if p_start_price<1 or p_bid_step<1 or p_duration_minutes not between 30 and 10080 then raise exception 'Некорректные параметры аукциона';end if;
  if p_reserve_price>0 and p_reserve_price<p_start_price then raise exception 'Резервная цена ниже стартовой';end if;
  if p_winner_mode not in ('highest','seller_choice') or p_participant_access not in ('all_verified','professional') then raise exception 'Некорректные правила аукциона';end if;
  effective_seller=coalesce(l.owner_id,auth.uid());
  insert into public.auctions(listing_id,seller_id,created_by,status,start_price,reserve_price,bid_step,starts_at,ends_at,auto_extend,winner_mode,participant_access)
  values(l.id,effective_seller,auth.uid(),case when p_starts_at>now() then 'scheduled' else 'active' end,p_start_price,p_reserve_price,p_bid_step,p_starts_at,p_starts_at+make_interval(mins=>p_duration_minutes),p_auto_extend,p_winner_mode,p_participant_access)
  on conflict(listing_id) do update set seller_id=effective_seller,created_by=auth.uid(),status=excluded.status,start_price=excluded.start_price,reserve_price=excluded.reserve_price,bid_step=excluded.bid_step,starts_at=excluded.starts_at,ends_at=excluded.ends_at,auto_extend=excluded.auto_extend,winner_mode=excluded.winner_mode,participant_access=excluded.participant_access,winner_bid_id=null,updated_at=now()
  returning * into a;return a;
end $$;

create or replace function public.bulk_start_auctions(p_listing_ids uuid[],p_duration_minutes integer,p_bid_step bigint,p_winner_mode text,p_participant_access text)
returns integer language plpgsql security definer set search_path='' as $$
declare listing_id uuid;l public.listings;started integer=0;price bigint;
begin
  foreach listing_id in array p_listing_ids loop
    select * into l from public.listings where id=listing_id and active and status='published';
    if l.id is not null and public.can_manage_listing(l) and not exists(select 1 from public.auctions a where a.listing_id=l.id and a.status in ('scheduled','active','awaiting_seller','awaiting_buyer')) then
      price=greatest(coalesce((l.data->>'price')::bigint,0),1);
      perform public.start_auction(l.id,price,0,p_bid_step,now(),p_duration_minutes,true,p_winner_mode,p_participant_access);started=started+1;
    end if;
  end loop;return started;
end $$;

drop policy if exists "admins_manage_feed_sources" on public.feed_sources;
create policy "admins_and_organizations_manage_feed_sources" on public.feed_sources for all using (public.is_admin() or (organization_id is not null and public.can_manage_organization(organization_id))) with check (public.is_admin() or (organization_id is not null and public.can_manage_organization(organization_id)));

drop policy if exists "published_listings_are_public" on public.listings;
create policy "published_listings_are_public" on public.listings for select using ((active and status='published') or owner_id=auth.uid() or public.current_role()='admin' or (organization_id is not null and public.organization_role(organization_id) is not null));
drop policy if exists "owners_update_listings" on public.listings;
create policy "owners_update_listings" on public.listings for update using (public.can_manage_listing(listings)) with check (public.can_manage_listing(listings));
