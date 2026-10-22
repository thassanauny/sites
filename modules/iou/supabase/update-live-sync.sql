-- Optional private metadata invalidations. Requires Supabase-managed Realtime.
begin;
do $$
begin
  if to_regclass('realtime.messages') is null
    or to_regprocedure('realtime.send(jsonb,text,text,boolean)') is null
    or to_regprocedure('realtime.topic()') is null then
    raise exception 'IOU live sync requires existing Supabase Realtime messages/send/topic support';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'realtime.messages'::regclass) then
    raise exception 'IOU live sync requires Realtime message RLS';
  end if;
end;
$$;

drop policy if exists iou_receive_own_changes on realtime.messages;
create policy iou_receive_own_changes on realtime.messages for select to authenticated
  using (extension = 'broadcast' and topic = (select realtime.topic()) and (select realtime.topic()) = 'iou:user:' || (select auth.uid())::text);

create or replace function private.iou_broadcast_group_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare member_id uuid;
begin
  for member_id in select user_id from public.iou_group_access where group_id = new.id loop
    begin
      perform realtime.send(jsonb_build_object('id', new.id, 'revision', new.version),
        'changed', 'iou:user:' || member_id::text, true);
    exception when others then
      -- Notifications are hints; an unavailable broadcaster cannot reject a save.
      null;
    end;
  end loop;
  return new;
end;
$$;

create or replace function private.iou_broadcast_membership()
returns trigger language plpgsql security definer set search_path = '' as $$
declare current_version bigint;
begin
  select version into current_version from public.iou_groups where id = new.group_id;
  begin
    perform realtime.send(jsonb_build_object('id', new.group_id, 'revision', current_version),
      'changed', 'iou:user:' || new.user_id::text, true);
  exception when others then null;
  end;
  return new;
end;
$$;

revoke all on function private.iou_broadcast_group_change(), private.iou_broadcast_membership() from public, anon, authenticated;
drop trigger if exists iou_live_group_change on public.iou_group_headers;
create trigger iou_live_group_change after update of version on public.iou_group_headers
  for each row execute function private.iou_broadcast_group_change();
drop trigger if exists iou_live_membership on public.iou_group_access;
create trigger iou_live_membership after insert on public.iou_group_access
  for each row execute function private.iou_broadcast_membership();
commit;
