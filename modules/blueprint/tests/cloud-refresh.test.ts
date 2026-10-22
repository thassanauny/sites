import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { User } from "@supabase/supabase-js";
import { createBoard } from "../src/domain/boards/templates";
import { boardContent } from "../src/domain/boards/codec";
import type { Board } from "../src/domain/boards/types";
import type { useWorkspace } from "../src/application/useWorkspace";
import { useCloudBoards } from "../src/application/useCloudBoards";

// The refresh effect uses refs for concurrency. Capture its lifecycle without
// rendering a canvas; the real watcher, timers and refresh effect run together.
const fixture = vi.hoisted(() => {
  const channels: { status?: (status: string) => void }[] = [];
  const client = {
    channel: vi.fn(() => {
      const entry: { status?: (status: string) => void } = {};
      channels.push(entry);
      const channel = {
        on: vi.fn(() => channel),
        subscribe: vi.fn((callback: (status: string) => void) => { entry.status = callback; return channel; }),
      };
      return channel;
    }),
    removeChannel: vi.fn(async () => "ok"),
  };
  return { effects: [] as (() => void | (() => void))[], channels, client, list: vi.fn(), save: vi.fn(), ready: false };
});
vi.mock("react", () => ({
  useEffect: (effect: () => void | (() => void)) => fixture.effects.push(effect),
  useMemo: (factory: () => unknown) => factory(),
  useRef: (value: unknown) => ({ current: value }),
  useState: (value: unknown) => [value === false && fixture.ready ? true : value, vi.fn()],
}));
vi.mock("../src/infrastructure/cloud/client", () => ({ supabase: fixture.client }));
vi.mock("../src/infrastructure/cloud/boards", () => ({
  listCloudBoards: fixture.list,
  saveCloudBoard: fixture.save,
  joinCloudBoard: vi.fn(),
  messageFor: (error: Error) => error.message,
  SharingUpdateError: class extends Error {},
  CloudConflictError: class extends Error {},
}));
let cleanup: (() => void)[];
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  fixture.effects.length = 0;
  fixture.channels.length = 0;
  fixture.list.mockReset().mockResolvedValue([]);
  fixture.save.mockReset();
  fixture.ready = false;
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("document", Object.assign(new EventTarget(), { hidden: false }));
  vi.stubGlobal("navigator", { onLine: true });
  cleanup = [];
});
afterEach(() => {
  cleanup.reverse().forEach(stop => stop());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function mountRefresh(board = createBoard("blank"), boards: Board[] = []) {
  const workspace = {
    boards, board, cloudDurable: true,
    mergeCloudBoards: vi.fn(), markCloudSaved: vi.fn(), openCloudBoard: vi.fn(),
  } as unknown as ReturnType<typeof useWorkspace>;
  useCloudBoards({ id: "11111111-1111-4111-8111-111111111111" } as User, workspace);
  cleanup = fixture.effects.flatMap(effect => { const stop = effect(); return stop ? [stop] : []; });
}

it("queues one catch-up behind an active read and restores fast reconciliation when live health fails", async () => {
  let release!: (value: []) => void;
  fixture.list.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  mountRefresh();
  expect(fixture.list).toHaveBeenCalledTimes(1);
  const channel = fixture.channels[0];
  channel.status!("SUBSCRIBED");
  await vi.advanceTimersByTimeAsync(50);
  channel.status!("CLOSED");
  await vi.advanceTimersByTimeAsync(10_000);
  expect(fixture.list).toHaveBeenCalledTimes(1);
  release([]);
  await vi.advanceTimersByTimeAsync(0);
  expect(fixture.list).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(9999);
  expect(fixture.list).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1);
  expect(fixture.list).toHaveBeenCalledTimes(3);
  channel.status!("SUBSCRIBED");
  await vi.advanceTimersByTimeAsync(50);
  expect(fixture.list).toHaveBeenCalledTimes(4);
  await vi.advanceTimersByTimeAsync(59_949);
  expect(fixture.list).toHaveBeenCalledTimes(4);
  await vi.advanceTimersByTimeAsync(1);
  expect(fixture.list).toHaveBeenCalledTimes(5);
  cleanup.reverse().forEach(stop => stop());
  cleanup = [];
  await vi.advanceTimersByTimeAsync(60_000);
  expect(fixture.list).toHaveBeenCalledTimes(5);
  expect(vi.getTimerCount()).toBe(0);
});

it("retries failed Data API reads after ten seconds despite healthy live transport and stops retries when hidden", async () => {
  mountRefresh();
  await vi.advanceTimersByTimeAsync(0);
  fixture.list.mockRejectedValueOnce(new Error("Data API unavailable"));
  fixture.channels[0].status!("SUBSCRIBED");
  await vi.advanceTimersByTimeAsync(50);
  expect(fixture.list).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(9999);
  expect(fixture.list).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1);
  expect(fixture.list).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(fixture.list).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(39_950);
  expect(fixture.list).toHaveBeenCalledTimes(4);
  fixture.list.mockRejectedValueOnce(new Error("Data API unavailable again"));
  fixture.channels[0].status!("SUBSCRIBED");
  await vi.advanceTimersByTimeAsync(50);
  expect(fixture.list).toHaveBeenCalledTimes(5);
  Object.assign(document, { hidden: true });
  document.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(60_000);
  expect(fixture.list).toHaveBeenCalledTimes(5);
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps a failed save's ten-second recovery read while live transport stays healthy", async () => {
  fixture.ready = true;
  const board = { ...createBoard("blank"), revision: 1, inviteCode: "a".repeat(32) };
  const dirty = { ...board, title: "Pending save", cloudSavedContent: boardContent(board) };
  fixture.save.mockRejectedValueOnce(new Error("Data API save failed"));
  mountRefresh(dirty, [dirty]);
  fixture.channels[0].status!("SUBSCRIBED");
  await vi.advanceTimersByTimeAsync(700);
  expect(fixture.save).toHaveBeenCalledTimes(1);
  expect(fixture.list).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(9999);
  expect(fixture.list).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1);
  expect(fixture.list).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(fixture.list).toHaveBeenCalledTimes(3);
});

