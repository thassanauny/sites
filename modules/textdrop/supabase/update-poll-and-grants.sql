-- TextDrop update for projects installed from an earlier schema.sql. Run it once in the SQL editor
-- as administrator; it is safe to run again. New installs get the same result from schema.sql.
-- 1. Adds the conditional poll function (textdrop_poll_page); older clients simply never call it.
-- 2. Drops the direct read grants and policies: the app uses the RPCs only.
begin;

drop policy if exists textdrop_read_own_access on public.textdrop_page_access;
drop policy if exists textdrop_read_joined_pages on public.textdrop_pages;
revoke select on public.textdrop_pages, public.textdrop_page_access from public, anon, authenticated;

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

create or replace function public.textdrop_poll_page(p_id uuid, p_known bigint)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.textdrop_poll_page(p_id, p_known);
$$;

revoke all on function private.textdrop_poll_page(uuid,bigint), public.textdrop_poll_page(uuid,bigint)
  from public, anon, authenticated;
grant execute on function private.textdrop_poll_page(uuid,bigint), public.textdrop_poll_page(uuid,bigint) to authenticated;

notify pgrst, 'reload schema';
commit;
