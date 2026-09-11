create or replace function public.publish_listing_draft(
  p_listing_id uuid,
  p_data jsonb,
  p_vin text default null,
  p_registration_plate text default null
)
returns public.listings
language plpgsql
security definer
set search_path=''
as $$
declare result public.listings;
begin
  if not exists(
    select 1 from public.listings l
    where l.id=p_listing_id and l.status='draft' and public.can_manage_listing(l)
  ) then raise exception 'Черновик не найден или у вас нет доступа'; end if;
  update public.listings set
    data=p_data,status='published',active=true,verification_status='submitted',
    vin=nullif(upper(trim(p_vin)),''),
    registration_plate=nullif(upper(trim(p_registration_plate)),''),updated_at=now()
  where id=p_listing_id returning * into result;
  return result;
end $$;

revoke execute on function public.publish_listing_draft(uuid,jsonb,text,text) from public,anon;
grant execute on function public.publish_listing_draft(uuid,jsonb,text,text) to authenticated;
