import { afterEach, expect, it, vi } from 'vitest';
import { dashboard } from '../src/features/dashboard/dashboard';
import { ACTIVITY_KEY, Store } from '../src/infrastructure/storage';
import { mainRoot } from './helpers';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

it('refreshes activity from another tab without resetting search and removes its listener when leaving', () => {
  localStorage.clear();
  const root = mainRoot();
  const cleanup = dashboard(root);
  const query = root.querySelector<HTMLInputElement>('#utility-search')!;
  query.value = 'PDFs';
  query.dispatchEvent(new Event('input'));
  query.focus();
  const otherTab = new Store(localStorage);
  otherTab.addActivity({ tool: 'compress-pdf', message: 'From another tab', status: 'done' });
  expect(root.querySelector('.activity')!.textContent).not.toContain('From another tab');
  window.dispatchEvent(new StorageEvent('storage', { key: ACTIVITY_KEY, storageArea: localStorage }));
  expect(root.querySelector('.activity')!.textContent).toContain('From another tab');
  expect(query.value).toBe('PDFs');
  expect(document.activeElement).toBe(query);
  expect(root.querySelector('#utility-count')!.textContent).toBe('6 of 13 utilities');
  otherTab.clearActivity();
  window.dispatchEvent(new StorageEvent('storage', { key: null, storageArea: localStorage }));
  expect(root.querySelector('.activity')!.textContent).toContain('No recent activity');
  cleanup();
  otherTab.addActivity({ tool: 'qr-generator', message: 'After leaving', status: 'done' });
  window.dispatchEvent(new StorageEvent('storage', { key: ACTIVITY_KEY, storageArea: localStorage }));
  expect(root.querySelector('.activity')!.textContent).not.toContain('After leaving');
});
