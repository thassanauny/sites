-- Additive response optimization for installed TextDrop projects; safe to repeat.
-- Delegate to the original save so validation, row locks and acceptance order stay identical.
begin;

create or replace function public.textdrop_save_page_receipt(p_id uuid, p_text text)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.textdrop_save_page(p_id, p_text) - 'text';
$$;

revoke all on function public.textdrop_save_page_receipt(uuid,text) from public, anon, authenticated;
grant execute on function public.textdrop_save_page_receipt(uuid,text) to authenticated;
notify pgrst, 'reload schema';
commit;
