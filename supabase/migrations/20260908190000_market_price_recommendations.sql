create or replace function public.organization_market_recommendations(p_organization_id uuid)
returns table(
  listing_id uuid, vehicle text, asking_price bigint, market_median bigint,
  market_min bigint, market_max bigint, sample_size bigint, deal_count bigint,
  confidence text, recommended_start bigint, recommended_reserve bigint,
  deviation_percent integer, days_on_market integer
)
language plpgsql security definer set search_path='' as $$
begin
  if public.organization_role(p_organization_id) is null and public.current_role()<>'admin' then
    raise exception 'Недостаточно прав';
  end if;
  return query
  with own_stock as (
    select l.id,l.created_at,l.data,
      nullif(regexp_replace(coalesce(l.data->>'price',''),'[^0-9]','','g'),'')::bigint price,
      nullif(regexp_replace(coalesce(l.data->>'year',''),'[^0-9]','','g'),'')::integer model_year,
      nullif(regexp_replace(coalesce(l.data->>'mileage',''),'[^0-9]','','g'),'')::integer mileage,
      lower(coalesce(l.data->>'city','')) city
    from public.listings l
    where l.organization_id=p_organization_id and l.status not in ('archived','sold')
  )
  select s.id,coalesce(s.data->>'name',concat_ws(' ',s.data->>'brand',s.data->>'model')),s.price,
    c.median_price,c.min_price,c.max_price,c.samples,c.deals,
    case when c.deals>=3 or c.samples>=12 then 'high' when c.samples>=5 then 'medium' else 'low' end,
    case when c.median_price is null then null else round(c.median_price*.92/10000)*10000 end::bigint,
    case when c.median_price is null then null else round(c.median_price*.97/10000)*10000 end::bigint,
    case when c.median_price is null or c.median_price=0 or s.price is null then null else round((s.price-c.median_price)*100.0/c.median_price)::integer end,
    greatest(0,extract(day from now()-s.created_at)::integer)
  from own_stock s
  left join lateral (
    with candidates as (
      select nullif(regexp_replace(coalesce(x.data->>'price',''),'[^0-9]','','g'),'')::bigint value,false is_deal,
        case when lower(coalesce(x.data->>'city',''))=s.city and s.city<>'' then 0 else 1 end region_rank,
        abs(coalesce(nullif(regexp_replace(coalesce(x.data->>'year',''),'[^0-9]','','g'),'')::integer,s.model_year)-s.model_year) year_gap,
        abs(coalesce(nullif(regexp_replace(coalesce(x.data->>'mileage',''),'[^0-9]','','g'),'')::integer,s.mileage)-s.mileage) mileage_gap
      from public.listings x
      where x.id<>s.id and x.active and x.status='published'
        and lower(coalesce(x.data->>'brand',''))=lower(coalesce(s.data->>'brand',''))
        and lower(coalesce(x.data->>'model',''))=lower(coalesce(s.data->>'model',''))
      union all
      select d.amount,true,case when lower(coalesce(x.data->>'city',''))=s.city and s.city<>'' then 0 else 1 end,
        abs(coalesce(nullif(regexp_replace(coalesce(x.data->>'year',''),'[^0-9]','','g'),'')::integer,s.model_year)-s.model_year),
        abs(coalesce(nullif(regexp_replace(coalesce(x.data->>'mileage',''),'[^0-9]','','g'),'')::integer,s.mileage)-s.mileage)
      from public.auction_deals d join public.auctions a on a.id=d.auction_id join public.listings x on x.id=a.listing_id
      where d.status='confirmed'
        and lower(coalesce(x.data->>'brand',''))=lower(coalesce(s.data->>'brand',''))
        and lower(coalesce(x.data->>'model',''))=lower(coalesce(s.data->>'model',''))
    ), comparable as (
      select value,is_deal from candidates
      where (s.model_year is null or year_gap<=2) and (s.mileage is null or mileage_gap<=75000)
      order by region_rank,year_gap,mileage_gap limit 30
    )
    select percentile_cont(.5) within group(order by value)::bigint median_price,min(value)::bigint min_price,max(value)::bigint max_price,
      count(*)::bigint samples,count(*) filter(where is_deal)::bigint deals
    from comparable where value>10000
  ) c on true
  order by abs(coalesce(round((s.price-c.median_price)*100.0/nullif(c.median_price,0)),0)) desc,s.created_at;
end $$;
grant execute on function public.organization_market_recommendations(uuid) to authenticated;
