-- TextDrop current schema: fresh installation or repeatable refresh as administrator.
-- Preserves current pages, invitations, memberships, versions and retry receipts.
-- Keep private OUT of the Data API's exposed schemas.
begin;
create schema if not exists private;
drop function if exists public.textdrop_load_page(uuid);
drop function if exists public.textdrop_save_page(uuid,text);
drop function if exists public.textdrop_save_page_receipt(uuid,text);
drop function if exists public.textdrop_rename_page(uuid,text);
drop function if exists private.textdrop_load_page(uuid);
drop function if exists private.textdrop_save_page(uuid,text);
drop function if exists private.textdrop_rename_page(uuid,text);

create table if not exists public.textdrop_pages (
  id uuid primary key,
  code text not null unique check (code ~ '^[a-f0-9]{32}$'),
  content text not null default '' check (octet_length(content) <= 1048576),
  name text check (name is null or (char_length(name) between 1 and 80 and name = btrim(name) and name !~ '[[:cntrl:]]')),
  mutation_floor bigint not null default 0,
  version bigint not null default 1 check (version between 1 and 9007199254740991),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.textdrop_page_access (
  page_id uuid not null references public.textdrop_pages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (page_id, user_id)
);

create index if not exists textdrop_page_access_user_idx on public.textdrop_page_access (user_id, page_id);
create index if not exists textdrop_pages_creator_idx on public.textdrop_pages (created_by);

alter table public.textdrop_pages enable row level security;
alter table public.textdrop_page_access enable row level security;
revoke all on public.textdrop_pages, public.textdrop_page_access from public, anon, authenticated;
-- RLS stays enabled with no policies: the app uses the RPCs below only, so there is no direct read.


create or replace function private.textdrop_page_json(p_page public.textdrop_pages)
returns jsonb language sql immutable security invoker set search_path = '' as $$
  select jsonb_build_object('id', p_page.id, 'code', p_page.code, 'text', p_page.content,
    'name', p_page.name, 'version', p_page.version, 'updatedAt', p_page.updated_at);
$$;

create or replace function private.textdrop_create_page(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  invitation text;
  page_row public.textdrop_pages%rowtype;
begin
  if caller is null then raise exception 'TEXTDROP_AUTH_REQUIRED' using errcode = '42501'; end if;
  if p_id is null then raise exception 'TEXTDROP_INVALID_PAGE' using errcode = '22023'; end if;
  -- Serialize this session's create/join limits, including concurrent requests.
  perform pg_advisory_xact_lock(hashtextextended(caller::text, 9185));
  select * into page_row from public.textdrop_pages where id = p_id;
  if found then
    if page_row.created_by = caller and exists (
      select 1 from public.textdrop_page_access where page_id = page_row.id and user_id = caller
    ) then return private.textdrop_page_json(page_row); end if;
    raise exception 'TEXTDROP_INVALID_PAGE' using errcode = '22023';
  end if;
  if (select count(*) from public.textdrop_pages where created_by = caller) >= 100
    or (select count(*) from public.textdrop_page_access where user_id = caller) >= 1000
  then raise exception 'TEXTDROP_PAGE_LIMIT' using errcode = 'P0001'; end if;
  loop
    invitation := replace(gen_random_uuid()::text, '-', '');
    begin
      insert into public.textdrop_pages (id, code, created_by)
      values (p_id, invitation, caller) returning * into page_row;
      exit;
    exception when unique_violation then
      -- Retry random invitation collisions without revealing an existing ID.
      if exists (select 1 from public.textdrop_pages where id = p_id) then
        raise exception 'TEXTDROP_INVALID_PAGE' using errcode = '22023';
      end if;
    end;
  end loop;
  insert into public.textdrop_page_access (page_id, user_id) values (page_row.id, caller);
  return private.textdrop_page_json(page_row);
end;
$$;
create or replace function private.textdrop_join_page(p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  normalized text := lower(regexp_replace(p_code, E'[\u0009-\u000d\u0020\u002d]+', '', 'g'));
  page_row public.textdrop_pages%rowtype;
begin
  if caller is null then raise exception 'TEXTDROP_AUTH_REQUIRED' using errcode = '42501'; end if;
  if normalized is null or normalized !~ '^[a-f0-9]{32}$' then
    raise exception 'TEXTDROP_INVALID_CODE' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(caller::text, 9185));
  select * into page_row from public.textdrop_pages where code = normalized;
  if not found then raise exception 'TEXTDROP_INVALID_CODE' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.textdrop_page_access where page_id = page_row.id and user_id = caller)
    and (select count(*) from public.textdrop_page_access where user_id = caller) >= 1000
  then raise exception 'TEXTDROP_PAGE_LIMIT' using errcode = 'P0001'; end if;
  insert into public.textdrop_page_access (page_id, user_id) values (page_row.id, caller) on conflict do nothing;
  return private.textdrop_page_json(page_row);
end;
$$;
create or replace function private.textdrop_poll_page(p_id uuid, p_known bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  page_row public.textdrop_pages%rowtype;
begin
  if caller is null then raise exception 'TEXTDROP_AUTH_REQUIRED' using errcode = '42501'; end if;
  if not exists (select 1 from public.textdrop_page_access where page_id = p_id and user_id = caller)
    then raise exception 'TEXTDROP_ACCESS_DENIED' using errcode = '42501'; end if;
  select * into page_row from public.textdrop_pages where id = p_id;
  if not found then raise exception 'TEXTDROP_ACCESS_DENIED' using errcode = '42501'; end if;
  if p_known is not null and page_row.version = p_known then
    return jsonb_build_object('id', page_row.id, 'unchanged', true, 'version', page_row.version);
  end if;
  return private.textdrop_page_json(page_row);
end;
$$;
create or replace function private.textdrop_names(p_codes text[])
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'TEXTDROP_AUTH_REQUIRED' using errcode = '42501'; end if;
  if p_codes is null or cardinality(p_codes) > 1000 then raise exception 'TEXTDROP_INVALID_CODE' using errcode = '22023'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('code', p.code, 'name', p.name, 'version', p.version) order by p.code), '[]'::jsonb)
    from public.textdrop_pages p join public.textdrop_page_access a on a.page_id = p.id and a.user_id = auth.uid()
    where p.code = any(p_codes));
