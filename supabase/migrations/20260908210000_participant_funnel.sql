create or replace function public.organization_participant_funnel(p_organization_id uuid,p_days integer default 90)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if public.organization_role(p_organization_id) is null and public.current_role()<>'admin' then raise exception 'Недостаточно прав'; end if;
  with org_auctions as (
    select a.id from public.auctions a join public.listings l on l.id=a.listing_id
    where l.organization_id=p_organization_id and a.created_at>=now()-make_interval(days=>least(greatest(p_days,7),730))
  ), viewers as (
    select distinct v.user_id from public.auction_views v join org_auctions a on a.id=v.auction_id where v.user_id is not null
  ), watchers as (
    select distinct w.user_id from public.auction_watchers w join org_auctions a on a.id=w.auction_id
  ), bidder_activity as (
    select b.bidder_id,count(distinct b.auction_id) auctions,min(b.created_at) first_bid_at
    from public.auction_bids b join org_auctions a on a.id=b.auction_id group by b.bidder_id
  ), winners as (
    select distinct d.buyer_id from public.auction_deals d join org_auctions a on a.id=d.auction_id where d.status='confirmed'
  ), weekly as (
    select date_trunc('week',b.created_at)::date period,count(distinct b.bidder_id) bidders,count(*) bids
    from public.auction_bids b join org_auctions a on a.id=b.auction_id group by 1 order by 1
  ), stages as (
    select (select count(*) from viewers) viewed,(select count(*) from watchers) watched,
      (select count(*) from bidder_activity) bidders,(select count(*) from winners) buyers,
      (select count(*) from bidder_activity where auctions>=2) repeat_bidders
  )
  select jsonb_build_object(
    'period_days',p_days,
    'stages',(select to_jsonb(s) from stages s),
    'weekly',coalesce((select jsonb_agg(to_jsonb(w) order by w.period) from weekly w),'[]'::jsonb),
    'conversion',jsonb_build_object(
      'view_to_bid',coalesce((select round(bidders*100.0/nullif(viewed,0)) from stages),0),
      'bid_to_deal',coalesce((select round(buyers*100.0/nullif(bidders,0)) from stages),0),
      'repeat_rate',coalesce((select round(repeat_bidders*100.0/nullif(bidders,0)) from stages),0)
    )
  ) into result;
  return result;
end $$;
grant execute on function public.organization_participant_funnel(uuid,integer) to authenticated;
