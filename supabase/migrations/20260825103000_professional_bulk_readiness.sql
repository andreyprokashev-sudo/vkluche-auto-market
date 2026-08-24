create or replace function public.bulk_start_auctions(p_listing_ids uuid[],p_duration_minutes integer,p_bid_step bigint,p_winner_mode text,p_participant_access text)
returns integer language plpgsql security definer set search_path='' as $$
declare listing_id uuid;l public.listings;started integer=0;price bigint;
begin
  foreach listing_id in array p_listing_ids loop
    select * into l from public.listings where id=listing_id and active and status='published';
    if l.id is not null and public.can_manage_listing(l)
      and l.vin is not null
      and coalesce(l.data->>'img','')<>''
      and coalesce(l.data->'details'->>'description','')<>''
      and coalesce(l.data->'details'->'location'->>'address',l.data->>'city','')<>''
      and not exists(select 1 from public.auctions a where a.listing_id=l.id and a.status in ('scheduled','active','awaiting_seller','awaiting_buyer')) then
      price=greatest(coalesce((l.data->>'price')::bigint,0),1);
      perform public.start_auction(l.id,price,0,p_bid_step,now(),p_duration_minutes,true,p_winner_mode,p_participant_access);started=started+1;
    end if;
  end loop;return started;
end $$;
