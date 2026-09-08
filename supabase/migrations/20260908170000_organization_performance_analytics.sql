create or replace function public.organization_performance_report(p_organization_id uuid,p_days integer default 90)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if coalesce(public.organization_role(p_organization_id) not in ('owner','administrator','manager'),true) and public.current_role()<>'admin' then raise exception 'Недостаточно прав'; end if;
  with auction_base as (
    select a.id,a.created_by,a.status,a.created_at,l.branch_id,br.name branch_name,
      coalesce(b.bid_count,0) bid_count,coalesce(b.participants,0) participants,
      d.amount deal_amount,d.status deal_status
    from public.auctions a join public.listings l on l.id=a.listing_id
    left join public.organization_branches br on br.id=l.branch_id
    left join lateral(select count(*) bid_count,count(distinct bidder_id) participants from public.auction_bids x where x.auction_id=a.id)b on true
    left join lateral(select x.amount,x.status from public.auction_deals x where x.auction_id=a.id order by x.created_at desc limit 1)d on true
    where l.organization_id=p_organization_id and a.created_at>=now()-make_interval(days=>least(greatest(p_days,7),730))
  ), weekly as (
    select date_trunc('week',created_at)::date period,count(*) auctions,sum(bid_count) bids,count(*) filter(where bid_count>0) with_bids,
      count(*) filter(where deal_status='confirmed') deals,coalesce(sum(deal_amount) filter(where deal_status='confirmed'),0) revenue
    from auction_base group by 1 order by 1
  ), branches as (
    select coalesce(cr.branch_name,'Без филиала') name,count(*) auctions,sum(bid_count) bids,count(*) filter(where deal_status='confirmed') deals,
      coalesce(sum(deal_amount) filter(where deal_status='confirmed'),0) revenue
    from auction_base cr group by cr.branch_name order by count(*) desc
  ), managers as (
    select coalesce(p.name,'Сотрудник') name,count(*) auctions,sum(ab.bid_count) bids,count(*) filter(where ab.deal_status='confirmed') deals,
      coalesce(sum(ab.deal_amount) filter(where ab.deal_status='confirmed'),0) revenue
    from auction_base ab left join public.profiles p on p.id=ab.created_by group by ab.created_by,p.name order by count(*) desc
  ), statuses as (
    select status,count(*) amount from auction_base group by status
  )
  select jsonb_build_object(
    'period_days',p_days,
    'summary',(select jsonb_build_object('auctions',count(*),'with_bids',count(*) filter(where bid_count>0),'bids',coalesce(sum(bid_count),0),'participants',coalesce(sum(participants),0),'deals',count(*) filter(where deal_status='confirmed'),'revenue',coalesce(sum(deal_amount) filter(where deal_status='confirmed'),0),'no_sale',count(*) filter(where status='no_sale'),'cancelled',count(*) filter(where status='cancelled')) from auction_base),
    'weekly',coalesce((select jsonb_agg(to_jsonb(w)) from weekly w),'[]'::jsonb),
    'branches',coalesce((select jsonb_agg(to_jsonb(b)) from branches b),'[]'::jsonb),
    'managers',coalesce((select jsonb_agg(to_jsonb(m)) from managers m),'[]'::jsonb),
    'statuses',coalesce((select jsonb_object_agg(status,amount) from statuses),'{}'::jsonb)
  ) into result;
  return result;
end $$;
grant execute on function public.organization_performance_report(uuid,integer) to authenticated;
