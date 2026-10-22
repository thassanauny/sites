import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";

const creator = "11111111-1111-4111-8111-111111111111";
const member = "22222222-2222-4222-8222-222222222222";
const outsider = "33333333-3333-4333-8333-333333333333";
let db: PGlite;
let migration: string;
const sendFunction = `create or replace function realtime.send(jsonb,text,text,boolean) returns void language sql as $$
  insert into realtime.messages(payload,event,topic,private) values($1,$2,$3,$4);
$$;`;
async function asUser(id: string) {
  await db.exec("reset role; set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.query("select set_config('realtime.topic',$1,false)", [`blueprint:user:${id}`]);
}
async function create() {
  await asUser(creator);
  return (await db.query<{ board: { id: string; invite_code: string } }>(
    "select public.blueprint_create_board($1,$2,$3::jsonb) board",
    [crypto.randomUUID(), "Shared diagram", JSON.stringify({ nodes: [], edges: [], description: "" })],
  )).rows[0].board;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create schema auth; create role anon nologin; create role authenticated nologin;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth,public to authenticated,anon;
    insert into auth.users values('${creator}'),('${member}'),('${outsider}');`);
  for (const name of ["001_blueprint_boards.sql", "002_board_invitations.sql", "003_shared_editing.sql", "004_incremental_sync.sql"])
    await db.exec(await readFile(new URL("../supabase/migrations/" + name, import.meta.url), "utf8"));
  migration = await readFile(new URL("../supabase/update-live-sync.sql", import.meta.url), "utf8");
  await expect(db.exec(migration)).rejects.toThrow("Supabase Realtime must be installed");
  await db.exec("rollback");
  // Test-only stand-in for the existing Supabase-owned Realtime objects. The
  // app migration must never create these objects or change their grants/RLS.
  await db.exec(`create schema realtime;
    create table realtime.messages(payload jsonb,event text,topic text,private boolean,extension text default 'broadcast');
    alter table realtime.messages enable row level security;
    grant usage on schema realtime to authenticated;
    grant select,insert on realtime.messages to authenticated;
    create function realtime.topic() returns text language sql stable as $$select current_setting('realtime.topic',true)$$;
    ${sendFunction}`);
  await db.exec(migration);
  await db.exec(migration);
}, 30000);
afterAll(async () => { await db?.close(); });

describe("private database invalidation", () => {
  it("replays without changing existing service-owned tables, board IDs or invitations", async () => {
    const board = await create();
    await db.exec("reset role");
    await db.exec(migration);
    const row = (await db.query<{ invite_code: string; revision: number }>(
      "select a.invite_code,b.revision from blueprint_boards b join private.blueprint_board_access a on a.board_id=b.id where b.id=$1", [board.id],
    )).rows[0];
    expect(row).toEqual({ invite_code: board.invite_code, revision: 1 });
    expect(migration).not.toMatch(/(?:create\s+(?:table|schema)\s+(?:if\s+not\s+exists\s+)?realtime|alter\s+table\s+realtime|grant\s+.*on\s+(?:table\s+)?realtime)/i);
  });

  it("sends only ID/revision hints to joined identities, including creation and joining", async () => {
    const board = await create();
    await db.exec("reset role");
    const creation = (await db.query<{ payload: unknown; topic: string }>("select payload,topic from realtime.messages where payload->>'id'=$1", [board.id])).rows;
    expect(creation).toEqual([{ payload: { id: board.id, revision: 1 }, topic: `blueprint:user:${creator}` }]);
    await asUser(member);
    await db.query("select public.blueprint_join_board($1)", [board.invite_code]);
    await db.exec("reset role; delete from realtime.messages");
    await asUser(member);
    await db.query("update blueprint_boards set title='Updated diagram' where id=$1", [board.id]);
    await db.exec("reset role");
    const messages = (await db.query("select payload,event,topic,private from realtime.messages order by topic")).rows;
    expect(messages).toEqual([creator, member].map(id => ({
      payload: { id: board.id, revision: 2 }, event: "changed", topic: `blueprint:user:${id}`, private: true,
    })));
  });

  it("allows receiving only the caller's Broadcast topic and denies browser publishing", async () => {
    await db.exec("reset role; delete from realtime.messages");
    await db.query("insert into realtime.messages(payload,event,topic,private,extension) values('{}','changed',$1,true,'broadcast'),('{}','changed',$2,true,'broadcast'),('{}','changed',$1,true,'presence')", [`blueprint:user:${creator}`, `blueprint:user:${member}`]);
    await asUser(creator);
    expect((await db.query("select topic from realtime.messages")).rows).toEqual([{ topic: `blueprint:user:${creator}` }]);
    await db.query("select set_config('realtime.topic',$1,false)", [`blueprint:user:${member}`]);
    expect((await db.query("select topic from realtime.messages")).rows).toEqual([]);
    await asUser(outsider);
    expect((await db.query("select topic from realtime.messages")).rows).toEqual([]);
    await expect(db.query("insert into realtime.messages(payload,event,topic,private) values('{}','changed',$1,true)", [`blueprint:user:${outsider}`])).rejects.toThrow(/row-level security/);
  });

  it("commits diagram writes even when notification delivery fails", async () => {
    const board = await create();
    await db.exec("reset role");
    await db.exec("create or replace function realtime.send(jsonb,text,text,boolean) returns void language plpgsql as $$begin raise exception 'Realtime unavailable'; end;$$;");
    await asUser(creator);
    expect((await db.query("update blueprint_boards set title='Durably saved' where id=$1 returning title,revision", [board.id])).rows).toEqual([{ title: "Durably saved", revision: 2 }]);
    // Membership changes also remain durable during a live-service outage.
    await asUser(member);
    expect((await db.query<{ board: { id: string } }>("select public.blueprint_join_board($1) board", [board.invite_code])).rows[0].board.id).toBe(board.id);
  });
});
