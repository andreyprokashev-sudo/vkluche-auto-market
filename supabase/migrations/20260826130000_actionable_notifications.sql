alter table public.notifications add column if not exists listing_id uuid references public.listings(id) on delete cascade;
create or replace function public.resolve_notification_listing() returns trigger language plpgsql set search_path=public as $$
begin
  if new.listing_id is null and new.type='listing_moderation' and new.dedupe_key like 'moderation:%' then
    begin new.listing_id=split_part(new.dedupe_key,':',2)::uuid; exception when invalid_text_representation then new.listing_id=null; end;
  end if;
  return new;
end $$;
drop trigger if exists resolve_notification_listing on public.notifications;
create trigger resolve_notification_listing before insert or update of dedupe_key,type on public.notifications for each row execute function public.resolve_notification_listing();
update public.notifications set listing_id=split_part(dedupe_key,':',2)::uuid where listing_id is null and type='listing_moderation' and dedupe_key ~ '^moderation:[0-9a-fA-F-]{36}:';
create index if not exists notifications_listing_idx on public.notifications(listing_id) where listing_id is not null;