it("uses the existing fast fallback without adding duplicate error-retry reads", async () => {
  fixture.list.mockRejectedValueOnce(new Error("REST and live transport unavailable"));
  mountRefresh();
  await vi.advanceTimersByTimeAsync(0);
  expect(fixture.list).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(fixture.list).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(fixture.list).toHaveBeenCalledTimes(3);
});

it("repairs a failed collection read immediately after a slow successful save consumes its retry", async () => {
  fixture.ready = true;
  const board = { ...createBoard("blank"), revision: 1, inviteCode: "a".repeat(32) };
  const dirty = { ...board, title: "Pending save", cloudSavedContent: boardContent(board) };
  fixture.list.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("Collection read failed"));
  let saved!: (value: { revision: number; inviteCode: string }) => void;
  fixture.save.mockImplementationOnce(() => new Promise(resolve => { saved = resolve; }));
  mountRefresh(dirty, [dirty]);
  fixture.channels[0].status!("SUBSCRIBED");
  await vi.advanceTimersByTimeAsync(700);
  expect(fixture.list).toHaveBeenCalledTimes(2);
  expect(fixture.save).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(9350);
  expect(fixture.list).toHaveBeenCalledTimes(2);
  saved({ revision: 2, inviteCode: board.inviteCode });
  await vi.advanceTimersByTimeAsync(0);
  // No Broadcast was delivered: the consumed retry must survive the upload.
  expect(fixture.list).toHaveBeenCalledTimes(3);
  expect(fixture.save).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(49_949);
  expect(fixture.list).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(1);
  expect(fixture.list).toHaveBeenCalledTimes(4);
});
