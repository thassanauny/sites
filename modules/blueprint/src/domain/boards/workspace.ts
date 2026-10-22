import type { Board } from "./types";
import { boardContent } from "./codec";
import { mergeBoardContent, mergeCloudBoard, sameBoardContent } from "./merge";

export type WorkspaceData = { boards: Board[]; activeId: string };

/** Merge another tab's durable snapshot; competing moves use its persisted position. */
export function mergeDeviceWorkspace(base: WorkspaceData, local: WorkspaceData, latest: WorkspaceData): WorkspaceData | undefined {
  const original = new Map(base.boards.map(board => [board.id, board]));
  const theirs = new Map(latest.boards.map(board => [board.id, board]));
  const boards: Board[] = [];
  for (const ours of local.boards) {
    const other = theirs.get(ours.id);
    const before = original.get(ours.id);
    theirs.delete(ours.id);
    if (!other) {
      if (!before || !sameBoardContent(before, ours)) boards.push(ours);
      continue;
    }
    const merged = sameBoardContent(ours, other) ? ours
      : before ? mergeBoardContent(boardContent(before), ours, other) : undefined;
    if (!merged) return;
    const metadata = other.revision > ours.revision ? other : ours;
    boards.push({ ...merged, revision: metadata.revision, cloudSavedContent: metadata.cloudSavedContent, inviteCode: metadata.inviteCode });
  }
  // A stale tab must retain boards added or edited elsewhere. Device removal is
  // a separate durable preference and never deletes shared drafts.
  boards.push(...[...theirs.values()].filter(board => {
    const before = original.get(board.id);
    return !before || board.revision > before.revision || !sameBoardContent(before, board);
  }));
  return { boards, activeId: boards.some(board => board.id === local.activeId) ? local.activeId : boards[0]?.id || "" };
}

/** Remote refreshes merge drafts, resolve competing moves and retain local viewports. */
export function mergeWorkspace(
  previous: WorkspaceData,
  remoteBoards: Board[],
  replaceStarter: boolean,
): WorkspaceData {
  if (replaceStarter)
    return { boards: remoteBoards, activeId: remoteBoards[0]?.id || "" };
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
      merged.push(mergeCloudBoard(local, cloud));
      remote.delete(local.id);
    } else if (!local.revision || !clean) merged.push(local);
  }
  merged.push(...remote.values());
  if (
    merged.length === previous.boards.length &&
    merged.every((board, index) => board === previous.boards[index])
  )
    return previous;
  return {
    boards: merged,
    activeId: merged.some((item) => item.id === previous.activeId)
      ? previous.activeId
      : merged[0]?.id || "",
  };
}

export function openWorkspaceBoard(
  previous: WorkspaceData,
  remote: Board,
  replaceStarter: boolean,
): WorkspaceData {
  const local = previous.boards.find((item) => item.id === remote.id);
  const chosen = local && local.revision > 0 ? mergeCloudBoard(local, remote) : remote;
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
