import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { identities, sharedCloud } from './sharedCloud';

async function open(page: Page, code: string) {
  await page.goto(`/#/p/${code}`);
  await expect(page.locator('#join-form:visible, #editor:visible')).toHaveCount(1);
  if (await page.locator('#join-form').isVisible()) await page.locator('#join-confirm').click();
  await expect(page.locator('#editor')).toBeVisible();
}
async function participants(browser: Browser, cloud: ReturnType<typeof sharedCloud>) {
  const alice = await browser.newContext();
  const bob = await browser.newContext();
  await cloud.attach(alice, identities.alice);
  await cloud.attach(bob, identities.bob);
  return { alice, bob, a: await alice.newPage(), b: await bob.newPage() };
}
async function close(...contexts: BrowserContext[]) {
  for (const context of contexts) await context.close();
}
const saved = (page: Page) => expect(page.locator('#save-status')).toHaveText('All changes saved');

test('two independent identities edit one shared snippet and receive live changes without reload', async ({ browser }) => {
  const cloud = sharedCloud(),
    snippet = cloud.seed();
  const { alice, bob, a, b } = await participants(browser, cloud);
  try {
    await open(a, snippet.code);
    await open(b, snippet.code);
    expect(cloud.members(snippet.id).sort()).toEqual([identities.alice, identities.bob].sort());
    await expect.poll(() => cloud.subscriptions().sort()).toEqual([identities.alice, identities.bob].sort());
    await a.locator('#editor').fill('Alice shared edit');
    await saved(a);
    await expect(b.locator('#editor')).toHaveValue('Alice shared edit');
    await b.locator('#editor').fill('Bob shared edit');
    await saved(b);
    await expect(a.locator('#editor')).toHaveValue('Bob shared edit');
    expect(new Set(cloud.writes.map(row => row.user))).toEqual(new Set([identities.alice, identities.bob]));
  } finally {
    await close(alice, bob);
  }
});

test('simultaneous whole-text edits retain both versions until an explicit conflict choice', async ({ browser }) => {
  const cloud = sharedCloud(),
    snippet = cloud.seed();
  const { alice, bob, a, b } = await participants(browser, cloud);
  const held = cloud.holdSaves();
  try {
    await open(a, snippet.code);
    await open(b, snippet.code);
    await a.locator('#editor').fill('Alice line\nSecond line');
    await b.locator('#editor').fill('First line\nBob line');
    await expect.poll(() => held.arrived).toBe(2);
    held.release();
    await expect.poll(() => cloud.writes.filter(row => row.accepted).length).toBe(1);
    const winner = cloud.page(snippet.id).text;
    const loser = winner.startsWith('Alice') ? b : a;
    const other = loser === a ? b : a;
    const local = loser === a ? 'Alice line\nSecond line' : 'First line\nBob line';
    await expect(loser.locator('#conflict-review')).toBeVisible();
    await expect(loser.locator('#editor')).toHaveValue(local);
    await expect(loser.locator('#conflict-text')).toHaveValue(winner);
    await loser.waitForTimeout(500);
    expect(cloud.writes.filter(row => row.accepted)).toHaveLength(1);
    await loser.locator('#keep-local').click();
    await saved(loser);
    await expect(other.locator('#editor')).toHaveValue(local);
    expect(cloud.page(snippet.id).text).toBe(local);
  } finally {
    held.release();
    await close(alice, bob);
  }
});

test('two identities can save different shared snippets simultaneously', async ({ browser }) => {
  const cloud = sharedCloud(),
    first = cloud.seed('First snippet'),
    second = cloud.seed('Second snippet');
  const { alice, bob, a, b } = await participants(browser, cloud);
  const held = cloud.holdSaves();
  try {
    await open(a, first.code);
    await open(b, second.code);
    await a.locator('#editor').fill('Alice independent text');
    await b.locator('#editor').fill('Bob independent text');
    await expect.poll(() => held.arrived).toBe(2);
    held.release();
    await Promise.all([saved(a), saved(b)]);
    expect(cloud.writes.filter(row => row.accepted)).toHaveLength(2);
    await open(a, second.code);
    await open(b, first.code);
    await expect(a.locator('#editor')).toHaveValue('Bob independent text');
    await expect(b.locator('#editor')).toHaveValue('Alice independent text');
  } finally {
    held.release();
    await close(alice, bob);
  }
});

