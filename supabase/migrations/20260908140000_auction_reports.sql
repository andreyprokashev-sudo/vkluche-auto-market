create or replace function public.auction_report(p_from timestamptz default null,p_to timestamptz default null,p_organization_id uuid default null)
returns table(auction_id uuid,listing_id uuid,vehicle text,vin text,branch text,started_at timestamptz,ended_at timestamptz,status text,start_price bigint,final_price bigint,bid_count bigint,participant_count bigint,winner_amount bigint,deal_status text,workflow_stage text)
language plpgsql security definer set search_path='' as $$
begin
  if p_organization_id is not null and public.organization_role(p_organization_id) is null and public.current_role()<>'admin' then raise exception 'Недостаточно прав'; end if;
  return query
  select a.id,l.id,coalesce(l.data->>'name',concat_ws(' ',l.data->>'brand',l.data->>'model')),
    coalesce(l.vin,l.data->>'vin'),br.name,a.starts_at,a.ends_at,a.status,a.start_price,
    greatest(a.start_price,coalesce(max(b.amount),0))::bigint,count(b.id),count(distinct b.bidder_id),d.amount,d.status,d.workflow_stage
  from public.auctions a join public.listings l on l.id=a.listing_id
  left join public.organization_branches br on br.id=l.branch_id
  left join public.auction_bids b on b.auction_id=a.id
  left join lateral(select x.amount,x.status,x.workflow_stage from public.auction_deals x where x.auction_id=a.id order by x.created_at desc limit 1)d on true
  where (p_from is null or a.created_at>=p_from) and (p_to is null or a.created_at<p_to)
    and case
      when public.current_role()='admin' and p_organization_id is null then true
      when p_organization_id is not null then l.organization_id=p_organization_id
      else a.seller_id=auth.uid() or exists(select 1 from public.auction_bids own_bid where own_bid.auction_id=a.id and own_bid.bidder_id=auth.uid())
    end
  group by a.id,l.id,br.name,d.amount,d.status,d.workflow_stage
  order by a.created_at desc;
end $$;
grant execute on function public.auction_report(timestamptz,timestamptz,uuid) to authenticated;
