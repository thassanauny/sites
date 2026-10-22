-- iou: run once in the Supabase SQL editor, as the project administrator.
-- Keep the private schema OUT of the Data API's exposed schemas.
-- This file creates tables, so it cannot be run again on a project that has them. To pick up a later change to the
-- validation rules, run only the changed "create or replace function private.iou_valid_*" statements (see README.md).
begin;

create schema if not exists private;

create or replace function private.iou_has_keys(p_value jsonb, p_keys text[])
returns boolean language plpgsql immutable security invoker set search_path = '' as $$
begin
  if jsonb_typeof(p_value) is distinct from 'object' then return false; end if;
  return p_value ?& p_keys and not exists (
    select 1 from jsonb_object_keys(p_value) as keys(key) where not (key = any(p_keys))
  );
end;
$$;

create or replace function private.iou_valid_text(p_value jsonb, p_max integer, p_required boolean default true)
returns boolean language plpgsql immutable security invoker set search_path = '' as $$
declare value text;
begin
  if jsonb_typeof(p_value) is distinct from 'string' then return false; end if;
  value := p_value #>> '{}';
  -- Match JavaScript's UTF-16 length and trim semantics, including emoji and BOM.
  return char_length(value) + char_length(regexp_replace(value, E'[^\U00010000-\U0010ffff]', '', 'g')) <= p_max
    and (not p_required or value !~ E'^[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]*$')
    -- The same set as the client (CONTROL_PATTERN): C0 controls except tab, LF and CR, and DEL. Spelled out, because
    -- [[:cntrl:]] also matches U+0080-U+009F (and, in some locales, more) depending on the database locale.
    and value !~ E'[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]';
end;
$$;

create or replace function private.iou_valid_id(p_value jsonb)
returns boolean language plpgsql immutable security invoker set search_path = '' as $$
begin
  return jsonb_typeof(p_value) = 'string'
    and (p_value #>> '{}') ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$'
    and (p_value #>> '{}') not in ('__proto__', 'constructor', 'prototype');
end;
$$;

create or replace function private.iou_valid_date(p_value jsonb)
returns boolean language plpgsql immutable security invoker set search_path = '' as $$
declare value text;
begin
  if jsonb_typeof(p_value) is distinct from 'string' then return false; end if;
  value := p_value #>> '{}';
  if value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return false; end if;
  return to_char(value::date, 'YYYY-MM-DD') = value;
exception when others then return false;
end;
$$;

create or replace function private.iou_valid_timestamp(p_value jsonb)
returns boolean language plpgsql immutable security invoker set search_path = '' as $$
declare value text;
begin
  if jsonb_typeof(p_value) is distinct from 'string' then return false; end if;
  value := p_value #>> '{}';
  if value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,3})?Z$'
    or not private.iou_valid_date(to_jsonb(left(value, 10))) then return false; end if;
  return value::timestamptz is not null;
exception when others then return false;
end;
$$;

