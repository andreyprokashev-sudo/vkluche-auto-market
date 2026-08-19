-- Выполните этот файл один раз в Supabase SQL Editor.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  role text not null default 'buyer' check (role in ('buyer', 'seller', 'admin')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_are_publicly_readable"
on public.profiles for select using (true);

create policy "users_update_own_profile"
on public.profiles for update using (auth.uid() = id)
with check (auth.uid() = id and role in ('buyer', 'seller'));

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    case when new.raw_user_meta_data ->> 'role' = 'seller' then 'seller' else 'buyer' end
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Администратора назначайте только вручную в SQL Editor:
-- update public.profiles set role = 'admin' where id = '<user uuid>';
