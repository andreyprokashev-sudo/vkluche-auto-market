create extension if not exists pgcrypto;
create table if not exists public.integration_connections (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 provider text not null check(provider in ('1c','crm','dms','custom')), name text not null,
 status text not null default 'draft' check(status in ('draft','active','paused','error')),
 endpoint_url text not null default '', direction text not null default 'bidirectional' check(direction in ('import','export','bidirectional')),
 event_types text[] not null default array['listing.updated','auction.completed','deal.updated']::text[],
 field_mapping jsonb not null default '{}'::jsonb, conflict_strategy text not null default 'manual' check(conflict_strategy in ('manual','vkluche_wins','external_wins','newest_wins')),
 secret_hash text not null, key_prefix text not null, created_by uuid not null references auth.users(id),
 last_sync_at timestamptz,last_error text not null default '',created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table if not exists public.integration_sync_runs (
 id uuid primary key default gen_random_uuid(),connection_id uuid not null references public.integration_connections(id) on delete cascade,
 direction text not null check(direction in ('inbound','outbound')),status text not null check(status in ('running','success','partial','error')),
 processed integer not null default 0,created integer not null default 0,updated integer not null default 0,failed integer not null default 0,
 error_summary text not null default '',started_at timestamptz not null default now(),finished_at timestamptz
);
create table if not exists public.integration_entity_links (
 connection_id uuid not null references public.integration_connections(id) on delete cascade,entity_type text not null,
 entity_id uuid not null,external_id text not null,sync_state text not null default 'synced' check(sync_state in ('synced','pending','conflict','error')),
 external_updated_at timestamptz,last_synced_at timestamptz,last_error text not null default '',primary key(connection_id,entity_type,entity_id),unique(connection_id,entity_type,external_id)
);
create table if not exists public.integration_outbox (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,
 event_type text not null,entity_type text not null,entity_id uuid not null,payload jsonb not null default '{}'::jsonb,
 status text not null default 'pending' check(status in ('pending','processing','delivered','error','cancelled')),
 attempts integer not null default 0,next_attempt_at timestamptz not null default now(),created_at timestamptz not null default now()
);
create index if not exists integration_connections_org_idx on public.integration_connections(organization_id);
create index if not exists integration_outbox_pending_idx on public.integration_outbox(status,next_attempt_at);
alter table public.integration_connections enable row level security;alter table public.integration_sync_runs enable row level security;alter table public.integration_entity_links enable row level security;alter table public.integration_outbox enable row level security;
create policy "org_managers_manage_integrations" on public.integration_connections for all using(public.can_manage_organization(organization_id)) with check(public.can_manage_organization(organization_id));
create policy "org_managers_read_sync_runs" on public.integration_sync_runs for select using(exists(select 1 from public.integration_connections c where c.id=connection_id and public.can_manage_organization(c.organization_id)));
create policy "org_managers_read_entity_links" on public.integration_entity_links for select using(exists(select 1 from public.integration_connections c where c.id=connection_id and public.can_manage_organization(c.organization_id)));
create policy "org_managers_read_outbox" on public.integration_outbox for select using(public.can_manage_organization(organization_id));

create or replace function public.create_integration_connection(p_organization_id uuid,p_provider text,p_name text,p_endpoint_url text default '',p_direction text default 'bidirectional',p_event_types text[] default array['listing.updated','auction.completed','deal.updated'],p_conflict_strategy text default 'manual')
returns jsonb language plpgsql security definer set search_path='' as $$
declare secret text;row public.integration_connections;
begin
 if not public.can_manage_organization(p_organization_id) then raise exception 'Недостаточно прав';end if;
 if p_provider not in ('1c','crm','dms','custom') then raise exception 'Неизвестный тип интеграции';end if;
 if p_endpoint_url<>'' and p_endpoint_url!~'^https://' then raise exception 'Адрес webhook должен начинаться с https://';end if;
 secret='vkli_'||encode(extensions.gen_random_bytes(24),'hex');
 insert into public.integration_connections(organization_id,provider,name,endpoint_url,direction,event_types,conflict_strategy,secret_hash,key_prefix,created_by)
 values(p_organization_id,p_provider,left(trim(p_name),100),trim(p_endpoint_url),p_direction,coalesce(p_event_types,array[]::text[]),p_conflict_strategy,encode(extensions.digest(secret,'sha256'),'hex'),left(secret,12),auth.uid()) returning * into row;
 return jsonb_build_object('connection',to_jsonb(row)-'secret_hash','api_key',secret,'warning','Ключ показывается только один раз');
end $$;
grant execute on function public.create_integration_connection(uuid,text,text,text,text,text[],text) to authenticated;

create or replace function public.set_integration_status(p_connection_id uuid,p_status text)
returns public.integration_connections language plpgsql security definer set search_path='' as $$
declare row public.integration_connections;
begin select * into row from public.integration_connections where id=p_connection_id;if row.id is null or not public.can_manage_organization(row.organization_id) then raise exception 'Недостаточно прав';end if;if p_status not in ('active','paused') then raise exception 'Недопустимый статус';end if;update public.integration_connections set status=p_status,last_error='',updated_at=now() where id=row.id returning * into row;return row;end $$;
grant execute on function public.set_integration_status(uuid,text) to authenticated;

create or replace function public.rotate_integration_key(p_connection_id uuid)
returns text language plpgsql security definer set search_path='' as $$
declare row public.integration_connections;secret text;
begin select * into row from public.integration_connections where id=p_connection_id;if row.id is null or not public.can_manage_organization(row.organization_id) then raise exception 'Недостаточно прав';end if;secret='vkli_'||encode(extensions.gen_random_bytes(24),'hex');update public.integration_connections set secret_hash=encode(extensions.digest(secret,'sha256'),'hex'),key_prefix=left(secret,12),updated_at=now() where id=row.id;return secret;end $$;
grant execute on function public.rotate_integration_key(uuid) to authenticated;

create or replace function public.resolve_integration_key(p_secret text)
returns table(connection_id uuid,organization_id uuid,provider text,direction text,event_types text[]) language sql security definer set search_path='' stable as $$
 select id,organization_id,provider,direction,event_types from public.integration_connections where status='active' and secret_hash=encode(extensions.digest(p_secret,'sha256'),'hex') limit 1
$$;
revoke all on function public.resolve_integration_key(text) from public,anon,authenticated;
grant execute on function public.resolve_integration_key(text) to service_role;
