alter table public.customer_inquiries
  add column if not exists response_message text,
  add column if not exists report_path text,
  add column if not exists report_name text,
  add column if not exists responded_at timestamptz,
  add column if not exists responded_by uuid references auth.users(id) on delete set null;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('history-reports','history-reports',false,10485760,array['application/pdf','image/jpeg','image/png'])
on conflict(id) do update set file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "history report parties read" on storage.objects;
create policy "history report parties read" on storage.objects for select to authenticated using (
  bucket_id='history-reports' and exists(select 1 from public.customer_inquiries i where i.id::text=split_part(name,'/',1) and (i.user_id=auth.uid() or i.seller_id=auth.uid() or public.current_role()='admin'))
);
drop policy if exists "history report seller upload" on storage.objects;
create policy "history report seller upload" on storage.objects for insert to authenticated with check (
  bucket_id='history-reports' and exists(select 1 from public.customer_inquiries i where i.id::text=split_part(name,'/',1) and (i.seller_id=auth.uid() or public.current_role()='admin'))
);

create or replace function public.complete_history_report_request(p_inquiry_id uuid,p_report_path text,p_report_name text,p_response_message text default null)
returns void language plpgsql security definer set search_path=public as $$
declare i public.customer_inquiries;
begin
  select * into i from public.customer_inquiries where id=p_inquiry_id for update;
  if i.id is null then raise exception 'Запрос не найден'; end if;
  if i.seller_id<>auth.uid() and public.current_role()<>'admin' then raise exception 'Недостаточно прав'; end if;
  if i.message not ilike '%автотек%' then raise exception 'Это не запрос отчёта Автотеки'; end if;
  if nullif(trim(p_report_path),'') is null or split_part(p_report_path,'/',1)<>p_inquiry_id::text then raise exception 'Некорректный путь файла'; end if;
  update public.customer_inquiries set report_path=p_report_path,report_name=left(coalesce(nullif(trim(p_report_name),''),'Отчёт Автотеки'),255),response_message=nullif(trim(p_response_message),''),status='completed',responded_at=now(),responded_by=auth.uid(),updated_at=now() where id=p_inquiry_id;
  insert into public.notifications(user_id,type,title,body,listing_id,dedupe_key)
  values(i.user_id,'history_report_ready','Отчёт Автотеки готов',format('Продавец прикрепил отчёт по автомобилю %s. Откройте «Мои обращения», чтобы скачать файл.',coalesce(i.vehicle_name,'из объявления')),i.listing_id,'history-report-ready:'||i.id::text)
  on conflict(dedupe_key) do nothing;
end;
$$;
grant execute on function public.complete_history_report_request(uuid,text,text,text) to authenticated;
