create extension if not exists pg_net;

do $$
declare
  feed_secret text;
begin
  select decrypted_secret into feed_secret
  from vault.decrypted_secrets
  where name = 'feed_cron_secret'
  limit 1;

  if feed_secret is null or feed_secret = '' then
    raise exception 'В Vault не найден секрет feed_cron_secret';
  end if;

  perform net.http_post(
    url := 'https://whlszhqkmvfwynwgiqnq.supabase.co/functions/v1/import-feeds',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', feed_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
end $$;
