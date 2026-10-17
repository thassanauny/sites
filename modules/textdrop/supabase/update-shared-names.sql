-- Optional shared names; preserves existing text, codes and memberships.
begin;
alter table public.textdrop_pages add column if not exists name text
  check (name is null or (char_length(name) between 1 and 80 and name = btrim(name) and name !~ '[[:cntrl:]]'));

create or replace function private.textdrop_page_json(p_page public.textdrop_pages)
returns jsonb language sql immutable security invoker set search_path = '' as $$
  select jsonb_build_object('id', p_page.id, 'code', p_page.code, 'text', p_page.content,
    'name', p_page.name, 'version', p_page.version, 'updatedAt', p_page.updated_at);
$$;

create or replace function private.textdrop_rename_page(p_id uuid, p_name text)
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
  select * into page_row from public.textdrop_pages where id = p_id for update;
  if not found then raise exception 'TEXTDROP_ACCESS_DENIED' using errcode = '42501'; end if;
  if page_row.name is distinct from normalized then
    if page_row.version = 9007199254740991 then raise exception 'TEXTDROP_VERSION_LIMIT' using errcode = 'P0001'; end if;
    update public.textdrop_pages set name = normalized, version = version + 1, updated_at = clock_timestamp()
      where id = p_id returning * into page_row;
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

create or replace function public.textdrop_rename_page(p_id uuid, p_name text)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.textdrop_rename_page(p_id, p_name);
$$;
create or replace function public.textdrop_names(p_codes text[])
returns jsonb language sql security invoker set search_path = '' as $$
  select private.textdrop_names(p_codes);
$$;
revoke all on function private.textdrop_rename_page(uuid,text), private.textdrop_names(text[]),
  public.textdrop_rename_page(uuid,text), public.textdrop_names(text[])
  from public, anon, authenticated;
grant execute on function private.textdrop_rename_page(uuid,text), private.textdrop_names(text[]),
  public.textdrop_rename_page(uuid,text), public.textdrop_names(text[])
  to authenticated;
notify pgrst, 'reload schema';
commit;
