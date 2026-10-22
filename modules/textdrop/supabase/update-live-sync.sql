-- Optional private invalidation hints. Requires Supabase Realtime; durable saves/polls work without it.
begin;
do $$ begin
  if to_regclass('realtime.messages') is null
    or to_regprocedure('realtime.send(jsonb,text,text,boolean)') is null
    or to_regprocedure('realtime.topic()') is null then
    raise exception 'TextDrop live sync requires existing Supabase Realtime support';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'realtime.messages'::regclass) then
    raise exception 'TextDrop live sync requires Realtime message RLS';
  end if;
end; $$;
-- Realtime owns this schema/table. Only add our app-scoped receive policy.
drop policy if exists textdrop_receive_changes on realtime.messages;
create policy textdrop_receive_changes on realtime.messages for select to authenticated
  using (extension = 'broadcast' and topic = (select realtime.topic()) and (select realtime.topic()) = 'textdrop:user:' || (select auth.uid())::text);

create or replace function private.textdrop_notify_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare member_id uuid;
begin
  -- Changes and delivery are independent: missed notifications are repaired by checked polling.
  if TG_TABLE_NAME = 'textdrop_page_access' then
    perform realtime.send(jsonb_build_object('id', new.page_id), 'changed', 'textdrop:user:' || new.user_id::text, true);
  elsif TG_OP = 'INSERT' or new.version is distinct from old.version then
    for member_id in select user_id from public.textdrop_page_access where page_id = new.id loop
      perform realtime.send(jsonb_build_object('id', new.id, 'version', new.version), 'changed', 'textdrop:user:' || member_id::text, true);
    end loop;
  end if;
  return new;
exception when others then
  -- Never turn a committed-intent text save into a failed write because Realtime is unavailable.
  return new;
end;
$$;
revoke all on function private.textdrop_notify_change() from public, anon, authenticated;
drop trigger if exists textdrop_notify_page on public.textdrop_pages;
create trigger textdrop_notify_page after insert or update on public.textdrop_pages for each row execute function private.textdrop_notify_change();
drop trigger if exists textdrop_notify_access on public.textdrop_page_access;
create trigger textdrop_notify_access after insert on public.textdrop_page_access for each row execute function private.textdrop_notify_change();
commit;
