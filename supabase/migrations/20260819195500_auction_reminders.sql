create or replace function public.generate_auction_reminders()
returns void language plpgsql security definer set search_path='' as $$
begin
  insert into public.notifications(user_id,type,title,body,auction_id,dedupe_key)
  select w.user_id,'auction_reminder','Аукцион скоро начнётся','До начала торгов осталось около 30 минут',a.id,'start30:'||a.id||':'||w.user_id
  from public.auctions a join public.auction_watchers w on w.auction_id=a.id
  where a.status='scheduled' and a.starts_at between now()+interval '29 minutes' and now()+interval '30 minutes' on conflict do nothing;

  insert into public.notifications(user_id,type,title,body,auction_id,dedupe_key)
  select w.user_id,'auction_ending','Торги скоро завершатся','До завершения осталось около 15 минут',a.id,'end15:'||a.id||':'||w.user_id
  from public.auctions a join public.auction_watchers w on w.auction_id=a.id
  where a.status='active' and a.ends_at between now()+interval '14 minutes' and now()+interval '15 minutes' on conflict do nothing;

  insert into public.notifications(user_id,type,title,body,auction_id,dedupe_key)
  select distinct b.bidder_id,'auction_ending','Торги скоро завершатся','До завершения осталось около 15 минут',a.id,'bid-end15:'||a.id||':'||b.bidder_id
  from public.auctions a join public.auction_bids b on b.auction_id=a.id
  where a.status='active' and a.ends_at between now()+interval '14 minutes' and now()+interval '15 minutes' on conflict do nothing;
end $$;

create or replace function public.advance_auction_statuses()
returns void language plpgsql security definer set search_path='' as $$
begin
  update public.auctions set status='active',updated_at=now() where status='scheduled' and starts_at<=now();
  update public.auctions set status='awaiting_seller',updated_at=now() where status='active' and ends_at<=now();
  perform public.generate_auction_reminders();
end $$;
