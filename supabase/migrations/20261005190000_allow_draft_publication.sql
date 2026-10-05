-- Owners may submit a draft for review; only the platform may approve it.
create or replace function public.protect_listing_moderation_fields()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if not public.is_admin() and (
    (
      new.verification_status is distinct from old.verification_status
      and not (
        old.status='draft' and old.verification_status='unverified'
        and new.status='published' and new.active=true
        and new.verification_status='submitted'
        and public.can_manage_listing(old)
      )
    )
    or new.verification_checks is distinct from old.verification_checks
    or new.moderation_note is distinct from old.moderation_note
    or (old.status in ('pending','rejected') and new.status is distinct from old.status)
  ) then raise exception 'Результаты проверки может изменять только площадка'; end if;
  return new;
end $$;
