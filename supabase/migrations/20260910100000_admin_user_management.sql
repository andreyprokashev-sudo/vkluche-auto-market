create table if not exists public.admin_user_actions (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references auth.users(id),
  target_user_id uuid not null references auth.users(id),
  action text not null check(action in ('block','unblock','set_role','set_account_type','add_to_organization','remove_from_organization')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_user_actions_target_idx
  on public.admin_user_actions(target_user_id,created_at desc);

alter table public.admin_user_actions enable row level security;
drop policy if exists "admins_read_user_actions" on public.admin_user_actions;
create policy "admins_read_user_actions" on public.admin_user_actions
  for select using(public.is_admin());
