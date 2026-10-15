// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost/"}
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { cloud } from './cloudMock';
import {
  board,
  card,
  choose,
  click,
  field,
  fill,
  installHarness,
  mount,
  refresh,
  select,
  uuid,
} from './testSupport';
import type { Board, CardFieldSettings } from '../domain/boards/types';

vi.mock('../infrastructure/cloud/boards', async () => (await import('./cloudMock')).cloudModule);
installHarness();

const linkId = uuid(80);
const teamId = uuid(81);
const settings: CardFieldSettings = {
  hidden: [],
  custom: [
    { id: linkId, title: 'Project link', hidden: false },
    { id: teamId, title: 'Team', hidden: false },
  ],
};
const configured: Board = {
  ...board,
  card_fields: settings,
  cards: [
    {
      ...card,
      description: 'Keep these details',
      labels: ['Travel'],
      dueDate: '2030-05-17',
      customFields: { [linkId]: 'Planning notes', [teamId]: 'Supply' },
    },
  ],
};

async function toggle(name: string) {
  const label = [...document.querySelectorAll('.field-visibility-options label')].find(
    (label) => label.textContent?.trim() === name,
  )!;
  await act(async () => label.querySelector<HTMLInputElement>('input')!.click());
}

describe('Pinboard card fields and board controls', () => {
  it('hides built-in fields without clearing values, and shows them again', async () => {
    await mount([configured]);
    await click('Settings');
    for (const name of ['Description', 'Priority', 'Assignee', 'Due date', 'Labels'])
      await toggle(name);
    const hidden: CardFieldSettings = {
      ...settings,
      hidden: ['description', 'priority', 'assignee', 'dueDate', 'labels'],
    };
    const saved = { ...configured, revision: 2, card_fields: hidden };
    cloud.mutateBoard.mockResolvedValueOnce(saved);
    await click('Save details');
    expect(cloud.mutateBoard).toHaveBeenCalledWith(board.id, {
      type: 'update_board',
      patch: { card_fields: hidden },
    });
    expect(
      document.querySelector(
        '.task-card .priority, .task-card .card-description, .task-card .labels, .task-card .card-meta',
      ),
    ).toBeNull();
    expect(
      document.querySelector('[aria-label="Filter priority"], [aria-label="Filter assignee"]'),
    ).toBeNull();
    await click('Edit Buy coffee');
    for (const name of [
      'Description optional',
      'Due date optional',
      'Labels optional · separated by commas',
    ])
      expect(() => field(name)).toThrow('Field not found');
    await fill('Card title', 'Buy tea');
    const renamed = { ...saved, revision: 3, cards: [{ ...saved.cards[0]!, title: 'Buy tea' }] };
    cloud.mutateBoard.mockResolvedValueOnce(renamed);
    await click('Save');
    expect(cloud.mutateBoard).toHaveBeenLastCalledWith(board.id, {
      type: 'update_card',
      id: card.id,
      patch: { title: 'Buy tea' },
    });
    await click('Settings');
    for (const name of ['Description', 'Priority', 'Assignee', 'Due date', 'Labels'])
      await toggle(name);
    cloud.mutateBoard.mockResolvedValueOnce({ ...renamed, revision: 4, card_fields: settings });
    await click('Save details');
    expect(document.querySelector('.task-card')?.textContent).toContain('Keep these details');
    expect(document.querySelector('.task-card')?.textContent).toContain('Travel');
    await click('Edit Buy tea');
    expect(field('Due date optional').value).toBe('2030-05-17');
  });

  it('retains new field names and IDs on failure, then creates a card with its custom value', async () => {
    await mount();
    await click('Settings');
    await click('Add field');
    await fill('Field 1 name', 'Project link');
    cloud.mutateBoard.mockRejectedValueOnce(new Error('Database update required'));
    await click('Save details');
    const first = cloud.mutateBoard.mock.calls[0]![1];
    expect(field('Field 1 name').value).toBe('Project link');
    const fields = first.patch.card_fields as CardFieldSettings;
    const saved = { ...board, revision: 2, card_fields: fields };
    cloud.mutateBoard.mockResolvedValueOnce(saved);
    await click('Save details');
    expect(cloud.mutateBoard.mock.calls[1]![1]).toEqual(first);
    await click('Add a card', document.querySelector('section[aria-label="To do"]')!);
    await fill('Card title', 'Read the plan');
    await fill('Project link optional', 'Planning notes');
    cloud.mutateBoard.mockImplementationOnce(async (_id, operation) => ({
      ...saved,
      revision: 3,
      cards: [operation.card],
    }));
    await click('Save');
    expect(cloud.mutateBoard.mock.calls[2]![1].card.customFields).toEqual({
      [fields.custom[0]!.id]: 'Planning notes',
    });
    expect(document.querySelector('.card-custom-fields')?.textContent).toContain('Planning notes');
  });

  it('sends only the custom field edited while another member changes a different one', async () => {
    await mount([configured]);
    await click('Edit Buy coffee');
    await fill('Project link optional', 'Updated plan');
    const concurrent = {
      ...configured,
      revision: 2,
      cards: [
        {
          ...configured.cards[0]!,
          customFields: { [linkId]: 'Planning notes', [teamId]: 'Platform' },
        },
      ],
    };
    cloud.loadBoards.mockResolvedValueOnce([concurrent]);
    await refresh();
    cloud.mutateBoard.mockResolvedValueOnce({
      ...concurrent,
      revision: 3,
      cards: [
        {
          ...concurrent.cards[0]!,
          customFields: { [linkId]: 'Updated plan', [teamId]: 'Platform' },
        },
      ],
    });
    await click('Save');
    expect(cloud.mutateBoard).toHaveBeenCalledWith(board.id, {
      type: 'update_card',
      id: card.id,
      patch: { customFields: { [linkId]: 'Updated plan' } },
    });
    expect(document.querySelector('.card-custom-fields')?.textContent).toContain('Platform');
  });

  it('hides custom values in cards and editors without touching an existing value', async () => {
    const source = {
      ...configured,
      card_fields: {
        ...settings,
        custom: settings.custom.map((field) => ({ ...field, hidden: true })),
      },
    };
    await mount([source]);
    expect(document.querySelector('.card-custom-fields')).toBeNull();
    await click('Edit Buy coffee');
    expect(() => field('Project link optional')).toThrow('Field not found');
    await fill('Card title', 'Renamed');
    cloud.mutateBoard.mockResolvedValueOnce({ ...source, revision: 2 });
    await click('Save');
    expect(cloud.mutateBoard).toHaveBeenCalledWith(board.id, {
      type: 'update_card',
      id: card.id,
      patch: { title: 'Renamed' },
    });
  });

  it('ignores filters for newly hidden fields and searches visible custom values', async () => {
    await mount([configured]);
    await select('Filter priority', 'high');
    expect(document.querySelector('.task-card')).toBeNull();
    cloud.loadBoards.mockResolvedValueOnce([
      { ...configured, revision: 2, card_fields: { ...settings, hidden: ['priority'] } },
    ]);
    await refresh();
    expect(document.querySelector('.task-card')).not.toBeNull();
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Search cards"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')!.set!.call(
        input,
        'Planning notes',
      );
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(document.querySelector('.task-card h3')?.textContent).toBe('Buy coffee');
  });

  it('adds a column from settings with stable retries while keeping a board-name draft', async () => {
    await mount();
    await click('Settings');
    await fill('Board name', 'My draft name');
    await click('Add column', document.querySelector('dialog')!);
    await fill('New column name', 'Review');
    await choose('New column color', 'violet');
    cloud.mutateBoard.mockRejectedValueOnce(new Error('Response lost'));
    await click('Create column');
    const first = cloud.mutateBoard.mock.calls[0]![1];
    expect(field('New column name').value).toBe('Review');
    expect(field('Board name').value).toBe('My draft name');
    const saved = { ...board, revision: 2, columns: [...board.columns, first.column] };
    cloud.mutateBoard.mockResolvedValueOnce(saved);
    await click('Create column');
    expect(cloud.mutateBoard.mock.calls[1]![1]).toEqual(first);
    expect(document.querySelector('dialog')?.textContent).toContain('Review');
    expect(field('Board name').value).toBe('My draft name');
    cloud.mutateBoard.mockResolvedValueOnce({ ...saved, title: 'My draft name', revision: 3 });
    await click('Save details');
    expect(cloud.mutateBoard).toHaveBeenLastCalledWith(board.id, {
      type: 'update_board',
      patch: { title: 'My draft name' },
    });
  });

  it('adds assignees in settings with retries and only selects existing names on cards', async () => {
    const source = {
      ...board,
      cards: [
        card,
        { ...card, id: uuid(2), title: 'Sam task', assignee: 'Sam' },
        { ...card, id: uuid(3), title: 'Another' },
      ],
    };
    await mount([source]);
    await click('Edit Buy coffee');
    const names = () =>
      [...document.querySelectorAll<HTMLSelectElement>('dialog select')].find((menu) =>
        [...menu.options].some((option) => option.text === 'Unassigned'),
      )!;
    expect([...names().options].map((option) => option.text)).toEqual([
      'Unassigned',
      'Alex',
      'Sam',
    ]);
    expect(() => field('New assignee')).toThrow('Field not found');
    await click('Cancel');
    await click('Settings');
    await fill('New assignee', 'Morgan');
    cloud.mutateBoard.mockRejectedValueOnce(new Error('Response lost'));
    await click('Add assignee');
    expect(field('New assignee').value).toBe('Morgan');
    const configured = {
      ...source,
      revision: 2,
      card_fields: { hidden: [], custom: [], assignees: ['Alex', 'Sam', 'Morgan'] },
    };
    cloud.mutateBoard.mockResolvedValueOnce(configured);
    await click('Add assignee');
    expect(cloud.mutateBoard).toHaveBeenLastCalledWith(board.id, {
      type: 'add_assignee',
      name: 'Morgan',
    });
    expect(field('New assignee').value).toBe('');
    await click('Close');
    await click('Edit Buy coffee');
    expect([...names().options].map((option) => option.text)).toEqual([
      'Unassigned',
      'Alex',
      'Morgan',
      'Sam',
    ]);
    await choose('Assignee', 'name:Sam');
    await choose('Assignee', 'name:Morgan');
    cloud.mutateBoard.mockRejectedValueOnce(new Error('Response lost'));
    await click('Save');
    expect(names().value).toBe('name:Morgan');
    const saved = {
      ...configured,
      revision: 3,
      cards: [{ ...card, assignee: 'Morgan' }, ...source.cards.slice(1)],
    };
    cloud.mutateBoard.mockResolvedValueOnce(saved);
    await click('Save');
    expect(cloud.mutateBoard).toHaveBeenLastCalledWith(board.id, {
      type: 'update_card',
      id: card.id,
      patch: { assignee: 'Morgan' },
    });
    await click('Edit Buy coffee');
    expect([...names().options].map((option) => option.text)).toContain('Morgan');
    await choose('Assignee', '');
    cloud.mutateBoard.mockResolvedValueOnce({
      ...saved,
      revision: 4,
      cards: source.cards.map((item) => (item.id === card.id ? { ...item, assignee: '' } : item)),
    });
    await click('Save');
    expect(cloud.mutateBoard).toHaveBeenLastCalledWith(board.id, {
      type: 'update_card',
      id: card.id,
      patch: { assignee: '' },
    });
  });

  it('deletes an assignee and clears their active and archived cards without losing settings drafts', async () => {
    const source = {
      ...board,
      cards: [
        card,
        { ...card, id: uuid(8), title: 'Old work', archived: true },
        { ...card, id: uuid(9), title: 'Sam task', assignee: 'Sam' },
      ],
    };
    await mount([source]);
    await click('Settings');
    await fill('Board name', 'Keep this draft');
    await click('Delete assignee Alex');
    expect(document.querySelector('.delete-confirm')?.textContent).toContain(
      'including archived cards',
    );
    cloud.mutateBoard.mockRejectedValueOnce(new Error('Response lost'));
    await click('Delete assignee');
    expect(document.querySelector('.assignee-list')?.textContent).toContain('Alex');
    expect(field('Board name').value).toBe('Keep this draft');
    const saved = {
      ...source,
      revision: 2,
      card_fields: { hidden: [], custom: [], assignees: ['Sam'] },
      cards: source.cards.map((item) =>
        item.assignee === 'Alex' ? { ...item, assignee: '' } : item,
      ),
    };
    cloud.mutateBoard.mockResolvedValueOnce(saved);
    await click('Delete assignee');
    expect(cloud.mutateBoard).toHaveBeenLastCalledWith(board.id, {
      type: 'delete_assignee',
      name: 'Alex',
    });
    expect(document.querySelector('.assignee-list')?.textContent).not.toContain('Alex');
    expect(document.querySelector(`[data-card-id="${card.id}"] .person`)).toBeNull();
    expect(document.querySelector(`[data-card-id="${uuid(9)}"] .person`)?.textContent).toContain(
      'Sam',
    );
    expect(field('Board name').value).toBe('Keep this draft');
    cloud.mutateBoard.mockResolvedValueOnce({ ...saved, revision: 3, title: 'Keep this draft' });
    await click('Save details');
    expect(cloud.mutateBoard).toHaveBeenLastCalledWith(board.id, {
      type: 'update_board',
      patch: { title: 'Keep this draft' },
    });
    await click('Edit Buy coffee');
    const menu = [...document.querySelectorAll<HTMLSelectElement>('dialog select')].find((item) =>
      [...item.options].some((option) => option.text === 'Unassigned'),
    )!;
    expect([...menu.options].map((option) => option.text)).toEqual(['Unassigned', 'Sam']);
    expect(menu.value).toBe('');
  });

  it('hides the assignee filter and stops applying its previous selection when the field is hidden', async () => {
    await mount([{ ...board, cards: [card] }]);
    await select('Filter assignee', 'name:');
    expect(document.querySelector('.task-card')).toBeNull();
    await click('Settings');
    await toggle('Assignee');
    cloud.mutateBoard.mockResolvedValueOnce({
      ...board,
      cards: [card],
      revision: 2,
      card_fields: { hidden: ['assignee'], custom: [] },
    });
    await click('Save details');
    expect(document.querySelector('[aria-label="Filter assignee"]')).toBeNull();
    expect(document.querySelector('.task-card h3')?.textContent).toBe('Buy coffee');
    expect(document.querySelector('.filter-summary')).toBeNull();
    expect(document.querySelector('.sidebar-visible-cards')?.textContent).toContain(
      'Showing 1 of 1 card',
    );
  });

  it('replaces redundant navigation and promotion with live counts and retains workspace actions', async () => {
    const today = new Date().toLocaleDateString('en-CA');
    await mount([
      {
        ...board,
        cards: [
          { ...card, dueDate: today },
          { ...card, id: uuid(2), dueDate: '2000-01-01' },
        ],
      },
      {
        ...board,
        id: uuid(50),
        invite_code: 'b'.repeat(32),
        card_fields: { hidden: ['dueDate'], custom: [] },
        cards: [{ ...card, dueDate: '2000-01-01' }],
      },
    ]);
    expect(document.querySelector('.breadcrumb, .nav-home, .together-note')).toBeNull();
    const overview = () => document.querySelector('[aria-label="Current board overview"]');
    expect([...overview()!.querySelectorAll('dd')].map((item) => item.textContent)).toEqual([
      '3',
      '2',
      '1',
      '1',
    ]);
    await act(async () => {
      document.querySelectorAll<HTMLButtonElement>('.board-nav-item')[1]!.click();
    });
    expect([...overview()!.querySelectorAll('dd')].map((item) => item.textContent)).toEqual([
      '3',
      '1',
    ]);
    await click('Open workspace');
    expect(document.querySelector('.home')).not.toBeNull();
    expect(overview()).toBeNull();
    await click('Create a board');
    expect(document.querySelector('dialog')?.textContent).toContain('Board name');
  });
});
