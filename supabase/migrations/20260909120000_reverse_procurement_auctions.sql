create table if not exists public.procurement_requests (
  id uuid primary key default gen_random_uuid(), buyer_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  brand text not null check(length(trim(brand)) between 1 and 60), model text not null default '',
  year_from integer check(year_from between 1950 and 2100), year_to integer check(year_to between 1950 and 2100),
  mileage_to integer check(mileage_to>=0), budget_max bigint not null check(budget_max>0),
  price_step bigint not null default 10000 check(price_step>=1000), notes text not null default '',
  status text not null default 'active' check(status in ('active','selected','completed','cancelled')),
  ends_at timestamptz not null, selected_offer_id uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check(year_from is null or year_to is null or year_from<=year_to)
);
create table if not exists public.procurement_offers (
  id uuid primary key default gen_random_uuid(), request_id uuid not null references public.procurement_requests(id) on delete cascade,
  listing_id uuid not null references public.listings(id) on delete cascade, seller_id uuid not null references auth.users(id) on delete cascade,
  amount bigint not null check(amount>0), comment text not null default '', selected boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(request_id,listing_id)
);
alter table public.procurement_requests drop constraint if exists procurement_requests_selected_offer_id_fkey;
alter table public.procurement_requests add constraint procurement_requests_selected_offer_id_fkey foreign key(selected_offer_id) references public.procurement_offers(id) on delete set null;
create index if not exists procurement_requests_status_ends_idx on public.procurement_requests(status,ends_at);
create index if not exists procurement_offers_request_amount_idx on public.procurement_offers(request_id,amount);
alter table public.procurement_requests enable row level security;alter table public.procurement_offers enable row level security;
drop policy if exists "procurement_requests_public_read" on public.procurement_requests;
create policy "procurement_requests_public_read" on public.procurement_requests for select using(status in ('active','selected','completed') or buyer_id=auth.uid() or public.current_role()='admin' or (organization_id is not null and public.is_organization_member(organization_id)));
drop policy if exists "procurement_offers_participant_read" on public.procurement_offers;
create policy "procurement_offers_participant_read" on public.procurement_offers for select using(seller_id=auth.uid() or public.current_role()='admin' or exists(select 1 from public.procurement_requests r where r.id=request_id and (r.buyer_id=auth.uid() or (r.organization_id is not null and public.is_organization_member(r.organization_id)))));

create or replace function public.create_procurement_request(p_brand text,p_model text default '',p_year_from integer default null,p_year_to integer default null,p_mileage_to integer default null,p_budget_max bigint default null,p_price_step bigint default 10000,p_duration_hours integer default 72,p_notes text default '',p_organization_id uuid default null)
returns public.procurement_requests language plpgsql security definer set search_path='' as $$
declare r public.procurement_requests;
begin
  if auth.uid() is null then raise exception 'Требуется авторизация';end if;
  if length(trim(coalesce(p_brand,'')))<1 then raise exception 'Укажите марку';end if;
  if p_budget_max is null or p_budget_max<=0 then raise exception 'Укажите бюджет';end if;
  if p_year_from is not null and p_year_to is not null and p_year_from>p_year_to then raise exception 'Некорректный диапазон года';end if;
  if p_organization_id is not null and not public.can_manage_organization(p_organization_id) then raise exception 'Недостаточно прав для заявки компании';end if;
  insert into public.procurement_requests(buyer_id,organization_id,brand,model,year_from,year_to,mileage_to,budget_max,price_step,notes,ends_at)
  values(auth.uid(),p_organization_id,left(trim(p_brand),60),left(trim(coalesce(p_model,'')),80),p_year_from,p_year_to,p_mileage_to,p_budget_max,greatest(coalesce(p_price_step,10000),1000),left(trim(coalesce(p_notes,'')),1000),now()+make_interval(hours=>least(greatest(p_duration_hours,1),720))) returning * into r;
  return r;
end $$;
grant execute on function public.create_procurement_request(text,text,integer,integer,integer,bigint,bigint,integer,text,uuid) to authenticated;

