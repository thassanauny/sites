import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import vm from 'node:vm';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const workerSource = await readFile(resolve(dist, 'sw.js'), 'utf8');
const scope = 'https://dictionary.example/tools/shobdokosh/';
const cachePrefix = 'shobdokosh:/tools/shobdokosh/:';

function createWorker({ failAsset, offline = false } = {}) {
  const handlers = new Map();
  const stores = new Map();
  const requests = [];
  const messages = [];
  let claims = 0;
  let skips = 0;
  const keyFor = (request) => typeof request === 'string' ? request : request.url;
  const network = async (request) => {
    const url = keyFor(request);
    if (request instanceof Request) assert.equal(request.cache, 'reload', 'installation must refresh browser HTTP caches');
    requests.push(url);
    if (offline || (failAsset && url.endsWith(failAsset))) throw new TypeError('Network unavailable');
    return new Response(`Cached content of ${url}`);
  };
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const entries = stores.get(name);
      return {
        async addAll(resources) {
          const responses = await Promise.all(resources.map(async (request) => [keyFor(request), await network(request)]));
          responses.forEach(([url, response]) => entries.set(url, response));
        },
        async match(request) { return entries.get(keyFor(request))?.clone(); },
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
  };
  const self = {
    registration: { scope },
    location: new URL(`${scope}sw.js`),
    addEventListener(type, callback) { handlers.set(type, callback); },
    async skipWaiting() { skips += 1; },
    clients: {
      async claim() { claims += 1; },
      async matchAll() { return [{ postMessage(message) { messages.push(message); } }]; },
    },
  };
  vm.runInNewContext(workerSource, { self, caches, URL, Request, fetch: network });
  async function dispatch(type, details = {}) {
    let promise;
    handlers.get(type)({
      ...details,
      waitUntil(value) { promise = value; },
      respondWith(value) { promise = value; },
    });
    return promise;
  }
  return { dispatch, stores, requests, messages, get claims() { return claims; }, get skips() { return skips; } };
}

test('the complete offline app installs relative to its hosting subpath', async () => {
  const worker = createWorker();
  await worker.dispatch('install');
  const [cache] = worker.stores.values();
  for (const required of [
    'index.html', 'app.js', 'search.js', 'style.css', 'fonts.css',
    'bangla-input.js', 'bangla-keyboard.js', 'transliteration.js',
    'vendor/avro-phonetic.js', 'vendor/MPL-2.0.txt', 'vendor/NOTICE.md',
    'data/dictionary.json', 'data/featured.json',
    'bengali-morphology.js', 'entry-view.js', 'dictionary-format.js',
    'data/vocabulary-summary.json',
    'data/expanded-dictionary.json', 'data/literary-dictionary.json',
    'data/bn-wiktionary-dictionary.json', 'data/reading-dictionary.json', 'data/native-bengali.json', 'data/english-bangla-definitions.json',
    'data/sources/EXPANDED_DICTIONARY_NOTICES.md', 'data/sources/LITERARY_DICTIONARY_NOTICES.md',
    'data/sources/BN_WIKTIONARY_NOTICES.md', 'data/sources/READING_DICTIONARY_NOTICES.md', 'data/sources/NATIVE_BENGALI_NOTICES.md', 'data/sources/ENGLISH_DEFINITIONS_NOTICES.md',
    'data/sources/ankur-ridmik/dictionary.sqlite', 'data/sources/ankur-ridmik/README.md',
    'data/sources/ankur-ridmik/COPYING.txt', 'data/sources/import_expanded_dictionary.py',
    'data/THIRD_PARTY_NOTICES.md', 'data/LICENSE-CC-BY-SA-4.0.txt',
    'fonts/dm-sans-400.ttf', 'fonts/dm-sans-600.ttf',
    'fonts/lora-400.ttf', 'fonts/noto-sans-bengali-400.ttf',
    'fonts/dmsans-OFL.txt', 'fonts/lora-OFL.txt', 'fonts/notosansbengali-OFL.txt',
  ]) {
    assert.ok(cache.has(new URL(required, scope).href), `${required} must be available offline`);
  }
  assert.ok(worker.requests.every((url) => url.startsWith(scope)));
  assert.equal(worker.skips, 0, 'installing an update must wait for user acceptance');
});

