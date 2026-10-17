import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
const creator = "11111111-1111-4111-8111-111111111111";
const member = "22222222-2222-4222-8222-222222222222";
const outsider = "33333333-3333-4333-8333-333333333333";
const legacy = "44444444-4444-4444-8444-444444444444";
let db: PGlite;
let legacyInvite: string;
type Result = {
  id: string;
  invite_code: string;
  sharing_version: number;
  revision: number;
  title: string;
};
const doc = JSON.stringify({ nodes: [], edges: [], description: "" });
async function asUser(id: string) {
  await db.exec("reset role; set role authenticated;");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
}
async function call<T = Result>(sql: string, args: unknown[] = []): Promise<T> {
  return (await db.query<{ value: T }>(`select ${sql} as value`, args)).rows[0]
    .value;
}
async function create() {
  await asUser(creator);
  return call("public.blueprint_create_board($1,$2,$3::jsonb)", [
    crypto.randomUUID(),
    "System",
    doc,
  ]);
}
async function join(board: Result, user = member) {
  await asUser(user);
  return call("public.blueprint_join_board($1)", [board.invite_code]);
}
async function write(board: Result, title = "Changed") {
  return db.query(
    "update blueprint_boards set title=$1 where id=$2 returning revision",
    [title, board.id],
  );
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create schema auth; create role anon nologin; create role authenticated nologin;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth,public to authenticated,anon;
    insert into auth.users values('${creator}'),('${member}'),('${outsider}');`);
  const migration = (name: string) =>
    readFile(
      new URL("../supabase/migrations/" + name, import.meta.url),
      "utf8",
    );
  await db.exec(await migration("001_blueprint_boards.sql"));
  await asUser(creator);
  await db.query(
    "insert into blueprint_boards(id,user_id,title) values($1,$2,$3)",
    [legacy, creator, "Existing board"],
  );
  await db.exec("reset role");
  await db.exec(await migration("002_board_invitations.sql"));
  legacyInvite = (
    await db.query<{ invite_code: string }>(
      "select invite_code from private.blueprint_board_access where board_id=$1",
      [legacy],
    )
  ).rows[0].invite_code;
  await asUser(member);
  await call("public.blueprint_join_board($1)", [legacyInvite]);
  // A genuine old viewer cannot write before the upgrade.
  expect((await write({ id: legacy } as Result)).rows).toEqual([]);
  await db.exec("reset role");
  await expect(
    db.exec(await migration("004_incremental_sync.sql")),
  ).rejects.toThrow("Apply 003_shared_editing.sql before");
  await db.exec("rollback");
  const shared = await migration("003_shared_editing.sql");
  await db.exec(shared);
  await db.exec(shared);
  const incremental = await migration("004_incremental_sync.sql");
  await db.exec(incremental);
  await db.exec(incremental);
}, 30000);
afterAll(async () => {
  await db?.close();
});

describe("shared invitation permissions", () => {
  it("sends documents only for changed revisions and never returns another user’s boards", async () => {
    await asUser(creator);
    const board = await create();
    const first = (await call("public.blueprint_sync_boards($1::jsonb)", [
      "{}",
    ])) as Result & {
      heads: { id: string; revision: number }[];
      boards: Result[];
    };
    expect(first.boards.some((item) => item.id === board.id)).toBe(true);
    const known = Object.fromEntries(
      first.heads.map((head) => [head.id, head.revision]),
    );
    const idle = (await call("public.blueprint_sync_boards($1::jsonb)", [
      JSON.stringify(known),
    ])) as typeof first;
    expect(idle.boards).toEqual([]);
    expect(idle.heads).toEqual(first.heads);
    await write(board, "Changed board");
    const changed = (await call("public.blueprint_sync_boards($1::jsonb)", [
      JSON.stringify(known),
    ])) as typeof first;
    expect(changed.boards).toHaveLength(1);
    expect(changed.boards[0].id).toBe(board.id);
    expect(changed.boards[0].revision).toBe(2);
    await asUser(outsider);
    const foreign = (await call("public.blueprint_sync_boards($1::jsonb)", [
      JSON.stringify(known),
    ])) as typeof first;
    expect(foreign.heads.some((head) => head.id === board.id)).toBe(false);
    expect(foreign.boards.some((item) => item.id === board.id)).toBe(false);
    await db.exec("reset role; set role anon;");
    await expect(
      call("public.blueprint_sync_boards($1::jsonb)", ["{}"]),
    ).rejects.toThrow(/permission denied/);
  });
  it("replays safely and preserves boards, documents, revisions, invitations and old memberships", async () => {
    await asUser(member);
    const listed = await call<{ sharing_version: number; boards: Result[] }>(
      "public.blueprint_sync_boards('{}'::jsonb)",
    );
    expect(listed.sharing_version).toBe(2);
    expect(await call("to_regprocedure('public.blueprint_list_boards()')::text")).toBeNull();
    const board = listed.boards.find((board) => board.id === legacy)!;
    expect(board.title).toBe("Existing board");
    expect(board.revision).toBe(1);
    expect(board.invite_code).toBe(legacyInvite);
    const saved = await db.query<{ document: unknown }>(
      "select document from blueprint_boards where id=$1",
      [legacy],
    );
    expect(saved.rows[0].document).toEqual(JSON.parse(doc));
    expect((await write(board)).rows).toEqual([{ revision: 2 }]);
    await asUser(creator);
    expect(
      (await db.query("select id from blueprint_boards where id=$1", [legacy]))
        .rows,
    ).toHaveLength(1);
  });
  it("creates a single invitation without returning ownership or editing credentials", async () => {
    const board = await create();
    expect(board.sharing_version).toBe(2);
    expect(board.invite_code).toMatch(/^[a-f0-9]{32}$/);
    expect(Object.keys(board).sort()).toEqual([
      "created_at",
      "document",
      "id",
      "invite_code",
      "revision",
      "sharing_version",
      "title",
      "updated_at",
    ]);
    await expect(
      db.query("select * from private.blueprint_board_access"),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.query("select user_id from blueprint_boards"),
    ).rejects.toThrow(/permission denied/);
  });
  it("lets anyone who joins edit immediately, including formatted invitations and repeated joins", async () => {
    const board = await create();
    await asUser(member);
    const formatted = board.invite_code
      .toUpperCase()
      .match(/.{1,8}/g)!
      .join(" - ");
    const joined = await call("public.blueprint_join_board($1)", [
      " " + formatted + " ",
    ]);
    expect(joined.id).toBe(board.id);
    expect((await write(board)).rows).toEqual([{ revision: 2 }]);
    expect((await join(board)).revision).toBe(2);
    expect((await write(board, "Another edit")).rows).toEqual([
      { revision: 3 },
    ]);
    await asUser(creator);
    expect((await write(board)).rows).toEqual([{ revision: 4 }]);
  });
  it("denies nonmembers even when they know a board ID", async () => {
    const board = await create();
    await asUser(outsider);
    expect(
      (
        await db.query("select id from blueprint_boards where id=$1", [
          board.id,
        ])
      ).rows,
    ).toEqual([]);
    expect((await write(board)).rows).toEqual([]);
    const listed = await call<{ boards: Result[] }>(
      "public.blueprint_sync_boards('{}'::jsonb)",
    );
    expect(listed.boards.some((item) => item.id === board.id)).toBe(false);
    await expect(
      call("public.blueprint_join_board($1)", ["0".repeat(32)]),
    ).rejects.toThrow(/not found/);
    await expect(call("public.blueprint_join_board($1)", [null])).rejects.toThrow(
      /not found/,
    );
  });
  it("prevents membership forgery, direct insertion, creation ID theft and metadata changes", async () => {
    const board = await create();
    await join(board);
    for (const sql of [
      "insert into private.blueprint_board_members(board_id,user_id) values('" +
        board.id +
        "','" +
        outsider +
        "')",
      "insert into blueprint_boards(user_id,title) values('" +
        member +
        "','No')",
      "update blueprint_boards set user_id='" +
        member +
        "' where id='" +
        board.id +
        "'",
      "update blueprint_boards set revision=99 where id='" + board.id + "'",
    ])
      await expect(db.query(sql)).rejects.toThrow(/permission denied/);
    await expect(
      call("public.blueprint_create_board($1,$2,$3::jsonb)", [
        board.id,
        "Stolen",
        doc,
      ]),
    ).rejects.toThrow(/creation failed/);
  });
  it("does not let creators or members delete shared boards", async () => {
    const board = await create();
    await join(board);
    for (const id of [member, creator]) {
      await asUser(id);
      await expect(
        db.query("delete from blueprint_boards where id=$1", [board.id]),
      ).rejects.toThrow(/permission denied/);
      expect(
        (
          await db.query("select id from blueprint_boards where id=$1", [
            board.id,
          ])
        ).rows,
      ).toHaveLength(1);
    }
  });
  it("preserves collaborators’ work when the original anonymous identity is cleaned up", async () => {
    const temporaryCreator = crypto.randomUUID();
    await db.exec("reset role");
    await db.query("insert into auth.users(id) values($1)", [temporaryCreator]);
    await asUser(temporaryCreator);
    const board = await call("public.blueprint_create_board($1,$2,$3::jsonb)", [
      crypto.randomUUID(),
      "Keep shared work",
      doc,
    ]);
    await join(board);
    await db.exec("reset role");
    await db.query("delete from auth.users where id=$1", [temporaryCreator]);
    await db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/003_shared_editing.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await db.exec(
      await readFile(new URL("../supabase/migrations/004_incremental_sync.sql", import.meta.url), "utf8"),
    );
    await asUser(member);
    const listed = await call<{ boards: Result[] }>(
      "public.blueprint_sync_boards('{}'::jsonb)",
    );
    expect(
      listed.boards.find((item) => item.id === board.id)?.invite_code,
    ).toBe(board.invite_code);
    expect((await write(board)).rows).toHaveLength(1);
  });
  it("removes obsolete token functions and role/secret columns", async () => {
    await db.exec("reset role");
    for (const name of [
      "blueprint_unlock_board(uuid,text)",
      "blueprint_rotate_edit_token(uuid)",
      "blueprint_lock_board(uuid)",
      "blueprint_leave_board(uuid)",
    ])
      expect(
        await call<string | null>("to_regprocedure($1)::text", [
          "public." + name,
        ]),
      ).toBeNull();
    const columns = await db.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_schema='private' and table_name in ('blueprint_board_access','blueprint_board_members')",
    );
    expect(columns.rows.map((row) => row.column_name)).not.toContain(
      "edit_token_hash",
    );
    expect(columns.rows.map((row) => row.column_name)).not.toContain("role");
  });
  it("denies anonymous RPC and table access, and rejects sessions with no identity", async () => {
    await db.exec("reset role; set role anon;");
    for (const sql of [
      "select id from blueprint_boards",
      "update blueprint_boards set title='No'",
      "delete from blueprint_boards",
      "select public.blueprint_sync_boards('{}'::jsonb)",
      "select public.blueprint_join_board('bad')",
      "select public.blueprint_create_board(gen_random_uuid(),'No','{\"nodes\":[],\"edges\":[]}'::jsonb)",
    ])
      await expect(db.query(sql)).rejects.toThrow(/permission denied/);
    await asUser("");
    await expect(call("public.blueprint_sync_boards('{}'::jsonb)")).rejects.toThrow(
      /device session/,
    );
    await expect(
      call("public.blueprint_join_board($1)", [legacyInvite]),
    ).rejects.toThrow(/device session/);
  });
  it("compares revisions so stale document saves cannot overwrite accepted changes", async () => {
    const board = await create();
    await join(board);
    expect(
      (
        await db.query(
          "update blueprint_boards set title='First' where id=$1 and revision=1 returning revision",
          [board.id],
        )
      ).rows,
    ).toEqual([{ revision: 2 }]);
    await asUser(creator);
    expect(
      (
        await db.query(
          "update blueprint_boards set title='Stale' where id=$1 and revision=1 returning revision",
          [board.id],
        )
      ).rows,
    ).toEqual([]);
    expect(
      (
        await db.query("select title from blueprint_boards where id=$1", [
          board.id,
        ])
      ).rows,
    ).toEqual([{ title: "First" }]);
  });
  it("retries creation without changing the invitation, document or revision", async () => {
    const board = await create();
    await write(board, "Keep this change");
    const retried = await call("public.blueprint_create_board($1,$2,$3::jsonb)", [
      board.id,
      "Original",
      doc,
    ]);
    expect(retried.invite_code).toBe(board.invite_code);
    expect(retried.title).toBe("Keep this change");
    expect(retried.revision).toBe(2);
  });
});
