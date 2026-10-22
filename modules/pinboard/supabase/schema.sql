-- Pinboard: run in the shared Supabase project's SQL editor as administrator.
-- Fresh install or refresh of the current row schema. Existing boards,
-- invitations, memberships and receipts remain unchanged.
-- Keep private OUT of the Data API's exposed schemas.
begin;

create schema if not exists private;

create or replace function private.pinboard_has_keys(p_value jsonb, p_keys text[])
returns boolean language plpgsql immutable security invoker set search_path = '' as $$
begin
  if jsonb_typeof(p_value) is distinct from 'object' then return false; end if;
  return p_value ?& p_keys and not exists (
    select 1 from jsonb_object_keys(p_value) as keys(key) where not (key = any(p_keys))
  );
end;
$$;

create or replace function private.pinboard_allowed_keys(p_value jsonb, p_keys text[])
returns boolean language plpgsql immutable security invoker set search_path = '' as $$
begin
  if jsonb_typeof(p_value) is distinct from 'object' then return false; end if;
  return not exists (
    select 1 from jsonb_object_keys(p_value) as keys(key) where not (key = any(p_keys))
  );
end;
$$;

create or replace function private.pinboard_valid_text(p_value jsonb, p_max integer, p_required boolean default true)
returns boolean language plpgsql immutable security invoker set search_path = '' as $$
declare value text;
begin
  if jsonb_typeof(p_value) is distinct from 'string' then return false; end if;
  value := p_value #>> '{}';
  -- Match JavaScript UTF-16 lengths and its whitespace-only strings.
  return char_length(value) + char_length(regexp_replace(value, E'[^\U00010000-\U0010ffff]', '', 'g')) <= p_max
    and (not p_required or value !~ E'^[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]*$')
    and value !~ E'[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]';
end;
$$;

