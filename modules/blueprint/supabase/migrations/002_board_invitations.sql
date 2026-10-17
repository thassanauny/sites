-- Add read-only invitations and separate edit tokens to the original private boards.
-- Safe to reapply. Existing boards keep their IDs, owners, documents and revisions.
create schema if not exists private;
grant usage on schema private to authenticated;

create table if not exists private.blueprint_board_access (
  board_id uuid primary key references public.blueprint_boards(id) on delete cascade,
  invite_code text not null unique default replace(gen_random_uuid()::text, '-', '')
    check (invite_code ~ '^[a-f0-9]{32}$'),
  edit_token_hash text not null check (edit_token_hash ~ '^[a-f0-9]{64}$')
);
create table if not exists private.blueprint_board_members (
  board_id uuid not null references public.blueprint_boards(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'viewer' check (role in ('viewer', 'editor')),
  primary key (board_id, user_id)
);
revoke all on private.blueprint_board_access, private.blueprint_board_members from public, anon, authenticated;

insert into private.blueprint_board_access(board_id, edit_token_hash)
select id, encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text, 'UTF8')), 'hex')
from public.blueprint_boards on conflict (board_id) do nothing;

create or replace function private.blueprint_can_read(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.blueprint_boards b where b.id = p_id and (
      b.user_id = auth.uid() or exists (
        select 1 from private.blueprint_board_members m where m.board_id = b.id and m.user_id = auth.uid()
      )
    )
  );
$$;
create or replace function private.blueprint_can_edit(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.blueprint_boards b where b.id = p_id and (
      b.user_id = auth.uid() or exists (
        select 1 from private.blueprint_board_members m where m.board_id = b.id and m.user_id = auth.uid() and m.role = 'editor'
      )
    )
  );
