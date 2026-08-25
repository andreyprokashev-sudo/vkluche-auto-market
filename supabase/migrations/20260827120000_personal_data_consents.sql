create table if not exists public.legal_documents (
  code text not null,
  version text not null,
  title text not null,
  public_url text not null,
  effective_at timestamptz not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key(code,version)
);

insert into public.legal_documents(code,version,title,public_url,effective_at) values
('terms','2026-08-25','Пользовательское соглашение','/legal.html#terms','2026-08-25'),
('personal_data','2026-08-25','Согласие на обработку персональных данных','/legal.html#consent','2026-08-25'),
('privacy','2026-08-25','Политика обработки персональных данных','/legal.html#privacy','2026-08-25'),
('marketing','2026-08-25','Согласие на рекламные сообщения','/legal.html#marketing','2026-08-25'),
('channel_email','2026-08-25','Согласие на сервисные email-уведомления','/legal.html#processors','2026-08-25'),
('channel_telegram','2026-08-25','Согласие на уведомления в Telegram','/legal.html#processors','2026-08-25'),
('channel_max','2026-08-25','Согласие на уведомления в MAX','/legal.html#processors','2026-08-25')
on conflict do nothing;

alter table public.legal_documents enable row level security;
create policy "legal_documents_are_public" on public.legal_documents for select using (active=true);

create table if not exists public.user_consents (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  document_code text not null,
  document_version text not null,
  granted boolean not null,
  granted_at timestamptz,
  revoked_at timestamptz,
  source text not null default 'web',
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists user_consents_user_created_idx on public.user_consents(user_id,created_at desc);
alter table public.user_consents enable row level security;
create policy "users_read_own_consents" on public.user_consents for select using (user_id=auth.uid() or public.is_admin());

create or replace function public.capture_registration_consents()
returns trigger language plpgsql security definer set search_path='' as $$
declare m jsonb:=coalesce(new.raw_user_meta_data,'{}'::jsonb); at_time timestamptz:=coalesce((m->>'consented_at')::timestamptz,now());
begin
  if coalesce((m->>'terms_consent')::boolean,false) then
    insert into public.user_consents(user_id,document_code,document_version,granted,granted_at,metadata) values(new.id,'terms',coalesce(m->>'terms_version','2026-08-25'),true,at_time,jsonb_build_object('registration',true));
  end if;
  if coalesce((m->>'personal_data_consent')::boolean,false) then
    insert into public.user_consents(user_id,document_code,document_version,granted,granted_at,metadata) values(new.id,'personal_data',coalesce(m->>'personal_data_version','2026-08-25'),true,at_time,jsonb_build_object('registration',true));
  end if;
  if coalesce((m->>'privacy_acknowledged')::boolean,false) then
    insert into public.user_consents(user_id,document_code,document_version,granted,granted_at,metadata) values(new.id,'privacy',coalesce(m->>'privacy_version','2026-08-25'),true,at_time,jsonb_build_object('acknowledgement',true));
  end if;
  insert into public.user_consents(user_id,document_code,document_version,granted,granted_at,revoked_at,metadata)
  values(new.id,'channel_email','2026-08-25',coalesce((m->>'email_notifications_consent')::boolean,false),case when coalesce((m->>'email_notifications_consent')::boolean,false) then at_time end,case when not coalesce((m->>'email_notifications_consent')::boolean,false) then at_time end,jsonb_build_object('registration',true));
  insert into public.user_consents(user_id,document_code,document_version,granted,granted_at,revoked_at,metadata)
  values(new.id,'marketing','2026-08-25',coalesce((m->>'marketing_consent')::boolean,false),case when coalesce((m->>'marketing_consent')::boolean,false) then at_time end,case when not coalesce((m->>'marketing_consent')::boolean,false) then at_time end,jsonb_build_object('registration',true));
  insert into public.notification_preferences(user_id,email_enabled) values(new.id,coalesce((m->>'email_notifications_consent')::boolean,false)) on conflict(user_id) do update set email_enabled=excluded.email_enabled,updated_at=now();
  return new;
end;$$;

drop trigger if exists on_auth_user_capture_consents on auth.users;
create trigger on_auth_user_capture_consents after insert on auth.users for each row execute procedure public.capture_registration_consents();

create or replace function public.set_optional_consent(p_code text,p_granted boolean,p_metadata jsonb default '{}')
returns void language plpgsql security definer set search_path='' as $$
begin
  if p_code not in ('channel_email','channel_telegram','channel_max','marketing') then raise exception 'Это согласие изменяется через обращение к оператору'; end if;
  insert into public.user_consents(user_id,document_code,document_version,granted,granted_at,revoked_at,metadata)
  values(auth.uid(),p_code,'2026-08-25',p_granted,case when p_granted then now() end,case when not p_granted then now() end,coalesce(p_metadata,'{}'::jsonb));
end;$$;
revoke execute on function public.set_optional_consent(text,boolean,jsonb) from public,anon;
grant execute on function public.set_optional_consent(text,boolean,jsonb) to authenticated;

update public.notification_preferences set email_enabled=false,updated_at=now() where email_enabled=true;