create or replace function private.pinboard_valid_uuid(p_value jsonb)
returns boolean language sql immutable security invoker set search_path = '' as $$
  select jsonb_typeof(p_value) = 'string'
    and (p_value #>> '{}') ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$';
$$;

create or replace function private.pinboard_valid_column_id(p_value jsonb)
returns boolean language sql immutable security invoker set search_path = '' as $$
  select jsonb_typeof(p_value) = 'string'
    and (p_value #>> '{}') ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'
    and (p_value #>> '{}') not in ('__proto__', 'constructor', 'prototype');
$$;

create or replace function private.pinboard_valid_date(p_value jsonb)
returns boolean language plpgsql immutable security invoker set search_path = '' as $$
declare value text;
begin
  if jsonb_typeof(p_value) is distinct from 'string' then return false; end if;
  value := p_value #>> '{}';
  if value = '' then return true; end if;
  if value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return false; end if;
  return to_char(value::date, 'YYYY-MM-DD') = value;
exception when others then return false;
end;
$$;

create or replace function private.pinboard_valid_position(p_value jsonb)
returns boolean language plpgsql immutable security invoker set search_path = '' as $$
declare value numeric;
begin
  if jsonb_typeof(p_value) is distinct from 'number' then return false; end if;
  value := (p_value #>> '{}')::numeric;
  return value >= 0 and value <= 1000000000000;
exception when others then return false;
end;
$$;

create or replace function private.pinboard_valid_card_fields(p_value jsonb)
returns boolean language plpgsql immutable security invoker set search_path = '' as $$
declare
  field jsonb;
  ids text[] := '{}'::text[];
  names text[] := array['card title','column','description','priority','assignee','due date','labels'];
begin
  if not (p_value ?& array['hidden','custom'])
    or not private.pinboard_allowed_keys(p_value, array['hidden','custom','assignees'])
    or jsonb_typeof(p_value->'hidden') is distinct from 'array'
    or jsonb_typeof(p_value->'custom') is distinct from 'array'
    or jsonb_array_length(p_value->'hidden') > 5
    or jsonb_array_length(p_value->'custom') > 12
  then return false; end if;
  for field in select value from jsonb_array_elements(p_value->'hidden') loop
    if jsonb_typeof(field) is distinct from 'string'
      or (field #>> '{}') not in ('description','priority','assignee','dueDate','labels')
      or (field #>> '{}') = any(ids) then return false; end if;
    ids := array_append(ids, field #>> '{}');
  end loop;
  ids := '{}'::text[];
  for field in select value from jsonb_array_elements(p_value->'custom') loop
    if not private.pinboard_has_keys(field, array['id','title','hidden'])
      or not coalesce(private.pinboard_valid_uuid(field->'id'), false)
      or not private.pinboard_valid_text(field->'title', 40)
      or jsonb_typeof(field->'hidden') is distinct from 'boolean'
      or (field->>'id') = any(ids)
      or lower(btrim(field->>'title')) = any(names)
    then return false; end if;
    ids := array_append(ids, field->>'id');
    names := array_append(names, lower(btrim(field->>'title')));
  end loop;
  if p_value ? 'assignees' then
    if jsonb_typeof(p_value->'assignees') is distinct from 'array'
      or jsonb_array_length(p_value->'assignees') > 2000 then return false; end if;
    ids := '{}'::text[];
    for field in select value from jsonb_array_elements(p_value->'assignees') loop
      if not private.pinboard_valid_text(field, 80) or (field #>> '{}') = any(ids)
        then return false; end if;
      ids := array_append(ids, field #>> '{}');
    end loop;
  end if;
  return true;
exception when others then return false;
end;
$$;

create or replace function private.pinboard_valid_custom_values(p_value jsonb)
returns boolean language plpgsql immutable security invoker set search_path = '' as $$
declare field_id text; field_value jsonb; field_count integer := 0;
begin
  if jsonb_typeof(p_value) is distinct from 'object' then return false; end if;
  for field_id, field_value in select key, value from jsonb_each(p_value) loop
    field_count := field_count + 1;
    if field_count > 12 or not coalesce(private.pinboard_valid_uuid(to_jsonb(field_id)), false)
      or not private.pinboard_valid_text(field_value, 1000, false)
    then return false; end if;
  end loop;
  return true;
exception when others then return false;
end;
$$;

create or replace function private.pinboard_valid_state(p_columns jsonb, p_cards jsonb)
returns boolean language plpgsql immutable security invoker set search_path = '' as $$
declare
  column_value jsonb;
  card_value jsonb;
  label jsonb;
  column_ids text[] := '{}'::text[];
  card_ids text[] := '{}'::text[];
begin
  if jsonb_typeof(p_columns) is distinct from 'array' or jsonb_typeof(p_cards) is distinct from 'array'
    then return false; end if;
  if jsonb_array_length(p_columns) not between 1 and 20 or jsonb_array_length(p_cards) > 2000
    then return false; end if;
  for column_value in select value from jsonb_array_elements(p_columns) loop
    if not private.pinboard_has_keys(column_value, array['id','title','color'])
      or not coalesce(private.pinboard_valid_column_id(column_value->'id'), false)
      or not private.pinboard_valid_text(column_value->'title', 160)
      or jsonb_typeof(column_value->'color') is distinct from 'string'
      or (column_value->>'color') not in ('slate','blue','amber','emerald','rose','violet')
      or (column_value->>'id') = any(column_ids)
    then return false; end if;
    column_ids := array_append(column_ids, column_value->>'id');
  end loop;
  for card_value in select value from jsonb_array_elements(p_cards) loop
    if not (card_value ?& array['id','title','description','columnId','position','priority','assignee','dueDate','labels'])
      or not private.pinboard_allowed_keys(card_value, array['id','title','description','columnId','position','priority','assignee','dueDate','labels','customFields','archived'])
      or (card_value ? 'archived' and jsonb_typeof(card_value->'archived') is distinct from 'boolean')
      or (card_value ? 'customFields' and not private.pinboard_valid_custom_values(card_value->'customFields'))
      or not coalesce(private.pinboard_valid_uuid(card_value->'id'), false)
      or not private.pinboard_valid_text(card_value->'title', 160)
      or not private.pinboard_valid_text(card_value->'description', 10000, false)
      or jsonb_typeof(card_value->'columnId') is distinct from 'string'
      or not ((card_value->>'columnId') = any(column_ids))
      or not private.pinboard_valid_position(card_value->'position')
      or jsonb_typeof(card_value->'priority') is distinct from 'string'
      or (card_value->>'priority') not in ('low','medium','high')
      or not private.pinboard_valid_text(card_value->'assignee', 80, false)
      or not private.pinboard_valid_date(card_value->'dueDate')
      or jsonb_typeof(card_value->'labels') is distinct from 'array'
      or (card_value->>'id') = any(card_ids)
    then return false; end if;
    if jsonb_array_length(card_value->'labels') > 8 then return false; end if;
    for label in select value from jsonb_array_elements(card_value->'labels') loop
      if not private.pinboard_valid_text(label, 30) then return false; end if;
    end loop;
    card_ids := array_append(card_ids, card_value->>'id');
  end loop;
  return true;
exception when others then return false;
end;
$$;

-- Reject unsupported document installations before touching their data.
do $$ begin
  if exists(select 1 from pg_attribute where attrelid=to_regclass('public.pinboard_boards')
    and attname in ('cards','columns') and not attisdropped) then
    raise exception 'Pinboard requires the current row-storage installation';
  end if;
end $$;

-- Cards and columns are authoritative entities. Headers contain no document mirror.
create table if not exists public.pinboard_boards (
  id uuid primary key,
  invite_code text not null unique check (invite_code ~ '^[a-f0-9]{32}$'),
  title text not null check (private.pinboard_valid_text(to_jsonb(title), 160)),
  description text not null default '' check (private.pinboard_valid_text(to_jsonb(description), 10000, false)),
  deleted_card_ids text[] not null default '{}'::text[],
  deleted_column_ids text[] not null default '{}'::text[],
  revision bigint not null default 1 check (revision between 1 and 9007199254740991),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  card_fields jsonb check (card_fields is null or private.pinboard_valid_card_fields(card_fields)),
  operation_receipt_floor bigint not null default 0 check (operation_receipt_floor between 0 and 9007199254740991),
  active_card_count integer not null default 0,
  card_count integer not null default 0,
  column_count integer not null default 0,
  content_bytes bigint not null default 8,
  next_card_ordinal bigint not null default 1
);
create table if not exists public.pinboard_board_access (
  board_id uuid not null references public.pinboard_boards(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (board_id, user_id)
);
create index if not exists pinboard_board_access_user_idx on public.pinboard_board_access (user_id, board_id);
create index if not exists pinboard_boards_creator_idx on public.pinboard_boards (created_by);

create or replace function private.pinboard_valid_card(p_card jsonb)
returns boolean language sql immutable security invoker set search_path = '' as $$
  -- Existing field/UTF-16 validation, applied to just the touched entity.
  select private.pinboard_valid_state(jsonb_build_array(jsonb_build_object(
    'id', p_card->'columnId', 'title', 'Column', 'color', 'slate')), jsonb_build_array(p_card));
$$;
create table if not exists public.pinboard_columns (
  board_id uuid not null references public.pinboard_boards(id) on delete cascade,
  id text generated always as (data->>'id') stored,
  data jsonb not null check (private.pinboard_valid_state(jsonb_build_array(data), '[]'::jsonb)),
  ordinal bigint not null,
  primary key (board_id, id)
);
create index if not exists pinboard_columns_order_idx on public.pinboard_columns(board_id, ordinal);
create table if not exists public.pinboard_cards (
  board_id uuid not null references public.pinboard_boards(id) on delete cascade,
  id uuid generated always as ((data->>'id')::uuid) stored,
  column_id text generated always as (data->>'columnId') stored,
  position numeric generated always as ((data->>'position')::numeric) stored,
  data jsonb not null check (private.pinboard_valid_card(data)),
  ordinal bigint not null,
  primary key (board_id, id),
  foreign key (board_id, column_id) references public.pinboard_columns(board_id, id)
);
create index if not exists pinboard_cards_position_idx on public.pinboard_cards(board_id, column_id, position, id);
create index if not exists pinboard_cards_order_idx on public.pinboard_cards(board_id, ordinal);
alter table public.pinboard_boards enable row level security;
alter table public.pinboard_board_access enable row level security;
alter table public.pinboard_columns enable row level security;
alter table public.pinboard_cards enable row level security;
revoke all on public.pinboard_boards,public.pinboard_board_access,public.pinboard_columns,public.pinboard_cards from public,anon,authenticated;
grant select(id,invite_code,title,description,revision,created_at,updated_at,card_fields,active_card_count)
  on public.pinboard_boards to authenticated;
grant select on public.pinboard_board_access,public.pinboard_columns,public.pinboard_cards to authenticated;
drop policy if exists pinboard_read_own_access on public.pinboard_board_access;
create policy pinboard_read_own_access on public.pinboard_board_access for select to authenticated using(user_id=(select auth.uid()));
drop policy if exists pinboard_read_joined_boards on public.pinboard_boards;
create policy pinboard_read_joined_boards on public.pinboard_boards for select to authenticated using(exists(
  select 1 from public.pinboard_board_access a where a.board_id=pinboard_boards.id and a.user_id=(select auth.uid())));
drop policy if exists pinboard_read_joined_columns on public.pinboard_columns;
create policy pinboard_read_joined_columns on public.pinboard_columns for select to authenticated using(exists(
  select 1 from public.pinboard_board_access a where a.board_id=pinboard_columns.board_id and a.user_id=(select auth.uid())));
drop policy if exists pinboard_read_joined_cards on public.pinboard_cards;
create policy pinboard_read_joined_cards on public.pinboard_cards for select to authenticated using(exists(
  select 1 from public.pinboard_board_access a where a.board_id=pinboard_cards.board_id and a.user_id=(select auth.uid())));

create or replace view public.pinboard_board_documents with(security_invoker=true) as
  select b.id,b.invite_code,b.title,b.description,
    (select coalesce(jsonb_agg(c.data order by c.ordinal),'[]'::jsonb) from public.pinboard_columns c where c.board_id=b.id) as columns,
    (select coalesce(jsonb_agg(c.data order by c.ordinal),'[]'::jsonb) from public.pinboard_cards c where c.board_id=b.id) as cards,
    b.revision,b.created_at,b.updated_at,b.card_fields from public.pinboard_boards b;
revoke all on public.pinboard_board_documents from public,anon,authenticated;
grant select on public.pinboard_board_documents to authenticated;
create or replace view public.pinboard_board_summaries with(security_invoker=true) as
  select b.id,b.invite_code,b.title,left(b.description,240) as description,
    (select coalesce(jsonb_agg(c.data order by c.ordinal),'[]'::jsonb) from public.pinboard_columns c where c.board_id=b.id) as columns,
    b.active_card_count,b.revision,b.created_at,b.updated_at from public.pinboard_boards b;
revoke all on public.pinboard_board_summaries from public,anon,authenticated;
grant select on public.pinboard_board_summaries to authenticated;

create or replace function private.pinboard_board_json(p_board public.pinboard_boards)
returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('id',p_board.id,'invite_code',p_board.invite_code,'title',p_board.title,'description',p_board.description,
    'columns',(select coalesce(jsonb_agg(data order by ordinal),'[]'::jsonb) from public.pinboard_columns where board_id=p_board.id),
    'cards',(select coalesce(jsonb_agg(data order by ordinal),'[]'::jsonb) from public.pinboard_cards where board_id=p_board.id),
    'revision',p_board.revision,'created_at',p_board.created_at,'updated_at',p_board.updated_at)
    || case when p_board.card_fields is null then '{}'::jsonb else jsonb_build_object('card_fields',p_board.card_fields) end;
$$;

create or replace function private.pinboard_create_board(p_id uuid,p_title text,p_description text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare caller uuid:=auth.uid(); invite text; b public.pinboard_boards%rowtype;
  initial_columns jsonb:='[{"id":"todo","title":"To do","color":"slate"},{"id":"doing","title":"In progress","color":"amber"},{"id":"done","title":"Done","color":"emerald"}]'::jsonb;
begin
  if caller is null then raise exception 'PINBOARD_AUTH_REQUIRED' using errcode='42501'; end if;
  if p_id is null or not coalesce(private.pinboard_valid_text(to_jsonb(p_title),160),false)
    or not coalesce(private.pinboard_valid_text(to_jsonb(p_description),10000,false),false)
    then raise exception 'PINBOARD_INVALID_BOARD' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(caller::text,9184));
  select * into b from public.pinboard_boards where id=p_id;
  if found then
    if b.created_by=caller and exists(select 1 from public.pinboard_board_access where board_id=b.id and user_id=caller)
      then return private.pinboard_board_json(b); end if;
    raise exception 'PINBOARD_INVALID_BOARD' using errcode='22023';
  end if;
  if (select count(*) from public.pinboard_boards where created_by=caller)>=100
    or (select count(*) from public.pinboard_board_access where user_id=caller)>=1000
    then raise exception 'PINBOARD_BOARD_LIMIT' using errcode='P0001'; end if;
  loop
    invite:=replace(gen_random_uuid()::text,'-','');
    begin
      insert into public.pinboard_boards(id,invite_code,title,description,created_by,column_count,content_bytes)
        values(p_id,invite,p_title,p_description,caller,3,octet_length(initial_columns::text)+6) returning * into b;
      exit;
    exception when unique_violation then
      if exists(select 1 from public.pinboard_boards where id=p_id) then raise exception 'PINBOARD_INVALID_BOARD' using errcode='22023'; end if;
    end;
  end loop;
  insert into public.pinboard_columns(board_id,data,ordinal) select b.id,value,ordinality from jsonb_array_elements(initial_columns) with ordinality;
  insert into public.pinboard_board_access(board_id,user_id) values(b.id,caller);
  return private.pinboard_board_json(b);
end;
$$;

-- Explicit recovery actions replace a validated snapshot atomically; ordinary edits remain row operations.
create or replace function private.pinboard_replace_snapshot(p_board_id uuid,p_board jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.pinboard_boards%rowtype; fields jsonb:=nullif(p_board->'card_fields','null'::jsonb);
  item record; removed_cards text[]; removed_columns text[]; bytes bigint;
begin
  select * into b from public.pinboard_boards where id=p_board_id for update;
  if not found then raise exception 'PINBOARD_ACCESS_DENIED' using errcode='42501'; end if;
  if jsonb_typeof(p_board) is distinct from 'object'
    or not (p_board ?& array['title','description','columns','cards'])
    or not private.pinboard_allowed_keys(p_board,array['title','description','columns','cards','card_fields'])
    or not private.pinboard_valid_text(p_board->'title',160)
    or not private.pinboard_valid_text(p_board->'description',10000,false)
    or not private.pinboard_valid_state(p_board->'columns',p_board->'cards')
    or (fields is not null and not private.pinboard_valid_card_fields(fields))
    then raise exception 'PINBOARD_INVALID_BOARD' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_board->'cards') c
    where (fields?'assignees' and c->>'assignee'<>'' and not(fields->'assignees' @> jsonb_build_array(c->'assignee')))
      or exists(select 1 from jsonb_object_keys(coalesce(c->'customFields','{}'::jsonb)) f(id)
        where not exists(select 1 from jsonb_array_elements(coalesce(fields->'custom','[]'::jsonb)) d where d->>'id'=f.id)))
    then raise exception 'PINBOARD_INVALID_BOARD' using errcode='22023'; end if;
  bytes:=octet_length((p_board->'columns')::text)+octet_length((p_board->'cards')::text)+octet_length(coalesce(fields,'null'::jsonb)::text);
  if bytes>2000000 then raise exception 'PINBOARD_BOARD_TOO_LARGE' using errcode='P0001'; end if;
  if b.revision=9007199254740991 then raise exception 'PINBOARD_BOARD_LIMIT' using errcode='P0001'; end if;
  removed_cards:=array(select id from unnest(b.deleted_card_ids) id
    where not exists(select 1 from jsonb_array_elements(p_board->'cards') c where c->>'id'=id));
  removed_columns:=array(select id from unnest(b.deleted_column_ids) id
    where not exists(select 1 from jsonb_array_elements(p_board->'columns') c where c->>'id'=id));
  for item in select id from public.pinboard_cards c where board_id=b.id
    and not exists(select 1 from jsonb_array_elements(p_board->'cards') n where n->>'id'=c.id::text) order by ordinal loop
    removed_cards:=(array_append(removed_cards,item.id::text))[greatest(1,cardinality(removed_cards)+1-999):];
  end loop;
  for item in select id from public.pinboard_columns c where board_id=b.id
    and not exists(select 1 from jsonb_array_elements(p_board->'columns') n where n->>'id'=c.id) order by ordinal loop
    removed_columns:=(array_append(removed_columns,item.id))[greatest(1,cardinality(removed_columns)+1-199):];
  end loop;
  delete from public.pinboard_cards where board_id=b.id;
  delete from public.pinboard_columns where board_id=b.id;
  insert into public.pinboard_columns(board_id,data,ordinal)
    select b.id,value,ordinality from jsonb_array_elements(p_board->'columns') with ordinality;
  insert into public.pinboard_cards(board_id,data,ordinal)
    select b.id,value,ordinality from jsonb_array_elements(p_board->'cards') with ordinality;
  update public.pinboard_boards set title=p_board->>'title',description=p_board->>'description',card_fields=fields,
    card_count=jsonb_array_length(p_board->'cards'),column_count=jsonb_array_length(p_board->'columns'),
    active_card_count=(select count(*) from jsonb_array_elements(p_board->'cards') c where not coalesce((c->>'archived')::boolean,false)),
    content_bytes=bytes,next_card_ordinal=jsonb_array_length(p_board->'cards')+1,
    deleted_card_ids=removed_cards,deleted_column_ids=removed_columns,
    revision=revision+1,updated_at=clock_timestamp() where id=b.id returning * into b;
  return private.pinboard_board_json(b);
end;
$$;
revoke all on function private.pinboard_replace_snapshot(uuid,jsonb) from public,anon,authenticated;

create or replace function private.pinboard_copy_board(p_id uuid,p_board jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare caller uuid:=auth.uid(); existed boolean;
begin
  if caller is null then raise exception 'PINBOARD_AUTH_REQUIRED' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(caller::text,9184));
  select exists(select 1 from public.pinboard_boards where id=p_id) into existed;
  -- Creation checks ownership, quotas and lost-response retries under this same lock.
  if existed then return private.pinboard_create_board(p_id,p_board->>'title',p_board->>'description'); end if;
  perform private.pinboard_create_board(p_id,p_board->>'title',p_board->>'description');
  delete from public.pinboard_columns where board_id=p_id;
  return private.pinboard_replace_snapshot(p_id,p_board);
end;
$$;
create or replace function public.pinboard_copy_board(p_id uuid,p_board jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select private.pinboard_copy_board(p_id,p_board);
$$;
revoke all on function private.pinboard_copy_board(uuid,jsonb),public.pinboard_copy_board(uuid,jsonb) from public,anon,authenticated;
grant execute on function private.pinboard_copy_board(uuid,jsonb),public.pinboard_copy_board(uuid,jsonb) to authenticated;

create or replace function private.pinboard_apply_operation(p_board_id uuid,p_operation jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  caller uuid:=auth.uid(); b public.pinboard_boards%rowtype;
  kind text:=p_operation->>'type'; patch jsonb:=p_operation->'patch'; entity text:=p_operation->>'id';
  previous jsonb; replacement jsonb; fields jsonb; new_title text; new_description text;
  card_total integer; column_total integer; active_total integer; bytes bigint; next_ordinal bigint;
  deleted_cards text[]; deleted_columns text[]; changed boolean:=false;
  supplied jsonb; ordered text[]:='{}'::text[]; column_row record; card_row record; rank integer:=0; append_from numeric; moved integer:=0;
begin
  if caller is null then raise exception 'PINBOARD_AUTH_REQUIRED' using errcode='42501'; end if;
  if not exists(select 1 from public.pinboard_board_access where board_id=p_board_id and user_id=caller)
    then raise exception 'PINBOARD_ACCESS_DENIED' using errcode='42501'; end if;
  select * into b from public.pinboard_boards where id=p_board_id for update;
  if not found then raise exception 'PINBOARD_ACCESS_DENIED' using errcode='42501'; end if;
  if jsonb_typeof(p_operation) is distinct from 'object' or jsonb_typeof(p_operation->'type') is distinct from 'string'
    then raise exception 'PINBOARD_INVALID_OPERATION' using errcode='22023'; end if;
  if kind='replace_board' then
    if not private.pinboard_has_keys(p_operation,array['type','board'])
      then raise exception 'PINBOARD_INVALID_OPERATION' using errcode='22023'; end if;
    return private.pinboard_replace_snapshot(b.id,p_operation->'board');
  end if;
  fields:=b.card_fields; new_title:=b.title; new_description:=b.description;
  card_total:=b.card_count; column_total:=b.column_count; active_total:=b.active_card_count;
  bytes:=b.content_bytes; next_ordinal:=b.next_card_ordinal;
  deleted_cards:=b.deleted_card_ids; deleted_columns:=b.deleted_column_ids;
  if kind='update_board' then
    if not private.pinboard_has_keys(p_operation,array['type','patch']) or not private.pinboard_allowed_keys(patch,array['title','description','card_fields'])
      then raise exception 'PINBOARD_INVALID_OPERATION' using errcode='22023'; end if;
    if patch?'title' then
      if not private.pinboard_valid_text(patch->'title',160) then raise exception 'PINBOARD_INVALID_OPERATION' using errcode='22023'; end if;
      new_title:=patch->>'title';
    end if;
    if patch?'description' then
      if not private.pinboard_valid_text(patch->'description',10000,false) then raise exception 'PINBOARD_INVALID_OPERATION' using errcode='22023'; end if;
      new_description:=patch->>'description';
    end if;
    if patch?'card_fields' then
      if not private.pinboard_valid_card_fields(patch->'card_fields') then raise exception 'PINBOARD_INVALID_OPERATION' using errcode='22023'; end if;
      select jsonb_set(patch->'card_fields','{custom}',(patch->'card_fields'->'custom')||coalesce(jsonb_agg(current_fields.value order by current_fields.ordinality)
        filter(where not exists(select 1 from jsonb_array_elements(patch->'card_fields'->'custom') s where s->>'id'=current_fields.value->>'id')),'[]'::jsonb))
        into fields from jsonb_array_elements(coalesce(fields->'custom','[]'::jsonb)) with ordinality as current_fields;
      if b.card_fields?'assignees' then fields:=jsonb_set(fields,'{assignees}',b.card_fields->'assignees'); else fields:=fields-'assignees'; end if;
      if not private.pinboard_valid_card_fields(fields) then raise exception 'PINBOARD_INVALID_OPERATION' using errcode='22023'; end if;
    end if;
  elsif kind in ('add_assignee','delete_assignee') then
    if not private.pinboard_has_keys(p_operation,array['type','name']) or not private.pinboard_valid_text(p_operation->'name',80)
      then raise exception 'PINBOARD_INVALID_OPERATION' using errcode='22023'; end if;
    fields:=coalesce(fields,'{"hidden":[],"custom":[]}'::jsonb);
    if not(fields?'assignees') then
      fields:=jsonb_set(fields,'{assignees}',(select coalesce(jsonb_agg(to_jsonb(name) order by name),'[]'::jsonb)
        from(select distinct data->>'assignee' name from public.pinboard_cards where board_id=b.id and data->>'assignee'<>'') names));
    end if;
    if kind='add_assignee' then
      if not(fields->'assignees' @> jsonb_build_array(p_operation->'name')) then fields:=jsonb_set(fields,'{assignees}',fields->'assignees'||jsonb_build_array(p_operation->'name')); end if;
    else
      fields:=jsonb_set(fields,'{assignees}',(select coalesce(jsonb_agg(value order by ordinality),'[]'::jsonb)
        from jsonb_array_elements(fields->'assignees') with ordinality where value<>p_operation->'name'));
      for card_row in select id,data from public.pinboard_cards where board_id=b.id and data->>'assignee'=p_operation->>'name' loop
        replacement:=jsonb_set(card_row.data,'{assignee}','""'::jsonb);
        bytes:=bytes+octet_length(replacement::text)-octet_length(card_row.data::text);
        update public.pinboard_cards set data=replacement where board_id=b.id and id=card_row.id;
        changed:=true;
      end loop;
    end if;
    if not private.pinboard_valid_card_fields(fields) then raise exception 'PINBOARD_INVALID_OPERATION' using errcode='22023'; end if;
  elsif kind='add_column' then
    replacement:=p_operation->'column';
    if not private.pinboard_has_keys(p_operation,array['type','column']) or not private.pinboard_valid_state(jsonb_build_array(replacement),'[]'::jsonb)
      then raise exception 'PINBOARD_INVALID_OPERATION' using errcode='22023'; end if;
    if replacement->>'id'=any(deleted_columns) or exists(select 1 from public.pinboard_columns where board_id=b.id and id=replacement->>'id')
      then return private.pinboard_board_json(b); end if;
    insert into public.pinboard_columns(board_id,data,ordinal) values(b.id,replacement,(select coalesce(max(ordinal),0)+1 from public.pinboard_columns where board_id=b.id));
    bytes:=bytes+octet_length(replacement::text)+2; column_total:=column_total+1; changed:=true;
  elsif kind='reorder_columns' then
    if not private.pinboard_has_keys(p_operation,array['type','columnIds']) or jsonb_typeof(p_operation->'columnIds') is distinct from 'array'
      then raise exception 'PINBOARD_INVALID_OPERATION' using errcode='22023'; end if;
    if jsonb_array_length(p_operation->'columnIds') not between 1 and 20 then raise exception 'PINBOARD_INVALID_OPERATION' using errcode='22023'; end if;
    for supplied in select value from jsonb_array_elements(p_operation->'columnIds') loop
      if not coalesce(private.pinboard_valid_column_id(supplied),false) or (supplied#>>'{}')=any(ordered)
        then raise exception 'PINBOARD_INVALID_OPERATION' using errcode='22023'; end if;
      ordered:=array_append(ordered,supplied#>>'{}');
    end loop;
    -- Compare relative order, so an unchanged order after deletions remains a no-op.
    if (select array_agg(id order by coalesce(array_position(ordered,id),21),ordinal) from public.pinboard_columns where board_id=b.id)
      is distinct from (select array_agg(id order by ordinal) from public.pinboard_columns where board_id=b.id) then
      for column_row in select id from public.pinboard_columns where board_id=b.id order by coalesce(array_position(ordered,id),21),ordinal loop
        rank:=rank+1; update public.pinboard_columns set ordinal=rank where board_id=b.id and id=column_row.id;
      end loop;
      changed:=true;
    end if;
  elsif kind='update_column' then
    if not private.pinboard_has_keys(p_operation,array['type','id','patch']) or not coalesce(private.pinboard_valid_column_id(p_operation->'id'),false)
      or not private.pinboard_allowed_keys(patch,array['title','color']) then raise exception 'PINBOARD_INVALID_OPERATION' using errcode='22023'; end if;
    select data into previous from public.pinboard_columns where board_id=b.id and id=entity;
    if not found then raise exception 'PINBOARD_COLUMN_NOT_FOUND' using errcode='P0001'; end if;
    replacement:=previous||patch;
    if not private.pinboard_valid_state(jsonb_build_array(replacement),'[]'::jsonb) then raise exception 'PINBOARD_INVALID_OPERATION' using errcode='22023'; end if;
    if replacement is distinct from previous then
      update public.pinboard_columns set data=replacement where board_id=b.id and id=entity;
      bytes:=bytes+octet_length(replacement::text)-octet_length(previous::text); changed:=true;
    end if;
  elsif kind='delete_column' then
    if not private.pinboard_has_keys(p_operation,array['type','id','targetColumnId']) or not coalesce(private.pinboard_valid_column_id(p_operation->'id'),false)
      or not coalesce(private.pinboard_valid_column_id(p_operation->'targetColumnId'),false) or entity=p_operation->>'targetColumnId' or column_total<=1
      then raise exception 'PINBOARD_INVALID_OPERATION' using errcode='22023'; end if;
    select data into previous from public.pinboard_columns where board_id=b.id and id=entity;
    if not found or not exists(select 1 from public.pinboard_columns where board_id=b.id and id=p_operation->>'targetColumnId')
      then raise exception 'PINBOARD_COLUMN_NOT_FOUND' using errcode='P0001'; end if;
    select coalesce(max(position),0) into append_from from public.pinboard_cards where board_id=b.id and column_id=p_operation->>'targetColumnId';
    for card_row in select id,data from public.pinboard_cards where board_id=b.id and column_id=entity order by position,id loop
      moved:=moved+1; replacement:=jsonb_set(jsonb_set(card_row.data,'{columnId}',p_operation->'targetColumnId'),'{position}',to_jsonb(least(append_from+1024*moved,1000000000000::numeric)));
      update public.pinboard_cards set data=replacement where board_id=b.id and id=card_row.id;
      bytes:=bytes+octet_length(replacement::text)-octet_length(card_row.data::text);
    end loop;
    delete from public.pinboard_columns where board_id=b.id and id=entity;
    bytes:=bytes-octet_length(previous::text)-2; column_total:=column_total-1;
    deleted_columns:=(array_append(deleted_columns,entity))[greatest(1,cardinality(deleted_columns)+1-199):]; changed:=true;
  elsif kind='create_card' then
    replacement:=p_operation->'card';
    if not private.pinboard_has_keys(p_operation,array['type','card']) or not coalesce(private.pinboard_valid_uuid(replacement->'id'),false)
      then raise exception 'PINBOARD_INVALID_OPERATION' using errcode='22023'; end if;
    if replacement->>'id'=any(deleted_cards) or exists(select 1 from public.pinboard_cards where board_id=b.id and id=(replacement->>'id')::uuid)
      then return private.pinboard_board_json(b); end if;
  elsif kind in ('update_card','move_card') then
    if kind='update_card' then
      if not private.pinboard_has_keys(p_operation,array['type','id','patch']) or not private.pinboard_allowed_keys(patch,array['title','description','columnId','position','priority','assignee','dueDate','labels','customFields','archived'])
        then raise exception 'PINBOARD_INVALID_OPERATION' using errcode='22023'; end if;
    else
      if not private.pinboard_has_keys(p_operation,array['type','id','columnId','position']) then raise exception 'PINBOARD_INVALID_OPERATION' using errcode='22023'; end if;
      patch:=jsonb_build_object('columnId',p_operation->'columnId','position',p_operation->'position');
    end if;
    if not coalesce(private.pinboard_valid_uuid(p_operation->'id'),false) then raise exception 'PINBOARD_INVALID_OPERATION' using errcode='22023'; end if;
    select data into previous from public.pinboard_cards where board_id=b.id and id=entity::uuid;
    if not found then raise exception 'PINBOARD_CARD_NOT_FOUND' using errcode='P0001'; end if;
    if coalesce(private.pinboard_valid_column_id(patch->'columnId'),false) and not exists(select 1 from public.pinboard_columns where board_id=b.id and id=patch->>'columnId')
      then raise exception 'PINBOARD_COLUMN_NOT_FOUND' using errcode='P0001'; end if;
    if patch?'customFields' then
      if not private.pinboard_valid_custom_values(patch->'customFields') then raise exception 'PINBOARD_INVALID_OPERATION' using errcode='22023'; end if;
      patch:=jsonb_set(patch,'{customFields}',coalesce(previous->'customFields','{}'::jsonb)||(patch->'customFields'));
    end if;
    replacement:=previous||patch;
  elsif kind='delete_card' then
    if not private.pinboard_has_keys(p_operation,array['type','id']) or not coalesce(private.pinboard_valid_uuid(p_operation->'id'),false)
      then raise exception 'PINBOARD_INVALID_OPERATION' using errcode='22023'; end if;
    delete from public.pinboard_cards where board_id=b.id and id=entity::uuid returning data into previous;
    if found then
      bytes:=bytes-octet_length(previous::text)-case when card_total>1 then 2 else 0 end;
      card_total:=card_total-1; active_total:=active_total-case when coalesce((previous->>'archived')::boolean,false) then 0 else 1 end;
      deleted_cards:=(array_append(deleted_cards,entity))[greatest(1,cardinality(deleted_cards)+1-999):]; changed:=true;
    end if;
  else raise exception 'PINBOARD_INVALID_OPERATION' using errcode='22023'; end if;

  if kind in ('create_card','update_card','move_card') then
    if not private.pinboard_valid_card(replacement) or not exists(select 1 from public.pinboard_columns where board_id=b.id and id=replacement->>'columnId')
      then raise exception 'PINBOARD_INVALID_OPERATION' using errcode='22023'; end if;
    if fields?'assignees' and replacement->>'assignee'<>'' and (kind='create_card' or patch?'assignee')
      and not(fields->'assignees' @> jsonb_build_array(replacement->'assignee'))
      then raise exception 'PINBOARD_ASSIGNEE_NOT_FOUND' using errcode='P0001'; end if;
    if exists(select 1 from jsonb_object_keys(coalesce(replacement->'customFields','{}'::jsonb)) f(id)
      where not exists(select 1 from jsonb_array_elements(coalesce(fields->'custom','[]'::jsonb)) d where d->>'id'=f.id))
      then raise exception 'PINBOARD_INVALID_OPERATION' using errcode='22023'; end if;
    if kind='create_card' then
      insert into public.pinboard_cards(board_id,data,ordinal) values(b.id,replacement,next_ordinal);
      next_ordinal:=next_ordinal+1;
      bytes:=bytes+octet_length(replacement::text)+case when card_total>0 then 2 else 0 end;
      card_total:=card_total+1; active_total:=active_total+case when coalesce((replacement->>'archived')::boolean,false) then 0 else 1 end; changed:=true;
    elsif replacement is distinct from previous then
      update public.pinboard_cards set data=replacement where board_id=b.id and id=entity::uuid;
      bytes:=bytes+octet_length(replacement::text)-octet_length(previous::text);
      active_total:=active_total+case when coalesce((previous->>'archived')::boolean,false) then 0 else -1 end
        +case when coalesce((replacement->>'archived')::boolean,false) then 0 else 1 end; changed:=true;
    end if;
  end if;
  bytes:=bytes+octet_length(coalesce(fields,'null'::jsonb)::text)-octet_length(coalesce(b.card_fields,'null'::jsonb)::text);
  if card_total>2000 or column_total not between 1 and 20 then raise exception 'PINBOARD_INVALID_OPERATION' using errcode='22023'; end if;
  if bytes>2000000 and bytes>b.content_bytes then raise exception 'PINBOARD_BOARD_TOO_LARGE' using errcode='P0001'; end if;
  if changed or new_title is distinct from b.title or new_description is distinct from b.description or fields is distinct from b.card_fields then
    if b.revision=9007199254740991 then raise exception 'PINBOARD_BOARD_LIMIT' using errcode='P0001'; end if;
    update public.pinboard_boards set title=new_title,description=new_description,card_fields=fields,
      deleted_card_ids=deleted_cards,deleted_column_ids=deleted_columns,card_count=card_total,column_count=column_total,
      active_card_count=active_total,content_bytes=bytes,next_card_ordinal=next_ordinal,
      revision=revision+1,updated_at=clock_timestamp() where id=b.id returning * into b;
  end if;
  return private.pinboard_board_json(b);
end;
$$;

create or replace function public.pinboard_sync_summaries(p_known jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare heads jsonb; changed jsonb;
begin
  if auth.uid() is null then raise exception 'PINBOARD_AUTH_REQUIRED' using errcode = '42501'; end if;
  if jsonb_typeof(p_known) is distinct from 'object' then raise exception 'PINBOARD_INVALID_BOARD' using errcode = '22023'; end if;
  select
    coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'revision', s.revision) order by s.id), '[]'::jsonb),
    coalesce(jsonb_agg(to_jsonb(s) order by s.id)
      filter (where p_known->>s.id::text is distinct from s.revision::text), '[]'::jsonb)
  into heads, changed from public.pinboard_board_summaries s;
  return jsonb_build_object('format', 1, 'heads', heads, 'boards', changed);
end;
$$;
revoke all on function public.pinboard_sync_summaries(jsonb) from public, anon, authenticated;
grant execute on function public.pinboard_sync_summaries(jsonb) to authenticated;

create or replace function private.pinboard_join_board(p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  normalized text := lower(regexp_replace(p_code, '\s+', '', 'g'));
  board_row public.pinboard_boards%rowtype;
begin
  if caller is null then raise exception 'PINBOARD_AUTH_REQUIRED' using errcode = '42501'; end if;
  if normalized is null or normalized !~ '^[a-f0-9]{32}$' then
    raise exception 'PINBOARD_INVALID_INVITE' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(caller::text, 9184));
  select * into board_row from public.pinboard_boards where invite_code = normalized;
  if not found then raise exception 'PINBOARD_INVALID_INVITE' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.pinboard_board_access where board_id = board_row.id and user_id = caller)
    and (select count(*) from public.pinboard_board_access where user_id = caller) >= 1000
  then raise exception 'PINBOARD_BOARD_LIMIT' using errcode = 'P0001'; end if;
  insert into public.pinboard_board_access (board_id, user_id) values (board_row.id, caller) on conflict do nothing;
  return private.pinboard_board_json(board_row);
end;
$$;

-- Only invoker entry points are exposed through the Data API. Privileged work
-- stays in private functions that verify the caller and their board membership.
create or replace function public.pinboard_create_board(p_id uuid, p_title text, p_description text)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.pinboard_create_board(p_id, p_title, p_description);
$$;
create or replace function public.pinboard_join_board(p_code text)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.pinboard_join_board(p_code);
$$;
-- Small durable receipts make a lost-response retry return CURRENT state without
-- replaying its old patch over another member's accepted edit. Payload hashes
-- prevent accidental token reuse without retaining complete board/card content.
create table if not exists private.pinboard_operation_receipts (
  board_id uuid not null references public.pinboard_boards(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null,
  operation_hash bytea not null,
  accepted_revision bigint not null,
  receipt_id bigint generated always as identity,
  primary key (board_id, user_id, operation_id)
);
create index if not exists pinboard_operation_receipts_recent_idx
  on private.pinboard_operation_receipts (board_id, receipt_id desc);
revoke all on private.pinboard_operation_receipts from public, anon, authenticated;
revoke all on sequence private.pinboard_operation_receipts_receipt_id_seq from public, anon, authenticated;

create or replace function private.pinboard_mutate_board_once(p_board_id uuid, p_operation_id uuid, p_operation jsonb, p_base_revision bigint default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  board_row public.pinboard_boards%rowtype;
  expected_hash bytea;
  expired_revision bigint;
  result jsonb;
begin
  if caller is null then raise exception 'PINBOARD_AUTH_REQUIRED' using errcode = '42501'; end if;
  if not exists (select 1 from public.pinboard_board_access where board_id = p_board_id and user_id = caller)
    then raise exception 'PINBOARD_ACCESS_DENIED' using errcode = '42501'; end if;
  if p_operation_id is null or p_operation is null
    then raise exception 'PINBOARD_INVALID_OPERATION' using errcode = '22023'; end if;
  -- Duplicate uploads and independent members share one committed acceptance order.
  select * into board_row from public.pinboard_boards where id = p_board_id for update;
  if not found then raise exception 'PINBOARD_ACCESS_DENIED' using errcode = '42501'; end if;
  select operation_hash into expected_hash from private.pinboard_operation_receipts
    where board_id = p_board_id and user_id = caller and operation_id = p_operation_id;
  if found then
    if expected_hash is distinct from sha256(convert_to(p_operation::text, 'UTF8'))
      then raise exception 'PINBOARD_INVALID_OPERATION' using errcode = '22023'; end if;
    return private.pinboard_board_json(board_row);
  end if;
  if p_base_revision is not null and (p_base_revision < 1 or p_base_revision > board_row.revision)
    then raise exception 'PINBOARD_INVALID_OPERATION' using errcode = '22023'; end if;
  -- Evicted IDs must NEVER become fresh writes. A stale queue keeps its
  -- draft for review rather than replaying a possibly accepted old operation.
  if board_row.operation_receipt_floor > 0
    and (p_base_revision is null or p_base_revision <= board_row.operation_receipt_floor)
    then raise exception 'PINBOARD_OPERATION_TOO_OLD' using errcode = 'P0001'; end if;
  result := private.pinboard_apply_operation(p_board_id, p_operation);
  insert into private.pinboard_operation_receipts (board_id, user_id, operation_id, operation_hash, accepted_revision)
    values (p_board_id, caller, p_operation_id, sha256(convert_to(p_operation::text, 'UTF8')), (result->>'revision')::bigint);
  -- The most recent 1,000 accepted operation IDs per board remain retryable.
  select max(accepted_revision) into expired_revision from (
    select accepted_revision from private.pinboard_operation_receipts
      where board_id = p_board_id order by receipt_id desc offset 1000
  ) expired;
  if expired_revision is not null then
    update public.pinboard_boards set operation_receipt_floor = greatest(operation_receipt_floor, expired_revision)
      where id = p_board_id;
    -- A long run of accepted no-ops can fill the window without changing the
    -- document revision. Advance once so a freshly loaded board stays editable.
    if expired_revision >= (result->>'revision')::bigint then
      if expired_revision = 9007199254740991
        then raise exception 'PINBOARD_BOARD_LIMIT' using errcode = 'P0001'; end if;
      update public.pinboard_boards set revision = revision + 1, updated_at = clock_timestamp()
        where id = p_board_id returning * into board_row;
      result := private.pinboard_board_json(board_row);
    end if;
  end if;
  delete from private.pinboard_operation_receipts where board_id = p_board_id
    and receipt_id <= (select receipt_id from private.pinboard_operation_receipts
      where board_id = p_board_id order by receipt_id desc offset 1000 limit 1);
  return result;
end;
$$;
create or replace function public.pinboard_mutate_board_once(p_board_id uuid, p_operation_id uuid, p_operation jsonb, p_base_revision bigint default null)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.pinboard_mutate_board_once(p_board_id, p_operation_id, p_operation, p_base_revision);
$$;
revoke all on function private.pinboard_mutate_board_once(uuid,uuid,jsonb,bigint),
  public.pinboard_mutate_board_once(uuid,uuid,jsonb,bigint) from public, anon, authenticated;
grant execute on function private.pinboard_mutate_board_once(uuid,uuid,jsonb,bigint),
  public.pinboard_mutate_board_once(uuid,uuid,jsonb,bigint) to authenticated;

create or replace function public.pinboard_force_board_once(p_board_id uuid,p_operation_id uuid,p_board jsonb,p_base_revision bigint)
returns jsonb language sql security invoker set search_path='' as $$
  select private.pinboard_mutate_board_once(p_board_id,p_operation_id,
    jsonb_build_object('type','replace_board','board',p_board),p_base_revision);
$$;
revoke all on function public.pinboard_force_board_once(uuid,uuid,jsonb,bigint) from public,anon,authenticated;
grant execute on function public.pinboard_force_board_once(uuid,uuid,jsonb,bigint) to authenticated;

revoke all on function private.pinboard_has_keys(jsonb,text[]), private.pinboard_allowed_keys(jsonb,text[]),
  private.pinboard_valid_text(jsonb,integer,boolean), private.pinboard_valid_uuid(jsonb),
  private.pinboard_valid_column_id(jsonb), private.pinboard_valid_date(jsonb),
  private.pinboard_valid_position(jsonb), private.pinboard_valid_state(jsonb,jsonb), private.pinboard_valid_card(jsonb),
  private.pinboard_valid_card_fields(jsonb), private.pinboard_valid_custom_values(jsonb),
  private.pinboard_board_json(public.pinboard_boards), private.pinboard_create_board(uuid,text,text),
  private.pinboard_join_board(text), private.pinboard_apply_operation(uuid,jsonb)
  from public, anon, authenticated;
revoke all on function public.pinboard_create_board(uuid,text,text), public.pinboard_join_board(text) from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.pinboard_create_board(uuid,text,text), private.pinboard_join_board(text) to authenticated;
grant execute on function public.pinboard_create_board(uuid,text,text), public.pinboard_join_board(text) to authenticated;

-- Refresh PostgREST's cached table and RPC names after commit.
notify pgrst, 'reload schema';

commit;
