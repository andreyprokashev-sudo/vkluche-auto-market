drop function if exists public.moderate_listing(uuid,boolean,text);

create or replace function public.moderate_listing(
  p_listing_id uuid,
  p_approve boolean,
  p_note text default '',
  p_checks jsonb default '{}'::jsonb,
  p_source text default 'platform_specialist'
)
returns public.listings language plpgsql security definer set search_path='' as $$
declare l public.listings; normalized_checks jsonb;
begin
  if not public.is_admin() then raise exception 'Недостаточно прав'; end if;
  if p_approve and p_source not in ('platform_specialist','partner_report','external_registry','provided_documents') then
    raise exception 'Укажите источник проверки';
  end if;
  normalized_checks=jsonb_build_object(
    'body',coalesce((p_checks->>'body')::boolean,false),
    'technical',coalesce((p_checks->>'technical')::boolean,false),
    'legal',coalesce((p_checks->>'legal')::boolean,false),
    'mileage',coalesce((p_checks->>'mileage')::boolean,false),
    'source',p_source,
    'verified_at',now(),
    'verified_by',auth.uid()
  );
  update public.listings set
    verification_status=case when p_approve then 'verified' else 'failed' end,
    verification_checks=case when p_approve then normalized_checks else '{}'::jsonb end,
    status=case when p_approve then 'published' else 'rejected' end,
    moderation_note=left(coalesce(p_note,''),500),updated_at=now()
  where id=p_listing_id returning * into l;
  if l.id is null then raise exception 'Объявление не найдено'; end if;
  if l.owner_id is not null then
    insert into public.notifications(user_id,type,title,body,dedupe_key)
    values(l.owner_id,'listing_moderation',case when p_approve then 'Проверка автомобиля завершена' else 'Объявление отклонено' end,
      case when p_approve then 'В карточке опубликованы подтверждённые результаты проверки' else coalesce(nullif(left(p_note,500),''),'Проверьте данные объявления') end,
      'moderation:'||l.id||':'||case when p_approve then 'approved' else 'rejected' end) on conflict do nothing;
  end if;
  return l;
end $$;
