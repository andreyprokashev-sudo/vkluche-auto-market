-- 1. Придумайте длинное случайное значение и укажите его вместо CHANGE_ME.
-- 2. Это же значение добавьте в Edge Functions → Secrets как CRON_SECRET.
select vault.create_secret('CHANGE_ME', 'feed_cron_secret');

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'vkluche-import-feeds-hourly',
  '0 * * * *',
  $$
  select net.http_post(
    url := 'https://whlszhqkmvfwynwgiqnq.supabase.co/functions/v1/import-feeds',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'feed_cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Проверка задачи:
-- select * from cron.job where jobname = 'vkluche-import-feeds-hourly';
-- select * from cron.job_run_details order by start_time desc limit 20;