test('a failed download prevents a partial dictionary installation', async () => {
  const worker = createWorker({ failAsset: 'dictionary.json' });
  await assert.rejects(worker.dispatch('install'), /Network unavailable/);
  assert.equal([...worker.stores.values()][0].size, 0);
  assert.equal(worker.claims, 0);
});

test('activation removes only old caches for this installation', async () => {
  const worker = createWorker();
  worker.stores.set(`${cachePrefix}old`, new Map());
  worker.stores.set('another-app-v1', new Map());
  worker.stores.set('shobdokosh:/another-install/:old', new Map());
  await worker.dispatch('install');
  await worker.dispatch('activate');
  assert.equal(worker.stores.has(`${cachePrefix}old`), false);
  assert.equal(worker.stores.has('another-app-v1'), true);
  assert.equal(worker.stores.has('shobdokosh:/another-install/:old'), true);
  assert.equal(worker.claims, 1);
  assert.equal(worker.messages[0].type, 'OFFLINE_READY');
});

test('offline navigation, dictionary searches, and local fonts use the installed cache', async () => {
  const worker = createWorker();
  await worker.dispatch('install');
  const beforeFetch = worker.requests.length;
  for (const path of ['data/dictionary.json', 'data/expanded-dictionary.json', 'data/literary-dictionary.json', 'data/bn-wiktionary-dictionary.json', 'data/reading-dictionary.json', 'data/native-bengali.json', 'data/english-bangla-definitions.json', 'bengali-morphology.js', 'fonts/noto-sans-bengali-400.ttf']) {
    const response = await worker.dispatch('fetch', { request: new Request(`${scope}${path}?revision=example`) });
    assert.equal(await response.text(), `Cached content of ${scope}${path}`);
  }
  const response = await worker.dispatch('fetch', { request: { url: `${scope}?word=hello`, method: 'GET', mode: 'navigate' } });
  assert.equal(await response.text(), `Cached content of ${scope}index.html`);
  assert.equal(worker.requests.length, beforeFetch, 'the app shell must not depend on a network response');
});

test('an update activates only after the explicit update message', async () => {
  const worker = createWorker();
  await worker.dispatch('install');
  assert.equal(worker.skips, 0);
  await worker.dispatch('message', { data: { type: 'SKIP_WAITING' } });
  assert.equal(worker.skips, 1);
});

test('attribution and license links open their cached content while offline', async () => {
  const worker = createWorker();
  await worker.dispatch('install');
  const beforeFetch = worker.requests.length;
  for (const path of ['data/THIRD_PARTY_NOTICES.md', 'data/LICENSE-CC-BY-SA-4.0.txt', 'data/sources/EXPANDED_DICTIONARY_NOTICES.md', 'data/sources/ankur-ridmik/COPYING.txt', 'data/sources/import_expanded_dictionary.py', 'data/sources/BN_WIKTIONARY_NOTICES.md', 'fonts/notosansbengali-OFL.txt']) {
    const response = await worker.dispatch('fetch', { request: { url: `${scope}${path}`, method: 'GET', mode: 'navigate' } });
    assert.equal(await response.text(), `Cached content of ${scope}${path}`);
  }
  assert.equal(worker.requests.length, beforeFetch);
});

test('offline readiness is reported after the full dictionary is saved', async () => {
  const worker = createWorker();
  await worker.dispatch('install');
  let reply;
  await worker.dispatch('message', { data: { type: 'GET_OFFLINE_STATUS' }, ports: [{ postMessage(message) { reply = message; } }] });
  assert.equal(reply.type, 'OFFLINE_STATUS');
  assert.equal(reply.ready, true);
  const [cache] = worker.stores.values();
  cache.delete(`${scope}data/dictionary.json`);
  await worker.dispatch('message', { data: { type: 'GET_OFFLINE_STATUS' }, ports: [{ postMessage(message) { reply = message; } }] });
  assert.equal(reply.ready, false);
});

test('the worker leaves requests outside its app and non-GET requests alone', async () => {
  const worker = createWorker({ offline: true });
  for (const request of [
    new Request('https://another.example/data.json'),
    new Request('https://dictionary.example/another-app/app.js'),
    new Request(`${scope}data/dictionary.json`, { method: 'POST' }),
  ]) {
    assert.equal(await worker.dispatch('fetch', { request }), undefined);
  }
  assert.equal(worker.requests.length, 0);
});

