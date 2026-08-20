create or replace function public.archive_listing(p_listing_id uuid)
returns public.listings language plpgsql security definer set search_path='' as $$
declare l public.listings;
begin
  select * into l from public.listings where id=p_listing_id for update;
  if l.id is null then raise exception 'Объявление не найдено'; end if;
  if not public.can_manage_listing(l) then raise exception 'Недостаточно прав'; end if;
  if exists(
    select 1 from public.auctions a where a.listing_id=l.id
    and a.status in ('scheduled','active','awaiting_seller','awaiting_buyer')
  ) then raise exception 'Сначала завершите аукцион по этому автомобилю'; end if;
  update public.listings set active=false,status='archived',updated_at=now()
  where id=l.id returning * into l;
  return l;
end $$;
