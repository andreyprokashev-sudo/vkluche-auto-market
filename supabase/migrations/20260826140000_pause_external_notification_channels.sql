-- External bot connection flows are not live yet. Keep saved identifiers for a
-- future migration, but prevent delivery attempts until users reconnect via bots.
update public.notification_preferences
set telegram_enabled=false,max_enabled=false,updated_at=now()
where telegram_enabled=true or max_enabled=true;
