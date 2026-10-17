-- One-time rename of an installation that already has incremental sync (004).
-- No old endpoints, tables or aliases remain. Data and access grants stay in place.
begin;
do $rename$
declare
  item record;
  renamed text;
  definition text;
begin
  if to_regclass('public.whiteboard_boards') is not null then
    if to_regclass('public.blueprint_boards') is not null then
      raise exception 'Both board tables exist. Resolve the duplicate installation before renaming.';
    end if;
    if to_regprocedure('public.struct_sync_boards(jsonb)') is null then
      raise exception 'The existing installation must have incremental sync (004) before renaming.';
    end if;
    alter table public.whiteboard_boards rename to blueprint_boards;
    alter table private.struct_board_access rename to blueprint_board_access;
    alter table private.struct_board_members rename to blueprint_board_members;
  elsif to_regclass('public.blueprint_boards') is null then
    raise exception 'No board installation found. Apply Blueprint migrations 001 through 004 instead.';
  end if;

  -- Renaming preserves object identities, so grants and policy dependencies stay attached.
  for item in
    select p.oid, p.proname, n.nspname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and (left(p.proname, 7) = 'struct_' or p.proname = 'bump_whiteboard_revision')
  loop
    renamed := replace(replace(item.proname, 'struct_', 'blueprint_'),
      'bump_whiteboard_revision', 'bump_blueprint_revision');
    execute format('alter function %s rename to %I', item.oid::regprocedure, renamed);
  end loop;

  drop function if exists public.blueprint_list_boards();

  -- PL/pgSQL and SQL function bodies keep textual names after ALTER FUNCTION/TABLE.
  for item in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and (left(p.proname, 10) = 'blueprint_' or p.proname = 'bump_blueprint_revision')
  loop
    definition := pg_get_functiondef(item.oid);
    definition := replace(replace(replace(definition, 'struct_', 'blueprint_'),
      'whiteboard_boards', 'blueprint_boards'), 'bump_whiteboard_revision', 'bump_blueprint_revision');
    execute definition;
  end loop;

  for item in
    select c.oid, n.nspname, c.relname, con.conname
    from pg_constraint con join pg_class c on c.oid = con.conrelid
      join pg_namespace n on n.oid = c.relnamespace
    where (n.nspname = 'public' and c.relname = 'blueprint_boards')
       or (n.nspname = 'private' and c.relname in ('blueprint_board_access', 'blueprint_board_members'))
  loop
    renamed := replace(replace(item.conname, 'struct_', 'blueprint_'), 'whiteboard_boards', 'blueprint_boards');
    if renamed <> item.conname then
      execute format('alter table %I.%I rename constraint %I to %I',
        item.nspname, item.relname, item.conname, renamed);
    end if;
  end loop;

  for item in
    select n.nspname, c.relname
    from pg_index i join pg_class c on c.oid = i.indexrelid
      join pg_namespace n on n.oid = c.relnamespace
    where i.indrelid in ('public.blueprint_boards'::regclass,
      'private.blueprint_board_access'::regclass, 'private.blueprint_board_members'::regclass)
  loop
    renamed := replace(replace(item.relname, 'struct_', 'blueprint_'), 'whiteboard_boards', 'blueprint_boards');
    if renamed <> item.relname then
      execute format('alter index %I.%I rename to %I', item.nspname, item.relname, renamed);
    end if;
  end loop;

  for item in select tgname from pg_trigger
    where tgrelid = 'public.blueprint_boards'::regclass and not tgisinternal
  loop
    renamed := replace(item.tgname, 'bump_whiteboard_revision', 'bump_blueprint_revision');
    if renamed <> item.tgname then
      execute format('alter trigger %I on public.blueprint_boards rename to %I', item.tgname, renamed);
    end if;
  end loop;
  for item in select polname from pg_policy where polrelid = 'public.blueprint_boards'::regclass
  loop
    renamed := replace(item.polname, 'Struct', 'Blueprint');
    if renamed <> item.polname then
      execute format('alter policy %I on public.blueprint_boards rename to %I', item.polname, renamed);
    end if;
  end loop;
end;
$rename$;
notify pgrst, 'reload schema';
commit;