$$;
create or replace function private.blueprint_board_result(p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select to_jsonb(b) || jsonb_build_object(
    'invite_code', a.invite_code,
    'access_role', case when b.user_id = auth.uid() then 'owner' else m.role end
  ) from public.blueprint_boards b
    join private.blueprint_board_access a on a.board_id = b.id
    left join private.blueprint_board_members m on m.board_id = b.id and m.user_id = auth.uid()
  where b.id = p_id and private.blueprint_can_read(b.id);
$$;
revoke all on function private.blueprint_can_read(uuid), private.blueprint_can_edit(uuid), private.blueprint_board_result(uuid) from public, anon, authenticated;
grant execute on function private.blueprint_can_read(uuid), private.blueprint_can_edit(uuid) to authenticated;

drop policy if exists "Read own boards" on public.blueprint_boards;
drop policy if exists "Insert own boards" on public.blueprint_boards;
drop policy if exists "Update own boards" on public.blueprint_boards;
drop policy if exists "Delete own boards" on public.blueprint_boards;
drop policy if exists "Blueprint readers" on public.blueprint_boards;
drop policy if exists "Blueprint editors" on public.blueprint_boards;
drop policy if exists "Blueprint owner deletion" on public.blueprint_boards;
revoke all on public.blueprint_boards from public, anon, authenticated;
grant select, delete on public.blueprint_boards to authenticated;
grant update(title, document) on public.blueprint_boards to authenticated;
create policy "Blueprint readers" on public.blueprint_boards for select to authenticated
  using (private.blueprint_can_read(id));
create policy "Blueprint editors" on public.blueprint_boards for update to authenticated
  using (private.blueprint_can_edit(id)) with check (private.blueprint_can_edit(id));
create policy "Blueprint owner deletion" on public.blueprint_boards for delete to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.blueprint_list_boards() returns setof jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'A device session is required' using errcode = '42501'; end if;
  return query select private.blueprint_board_result(b.id) from public.blueprint_boards b
    where private.blueprint_can_read(b.id) order by b.updated_at desc;
end;
$$;

create or replace function public.blueprint_create_board(p_id uuid, p_title text, p_document jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  inserted integer;
begin
  if caller is null then raise exception 'A device session is required' using errcode = '42501'; end if;
  insert into public.blueprint_boards(id, user_id, title, document)
    values (p_id, caller, p_title, p_document) on conflict (id) do nothing;
  get diagnostics inserted = row_count;
  if not exists (select 1 from public.blueprint_boards where id = p_id and user_id = caller)
    then raise exception 'Board creation failed' using errcode = '42501'; end if;
  insert into private.blueprint_board_access(board_id, edit_token_hash)
    values (p_id, encode(sha256(convert_to(token, 'UTF8')), 'hex')) on conflict (board_id) do nothing;
  return private.blueprint_board_result(p_id) || jsonb_build_object('edit_token', case when inserted = 1 then token else null end);
end;
$$;

create or replace function public.blueprint_join_board(p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare matched uuid;
begin
  if auth.uid() is null then raise exception 'A device session is required' using errcode = '42501'; end if;
  select board_id into matched from private.blueprint_board_access where invite_code = lower(trim(p_code));
  if matched is null then raise exception 'That invitation was not found. Check the code and try again.' using errcode = 'P0002'; end if;
  insert into private.blueprint_board_members(board_id, user_id, role) values (matched, auth.uid(), 'viewer')
    on conflict (board_id, user_id) do nothing;
  return private.blueprint_board_result(matched);
end;
$$;

create or replace function public.blueprint_unlock_board(p_id uuid, p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare expected text;
begin
  if not private.blueprint_can_read(p_id) then raise exception 'Join this board before entering its edit token.' using errcode = '42501'; end if;
  -- Serialize token validation against rotation so a revoked token cannot grant access afterwards.
  select edit_token_hash into expected from private.blueprint_board_access where board_id = p_id for share;
  if p_token is null or length(trim(p_token)) <> 64 or expected is distinct from encode(sha256(convert_to(trim(p_token), 'UTF8')), 'hex')
    then raise exception 'That edit token is invalid or has been replaced.' using errcode = '42501'; end if;
  insert into private.blueprint_board_members(board_id, user_id, role) values (p_id, auth.uid(), 'editor')
    on conflict (board_id, user_id) do update set role = 'editor';
  return private.blueprint_board_result(p_id);
end;
$$;

create or replace function public.blueprint_rotate_edit_token(p_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  if not exists (select 1 from public.blueprint_boards where id = p_id and user_id = auth.uid())
    then raise exception 'Only the board creator can replace the edit token.' using errcode = '42501'; end if;
  perform 1 from private.blueprint_board_access where board_id = p_id for update;
  update private.blueprint_board_access set edit_token_hash = encode(sha256(convert_to(token, 'UTF8')), 'hex') where board_id = p_id;
  update private.blueprint_board_members set role = 'viewer' where board_id = p_id;
  return token;
end;
$$;

create or replace function public.blueprint_lock_board(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not private.blueprint_can_read(p_id) then raise exception 'Board access is required.' using errcode = '42501'; end if;
  update private.blueprint_board_members set role = 'viewer' where board_id = p_id and user_id = auth.uid();
  return private.blueprint_board_result(p_id);
end;
$$;

create or replace function public.blueprint_leave_board(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'A device session is required' using errcode = '42501'; end if;
  if exists (select 1 from public.blueprint_boards where id = p_id and user_id = auth.uid())
    then raise exception 'The creator must delete the board instead of leaving it.' using errcode = '42501'; end if;
  delete from private.blueprint_board_members where board_id = p_id and user_id = auth.uid();
end;
$$;

revoke all on function public.blueprint_list_boards(), public.blueprint_create_board(uuid,text,jsonb),
  public.blueprint_join_board(text), public.blueprint_unlock_board(uuid,text), public.blueprint_rotate_edit_token(uuid),
  public.blueprint_lock_board(uuid), public.blueprint_leave_board(uuid) from public, anon, authenticated;
grant execute on function public.blueprint_list_boards(), public.blueprint_create_board(uuid,text,jsonb),
  public.blueprint_join_board(text), public.blueprint_unlock_board(uuid,text), public.blueprint_rotate_edit_token(uuid),
  public.blueprint_lock_board(uuid), public.blueprint_leave_board(uuid) to authenticated;
