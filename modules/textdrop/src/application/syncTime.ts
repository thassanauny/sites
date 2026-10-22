import type { RemoteCloud } from './ports';

/** Observe confirmed remote operations before the offline cache can supply a fallback. */
export function withSyncTime(remote: RemoteCloud): RemoteCloud {
  let lastSync: Date | undefined;
  const listeners = new Set<(at: Date) => void>();
  function track<Args extends unknown[], Result>(operation: (...args: Args) => Promise<Result>) {
    return async (...args: Args): Promise<Result> => {
      const result = await operation(...args);
      lastSync = new Date();
      for (const listener of listeners) listener(lastSync);
      return result;
    };
  }
  return {
    ...remote,
    subscribeSync(listener) {
      listeners.add(listener);
      if (lastSync) listener(lastSync);
      return () => {
        listeners.delete(listener);
      };
    },
    createPage: track(remote.createPage),
    joinPage: track(remote.joinPage),
    pollPage: track(remote.pollPage),
    saveCheckedPage: track(remote.saveCheckedPage),
    renameCheckedPage: track(remote.renameCheckedPage),
    listNames: (codes: string[]) => (codes.length ? track(remote.listNames)(codes) : remote.listNames(codes)),
  };
}
