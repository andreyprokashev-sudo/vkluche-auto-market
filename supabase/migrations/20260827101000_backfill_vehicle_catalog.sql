insert into public.vehicle_catalog (
  catalog_key, brand, model, generation, year_from, year_to,
  modification, trim_name, body, engine_type, gearbox, drive,
  doors, seats, equipment, source, confidence, updated_at
)
select distinct on (catalog_key)
  'listing:' || md5(concat_ws('|',
    lower(data #>> '{details,brand}'), lower(data #>> '{details,model}'),
    lower(coalesce(data #>> '{details,generation}', '')),
    lower(coalesce(data #>> '{details,modification}', '')),
    lower(coalesce(data #>> '{details,trimName}', '')), data ->> 'year'
  )) as catalog_key,
  data #>> '{details,brand}', data #>> '{details,model}',
  coalesce(data #>> '{details,generation}', ''), (data ->> 'year')::integer,
  (data ->> 'year')::integer, coalesce(data #>> '{details,modification}', ''),
  coalesce(data #>> '{details,trimName}', ''), data #>> '{details,body}',
  data #>> '{details,engineType}', data #>> '{details,gearbox}',
  data #>> '{details,drive}', nullif(data #>> '{details,doors}', '')::integer,
  nullif(data #>> '{details,seats}', '')::integer,
  case when jsonb_typeof(data #> '{details,equipment}') = 'array'
    then data #> '{details,equipment}' else '[]'::jsonb end,
  'feed', case when coalesce(data #>> '{details,trimName}', '') <> '' then 0.85 else 0.65 end,
  now()
from public.listings
where source_id is not null
  and coalesce(data #>> '{details,brand}', '') <> ''
  and coalesce(data #>> '{details,model}', '') <> ''
order by catalog_key, updated_at desc
on conflict (catalog_key) do update set
  equipment = excluded.equipment,
  trim_name = excluded.trim_name,
  updated_at = now();
