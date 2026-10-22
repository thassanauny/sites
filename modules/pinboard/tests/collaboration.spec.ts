import { readFile } from 'node:fs/promises';
import { expect, test as base, type Page } from '@playwright/test';
import type { Entry } from '../src/infrastructure/cloud/offlineBoards';
import { cardId, createCloud, type LocalCloud, users } from './support/cloud';

const test = base.extend<{ cloud: LocalCloud; pair: { a: Page; b: Page } }>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright requires a destructured fixture argument.
  cloud: async ({}, use) => {
    const cloud = await createCloud();
    try {
      await use(cloud);
    } finally {
      await cloud.close();
    }
    expect(cloud.unhandled).toEqual([]);
  },
  pair: async ({ browser, cloud }, use) => {
    const creator = await browser.newContext();
    const collaborator = await browser.newContext();
    await cloud.attach(creator, users.creator);
    await cloud.attach(collaborator, users.collaborator);
    const a = await creator.newPage();
    const b = await collaborator.newPage();
    try {
      await a.goto('/');
      await a.getByRole('button', { name: 'Open Shared project', exact: true }).click();
      await b.goto(`/#board/${cloud.original.invite_code}`);
      await expect(b.getByRole('dialog', { name: 'Join a board.' })).toBeVisible();
      expect(await cloud.members()).toEqual([users.creator]);
      await b.getByRole('button', { name: 'Join board', exact: true }).click();
      await expect(a.getByRole('button', { name: 'Edit First task', exact: true })).toBeVisible();
      await expect(b.getByRole('button', { name: 'Edit First task', exact: true })).toBeVisible();
      await expect
        .poll(() => cloud.subscriptions())
        .toEqual(expect.arrayContaining([users.creator, users.collaborator]));
      await use({ a, b });
    } finally {
      cloud.releaseAll();
      await creator.close();
      await collaborator.close();
    }
  },
});

