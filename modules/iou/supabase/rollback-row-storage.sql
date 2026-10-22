-- IOU row-storage rollback: reconstruct the LATEST accepted ledger, never an old snapshot.
-- Run as project administrator. Clients requiring delta saves need the row migration again.
begin;
do $$
declare h record; restored jsonb;
begin
  if to_regclass('public.iou_group_headers') is null then return; end if;
  lock table public.iou_group_headers in access exclusive mode;
  -- Child writes use this header lock. The migration owner is the only direct writer.
  alter table public.iou_group_headers add column payload jsonb;
  for h in select * from public.iou_group_headers order by id for update loop
    restored:=private.iou_group_payload(h.id);
    if not coalesce(private.iou_valid_group(restored),false) or octet_length(restored::text)<>h.payload_bytes
      then raise exception 'IOU_ROW_ROLLBACK_INVALID %',h.id; end if;
    update public.iou_group_headers set payload=restored where id=h.id;
  end loop;
  drop view public.iou_groups;
  drop table public.iou_expense_shares,public.iou_expenses,public.iou_payments,public.iou_transactions,public.iou_members;
  alter table public.iou_group_headers drop column metadata,drop column member_count,drop column transaction_count,
    drop column member_bytes,drop column transaction_bytes,drop column payload_bytes;
  alter table public.iou_group_headers rename to iou_groups;
  alter table public.iou_groups alter column payload set not null,
    add constraint iou_groups_payload_valid check(private.iou_valid_group(payload)),
    add constraint iou_groups_payload_id check(payload->>'id'=id),
    add constraint iou_groups_payload_invite check(payload->>'inviteCode'=invite_code);
end;
$$;
drop function if exists public.iou_save_group_delta(text,bigint,jsonb);
drop function if exists private.iou_save_group_delta(text,bigint,jsonb);
drop function if exists private.iou_apply_delta(text,jsonb);
drop function if exists private.iou_group_payload(text);
drop function if exists private.iou_transaction_payload(text,text);
drop function if exists private.iou_payload_bytes(jsonb,integer,integer,bigint,bigint);
drop function if exists private.iou_valid_transaction(jsonb,text[]);
create or replace function private.iou_create_group(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  invite text;
  prepared jsonb;
  new_row public.iou_groups%rowtype;
begin
  if caller is null then raise exception 'IOU_AUTH_REQUIRED' using errcode = '42501'; end if;
  -- Bound one anonymous session's storage usage, including concurrent creates.
  perform pg_advisory_xact_lock(hashtextextended(caller::text, 9183));
  if jsonb_typeof(p_payload) is distinct from 'object'
    or not coalesce(private.iou_valid_id(p_payload->'id'), false)
  then raise exception 'IOU_INVALID_GROUP' using errcode = '22023'; end if;
  -- A response can be lost after commit. Retrying the same ID returns the
  -- creator's existing group, without overwriting it or generating another code.
  select * into new_row from public.iou_groups where id = p_payload->>'id';
  if found then
    if new_row.created_by = caller and exists (
      select 1 from public.iou_group_access where group_id = new_row.id and user_id = caller
    ) then
      return jsonb_build_object('payload', new_row.payload, 'version', new_row.version);
    end if;
    raise exception 'IOU_INVALID_GROUP' using errcode = '22023';
  end if;
  if (select count(*) from public.iou_groups where created_by = caller) >= 100 then
    raise exception 'IOU_GROUP_LIMIT' using errcode = 'P0001';
  end if;
  loop
    invite := replace(gen_random_uuid()::text, '-', '');
    prepared := jsonb_set(p_payload, '{inviteCode}', to_jsonb(invite));
    if not private.iou_valid_group(prepared) then raise exception 'IOU_INVALID_GROUP' using errcode = '22023'; end if;
    begin
      insert into public.iou_groups (id, invite_code, payload, created_by)
        values (prepared->>'id', invite, prepared, caller) returning * into new_row;
      exit;
    exception when unique_violation then
      -- Retry the exceedingly unlikely code collision, never an existing group ID.
      if exists (select 1 from public.iou_groups where id = prepared->>'id') then
        raise exception 'IOU_INVALID_GROUP' using errcode = '22023';
      end if;
    end;
  end loop;
  insert into public.iou_group_access (group_id, user_id) values (new_row.id, caller);
  return jsonb_build_object('payload', new_row.payload, 'version', new_row.version);
end;
$$;

create or replace function private.iou_join_group(p_invite_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  normalized text := lower(regexp_replace(p_invite_code, '\s+', '', 'g'));
  group_row public.iou_groups%rowtype;
begin
  if caller is null then raise exception 'IOU_AUTH_REQUIRED' using errcode = '42501'; end if;
  if normalized is null or normalized !~ '^[a-f0-9]{32}$' then
    raise exception 'IOU_INVALID_INVITE' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(caller::text, 9183));
  select * into group_row from public.iou_groups where invite_code = normalized;
  if not found then raise exception 'IOU_INVALID_INVITE' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.iou_group_access where group_id = group_row.id and user_id = caller)
    and (select count(*) from public.iou_group_access where user_id = caller) >= 1000
  then raise exception 'IOU_GROUP_LIMIT' using errcode = 'P0001'; end if;
  insert into public.iou_group_access (group_id, user_id) values (group_row.id, caller) on conflict do nothing;
  return jsonb_build_object('payload', group_row.payload, 'version', group_row.version);
