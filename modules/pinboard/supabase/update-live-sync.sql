-- Optional low-latency invalidation. Install only after schema.sql, on a Supabase
-- project with Realtime already installed. Does not configure hosted services.
begin;
do $$
begin
  if to_regclass('realtime.messages') is null
    or to_regprocedure('realtime.send(jsonb,text,text,boolean)') is null
    or to_regprocedure('realtime.topic()') is null then
    raise exception 'Pinboard live sync requires the existing Supabase Realtime service';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'realtime.messages'::regclass) then
    raise exception 'Pinboard live sync requires existing Realtime row security';
  end if;
end;
$$;

drop policy if exists pinboard_receive_board_changes on realtime.messages;
create policy pinboard_receive_board_changes on realtime.messages
  for select to authenticated using (
    extension = 'broadcast'
    and topic = (select realtime.topic())
    and (select realtime.topic()) = 'pinboard:user:' || (select auth.uid())::text
  );

create or replace function private.pinboard_notify_board_changes()
returns trigger language plpgsql security definer set search_path = '' as $$
declare recipient uuid;
begin
  if tg_op = 'UPDATE' and new.revision = old.revision then return new; end if;
  for recipient in select user_id from public.pinboard_board_access where board_id = new.id loop
    begin
      perform realtime.send(jsonb_build_object('id', new.id, 'revision', new.revision),
        'board_changed', 'pinboard:user:' || recipient::text, true);
    exception when others then
      -- Polling recovers a missed hint; notification failure must not lose a save.
      null;
    end;
  end loop;
  return new;
end;
$$;
create or replace function private.pinboard_notify_board_access()
returns trigger language plpgsql security definer set search_path = '' as $$
declare board_revision bigint;
begin
  begin
    select revision into board_revision from public.pinboard_boards where id = new.board_id;
    perform realtime.send(jsonb_build_object('id', new.board_id, 'revision', board_revision),
      'board_changed', 'pinboard:user:' || new.user_id::text, true);
  exception when others then
    null;
  end;
  return new;
end;
$$;
revoke all on function private.pinboard_notify_board_changes(), private.pinboard_notify_board_access()
  from public, anon, authenticated;
drop trigger if exists pinboard_board_changes on public.pinboard_boards;
create trigger pinboard_board_changes after insert or update of revision on public.pinboard_boards
  for each row execute function private.pinboard_notify_board_changes();
drop trigger if exists pinboard_board_access on public.pinboard_board_access;
create trigger pinboard_board_access after insert on public.pinboard_board_access
  for each row execute function private.pinboard_notify_board_access();
commit;