function tile(page: Page) {
  return page.locator(`[data-card-id="${cardId}"]`);
}
async function edit(page: Page) {
  await tile(page)
    .getByRole('button', { name: /^Edit / })
    .click();
  await expect(page.getByRole('dialog', { name: 'Card details' })).toBeVisible();
}
async function openReview(page: Page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Compare board versions', exact: true }).click();
}
async function saved(page: Page) {
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
async function cached(page: Page, owner: string, boardId: string): Promise<Entry> {
  return page.evaluate(
    async ({ owner, boardId }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(`pinboard-offline-v1:${owner}`, 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        return await new Promise<Entry>((resolve, reject) => {
          const request = database.transaction('records').objectStore('records').get(boardId);
          request.onsuccess = () => resolve(request.result?.value);
          request.onerror = () => reject(request.error);
        });
      } finally {
        database.close();
      }
    },
    { owner, boardId },
  );
}

test('two identities join explicitly, preserve simultaneous fields and converge on the last accepted same-field edit', async ({
  cloud,
  pair: { a, b },
}) => {
  expect(await cloud.members()).toEqual(
    expect.arrayContaining([users.creator, users.collaborator]),
  );
  expect(cloud.joins).toEqual([users.collaborator]);
  await expect(
    b.getByRole('button', { name: 'Open Independent project', exact: true }),
  ).toHaveCount(0);
  const privateRead = await b.evaluate(async (id) => {
    const auth = JSON.parse(localStorage.getItem('pinboard-auth')!);
    return fetch(
      `https://pinboard-test.supabase.co/rest/v1/pinboard_board_documents?select=id,invite_code,title,description,columns,cards,revision,created_at,updated_at,card_fields&id=in.(${id})`,
      { headers: { authorization: `Bearer ${auth.access_token}`, apikey: 'sb_publishable_test' } },
    ).then((response) => response.json());
  }, cloud.independentId);
  expect(privateRead).toEqual([]);

  await Promise.all([edit(a), edit(b)]);
  await a.getByLabel('Card title', { exact: true }).fill('Creator title');
  await b.getByLabel('Description').fill('Collaborator description');
  const first = cloud.hold(users.creator);
  const second = cloud.hold(users.collaborator);
  await Promise.all([
    a.getByRole('button', { name: 'Save', exact: true }).click(),
    b.getByRole('button', { name: 'Save', exact: true }).click(),
  ]);
  await expect.poll(() => [first.arrived, second.arrived]).toEqual([1, 1]);
  first.release();
  await saved(a);
  second.release();
  await saved(b);
  expect((await cloud.board()).cards.find((card) => card.id === cardId)).toMatchObject({
    title: 'Creator title',
    description: 'Collaborator description',
  });
  for (const page of [a, b]) {
    await expect(tile(page)).toContainText('Creator title');
    await expect(tile(page)).toContainText('Collaborator description');
  }
  expect(cloud.writes.map((write) => write.operation)).toEqual([
    { type: 'update_card', id: cardId, patch: { title: 'Creator title' } },
    { type: 'update_card', id: cardId, patch: { description: 'Collaborator description' } },
  ]);

  await Promise.all([edit(a), edit(b)]);
  await a.getByLabel('Card title', { exact: true }).fill('Accepted last');
  await b.getByLabel('Card title', { exact: true }).fill('Accepted first');
  const last = cloud.hold(users.creator);
  const earlier = cloud.hold(users.collaborator);
  await Promise.all([
    a.getByRole('button', { name: 'Save', exact: true }).click(),
    b.getByRole('button', { name: 'Save', exact: true }).click(),
  ]);
  await expect.poll(() => [last.arrived, earlier.arrived]).toEqual([1, 1]);
  earlier.release();
  await saved(b);
  last.release();
  await saved(a);
  expect((await cloud.board()).cards.find((card) => card.id === cardId)?.title).toBe(
    'Accepted last',
  );
  await expect(tile(b)).toContainText('Accepted last');
  await expect(tile(a)).toContainText('Accepted last');
  for (const [page, owner] of [
    [a, users.creator],
    [b, users.collaborator],
  ] as const) {
    const names = await page.evaluate(async () =>
      (await indexedDB.databases()).map((database) => database.name),
    );
    expect(names).toEqual([`pinboard-offline-v1:${owner}`]);
    expect((await cached(page, owner, cloud.boardId)).pending).toEqual([]);
  }
});

test('offline ordered edits survive a reconnect reload and retain another identity’s fields', async ({
  cloud,
  pair: { a, b },
}) => {
  await a.context().setOffline(true);
  await edit(a);
  await a.getByLabel('Card title', { exact: true }).fill('Offline first');
  await a.getByRole('button', { name: 'Save', exact: true }).click();
  await saved(a);
  await edit(a);
  await a.getByLabel('Card title', { exact: true }).fill('Offline second');
  await a.getByRole('button', { name: 'Save', exact: true }).click();
  await saved(a);
  const queued = await cached(a, users.creator, cloud.boardId);
  expect(queued.pending.map((change) => change.operation)).toEqual([
    { type: 'update_card', id: cardId, patch: { title: 'Offline first' } },
    { type: 'update_card', id: cardId, patch: { title: 'Offline second' } },
  ]);
  await edit(b);
  await b.getByLabel('Description').fill('Changed while the creator was offline');
  await b.getByRole('button', { name: 'Save', exact: true }).click();
  await saved(b);

  const held = cloud.hold(users.creator, 'request', 10);
  await a.context().setOffline(false);
  await expect.poll(() => held.arrived).toBeGreaterThan(0);
  await a.reload();
  expect(
    (await cached(a, users.creator, cloud.boardId)).pending.map((change) => change.id),
  ).toEqual(queued.pending.map((change) => change.id));
  held.release();
  await expect(tile(a)).toContainText('Offline second');
  await expect(tile(a)).toContainText('Changed while the creator was offline');
  await expect(tile(b)).toContainText('Offline second');
  await expect
    .poll(async () => (await cached(a, users.creator, cloud.boardId)).pending.length)
    .toBe(0);
  expect((await cloud.board()).cards.find((card) => card.id === cardId)).toMatchObject({
    title: 'Offline second',
    description: 'Changed while the creator was offline',
  });
});

test('a lost upload response retains a newer tab edit without replaying over a collaborator', async ({
  cloud,
  pair: { a, b },
}) => {
  const anotherTab = await a.context().newPage();
  await anotherTab.goto(`/#board/${cloud.original.invite_code}`);
  await expect(tile(anotherTab)).toBeVisible();
  // Open before the first editor creates a recovery copy: the second edit must
  // change only priority rather than explicitly resaving a recovered title too.
  await edit(anotherTab);
  const reply = cloud.hold(users.creator, 'response', 1, true);
  await edit(a);
  await a.getByLabel('Card title', { exact: true }).fill('Accepted before the reply was lost');
  await a.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => reply.arrived).toBe(1);

  await expect(tile(b)).toContainText('Accepted before the reply was lost');
  await edit(b);
  await b.getByLabel('Card title', { exact: true }).fill('Collaborator’s newer title');
  await b.getByRole('button', { name: 'Save', exact: true }).click();
  await saved(b);
  await anotherTab.getByRole('dialog').getByLabel('Priority').selectOption('high');
  await anotherTab.getByRole('button', { name: 'Save', exact: true }).click();
  await expect
    .poll(async () => (await cached(anotherTab, users.creator, cloud.boardId)).pending.length)
    .toBe(2);
  const queued = await cached(anotherTab, users.creator, cloud.boardId);
  expect(queued.pending[1]!.operation).toEqual({
    type: 'update_card',
    id: cardId,
    patch: { priority: 'high' },
  });
  reply.release();
  await saved(a);
  await saved(anotherTab);
  await expect
    .poll(async () => (await cached(a, users.creator, cloud.boardId)).pending.length)
    .toBe(0);
  const final = (await cloud.board()).cards.find((card) => card.id === cardId)!;
  expect(final).toMatchObject({ title: 'Collaborator’s newer title', priority: 'high' });
  const creatorWrites = cloud.writes.filter((write) => write.user === users.creator);
  expect(
    creatorWrites.filter((write) => write.operationId === queued.pending[0]!.id).length,
  ).toBeGreaterThanOrEqual(2);
  expect(new Set(creatorWrites.map((write) => write.operationId))).toEqual(
    new Set(queued.pending.map((change) => change.id)),
  );
  await expect(tile(a)).toContainText('Collaborator’s newer title');
  await expect(tile(anotherTab)).toContainText('Collaborator’s newer title');
  await expect(tile(b)).toContainText('high priority');
});

