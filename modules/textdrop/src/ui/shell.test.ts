// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { shell, shellElements } from './shell';

function mounted(): HTMLDivElement {
  const root = document.createElement('div');
  root.innerHTML = shell();
  return root;
}

describe('page template', () => {
  it('has unique ids and every label, description and heading reference points at an element', () => {
    const root = mounted();
    const ids = [...root.querySelectorAll('[id]')].map(item => item.id);
    expect(ids.length).toBeGreaterThan(50);
    expect(new Set(ids).size).toBe(ids.length);
    for (const item of root.querySelectorAll('[for], [aria-describedby], [aria-labelledby]')) {
      const references = [item.getAttribute('for'), ...(item.getAttribute('aria-describedby') ?? '').split(' '), ...(item.getAttribute('aria-labelledby') ?? '').split(' ')].filter(
        (reference): reference is string => Boolean(reference),
      );
      expect(references.length).toBeGreaterThan(0);
      for (const reference of references) expect(root.querySelector(`#${reference}`), `${item.tagName}#${item.id} -> #${reference}`).not.toBeNull();
    }
  });

  it('finds every element the app uses, with the element type the code relies on', () => {
    const elements = shellElements(mounted());
    const tags: Record<string, string[]> = {
      BUTTON: [
        'create',
        'join',
        'share',
        'settings',
        'copyCode',
        'copyText',
        'download',
        'retry',
        'dialogClose',
        'createConfirm',
        'createCancel',
        'joinConfirm',
        'joinCancel',
        'inviteCopyCode',
        'inviteCopyLink',
        'settingsRename',
        'settingsRemove',
        'renameConfirm',
        'renameCancel',
        'removeCopyCode',
        'removeCopyText',
        'removeConfirm',
        'removeCancel',
      ],
      INPUT: ['joinCode', 'inviteCode', 'snippetNameInput', 'removeCode', 'removeDiscard'],
      FORM: ['createForm', 'joinForm', 'renameForm', 'removeForm'],
      TEXTAREA: ['editor'],
      DIALOG: ['dialog'],
    };
    const typed = new Set(Object.values(tags).flat());
    for (const [tag, keys] of Object.entries(tags)) {
      for (const key of keys) expect(elements[key as keyof typeof elements].tagName, key).toBe(tag);
    }
    const others = Object.keys(elements).filter(key => !typed.has(key));
    expect(others.length).toBeGreaterThan(20);
    for (const key of others) expect(elements[key as keyof typeof elements], key).toBeInstanceOf(HTMLElement);
    expect(Object.keys(elements)).toHaveLength(typed.size + others.length);
  });

  it('names the missing element when the page lacks one', () => {
    expect(() => shellElements(document.createElement('div'))).toThrow('The TextDrop page is missing #connection.');
    const root = mounted();
    root.querySelector('#save-announcement')!.remove();
    expect(() => shellElements(root)).toThrow('missing #save-announcement');
  });
});
