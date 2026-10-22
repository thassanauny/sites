-- Blueprint current schema: fresh installation or repeatable refresh as administrator.
-- Preserves current boards, revisions, invitations and memberships.
-- Keep private OUT of the Data API's exposed schemas.
begin;
create schema if not exists private;
grant usage on schema private to authenticated;

create table if not exists public.blueprint_boards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  title text not null check (char_length(title) between 1 and 120),
  document jsonb not null default '{"nodes": [], "edges": [], "description": ""}'::jsonb,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint valid_board_document check (
    jsonb_typeof(document) = 'object'
    and document ? 'nodes' and document ? 'edges'
    and jsonb_typeof(document->'nodes') = 'array'
    and jsonb_typeof(document->'edges') = 'array'
    and jsonb_array_length(document->'nodes') <= 1500
    and jsonb_array_length(document->'edges') <= 3000
    and pg_column_size(document) <= 10485760
  )
);

create table if not exists private.blueprint_board_access (
  board_id uuid primary key references public.blueprint_boards(id) on delete cascade,
  invite_code text not null unique default replace(gen_random_uuid()::text, '-', '')
    check (invite_code ~ '^[a-f0-9]{32}$')
);
create table if not exists private.blueprint_board_members (
  board_id uuid not null references public.blueprint_boards(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (board_id, user_id)
);
create index if not exists blueprint_boards_user_updated_idx on public.blueprint_boards(user_id, updated_at desc);
create index if not exists blueprint_board_members_user_board_idx on private.blueprint_board_members(user_id, board_id);
create or replace function public.bump_blueprint_revision() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.revision := old.revision + 1;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists bump_blueprint_revision on public.blueprint_boards;
create trigger bump_blueprint_revision before update on public.blueprint_boards
  for each row execute function public.bump_blueprint_revision();

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

alter table public.blueprint_boards enable row level security;
alter table private.blueprint_board_access enable row level security;
alter table private.blueprint_board_members enable row level security;
revoke all(id,user_id,title,document,revision,created_at,updated_at) on public.blueprint_boards from public, anon, authenticated;
drop policy if exists "Blueprint readers" on public.blueprint_boards;
drop policy if exists "Blueprint editors" on public.blueprint_boards;
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
revoke all on function public.blueprint_create_board(uuid,text,jsonb), public.blueprint_join_board(text) from public, anon, authenticated;
grant execute on function public.blueprint_create_board(uuid,text,jsonb), public.blueprint_join_board(text) to authenticated;

create or replace function public.blueprint_sync_boards(p_known jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare caller uuid := auth.uid(); heads jsonb; changed jsonb;
begin
  if caller is null then raise exception 'A device session is required' using errcode = '42501'; end if;
  if jsonb_typeof(p_known) is distinct from 'object' then raise exception 'Invalid board revisions' using errcode = '22023'; end if;
  select
    coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'revision', b.revision) order by b.id), '[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object(
      'sharing_version', 2, 'id', b.id, 'title', b.title, 'document', b.document,
      'revision', b.revision, 'created_at', b.created_at, 'updated_at', b.updated_at,
      'invite_code', a.invite_code) order by b.updated_at desc, b.id)
      filter (where p_known->>b.id::text is distinct from b.revision::text), '[]'::jsonb)
  into heads, changed
  from private.blueprint_board_members m
  join public.blueprint_boards b on b.id = m.board_id
  join private.blueprint_board_access a on a.board_id = b.id
  where m.user_id = caller;
  return jsonb_build_object('sharing_version', 2, 'heads', heads, 'boards', changed);
end;
$$;

revoke all on function public.blueprint_sync_boards(jsonb) from public, anon, authenticated;
grant execute on function public.blueprint_sync_boards(jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;
