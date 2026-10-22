-- Checked text writes and bounded replay receipts; preserves pages, codes and access.
begin;
alter table public.textdrop_pages add column if not exists mutation_floor bigint not null default 0;
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