test('every precached asset and manifest icon exists in the distributable app', async () => {
  const worker = createWorker();
  await worker.dispatch('install');
  for (const url of worker.requests) {
    await assert.doesNotReject(access(resolve(dist, decodeURIComponent(url.slice(scope.length)))));
  }
  const manifest = JSON.parse(await readFile(resolve(dist, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.name, 'শব্দকোষ');
  assert.equal(manifest.short_name, 'শব্দকোষ');
  const html = await readFile(resolve(dist, 'index.html'), 'utf8');
  assert.match(html, /<meta name="apple-mobile-web-app-title" content="শব্দকোষ">/);
  assert.match(html, /<meta name="application-name" content="শব্দকোষ">/);
  assert.ok(manifest.icons.some((icon) => icon.purpose === 'maskable'));
  for (const icon of manifest.icons) {
    const bytes = await readFile(resolve(dist, icon.src));
    assert.equal(bytes.toString('ascii', 1, 4), 'PNG');
    const [width, height] = icon.sizes.split('x').map(Number);
    assert.equal(bytes.readUInt32BE(16), width);
    assert.equal(bytes.readUInt32BE(20), height);
  }
});

// Exercise the page-side lifecycle independently of dictionary rendering.
async function offlinePage({ controlled = true, waiting = null } = {}) {
  const source = await readFile(resolve(dist, 'app.js'), 'utf8');
  const lifecycle = source.slice(source.indexOf('async function setupOffline()'), source.indexOf('function connection()'));
  const listeners = new Map();
  const nodes = new Map();
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, { hidden: true, disabled: false });
    return nodes.get(selector);
  };
  const registration = { waiting, installing: null, active: { postMessage() {} }, addEventListener() {} };
  let reloads = 0;
  const context = vm.createContext({
    navigator: { serviceWorker: {
      controller: controlled ? {} : null,
      async register() { return registration; },
      ready: Promise.resolve(registration),
      addEventListener(type, callback) { listeners.set(type, callback); },
    } },
    $: node, state: { offlineReady: false }, showOfflineReady() {},
    updateDismissed: false, updateRequested: false, updateReloading: false,
    location: { reload() { reloads++; } }, window: { isSecureContext: true },
    MessageChannel: class { constructor() { this.port1 = { close() {} }; this.port2 = {}; } },
  });
  vm.runInContext(lifecycle, context);
  await context.setupOffline();
  return { context, registration, listeners, node, get reloads() { return reloads; } };
}

test('an update accepted by another tab reloads existing clients exactly once', async () => {
  const page = await offlinePage();
  page.listeners.get('controllerchange')();
  page.listeners.get('controllerchange')();
  assert.equal(page.reloads, 1);
});

test('first offline installation does not reload the page', async () => {
  const page = await offlinePage({ controlled: false });
  page.listeners.get('controllerchange')();
  assert.equal(page.reloads, 0);
});

test('a stale Update banner reloads when its waiting worker has already gone', async () => {
  const page = await offlinePage();
  page.context.applyOfflineUpdate();
  page.context.applyOfflineUpdate();
  assert.equal(page.reloads, 1);
  assert.equal(page.node('#update-button').disabled, true);
});

test('Update requests activation and reloads after control changes', async () => {
  const messages = [];
  const worker = { state: 'installed', addEventListener() {}, postMessage(message) { messages.push(message.type); } };
  const page = await offlinePage({ waiting: worker });
  assert.equal(page.node('#update-banner').hidden, false);
  page.context.applyOfflineUpdate();
  assert.deepEqual(messages, ['SKIP_WAITING']);
  assert.equal(page.reloads, 0);
  page.listeners.get('controllerchange')();
  assert.equal(page.reloads, 1);
});

test('tab favicon has a distinct content fingerprint and is cached offline', async () => {
  const html = await readFile(resolve(dist, 'index.html'), 'utf8');
  const match = html.match(/rel="icon" href="\.\/(icons\/favicon-[a-f0-9]{12}\.png)" type="image\/png" sizes="32x32"/);
  assert.ok(match, 'use a dedicated fingerprinted tab icon instead of a reused app icon URL');
  const bytes = await readFile(resolve(dist, match[1]));
  assert.equal(bytes.readUInt32BE(16), 32);
  assert.equal(bytes.readUInt32BE(20), 32);
  const worker = createWorker();
  await worker.dispatch('install');
  assert.ok(worker.requests.some(url => url.endsWith(match[1])));
});
