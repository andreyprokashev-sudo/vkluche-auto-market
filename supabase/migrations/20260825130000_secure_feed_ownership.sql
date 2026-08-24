create or replace function public.claimable_feed_sources(p_organization_id uuid)
returns table(id uuid,name text,url text,listing_count bigint,last_status text)
language sql stable security definer set search_path='' as $$
  select f.id,f.name,f.url,count(l.id),f.last_status
  from public.feed_sources f left join public.listings l on l.source_id=f.id
  where f.organization_id is null and public.is_admin()
  group by f.id,f.name,f.url,f.last_status order by f.name
$$;

create or replace function public.attach_feed_to_organization(p_feed_id uuid,p_organization_id uuid,p_branch_id uuid default null)
returns bigint language plpgsql security definer set search_path='' as $$
declare f public.feed_sources;b public.organization_branches;affected bigint;
begin
  if not public.is_admin() then raise exception 'Ранее добавленный фид может привязать только администратор ВКЛЮЧЕ';end if;
  select * into f from public.feed_sources where id=p_feed_id for update;if f.id is null then raise exception 'Фид не найден';end if;
  if f.organization_id is not null and f.organization_id<>p_organization_id then raise exception 'Фид уже принадлежит другой организации';end if;
  if not exists(select 1 from public.organizations where id=p_organization_id) then raise exception 'Организация не найдена';end if;
  if p_branch_id is not null then select * into b from public.organization_branches where id=p_branch_id and organization_id=p_organization_id;if b.id is null then raise exception 'Филиал не принадлежит организации';end if;end if;
  update public.feed_sources set organization_id=p_organization_id,branch_id=p_branch_id where id=f.id;
  update public.listings set organization_id=p_organization_id,branch_id=coalesce(p_branch_id,branch_id),updated_at=now() where source_id=f.id;
  get diagnostics affected=row_count;return affected;
end $$;

create or replace function public.admin_unassigned_feed_sources()
returns table(id uuid,name text,url text,listing_count bigint,last_status text)
language sql stable security definer set search_path='' as $$
  select f.id,f.name,f.url,count(l.id),f.last_status from public.feed_sources f left join public.listings l on l.source_id=f.id
  where f.organization_id is null and public.is_admin() group by f.id order by f.name
$$;
