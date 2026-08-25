create or replace function public.capture_registration_consents()
returns trigger language plpgsql security definer set search_path='' as $$
declare m jsonb:=coalesce(new.raw_user_meta_data,'{}'::jsonb); at_time timestamptz:=coalesce((m->>'consented_at')::timestamptz,now());
begin
  if not coalesce((m->>'terms_consent')::boolean,false)
     or not coalesce((m->>'personal_data_consent')::boolean,false)
     or not coalesce((m->>'privacy_acknowledged')::boolean,false) then
    raise exception 'Для регистрации необходимо отдельно подтвердить правила и обработку персональных данных';
  end if;
  insert into public.user_consents(user_id,document_code,document_version,granted,granted_at,metadata) values
  (new.id,'terms',coalesce(m->>'terms_version','2026-08-25'),true,at_time,jsonb_build_object('registration',true)),
  (new.id,'personal_data',coalesce(m->>'personal_data_version','2026-08-25'),true,at_time,jsonb_build_object('registration',true)),
  (new.id,'privacy',coalesce(m->>'privacy_version','2026-08-25'),true,at_time,jsonb_build_object('acknowledgement',true));
  insert into public.user_consents(user_id,document_code,document_version,granted,granted_at,revoked_at,metadata)
  values(new.id,'channel_email','2026-08-25',coalesce((m->>'email_notifications_consent')::boolean,false),case when coalesce((m->>'email_notifications_consent')::boolean,false) then at_time end,case when not coalesce((m->>'email_notifications_consent')::boolean,false) then at_time end,jsonb_build_object('registration',true));
  insert into public.user_consents(user_id,document_code,document_version,granted,granted_at,revoked_at,metadata)
  values(new.id,'marketing','2026-08-25',coalesce((m->>'marketing_consent')::boolean,false),case when coalesce((m->>'marketing_consent')::boolean,false) then at_time end,case when not coalesce((m->>'marketing_consent')::boolean,false) then at_time end,jsonb_build_object('registration',true));
  insert into public.notification_preferences(user_id,email_enabled) values(new.id,coalesce((m->>'email_notifications_consent')::boolean,false)) on conflict(user_id) do update set email_enabled=excluded.email_enabled,updated_at=now();
  return new;
end;$$;
