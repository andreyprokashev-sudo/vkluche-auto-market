create or replace function public.organization_inventory_recommendations(p_organization_id uuid)
returns table(
  listing_id uuid, vehicle text, asking_price bigint, days_on_market integer,
  market_median bigint, deviation_percent integer, confidence text,
  auction_id uuid, auction_status text, unique_views bigint, bid_count bigint,
  recommendation text, priority integer, suggested_price bigint, explanation text
)
language plpgsql security definer set search_path='' as $$
begin
  if public.organization_role(p_organization_id) is null and public.current_role()<>'admin' then raise exception 'Недостаточно прав'; end if;
  return query
  with market as (
    select * from public.organization_market_recommendations(p_organization_id)
  ), base as (
    select m.*,l.verification_status,a.id last_auction_id,a.status last_auction_status,
      coalesce(v.views,0)::bigint views,coalesce(b.bids,0)::bigint bids
    from market m join public.listings l on l.id=m.listing_id
    left join lateral(select x.id,x.status from public.auctions x where x.listing_id=l.id order by x.created_at desc limit 1)a on true
    left join lateral(select count(*) views from public.auction_views x where x.auction_id=a.id)v on true
    left join lateral(select count(*) bids from public.auction_bids x where x.auction_id=a.id)b on true
  )
  select x.listing_id,x.vehicle,x.asking_price,x.days_on_market,x.market_median,x.deviation_percent,x.confidence,
    x.last_auction_id,x.last_auction_status,x.views,x.bids,
    case
      when x.verification_status<>'verified' then 'complete_verification'
      when x.last_auction_status in ('no_sale','cancelled') then 'repeat_auction'
      when x.deviation_percent>7 and x.confidence<>'low' then 'reduce_price'
      when x.days_on_market>=45 and x.last_auction_id is null then 'start_auction'
      when x.days_on_market>=30 and x.views<5 then 'improve_listing'
      else 'monitor'
    end,
    case
      when x.verification_status<>'verified' then 95
      when x.last_auction_status in ('no_sale','cancelled') then 85
      when x.deviation_percent>7 and x.confidence<>'low' then least(90,60+x.deviation_percent)
      when x.days_on_market>=45 and x.last_auction_id is null then least(80,45+x.days_on_market/3)
      when x.days_on_market>=30 and x.views<5 then 55
      else 10
    end::integer,
    case when x.deviation_percent>7 and x.confidence<>'low' then x.market_median else null end,
    case
      when x.verification_status<>'verified' then 'Завершите проверку: без подтверждённых данных доверие покупателей и конверсия ниже.'
      when x.last_auction_status in ('no_sale','cancelled') then 'Предыдущие торги не завершились сделкой. Проверьте цену и условия перед повторным запуском.'
      when x.deviation_percent>7 and x.confidence<>'low' then 'Цена выше медианы сопоставимых автомобилей; рекомендуется проверить и скорректировать её.'
      when x.days_on_market>=45 and x.last_auction_id is null then 'Автомобиль долго находится на складе и ещё не участвовал в аукционе.'
      when x.days_on_market>=30 and x.views<5 then 'Мало просмотров для срока размещения: проверьте фото, заголовок, описание и комплектацию.'
      else 'Критичных отклонений не обнаружено. Продолжайте наблюдение.'
    end
  from base x order by 13 desc,x.days_on_market desc;
end $$;
grant execute on function public.organization_inventory_recommendations(uuid) to authenticated;
