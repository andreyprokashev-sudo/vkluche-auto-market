create table if not exists public.max_bot_dialogs (
  chat_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  current_auction_id uuid references public.auctions(id) on delete set null,
  current_listing_id uuid references public.listings(id) on delete set null,
  state text not null default 'idle' check (state in ('idle','awaiting_question')),
  updated_at timestamptz not null default now()
);
create index if not exists max_bot_dialogs_user_idx on public.max_bot_dialogs(user_id);
alter table public.max_bot_dialogs enable row level security;
create policy "users_read_own_max_dialog" on public.max_bot_dialogs for select using(user_id=auth.uid());

create table if not exists public.max_auction_mutes (
  user_id uuid not null references auth.users(id) on delete cascade,
  auction_id uuid not null references public.auctions(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(user_id,auction_id)
);
alter table public.max_auction_mutes enable row level security;
create policy "users_manage_own_max_mutes" on public.max_auction_mutes for all using(user_id=auth.uid()) with check(user_id=auth.uid());

create or replace function public.queue_external_notification()
returns trigger language plpgsql security definer set search_path='' as $$
declare p public.notification_preferences; user_email text;
begin
  select * into p from public.notification_preferences where user_id=new.user_id;
  select email into user_email from auth.users where id=new.user_id;
  if (new.type in ('auction_started','auction_scheduled') and not coalesce(p.auction_start,true))
    or (new.type in ('auction_reminder','auction_ending') and not coalesce(p.auction_reminder,true))
    or (new.type='outbid' and not coalesce(p.outbid,true))
    or (new.type='auction_extended' and not coalesce(p.auction_extended,true))
    or (new.type in ('auction_offer','auction_won','auction_finished','deal_confirmed') and not coalesce(p.auction_result,true))
    or (new.type like 'inspection_%' and not coalesce(p.inspection_updates,true))
    or (new.type like 'question_%' and not coalesce(p.question_updates,true)) then return new; end if;
  if coalesce(p.email_enabled,true) then insert into public.notification_delivery_queue(notification_id,user_id,channel,destination) values(new.id,new.user_id,'email',user_email) on conflict do nothing; end if;
  if coalesce(p.telegram_enabled,false) and nullif(p.telegram_chat_id,'') is not null then insert into public.notification_delivery_queue(notification_id,user_id,channel,destination) values(new.id,new.user_id,'telegram',p.telegram_chat_id) on conflict do nothing; end if;
  if coalesce(p.max_enabled,false) and nullif(p.max_chat_id,'') is not null and (new.auction_id is null or not exists(select 1 from public.max_auction_mutes m where m.user_id=new.user_id and m.auction_id=new.auction_id)) then
    insert into public.notification_delivery_queue(notification_id,user_id,channel,destination) values(new.id,new.user_id,'max',p.max_chat_id) on conflict do nothing;
  end if;
  return new;
end $$;
