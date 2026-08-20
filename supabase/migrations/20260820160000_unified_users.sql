alter table public.profiles
  add column if not exists account_type text not null default 'private';

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles drop constraint if exists profiles_account_type_check;

update public.profiles
set role = 'user'
where role in ('buyer', 'seller');

alter table public.profiles
  add constraint profiles_role_check check (role in ('user', 'admin')),
  add constraint profiles_account_type_check check (account_type in ('private', 'professional'));

alter table public.profiles alter column role set default 'user';

create or replace function public.current_role()
returns text language sql stable security definer set search_path = ''
as $$ select coalesce((select role from public.profiles where id = auth.uid()), 'user') $$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, name, role, account_type)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    'user',
    case when new.raw_user_meta_data ->> 'account_type' = 'professional'
      then 'professional' else 'private' end
  );
  return new;
end;
$$;

drop policy if exists "users_update_own_profile" on public.profiles;
create policy "users_update_own_profile"
on public.profiles for update using (auth.uid() = id)
with check (auth.uid() = id and role = 'user');

drop policy if exists "owners_insert_listings" on public.listings;
create policy "owners_insert_listings" on public.listings for insert with check (
  owner_id=auth.uid() and (
    public.current_role()='admin' or (
      public.current_role()='user' and verification_status='submitted' and status='published'
    )
  )
);
