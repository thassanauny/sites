import type { SupabaseClient } from "@supabase/supabase-js";
import type { Board } from "../../domain/boards/types";
import { boardContent, parseBoard } from "../../domain/boards/codec";
import { invitationCode } from "../../domain/sharing/invitations";

export async function listCloudBoards(
  client: SupabaseClient,
  known: readonly Board[] = [],
): Promise<Board[]> {
  const { data, error } = await client.rpc("blueprint_sync_boards", {
    p_known: Object.fromEntries(
      known
        .filter(
          (board) =>
            board.revision > 0 && board.inviteCode && board.cloudSavedContent,
        )
        .map((board) => [board.id, board.revision]),
    ),
  });
  if (error) {
    if (["PGRST202", "42883"].includes(error.code)) throw new SharingUpdateError();
    throw error;
  }
  if (data?.sharing_version !== 2) throw new SharingUpdateError();
  if (!Array.isArray(data.heads) || !Array.isArray(data.boards))
    throw new Error("The server returned an invalid board list.");
  const held = new Map(known.map((board) => [board.id, board]));
  const downloaded = new Map<string, Board>();
  for (const row of data.boards) {
    const board = boardFromRow(row);
    if (downloaded.has(board.id))
      throw new Error("The server returned duplicate boards.");
    downloaded.set(board.id, board);
  }
  const seen = new Set<string>();
  const result: Board[] = data.heads.map(
    (head: { id: string; revision: number }) => {
      if (
        !head ||
        typeof head.id !== "string" ||
        seen.has(head.id) ||
        !Number.isSafeInteger(head.revision) ||
        head.revision < 1
      )
        throw new Error("The server returned invalid board revisions.");
      seen.add(head.id);
      const board = downloaded.get(head.id) || held.get(head.id);
      if (!board || board.revision !== head.revision)
        throw new Error(
          "A changed board is missing from the server response.",
        );
      return board;
    },
  );
  if ([...downloaded.keys()].some((id) => !seen.has(id)))
    throw new Error("The server returned an unexpected board.");
  return result;
}

export async function joinCloudBoard(
  client: SupabaseClient,
  input: string,
): Promise<Board> {
  const { data, error } = await client.rpc("blueprint_join_board", {
    p_code: invitationCode(input),
  });
  if (error) throw new Error(messageFor(error));
  return boardFromRow(data);
}

type CloudRow = {
  id: string;
  title: string;
  document: Record<string, unknown>;
  revision: number;
  updated_at: string;
  invite_code: string;
  sharing_version: number;
};
export type SavedBoard = {
  revision: number;
  inviteCode: string;
};

export const SHARING_UPDATE =
  "Cloud sharing needs an update. Follow Blueprint’s database setup guide, including rename-to-blueprint.sql for an existing installation, then retry.";
export class SharingUpdateError extends Error {
  constructor() {
    super(SHARING_UPDATE);
  }
}

export function boardFromRow(row: CloudRow): Board {
  if (row?.sharing_version !== 2) throw new SharingUpdateError();
  if (
    !row ||
    !/^[a-f0-9]{32}$/.test(row.invite_code) ||
    !Number.isInteger(row.revision) ||
    row.revision < 1
  )
    throw new Error("The server returned an invalid board.");
  const imported = parseBoard(
    JSON.stringify({
      format: "blueprint-board",
      version: 1,
      board: { ...row.document, title: row.title },
    }),
  );
  const board: Board = {
    ...imported,
    id: row.id,
    revision: row.revision,
    updatedAt: row.updated_at,
    inviteCode: row.invite_code,
  };
  board.cloudSavedContent = boardContent(board);
  return board;
}

export class CloudConflictError extends Error {
  constructor(
    message = "This board changed elsewhere or is no longer accessible. Save a new copy to keep your changes.",
  ) {
    super(message);
  }
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  return JSON.stringify(value);
}

export async function saveCloudBoard(
  client: SupabaseClient,
  board: Board,
  options: { force?: boolean } = {},
): Promise<SavedBoard> {
  const { title, ...document } = JSON.parse(boardContent(board));
  if (!board.revision) {
    const { data, error } = await client.rpc("blueprint_create_board", {
      p_id: board.id,
      p_title: title,
      p_document: document,
    });
    if (error) throw error;
    const validated = boardFromRow(data);
    // A lost create response may be retried after more local edits. Never acknowledge different server content.
    if (
      stable({ title: data.title, ...data.document }) !==
      stable({ title, ...document })
    )
      throw new CloudConflictError();
    return {
      revision: validated.revision,
      inviteCode: validated.inviteCode!,
    };
  }
  let request = client.from("blueprint_boards").update({ title, document }).eq("id", board.id);
  // Explicit conflict resolution replaces the document while retaining server access checks.
  if (!options.force) request = request.eq("revision", board.revision);
  const { data, error } = await request.select("revision").maybeSingle();
  if (error) throw error;
  if (!data) throw new CloudConflictError(options.force ? "This board is no longer accessible. Your local changes are safe; save a new board to keep them." : undefined);
  return {
    revision: data.revision,
    inviteCode: board.inviteCode!,
  };
}

export function messageFor(error: unknown): string {
  const value = error as { code?: string; message?: string };
  if (["PGRST202", "42P01", "42883"].includes(value?.code || ""))
    return "Sharing setup is not installed yet. Apply the Blueprint database migrations, then retry.";
  return (
    value?.message ||
    "Cloud access failed. Your draft is still saved in this browser."
  );
}