end;
$$;

create or replace function private.iou_save_group(p_payload jsonb, p_expected_version bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  group_row public.iou_groups%rowtype;
begin
  if caller is null then raise exception 'IOU_AUTH_REQUIRED' using errcode = '42501'; end if;
  if p_expected_version is null or p_expected_version not between 1 and 9007199254740990
    or not private.iou_valid_group(p_payload)
  then raise exception 'IOU_INVALID_GROUP' using errcode = '22023'; end if;
  if not exists (select 1 from public.iou_group_access where group_id = p_payload->>'id' and user_id = caller) then
    raise exception 'IOU_ACCESS_DENIED' using errcode = '42501';
  end if;
  -- The lock serializes writes. Compare the revision after obtaining the lock.
  select * into group_row from public.iou_groups where id = p_payload->>'id' for update;
  if not found then raise exception 'IOU_ACCESS_DENIED' using errcode = '42501'; end if;
  if group_row.version <> p_expected_version then raise exception 'IOU_CONFLICT' using errcode = 'PT409'; end if;
  if p_payload->>'id' is distinct from group_row.payload->>'id'
    or p_payload->>'inviteCode' is distinct from group_row.invite_code
    or p_payload->>'currency' is distinct from group_row.payload->>'currency'
    or p_payload->>'createdAt' is distinct from group_row.payload->>'createdAt'
  then raise exception 'IOU_IMMUTABLE_SETTINGS' using errcode = '22023'; end if;
  update public.iou_groups set payload = p_payload, version = version + 1, updated_at = now()
    where id = group_row.id and version = p_expected_version returning * into group_row;
  if not found then raise exception 'IOU_CONFLICT' using errcode = 'PT409'; end if;
  return jsonb_build_object('payload', group_row.payload, 'version', group_row.version);
end;
$$;

-- Exposed RPC entry points have invoker privileges. Privileged code stays private.
create or replace function public.iou_create_group(p_payload jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.iou_create_group(p_payload);
$$;
create or replace function public.iou_join_group(p_invite_code text)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.iou_join_group(p_invite_code);
$$;
create or replace function public.iou_save_group(p_payload jsonb, p_expected_version bigint)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.iou_save_group(p_payload, p_expected_version);
$$;

-- Also shipped in update-group-heads.sql for installed projects. One scalar JSON
-- response avoids row caps and repeated exact counts; start from this user's access.
create or replace function private.iou_group_heads()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare caller uuid := auth.uid();
begin
  if caller is null then raise exception 'IOU_AUTH_REQUIRED' using errcode = '42501'; end if;
  return jsonb_build_object('format', 1, 'heads', coalesce((
    select jsonb_agg(jsonb_build_object('id', g.id, 'version', g.version) order by g.id)
    from public.iou_group_access a
    join public.iou_groups g on g.id = a.group_id
    where a.user_id = caller
  ), '[]'::jsonb));
end;
$$;

create or replace function public.iou_group_heads()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.iou_group_heads();
$$;

revoke all on function private.iou_group_heads(), public.iou_group_heads() from public, anon, authenticated;
grant execute on function private.iou_group_heads(), public.iou_group_heads() to authenticated;

-- Revoke PostgreSQL's default PUBLIC execution grants and Supabase role defaults.
revoke all on function private.iou_has_keys(jsonb,text[]), private.iou_valid_text(jsonb,integer,boolean),
  private.iou_valid_id(jsonb), private.iou_valid_date(jsonb), private.iou_valid_timestamp(jsonb),
  private.iou_valid_money(jsonb,boolean), private.iou_valid_group(jsonb),
  private.iou_create_group(jsonb), private.iou_join_group(text), private.iou_save_group(jsonb,bigint)
  from public, anon, authenticated;
revoke all on function public.iou_create_group(jsonb), public.iou_join_group(text), public.iou_save_group(jsonb,bigint)
  from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.iou_create_group(jsonb), private.iou_join_group(text), private.iou_save_group(jsonb,bigint)
  to authenticated;
grant execute on function public.iou_create_group(jsonb), public.iou_join_group(text), public.iou_save_group(jsonb,bigint)
  to authenticated;


-- The optional live header trigger follows the table rename and still fires once per version.
commit;
