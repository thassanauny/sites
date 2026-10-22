import { boardContent, cleanDiagram } from "./codec";
import { mergeBoardContent, sameBoardContent } from "./merge";
import type { Board, Diagram } from "./types";

export type HistoryEntry = Diagram & Pick<Board, "iconStyle" | "colorIntensity">;
export function historyEntry(board: Board): HistoryEntry {
  return { ...cleanDiagram(board), iconStyle: board.iconStyle, colorIntensity: board.colorIntensity };
}

/** Carry accepted collaborator changes into snapshots before undo can restore them. */
export function rebaseHistory(before: Board, after: Board, past: HistoryEntry[], future: HistoryEntry[]) {
  if (!past.length && !future.length) return { past, future };
  if (before.id === after.id && sameBoardContent(before, after)) return { past, future };
  if (before.id !== after.id) return { past: [], future: [] };
  const base = boardContent(before);
  const rebase = (entries: HistoryEntry[]) => entries.map(entry => {
    const merged = mergeBoardContent(base, { ...before, ...entry }, after);
    return merged && historyEntry(merged);
  });
  const previous = rebase(past), next = rebase(future);
  // Overlapping history cannot be replayed without reverting another person's work.
  return previous.every(entry => entry !== undefined) && next.every(entry => entry !== undefined)
    ? { past: previous as HistoryEntry[], future: next as HistoryEntry[] }
    : { past: [], future: [] };
}