for (const order of ['queued first', 'cached deletion first'] as const)
  for (const width of [1440, 390]) {
    test(`deleted-card recovery is durable (${order}, ${width}px)`, async ({
      cloud,
      pair: { a, b },
    }, testInfo) => {
      await a.setViewportSize({ width, height: width === 390 ? 844 : 960 });
      const title = '  Keep this deleted-card draft  ';
      const description = '  Exact editor text\nincluding trailing spaces  ';
      const exactDraft = {
        ...cloud.original.cards.find((card) => card.id === cardId)!,
        title,
        description,
      };
      const checkDownload = async (label: string) => {
        const download = a.waitForEvent('download');
        await a.getByRole('button', { name: label, exact: true }).click();
        const path = await (await download).path();
        expect(
          JSON.parse(await readFile(path!, 'utf8')).cards.find(
            (card: { id: string }) => card.id === cardId,
          ),
        ).toEqual(exactDraft);
      };
      await edit(a);
      await a.getByLabel('Card title', { exact: true }).fill(title);
      await a.getByLabel('Description').fill(description);
      const reads = cloud.hold(users.creator, 'read', Number.POSITIVE_INFINITY);
      const deletion = cloud.hold(users.collaborator, 'request');
      await edit(b);
      await b.getByRole('button', { name: 'Delete', exact: true }).click();
      await b.getByRole('button', { name: 'Confirm delete', exact: true }).click();
      await expect.poll(() => deletion.arrived).toBe(1);
      expect(
        (await cached(a, users.creator, cloud.boardId)).board?.cards.some(
          (card) => card.id === cardId,
        ),
      ).toBe(true);
      deletion.release();
      await saved(b);
      await expect.poll(() => reads.arrived).toBeGreaterThan(0);
      if (order === 'cached deletion first') {
        reads.release();
        await expect
          .poll(async () =>
            (await cached(a, users.creator, cloud.boardId)).board?.cards.some(
              (card) => card.id === cardId,
            ),
          )
          .toBe(false);
        await expect(a.getByRole('region', { name: 'Deleted card recovery' })).toBeVisible();
      }
      await a.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(a.getByRole('dialog').getByRole('alert')).toContainText('That card was removed');
      await expect(a.getByLabel('Card title', { exact: true })).toHaveValue(title);
      await expect(a.getByLabel('Description')).toHaveValue(description);
      const retained = await cached(a, users.creator, cloud.boardId);
      expect(retained.pending).toHaveLength(order === 'queued first' ? 1 : 0);
      if (order === 'cached deletion first') {
        expect(retained.unappliedBackupId).toBeTruthy();
        expect(cloud.writes.filter((write) => write.user === users.creator)).toEqual([]);
      } else reads.release();
      await checkDownload('Download card draft');
      await a.keyboard.press('Escape');
      await expect(a.getByRole('dialog', { name: 'Discard this draft?' })).toBeVisible();
      await a.getByRole('button', { name: 'Keep draft', exact: true }).click();
      await expect(a.getByLabel('Card title', { exact: true })).toHaveValue(title);
      await a.reload();
      await openReview(a);
      await expect(a.locator('.comparison-local').filter({ hasText: title })).toHaveCount(1);
      await expect(
        a.locator('.comparison-shared').filter({ hasText: 'Keep this deleted-card draft' }),
      ).toHaveCount(0);
      await expect(
        a.getByRole('button', { name: 'Retry reviewed edits', exact: true }),
      ).toHaveCount(0);
      if (order === 'cached deletion first')
        await expect(a.getByRole('dialog')).toContainText('could not be queued');
      await expect(
        a.getByRole('button', { name: 'Download local draft', exact: true }),
      ).toHaveCount(0);
      await expect(
        a.getByRole('button', { name: 'Force sync my changes', exact: true }),
      ).toBeEnabled();
      expect(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await a.screenshot({ path: testInfo.outputPath('deleted-card-review.png') });
      await b.getByRole('button', { name: 'Edit Second task', exact: true }).click();
      await b.getByLabel('Description').fill('Shared work after review opened');
      await b.getByRole('button', { name: 'Save', exact: true }).click();
      await saved(b);
      await a.getByRole('button', { name: 'Use shared board', exact: true }).click();
      await expect(a.getByRole('dialog').getByRole('alert')).toContainText(
        'The shared board changed',
      );
      expect(
        (await cached(a, users.creator, cloud.boardId)).pending.map((change) => change.id),
      ).toEqual(retained.pending.map((change) => change.id));
      expect((await cached(a, users.creator, cloud.boardId)).unappliedBackupId).toBe(
        retained.unappliedBackupId,
      );
      await a.keyboard.press('Escape');
      await a.getByRole('button', { name: 'Open workspace', exact: true }).click();
      await a.getByRole('button', { name: 'Open Independent project', exact: true }).click();
      await a
        .getByRole('region', { name: 'To do', exact: true })
        .getByRole('button', { name: 'Add a card', exact: true })
        .click();
      await a.getByLabel('Card title', { exact: true }).fill('Other board remains editable');
      await a.getByRole('button', { name: 'Save', exact: true }).click();
      await saved(a);
      expect((await cloud.board(cloud.independentId)).cards.map((card) => card.title)).toEqual([
        'Other board remains editable',
      ]);
      await a.goto(`/#board/${cloud.original.invite_code}`);
      await openReview(a);
      if (order === 'cached deletion first')
        expect(
          (await cached(a, users.creator, cloud.boardId)).board?.cards.find(
            (card) => card.title === 'Second task',
          )?.description,
        ).toBe('Shared work after review opened');
      await expect(
        a.locator('.comparison-shared').filter({ hasText: 'Shared work after review opened' }),
      ).toHaveCount(order === 'queued first' ? 1 : 0);
      await a.getByRole('button', { name: 'Use shared board', exact: true }).click();
      await saved(a);
      const restored = await cached(a, users.creator, cloud.boardId);
      expect(restored.pending).toEqual([]);
      expect(restored.unappliedBackupId).toBeUndefined();
      expect(restored.backups).toHaveLength(1);
      expect(restored.backups?.[0]?.board.cards.find((card) => card.id === cardId)).toEqual(
        exactDraft,
      );
      expect((await cloud.board()).cards.some((card) => card.id === cardId)).toBe(false);
      await a.reload();
      await openReview(a);
      await checkDownload('Download backup 1');
    });
  }

test('an expired retry needs explicit review and a changed review cannot overwrite newer shared work', async ({
  cloud,
  pair: { a, b },
}) => {
  await a.context().setOffline(true);
  await edit(a);
  await a.getByLabel('Card title', { exact: true }).fill('Reviewed offline title');
  await a.getByRole('button', { name: 'Save', exact: true }).click();
  await saved(a);
  const originalQueue = await cached(a, users.creator, cloud.boardId);
  await cloud.expireReceipts();
  await a.context().setOffline(false);
  await expect(a.getByRole('alert')).toContainText('safe retry window');
  expect(
    (await cached(a, users.creator, cloud.boardId)).pending.map((change) => change.id),
  ).toEqual(originalQueue.pending.map((change) => change.id));
  await a.getByRole('button', { name: 'Settings', exact: true }).click();
  await a.getByRole('button', { name: 'Compare board versions', exact: true }).click();
  await expect(
    a.locator('.comparison-local').filter({ hasText: 'Reviewed offline title' }),
  ).toHaveCount(1);
  await edit(b);
  await b.getByLabel('Description').fill('Changed after review opened');
  await b.getByRole('button', { name: 'Save', exact: true }).click();
  await saved(b);
  await a.getByRole('button', { name: 'Retry reviewed edits', exact: true }).click();
  await expect(a.getByRole('dialog').getByRole('alert')).toContainText('The shared board changed');
  expect((await cached(a, users.creator, cloud.boardId)).backups ?? []).toEqual([]);
  await a.getByRole('button', { name: 'Refresh review', exact: true }).click();
  await expect(
    a.locator('.comparison-shared').filter({ hasText: 'Changed after review opened' }),
  ).toHaveCount(1);
  await a.getByRole('button', { name: 'Retry reviewed edits', exact: true }).click();
  await saved(a);
  const stored = await cached(a, users.creator, cloud.boardId);
  expect(stored.pending).toEqual([]);
  expect(stored.backups).toHaveLength(1);
  expect((await cloud.board()).cards.find((card) => card.id === cardId)).toMatchObject({
    title: 'Reviewed offline title',
    description: 'Changed after review opened',
  });
  expect(cloud.writes.at(-1)!.operationId).not.toBe(originalQueue.pending[0]!.id);
  await expect(tile(b)).toContainText('Reviewed offline title');
});

test('denied board access keeps its queue while another board saves, and explicit rejoining recovers it', async ({
  cloud,
  pair: { a, b },
}) => {
  await edit(a);
  await a.getByLabel('Card title', { exact: true }).fill('Retain while access is denied');
  await cloud.revoke(users.creator);
  await a.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(a.getByRole('dialog').getByRole('alert')).toContainText('no longer have access');
  await expect(a.getByLabel('Card title', { exact: true })).toHaveValue(
    'Retain while access is denied',
  );
  const held = await cached(a, users.creator, cloud.boardId);
  expect(held.pending).toHaveLength(1);
  await edit(b);
  await b.getByLabel('Description').fill('Still editable by another member');
  await b.getByRole('button', { name: 'Save', exact: true }).click();
  await saved(b);

  await a.goto('/');
  await a.getByRole('button', { name: 'Open Independent project', exact: true }).click();
  await a
    .getByRole('region', { name: 'To do', exact: true })
    .getByRole('button', { name: 'Add a card', exact: true })
    .click();
  await a.getByLabel('Card title', { exact: true }).fill('Unrelated board still saves');
  await a.getByRole('button', { name: 'Save', exact: true }).click();
  await saved(a);
  expect((await cloud.board(cloud.independentId)).cards.map((card) => card.title)).toEqual([
    'Unrelated board still saves',
  ]);
  expect(
    (await cached(a, users.creator, cloud.boardId)).pending.map((change) => change.id),
  ).toEqual(held.pending.map((change) => change.id));
  expect(await cloud.members()).toEqual([users.collaborator]);

  await a.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await a.getByRole('button', { name: 'Join a board', exact: true }).click();
  await a.getByLabel('Invitation code or link').fill(cloud.original.invite_code);
  await a.getByRole('button', { name: 'Join board', exact: true }).click();
  await expect(tile(a)).toContainText('Retain while access is denied');
  await expect
    .poll(async () => (await cached(a, users.creator, cloud.boardId)).pending.length)
    .toBe(0);
  expect((await cloud.board()).cards.find((card) => card.id === cardId)).toMatchObject({
    title: 'Retain while access is denied',
    description: 'Still editable by another member',
  });
  expect(await cloud.members()).toEqual(
    expect.arrayContaining([users.creator, users.collaborator]),
  );
});

test('saving a board copy keeps the original and pending edits, and a lost reply retries the same copy', async ({
  cloud,
  pair: { a, b },
}) => {
  const original = await cloud.board();
  const reply = cloud.hold(users.creator, 'response', 1, true);
  await a.getByRole('button', { name: 'Settings', exact: true }).click();
  await a.getByLabel('Board name', { exact: true }).fill('My recovered project');
  await a.getByRole('button', { name: 'Save my changes as a new board', exact: true }).click();
  await expect.poll(() => reply.arrived).toBe(1);
  const backup = (await cached(a, users.creator, cloud.boardId)).backups!.at(-1)!;
  expect(backup.board.title).toBe('My recovered project (copy)');
  reply.release();
  await expect(a.getByRole('dialog').getByRole('alert')).toBeVisible();
  await expect(a.getByLabel('Board name', { exact: true })).toHaveValue('My recovered project');
  await a.getByRole('button', { name: 'Save my changes as a new board', exact: true }).click();
  await saved(a);
  const copied = await cloud.board(backup.id);
  expect(copied.id).not.toBe(original.id);
  expect(copied.invite_code).not.toBe(original.invite_code);
  expect(copied.cards).toEqual(original.cards);
  expect(copied.columns).toEqual(original.columns);
  expect(await cloud.board()).toEqual(original);
  await expect(tile(b)).toContainText('First task');
  await a.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await expect(
    a.getByRole('button', { name: 'Open My recovered project (copy)', exact: true }),
  ).toHaveCount(1);
  expect((await cached(a, users.creator, cloud.boardId)).pending).toEqual([]);
});

test('force sync restores a reviewed deleted-card draft only after confirmation and retains its backup', async ({
  cloud,
  pair: { a, b },
}, testInfo) => {
  await a.context().setOffline(true);
  await edit(a);
  await a.getByLabel('Card title', { exact: true }).fill('Explicitly restored task');
  await a.getByRole('button', { name: 'Save', exact: true }).click();
  await saved(a);
  await edit(b);
  await b.getByRole('button', { name: 'Delete', exact: true }).click();
  await b.getByRole('button', { name: 'Confirm delete', exact: true }).click();
  await saved(b);
  await a.context().setOffline(false);
  await expect(a.getByRole('alert')).toContainText('removed');
  await openReview(a);
  await expect(
    a.locator('.comparison-local').filter({ hasText: 'Explicitly restored task' }),
  ).toHaveCount(1);
  await expect(a.locator('.comparison-shared')).toContainText('Not on the shared board');
  await expect(a.getByRole('button', { name: 'Download local draft', exact: true })).toHaveCount(0);
  await a.screenshot({ path: testInfo.outputPath('changed-fields.png') });
  await a.getByRole('button', { name: 'Force sync my changes', exact: true }).click();
  expect((await cloud.board()).cards.some((card) => card.id === cardId)).toBe(false);
  await a.getByRole('button', { name: 'Cancel force sync', exact: true }).click();
  expect(cloud.writes.some((write) => write.operation.type === 'replace_board')).toBe(false);
  await a.getByRole('button', { name: 'Force sync my changes', exact: true }).click();
  await a.getByRole('button', { name: 'Replace shared board', exact: true }).click();
  await saved(a);
  await expect(tile(b)).toContainText('Explicitly restored task');
  const entry = await cached(a, users.creator, cloud.boardId);
  expect(entry.force).toBeUndefined();
  expect(entry.pending).toEqual([]);
  expect(entry.backups?.at(-1)?.board.cards.find((card) => card.id === cardId)?.title).toBe(
    'Explicitly restored task',
  );
  expect(cloud.writes.filter((write) => write.operation.type === 'replace_board')).toHaveLength(1);
});

for (const width of [1440, 684, 390]) {
  test(`settings contains device review and preserves the footer and unsaved details at ${width}px`, async ({
    pair: { a },
  }, testInfo) => {
    await a.setViewportSize({ width, height: 960 });
    const footer = a.locator('.app-footer');
    await expect(footer.getByRole('button')).toHaveCount(0);
    const sync = await footer.locator('.footer-sync').boundingBox();
    const change = await footer.locator('.footer-board-change').boundingBox();
    const version = await footer.locator('.app-version').boundingBox();
    expect(sync).not.toBeNull();
    expect(change).not.toBeNull();
    expect(version).not.toBeNull();
    const main = (await a.locator('.main').boundingBox())!;
    expect(change!.x + change!.width / 2).toBeCloseTo(main.x + main.width / 2, 0);
    if (width > 520) {
      expect(change!.y + change!.height / 2).toBeCloseTo(sync!.y + sync!.height / 2, 0);
      expect(sync!.x + sync!.width).toBeLessThanOrEqual(change!.x);
      expect(change!.x + change!.width).toBeLessThanOrEqual(version!.x);
    } else {
      expect(change!.y).toBeGreaterThanOrEqual(
        Math.max(sync!.y + sync!.height, version!.y + version!.height),
      );
    }
    await expect(a.locator('.sidebar .footer-board-change')).toHaveCount(0);
    expect(Math.abs(sync!.y - version!.y)).toBeLessThanOrEqual(1);
    expect(sync!.x + sync!.width).toBeLessThan(version!.x);
    expect(version!.x + version!.width).toBeLessThanOrEqual(width);
    await a.screenshot({ path: testInfo.outputPath('board-footer.png') });
    const settings = a.getByRole('button', { name: 'Settings', exact: true });
    await settings.click();
    await a.getByLabel('Board name', { exact: true }).fill('Unsaved settings draft');
    const recovery = a.getByRole('region', { name: 'Sync and recovery', exact: true });
    await expect(
      recovery.getByRole('button', { name: 'Compare board versions', exact: true }),
    ).toBeVisible();
    await a.screenshot({ path: testInfo.outputPath('settings-form.png') });
    await recovery.getByRole('button', { name: 'Compare board versions', exact: true }).click();
    await expect(
      a.getByRole('dialog', { name: 'Compare board versions', exact: true }),
    ).toBeVisible();
    await expect(a.getByRole('dialog')).toContainText('No differences.');
    await a.screenshot({ path: testInfo.outputPath('settings-review.png') });
    await a.getByRole('button', { name: 'Back to settings', exact: true }).click();
    await expect(a.getByLabel('Board name', { exact: true })).toHaveValue('Unsaved settings draft');
    expect(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await a.screenshot({ path: testInfo.outputPath('settings-draft.png') });
    await a.keyboard.press('Escape');
    await expect(a.getByRole('dialog', { name: 'Discard this draft?' })).toBeVisible();
    await a.getByRole('button', { name: 'Keep draft', exact: true }).click();
    await expect(a.getByLabel('Board name', { exact: true })).toHaveValue('Unsaved settings draft');
    await a.keyboard.press('Escape');
    await a.getByRole('button', { name: 'Discard draft', exact: true }).click();
    await expect(a.getByRole('dialog')).toHaveCount(0);
    await expect(settings).toBeFocused();
  });
}
