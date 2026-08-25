create table if not exists public.auction_views (
  auction_id uuid not null references public.auctions(id) on delete cascade,
  viewer_key_hash text not null,
  user_id uuid references auth.users(id) on delete set null,
  first_viewed_at timestamptz not null default now(),
  last_viewed_at timestamptz not null default now(),
  primary key(auction_id,viewer_key_hash)
);
alter table public.auction_views enable row level security;
create index if not exists auction_views_auction_idx on public.auction_views(auction_id);

create or replace function public.record_auction_view(p_auction_id uuid,p_visitor_key text default null)
returns void language plpgsql security definer set search_path='' as $$
declare a public.auctions;viewer_key text;
begin
  select * into a from public.auctions where id=p_auction_id;
  if a.id is null then return;end if;
  if auth.uid() is not null and (a.seller_id=auth.uid() or public.is_admin()) then return;end if;
  viewer_key=case when auth.uid() is not null then 'user:'||auth.uid() else 'guest:'||coalesce(nullif(left(p_visitor_key,80),''),'unknown') end;
  if auth.uid() is null and (p_visitor_key is null or char_length(p_visitor_key)<16) then return;end if;
  insert into public.auction_views(auction_id,viewer_key_hash,user_id)
  values(a.id,md5(viewer_key),auth.uid())
  on conflict(auction_id,viewer_key_hash) do update set last_viewed_at=now();
end $$;

create or replace function public.auction_private_metrics()
returns table(auction_id uuid,unique_views bigint,bid_count bigint,winner_amount bigint,winner_selected boolean,deal_status text)
language sql security definer set search_path='' stable as $$
  select a.id,
    (select count(*) from public.auction_views v where v.auction_id=a.id),
    (select count(*) from public.auction_bids b where b.auction_id=a.id),
    coalesce(w.amount,(select max(b.amount) from public.auction_bids b where b.auction_id=a.id and a.status='deal_confirmed')),
    (a.winner_bid_id is not null or exists(select 1 from public.auction_deals d where d.auction_id=a.id and d.status in ('awaiting_buyer','confirmed'))),
    (select d.status from public.auction_deals d where d.auction_id=a.id order by d.created_at desc limit 1)
  from public.auctions a left join public.auction_bids w on w.id=a.winner_bid_id
  where public.is_admin() or a.seller_id=auth.uid();
$$;

revoke all on public.auction_views from anon,authenticated;
grant execute on function public.record_auction_view(uuid,text) to anon,authenticated;
grant execute on function public.auction_private_metrics() to authenticated;