create or replace function public.place_procurement_offer(p_request_id uuid,p_listing_id uuid,p_amount bigint,p_comment text default '')
returns public.procurement_offers language plpgsql security definer set search_path='' as $$
declare r public.procurement_requests;l public.listings;o public.procurement_offers;best bigint;vehicle_brand text;vehicle_model text;vehicle_year integer;vehicle_mileage integer;
begin
  if auth.uid() is null then raise exception 'Требуется авторизация';end if;
  select * into r from public.procurement_requests where id=p_request_id for update;
  if r.id is null then raise exception 'Заявка не найдена';end if;
  if r.status<>'active' or r.ends_at<=now() then raise exception 'Приём предложений завершён';end if;
  if r.buyer_id=auth.uid() then raise exception 'Нельзя отвечать на собственную заявку';end if;
  select * into l from public.listings where id=p_listing_id and active and status='published';if l.id is null then raise exception 'Опубликованный автомобиль не найден';end if;
  if not (l.owner_id=auth.uid() or (l.organization_id is not null and public.can_manage_organization(l.organization_id)) or public.current_role()='admin') then raise exception 'Можно предложить только свой автомобиль или автомобиль своей компании';end if;
  vehicle_brand=lower(trim(coalesce(l.data->'details'->>'brand',split_part(l.data->>'name',' ',1))));vehicle_model=lower(trim(coalesce(l.data->'details'->>'model','')));vehicle_year=nullif(l.data->>'year','')::integer;vehicle_mileage=coalesce(nullif(regexp_replace(coalesce(l.data->>'km',''),'[^0-9]','','g'),'')::integer,0);
  if vehicle_brand<>lower(trim(r.brand)) then raise exception 'Марка автомобиля не соответствует заявке';end if;
  if r.model<>'' and vehicle_model<>'' and vehicle_model not like lower(trim(r.model))||'%' then raise exception 'Модель автомобиля не соответствует заявке';end if;
  if r.year_from is not null and vehicle_year<r.year_from or r.year_to is not null and vehicle_year>r.year_to then raise exception 'Год автомобиля не соответствует заявке';end if;
  if r.mileage_to is not null and vehicle_mileage>r.mileage_to then raise exception 'Пробег автомобиля превышает условие заявки';end if;
  select min(amount) into best from public.procurement_offers where request_id=r.id;
  if p_amount>r.budget_max then raise exception 'Цена выше бюджета заявки';end if;
  if best is not null and p_amount>best-r.price_step then raise exception 'Новое предложение должно быть не выше %',best-r.price_step;end if;
  insert into public.procurement_offers(request_id,listing_id,seller_id,amount,comment) values(r.id,l.id,auth.uid(),p_amount,left(trim(coalesce(p_comment,'')),500))
  on conflict(request_id,listing_id) do update set amount=excluded.amount,comment=excluded.comment,updated_at=now() returning * into o;
  insert into public.notifications(user_id,type,title,body,dedupe_key) values(r.buyer_id,'procurement_offer','Новое предложение по заявке',coalesce(l.data->>'name','Автомобиль')||' — '||to_char(p_amount,'FM999G999G999G999')||' ₽','procurement-offer:'||o.id||':'||o.updated_at) on conflict do nothing;
  return o;
end $$;
grant execute on function public.place_procurement_offer(uuid,uuid,bigint,text) to authenticated;

create or replace function public.select_procurement_offer(p_offer_id uuid)
returns public.procurement_requests language plpgsql security definer set search_path='' as $$
declare o public.procurement_offers;r public.procurement_requests;
begin
  select * into o from public.procurement_offers where id=p_offer_id;if o.id is null then raise exception 'Предложение не найдено';end if;
  select * into r from public.procurement_requests where id=o.request_id for update;
  if not (r.buyer_id=auth.uid() or (r.organization_id is not null and public.can_manage_organization(r.organization_id)) or public.current_role()='admin') then raise exception 'Недостаточно прав';end if;
  if r.status<>'active' then raise exception 'Заявка уже завершена';end if;
  update public.procurement_offers set selected=(id=o.id) where request_id=r.id;update public.procurement_requests set status='selected',selected_offer_id=o.id,updated_at=now() where id=r.id returning * into r;
  insert into public.notifications(user_id,type,title,body,dedupe_key) select seller_id,'procurement_selected','Ваше предложение выбрано','Покупатель выбрал ваш автомобиль по заявке','procurement-selected:'||o.id from public.procurement_offers where id=o.id on conflict do nothing;
  return r;
end $$;
grant execute on function public.select_procurement_offer(uuid) to authenticated;

create or replace function public.cancel_procurement_request(p_request_id uuid)
returns public.procurement_requests language plpgsql security definer set search_path='' as $$
declare r public.procurement_requests;
begin
  select * into r from public.procurement_requests where id=p_request_id for update;if r.id is null then raise exception 'Заявка не найдена';end if;
  if not (r.buyer_id=auth.uid() or (r.organization_id is not null and public.can_manage_organization(r.organization_id)) or public.current_role()='admin') then raise exception 'Недостаточно прав';end if;
  if r.status<>'active' then raise exception 'Заявка уже завершена';end if;update public.procurement_requests set status='cancelled',updated_at=now() where id=r.id returning * into r;return r;
end $$;
grant execute on function public.cancel_procurement_request(uuid) to authenticated;

create or replace function public.procurement_catalog()
returns jsonb language sql security definer set search_path='' stable as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb) from (
    select r.*,coalesce(s.offer_count,0) offer_count,s.best_amount,
      case when r.buyer_id=auth.uid() or public.current_role()='admin' or (r.organization_id is not null and public.is_organization_member(r.organization_id)) then coalesce(s.offers,'[]'::jsonb) else '[]'::jsonb end offers
    from public.procurement_requests r left join lateral(select count(*) offer_count,min(o.amount) best_amount,jsonb_agg(jsonb_build_object('id',o.id,'amount',o.amount,'comment',o.comment,'selected',o.selected,'listing_id',o.listing_id,'vehicle_name',coalesce(l.data->>'name','Автомобиль')) order by o.amount) offers from public.procurement_offers o join public.listings l on l.id=o.listing_id where o.request_id=r.id)s on true
    where r.status in ('active','selected','completed') or r.buyer_id=auth.uid() or public.current_role()='admin' or (r.organization_id is not null and public.is_organization_member(r.organization_id))
  )x
$$;
grant execute on function public.procurement_catalog() to anon,authenticated;
