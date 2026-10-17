import type { Cloud } from '../../application/ports';
import { readPage, validateName, validateText, type TextDropPage } from '../../domain/snippets/model';
import { migrateLegacyAuthStorage, TEXTDROP_AUTH_KEY } from '../auth/sessionStorage';
import { OfflineDatabase } from '../storage/offlineDatabase';

export interface SavedPage {
  page: TextDropPage;
  pending?: { id: string; text: string; at: number };
  pendingName?: { id: string; name: string | null; at: number };
  nameInfo?: { name: string | null; version: number };
}

async function owner(): Promise<string | null> {
  await migrateLegacyAuthStorage();
  const raw = localStorage.getItem(TEXTDROP_AUTH_KEY);
  if (!raw) return null;
  const value = JSON.parse(raw);
  return typeof value.user?.id === 'string' ? value.user.id : null;
}

const transient = (error: unknown) => /network|connection|fetch|offline|timed? ?out|took too long|abort/i.test(error instanceof Error ? error.message : '');
const project = (entry: SavedPage): TextDropPage => ({
  ...entry.page,
  ...(entry.nameInfo && entry.nameInfo.version >= entry.page.version ? { name: entry.nameInfo.name } : {}),
  ...(entry.pending ? { text: entry.pending.text } : {}),
  ...(entry.pendingName ? { name: entry.pendingName.name } : {}),
  ...(entry.pending || entry.pendingName ? { localPending: true } : {}),
});

