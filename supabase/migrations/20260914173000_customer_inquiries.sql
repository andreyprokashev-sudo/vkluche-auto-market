create table if not exists public.customer_inquiries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  listing_id uuid references public.listings(id) on delete set null,
  seller_id uuid references auth.users(id) on delete set null,
  vehicle_name text,
  inquiry_type text not null check (inquiry_type in ('purchase','callback','credit','trade_in','auction','other')),
  preferred_channel text not null default 'phone' check (preferred_channel in ('phone','telegram','max','site')),
  phone text,
  message text not null,
  status text not null default 'new' check (status in ('new','in_progress','answered','completed','closed')),
  assigned_to uuid references auth.users(id) on delete set null,
  personal_data_consent boolean not null default false check (personal_data_consent),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_inquiry_context() returns trigger language plpgsql security definer set search_path=public as $$
begin
  new.user_id=auth.uid();
  if new.listing_id is not null then
    select owner_id,coalesce(data->>'name','Автомобиль') into new.seller_id,new.vehicle_name from public.listings where id=new.listing_id;
  end if;
  return new;
end $$;
drop trigger if exists set_inquiry_context_trigger on public.customer_inquiries;
create trigger set_inquiry_context_trigger before insert on public.customer_inquiries for each row execute function public.set_inquiry_context();

alter table public.customer_inquiries enable row level security;
create policy "inquiry insert own" on public.customer_inquiries for insert to authenticated with check (user_id=auth.uid());
create policy "inquiry read parties" on public.customer_inquiries for select to authenticated using (user_id=auth.uid() or seller_id=auth.uid() or public.current_role()='admin');
create policy "inquiry admin update" on public.customer_inquiries for update to authenticated using (public.current_role()='admin') with check (public.current_role()='admin');
create index if not exists inquiries_status_created_idx on public.customer_inquiries(status,created_at desc);
create index if not exists inquiries_user_created_idx on public.customer_inquiries(user_id,created_at desc);
grant select,insert,update on public.customer_inquiries to authenticated;
