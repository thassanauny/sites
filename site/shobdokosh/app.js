import { buildIndex, searchDictionary, detectDirection, dailyEntry, normalize, resolveBanglaWord, closeBanglaWords } from './search.js';
import { createBanglaInput } from './bangla-input.js';
import { entryView, banglaDefinitions, meaningPreview, excerpt } from './entry-view.js';
import { unpackDictionary } from './dictionary-format.js';

const $ = (selector) => document.querySelector(selector);
const icon = (name) => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const readList = (key) => { try { const list = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(list) ? list.filter(id => typeof id === 'string') : []; } catch { return []; } };
function readDirection() {
  try {
    const direction = JSON.parse(localStorage.getItem('shobdokosh-direction'));
    return direction === 'bn' ? 'bn' : 'en';
  } catch { return 'en'; }
}

const state = { entries: [], featured: [], byId: new Map(), lastMatches: new Map(), index: [], meta: {}, stats: {}, expandedMeta: {}, literaryMeta: {}, saved: readList('shobdokosh-saved'), recent: readList('shobdokosh-recent'), direction: readDirection(), query: '', limit: 40, ready: false, error: false, offlineReady: false };
let searchTimer, toastTimer, swRegistration;
let updateRequested = false, updateReloading = false;
let updateDismissed = false;
const banglaInput = createBanglaInput({
  input: $('#search'),
  onChange: () => { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 120); },
  getSuggestions: query => state.ready ? closeBanglaWords(state.index, query) : [],
  getMeanings: query => {
    if (!state.ready) return [];
    return meaningPreview(resolveBanglaWord(state.index, query).entries);
  },
});

function toast(message) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 3500);
}

function persist(key, values) {
  try { localStorage.setItem(`shobdokosh-${key}`, JSON.stringify(values)); }
  catch { toast('Device storage is unavailable. Changes will last for this visit.'); }
}

