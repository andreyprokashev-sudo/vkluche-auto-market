insert into public.feed_sources (
  name,
  url,
  interval_minutes,
  missing_threshold,
  active
)
values (
  'MaxPoster / AutoHub — Avito',
  'https://export.maxposter.ru/avito-format/2807-37503.xml',
  60,
  2,
  true
)
on conflict (url) do update set
  name = excluded.name,
  interval_minutes = excluded.interval_minutes,
  missing_threshold = excluded.missing_threshold,
  active = true;
