import type { Cloud, TextSave } from '../../application/ports';
import { readPage, TextConflictError, validateName, validateText, type TextDropPage } from '../../domain/snippets/model';
import { migrateLegacyAuthStorage, TEXTDROP_AUTH_KEY } from '../auth/sessionStorage';
import { OfflineDatabase } from '../storage/offlineDatabase';

export interface SavedPage {
  page: TextDropPage;
  pending?: { id: string; text: string; at: number; baseVersion?: number; baseText?: string };
  conflict?: TextDropPage;
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
  ...(entry.conflict ? { localConflict: entry.conflict } : {}),
});

/** Cache and upload queue are separate from recovery copies and scoped to the authenticated device. */
export function withOfflinePages(remote: Cloud, database = new OfflineDatabase<SavedPage>('textdrop-offline-v1', owner)): Cloud {
  let synchronizing: Promise<void> | undefined;
  let failures = new Map<string, unknown>();
  async function begin(): Promise<string | null> {
    let identity = await database.owner();
    if (!identity && navigator.onLine && remote.initialize) {
      await remote.initialize();
      identity = await database.owner();
    }
    return identity;
  }
  async function assertOwner(identity: string | null): Promise<void> {
    if ((await database.owner()) !== identity) throw new Error('The device session changed. Pending edits are kept with their original session.');
  }
  async function remember(page: TextDropPage, identity: string | null): Promise<TextDropPage> {
    await assertOwner(identity);
    const clean = readPage(page);
    if (!identity) return clean;
    const entry = await database.change(
      page.code,
      current => ({
        value: {
          ...current,
          page: current && current.page.version > clean.version ? current.page : clean,
          nameInfo: current?.nameInfo && current.nameInfo.version > clean.version ? current.nameInfo : undefined,
        },
        queued: Boolean(current?.pending || current?.pendingName),
      }),
      identity,
    );
    await assertOwner(identity);
    return project(entry);
  }
  async function stage(id: string, text: string, save: TextSave | undefined, identity: string | null): Promise<TextDropPage> {
    await assertOwner(identity);
    if (!identity) throw new Error('Open this snippet online once before editing it offline.');
    const entry = await database.page(id);
    if (!entry) throw new Error('Open this snippet online once before editing it offline.');
    const pending = { id: crypto.randomUUID(), text: validateText(text), at: Date.now() };
    const staged = await database.change(
      entry.page.code,
      current => {
        if (!current) throw new Error('The saved snippet is unavailable. Your draft is kept.');
        const expectedLocal = save?.resolveConflict ? save.localText : save?.baseText;
        if (current.pending && expectedLocal !== undefined && current.pending.text !== text && expectedLocal !== current.pending.text)
          throw new Error('Newer text was saved in another tab. Its queued text is kept. Copy or download your unsaved text, then reopen this snippet to review both versions.');
        const base = save?.resolveConflict ? current.conflict : undefined;
        if (save?.resolveConflict && !base) throw new Error('The conflict changed. Reopen this snippet to review its latest text.');
        if (base && (base.version !== save?.baseVersion || base.text !== save?.baseText)) throw new TextConflictError(base);
        return {
          value: {
            ...current,
            ...(save?.resolveConflict ? { conflict: undefined } : {}),
            pending: {
              ...pending,
              baseVersion: base?.version ?? current.pending?.baseVersion ?? save?.baseVersion ?? current.page.version,
              baseText: base?.text ?? current.pending?.baseText ?? save?.baseText ?? current.page.text,
            },
          },
          queued: true,
        };
      },
      identity,
    );
    await assertOwner(identity);
    return project(staged);
  }
  async function rename(id: string, name: string | null): Promise<TextDropPage> {
    const identity = await database.owner();
    if (!identity) throw new Error('Open this snippet online once before naming it offline.');
    const entry = await database.page(id);
    if (!entry) throw new Error('Open this snippet online once before naming it offline.');
    const pendingName = { id: crypto.randomUUID(), name: validateName(name), at: Date.now() };
    const staged = await database.change(
      entry.page.code,
      current => {
        if (!current) throw new Error('The saved snippet is unavailable. Your name is kept in the dialog.');
        return { value: { ...current, pendingName }, queued: true };
      },
      identity ?? undefined,
    );
    await assertOwner(identity);
    if (navigator.onLine) {
      try {
        await syncPending(id);
      } catch (error) {
        if (!transient(error)) throw error;
      }
    }
    await assertOwner(identity);
    const cached = await database.read(entry.page.code);
    await assertOwner(identity);
    return project(cached ?? staged);
  }
  async function syncPending(targetId?: string): Promise<void> {
    if (!navigator.onLine) return;
    if (!synchronizing) {
      const currentOwner = await database.owner();
      if (!currentOwner) return;
      if (!synchronizing) {
        failures = new Map();
        const work = async () => {
          for (const entry of (await database.all(true)).sort(
            (a, b) => Math.min(a.pending?.at ?? Infinity, a.pendingName?.at ?? Infinity) - Math.min(b.pending?.at ?? Infinity, b.pendingName?.at ?? Infinity),
          )) {
            try {
              let next = await database.read(entry.page.code);
              while ((next?.pending || next?.pendingName) && navigator.onLine) {
                if ((await database.owner()) !== currentOwner) throw new Error('The device session changed. Pending edits are kept with their original session.');
                const nameEdit = next.pendingName;
                const sent = nameEdit ?? next.pending!;
                if (!nameEdit && next.conflict) throw new TextConflictError(next.conflict);
                if (nameEdit && !remote.renamePage) throw new Error('Shared snippet names need a database update.');
                if (!nameEdit && !remote.saveCheckedPage) throw new Error('Checked snippet saves need a database update.');
                const baseVersion = next.pending?.baseVersion ?? next.page.version;
                const baseText = next.pending?.baseText ?? next.page.text;
                const saved = nameEdit
                  ? remote.renameCheckedPage
                    ? await remote.renameCheckedPage(next.page.id, nameEdit.name, next.page)
                    : await remote.renamePage!(next.page.id, nameEdit.name)
                  : await remote.saveCheckedPage!(next.page.id, next.pending!.text, { baseVersion, baseText, operationId: sent.id });
                if ((await database.owner()) !== currentOwner) return;
                next = await database.change(
                  saved.code,
                  current => {
                    let pending = !nameEdit && current?.pending?.id === sent.id ? undefined : current?.pending;
                    const pendingName = nameEdit && current?.pendingName?.id === sent.id ? undefined : current?.pendingName;
                    // A newer local edit was based on the text just acknowledged, not on another device's change.
                    if (!nameEdit && pending && (pending.baseVersion ?? baseVersion) === baseVersion && (pending.baseText ?? baseText) === baseText)
                      pending = { ...pending, baseVersion: saved.version, baseText: saved.text };
                    return {
                      value: {
                        page: current && current.page.version > saved.version ? current.page : readPage(saved),
                        ...(current?.nameInfo && current.nameInfo.version > saved.version ? { nameInfo: current.nameInfo } : {}),
                        ...(pending ? { pending } : {}),
                        ...(pendingName ? { pendingName } : {}),
                        ...(current?.conflict && pending ? { conflict: current.conflict } : {}),
                      },
                      queued: Boolean(pending || pendingName),
                    };
                  },
                  currentOwner,
                );
              }
            } catch (error) {
              if (error instanceof TextConflictError) {
                await database.change(
                  entry.page.code,
                  current => {
                    if (!current) throw error;
                    return { value: { ...current, conflict: error.page }, queued: Boolean(current.pending || current.pendingName) };
                  },
                  currentOwner,
                );
              } else if (!/no longer have access|reached its supported number of saves/.test(error instanceof Error ? error.message : '')) throw error;
              failures.set(entry.page.id, error);
            }
          }
        };
        if (!navigator.locks) throw new Error('Automatic sync needs browser Web Locks. Pending text is safely saved on this device.');
        synchronizing = navigator.locks.request(`textdrop-offline-sync:${currentOwner}`, work).finally(() => {
          synchronizing = undefined;
        });
      }
    }
    await synchronizing;
    const error = targetId ? failures.get(targetId) : failures.values().next().value;
    if (error) throw error;
  }
  async function savePage(id: string, text: string, save?: TextSave): Promise<TextDropPage> {
    const identity = await database.owner();
    const local = await stage(id, text, save, identity);
    await assertOwner(identity);
    if (navigator.onLine) {
      try {
        await syncPending(id);
      } catch (error) {
        if (!transient(error)) throw error;
      }
    }
    await assertOwner(identity);
    const cached = await database.read(local.code);
    await assertOwner(identity);
    return cached ? project(cached) : local;
  }
  return {
    subscribeSync: remote.subscribeSync,
    subscribeChanges: remote.subscribeChanges,
    offlineCapable: true,
    renamePage: rename,
    saveCheckedPage: savePage,
    acceptSharedPage: async (id, localText) => {
      const identity = await database.owner();
      if (!identity) throw new Error('The device session changed. Your text is kept.');
      const entry = await database.page(id);
      if (!entry) throw new Error('The saved snippet is unavailable. Your text is kept.');
      const accepted = await database.change(
        entry.page.code,
        current => {
          if (!current?.conflict || current.pending?.text !== localText) throw new Error('The local text changed in another tab. Reopen the snippet before discarding it.');
          return { value: { ...current, page: current.conflict, pending: undefined, conflict: undefined }, queued: Boolean(current.pendingName) };
        },
        identity,
      );
      await assertOwner(identity);
      return project(accepted);
    },
    listNames: async codes => {
      const currentOwner = await database.owner();
      let names: { code: string; name: string | null; version: number }[] | undefined;
      if (navigator.onLine && remote.listNames) {
        // Report failed online reads so synchronization keeps its retry cadence.
        // The UI retains cached labels; offline reads below still use the cache.
        names = await remote.listNames(codes);
      }
      const cached = (await Promise.all(codes.map(code => database.read(code)))).filter((entry): entry is SavedPage => Boolean(entry));
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
      if ((await database.owner()) !== currentOwner) return [];
      return names.map(row => {
        const entry = cached.find(item => item.page.code === row.code);
        return entry?.pendingName ? { ...row, name: entry.pendingName.name } : row;
      });
    },
    syncPending,
    createPage: async id => {
      const identity = await begin();
      return remember(await remote.createPage(id), identity);
    },
    joinPage: async code => {
      const identity = await begin();
      if (navigator.onLine) {
        try {
          return await remember(await remote.joinPage(code), identity);
        } catch (error) {
          await assertOwner(identity);
          if (!transient(error)) throw error;
        }
      }
      const cached = await database.read(code);
      await assertOwner(identity);
      if (!cached) throw new Error('Open this snippet online once before using it offline.');
      return project(cached);
    },
    pollPage: async (id, known) => {
      if (!navigator.onLine) return null;
      const identity = await database.owner();
      await syncPending(id);
      await assertOwner(identity);
      const cached = await database.page(id);
      await assertOwner(identity);
      const page = await remote.pollPage(id, known);
      await assertOwner(identity);
      return page ? remember(page, identity) : cached && !cached.pending && !cached.pendingName && cached.page.version >= known ? cached.page : null;
    },
    savePage,
    startNewSession: remote.startNewSession,
  };
}
