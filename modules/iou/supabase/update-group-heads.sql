-- Additive read optimization for an installed IOU project; safe to repeat.
-- Existing tables, write functions, revisions and memberships stay unchanged.
begin;

create or replace function private.iou_group_heads()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare caller uuid := auth.uid();
begin
  if caller is null then raise exception 'IOU_AUTH_REQUIRED' using errcode = '42501'; end if;
  if to_regclass('public.iou_group_headers') is not null then
    return jsonb_build_object('format', 1, 'heads', coalesce((
      select jsonb_agg(jsonb_build_object('id', h.id, 'version', h.version) order by h.id)
      from public.iou_group_access a join public.iou_group_headers h on h.id = a.group_id
      where a.user_id = caller
    ), '[]'::jsonb));
  end if;
  return jsonb_build_object('format', 1, 'heads', coalesce((
    select jsonb_agg(jsonb_build_object('id', g.id, 'version', g.version) order by g.id)
    from public.iou_group_access a join public.iou_groups g on g.id = a.group_id
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
notify pgrst, 'reload schema';
commit;
