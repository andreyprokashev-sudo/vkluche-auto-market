alter table public.auction_deals
  add column if not exists workflow_stage text not null default 'confirmation',
  add column if not exists stage_deadline timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancellation_reason text;

alter table public.auction_deals drop constraint if exists auction_deals_workflow_stage_check;
alter table public.auction_deals add constraint auction_deals_workflow_stage_check check (
  workflow_stage in ('confirmation','inspection','documents','settlement','handover','completed','cancelled')
);

update public.auction_deals
set workflow_stage=case
  when status='confirmed' then 'inspection'
  when status in ('declined','expired','cancelled') then 'cancelled'
  else 'confirmation'
end,
stage_deadline=case when status='confirmed' then coalesce(stage_deadline,now()+interval '3 days') else stage_deadline end;

create table if not exists public.auction_deal_events (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.auction_deals(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  from_stage text,
  to_stage text,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists auction_deal_events_deal_idx on public.auction_deal_events(deal_id,created_at);
alter table public.auction_deal_events enable row level security;
drop policy if exists "participants_read_auction_deal_events" on public.auction_deal_events;
create policy "participants_read_auction_deal_events" on public.auction_deal_events for select using (
  public.current_role()='admin' or exists (
    select 1 from public.auction_deals d where d.id=deal_id and (d.buyer_id=auth.uid() or d.seller_id=auth.uid())
  )
);

create or replace function public.advance_auction_deal(p_deal_id uuid,p_next_stage text,p_note text default '')
returns public.auction_deals language plpgsql security definer set search_path='' as $$
declare d public.auction_deals; allowed_next text; next_deadline timestamptz;
begin
  select * into d from public.auction_deals where id=p_deal_id for update;
  if d.id is null then raise exception 'Сделка не найдена'; end if;
  if not (auth.uid()=d.seller_id or auth.uid()=d.buyer_id or public.current_role()='admin') then raise exception 'Недостаточно прав'; end if;
  if d.status<>'confirmed' then raise exception 'Этапы доступны только для подтверждённой сделки'; end if;
  allowed_next=case d.workflow_stage
    when 'inspection' then 'documents'
    when 'documents' then 'settlement'
    when 'settlement' then 'handover'
    when 'handover' then 'completed'
    else null end;
  if allowed_next is null or p_next_stage<>allowed_next then raise exception 'Недопустимый переход этапа'; end if;
  if d.workflow_stage in ('inspection','documents') and auth.uid()<>d.seller_id and public.current_role()<>'admin' then raise exception 'Этот этап подтверждает продавец'; end if;
  if d.workflow_stage in ('settlement','handover') and auth.uid()<>d.buyer_id and public.current_role()<>'admin' then raise exception 'Этот этап подтверждает покупатель'; end if;
  next_deadline=case p_next_stage when 'completed' then null else now()+interval '3 days' end;
  update public.auction_deals set workflow_stage=p_next_stage,stage_deadline=next_deadline,
    completed_at=case when p_next_stage='completed' then now() else completed_at end
  where id=d.id returning * into d;
  insert into public.auction_deal_events(deal_id,actor_id,action,from_stage,to_stage,note)
    values(d.id,auth.uid(),'stage_changed',case p_next_stage when 'documents' then 'inspection' when 'settlement' then 'documents' when 'handover' then 'settlement' else 'handover' end,p_next_stage,nullif(trim(p_note),''));
  insert into public.notifications(user_id,type,title,body,auction_id,dedupe_key)
    values(case when auth.uid()=d.seller_id then d.buyer_id else d.seller_id end,'deal_stage','Обновлён этап сделки',
      case p_next_stage when 'documents' then 'Осмотр завершён, продавец готовит документы' when 'settlement' then 'Документы готовы, согласуйте расчёт' when 'handover' then 'Расчёт согласован, подтвердите передачу автомобиля' else 'Сделка завершена' end,
      d.auction_id,'deal-stage:'||d.id||':'||p_next_stage) on conflict do nothing;
  return d;
end $$;

create or replace function public.cancel_auction_deal(p_deal_id uuid,p_reason text)
returns public.auction_deals language plpgsql security definer set search_path='' as $$
declare d public.auction_deals;
begin
  select * into d from public.auction_deals where id=p_deal_id for update;
  if d.id is null then raise exception 'Сделка не найдена'; end if;
  if not (auth.uid()=d.seller_id or auth.uid()=d.buyer_id or public.current_role()='admin') then raise exception 'Недостаточно прав'; end if;
  if d.status<>'confirmed' or d.workflow_stage in ('completed','cancelled') then raise exception 'Сделку нельзя отменить на этом этапе'; end if;
  if length(trim(coalesce(p_reason,'')))<5 then raise exception 'Укажите причину отмены'; end if;
  update public.auction_deals set status='cancelled',workflow_stage='cancelled',stage_deadline=null,cancelled_at=now(),cancellation_reason=trim(p_reason) where id=d.id returning * into d;
  update public.auctions set status='cancelled',updated_at=now() where id=d.auction_id;
  insert into public.auction_deal_events(deal_id,actor_id,action,from_stage,to_stage,note)
    values(d.id,auth.uid(),'cancelled',null,'cancelled',d.cancellation_reason);
  insert into public.auction_audit_log(auction_id,actor_id,action,details)
    values(d.auction_id,auth.uid(),'deal_cancelled',jsonb_build_object('reason',d.cancellation_reason));
  insert into public.notifications(user_id,type,title,body,auction_id,dedupe_key)
    values(case when auth.uid()=d.seller_id then d.buyer_id else d.seller_id end,'deal_cancelled','Сделка отменена',d.cancellation_reason,d.auction_id,'deal-cancelled:'||d.id) on conflict do nothing;
  return d;
end $$;

grant execute on function public.advance_auction_deal(uuid,text,text) to authenticated;
grant execute on function public.cancel_auction_deal(uuid,text) to authenticated;

create or replace function public.respond_to_auction_offer(p_deal_id uuid,p_accept boolean)
returns public.auction_deals language plpgsql security definer set search_path='' as $$
declare d public.auction_deals; a public.auctions;
begin
  select * into d from public.auction_deals where id=p_deal_id for update;
  if d.id is null or d.buyer_id<>auth.uid() then raise exception 'Предложение не найдено'; end if;
  if d.status<>'awaiting_buyer' or now()>=d.response_deadline then raise exception 'Срок ответа истёк'; end if;
  if p_accept then
    update public.auction_deals set status='confirmed',responded_at=now(),workflow_stage='inspection',stage_deadline=now()+interval '3 days' where id=d.id returning * into d;
    update public.auctions set status='deal_confirmed',updated_at=now() where id=d.auction_id returning * into a;
    insert into public.auction_deal_events(deal_id,actor_id,action,from_stage,to_stage,note) values(d.id,auth.uid(),'confirmed','confirmation','inspection','Покупатель подтвердил предложение');
    insert into public.auction_audit_log(auction_id,actor_id,action,details) values(d.auction_id,auth.uid(),'buyer_confirmed',jsonb_build_object('amount',d.amount));
    insert into public.notifications(user_id,type,title,body,auction_id,dedupe_key) values(d.seller_id,'deal_confirmed','Покупатель подтвердил сделку','Следующий этап — осмотр автомобиля',d.auction_id,'confirmed:'||d.id) on conflict do nothing;
  else
    update public.auction_deals set status='declined',responded_at=now(),workflow_stage='cancelled' where id=d.id returning * into d;
    insert into public.auction_deal_events(deal_id,actor_id,action,from_stage,to_stage,note) values(d.id,auth.uid(),'declined','confirmation','cancelled','Покупатель отказался от предложения');
    insert into public.auction_audit_log(auction_id,actor_id,action,details) values(d.auction_id,auth.uid(),'buyer_declined',jsonb_build_object('amount',d.amount));
    perform public.offer_next_auction_bid(d.auction_id);
  end if;
  return d;
end $$;
