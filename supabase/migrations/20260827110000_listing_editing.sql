create table if not exists public.listing_revisions (
  id bigint generated always as identity primary key,
  listing_id uuid not null references public.listings(id) on delete cascade,
  edited_by uuid not null references auth.users(id),
  previous_data jsonb not null,
  new_data jsonb not null,
  changed_fields text[] not null default '{}',
  created_at timestamptz not null default now()
);

alter table public.listing_revisions enable row level security;
create policy "managers_read_listing_revisions" on public.listing_revisions for select using (
  exists(select 1 from public.listings l where l.id=listing_id and public.can_manage_listing(l))
);

create or replace function public.edit_listing(
  p_listing_id uuid,
  p_data jsonb,
  p_expected_updated_at timestamptz default null
)
returns public.listings
language plpgsql
security definer
set search_path=''
as $$
declare
  l public.listings;
  result public.listings;
  changed text[];
  needs_review boolean;
begin
  select * into l from public.listings where id=p_listing_id for update;
  if l.id is null then raise exception 'Объявление не найдено'; end if;
  if not public.can_manage_listing(l) then raise exception 'Недостаточно прав для редактирования'; end if;
  if l.source_id is not null or coalesce(l.data->>'source','') in ('automatic-feed','avito-feed') then
    raise exception 'Объявление из фида нужно изменить в исходном XML';
  end if;
  if p_expected_updated_at is not null and l.updated_at<>p_expected_updated_at then
    raise exception 'Объявление уже было изменено. Обновите страницу и повторите';
  end if;
  if exists(select 1 from public.auctions a where a.listing_id=l.id and a.status in ('scheduled','active')) then
    raise exception 'Во время запланированного или активного аукциона редактирование недоступно';
  end if;
  if coalesce(p_data->'details'->>'vin','')<>coalesce(l.data->'details'->>'vin','')
     or coalesce(p_data->'details'->>'brand','')<>coalesce(l.data->'details'->>'brand','')
     or coalesce(p_data->'details'->>'model','')<>coalesce(l.data->'details'->>'model','')
     or coalesce(p_data->>'year','')<>coalesce(l.data->>'year','')
     or coalesce(p_data->'details'->>'registrationPlate','')<>coalesce(l.data->'details'->>'registrationPlate','') then
    raise exception 'VIN, марку, модель, год и госномер можно исправить только через поддержку';
  end if;
  if coalesce(nullif(regexp_replace(coalesce(p_data->>'km','0'),'[^0-9]','','g'),'')::bigint,0)
     < coalesce(nullif(regexp_replace(coalesce(l.data->>'km','0'),'[^0-9]','','g'),'')::bigint,0) then
    raise exception 'Пробег нельзя уменьшать';
  end if;

  select coalesce(array_agg(key order by key),'{}') into changed
  from (select key from jsonb_object_keys(l.data||p_data) key where l.data->key is distinct from p_data->key) diff;
  needs_review := (l.data - array['price','city','date','badge','listingStatus','details'])
                    is distinct from (p_data - array['price','city','date','badge','listingStatus','details'])
    or ((coalesce(l.data->'details','{}'::jsonb) - array['seller','phone','location'])
          is distinct from
        (coalesce(p_data->'details','{}'::jsonb) - array['seller','phone','location']));

  insert into public.listing_revisions(listing_id,edited_by,previous_data,new_data,changed_fields)
  values(l.id,auth.uid(),l.data,p_data,changed);

  update public.listings set
    data=p_data,
    verification_status=case when needs_review then 'submitted' else verification_status end,
    updated_at=now()
  where id=l.id returning * into result;
  return result;
end;
$$;

revoke execute on function public.edit_listing(uuid,jsonb,timestamptz) from public,anon;
grant execute on function public.edit_listing(uuid,jsonb,timestamptz) to authenticated;

create index if not exists listing_revisions_listing_created_idx on public.listing_revisions(listing_id,created_at desc);
