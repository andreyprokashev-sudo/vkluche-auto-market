create or replace function public.learn_vehicle_catalog_from_verified_listing()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  d jsonb := new.data -> 'details';
  key_value text;
begin
  if new.verification_status <> 'verified'
     or coalesce(d ->> 'brand', '') = ''
     or coalesce(d ->> 'model', '') = '' then
    return new;
  end if;

  key_value := 'verified:' || md5(concat_ws('|', lower(d ->> 'brand'),
    lower(d ->> 'model'), lower(coalesce(d ->> 'generation', '')),
    lower(coalesce(d ->> 'modification', '')),
    lower(coalesce(d ->> 'trimName', '')), new.data ->> 'year'));

  insert into public.vehicle_catalog (
    catalog_key, brand, model, generation, year_from, year_to,
    modification, trim_name, body, engine_type, gearbox, drive,
    doors, seats, equipment, source, confidence, updated_at
  ) values (
    key_value, d ->> 'brand', d ->> 'model', coalesce(d ->> 'generation', ''),
    (new.data ->> 'year')::integer, (new.data ->> 'year')::integer,
    coalesce(d ->> 'modification', ''), coalesce(d ->> 'trimName', ''),
    d ->> 'body', d ->> 'engineType', d ->> 'gearbox', d ->> 'drive',
    nullif(d ->> 'doors', '')::integer, nullif(d ->> 'seats', '')::integer,
    case when jsonb_typeof(d -> 'equipment') = 'array' then d -> 'equipment' else '[]'::jsonb end,
    'verified_listing', 0.95, now()
  ) on conflict (catalog_key) do update set
    equipment = excluded.equipment,
    confidence = 0.95,
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists listings_learn_vehicle_catalog on public.listings;
create trigger listings_learn_vehicle_catalog
after insert or update of verification_status, data on public.listings
for each row execute function public.learn_vehicle_catalog_from_verified_listing();
