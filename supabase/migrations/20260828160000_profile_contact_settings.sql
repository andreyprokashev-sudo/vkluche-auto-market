alter table public.profiles
  add column if not exists phone text not null default '',
  add column if not exists city text not null default '';

create or replace function public.update_my_profile(p_name text, p_phone text, p_city text)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare result public.profiles;
begin
  if auth.uid() is null then raise exception 'Войдите в аккаунт'; end if;
  if length(trim(coalesce(p_name,''))) < 2 then raise exception 'Укажите имя'; end if;
  if length(coalesce(p_name,'')) > 60 then raise exception 'Имя слишком длинное'; end if;
  if length(coalesce(p_phone,'')) > 30 then raise exception 'Телефон слишком длинный'; end if;
  if length(coalesce(p_city,'')) > 100 then raise exception 'Название города слишком длинное'; end if;
  update public.profiles
  set name=trim(p_name),phone=trim(coalesce(p_phone,'')),city=trim(coalesce(p_city,''))
  where id=auth.uid()
  returning * into result;
  return result;
end;
$$;

revoke all on function public.update_my_profile(text,text,text) from public;
grant execute on function public.update_my_profile(text,text,text) to authenticated;
