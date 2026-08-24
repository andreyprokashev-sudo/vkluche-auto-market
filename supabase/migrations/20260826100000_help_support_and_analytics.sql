create table if not exists public.help_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  topic text not null, status text not null default 'started' check(status in ('started','completed')),
  last_step integer not null default 0, updated_at timestamptz not null default now(), primary key(user_id,topic)
);
create table if not exists public.help_events (
  id bigint generated always as identity primary key,user_id uuid references auth.users(id) on delete set null,
  event_type text not null,topic text,metadata jsonb not null default '{}'::jsonb,created_at timestamptz not null default now()
);
create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check(category in ('listing','auction','feed','company','payment','technical','other')),
  subject text not null check(char_length(subject) between 3 and 160),message text not null check(char_length(message) between 10 and 4000),
  page_url text,status text not null default 'new' check(status in ('new','in_progress','answered','closed')),
  admin_note text,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
alter table public.help_progress enable row level security;alter table public.help_events enable row level security;alter table public.support_tickets enable row level security;
create policy "users_manage_help_progress" on public.help_progress for all using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy "users_add_help_events" on public.help_events for insert with check(user_id=auth.uid() or user_id is null);
create policy "admins_read_help_events" on public.help_events for select using(public.is_admin());
create policy "users_create_tickets" on public.support_tickets for insert with check(user_id=auth.uid());
create policy "users_read_own_tickets" on public.support_tickets for select using(user_id=auth.uid() or public.is_admin());
create policy "admins_update_tickets" on public.support_tickets for update using(public.is_admin()) with check(public.is_admin());
create index if not exists help_events_type_created_idx on public.help_events(event_type,created_at desc);
create index if not exists support_tickets_status_created_idx on public.support_tickets(status,created_at desc);
