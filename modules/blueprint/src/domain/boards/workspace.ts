import type { Board } from "./types";
import { boardContent } from "./codec";
import { createBoard } from "./templates";

export type WorkspaceData = { boards: Board[]; activeId: string };

/** Remote refreshes replace clean documents and retain every unsaved edit and local viewport. */
export function mergeWorkspace(
  previous: WorkspaceData,
  remoteBoards: Board[],
  replaceStarter: boolean,
): WorkspaceData {
  if (replaceStarter)
    return { boards: remoteBoards, activeId: remoteBoards[0].id };
  const remote = new Map(remoteBoards.map((item) => [item.id, item]));
  const merged: Board[] = [];
  for (const local of previous.boards) {
    const cloud = remote.get(local.id);
    if (cloud === local) {
      merged.push(local);
      remote.delete(local.id);
      continue;
    }
    const clean = local.cloudSavedContent === boardContent(local);
    if (cloud) {
      merged.push(
        clean && cloud.revision >= local.revision
          ? { ...cloud, viewport: local.viewport }
          : { ...local, inviteCode: cloud.inviteCode },
      );
      remote.delete(local.id);
    } else if (!local.revision || !clean) merged.push(local);
  }
  merged.push(...remote.values());
  if (!merged.length) merged.push(createBoard("blank"));
  if (
    merged.length === previous.boards.length &&
    merged.every((board, index) => board === previous.boards[index])
  )
    return previous;
  return {
    boards: merged,
    activeId: merged.some((item) => item.id === previous.activeId)
      ? previous.activeId
      : merged[0].id,
  };
}

export function openWorkspaceBoard(
  previous: WorkspaceData,
  remote: Board,
  replaceStarter: boolean,
): WorkspaceData {
  const local = previous.boards.find((item) => item.id === remote.id);
  const chosen =
    local &&
    local.revision > 0 &&
    boardContent(local) !== local.cloudSavedContent
      ? { ...local, inviteCode: remote.inviteCode }
      : remote;
  return {
    boards: [
      chosen,
      ...(replaceStarter
        ? []
        : previous.boards.filter((item) => item.id !== remote.id)),
    ],
    activeId: remote.id,
  };
}
