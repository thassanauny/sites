import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";

type LiveClient = Pick<SupabaseClient, "channel" | "removeChannel">;
const leavingTopics = new WeakMap<LiveClient, Map<string, Promise<void>>>();

/** Private invalidation hints only. Checked collection reads remain authoritative. */
export function watchBoardChanges(client: LiveClient, userId: string, refresh: () => void, revision: (id: string) => number, health: (healthy: boolean) => void = () => {}) {
  let channel: RealtimeChannel | undefined;
  const topic = `blueprint:user:${userId}`;
  let leaving = leavingTopics.get(client);
  if (!leaving) { leaving = new Map(); leavingTopics.set(client, leaving); }
  let stopped = false;
  let waiting = false;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let reconciliation: ReturnType<typeof setTimeout> | undefined;
  let healthy = false;
  const seen = new Map<string, number>();
  const visible = () => !document.hidden && navigator.onLine;
  const arm = () => {
    clearTimeout(reconciliation);
    reconciliation = undefined;
    if (stopped || !visible()) return;
    reconciliation = setTimeout(() => {
      reconciliation = undefined;
      if (visible()) refresh();
      arm();
    }, healthy ? 60_000 : 10_000);
  };
  const setHealth = (next: boolean) => {
    if (healthy === next) return;
    healthy = next;
    health(next);
    arm();
  };
  health(false);
  const schedule = () => {
    if (stopped || !visible() || timer !== undefined) return;
    timer = setTimeout(() => { timer = undefined; if (!stopped && visible()) refresh(); }, 50);
  };
  const disconnect = () => {
    generation++;
    setHealth(false);
    clearTimeout(reconciliation);
    reconciliation = undefined;
    waiting = false;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    const owned = channel;
    channel = undefined;
    if (owned) {
      try {
        const finished = Promise.resolve(client.removeChannel(owned)).then(() => {}, () => {});
        leaving.set(topic, finished);
        void finished.then(() => { if (leaving.get(topic) === finished) leaving.delete(topic); });
      }
      catch { /* Polling remains available when Realtime cleanup fails. */ }
    }
  };
  const connect = () => {
    if (!visible()) { disconnect(); return; }
    if (stopped || channel || waiting) return;
    const current = ++generation;
    waiting = true;
    const start = () => {
      if (current !== generation || stopped) return;
      waiting = false;
      if (!visible()) return;
      try {
        const owned = client.channel(topic, { config: { private: true } });
        channel = owned;
        owned.on("broadcast", { event: "changed" }, ({ payload }: { payload?: { id?: unknown; revision?: unknown } }) => {
          if (stopped || channel !== owned || !payload || typeof payload.id !== "string"
            || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(payload.id)
            || !Number.isSafeInteger(payload.revision) || (payload.revision as number) < 1) return;
          const next = payload.revision as number;
          if (next <= Math.max(revision(payload.id), seen.get(payload.id) ?? 0)) return;
          seen.set(payload.id, next);
          schedule();
        }).subscribe(status => {
          if (stopped || channel !== owned) return;
          setHealth(status === "SUBSCRIBED");
          if (status === "SUBSCRIBED") schedule();
        });
      } catch { disconnect(); arm(); }
    };
    const pending = leaving.get(topic);
    if (pending) void pending.then(start);
    else start();
  };
  const changed = () => { connect(); arm(); if (visible()) schedule(); };
  document.addEventListener("visibilitychange", changed);
  window.addEventListener("online", changed);
  window.addEventListener("offline", changed);
  connect();
  arm();
  return () => {
    stopped = true;
    disconnect();
    document.removeEventListener("visibilitychange", changed);
    window.removeEventListener("online", changed);
    window.removeEventListener("offline", changed);
  };
}
