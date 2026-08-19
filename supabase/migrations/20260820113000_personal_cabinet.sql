create table if not exists public.favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  listing_id uuid not null references public.listings(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(user_id,listing_id)
);
alter table public.favorites enable row level security;
drop policy if exists "users_manage_favorites" on public.favorites;
create policy "users_manage_favorites" on public.favorites for all
using(user_id=auth.uid()) with check(user_id=auth.uid());

create or replace function public.protect_listing_moderation_fields()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if not public.is_admin() and (
    new.verification_status is distinct from old.verification_status or
    new.moderation_note is distinct from old.moderation_note
  ) then raise exception 'Статус проверки может изменять только администратор'; end if;
  return new;
end $$;
drop trigger if exists protect_listing_moderation on public.listings;
create trigger protect_listing_moderation before update on public.listings
for each row execute function public.protect_listing_moderation_fields();

create or replace function public.moderate_listing(p_listing_id uuid,p_approve boolean,p_note text default '')
returns public.listings language plpgsql security definer set search_path='' as $$
declare l public.listings;
begin
  if not public.is_admin() then raise exception 'Недостаточно прав'; end if;
  update public.listings set
    verification_status=case when p_approve then 'verified' else 'failed' end,
    status=case when p_approve then 'published' else 'rejected' end,
    moderation_note=left(coalesce(p_note,''),500),updated_at=now()
  where id=p_listing_id returning * into l;
  if l.id is null then raise exception 'Объявление не найдено'; end if;
  if l.owner_id is not null then
    insert into public.notifications(user_id,type,title,body,dedupe_key)
    values(l.owner_id,'listing_moderation',case when p_approve then 'Автомобиль проверен' else 'Объявление отклонено' end,
      case when p_approve then 'В карточке появился статус проверки ВКЛЮЧЕ' else coalesce(nullif(left(p_note,500),''),'Проверьте данные объявления') end,
      'moderation:'||l.id||':'||case when p_approve then 'approved' else 'rejected' end) on conflict do nothing;
  end if;
  return l;
end $$;

create index if not exists favorites_user_created_idx on public.favorites(user_id,created_at desc);
