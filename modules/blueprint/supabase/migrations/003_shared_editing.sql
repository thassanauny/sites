-- Upgrade 001 + 002 to invitation-based collaboration, like Pinboard.
-- Safe to reapply. Preserve every board, revision, invitation and membership.
begin;

drop function if exists public.blueprint_unlock_board(uuid,text);
drop function if exists public.blueprint_rotate_edit_token(uuid);
drop function if exists public.blueprint_lock_board(uuid);
drop function if exists public.blueprint_leave_board(uuid);

-- Every creator also becomes an ordinary member; existing members keep access.
insert into private.blueprint_board_members(board_id, user_id)
select id, user_id from public.blueprint_boards where user_id is not null
on conflict (board_id, user_id) do nothing;

-- Shared work survives cleanup of the original anonymous identity, as in Pinboard.
alter table public.blueprint_boards alter column user_id drop not null;
alter table public.blueprint_boards drop constraint if exists blueprint_boards_user_id_fkey;
alter table public.blueprint_boards add constraint blueprint_boards_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete set null;

create or replace function private.blueprint_can_read(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from private.blueprint_board_members
    where board_id = p_id and user_id = auth.uid()
  );
$$;
create or replace function private.blueprint_can_edit(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.blueprint_can_read(p_id);
$$;
create or replace function private.blueprint_board_result(p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'sharing_version', 2, 'id', b.id, 'title', b.title, 'document', b.document,
    'revision', b.revision, 'created_at', b.created_at, 'updated_at', b.updated_at,
    'invite_code', a.invite_code
  ) from public.blueprint_boards b
    join private.blueprint_board_access a on a.board_id = b.id
  where b.id = p_id and private.blueprint_can_read(b.id);
$$;

create or replace function public.blueprint_create_board(p_id uuid, p_title text, p_document jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid();
begin
  if caller is null then raise exception 'A device session is required' using errcode = '42501'; end if;
  insert into public.blueprint_boards(id, user_id, title, document)
    values (p_id, caller, p_title, p_document) on conflict (id) do nothing;
  if not exists (select 1 from public.blueprint_boards where id = p_id and user_id = caller)
    then raise exception 'Board creation failed' using errcode = '42501'; end if;
  insert into private.blueprint_board_access(board_id) values (p_id) on conflict (board_id) do nothing;
  insert into private.blueprint_board_members(board_id, user_id) values (p_id, caller) on conflict do nothing;
  return private.blueprint_board_result(p_id);
end;
$$;

create or replace function public.blueprint_join_board(p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare matched uuid;
begin
  if auth.uid() is null then raise exception 'A device session is required' using errcode = '42501'; end if;
  select board_id into matched from private.blueprint_board_access
    where invite_code = lower(regexp_replace(p_code, '[[:space:]-]', '', 'g'));
  if matched is null then raise exception 'That invitation was not found. Check the code and try again.' using errcode = 'P0002'; end if;
  insert into private.blueprint_board_members(board_id, user_id) values (matched, auth.uid()) on conflict do nothing;
  return private.blueprint_board_result(matched);
end;
$$;

-- A versioned response prevents older read-only schemas from appearing ready.
drop function if exists public.blueprint_list_boards();
create function public.blueprint_list_boards() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'A device session is required' using errcode = '42501'; end if;
  return jsonb_build_object('sharing_version', 2, 'boards', coalesce((
    select jsonb_agg(private.blueprint_board_result(b.id) order by b.updated_at desc, b.id)
    from public.blueprint_boards b where private.blueprint_can_read(b.id)
  ), '[]'::jsonb));
end;
$$;

alter table private.blueprint_board_members drop column if exists role;
alter table private.blueprint_board_access drop column if exists edit_token_hash;

drop policy if exists "Blueprint readers" on public.blueprint_boards;
drop policy if exists "Blueprint editors" on public.blueprint_boards;
drop policy if exists "Blueprint owner deletion" on public.blueprint_boards;
revoke all on public.blueprint_boards from public, anon, authenticated;
grant select(id,title,document,revision,created_at,updated_at) on public.blueprint_boards to authenticated;
grant update(title,document) on public.blueprint_boards to authenticated;
create policy "Blueprint readers" on public.blueprint_boards for select to authenticated
  using (private.blueprint_can_read(id));
create policy "Blueprint editors" on public.blueprint_boards for update to authenticated
  using (private.blueprint_can_edit(id)) with check (private.blueprint_can_edit(id));

revoke all on private.blueprint_board_access, private.blueprint_board_members from public, anon, authenticated;
revoke all on function private.blueprint_can_read(uuid), private.blueprint_can_edit(uuid), private.blueprint_board_result(uuid) from public, anon, authenticated;
grant execute on function private.blueprint_can_read(uuid), private.blueprint_can_edit(uuid) to authenticated;
revoke all on function public.blueprint_list_boards(), public.blueprint_create_board(uuid,text,jsonb), public.blueprint_join_board(text) from public, anon, authenticated;
grant execute on function public.blueprint_list_boards(), public.blueprint_create_board(uuid,text,jsonb), public.blueprint_join_board(text) to authenticated;
notify pgrst, 'reload schema';
commit;