function setDirection(direction) {
  if (direction !== 'en' && direction !== 'bn') return;
  if (state.direction !== direction) persist('direction', direction);
  state.direction = direction;
  document.querySelectorAll('[data-direction]').forEach(button => {
    const selected = button.dataset.direction === direction;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  banglaInput.setDirection(direction);
}

function chooseDirection(direction) {
  clearTimeout(searchTimer);
  setDirection(direction);
  // Reinterpret the existing input in the chosen language without discarding it.
  state.query = banglaInput.getQuery().trim();

  state.limit = 40;
  if (location.hash.startsWith('#word/')) location.hash = 'dictionary';
  else render();
}

function updateCounts() {
  $('#saved-count').textContent = state.saved.filter(id => state.byId.has(id)).length;
}

function heading(title, subtitle = '', symbol = 'spark') {
  $('#view-heading').classList.remove('discovery-heading');
  $('#view-heading').innerHTML = `<h2>${icon(symbol)}${escape(title)}</h2>${subtitle ? `<span>${escape(subtitle)}</span>` : ''}`;
}

function empty(title, description, symbol = 'search') {
  return `<div class="empty-state">${icon(symbol)}<h3>${escape(title)}</h3><p>${escape(description)}</p><button data-action="home">Explore the dictionary</button></div>`;
}

function row(entry) {
  const view = entryView(entry, state.direction, state.query);
  const lookup = entry.lookup ? `<span class="lookup-note">${escape(entry.lookup.label)}: <span lang="bn">${escape(entry.lookup.baseForm)}</span></span>` : '';
  const label = view.definitionOnly ? '<span class="definition-kind" lang="bn">বাংলা সংজ্ঞা</span>' : '';
  return `<button class="result-row" data-open="${escape(entry.id)}"><span><strong lang="${view.titleLanguage}">${escape(view.title)}${entry.pos ? `<span class="word-pos">${escape(entry.pos)}</span>` : ''}</strong>${label}<span class="result-meaning" lang="${view.meaningLanguage}">${escape(excerpt(view.meaningValues.join(' · '), 170))}</span>${lookup}</span>${icon('arrow')}</button>`;
}

function card(entry, searchResult = false) {
  const saved = state.saved.includes(entry.id);
  const view = entryView(entry, state.direction, state.query);
  const title = view.title;
  const inferred = entry.lookup ? `<p class="lookup-note">${escape(entry.lookup.label)}: <span lang="bn">${escape(entry.lookup.query)} → ${escape(entry.lookup.baseForm)}</span>. This entry explains the base form.</p>` : '';
  const definitions = (entry.definition && normalize(entry.definition) !== normalize(entry.en) ? `<p class="definition" lang="en">${escape(entry.definition)}</p>` : '')
    + view.extraBanglaDefinitions.map(value => `<p class="definition" lang="bn">${escape(value)}</p>`).join('');
  const meanings = view.definitionOnly
    ? `<div class="native-definition" lang="bn">${view.meaningValues.length > 1 ? `<ol>${view.meaningValues.map(value => `<li>${escape(value)}</li>`).join('')}</ol>` : `<p>${escape(view.meaningValues[0] || '')}</p>`}</div>`
    : `<p class="translation-text" lang="${view.meaningLanguage}">${escape(view.meaningValues.join(' · '))}</p>`;
  const availability = view.englishUnavailable ? '<p class="meaning-availability">English translation is not available for this entry yet.</p>' : '';
  const examples = entry.example ? `<div class="example">“${escape(entry.example)}”${entry.exampleBn ? `<div class="bangla-example" lang="bn">${escape(entry.exampleBn)}</div>` : ''}</div>` : '';
  const footer = searchResult || !['', '#dictionary'].includes(location.hash) ? '' : `<div class="word-bottom"><button class="text-button" data-action="surprise">Discover another word ${icon('arrow')}</button></div>`;
  return `<article class="word-card"><div class="word-top"><div><h3 class="word-title" lang="${view.titleLanguage}">${searchResult ? `<button type="button" class="word-open" data-open="${escape(entry.id)}">${escape(title)}</button>` : escape(title)}</h3><div class="word-subtitle">${entry.pronunciation && view.titleLanguage === 'en' ? `<span>${escape(entry.pronunciation)}</span>` : ''}${entry.pos ? `<span class="word-pos">${escape(entry.pos)}</span>` : ''}</div></div><div class="word-actions"><button class="icon-button" data-speak="${escape(entry.id)}" aria-label="Listen to ${escape(title)}" title="Listen">${icon('volume')}</button><button class="icon-button ${saved ? 'saved' : ''}" data-save="${escape(entry.id)}" aria-pressed="${saved}" aria-label="${saved ? 'Unsave' : 'Save'} ${escape(title)}" title="${saved ? 'Remove from saved words' : 'Save word'}">${icon('bookmark')}</button></div></div>${inferred}<div class="translation-label">${view.label}</div>${meanings}${availability}${definitions}${examples}${footer}</article>`;
}

function showRows(entries, total = entries.length) {
  state.lastMatches = new Map(entries.map(entry => [entry.id, entry]));
  const count = total === 1 ? '1 dictionary sense' : `${total.toLocaleString()} dictionary senses`;
  $('#results').innerHTML = `<p class="result-count">${escape(count)}${total > entries.length ? ` · Showing the first ${entries.length}` : ''}</p><div class="results-grid">${entries.map(entry => card(entry, true)).join('')}</div>${total > entries.length ? '<button class="more-button" data-action="more">Show more words</button>' : ''}`;
}

function render() {
  if (!state.ready) return;
  const route = location.hash.slice(1) || 'dictionary';
  const savedView = route === 'saved';
  const discovered = state.discovery?.route === route ? state.byId.get(state.discovery.id) : null;
  let wordId = null;
  if (route.startsWith('word/')) {
    try { wordId = discovered?.id || decodeURIComponent(route.slice(5)); }
    catch { wordId = '__invalid_word__'; }
  }
  $('#nav-saved').classList.toggle('active', savedView);
  $('#nav-saved').setAttribute('aria-current', savedView ? 'page' : 'false');
  $('#results').setAttribute('aria-busy', 'false');
  if (savedView) {
    heading('Words worth keeping', '', 'bookmark');
    $('#view-heading').classList.add('discovery-heading');
    const saved = state.saved.map(id => state.byId.get(id)).filter(Boolean);
    const { entries: filtered, total } = state.query ? searchDictionary(buildIndex(saved), state.query, state.direction, state.limit) : { entries: saved, total: saved.length };
    if (filtered.length) {
      if (state.query) showRows(filtered, total);
      else {
        state.lastMatches = new Map(filtered.map(entry => [entry.id, entry]));
        $('#results').innerHTML = `<div class="results-grid">${filtered.map(entry => card(entry)).join('')}</div>`;
      }
    }
    else $('#results').innerHTML = empty(saved.length ? 'No saved words match' : 'Make a word yours', saved.length ? 'Try another search, or clear the search to see all your saved words.' : 'Tap the bookmark beside a word to keep it here. Your collection stays on this device.', 'bookmark');
    return;
  }
  if (wordId) {
    const recentMatch = state.lastMatches.get(wordId);
    const entry = recentMatch?.lookup?.query === normalize(state.query) ? recentMatch : state.byId.get(wordId);
    heading('Word meaning', '', 'book');
    $('#view-heading').classList.add('discovery-heading');
    $('#view-heading').insertAdjacentHTML('beforeend', '<button type="button" class="text-button detail-back" data-action="back">← Back to words</button>');
    if (!entry) { $('#results').innerHTML = empty('This word is unavailable', 'The dictionary may have changed. Search again to find the word.'); return; }
    $('#results').innerHTML = `<div class="word-detail">${card(entry)}</div>`;
    const title = $('#results .word-title');
    title.tabIndex = -1;
    title.focus({ preventScroll: true });
    return;
  }
  if (state.query) {
    const { entries, total } = searchDictionary(state.index, state.query, state.direction, state.limit);
    heading(`Results for “${state.query}”`, '', 'search');
    $('#view-heading').classList.add('discovery-heading');
    if (entries.length) showRows(entries, total);
    else $('#results').innerHTML = empty('A word still to discover', 'This dictionary does not have that word yet. Check the spelling or try a shorter word.');
    return;
  }
  heading('Discover a word');
  $('#view-heading').classList.add('discovery-heading');
  $('#results').innerHTML = card(discovered || dailyEntry(state.featured));
}

function home() {
  state.discovery = null;
  state.query = ''; $('#search').value = '';
  banglaInput.refresh();
  if (location.hash !== '#dictionary') location.hash = 'dictionary';
  else render();
}

function openWord(id) {
  if (!state.byId.has(id)) return;
  state.discovery = null;
  state.recent = [id, ...state.recent.filter(item => item !== id)].slice(0, 6);
  persist('recent', state.recent);
  renderRecent();
  location.hash = `word/${encodeURIComponent(id)}`;
}

function discoverAnotherWord(targetCard = $('#results .word-card')) {
  const position = { top: window.scrollY, left: window.scrollX, behavior: 'instant' };
  const current = targetCard?.querySelector('[data-save]')?.dataset.save;
  const choices = state.featured.filter(entry => entry.id !== current);
  if (!choices.length) return;
  const entry = choices[Math.floor(Math.random() * choices.length)];
  state.discovery = { route: location.hash.slice(1) || 'dictionary', id: entry.id };
  const replacement = document.createElement('div');
  replacement.innerHTML = card(entry);
  const nextCard = replacement.firstElementChild;
  targetCard.replaceWith(nextCard);
  state.recent = [entry.id, ...state.recent.filter(id => id !== entry.id)].slice(0, 6);
  persist('recent', state.recent);
  renderRecent();
  nextCard.querySelector('[data-action="surprise"]').focus({ preventScroll: true });
  window.scrollTo(position);
}

function renderRecent() {
  const entries = state.recent.map(id => state.byId.get(id)).filter(Boolean);
  $('#clear-history').hidden = !entries.length;
  $('#recent-list').innerHTML = entries.length ? entries.map(entry => {
    const view = entryView(entry, entry.language === 'bn' ? 'bn' : 'en');
    const detail = entry.en && entry.bn.length ? entry.bn.slice(0, 2).join(' · ') : excerpt(banglaDefinitions(entry)[0], 65);
    return `<button class="recent-word" data-open="${escape(entry.id)}"><span><strong lang="${view.titleLanguage}">${escape(view.title)}</strong><span lang="bn">${escape(detail)}</span></span>${icon('arrow')}</button>`;
  }).join('') : '<p class="quiet-text">Your next discovery starts with a search. Words you open will appear here.</p>';
}

function toggleSave(id) {
  const entry = state.byId.get(id);
  if (!entry) return;
  const exists = state.saved.includes(id);
  state.saved = exists ? state.saved.filter(item => item !== id) : [id, ...state.saved];
  persist('saved', state.saved); updateCounts();
  document.querySelectorAll('[data-save]').forEach(button => {
    if (button.dataset.save !== id) return;
    button.classList.toggle('saved', !exists);
    button.setAttribute('aria-pressed', String(!exists));
    button.setAttribute('aria-label', `${exists ? 'Save' : 'Unsave'} ${entryView(entry, state.direction, state.query).title}`);
    button.title = exists ? 'Save word' : 'Remove from saved words';
  });
  toast(exists ? 'Word removed from your collection.' : 'A little word, saved for later.');
}

function speak(id) {
  const entry = state.byId.get(id);
  if (!entry) return;
  if (!('speechSynthesis' in window)) return toast('Pronunciation is not supported in this browser.');
  const view = entryView(entry, state.direction, state.query);
  const bn = view.titleLanguage === 'bn';
  const voices = speechSynthesis.getVoices();
  const voice = voices.find(item => item.lang.toLowerCase().startsWith(bn ? 'bn' : 'en'));
  if (bn && !voice) return toast('Install a Bengali voice on your device to hear Bangla words.');
  const utterance = new SpeechSynthesisUtterance(view.title);
  utterance.lang = bn ? 'bn-BD' : 'en-GB';
  if (voice) utterance.voice = voice;
  utterance.rate = 0.85;
  utterance.onerror = event => { if (event.error !== 'interrupted' && event.error !== 'canceled') toast('Pronunciation is unavailable. Check your installed device voices.'); };
  speechSynthesis.cancel(); speechSynthesis.speak(utterance);
}

function dialog(title, content) {
  $('#dialog-title').textContent = title;
  $('#dialog-content').innerHTML = content;
  $('#info-dialog').showModal();
}

function showOfflineReady(ready) {
  state.offlineReady = ready;
  $('#offline-status').innerHTML = `${icon(ready ? 'check' : 'download')}<span>${ready ? 'Your dictionary is ready offline' : 'Preparing offline dictionary'}</span>`;
}

async function setupOffline() {
  if (!('serviceWorker' in navigator)) {
    $('#offline-status').textContent = 'Offline mode is unavailable in this browser'; return;
  }
  // A controller swap also happens when another open tab accepts the update.
  // Reload existing clients so a stale banner cannot outlive its waiting worker.
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if ((hadController || updateRequested) && !updateReloading) {
      updateReloading = true;
      location.reload();
    }
  });
  try {
    swRegistration = await navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' });
    const checkUpdate = () => { if (!updateDismissed && swRegistration.waiting && navigator.serviceWorker.controller) $('#update-banner').hidden = false; };
    checkUpdate();
    const watchInstalling = () => {
      const worker = swRegistration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed') checkUpdate();
        if (worker.state === 'redundant' && !state.offlineReady) $('#offline-status').textContent = 'Offline download failed. Reopen while online to retry.';
      });
    };
    watchInstalling();
    swRegistration.addEventListener('updatefound', watchInstalling);
    navigator.serviceWorker.addEventListener('message', event => {
      if (event.data?.type === 'OFFLINE_READY') showOfflineReady(true);
      if (event.data?.type === 'OFFLINE_STATUS') showOfflineReady(event.data.ready);
    });
    const readyRegistration = await navigator.serviceWorker.ready;
    const channel = new MessageChannel();
    channel.port1.onmessage = event => { showOfflineReady(Boolean(event.data?.ready)); channel.port1.close(); };
    readyRegistration.active?.postMessage({ type: 'GET_OFFLINE_STATUS' }, [channel.port2]);
  } catch {
    $('#offline-status').textContent = window.isSecureContext ? 'Offline download failed. Reopen while online to retry.' : 'Offline mode needs HTTPS or localhost';
  }
}

