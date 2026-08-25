create table if not exists public.max_connection_tokens (
  token text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null default now()+interval '15 minutes',
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists max_connection_tokens_user_idx on public.max_connection_tokens(user_id,created_at desc);
alter table public.max_connection_tokens enable row level security;
create policy "users_read_own_max_tokens" on public.max_connection_tokens for select using(user_id=auth.uid());

create or replace function public.disconnect_max()
returns void language plpgsql security definer set search_path='' as $$
begin
  update public.notification_preferences set max_enabled=false,max_chat_id=null,updated_at=now() where user_id=auth.uid();
  insert into public.user_consents(user_id,document_code,document_version,granted,revoked_at,metadata)
  values(auth.uid(),'channel_max','2026-08-25',false,now(),jsonb_build_object('source','notification_settings'));
end;$$;
revoke execute on function public.disconnect_max() from public,anon;
grant execute on function public.disconnect_max() to authenticated;
