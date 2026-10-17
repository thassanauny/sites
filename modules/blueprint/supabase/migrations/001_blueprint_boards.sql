-- Run once in the Supabase SQL editor, or apply with the Supabase CLI.
create table public.blueprint_boards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
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

create index blueprint_boards_user_updated_idx on public.blueprint_boards(user_id, updated_at desc);
alter table public.blueprint_boards enable row level security;
revoke all on public.blueprint_boards from anon, authenticated;
grant select, insert, update, delete on public.blueprint_boards to authenticated;

create policy "Read own boards" on public.blueprint_boards for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Insert own boards" on public.blueprint_boards for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "Update own boards" on public.blueprint_boards for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Delete own boards" on public.blueprint_boards for delete to authenticated
  using ((select auth.uid()) = user_id);

create function public.bump_blueprint_revision() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.revision := old.revision + 1;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create trigger bump_blueprint_revision before update on public.blueprint_boards
  for each row execute function public.bump_blueprint_revision();
