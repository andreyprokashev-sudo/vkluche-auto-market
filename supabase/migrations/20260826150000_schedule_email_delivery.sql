create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

do $$ begin
  if not exists(select 1 from vault.decrypted_secrets where name='notification_worker_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'notification_worker_secret','Ключ фоновой отправки уведомлений');
  end if;
end $$;

create or replace function public.verify_notification_worker(p_secret text)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from vault.decrypted_secrets where name='notification_worker_secret' and decrypted_secret=p_secret)
$$;
revoke all on function public.verify_notification_worker(text) from public,anon,authenticated;
grant execute on function public.verify_notification_worker(text) to service_role;

do $$ declare job_id bigint; begin
  select jobid into job_id from cron.job where jobname='send-email-notifications';
  if job_id is not null then perform cron.unschedule(job_id); end if;
end $$;

select cron.schedule('send-email-notifications','* * * * *',$job$
  select net.http_post(
    url := 'https://whlszhqkmvfwynwgiqnq.supabase.co/functions/v1/send-notifications',
    headers := jsonb_build_object('content-type','application/json','x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='notification_worker_secret')),
    body := '{"worker":true}'::jsonb,
    timeout_milliseconds := 30000
  );
$job$);