create or replace function private.iou_valid_money(p_value jsonb, p_allow_zero boolean default false)
returns boolean language plpgsql immutable security invoker set search_path = '' as $$
declare value numeric;
begin
  if jsonb_typeof(p_value) is distinct from 'number' then return false; end if;
  value := (p_value #>> '{}')::numeric;
  return value = trunc(value) and value <= 1000000000000 and value >= case when p_allow_zero then 0 else 1 end;
end;
$$;

create or replace function private.iou_valid_group(p_payload jsonb)
returns boolean language plpgsql immutable security invoker set search_path = '' as $$
declare
  member jsonb;
  transaction jsonb;
  participant record;
  member_ids text[] := '{}'::text[];
  transaction_ids text[] := '{}'::text[];
  shares_total numeric;
  shares_count integer;
begin
  if p_payload is null or octet_length(p_payload::text) > 4000000 then return false; end if;
  if not private.iou_has_keys(p_payload, array['id','name','description','currency','icon','color','inviteCode','createdAt','updatedAt','members','transactions'])
    or not private.iou_valid_id(p_payload->'id')
    or not private.iou_valid_text(p_payload->'name', 80)
    or not private.iou_valid_text(p_payload->'description', 500, false)
    or not private.iou_valid_text(p_payload->'icon', 32)
    or jsonb_typeof(p_payload->'currency') is distinct from 'string'
    or (p_payload->>'currency') !~ '^[A-Z]{3}$'
    or jsonb_typeof(p_payload->'color') is distinct from 'string'
    or (p_payload->>'color') !~* '^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$'
    or jsonb_typeof(p_payload->'inviteCode') is distinct from 'string'
    or (p_payload->>'inviteCode') !~ '^[a-f0-9]{32}$'
    or not private.iou_valid_timestamp(p_payload->'createdAt')
    or not private.iou_valid_timestamp(p_payload->'updatedAt')
    or jsonb_typeof(p_payload->'members') is distinct from 'array'
    or jsonb_typeof(p_payload->'transactions') is distinct from 'array'
  then return false; end if;

  if (p_payload->>'updatedAt')::timestamptz < (p_payload->>'createdAt')::timestamptz
    or jsonb_array_length(p_payload->'members') not between 1 and 100
    or jsonb_array_length(p_payload->'transactions') > 5000
  then return false; end if;

  for member in select value from jsonb_array_elements(p_payload->'members') loop
    if not private.iou_has_keys(member, array['id','name'])
      or not private.iou_valid_id(member->'id')
      or not private.iou_valid_text(member->'name', 80)
      or (member->>'id') = any(member_ids)
    then return false; end if;
    member_ids := array_append(member_ids, member->>'id');
  end loop;

  for transaction in select value from jsonb_array_elements(p_payload->'transactions') loop
    if jsonb_typeof(transaction) is distinct from 'object'
      or not private.iou_valid_id(transaction->'id')
      or (transaction->>'id') = any(transaction_ids)
      or not private.iou_valid_money(transaction->'amount')
      or not private.iou_valid_date(transaction->'date')
      or not private.iou_valid_timestamp(transaction->'createdAt')
    then return false; end if;
    transaction_ids := array_append(transaction_ids, transaction->>'id');

    if transaction->>'type' = 'expense' then
      if not private.iou_has_keys(transaction, array['id','type','description','amount','paidBy','shares','category','date','createdAt'])
        or not private.iou_valid_text(transaction->'description', 160)
        or not private.iou_valid_text(transaction->'category', 40)
        or jsonb_typeof(transaction->'paidBy') is distinct from 'string'
        or not ((transaction->>'paidBy') = any(member_ids))
        or jsonb_typeof(transaction->'shares') is distinct from 'object'
      then return false; end if;
      shares_total := 0;
      shares_count := 0;
      for participant in select key, value from jsonb_each(transaction->'shares') loop
        if not (participant.key = any(member_ids)) or not private.iou_valid_money(participant.value, true) then return false; end if;
        shares_count := shares_count + 1;
        shares_total := shares_total + (participant.value #>> '{}')::numeric;
      end loop;
      if shares_count not between 1 and 100 or shares_total <> (transaction->>'amount')::numeric then return false; end if;
    elsif transaction->>'type' = 'payment' then
      if not private.iou_has_keys(transaction, array['id','type','fromId','toId','amount','note','date','createdAt'])
        or not private.iou_valid_text(transaction->'note', 500, false)
        or jsonb_typeof(transaction->'fromId') is distinct from 'string'
        or jsonb_typeof(transaction->'toId') is distinct from 'string'
        or not ((transaction->>'fromId') = any(member_ids))
        or not ((transaction->>'toId') = any(member_ids))
        or transaction->>'fromId' = transaction->>'toId'
      then return false; end if;
    else
      return false;
    end if;
  end loop;
  return true;
exception when others then return false;
end;
$$;

create table public.iou_groups (
  id text primary key,
  invite_code text not null unique check (invite_code ~ '^[a-f0-9]{32}$'),
  payload jsonb not null check (private.iou_valid_group(payload)),
  version bigint not null default 1 check (version between 1 and 9007199254740991),
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (payload->>'id' = id),
  check (payload->>'inviteCode' = invite_code)
);

create table public.iou_group_access (
  group_id text not null references public.iou_groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create index iou_group_access_user_idx on public.iou_group_access (user_id, group_id);
create index iou_groups_creator_idx on public.iou_groups (created_by);

alter table public.iou_groups enable row level security;
alter table public.iou_group_access enable row level security;

-- All writes go through the checked RPCs. There are no public or direct write grants.
revoke all on public.iou_groups, public.iou_group_access from public, anon, authenticated;
grant select on public.iou_groups, public.iou_group_access to authenticated;

create policy iou_read_own_access on public.iou_group_access
  for select to authenticated using (user_id = (select auth.uid()));

create policy iou_read_joined_groups on public.iou_groups
  for select to authenticated using (exists (
    select 1 from public.iou_group_access access
    where access.group_id = iou_groups.id and access.user_id = (select auth.uid())
  ));

create or replace function private.iou_create_group(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  invite text;
  prepared jsonb;
  new_row public.iou_groups%rowtype;
begin
  if caller is null then raise exception 'IOU_AUTH_REQUIRED' using errcode = '42501'; end if;
  -- Bound one anonymous session's storage usage, including concurrent creates.
  perform pg_advisory_xact_lock(hashtextextended(caller::text, 9183));
  if jsonb_typeof(p_payload) is distinct from 'object'
    or not coalesce(private.iou_valid_id(p_payload->'id'), false)
  then raise exception 'IOU_INVALID_GROUP' using errcode = '22023'; end if;
  -- A response can be lost after commit. Retrying the same ID returns the
  -- creator's existing group, without overwriting it or generating another code.
  select * into new_row from public.iou_groups where id = p_payload->>'id';
  if found then
    if new_row.created_by = caller and exists (
      select 1 from public.iou_group_access where group_id = new_row.id and user_id = caller
    ) then
      return jsonb_build_object('payload', new_row.payload, 'version', new_row.version);
    end if;
    raise exception 'IOU_INVALID_GROUP' using errcode = '22023';
  end if;
  if (select count(*) from public.iou_groups where created_by = caller) >= 100 then
    raise exception 'IOU_GROUP_LIMIT' using errcode = 'P0001';
  end if;
  loop
    invite := replace(gen_random_uuid()::text, '-', '');
    prepared := jsonb_set(p_payload, '{inviteCode}', to_jsonb(invite));
    if not private.iou_valid_group(prepared) then raise exception 'IOU_INVALID_GROUP' using errcode = '22023'; end if;
    begin
      insert into public.iou_groups (id, invite_code, payload, created_by)
        values (prepared->>'id', invite, prepared, caller) returning * into new_row;
      exit;
    exception when unique_violation then
      -- Retry the exceedingly unlikely code collision, never an existing group ID.
      if exists (select 1 from public.iou_groups where id = prepared->>'id') then
        raise exception 'IOU_INVALID_GROUP' using errcode = '22023';
      end if;
    end;
  end loop;
  insert into public.iou_group_access (group_id, user_id) values (new_row.id, caller);
  return jsonb_build_object('payload', new_row.payload, 'version', new_row.version);
end;
$$;

create or replace function private.iou_join_group(p_invite_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  normalized text := lower(regexp_replace(p_invite_code, '\s+', '', 'g'));
  group_row public.iou_groups%rowtype;
begin
  if caller is null then raise exception 'IOU_AUTH_REQUIRED' using errcode = '42501'; end if;
  if normalized is null or normalized !~ '^[a-f0-9]{32}$' then
    raise exception 'IOU_INVALID_INVITE' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(caller::text, 9183));
  select * into group_row from public.iou_groups where invite_code = normalized;
  if not found then raise exception 'IOU_INVALID_INVITE' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.iou_group_access where group_id = group_row.id and user_id = caller)
    and (select count(*) from public.iou_group_access where user_id = caller) >= 1000
  then raise exception 'IOU_GROUP_LIMIT' using errcode = 'P0001'; end if;
  insert into public.iou_group_access (group_id, user_id) values (group_row.id, caller) on conflict do nothing;
  return jsonb_build_object('payload', group_row.payload, 'version', group_row.version);
end;
$$;

create or replace function private.iou_save_group(p_payload jsonb, p_expected_version bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  group_row public.iou_groups%rowtype;
begin
  if caller is null then raise exception 'IOU_AUTH_REQUIRED' using errcode = '42501'; end if;
  if p_expected_version is null or p_expected_version not between 1 and 9007199254740990
    or not private.iou_valid_group(p_payload)
  then raise exception 'IOU_INVALID_GROUP' using errcode = '22023'; end if;
  if not exists (select 1 from public.iou_group_access where group_id = p_payload->>'id' and user_id = caller) then
    raise exception 'IOU_ACCESS_DENIED' using errcode = '42501';
  end if;
  -- The lock serializes writes. Compare the revision after obtaining the lock.
  select * into group_row from public.iou_groups where id = p_payload->>'id' for update;
  if not found then raise exception 'IOU_ACCESS_DENIED' using errcode = '42501'; end if;
  if group_row.version <> p_expected_version then raise exception 'IOU_CONFLICT' using errcode = 'PT409'; end if;
  if p_payload->>'id' is distinct from group_row.payload->>'id'
    or p_payload->>'inviteCode' is distinct from group_row.invite_code
    or p_payload->>'currency' is distinct from group_row.payload->>'currency'
    or p_payload->>'createdAt' is distinct from group_row.payload->>'createdAt'
  then raise exception 'IOU_IMMUTABLE_SETTINGS' using errcode = '22023'; end if;
  update public.iou_groups set payload = p_payload, version = version + 1, updated_at = now()
    where id = group_row.id and version = p_expected_version returning * into group_row;
  if not found then raise exception 'IOU_CONFLICT' using errcode = 'PT409'; end if;
  return jsonb_build_object('payload', group_row.payload, 'version', group_row.version);
end;
$$;

-- Exposed RPC entry points have invoker privileges. Privileged code stays private.
create or replace function public.iou_create_group(p_payload jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.iou_create_group(p_payload);
$$;
create or replace function public.iou_join_group(p_invite_code text)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.iou_join_group(p_invite_code);
$$;
create or replace function public.iou_save_group(p_payload jsonb, p_expected_version bigint)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.iou_save_group(p_payload, p_expected_version);
$$;

-- Also shipped in update-group-heads.sql for installed projects. One scalar JSON
-- response avoids row caps and repeated exact counts; start from this user's access.
create or replace function private.iou_group_heads()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare caller uuid := auth.uid();
begin
  if caller is null then raise exception 'IOU_AUTH_REQUIRED' using errcode = '42501'; end if;
  return jsonb_build_object('format', 1, 'heads', coalesce((
    select jsonb_agg(jsonb_build_object('id', g.id, 'version', g.version) order by g.id)
    from public.iou_group_access a
    join public.iou_groups g on g.id = a.group_id
    where a.user_id = caller
  ), '[]'::jsonb));
end;
$$;

create or replace function public.iou_group_heads()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.iou_group_heads();
$$;

revoke all on function private.iou_group_heads(), public.iou_group_heads() from public, anon, authenticated;
grant execute on function private.iou_group_heads(), public.iou_group_heads() to authenticated;

-- Revoke PostgreSQL's default PUBLIC execution grants and Supabase role defaults.
revoke all on function private.iou_has_keys(jsonb,text[]), private.iou_valid_text(jsonb,integer,boolean),
  private.iou_valid_id(jsonb), private.iou_valid_date(jsonb), private.iou_valid_timestamp(jsonb),
  private.iou_valid_money(jsonb,boolean), private.iou_valid_group(jsonb),
  private.iou_create_group(jsonb), private.iou_join_group(text), private.iou_save_group(jsonb,bigint)
  from public, anon, authenticated;
revoke all on function public.iou_create_group(jsonb), public.iou_join_group(text), public.iou_save_group(jsonb,bigint)
  from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.iou_create_group(jsonb), private.iou_join_group(text), private.iou_save_group(jsonb,bigint)
  to authenticated;
grant execute on function public.iou_create_group(jsonb), public.iou_join_group(text), public.iou_save_group(jsonb,bigint)
  to authenticated;

-- Authoritative row storage (also installed by update-row-storage.sql).
-- Serialize cutover with existing writers; never seed rows from an old snapshot on replay.
do $$
begin
  if to_regclass('public.iou_group_headers') is null then
    lock table public.iou_groups in access exclusive mode;
    if exists (select 1 from public.iou_groups where not private.iou_valid_group(payload)) then
      raise exception 'IOU_ROW_BACKFILL_INVALID';
    end if;
    alter table public.iou_groups rename to iou_group_headers;
  end if;
end;
$$;
lock table public.iou_group_headers in access exclusive mode;

-- Reassert the maintained policy bodies, including upgrades from older installations.
alter table public.iou_group_headers enable row level security;
alter table public.iou_group_access enable row level security;
revoke all on public.iou_group_headers,public.iou_group_access from public,anon,authenticated;
grant select on public.iou_group_headers,public.iou_group_access to authenticated;
drop policy if exists iou_read_own_access on public.iou_group_access;
create policy iou_read_own_access on public.iou_group_access for select to authenticated
  using (user_id=(select auth.uid()));
drop policy if exists iou_read_joined_groups on public.iou_group_headers;
create policy iou_read_joined_groups on public.iou_group_headers for select to authenticated
  using (exists(select 1 from public.iou_group_access a where a.group_id=iou_group_headers.id and a.user_id=(select auth.uid())));

alter table public.iou_group_headers
  add column if not exists metadata jsonb,
  add column if not exists member_count integer,
  add column if not exists transaction_count integer,
  add column if not exists member_bytes bigint,
  add column if not exists transaction_bytes bigint,
  add column if not exists payload_bytes bigint;

create table if not exists public.iou_members (
  group_id text not null references public.iou_group_headers(id) on delete cascade,
  id text not null,
  name text not null,
  position bigint not null,
  payload_bytes integer not null,
  primary key (group_id,id)
);
create index if not exists iou_members_order_idx on public.iou_members(group_id,position,id);
create table if not exists public.iou_transactions (
  group_id text not null references public.iou_group_headers(id) on delete cascade,
  id text not null,
  type text not null check (type in ('expense','payment')),
  position bigint not null,
  payload_bytes integer not null,
  primary key (group_id,id),
  unique (group_id,id,type)
);
create index if not exists iou_transactions_order_idx on public.iou_transactions(group_id,position,id);
create table if not exists public.iou_expenses (
  group_id text not null,
  id text not null,
  type text not null default 'expense' check (type='expense'),
  description text not null,
  amount numeric not null check (amount=trunc(amount) and amount between 1 and 1000000000000),
  paid_by text not null,
  category text not null,
  date text not null,
  created_at text not null,
  primary key (group_id,id),
  foreign key (group_id,id,type) references public.iou_transactions(group_id,id,type) on delete cascade,
  foreign key (group_id,paid_by) references public.iou_members(group_id,id) deferrable initially deferred
);
create index if not exists iou_expenses_payer_idx on public.iou_expenses(group_id,paid_by);
create table if not exists public.iou_payments (
  group_id text not null,
  id text not null,
  type text not null default 'payment' check (type='payment'),
  amount numeric not null check (amount=trunc(amount) and amount between 1 and 1000000000000),
  from_id text not null,
  to_id text not null,
  note text not null,
  date text not null,
  created_at text not null,
  primary key (group_id,id),
  foreign key (group_id,id,type) references public.iou_transactions(group_id,id,type) on delete cascade,
  foreign key (group_id,from_id) references public.iou_members(group_id,id) deferrable initially deferred,
  foreign key (group_id,to_id) references public.iou_members(group_id,id) deferrable initially deferred,
  check (from_id<>to_id)
);
create index if not exists iou_payments_from_idx on public.iou_payments(group_id,from_id);
create index if not exists iou_payments_to_idx on public.iou_payments(group_id,to_id);
create table if not exists public.iou_expense_shares (
  group_id text not null,
  expense_id text not null,
  member_id text not null,
  amount numeric not null check (amount=trunc(amount) and amount between 0 and 1000000000000),
  primary key (group_id,expense_id,member_id),
  foreign key (group_id,expense_id) references public.iou_expenses(group_id,id) on delete cascade,
  foreign key (group_id,member_id) references public.iou_members(group_id,id) deferrable initially deferred
);
create index if not exists iou_expense_shares_member_idx on public.iou_expense_shares(group_id,member_id);

-- Invoker rights: both view and helper obey header/child membership RLS.
create or replace function private.iou_transaction_payload(p_group_id text,p_id text)
returns jsonb language sql stable security invoker set search_path='' as $$
  select case t.type when 'expense' then
    jsonb_build_object('id',e.id,'type','expense','description',e.description,'amount',e.amount,
      'paidBy',e.paid_by,'shares',coalesce((select jsonb_object_agg(s.member_id,s.amount)
        from public.iou_expense_shares s where s.group_id=e.group_id and s.expense_id=e.id),'{}'::jsonb),
      'category',e.category,'date',e.date,'createdAt',e.created_at)
    else jsonb_build_object('id',p.id,'type','payment','amount',p.amount,'fromId',p.from_id,
      'toId',p.to_id,'note',p.note,'date',p.date,'createdAt',p.created_at) end
  from public.iou_transactions t
  left join public.iou_expenses e on e.group_id=t.group_id and e.id=t.id
  left join public.iou_payments p on p.group_id=t.group_id and p.id=t.id
  where t.group_id=p_group_id and t.id=p_id;
$$;
create or replace function private.iou_group_payload(p_group_id text)
returns jsonb language sql stable security invoker set search_path='' as $$
  select h.metadata || jsonb_build_object(
    'members',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'name',m.name) order by m.position,m.id)
      from public.iou_members m where m.group_id=h.id),'[]'::jsonb),
    'transactions',coalesce((select jsonb_agg(private.iou_transaction_payload(t.group_id,t.id) order by t.position,t.id)
      from public.iou_transactions t where t.group_id=h.id),'[]'::jsonb))
  from public.iou_group_headers h where h.id=p_group_id;
$$;

-- Byte sums match JSONB text exactly, including its comma-space array separators.
create or replace function private.iou_payload_bytes(p_metadata jsonb,p_members integer,p_transactions integer,p_member_bytes bigint,p_transaction_bytes bigint)
returns bigint language sql immutable security invoker set search_path='' as $$
  select octet_length((p_metadata || jsonb_build_object('members','[]'::jsonb,'transactions','[]'::jsonb))::text)::bigint
    + p_member_bytes + p_transaction_bytes + greatest(p_members-1,0)*2 + greatest(p_transactions-1,0)*2;
$$;

create table if not exists private.iou_row_backfill (
  group_id text primary key,
  source_version bigint not null,
  source_hash text not null,
  applied_at timestamptz not null default now()
);
revoke all on private.iou_row_backfill from public,anon,authenticated;

-- Only the first cutover has a payload column. Replay verifies latest row authority.
do $$
declare g record; reconstructed jsonb;
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='iou_group_headers' and column_name='payload') then
    for g in select * from public.iou_group_headers order by id for update loop
      insert into public.iou_members(group_id,id,name,position,payload_bytes)
        select g.id,value->>'id',value->>'name',ordinality,octet_length(value::text)
        from jsonb_array_elements(g.payload->'members') with ordinality;
      insert into public.iou_transactions(group_id,id,type,position,payload_bytes)
        select g.id,value->>'id',value->>'type',ordinality,octet_length(value::text)
        from jsonb_array_elements(g.payload->'transactions') with ordinality;
      insert into public.iou_expenses(group_id,id,description,amount,paid_by,category,date,created_at)
        select g.id,value->>'id',value->>'description',(value->>'amount')::numeric,value->>'paidBy',value->>'category',value->>'date',value->>'createdAt'
        from jsonb_array_elements(g.payload->'transactions') where value->>'type'='expense';
      insert into public.iou_payments(group_id,id,amount,from_id,to_id,note,date,created_at)
        select g.id,value->>'id',(value->>'amount')::numeric,value->>'fromId',value->>'toId',value->>'note',value->>'date',value->>'createdAt'
        from jsonb_array_elements(g.payload->'transactions') where value->>'type'='payment';
      insert into public.iou_expense_shares(group_id,expense_id,member_id,amount)
        select g.id,tx.value->>'id',s.key,(s.value#>>'{}')::numeric
        from jsonb_array_elements(g.payload->'transactions') tx(value)
        cross join lateral jsonb_each(tx.value->'shares') s where tx.value->>'type'='expense';
      update public.iou_group_headers set metadata=g.payload-'members'-'transactions',
        member_count=jsonb_array_length(g.payload->'members'),transaction_count=jsonb_array_length(g.payload->'transactions'),
        member_bytes=(select coalesce(sum(payload_bytes),0) from public.iou_members where group_id=g.id),
        transaction_bytes=(select coalesce(sum(payload_bytes),0) from public.iou_transactions where group_id=g.id),
        payload_bytes=octet_length(g.payload::text) where id=g.id;
      insert into private.iou_row_backfill(group_id,source_version,source_hash) values(g.id,g.version,md5(g.payload::text))
        on conflict(group_id) do update set source_version=excluded.source_version,source_hash=excluded.source_hash,applied_at=now();
      reconstructed:=private.iou_group_payload(g.id);
      if reconstructed is distinct from g.payload or md5(reconstructed::text)<>md5(g.payload::text)
        or not private.iou_valid_group(reconstructed) then raise exception 'IOU_ROW_BACKFILL_MISMATCH %',g.id; end if;
    end loop;
    -- Drop only the obsolete full-document storage and its dependent checks.
    if exists(select 1 from pg_trigger where tgrelid='public.iou_group_headers'::regclass and tgname='iou_live_group_change') then
      drop trigger iou_live_group_change on public.iou_group_headers;
      create trigger iou_live_group_change after update of version on public.iou_group_headers
        for each row execute function private.iou_broadcast_group_change();
    end if;
    alter table public.iou_group_headers drop column payload;
  end if;
  for g in select * from public.iou_group_headers order by id for update loop
    reconstructed:=private.iou_group_payload(g.id);
    if not private.iou_valid_group(reconstructed)
      or octet_length(reconstructed::text)<>g.payload_bytes
      or g.member_count<>(select count(*) from public.iou_members where group_id=g.id)
      or g.transaction_count<>(select count(*) from public.iou_transactions where group_id=g.id)
      or g.member_bytes<>(select coalesce(sum(payload_bytes),0) from public.iou_members where group_id=g.id)
      or g.transaction_bytes<>(select coalesce(sum(payload_bytes),0) from public.iou_transactions where group_id=g.id)
      or g.payload_bytes<>private.iou_payload_bytes(g.metadata,g.member_count,g.transaction_count,g.member_bytes,g.transaction_bytes)
      then raise exception 'IOU_ROW_AUTHORITY_INVALID %',g.id; end if;
  end loop;
end;
$$;
-- Drain backfill FK events before changing child-table RLS. Only IOU's member
-- references are affected; the encompassing upgrade may include other apps.
set constraints public.iou_expenses_group_id_paid_by_fkey,public.iou_payments_group_id_from_id_fkey,
  public.iou_payments_group_id_to_id_fkey,public.iou_expense_shares_group_id_member_id_fkey immediate;
alter table public.iou_group_headers alter column metadata set not null,
  alter column member_count set not null,alter column transaction_count set not null,
  alter column member_bytes set not null,alter column transaction_bytes set not null,alter column payload_bytes set not null;

-- No child table is a public write API. Reads require joined-parent membership.
do $$
declare relation text;
begin
  foreach relation in array array['iou_members','iou_transactions','iou_expenses','iou_payments','iou_expense_shares'] loop
    execute format('alter table public.%I enable row level security',relation);
    execute format('revoke all on public.%I from public,anon,authenticated',relation);
    execute format('grant select on public.%I to authenticated',relation);
    execute format('drop policy if exists iou_read_joined_rows on public.%I',relation);
    execute format('create policy iou_read_joined_rows on public.%I for select to authenticated using (exists (select 1 from public.iou_group_access a where a.group_id=%I.group_id and a.user_id=(select auth.uid())))',relation,relation);
  end loop;
end;
$$;
create or replace view public.iou_groups with (security_invoker=true) as
  select h.id,h.invite_code,private.iou_group_payload(h.id) as payload,h.version,h.created_by,h.updated_at
  from public.iou_group_headers h;
revoke all on public.iou_groups from public,anon,authenticated;
grant select on public.iou_groups to authenticated;
revoke all on function private.iou_group_payload(text),private.iou_transaction_payload(text,text),private.iou_payload_bytes(jsonb,integer,integer,bigint,bigint) from public,anon,authenticated;
grant execute on function private.iou_group_payload(text),private.iou_transaction_payload(text,text) to authenticated;

-- Validate just one changed transaction, using the small current member set.
create or replace function private.iou_valid_transaction(p_transaction jsonb,p_member_ids text[])
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare participant record; total numeric:=0; count integer:=0;
begin
  if not private.iou_valid_id(p_transaction->'id') or not private.iou_valid_money(p_transaction->'amount')
    or not private.iou_valid_date(p_transaction->'date') or not private.iou_valid_timestamp(p_transaction->'createdAt') then return false; end if;
  if p_transaction->>'type'='expense' then
    if not private.iou_has_keys(p_transaction,array['id','type','description','amount','paidBy','shares','category','date','createdAt'])
      or not private.iou_valid_text(p_transaction->'description',160) or not private.iou_valid_text(p_transaction->'category',40)
      or jsonb_typeof(p_transaction->'paidBy') is distinct from 'string'
      or not ((p_transaction->>'paidBy')=any(p_member_ids)) or jsonb_typeof(p_transaction->'shares') is distinct from 'object' then return false; end if;
    for participant in select key,value from jsonb_each(p_transaction->'shares') loop
      if not (participant.key=any(p_member_ids)) or not private.iou_valid_money(participant.value,true) then return false; end if;
      total:=total+(participant.value#>>'{}')::numeric; count:=count+1;
    end loop;
    return count between 1 and 100 and total=(p_transaction->>'amount')::numeric;
  elsif p_transaction->>'type'='payment' then
    return private.iou_has_keys(p_transaction,array['id','type','fromId','toId','amount','note','date','createdAt'])
      and private.iou_valid_text(p_transaction->'note',500,false)
      and jsonb_typeof(p_transaction->'fromId')='string' and jsonb_typeof(p_transaction->'toId')='string'
      and (p_transaction->>'fromId')=any(p_member_ids) and (p_transaction->>'toId')=any(p_member_ids)
      and p_transaction->>'fromId'<>p_transaction->>'toId';
  end if;
  return false;
exception when others then return false;
end;
$$;

-- Internal writer; callers already hold this group's row lock and enforce access/version.
create or replace function private.iou_apply_delta(p_id text,p_delta jsonb)
returns void language plpgsql security invoker set search_path='' as $$
#variable_conflict use_variable
declare
  h public.iou_group_headers%rowtype;
  part text; section jsonb; item jsonb; old_bytes integer; old_type text; old_position bigint; new_bytes integer;
  member_ids text[]; members jsonb; current_count integer; ordered_count integer;
  next_position bigint; member_count integer; transaction_count integer; member_bytes bigint; transaction_bytes bigint; total_bytes bigint;
begin
  select * into strict h from public.iou_group_headers where id=p_id;
  if not private.iou_has_keys(p_delta,array['metadata','members','transactions'])
    or not coalesce(private.iou_has_keys(p_delta->'metadata',array['id','name','description','currency','icon','color','inviteCode','createdAt','updatedAt']),false) then raise exception 'IOU_INVALID_GROUP' using errcode='22023'; end if;
  if p_delta->'metadata'->>'id' is distinct from h.id or p_delta->'metadata'->>'inviteCode' is distinct from h.invite_code
    or p_delta->'metadata'->>'currency' is distinct from h.metadata->>'currency'
    or p_delta->'metadata'->>'createdAt' is distinct from h.metadata->>'createdAt' then raise exception 'IOU_IMMUTABLE_SETTINGS' using errcode='22023'; end if;
  foreach part in array array['members','transactions'] loop
    section:=p_delta->part;
    if jsonb_typeof(section) is distinct from 'object' or not section ?& array['upsert','remove']
      or exists (select 1 from jsonb_object_keys(section) k where k not in ('upsert','remove','order'))
      or jsonb_typeof(section->'upsert') is distinct from 'array' or jsonb_typeof(section->'remove') is distinct from 'array'
      or jsonb_array_length(section->'upsert')>(case when part='members' then 100 else 5000 end)
      or jsonb_array_length(section->'remove')>(case when part='members' then 100 else 5000 end)
      then raise exception 'IOU_INVALID_GROUP' using errcode='22023'; end if;
    if exists (select 1 from jsonb_array_elements(section->'upsert') v where not coalesce(private.iou_valid_id(v->'id'),false))
      or exists (select 1 from jsonb_array_elements(section->'remove') v where not coalesce(private.iou_valid_id(v),false))
      or (select count(*)<>count(distinct value->>'id') from jsonb_array_elements(section->'upsert'))
      or (select count(*)<>count(distinct value#>>'{}') from jsonb_array_elements(section->'remove'))
      or exists (select 1 from jsonb_array_elements(section->'upsert') u join jsonb_array_elements(section->'remove') r on u->>'id'=r#>>'{}')
      then raise exception 'IOU_INVALID_GROUP' using errcode='22023'; end if;
  end loop;
  member_count:=h.member_count; transaction_count:=h.transaction_count; member_bytes:=h.member_bytes; transaction_bytes:=h.transaction_bytes;
  select coalesce(max(position),0) into next_position from public.iou_members where group_id=p_id;
  for item in select value from jsonb_array_elements(p_delta->'members'->'upsert') loop
    if not private.iou_has_keys(item,array['id','name']) or not private.iou_valid_text(item->'name',80) then raise exception 'IOU_INVALID_GROUP' using errcode='22023'; end if;
    select payload_bytes into old_bytes from public.iou_members where group_id=p_id and id=item->>'id';
    new_bytes:=octet_length(item::text); member_bytes:=member_bytes+new_bytes-coalesce(old_bytes,0);
    if not found then member_count:=member_count+1; next_position:=next_position+1; end if;
    insert into public.iou_members(group_id,id,name,position,payload_bytes) values(p_id,item->>'id',item->>'name',next_position,new_bytes)
      on conflict(group_id,id) do update set name=excluded.name,payload_bytes=excluded.payload_bytes
      where iou_members.name is distinct from excluded.name;
  end loop;
  -- References are validated against the final member set, including intended removals.
  select coalesce(array_agg(id),'{}'::text[]),coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name)),'[]'::jsonb)
    into member_ids,members from public.iou_members where group_id=p_id
    and not (id in (select value#>>'{}' from jsonb_array_elements(p_delta->'members'->'remove')));
  if not coalesce(private.iou_valid_group(p_delta->'metadata'||jsonb_build_object('members',members,'transactions','[]'::jsonb)),false)
    then raise exception 'IOU_INVALID_GROUP' using errcode='22023'; end if;
  for item in select value from jsonb_array_elements(p_delta->'transactions'->'remove') loop
    delete from public.iou_transactions where group_id=p_id and id=item#>>'{}' returning payload_bytes into old_bytes;
    if found then transaction_count:=transaction_count-1; transaction_bytes:=transaction_bytes-old_bytes; end if;
  end loop;
  select coalesce(max(position),0) into next_position from public.iou_transactions where group_id=p_id;
  for item in select value from jsonb_array_elements(p_delta->'transactions'->'upsert') loop
    if not coalesce(private.iou_valid_transaction(item,member_ids),false) then raise exception 'IOU_INVALID_GROUP' using errcode='22023'; end if;
    select payload_bytes,type,position into old_bytes,old_type,old_position from public.iou_transactions where group_id=p_id and id=item->>'id';
    new_bytes:=coalesce(old_bytes,0);
    if not found then transaction_count:=transaction_count+1; next_position:=next_position+1; end if;
    if old_type is not null and old_type<>item->>'type' then delete from public.iou_transactions where group_id=p_id and id=item->>'id'; end if;
    insert into public.iou_transactions(group_id,id,type,position,payload_bytes) values(p_id,item->>'id',item->>'type',coalesce(old_position,next_position),new_bytes)
      on conflict(group_id,id) do update set payload_bytes=excluded.payload_bytes where iou_transactions.payload_bytes<>excluded.payload_bytes;
    if item->>'type'='expense' then
      insert into public.iou_expenses(group_id,id,description,amount,paid_by,category,date,created_at)
        values(p_id,item->>'id',item->>'description',(item->>'amount')::numeric,item->>'paidBy',item->>'category',item->>'date',item->>'createdAt')
        on conflict(group_id,id) do update set description=excluded.description,amount=excluded.amount,paid_by=excluded.paid_by,
          category=excluded.category,date=excluded.date,created_at=excluded.created_at
        where (iou_expenses.description,iou_expenses.amount,iou_expenses.paid_by,iou_expenses.category,iou_expenses.date,iou_expenses.created_at)
          is distinct from (excluded.description,excluded.amount,excluded.paid_by,excluded.category,excluded.date,excluded.created_at)
          or iou_expenses.amount::text is distinct from excluded.amount::text;
      delete from public.iou_expense_shares where group_id=p_id and expense_id=item->>'id' and not (member_id in(select key from jsonb_each(item->'shares')));
      insert into public.iou_expense_shares(group_id,expense_id,member_id,amount)
        select p_id,item->>'id',key,(value#>>'{}')::numeric from jsonb_each(item->'shares')
        on conflict(group_id,expense_id,member_id) do update set amount=excluded.amount where iou_expense_shares.amount::text is distinct from excluded.amount::text;
    else
      insert into public.iou_payments(group_id,id,amount,from_id,to_id,note,date,created_at)
        values(p_id,item->>'id',(item->>'amount')::numeric,item->>'fromId',item->>'toId',item->>'note',item->>'date',item->>'createdAt')
        on conflict(group_id,id) do update set amount=excluded.amount,from_id=excluded.from_id,to_id=excluded.to_id,
          note=excluded.note,date=excluded.date,created_at=excluded.created_at
        where (iou_payments.amount,iou_payments.from_id,iou_payments.to_id,iou_payments.note,iou_payments.date,iou_payments.created_at)
          is distinct from (excluded.amount,excluded.from_id,excluded.to_id,excluded.note,excluded.date,excluded.created_at)
          or iou_payments.amount::text is distinct from excluded.amount::text;
    end if;
    -- Derive the budget from this affected authoritative entity, never the whole ledger.
    new_bytes:=octet_length(private.iou_transaction_payload(p_id,item->>'id')::text);
    transaction_bytes:=transaction_bytes+new_bytes-coalesce(old_bytes,0);
    update public.iou_transactions set payload_bytes=new_bytes where group_id=p_id and id=item->>'id' and payload_bytes<>new_bytes;
  end loop;
  for item in select value from jsonb_array_elements(p_delta->'members'->'remove') loop
    delete from public.iou_members where group_id=p_id and id=item#>>'{}' returning payload_bytes into old_bytes;
    if found then member_count:=member_count-1; member_bytes:=member_bytes-old_bytes; end if;
  end loop;
  foreach part in array array['members','transactions'] loop
    section:=p_delta->part;
    if section ? 'order' then
      if jsonb_typeof(section->'order') is distinct from 'array'
        or exists(select 1 from jsonb_array_elements(section->'order') v where not coalesce(private.iou_valid_id(v),false))
        or (select count(*)<>count(distinct value#>>'{}') from jsonb_array_elements(section->'order')) then raise exception 'IOU_INVALID_GROUP' using errcode='22023'; end if;
      current_count:=case when part='members' then member_count else transaction_count end;
      if jsonb_array_length(section->'order')<>current_count then raise exception 'IOU_INVALID_GROUP' using errcode='22023'; end if;
      if part='members' then
        update public.iou_members m set position=o.ordinality from jsonb_array_elements_text(section->'order') with ordinality o
          where m.group_id=p_id and m.id=o.value;
      else
        update public.iou_transactions t set position=o.ordinality from jsonb_array_elements_text(section->'order') with ordinality o
          where t.group_id=p_id and t.id=o.value;
      end if;
      get diagnostics ordered_count=row_count;
      if ordered_count<>current_count then raise exception 'IOU_INVALID_GROUP' using errcode='22023'; end if;
    end if;
  end loop;
  -- Deferral lets whole-parent deletion cascade in either child order. Check
  -- this writer's references before acknowledgement, so invalid edits fail here.
  set constraints public.iou_expenses_group_id_paid_by_fkey,public.iou_payments_group_id_from_id_fkey,
    public.iou_payments_group_id_to_id_fkey,public.iou_expense_shares_group_id_member_id_fkey immediate;
  set constraints public.iou_expenses_group_id_paid_by_fkey,public.iou_payments_group_id_from_id_fkey,
    public.iou_payments_group_id_to_id_fkey,public.iou_expense_shares_group_id_member_id_fkey deferred;
  total_bytes:=private.iou_payload_bytes(p_delta->'metadata',member_count,transaction_count,member_bytes,transaction_bytes);
  if member_count not between 1 and 100 or transaction_count>5000 or total_bytes>4000000 then raise exception 'IOU_INVALID_GROUP' using errcode='22023'; end if;
  update public.iou_group_headers set metadata=p_delta->'metadata',member_count=member_count,transaction_count=transaction_count,
    member_bytes=member_bytes,transaction_bytes=transaction_bytes,payload_bytes=total_bytes where id=p_id;
exception when foreign_key_violation then raise exception 'IOU_INVALID_GROUP' using errcode='22023';
end;
$$;

create or replace function private.iou_save_group_delta(p_group_id text,p_expected_version bigint,p_delta jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare caller uuid:=auth.uid(); h public.iou_group_headers%rowtype;
begin
  if caller is null then raise exception 'IOU_AUTH_REQUIRED' using errcode='42501'; end if;
  if not exists(select 1 from public.iou_group_access where group_id=p_group_id and user_id=caller) then raise exception 'IOU_ACCESS_DENIED' using errcode='42501'; end if;
  select * into h from public.iou_group_headers where id=p_group_id for update;
  if not found then raise exception 'IOU_ACCESS_DENIED' using errcode='42501'; end if;
  if p_expected_version is null or p_expected_version not between 1 and 9007199254740990 then raise exception 'IOU_INVALID_GROUP' using errcode='22023'; end if;
  if h.version<>p_expected_version then raise exception 'IOU_CONFLICT' using errcode='PT409'; end if;
  perform private.iou_apply_delta(p_group_id,p_delta);
  update public.iou_group_headers set version=version+1,updated_at=now() where id=p_group_id returning * into h;
  return jsonb_build_object('format',1,'id',h.id,'version',h.version);
end;
$$;
create or replace function public.iou_save_group_delta(p_group_id text,p_expected_version bigint,p_delta jsonb)
returns jsonb language sql security invoker set search_path='' as $$ select private.iou_save_group_delta(p_group_id,p_expected_version,p_delta); $$;

create or replace function private.iou_save_group(p_payload jsonb,p_expected_version bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare receipt jsonb; delta jsonb;
begin
  if auth.uid() is null then raise exception 'IOU_AUTH_REQUIRED' using errcode='42501'; end if;
  if not coalesce(private.iou_valid_group(p_payload),false) then raise exception 'IOU_INVALID_GROUP' using errcode='22023'; end if;
  delta:=jsonb_build_object('metadata',p_payload-'members'-'transactions',
    'members',jsonb_build_object('upsert',p_payload->'members','remove',coalesce((select jsonb_agg(m.id) from public.iou_members m where m.group_id=p_payload->>'id' and not (m.id in(select value->>'id' from jsonb_array_elements(p_payload->'members')))),'[]'::jsonb),'order',(select jsonb_agg(value->>'id' order by ordinality) from jsonb_array_elements(p_payload->'members') with ordinality)),
    'transactions',jsonb_build_object('upsert',p_payload->'transactions','remove',coalesce((select jsonb_agg(t.id) from public.iou_transactions t where t.group_id=p_payload->>'id' and not (t.id in(select value->>'id' from jsonb_array_elements(p_payload->'transactions')))),'[]'::jsonb),'order',coalesce((select jsonb_agg(value->>'id' order by ordinality) from jsonb_array_elements(p_payload->'transactions') with ordinality),'[]'::jsonb)));
  receipt:=private.iou_save_group_delta(p_payload->>'id',p_expected_version,delta);
  return jsonb_build_object('payload',private.iou_group_payload(p_payload->>'id'),'version',receipt->'version');
end;
$$;

create or replace function private.iou_create_group(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare caller uuid:=auth.uid(); invite text; prepared jsonb; h public.iou_group_headers%rowtype;
begin
  if caller is null then raise exception 'IOU_AUTH_REQUIRED' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(caller::text,9183));
  if jsonb_typeof(p_payload) is distinct from 'object' or not coalesce(private.iou_valid_id(p_payload->'id'),false) then raise exception 'IOU_INVALID_GROUP' using errcode='22023'; end if;
  select * into h from public.iou_group_headers where id=p_payload->>'id';
  if found then
    if h.created_by=caller and exists(select 1 from public.iou_group_access where group_id=h.id and user_id=caller) then return jsonb_build_object('payload',private.iou_group_payload(h.id),'version',h.version); end if;
    raise exception 'IOU_INVALID_GROUP' using errcode='22023';
  end if;
  if (select count(*) from public.iou_group_headers where created_by=caller)>=100 then raise exception 'IOU_GROUP_LIMIT' using errcode='P0001'; end if;
  loop
    invite:=replace(gen_random_uuid()::text,'-',''); prepared:=jsonb_set(p_payload,'{inviteCode}',to_jsonb(invite));
    if not coalesce(private.iou_valid_group(prepared),false) then raise exception 'IOU_INVALID_GROUP' using errcode='22023'; end if;
    begin
      insert into public.iou_group_headers(id,invite_code,metadata,member_count,transaction_count,member_bytes,transaction_bytes,payload_bytes,created_by)
        values(prepared->>'id',invite,prepared-'members'-'transactions',0,0,0,0,0,caller) returning * into h;
      exit;
    exception when unique_violation then
      if exists(select 1 from public.iou_group_headers where id=prepared->>'id') then raise exception 'IOU_INVALID_GROUP' using errcode='22023'; end if;
    end;
  end loop;
  perform private.iou_apply_delta(h.id,jsonb_build_object('metadata',prepared-'members'-'transactions',
    'members',jsonb_build_object('upsert',prepared->'members','remove','[]'::jsonb),
    'transactions',jsonb_build_object('upsert',prepared->'transactions','remove','[]'::jsonb)));
  insert into public.iou_group_access(group_id,user_id) values(h.id,caller);
  return jsonb_build_object('payload',private.iou_group_payload(h.id),'version',h.version);
end;
$$;
create or replace function private.iou_join_group(p_invite_code text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare caller uuid:=auth.uid(); normalized text:=lower(regexp_replace(p_invite_code,'\s+','','g')); h public.iou_group_headers%rowtype;
begin
  if caller is null then raise exception 'IOU_AUTH_REQUIRED' using errcode='42501'; end if;
  if normalized is null or normalized !~ '^[a-f0-9]{32}$' then raise exception 'IOU_INVALID_INVITE' using errcode='P0001'; end if;
  perform pg_advisory_xact_lock(hashtextextended(caller::text,9183));
  select * into h from public.iou_group_headers where invite_code=normalized;
  if not found then raise exception 'IOU_INVALID_INVITE' using errcode='P0001'; end if;
  if not exists(select 1 from public.iou_group_access where group_id=h.id and user_id=caller)
    and (select count(*) from public.iou_group_access where user_id=caller)>=1000 then raise exception 'IOU_GROUP_LIMIT' using errcode='P0001'; end if;
  insert into public.iou_group_access(group_id,user_id) values(h.id,caller) on conflict do nothing;
  return jsonb_build_object('payload',private.iou_group_payload(h.id),'version',h.version);
end;
$$;

-- Keep heads independent of expensive compatibility reconstruction.
create or replace function private.iou_group_heads()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare caller uuid := auth.uid();
begin
  if caller is null then raise exception 'IOU_AUTH_REQUIRED' using errcode = '42501'; end if;
  if to_regclass('public.iou_group_headers') is not null then
    return jsonb_build_object('format', 1, 'heads', coalesce((
      select jsonb_agg(jsonb_build_object('id', h.id, 'version', h.version) order by h.id)
      from public.iou_group_access a join public.iou_group_headers h on h.id = a.group_id
      where a.user_id = caller
    ), '[]'::jsonb));
  end if;
  return jsonb_build_object('format', 1, 'heads', coalesce((
    select jsonb_agg(jsonb_build_object('id', g.id, 'version', g.version) order by g.id)
    from public.iou_group_access a join public.iou_groups g on g.id = a.group_id
    where a.user_id = caller
  ), '[]'::jsonb));
end;
$$;

revoke all on function private.iou_has_keys(jsonb,text[]),private.iou_valid_text(jsonb,integer,boolean),
  private.iou_valid_id(jsonb),private.iou_valid_date(jsonb),private.iou_valid_timestamp(jsonb),private.iou_valid_money(jsonb,boolean),private.iou_valid_group(jsonb) from public,anon,authenticated;
revoke all on function private.iou_valid_transaction(jsonb,text[]),private.iou_apply_delta(text,jsonb),private.iou_save_group_delta(text,bigint,jsonb),public.iou_save_group_delta(text,bigint,jsonb) from public,anon,authenticated;
grant execute on function private.iou_save_group_delta(text,bigint,jsonb),public.iou_save_group_delta(text,bigint,jsonb) to authenticated;

set constraints public.iou_expenses_group_id_paid_by_fkey,public.iou_payments_group_id_from_id_fkey,
  public.iou_payments_group_id_to_id_fkey,public.iou_expense_shares_group_id_member_id_fkey deferred;

commit;
