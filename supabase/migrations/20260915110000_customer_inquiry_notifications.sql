create or replace function public.notify_customer_inquiry_received()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_history_report boolean := new.message ilike '%автотек%';
begin
  if new.seller_id is null then return new; end if;

  insert into public.notifications(user_id,type,title,body,listing_id,dedupe_key)
  values (
    new.seller_id,
    case when is_history_report then 'history_report_requested' else 'customer_inquiry_received' end,
    case when is_history_report then 'Запрошен отчёт Автотеки' else 'Новое обращение по автомобилю' end,
    case when is_history_report
      then format('Покупатель запросил свежий отчёт по автомобилю %s.',coalesce(new.vehicle_name,'из объявления'))
      else format('Поступило новое обращение по автомобилю %s.',coalesce(new.vehicle_name,'из объявления'))
    end,
    new.listing_id,
    'customer-inquiry:' || new.id::text || ':seller'
  )
  on conflict (dedupe_key) do nothing;

  insert into public.notifications(user_id,type,title,body,listing_id,dedupe_key)
  select p.id,
    case when is_history_report then 'history_report_requested' else 'customer_inquiry_received' end,
    case when is_history_report then 'Запрошен отчёт Автотеки' else 'Новое обращение по автомобилю' end,
    case when is_history_report
      then format('Покупатель запросил свежий отчёт по автомобилю %s.',coalesce(new.vehicle_name,'из объявления'))
      else format('Поступило новое обращение по автомобилю %s.',coalesce(new.vehicle_name,'из объявления'))
    end,
    new.listing_id,
    'customer-inquiry:' || new.id::text || ':admin:' || p.id::text
  from public.profiles p
  where p.role='admin' and p.id<>new.seller_id
  on conflict (dedupe_key) do nothing;

  return new;
end;
$$;

drop trigger if exists customer_inquiry_notification on public.customer_inquiries;
create trigger customer_inquiry_notification
after insert on public.customer_inquiries
for each row execute function public.notify_customer_inquiry_received();
