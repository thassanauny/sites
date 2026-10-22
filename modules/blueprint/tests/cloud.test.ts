import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import {
  CloudConflictError,
  boardFromRow,
  saveCloudBoard,
  listCloudBoards,
} from "../src/infrastructure/cloud/boards";
import { boardContent, serializeBoard } from "../src/domain/boards/codec";
import { createBoard } from "../src/domain/boards/templates";
function mockClient(body: unknown, status = 200) {
  const calls: { url: string; options: RequestInit | undefined }[] = [];
  const client = createClient(
    "https://example.supabase.co",
    "sb_publishable_test",
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: async (input, options) => {
          calls.push({ url: String(input), options });
          return new Response(JSON.stringify(body), {
            status,
            headers: { "content-type": "application/json" },
          });
        },
      },
    },
  );
  return { client, calls };
}
function row(board = createBoard()) {
  const { title, ...document } = JSON.parse(boardContent(board));
  return {
    id: board.id,
    title,
    document,
    invite_code: "a".repeat(32),
    sharing_version: 2,
    revision: 1,
    updated_at: new Date().toISOString(),
  };
}
describe("shared board protocol", () => {
  it("uses one incremental request and reuses unchanged documents without parsing them again", async () => {
    const known = boardFromRow(row());
    const { client, calls } = mockClient({
      sharing_version: 2,
      heads: [{ id: known.id, revision: known.revision }],
      boards: [],
    });
    const result = await listCloudBoards(client, [known]);
    expect(result[0]).toBe(known);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/rpc/blueprint_sync_boards");
    expect(JSON.parse(calls[0].options?.body as string).p_known).toEqual({
      [known.id]: known.revision,
    });
  });

  it("refuses a changed revision whose document is absent", async () => {
    const known = boardFromRow(row());
    const { client } = mockClient({
      sharing_version: 2,
      heads: [{ id: known.id, revision: known.revision + 1 }],
      boards: [],
    });
    await expect(listCloudBoards(client, [known])).rejects.toThrow(
      "changed board is missing",
    );
  });

  it("reports missing incremental setup without using the retired list API", async () => {
    const { client, calls } = mockClient({ code: "PGRST202", message: "Missing function" }, 404);
    await expect(listCloudBoards(client)).rejects.toThrow("schema.sql");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/rpc/blueprint_sync_boards");
  });
  it("creates through the RPC and keeps invitation credentials out of portable board files", async () => {
    const board = createBoard();
    const remote = row(board);
    const { client, calls } = mockClient(remote);
    const saved = await saveCloudBoard(client, board);
    expect(saved).toEqual({ revision: 1, inviteCode: remote.invite_code });
    expect(calls[0].url).toContain("/rpc/blueprint_create_board");
    expect(JSON.parse(calls[0].options?.body as string).p_id).toBe(board.id);
    const restored = boardFromRow(remote);
    expect(serializeBoard(restored)).not.toContain(remote.invite_code);
  });
  it("updates a joined board with revision matching and database-enforced membership", async () => {
    const board = {
      ...createBoard(),
      revision: 7,
      inviteCode: "a".repeat(32),
    };
    const { client, calls } = mockClient([{ revision: 8 }]);
    expect((await saveCloudBoard(client, board)).revision).toBe(8);
    const url = new URL(calls[0].url);
    expect(calls[0].options?.method).toBe("PATCH");
    expect(url.searchParams.get("revision")).toBe("eq.7");
    expect(url.searchParams.has("user_id")).toBe(false);
  });
  it("explicit force sync replaces only the requested board without a revision filter", async () => {
    const board = { ...createBoard(), revision: 3, inviteCode: "a".repeat(32) };
    const { client, calls } = mockClient([{ revision: 12 }]);
    expect(await saveCloudBoard(client, board, { force: true })).toEqual({ revision: 12, inviteCode: board.inviteCode });
    const url = new URL(calls[0].url);
    expect(url.searchParams.get("id")).toBe(`eq.${board.id}`);
    expect(url.searchParams.has("revision")).toBe(false);
    const { title, ...document } = JSON.parse(boardContent(board));
    expect(JSON.parse(calls[0].options?.body as string)).toEqual({ title, document });
    const missing = mockClient([]);
    await expect(saveCloudBoard(missing.client, board, { force: true })).rejects.toThrow("no longer accessible");
    const denied = mockClient({ message: "Access denied" }, 403);
    await expect(saveCloudBoard(denied.client, board, { force: true })).rejects.toMatchObject({ message: "Access denied" });
  });
  it("refuses an older sharing schema instead of accepting hidden token requirements", async () => {
    const board = createBoard();
    const { sharing_version: _version, ...invalid } = row(board);
    const { client } = mockClient(invalid);
    await expect(saveCloudBoard(client, board)).rejects.toThrow(
      "schema.sql",
    );
  });
  it("reports stale or revoked writes as a conflict", async () => {
    const { client } = mockClient([]);
    await expect(
      saveCloudBoard(client, {
        ...createBoard(),
        revision: 3,
      }),
    ).rejects.toBeInstanceOf(CloudConflictError);
  });
  it("does not acknowledge changed local content after a lost create response", async () => {
    const board = createBoard();
    const remote = row(board);
    remote.title = "Earlier saved title";
    const { client } = mockClient(remote);
    await expect(saveCloudBoard(client, board)).rejects.toBeInstanceOf(
      CloudConflictError,
    );
  });
  it("validates shared metadata and excludes viewport changes from shared content", () => {
    const board = createBoard();
    board.iconStyle = "architecture";
    board.colorIntensity = 37;
    expect(boardContent({ ...board, viewport: { x: 5, y: 10, zoom: 2 } })).toBe(
      boardContent(board),
    );
    const remote = row(board);
    expect(boardFromRow(remote).inviteCode).toBe(remote.invite_code);
    expect(boardFromRow(remote).iconStyle).toBe("architecture");
    expect(boardFromRow(remote).colorIntensity).toBe(37);
    expect(() => boardFromRow({ ...remote, invite_code: "bad" })).toThrow(
      "invalid board",
    );
  });
});
