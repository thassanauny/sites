import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../dist/app.js', import.meta.url), 'utf8');
const readDirection = source.slice(source.indexOf('function readDirection()'), source.indexOf('const state ='));
const setDirection = source.slice(source.indexOf('function setDirection('), source.indexOf('function updateCounts()'));

function page(storage, direction = 'en') {
  const selections = [];
  const context = vm.createContext({
    localStorage: storage, state: { direction },
    persist(key, value) { storage.setItem('shobdokosh-' + key, JSON.stringify(value)); },
    document: { querySelectorAll() { return []; } },
    banglaInput: { setDirection(value) { selections.push(value); } },
  });
  vm.runInContext(readDirection + setDirection, context);
  return { context, selections };
}

test('both translation directions survive a new page load', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  for (const direction of ['bn', 'en']) {
    const first = page(storage, direction === 'bn' ? 'en' : 'bn');
    first.context.setDirection(direction);
    const reloaded = page(storage);
    assert.equal(reloaded.context.readDirection(), direction);
    reloaded.context.state.direction = reloaded.context.readDirection();
    reloaded.context.setDirection(reloaded.context.state.direction);
    assert.deepEqual(reloaded.selections, [direction]);
  }
});

test('missing, damaged and unavailable direction storage defaults to English', () => {
  for (const value of [null, 'broken', '"other"', '{}']) {
    assert.equal(page({ getItem: () => value }).context.readDirection(), 'en');
  }
  assert.equal(page({ getItem() { throw new Error('Storage denied'); } }).context.readDirection(), 'en');
});

test('choosing a direction keeps typed text and immediately searches in the selected direction', () => {
  const values = new Map();
  const { context } = page({ getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) }, 'bn');
  const input = { value: 'bolod' };
  let renders = 0;
  context.searchTimer = null;
  context.clearTimeout = () => {};
  context.location = { hash: '#dictionary' };
  context.render = () => { renders++; };
  context.banglaInput.getQuery = () => context.state.direction === 'bn' ? 'বলদ' : input.value;
  context.state.limit = 80;
  context.chooseDirection('en');
  assert.equal(input.value, 'bolod');
  assert.equal(context.state.direction, 'en');
  assert.equal(context.state.query, 'bolod');
  assert.equal(context.state.limit, 40);
  context.chooseDirection('bn');
  assert.equal(input.value, 'bolod');
  assert.equal(context.state.direction, 'bn');
  assert.equal(context.state.query, 'বলদ');
  assert.equal(renders, 2);
});
