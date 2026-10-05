alter table public.trade_in_requests add column if not exists photos jsonb not null default '[]'::jsonb;

create or replace function public.valid_trade_in_photos(value jsonb)
returns boolean language sql immutable set search_path='' as $$
  select case when jsonb_typeof(value)<>'array' then false else
    jsonb_array_length(value)<=8 and length(value::text)<=2500000
    and not exists(
      select 1 from jsonb_array_elements(value) photo where
        jsonb_typeof(photo)<>'object'
        or jsonb_typeof(photo->'name') is distinct from 'string'
        or length(photo->>'name')>150
        or jsonb_typeof(photo->'url') is distinct from 'string'
        or length(photo->>'url')>300000
        or (photo->>'url') !~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$'
    )
  end
$$;
alter table public.trade_in_requests drop constraint if exists trade_in_photos_valid;
alter table public.trade_in_requests add constraint trade_in_photos_valid check(public.valid_trade_in_photos(photos));
-- Existing RLS keeps request photographs private to the owner and administrators.
