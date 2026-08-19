create or replace function public.protect_listing_moderation_fields()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if not public.is_admin() and (
    new.verification_status is distinct from old.verification_status or
    new.moderation_note is distinct from old.moderation_note or
    (old.status in ('pending','rejected') and new.status is distinct from old.status)
  ) then raise exception 'Решение модерации может изменять только администратор'; end if;
  return new;
end $$;

drop policy if exists "owners_insert_listings" on public.listings;
create policy "owners_insert_listings" on public.listings for insert with check (
  owner_id=auth.uid() and (
    public.current_role()='admin' or (
      public.current_role()='seller' and verification_status='submitted' and status='published'
    )
  )
);