test('a separate identity must open an invitation before UUID access and cannot see another device’s offline queue', async ({ browser }) => {
  const cloud = sharedCloud(),
    snippet = cloud.seed('Shared before offline editing');
  const alice = await browser.newContext(),
    outsider = await browser.newContext();
  await cloud.attach(alice, identities.alice);
  await cloud.attach(outsider, identities.outsider);
  const a = await alice.newPage(),
    other = await outsider.newPage();
  try {
    await open(a, snippet.code);
    await alice.setOffline(true);
    await a.locator('#editor').fill('Alice private queued text');
    await expect(a.locator('#save-status')).toContainText('Saved on this device');
    await other.goto('/');
    const denied = await other.evaluate(
      async ({ id }) => {
        const token = JSON.parse(localStorage.getItem('textdrop-auth')!).access_token;
        const result = [];
        for (const [rpc, body] of [
          ['textdrop_poll_page', { p_id: id, p_known: 0 }],
          ['textdrop_save_checked', { p_id: id, p_expected: 1, p_text: 'Unauthorized replacement', p_base_hash: '', p_operation_id: crypto.randomUUID() }],
        ] as const) {
          const response = await fetch(`https://textdrop-test.supabase.co/rest/v1/rpc/${rpc}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          result.push({ status: response.status, body: await response.json() });
        }
        return result;
      },
      { id: snippet.id },
    );
    expect(denied).toEqual([
      { status: 403, body: { message: 'TEXTDROP_ACCESS_DENIED' } },
      { status: 403, body: { message: 'TEXTDROP_ACCESS_DENIED' } },
    ]);
    expect(cloud.members(snippet.id)).toEqual([identities.alice]);
    await open(other, snippet.code);
    await expect(other.locator('#editor')).toHaveValue('Shared before offline editing');
    expect(cloud.members(snippet.id).sort()).toEqual([identities.alice, identities.outsider].sort());
    expect(cloud.page(snippet.id).text).toBe('Shared before offline editing');
    await expect(a.locator('#editor')).toHaveValue('Alice private queued text');
  } finally {
    await close(alice, outsider);
  }
});

test('offline text survives production reload and reconnect conflict can explicitly accept shared text', async ({ browser }) => {
  const cloud = sharedCloud(),
    snippet = cloud.seed('Initial shared text');
  const { alice, bob, a, b } = await participants(browser, cloud);
  try {
    await open(a, snippet.code);
    await open(b, snippet.code);
    await b.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await expect.poll(() => b.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    await bob.setOffline(true);
    await b.locator('#editor').fill('Bob durable offline text');
    await expect(b.locator('#save-status')).toContainText('Saved on this device');
    await b.reload();
    await expect(b.locator('#editor')).toHaveValue('Bob durable offline text');
    await a.locator('#editor').fill('Alice newer shared text');
    await saved(a);
    await bob.setOffline(false);
    await expect(b.locator('#conflict-review')).toBeVisible();
    await expect(b.locator('#editor')).toHaveValue('Bob durable offline text');
    await expect(b.locator('#conflict-text')).toHaveValue('Alice newer shared text');
    await b.locator('#use-shared').click();
    await saved(b);
    await expect(b.locator('#editor')).toHaveValue('Alice newer shared text');
    expect(cloud.page(snippet.id).text).toBe('Alice newer shared text');
  } finally {
    await close(alice, bob);
  }
});

test('a later edit made during upload is saved after acknowledgement without a false conflict', async ({ browser }) => {
  const cloud = sharedCloud(),
    snippet = cloud.seed();
  const { alice, bob, a, b } = await participants(browser, cloud);
  const held = cloud.holdReplies();
  try {
    await open(a, snippet.code);
    await open(b, snippet.code);
    await a.locator('#editor').fill('First upload');
    await expect.poll(() => held.arrived).toBe(1);
    await a.locator('#editor').fill('Newer edit during upload');
    await expect(a.locator('#save-status')).not.toHaveText('All changes saved');
    held.release();
    await saved(a);
    await expect(b.locator('#editor')).toHaveValue('Newer edit during upload');
    expect(cloud.page(snippet.id).text).toBe('Newer edit during upload');
    await expect(a.locator('#conflict-review')).toBeHidden();
  } finally {
    held.release();
    await close(alice, bob);
  }
});

test('a shared name change combines with another identity’s pending text', async ({ browser }) => {
  const cloud = sharedCloud(),
    snippet = cloud.seed();
  const { alice, bob, a, b } = await participants(browser, cloud);
  const held = cloud.holdSaves(1);
  try {
    await open(a, snippet.code);
    await open(b, snippet.code);
    await a.locator('#editor').fill('Alice text while Bob names it');
    await expect.poll(() => held.arrived).toBe(1);
    await b.locator('#rename-page').click();
    await b.locator('#snippet-name-input').fill('Shared travel notes');
    await b.locator('#rename-confirm').click();
    await expect(b.locator('#page-name')).toHaveText('Shared travel notes');
    held.release();
    await saved(a);
    await expect(b.locator('#editor')).toHaveValue('Alice text while Bob names it');
    await expect(a.locator('#page-name')).toHaveText('Shared travel notes');
    expect(cloud.page(snippet.id)).toMatchObject({ name: 'Shared travel notes', text: 'Alice text while Bob names it' });
    await expect(a.locator('#conflict-review')).toBeHidden();
  } finally {
    held.release();
    await close(alice, bob);
  }
});
