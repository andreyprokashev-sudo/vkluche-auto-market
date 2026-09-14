create table if not exists public.listing_view_events (
  id bigint generated always as identity primary key,
  listing_id uuid not null references public.listings(id) on delete cascade,
  viewer_id uuid references auth.users(id) on delete set null,
  visitor_hash text not null,
  viewed_on date not null default current_date,
  created_at timestamptz not null default now(),
  unique(listing_id,visitor_hash,viewed_on)
);
alter table public.listing_view_events enable row level security;
create policy "listing views organization read" on public.listing_view_events for select to authenticated using (exists(select 1 from public.listings l where l.id=listing_id and public.can_manage_organization(l.organization_id)) or public.current_role()='admin');

create or replace function public.record_listing_view(p_listing_id uuid,p_visitor_token text) returns void language plpgsql security definer set search_path=public as $$
declare fingerprint text;
begin
  if p_visitor_token is null or char_length(p_visitor_token) not between 12 and 200 then return; end if;
  if not exists(select 1 from public.listings where id=p_listing_id and active=true and status='published') then return; end if;
  fingerprint=md5(p_visitor_token||':'||p_listing_id::text);
  insert into public.listing_view_events(listing_id,viewer_id,visitor_hash) values(p_listing_id,auth.uid(),fingerprint) on conflict do nothing;
end $$;
grant execute on function public.record_listing_view(uuid,text) to anon,authenticated;

create or replace function public.organization_sales_funnel(p_organization_id uuid,p_days integer default 30) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare since timestamptz; result jsonb;
begin
  if not public.can_manage_organization(p_organization_id) then raise exception 'Недостаточно прав'; end if;
  p_days=greatest(7,least(coalesce(p_days,30),365));since=now()-make_interval(days=>p_days);
  with org_listings as (select id from public.listings where organization_id=p_organization_id),
  metrics as (
    select
      (select count(distinct visitor_hash) from public.listing_view_events v join org_listings l on l.id=v.listing_id where v.created_at>=since) views,
      (select count(*) from public.customer_inquiries q join org_listings l on l.id=q.listing_id where q.created_at>=since) inquiries,
      (select count(*) from public.listing_reservations r join org_listings l on l.id=r.listing_id where r.created_at>=since) reservations,
      (select count(*) from public.vehicle_viewing_requests w join org_listings l on l.id=w.listing_id where w.created_at>=since) viewings,
      (select count(*) from public.auction_deals d join public.auctions a on a.id=d.auction_id join org_listings l on l.id=a.listing_id where d.created_at>=since and d.status='confirmed') deals
  )
  select jsonb_build_object('days',p_days,'views',views,'inquiries',inquiries,'reservations',reservations,'viewings',viewings,'deals',deals,
    'viewToInquiry',case when views>0 then round(inquiries*100.0/views,1) else 0 end,
    'inquiryToViewing',case when inquiries>0 then round(viewings*100.0/inquiries,1) else 0 end,
    'viewingToDeal',case when viewings>0 then round(deals*100.0/viewings,1) else 0 end,
    'viewToDeal',case when views>0 then round(deals*100.0/views,1) else 0 end) into result from metrics;
  return result;
end $$;
grant execute on function public.organization_sales_funnel(uuid,integer) to authenticated;