/** Cache and upload queue are separate from recovery copies and scoped to the authenticated device. */
export function withOfflinePages(remote: Cloud, database = new OfflineDatabase<SavedPage>('textdrop-offline-v1', owner)): Cloud {
  let synchronizing: Promise<void> | undefined;
  async function remember(page: TextDropPage): Promise<TextDropPage> {
    const clean = readPage(page);
    if (!(await database.owner())) return clean;
    const entry = await database.change(page.code, current => ({
      value: {
        ...current,
        page: current && current.page.version > clean.version ? current.page : clean,
        nameInfo: current?.nameInfo && current.nameInfo.version > clean.version ? current.nameInfo : undefined,
      },
      queued: Boolean(current?.pending || current?.pendingName),
    }));
    return project(entry);
  }
  async function stage(id: string, text: string): Promise<TextDropPage> {
    const entry = (await database.all()).find(item => item.page.id === id);
    if (!entry) throw new Error('Open this snippet online once before editing it offline.');
    const pending = { id: crypto.randomUUID(), text: validateText(text), at: Date.now() };
    return project(
      await database.change(entry.page.code, current => {
        if (!current) throw new Error('The saved snippet is unavailable. Your draft is kept.');
        return { value: { ...current, pending }, queued: true };
      }),
    );
  }
  async function rename(id: string, name: string | null): Promise<TextDropPage> {
    const entry = (await database.all()).find(item => item.page.id === id);
    if (!entry) throw new Error('Open this snippet online once before naming it offline.');
    const pendingName = { id: crypto.randomUUID(), name: validateName(name), at: Date.now() };
    const staged = await database.change(entry.page.code, current => {
      if (!current) throw new Error('The saved snippet is unavailable. Your name is kept in the dialog.');
      return { value: { ...current, pendingName }, queued: true };
    });
    if (navigator.onLine) {
      try {
        await syncPending();
      } catch (error) {
        if (!transient(error)) throw error;
      }
    }
    return project((await database.read(entry.page.code)) ?? staged);
  }
  async function syncPending(): Promise<void> {
    if (!navigator.onLine) return;
    if (synchronizing) return synchronizing;
    const currentOwner = await database.owner();
    if (!currentOwner) return;
    const work = async () => {
      for (const entry of (await database.all(true)).sort(
        (a, b) => Math.min(a.pending?.at ?? Infinity, a.pendingName?.at ?? Infinity) - Math.min(b.pending?.at ?? Infinity, b.pendingName?.at ?? Infinity),
      )) {
        let next: SavedPage | undefined = await database.read(entry.page.code);
        while ((next?.pending || next?.pendingName) && navigator.onLine) {
          if ((await database.owner()) !== currentOwner) throw new Error('The device session changed. Pending edits are kept with their original session.');
          const nameEdit = next.pendingName;
          const sent = nameEdit ?? next.pending!;
          if (nameEdit && !remote.renamePage) throw new Error('Shared snippet names need a database update.');
          const saved = nameEdit ? await remote.renamePage!(next.page.id, nameEdit.name) : await remote.savePage(next.page.id, next.pending!.text);
          if ((await database.owner()) !== currentOwner) return;
          next = await database.change(
            saved.code,
            current => {
              const pending = !nameEdit && current?.pending?.id === sent.id ? undefined : current?.pending;
              const pendingName = nameEdit && current?.pendingName?.id === sent.id ? undefined : current?.pendingName;
              return {
                value: {
                  page: current && current.page.version > saved.version ? current.page : readPage(saved),
                  ...(current?.nameInfo && current.nameInfo.version > saved.version ? { nameInfo: current.nameInfo } : {}),
                  ...(pending ? { pending } : {}),
                  ...(pendingName ? { pendingName } : {}),
                },
                queued: Boolean(pending || pendingName),
              };
            },
            currentOwner,
          );
        }
      }
    };
    if (!navigator.locks) throw new Error('Automatic sync needs browser Web Locks. Pending text is safely saved on this device.');
    synchronizing = navigator.locks.request(`textdrop-offline-sync:${currentOwner}`, work).finally(() => {
      synchronizing = undefined;
    });
    return synchronizing;
  }
  return {
    subscribeSync: remote.subscribeSync,
    offlineCapable: true,
    renamePage: rename,
    listNames: async codes => {
      const currentOwner = await database.owner();
      let names: { code: string; name: string | null; version: number }[] | undefined;
      if (navigator.onLine && remote.listNames) {
        try {
          names = await remote.listNames(codes);
        } catch (error) {
          if (!transient(error)) throw error;
        }
      }
      const cached = (await database.all()).filter(entry => codes.includes(entry.page.code));
      if ((await database.owner()) !== currentOwner) return [];
      if (names && currentOwner)
        for (const row of names) {
          if (!cached.some(entry => entry.page.code === row.code)) continue;
          await database.change(
            row.code,
            entry => {
              if (!entry) throw new Error('The saved snippet is unavailable.');
              const nameInfo = row.version >= Math.max(entry.page.version, entry.nameInfo?.version ?? 0) ? { name: row.name, version: row.version } : entry.nameInfo;
              return { value: { ...entry, nameInfo }, queued: Boolean(entry.pending || entry.pendingName) };
            },
            currentOwner,
          );
        }
      names ??= cached.map(entry => ({ code: entry.page.code, name: project(entry).name ?? null, version: Math.max(entry.page.version, entry.nameInfo?.version ?? 0) }));
      return names.map(row => {
        const entry = cached.find(item => item.page.code === row.code);
        return entry?.pendingName ? { ...row, name: entry.pendingName.name } : row;
      });
    },
    stagePage: stage,
    syncPending,
    createPage: async id => remember(await remote.createPage(id)),
    joinPage: async code => {
      if (navigator.onLine) {
        try {
          return await remember(await remote.joinPage(code));
        } catch (error) {
          if (!transient(error)) throw error;
        }
      }
      const cached = await database.read(code);
      if (!cached) throw new Error('Open this snippet online once before using it offline.');
      return project(cached);
    },
    pollPage: async (id, known) => {
      if (!navigator.onLine) return null;
      await syncPending();
      const cached = (await database.all()).find(item => item.page.id === id);
      const page = await remote.pollPage(id, known);
      return page ? remember(page) : cached && !cached.pending && !cached.pendingName && cached.page.version >= known ? cached.page : null;
    },
    savePage: async (id, text) => {
      const local = await stage(id, text);
      if (navigator.onLine) {
        try {
          await syncPending();
        } catch (error) {
          if (!transient(error)) throw error;
        }
      }
      const cached = await database.read(local.code);
      return cached ? project(cached) : local;
    },
    startNewSession: remote.startNewSession,
  };
}
