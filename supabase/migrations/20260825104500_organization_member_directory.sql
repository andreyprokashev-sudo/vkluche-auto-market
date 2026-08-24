create or replace function public.organization_member_directory(p_organization_id uuid)
returns table(user_id uuid,name text,email text,member_role text,created_at timestamptz)
language sql stable security definer set search_path='' as $$
  select m.user_id,p.name,u.email,m.member_role,m.created_at
  from public.organization_members m join auth.users u on u.id=m.user_id left join public.profiles p on p.id=m.user_id
  where m.organization_id=p_organization_id and m.active
    and (public.is_admin() or public.is_organization_member(p_organization_id))
  order by case m.member_role when 'owner' then 1 when 'administrator' then 2 when 'manager' then 3 else 4 end,m.created_at
$$;
