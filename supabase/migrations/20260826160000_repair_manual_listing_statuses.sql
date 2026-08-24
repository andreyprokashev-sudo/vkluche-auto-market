-- Старые ручные объявления могли получить active=false без смены текстового
-- статуса. Синхронизируем только объявления пользователей, не затрагивая фиды.
update public.listings
set status='archived',updated_at=now()
where active=false and status='published' and owner_id is not null and source_id is null;
