alter table public.listings
  add column if not exists verification_checks jsonb not null default '{}'::jsonb;

update public.listings
set verification_checks = jsonb_build_object(
  'body', true,
  'technical', true,
  'legal', true,
  'mileage', true,
  'source', 'legacy_platform_review'
)
where verification_status = 'verified' and verification_checks = '{}'::jsonb;

create or replace function public.protect_listing_moderation_fields()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if not public.is_admin() and (
    new.verification_status is distinct from old.verification_status or
    new.verification_checks is distinct from old.verification_checks or
    new.moderation_note is distinct from old.moderation_note or
    (old.status in ('pending','rejected') and new.status is distinct from old.status)
  ) then raise exception 'Результаты проверки может изменять только площадка'; end if;
  return new;
end $$;

create or replace function public.moderate_listing(p_listing_id uuid,p_approve boolean,p_note text default '')
returns public.listings language plpgsql security definer set search_path='' as $$
declare l public.listings;
begin
  if not public.is_admin() then raise exception 'Недостаточно прав'; end if;
  update public.listings set
    verification_status=case when p_approve then 'verified' else 'failed' end,
    verification_checks=case when p_approve then jsonb_build_object(
      'body',true,'technical',true,'legal',true,'mileage',true,
      'source','platform_review','verified_at',now()
    ) else '{}'::jsonb end,
    status=case when p_approve then 'published' else 'rejected' end,
    moderation_note=left(coalesce(p_note,''),500),updated_at=now()
  where id=p_listing_id returning * into l;
  if l.id is null then raise exception 'Объявление не найдено'; end if;
  if l.owner_id is not null then
    insert into public.notifications(user_id,type,title,body,dedupe_key)
    values(l.owner_id,'listing_moderation',case when p_approve then 'Проверка автомобиля завершена' else 'Объявление отклонено' end,
      case when p_approve then 'В карточке опубликованы подтверждённые площадкой результаты' else coalesce(nullif(left(p_note,500),''),'Проверьте данные объявления') end,
      'moderation:'||l.id||':'||case when p_approve then 'approved' else 'rejected' end) on conflict do nothing;
  end if;
  return l;
end $$;
