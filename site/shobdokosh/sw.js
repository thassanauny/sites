/* Bump this version whenever an app file or dictionary changes before deployment. */
const VERSION = '1.1.11';
const CACHE_PREFIX = `shobdokosh:${new URL(self.registration.scope).pathname}:`;
const CACHE_NAME = `${CACHE_PREFIX}${VERSION}`;
const ASSETS = [
  './index.html',
  './style.css',
  './fonts.css',
  './app.js',
  './search.js',
  './entry-view.js',
  './dictionary-format.js',
  './bengali-morphology.js',
  './bangla-input.js',
  './bangla-keyboard.js',
  './transliteration.js',
  './vendor/avro-phonetic.js',
  './vendor/MPL-2.0.txt',
  './vendor/NOTICE.md',
  './data/dictionary.json',
  './data/expanded-dictionary.json',
  './data/literary-dictionary.json',
  './data/bn-wiktionary-dictionary.json',
  './data/reading-dictionary.json',
  './data/native-bengali.json',
  './data/english-bangla-definitions.json',
  './data/vocabulary-summary.json',
  './data/sources/EXPANDED_DICTIONARY_NOTICES.md',
  './data/sources/LITERARY_DICTIONARY_NOTICES.md',
  './data/sources/BN_WIKTIONARY_NOTICES.md',
  './data/sources/READING_DICTIONARY_NOTICES.md',
  './data/sources/NATIVE_BENGALI_NOTICES.md',
  './data/sources/ENGLISH_DEFINITIONS_NOTICES.md',
  './data/sources/ankur-ridmik/dictionary.sqlite',
  './data/sources/ankur-ridmik/README.md',
  './data/sources/ankur-ridmik/COPYING.txt',
  './data/sources/import_expanded_dictionary.py',
  './data/featured.json',
  './data/THIRD_PARTY_NOTICES.md',
  './data/LICENSE-CC-BY-SA-4.0.txt',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
  './fonts/dm-sans-400.ttf',
  './fonts/dm-sans-600.ttf',
  './fonts/lora-400.ttf',
  './fonts/noto-sans-bengali-400.ttf',
  './fonts/dmsans-OFL.txt',
  './fonts/lora-OFL.txt',
  './fonts/notosansbengali-OFL.txt',
];
const assetURLs = new Set(ASSETS.map((path) => new URL(path, self.registration.scope).href));
const indexURL = new URL('./index.html', self.registration.scope).href;

self.addEventListener('install', (event) => {
  // Install atomically: the new worker can only activate after the whole app is saved.
  // Keep a waiting worker until the user accepts the update or closes the old app.
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(
    [...assetURLs].map((url) => new Request(url, { cache: 'reload' })),
  )));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach((client) => client.postMessage({ type: 'OFFLINE_READY', version: VERSION }));
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    event.waitUntil(self.skipWaiting());
  }
  if (event.data?.type === 'GET_OFFLINE_STATUS') {
    event.waitUntil((async () => {
      const cache = await caches.open(CACHE_NAME);
      const ready = (await Promise.all([...assetURLs].map((url) => cache.match(url)))).every(Boolean);
      const message = { type: 'OFFLINE_STATUS', ready, version: VERSION };
      if (event.ports[0]) event.ports[0].postMessage(message);
      else event.source?.postMessage(message);
    })());
  }
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  url.search = '';
  if (assetURLs.has(url.href)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      return (await cache.match(url.href)) || fetch(event.request);
    })());
  } else if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      return (await cache.match(indexURL)) || fetch(event.request);
    })());
  }
});
