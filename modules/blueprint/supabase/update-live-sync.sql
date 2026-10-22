-- Optional private Broadcast invalidation after schema.sql.
-- Requires Supabase-managed Realtime; never creates or changes its tables/grants.
begin;

do $$ begin
  if to_regclass('realtime.messages') is null
    or to_regprocedure('realtime.send(jsonb,text,text,boolean)') is null
    or to_regprocedure('realtime.topic()') is null then
    raise exception 'Supabase Realtime must be installed before Blueprint live sync';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'realtime.messages'::regclass) then
    raise exception 'Supabase Realtime messages must already have row security enabled';
  end if;
  if to_regprocedure('public.blueprint_sync_boards(jsonb)') is null then
    raise exception 'Apply Blueprint schema.sql before live sync';
  end if;
end; $$;

drop policy if exists "Blueprint receive own changes" on realtime.messages;
create policy "Blueprint receive own changes" on realtime.messages
  for select to authenticated using (
    extension = 'broadcast'
    and (select realtime.topic()) = 'blueprint:user:' || (select auth.uid())::text
    and topic = (select realtime.topic())
  );

create or replace function private.blueprint_notify_board_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare recipient uuid;
begin
  for recipient in select user_id from private.blueprint_board_members where board_id = new.id loop
    begin
      perform realtime.send(jsonb_build_object('id', new.id, 'revision', new.revision),
        'changed', 'blueprint:user:' || recipient::text, true);
    exception when others then
      null; -- A missed hint is recovered by compact polling; never fail the save.
    end;
  end loop;
  return new;
exception when others then
  return new;
end;
$$;

create or replace function private.blueprint_notify_membership() returns trigger
language plpgsql security definer set search_path = '' as $$
declare version integer;
begin
  select revision into version from public.blueprint_boards where id = new.board_id;
  perform realtime.send(jsonb_build_object('id', new.board_id, 'revision', version),
    'changed', 'blueprint:user:' || new.user_id::text, true);
  return new;
exception when others then
  return new;
end;
$$;

revoke all on function private.blueprint_notify_board_change(), private.blueprint_notify_membership()
  from public, anon, authenticated;
drop trigger if exists blueprint_live_board_change on public.blueprint_boards;
create trigger blueprint_live_board_change after insert or update on public.blueprint_boards
  for each row execute function private.blueprint_notify_board_change();
drop trigger if exists blueprint_live_membership on private.blueprint_board_members;
create trigger blueprint_live_membership after insert on private.blueprint_board_members
  for each row execute function private.blueprint_notify_membership();

commit;
