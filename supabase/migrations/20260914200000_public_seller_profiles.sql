alter table public.organizations add column if not exists description text;
alter table public.organizations add column if not exists public_phone text;
alter table public.organizations add column if not exists public_email text;
alter table public.organizations add column if not exists website text;
alter table public.organizations add column if not exists working_hours text;
alter table public.organizations add column if not exists logo_url text;
alter table public.organizations add column if not exists verified boolean not null default false;
alter table public.organizations drop constraint if exists organizations_public_urls_check;
alter table public.organizations add constraint organizations_public_urls_check check ((website is null or website ~ '^https?://') and (logo_url is null or logo_url ~ '^https?://'));

create table if not exists public.seller_reviews (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references auth.users(id) on delete cascade,
  reviewer_id uuid not null references auth.users(id) on delete cascade,
  listing_id uuid not null references public.listings(id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  comment text check (char_length(comment) between 3 and 1000),
  created_at timestamptz not null default now(),
  unique(reviewer_id,listing_id)
);
alter table public.seller_reviews enable row level security;
create policy "reviews public read" on public.seller_reviews for select using (true);

create or replace function public.submit_seller_review(p_listing_id uuid,p_rating integer,p_comment text) returns public.seller_reviews language plpgsql security definer set search_path=public as $$
declare seller uuid; result public.seller_reviews;
begin
  if p_rating not between 1 and 5 or char_length(trim(p_comment)) not between 3 and 1000 then raise exception 'Проверьте оценку и комментарий'; end if;
  select owner_id into seller from public.listings where id=p_listing_id;
  if seller is null or seller=auth.uid() then raise exception 'Нельзя оставить отзыв'; end if;
  if not exists(select 1 from public.auction_deals d join public.auctions a on a.id=d.auction_id where a.listing_id=p_listing_id and d.buyer_id=auth.uid() and d.status='confirmed') then raise exception 'Отзыв доступен после подтверждённой сделки'; end if;
  insert into public.seller_reviews(seller_id,reviewer_id,listing_id,rating,comment) values(seller,auth.uid(),p_listing_id,p_rating,trim(p_comment)) returning * into result;return result;
end $$;

create or replace function public.public_seller_profile(p_listing_id uuid) returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'sellerId',l.owner_id,'name',coalesce(o.name,l.data->'details'->>'seller','Частный продавец'),'professional',o.id is not null,
    'organizationId',o.id,'description',o.description,'phone',o.public_phone,'email',o.public_email,'website',o.website,'workingHours',o.working_hours,'logoUrl',o.logo_url,
    'verified',coalesce(o.verified,false),'listingCount',(select count(*) from public.listings x where x.active and x.status='published' and (x.organization_id=o.id or (o.id is null and x.owner_id=l.owner_id))),
    'dealCount',(select count(*) from public.auction_deals d join public.auctions a on a.id=d.auction_id join public.listings x on x.id=a.listing_id where d.status='confirmed' and (x.organization_id=o.id or (o.id is null and x.owner_id=l.owner_id))),
    'rating',coalesce((select round(avg(r.rating)::numeric,1) from public.seller_reviews r where r.seller_id=l.owner_id),0),
    'reviewCount',(select count(*) from public.seller_reviews r where r.seller_id=l.owner_id),
    'branches',coalesce((select jsonb_agg(jsonb_build_object('name',b.name,'city',b.city,'address',b.address) order by b.name) from public.organization_branches b where b.organization_id=o.id and b.active),'[]'::jsonb),
    'reviews',coalesce((select jsonb_agg(jsonb_build_object('rating',r.rating,'comment',r.comment,'createdAt',r.created_at) order by r.created_at desc) from (select * from public.seller_reviews where seller_id=l.owner_id order by created_at desc limit 10) r),'[]'::jsonb)
  ) from public.listings l left join public.organizations o on o.id=l.organization_id where l.id=p_listing_id
$$;
grant execute on function public.public_seller_profile(uuid) to anon,authenticated;
grant execute on function public.submit_seller_review(uuid,integer,text) to authenticated;
