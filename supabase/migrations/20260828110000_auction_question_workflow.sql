alter table public.auction_questions
  add column if not exists viewed_at timestamptz,
  add column if not exists reminder_sent_at timestamptz;

drop policy if exists "auction_questions_are_visible" on public.auction_questions;
drop policy if exists "participants_read_auction_questions" on public.auction_questions;
create policy "participants_read_auction_questions" on public.auction_questions for select using (
  author_id=auth.uid() or public.is_admin() or exists(
    select 1 from public.auctions a where a.id=auction_id and a.seller_id=auth.uid()
  )
);

create or replace function public.mark_auction_question_viewed(p_question_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  update public.auction_questions q set viewed_at=coalesce(q.viewed_at,now())
  where q.id=p_question_id and exists(
    select 1 from public.auctions a where a.id=q.auction_id and (a.seller_id=auth.uid() or public.is_admin())
  );
end $$;

create or replace function public.answer_auction_question(p_question_id uuid,p_answer text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if char_length(trim(coalesce(p_answer,'')))<2 then raise exception 'Введите ответ'; end if;
  update public.auction_questions q set answer=left(trim(p_answer),1000),answered_by=auth.uid(),answered_at=now(),viewed_at=coalesce(q.viewed_at,now())
  where q.id=p_question_id and q.answer is null and exists(
    select 1 from public.auctions a where a.id=q.auction_id and (a.seller_id=auth.uid() or public.is_admin())
  );
  if not found then raise exception 'Вопрос недоступен или на него уже ответили'; end if;
end $$;

create or replace function public.remind_unanswered_auction_questions()
returns integer language plpgsql security definer set search_path='' as $$
declare affected integer;
begin
  with due as (
    update public.auction_questions q set reminder_sent_at=now()
    where q.answer is null and q.reminder_sent_at is null and q.created_at<=now()-interval '24 hours'
    returning q.id,q.auction_id,q.question
  )
  insert into public.notifications(user_id,type,title,body,auction_id,dedupe_key)
  select a.seller_id,'question_reminder','Вопрос ожидает ответа более 24 часов',left(d.question,160),d.auction_id,'question-reminder:'||d.id
  from due d join public.auctions a on a.id=d.auction_id on conflict do nothing;
  get diagnostics affected=row_count;return affected;
end $$;

do $$ begin perform cron.unschedule('vkluche-question-reminders');exception when others then null;end $$;
select cron.schedule('vkluche-question-reminders','17 * * * *','select public.remind_unanswered_auction_questions()');

alter table public.max_bot_dialogs add column if not exists current_question_id uuid references public.auction_questions(id) on delete set null;
alter table public.max_bot_dialogs drop constraint if exists max_bot_dialogs_state_check;
alter table public.max_bot_dialogs add constraint max_bot_dialogs_state_check check(state in ('idle','awaiting_question','awaiting_answer'));
alter table public.telegram_bot_dialogs add column if not exists current_question_id uuid references public.auction_questions(id) on delete set null;
alter table public.telegram_bot_dialogs drop constraint if exists telegram_bot_dialogs_state_check;
alter table public.telegram_bot_dialogs add constraint telegram_bot_dialogs_state_check check(state in ('idle','awaiting_question','awaiting_answer'));
