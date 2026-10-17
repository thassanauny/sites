-- Incremental collection protocol after 003. No board, invitation or revision changes.
begin;

-- Do not advertise the shared-editing protocol over the historical token schema.
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'private' and (
    (table_name = 'blueprint_board_access' and column_name = 'edit_token_hash') or
    (table_name = 'blueprint_board_members' and column_name = 'role')
  )) then raise exception 'Apply 003_shared_editing.sql before 004_incremental_sync.sql'; end if;
end; $$;

-- The primary key starts with board_id; collection reads start with the user.
create index if not exists blueprint_board_members_user_board_idx
  on private.blueprint_board_members(user_id, board_id);

-- The incremental API is the only supported collection protocol.
drop function if exists public.blueprint_list_boards();

-- Return identities/revisions for all joined boards, serializing documents only
-- for new or changed boards, in one request and one database snapshot.
create or replace function public.blueprint_sync_boards(p_known jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare caller uuid := auth.uid(); heads jsonb; changed jsonb;
begin
  if caller is null then raise exception 'A device session is required' using errcode = '42501'; end if;
  if jsonb_typeof(p_known) is distinct from 'object' then raise exception 'Invalid board revisions' using errcode = '22023'; end if;
  select
    coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'revision', b.revision) order by b.id), '[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object(
      'sharing_version', 2, 'id', b.id, 'title', b.title, 'document', b.document,
      'revision', b.revision, 'created_at', b.created_at, 'updated_at', b.updated_at,
      'invite_code', a.invite_code) order by b.updated_at desc, b.id)
      filter (where p_known->>b.id::text is distinct from b.revision::text), '[]'::jsonb)
  into heads, changed
  from private.blueprint_board_members m
  join public.blueprint_boards b on b.id = m.board_id
  join private.blueprint_board_access a on a.board_id = b.id
  where m.user_id = caller;
  return jsonb_build_object('sharing_version', 2, 'heads', heads, 'boards', changed);
end;
$$;

revoke all on function public.blueprint_sync_boards(jsonb) from public, anon, authenticated;
grant execute on function public.blueprint_sync_boards(jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;