end;
$$;
create or replace function public.textdrop_create_page(p_id uuid)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.textdrop_create_page(p_id);
$$;
create or replace function public.textdrop_join_page(p_code text)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.textdrop_join_page(p_code);
$$;
create or replace function public.textdrop_poll_page(p_id uuid, p_known bigint)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.textdrop_poll_page(p_id, p_known);
$$;
create or replace function public.textdrop_names(p_codes text[])
returns jsonb language sql security invoker set search_path = '' as $$
  select private.textdrop_names(p_codes);
$$;
grant usage on schema private to authenticated;
revoke all on function private.textdrop_create_page(uuid), private.textdrop_join_page(text), private.textdrop_poll_page(uuid,bigint), private.textdrop_names(text[]) from public, anon, authenticated;
grant execute on function private.textdrop_create_page(uuid), private.textdrop_join_page(text), private.textdrop_poll_page(uuid,bigint), private.textdrop_names(text[]) to authenticated;
revoke all on function public.textdrop_create_page(uuid), public.textdrop_join_page(text), public.textdrop_poll_page(uuid,bigint), public.textdrop_names(text[]) from public, anon, authenticated;
grant execute on function public.textdrop_create_page(uuid), public.textdrop_join_page(text), public.textdrop_poll_page(uuid,bigint), public.textdrop_names(text[]) to authenticated;
revoke all on function private.textdrop_page_json(public.textdrop_pages) from public, anon, authenticated;

create table if not exists private.textdrop_save_receipts (
  page_id uuid not null references public.textdrop_pages(id) on delete cascade,
  operation_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  text_hash text not null,
  base_hash text not null,
  base_version bigint not null,
  version bigint not null,
  result jsonb not null,
  primary key (page_id, operation_id)
);
create index if not exists textdrop_save_receipts_version_idx on private.textdrop_save_receipts(page_id, version desc, operation_id);
alter table private.textdrop_save_receipts enable row level security;
revoke all on private.textdrop_save_receipts from public, anon, authenticated;

