create or replace function public.notify_credit_application_status()
returns trigger language plpgsql security definer set search_path='' as $$
declare status_label text;
begin
  if new.status is not distinct from old.status then return new; end if;
  status_label:=case new.status when 'contacted' then 'Специалист связался' when 'documents' then 'Ожидаются документы' when 'sent_to_partner' then 'Заявка передана партнёру' when 'approved' then 'Заявка предварительно одобрена' when 'declined' then 'По заявке получен отказ' when 'completed' then 'Кредитная сделка завершена' else 'Статус заявки изменён' end;
  insert into public.notifications(user_id,type,title,body,listing_id,dedupe_key)
  values(new.user_id,'credit_status',status_label,new.vehicle_name,new.listing_id,'credit-status:'||new.id||':'||new.status) on conflict do nothing;
  return new;
end $$;

drop trigger if exists credit_application_status_notification on public.credit_applications;
create trigger credit_application_status_notification
after update of status on public.credit_applications
for each row execute function public.notify_credit_application_status();
drop trigger if exists credit_application_status_notification on public.credit_applications;
create trigger credit_application_status_notification after update of status on public.credit_applications for each row execute function public.notify_credit_application_status();
