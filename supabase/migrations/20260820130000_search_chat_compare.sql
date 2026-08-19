create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  buyer_id uuid not null references auth.users(id) on delete cascade,
  seller_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(listing_id,buyer_id),
  check(buyer_id<>seller_id)
);
create table if not exists public.messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text not null check(length(trim(body)) between 1 and 2000),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.comparison_items (
  user_id uuid not null references auth.users(id) on delete cascade,
  listing_id uuid not null references public.listings(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(user_id,listing_id)
);

alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.comparison_items enable row level security;
create policy "participants_read_conversations" on public.conversations for select using(buyer_id=auth.uid() or seller_id=auth.uid());
create policy "participants_update_conversations" on public.conversations for update using(buyer_id=auth.uid() or seller_id=auth.uid());
create policy "participants_read_messages" on public.messages for select using(exists(select 1 from public.conversations c where c.id=conversation_id and auth.uid() in(c.buyer_id,c.seller_id)));
create policy "participants_send_messages" on public.messages for insert with check(sender_id=auth.uid() and exists(select 1 from public.conversations c where c.id=conversation_id and auth.uid() in(c.buyer_id,c.seller_id)));
create policy "participants_mark_messages" on public.messages for update using(exists(select 1 from public.conversations c where c.id=conversation_id and auth.uid() in(c.buyer_id,c.seller_id)));
create policy "users_manage_comparison" on public.comparison_items for all using(user_id=auth.uid()) with check(user_id=auth.uid());

create or replace function public.open_conversation(p_listing_id uuid)
returns public.conversations language plpgsql security definer set search_path='' as $$
declare l public.listings; c public.conversations;
begin
  if auth.uid() is null then raise exception 'Требуется авторизация'; end if;
  select * into l from public.listings where id=p_listing_id and active and status='published';
  if l.id is null or l.owner_id is null then raise exception 'Продавец объявления недоступен'; end if;
  if l.owner_id=auth.uid() then raise exception 'Нельзя открыть чат с самим собой'; end if;
  insert into public.conversations(listing_id,buyer_id,seller_id) values(l.id,auth.uid(),l.owner_id)
  on conflict(listing_id,buyer_id) do update set updated_at=now() returning * into c;
  return c;
end $$;

create or replace function public.notify_new_message()
returns trigger language plpgsql security definer set search_path='' as $$
declare c public.conversations; recipient uuid;
begin
  select * into c from public.conversations where id=new.conversation_id;
  recipient=case when new.sender_id=c.buyer_id then c.seller_id else c.buyer_id end;
  update public.conversations set updated_at=now() where id=c.id;
  insert into public.notifications(user_id,type,title,body,dedupe_key)
  values(recipient,'new_message','Новое сообщение',left(new.body,120),'message:'||new.id) on conflict do nothing;
  return new;
end $$;
drop trigger if exists message_notification on public.messages;
create trigger message_notification after insert on public.messages for each row execute function public.notify_new_message();

create or replace function public.limit_comparison_items()
returns trigger language plpgsql set search_path='' as $$
begin
  if (select count(*) from public.comparison_items where user_id=new.user_id)>=4 then raise exception 'Можно сравнить не более четырёх автомобилей'; end if;
  return new;
end $$;
drop trigger if exists comparison_limit on public.comparison_items;
create trigger comparison_limit before insert on public.comparison_items for each row execute function public.limit_comparison_items();

create or replace function public.search_listings(
  p_query text default '',p_brands text[] default '{}',p_models text[] default '{}',p_cities text[] default '{}',
  p_gearboxes text[] default '{}',p_engines text[] default '{}',p_bodies text[] default '{}',p_drives text[] default '{}',p_conditions text[] default '{}',
  p_price_from bigint default null,p_price_to bigint default null,p_year_from integer default null,p_year_to integer default null,
  p_mileage_from bigint default null,p_mileage_to bigint default null,p_sort text default 'popular',p_limit integer default 24,p_offset integer default 0
) returns table(id uuid,owner_id uuid,data jsonb,status text,verification_status text,vin text,registration_plate text,total_count bigint)
language sql stable security definer set search_path='' as $$
  with matched as (
    select l.*,
      case when coalesce(l.data->>'price','') ~ '^\d+$' then (l.data->>'price')::bigint else 0 end price_value,
      case when coalesce(l.data->>'year','') ~ '^\d+$' then (l.data->>'year')::integer else 0 end year_value,
      coalesce(nullif(regexp_replace(l.data->>'km','\D','','g'),''),'0')::bigint mileage_value
    from public.listings l where l.active and l.status='published'
      and (coalesce(trim(p_query),'')='' or concat_ws(' ',l.data->>'name',l.data->>'engine',l.data->>'city') ilike '%'||trim(p_query)||'%')
      and (cardinality(p_brands)=0 or l.data#>>'{details,brand}'=any(p_brands))
      and (cardinality(p_models)=0 or l.data#>>'{details,model}'=any(p_models))
      and (cardinality(p_cities)=0 or l.data->>'city'=any(p_cities))
      and (cardinality(p_gearboxes)=0 or l.data#>>'{details,gearbox}'=any(p_gearboxes))
      and (cardinality(p_engines)=0 or l.data#>>'{details,engineType}'=any(p_engines))
      and (cardinality(p_bodies)=0 or l.data#>>'{details,body}'=any(p_bodies))
      and (cardinality(p_drives)=0 or l.data#>>'{details,drive}'=any(p_drives))
      and (cardinality(p_conditions)=0 or l.data#>>'{details,condition}'=any(p_conditions))
  ), filtered as (select * from matched where
    (p_price_from is null or price_value>=p_price_from) and (p_price_to is null or price_value<=p_price_to) and
    (p_year_from is null or year_value>=p_year_from) and (p_year_to is null or year_value<=p_year_to) and
    (p_mileage_from is null or mileage_value>=p_mileage_from) and (p_mileage_to is null or mileage_value<=p_mileage_to))
  select f.id,f.owner_id,f.data,f.status,f.verification_status,f.vin,f.registration_plate,count(*) over()
  from filtered f order by
    case when p_sort='low' then price_value end asc,
    case when p_sort='high' then price_value end desc,
    case when p_sort='year' then year_value end desc,
    case when p_sort='mileage' then mileage_value end asc,
    f.updated_at desc limit least(greatest(p_limit,1),100) offset greatest(p_offset,0)
$$;

create index if not exists conversations_participants_idx on public.conversations(buyer_id,seller_id,updated_at desc);
create index if not exists messages_conversation_created_idx on public.messages(conversation_id,created_at);
do $$ begin alter publication supabase_realtime add table public.messages; exception when duplicate_object then null; end $$;
