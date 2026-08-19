create or replace function public.limit_comparison_items()
returns trigger language plpgsql set search_path='' as $$
begin
  if exists(select 1 from public.comparison_items where user_id=new.user_id and listing_id=new.listing_id) then return new; end if;
  if (select count(*) from public.comparison_items where user_id=new.user_id)>=4 then raise exception 'Можно сравнить не более четырёх автомобилей'; end if;
  return new;
end $$;