function applyOfflineUpdate() {
  if (updateReloading) return;
  updateRequested = true;
  $('#update-button').disabled = true;
  const worker = swRegistration?.waiting;
  if (!worker || worker.state === 'redundant' || worker.state === 'activated') {
    // Another tab may already have activated the version advertised here.
    updateReloading = true;
    location.reload();
    return;
  }
  worker.addEventListener('statechange', () => {
    if (worker.state === 'redundant' && !updateReloading) {
      updateReloading = true;
      location.reload();
    }
  });
  worker.postMessage({ type: 'SKIP_WAITING' });
}

function connection() {
  if ($('#connection-status')) $('#connection-status').innerHTML = `<span class="status-dot ${navigator.onLine ? '' : 'pending'}"></span>${navigator.onLine ? 'Online' : 'Offline'}`;
}

function runSearch() {
  if (!state.ready) return;
  if (state.direction === 'en') setDirection(detectDirection($('#search').value, state.direction));
  state.query = banglaInput.getQuery().trim(); state.limit = 40;
  if (location.hash.startsWith('#word/')) location.hash = 'dictionary';
  else render();
}

$('#search').addEventListener('input', event => { if (event.isComposing) return; clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 120); });
$('#search').addEventListener('compositionend', () => { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 120); });
$('#search-form').addEventListener('submit', event => { event.preventDefault(); banglaInput.commit(); clearTimeout(searchTimer); runSearch(); });
$('#bangla-toggle').addEventListener('click', () => { setDirection('bn'); banglaInput.toggleKeyboard(); runSearch(); });
document.querySelectorAll('[data-direction]').forEach(button => button.addEventListener('click', () => {
  chooseDirection(button.dataset.direction);
  $('#search').focus();
}));
document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.open) openWord(button.dataset.open);
  if (button.dataset.save) toggleSave(button.dataset.save);
  if (button.dataset.speak) speak(button.dataset.speak);
  if (button.dataset.action === 'home') home();
  if (button.dataset.action === 'more') { state.limit += 40; render(); }
  if (button.dataset.action === 'back') { location.hash = 'dictionary'; render(); }
  if (button.dataset.action === 'surprise' && state.ready) {
    discoverAnotherWord(button.closest('.word-card'));
  }
});
document.addEventListener('keydown', event => {
  if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) && !$('#info-dialog').open) {
    event.preventDefault(); $('#search').focus();
  }
});
$('.brand').addEventListener('click', home);
$('#nav-saved').addEventListener('click', () => { state.query = ''; $('#search').value = ''; banglaInput.refresh(); if (location.hash === '#saved') render(); });
$('#clear-history').addEventListener('click', () => { state.recent = []; persist('recent', []); renderRecent(); toast('Recent words cleared.'); });

