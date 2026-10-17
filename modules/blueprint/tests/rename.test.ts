import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";

const creator = "11111111-1111-4111-8111-111111111111";
const member = "22222222-2222-4222-8222-222222222222";
const outsider = "33333333-3333-4333-8333-333333333333";
const id = "44444444-4444-4444-8444-444444444444";
const document = { nodes: [], edges: [], description: "Existing work" };
const scripts = ["001_blueprint_boards.sql", "002_board_invitations.sql",
  "003_shared_editing.sql", "004_incremental_sync.sql"];

describe("database rename to Blueprint", () => {
  it("renames objects without aliases, preserves work/access and is safe to repeat", async () => {
    const db = new PGlite();
    try {
      await db.exec(`create schema auth; create role anon nologin; create role authenticated nologin;
        create table auth.users(id uuid primary key);
        create function auth.uid() returns uuid language sql stable as $$
          select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
        $$;
        grant usage on schema auth,public to authenticated,anon;
        insert into auth.users values('${creator}'),('${member}'),('${outsider}');
        create table public.iou_groups(id text primary key, payload jsonb);
        insert into public.iou_groups values('untouched','{"name":"Other app"}');`);
      // Build the previously installed namespace from the same historical schemas.
      // The application never reads these names; only the one-time SQL transitions them.
      for (const name of scripts) {
        const source = await readFile(new URL("../supabase/migrations/" + name, import.meta.url), "utf8");
        let previous = source.replaceAll("bump_blueprint_revision", "bump_whiteboard_revision")
          .replaceAll("blueprint_boards", "whiteboard_boards")
          .replaceAll("blueprint_", "struct_").replaceAll("Blueprint", "Struct");
        if (name === "004_incremental_sync.sql")
          previous = previous.replace("drop function if exists public.struct_list_boards();", "");
        await db.exec(previous);
      }
      async function asUser(user: string) {
        await db.exec("reset role; set role authenticated");
        await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
      }
      await asUser(creator);
      const created = (await db.query<{ board: { id: string; invite_code: string } }>(
        "select public.struct_create_board($1,$2,$3::jsonb) as board", [id, "Saved work", JSON.stringify(document)]
      )).rows[0].board;
      await asUser(member);
      await db.query("select public.struct_join_board($1)", [created.invite_code]);
      await db.query("update public.whiteboard_boards set title='Member edit' where id=$1", [id]);
      await db.exec("reset role");
      const rename = await readFile(new URL("../supabase/rename-to-blueprint.sql", import.meta.url), "utf8");
      await db.exec(rename);
      await db.exec(rename);
      expect((await db.query("select payload from public.iou_groups")).rows)
        .toEqual([{ payload: { name: "Other app" } }]);
      expect((await db.query(`select to_regclass('public.whiteboard_boards') as old_table,
        to_regprocedure('public.struct_sync_boards(jsonb)') as old_rpc,
        to_regprocedure('public.blueprint_list_boards()') as retired_list`)).rows)
        .toEqual([{ old_table: null, old_rpc: null, retired_list: null }]);
      expect((await db.query(`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname in ('public','private') and left(p.proname,7)='struct_'`)).rows).toEqual([]);
      expect((await db.query(`select relname from pg_class where left(relname,7)='struct_'
        or left(relname,18)='whiteboard_boards_'`)).rows).toEqual([]);
      expect((await db.query(`select polname from pg_policy
        where polrelid='public.blueprint_boards'::regclass order by polname`)).rows)
        .toEqual([{ polname: "Blueprint editors" }, { polname: "Blueprint readers" }]);
      await asUser(member);
      const listed = (await db.query<{ result: { boards: Record<string, unknown>[] } }>(
        "select public.blueprint_sync_boards('{}'::jsonb) as result"
      )).rows[0].result;
      expect(listed.boards).toHaveLength(1);
      expect(listed.boards[0]).toMatchObject({ id, title: "Member edit", revision: 2,
        invite_code: created.invite_code, document });
      expect((await db.query("update public.blueprint_boards set title='Still editable' where id=$1 returning revision", [id])).rows)
        .toEqual([{ revision: 3 }]);
      await asUser(outsider);
      expect((await db.query("select id from public.blueprint_boards")).rows).toEqual([]);
      await db.query("select public.blueprint_join_board($1)", [created.invite_code]);
      expect((await db.query("select id from public.blueprint_boards")).rows).toEqual([{ id }]);
      await db.exec("reset role; set role anon");
      await expect(db.query("select public.blueprint_sync_boards('{}'::jsonb)")).rejects.toThrow(/permission denied/);
      await db.exec("reset role");
      // Refuse a conflicting double installation before modifying either table.
      await db.exec("create table public.whiteboard_boards(id uuid)");
      await expect(db.exec(rename)).rejects.toThrow("Both board tables exist");
      await db.exec("rollback");
      expect((await db.query("select title,revision from public.blueprint_boards where id=$1", [id])).rows)
        .toEqual([{ title: "Still editable", revision: 3 }]);
    } finally {
      await db.close();
    }
  }, 30000);
});
