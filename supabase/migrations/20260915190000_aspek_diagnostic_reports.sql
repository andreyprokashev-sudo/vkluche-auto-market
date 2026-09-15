-- Reports for vehicles inspected by the listing organization (initially АСПЭК-Авто).
update storage.buckets
set allowed_mime_types=array['application/pdf','image/jpeg','image/png','application/zip','application/x-zip-compressed']
  ,file_size_limit=31457280
where id='history-reports';

drop policy if exists "inquiry organization read" on public.customer_inquiries;
create policy "inquiry organization read" on public.customer_inquiries for select to authenticated using (
  listing_id is not null and exists(
    select 1 from public.listings l
    where l.id=listing_id and l.organization_id is not null and public.can_manage_organization(l.organization_id)
  )
);

drop policy if exists "inquiry organization update" on public.customer_inquiries;
create policy "inquiry organization update" on public.customer_inquiries for update to authenticated using (
  listing_id is not null and exists(
    select 1 from public.listings l
    where l.id=listing_id and l.organization_id is not null and public.can_manage_organization(l.organization_id)
  )
) with check (
  listing_id is not null and exists(
    select 1 from public.listings l
    where l.id=listing_id and l.organization_id is not null and public.can_manage_organization(l.organization_id)
  )
);

drop policy if exists "history report parties read" on storage.objects;
create policy "history report parties read" on storage.objects for select to authenticated using (
  bucket_id='history-reports' and exists(
    select 1 from public.customer_inquiries i left join public.listings l on l.id=i.listing_id
    where i.id::text=split_part(name,'/',1)
      and (i.user_id=auth.uid() or i.seller_id=auth.uid() or public.current_role()='admin' or public.can_manage_organization(l.organization_id))
  )
);

drop policy if exists "history report seller upload" on storage.objects;
create policy "history report seller upload" on storage.objects for insert to authenticated with check (
  bucket_id='history-reports' and exists(
    select 1 from public.customer_inquiries i left join public.listings l on l.id=i.listing_id
    where i.id::text=split_part(name,'/',1)
      and (i.seller_id=auth.uid() or public.current_role()='admin' or public.can_manage_organization(l.organization_id))
  )
);

create or replace function public.complete_history_report_request(p_inquiry_id uuid,p_report_path text,p_report_name text,p_response_message text default null)
returns void language plpgsql security definer set search_path=public as $$
declare
  i public.customer_inquiries;
  listing_organization uuid;
  diagnostic boolean;
  report_title text;
begin
  select * into i from public.customer_inquiries where id=p_inquiry_id for update;
  if i.id is null then raise exception 'Запрос не найден'; end if;
  select organization_id into listing_organization from public.listings where id=i.listing_id;
  if i.seller_id<>auth.uid() and public.current_role()<>'admin' and not coalesce(public.can_manage_organization(listing_organization),false) then
    raise exception 'Недостаточно прав';
  end if;
  diagnostic := i.message ilike '%диагностик%' or i.message ilike '%АСПЭК%';
  if not diagnostic and i.message not ilike '%автотек%' and i.message not ilike '%отчёт%состояни%' then
    raise exception 'Это не запрос диагностического отчёта';
  end if;
  if nullif(trim(p_report_path),'') is null or split_part(p_report_path,'/',1)<>p_inquiry_id::text then raise exception 'Некорректный путь файла'; end if;
  report_title := case when diagnostic then 'Отчёт диагностики и фотографии' else 'Отчёт Автотеки' end;
  update public.customer_inquiries
  set report_path=p_report_path,
      report_name=left(coalesce(nullif(trim(p_report_name),''),report_title),255),
      response_message=nullif(trim(p_response_message),''),status='completed',responded_at=now(),responded_by=auth.uid(),updated_at=now()
  where id=p_inquiry_id;
  insert into public.notifications(user_id,type,title,body,listing_id,dedupe_key)
  values(i.user_id,'history_report_ready',report_title||' готовы',format('По автомобилю %s прикреплены запрошенные материалы. Откройте обращение, чтобы скачать файл.',coalesce(i.vehicle_name,'из объявления')),i.listing_id,'history-report-ready:'||i.id::text)
  on conflict(dedupe_key) do nothing;
end;
$$;
grant execute on function public.complete_history_report_request(uuid,text,text,text) to authenticated;