$('#close-dialog').addEventListener('click', () => $('#info-dialog').close());
$('#info-dialog').addEventListener('click', event => { if (event.target === $('#info-dialog')) { const bounds = event.target.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) event.target.close(); } });
$('#help-button').addEventListener('click', () => dialog('Help', `
  <div class="help-content"><ul class="help-list">
  <li><h3>Word collection</h3><p>${state.ready ? `Explore ${state.stats.lexicalHeadwordCount.toLocaleString('en-US')} defined English and Bangla words and phrases, including ${state.stats.lexicalSingleWordCount.toLocaleString('en-US')} single words and ${state.stats.lexicalPhraseCount.toLocaleString('en-US')} phrases.` : 'Your word collection statistics will appear once the dictionary finishes loading.'}</p></li>
  <li><h3>Dictionary credits</h3><p>Adapted from Wiktionary contributors and the supplementary dictionaries. <a href="./data/THIRD_PARTY_NOTICES.md" target="_blank" rel="noopener noreferrer">Sources and licenses</a>.</p></li>
  <li><h3>Search & discover</h3><p>Choose a language and type a word. Press <kbd>/</kbd> to focus search.</p></li>
  <li><h3>Save & listen</h3><p>Bookmark words to keep them on this device. Tap the speaker for pronunciation when a device voice is available.</p></li>
  <li><h3>Use offline</h3><p>Let the first download finish online. Search and Bangla typing then work offline. Choose Update when a new version is ready.</p></li>
  <li><h3>Install on your phone</h3><p>iPhone: Safari → Share → Add to Home Screen.<br>Android or desktop: browser menu → Install app.</p></li>
  <li><h3>Type in Bangla</h3><p>Type <strong>boi</strong> → বই; Space or Enter inserts it. Type Bangla directly or use English letters for automatic phonetic input; the keyboard button in search opens Bangla letters.</p><details class="help-typing-guide"><summary>Typing guide</summary>${$('#typing-guide-content').innerHTML}</details></li>
  </ul></div>
`));
$('#dismiss-update').addEventListener('click', () => { updateDismissed = true; $('#update-banner').hidden = true; });
$('#update-button').addEventListener('click', applyOfflineUpdate);
window.addEventListener('hashchange', render);
window.addEventListener('online', connection); window.addEventListener('offline', connection);
window.addEventListener('appinstalled', () => toast('শব্দকোষ is now at home on your device.'));
window.addEventListener('storage', event => { if (event.key?.startsWith('shobdokosh-')) { state.saved = readList('shobdokosh-saved'); state.recent = readList('shobdokosh-recent'); updateCounts(); renderRecent(); render(); } });
if (location.hash === '#literature') history.replaceState(null, '', '#dictionary');
connection(); setDirection(state.direction);