create or replace function private.textdrop_save_checked(p_id uuid, p_text text, p_expected bigint, p_base_hash text, p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  page_row public.textdrop_pages%rowtype;
  prior private.textdrop_save_receipts%rowtype;
  sent_hash text;
  response jsonb;
  removed_floor bigint;
begin
  if caller is null then raise exception 'TEXTDROP_AUTH_REQUIRED' using errcode = '42501'; end if;
  if not exists (select 1 from public.textdrop_page_access where page_id = p_id and user_id = caller)
    then raise exception 'TEXTDROP_ACCESS_DENIED' using errcode = '42501'; end if;
  if p_text is null or octet_length(p_text) > 1048576
    then raise exception 'TEXTDROP_INVALID_TEXT' using errcode = '22023'; end if;
  if p_operation_id is null or p_expected is null or p_expected not between 1 and 9007199254740991
    or p_base_hash is null or p_base_hash !~ '^[a-f0-9]{64}$'
    then raise exception 'TEXTDROP_INVALID_SAVE' using errcode = '22023'; end if;
  select * into page_row from public.textdrop_pages where id = p_id for update;
  if not found then raise exception 'TEXTDROP_ACCESS_DENIED' using errcode = '42501'; end if;
  sent_hash := encode(sha256(convert_to(p_text, 'UTF8')), 'hex');
  select * into prior from private.textdrop_save_receipts where page_id = p_id and operation_id = p_operation_id;
  if found then
    if prior.user_id <> caller or prior.text_hash <> sent_hash or prior.base_hash <> p_base_hash or prior.base_version <> p_expected
      then raise exception 'TEXTDROP_INVALID_SAVE' using errcode = '22023'; end if;
    return prior.result;
  end if;
  -- A pruned retry must never become a fresh write, even if text later returns to its old value.
  if p_expected < page_row.mutation_floor or p_expected > page_row.version or
    (p_expected <> page_row.version and encode(sha256(convert_to(page_row.content, 'UTF8')), 'hex') <> p_base_hash and page_row.content <> p_text)
    then return jsonb_build_object('conflict', private.textdrop_page_json(page_row)); end if;
  if page_row.content is distinct from p_text then
    if page_row.version = 9007199254740991 then raise exception 'TEXTDROP_VERSION_LIMIT' using errcode = 'P0001'; end if;
    update public.textdrop_pages set content = p_text, version = version + 1, updated_at = clock_timestamp()
      where id = p_id returning * into page_row;
  end if;
  -- Build a receipt directly; never serialize the potentially 1 MiB text for successful writes.
  response := jsonb_build_object('id', page_row.id, 'code', page_row.code, 'name', page_row.name,
    'version', page_row.version, 'updatedAt', page_row.updated_at);
  insert into private.textdrop_save_receipts values
    (p_id, p_operation_id, caller, sent_hash, p_base_hash, p_expected, page_row.version, response);
  with expired as (
    select operation_id from private.textdrop_save_receipts where page_id = p_id
      order by version desc, operation_id offset 128
  ), removed as (
    delete from private.textdrop_save_receipts r using expired e
      where r.page_id = p_id and r.operation_id = e.operation_id returning r.version
  ) select max(version) into removed_floor from removed;
  if removed_floor is not null then
    update public.textdrop_pages set mutation_floor = greatest(mutation_floor, removed_floor) where id = p_id;
  end if;
  return response;
end;
$$;
create or replace function public.textdrop_save_checked(p_id uuid, p_text text, p_expected bigint, p_base_hash text, p_operation_id uuid)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.textdrop_save_checked(p_id, p_text, p_expected, p_base_hash, p_operation_id);
$$;
revoke all on function private.textdrop_save_checked(uuid,text,bigint,text,uuid), public.textdrop_save_checked(uuid,text,bigint,text,uuid)
  from public, anon, authenticated;
grant execute on function private.textdrop_save_checked(uuid,text,bigint,text,uuid), public.textdrop_save_checked(uuid,text,bigint,text,uuid)
  to authenticated;

-- Return text only if it differs from the caller's cached content.
create or replace function private.textdrop_rename_checked(p_id uuid, p_name text, p_text_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  normalized text := nullif(btrim(p_name), '');
  page_row public.textdrop_pages%rowtype;
begin
  if caller is null then raise exception 'TEXTDROP_AUTH_REQUIRED' using errcode = '42501'; end if;
  if not exists (select 1 from public.textdrop_page_access where page_id = p_id and user_id = caller)
    then raise exception 'TEXTDROP_ACCESS_DENIED' using errcode = '42501'; end if;
  if normalized is not null and (char_length(normalized) > 80 or normalized ~ '[[:cntrl:]]')
    then raise exception 'TEXTDROP_INVALID_NAME' using errcode = '22023'; end if;
  if p_text_hash is null or p_text_hash !~ '^[a-f0-9]{64}$' then raise exception 'TEXTDROP_INVALID_SAVE' using errcode = '22023'; end if;
  select * into page_row from public.textdrop_pages where id = p_id for update;
  if not found then raise exception 'TEXTDROP_ACCESS_DENIED' using errcode = '42501'; end if;
  if page_row.name is distinct from normalized then
    if page_row.version = 9007199254740991 then raise exception 'TEXTDROP_VERSION_LIMIT' using errcode = 'P0001'; end if;
    update public.textdrop_pages set name = normalized, version = version + 1, updated_at = clock_timestamp()
      where id = p_id returning * into page_row;
  end if;
  if encode(sha256(convert_to(page_row.content, 'UTF8')), 'hex') <> p_text_hash then return private.textdrop_page_json(page_row); end if;
  return jsonb_build_object('id', page_row.id, 'code', page_row.code, 'name', page_row.name,
    'version', page_row.version, 'updatedAt', page_row.updated_at);
end;
$$;
create or replace function public.textdrop_rename_checked(p_id uuid, p_name text, p_text_hash text)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.textdrop_rename_checked(p_id, p_name, p_text_hash);
$$;
revoke all on function private.textdrop_rename_checked(uuid,text,text), public.textdrop_rename_checked(uuid,text,text) from public, anon, authenticated;
grant execute on function private.textdrop_rename_checked(uuid,text,text), public.textdrop_rename_checked(uuid,text,text) to authenticated;
notify pgrst, 'reload schema';
commit;