try {
  const load = async (path) => { const response = await fetch(path); if (!response.ok) throw new Error('Dictionary load failed'); return unpackDictionary(await response.json()); };
  const [data, expanded, literary, bengaliEdition, reading, native, englishDefinitions, summary, featured] = await Promise.all([
    load('./data/dictionary.json'), load('./data/expanded-dictionary.json'),
    load('./data/literary-dictionary.json'), load('./data/bn-wiktionary-dictionary.json'),
    load('./data/reading-dictionary.json'), load('./data/native-bengali.json'),
    load('./data/english-bangla-definitions.json'), load('./data/vocabulary-summary.json'),
    load('./data/featured.json'),
  ]);
  if (!Array.isArray(data.entries) || !Array.isArray(expanded.entries) || !Array.isArray(literary.entries) || !Array.isArray(bengaliEdition.entries) || !Array.isArray(reading.entries) || !Array.isArray(native.entries) || !Array.isArray(englishDefinitions.entries) || !summary.stats || !Array.isArray(featured) || !featured.length) throw new Error('Dictionary format is invalid');
  state.meta = { ...data.meta, entryCount: data.entries.length + expanded.entries.length + literary.entries.length + bengaliEdition.entries.length + reading.entries.length + native.entries.length + englishDefinitions.entries.length }; state.expandedMeta = expanded.meta; state.literaryMeta = literary.meta; state.featured = featured;
  state.entries = [...featured, ...literary.entries, ...data.entries, ...expanded.entries, ...bengaliEdition.entries, ...reading.entries, ...native.entries, ...englishDefinitions.entries];
  state.byId = new Map(state.entries.map(entry => [entry.id, entry])); state.index = buildIndex(state.entries);
  state.stats = summary.stats;
  if (state.stats.senseCount !== state.entries.length) throw new Error('Dictionary summary is out of date');
  state.ready = true;
  if ($('#dictionary-count')) $('#dictionary-count').textContent = `${state.stats.lexicalHeadwordCount.toLocaleString()} defined words & phrases · English + বাংলা`;
  updateCounts(); renderRecent(); render();
  banglaInput.refresh();
  if ($('#search').value) runSearch();
} catch {
  state.error = true;
  if ($('#dictionary-count')) $('#dictionary-count').textContent = 'Dictionary could not be loaded';
  $('#results').setAttribute('aria-busy', 'false');
  $('#results').innerHTML = '<div class="empty-state"><h3>Your dictionary needs a moment</h3><p>Connect to the internet and reload this page to download the dictionary for your first visit.</p><button id="retry-load">Try again</button></div>';
  $('#retry-load').addEventListener('click', () => location.reload());
}
setupOffline();
