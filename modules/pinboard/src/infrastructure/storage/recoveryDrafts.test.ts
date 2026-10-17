// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { RecoveryDraft } from './recoveryDrafts';
const valid = (value: unknown): value is { title: string } =>
  !!value && typeof value === 'object' && typeof (value as { title: unknown }).title === 'string';
beforeEach(() => localStorage.clear());
describe('recovery copy isolation', () => {
  it('keeps drafts from separate editors when one recovered copy is cleared', () => {
    const first = new RecoveryDraft<{ title: string }>('board:card');
    const second = new RecoveryDraft<{ title: string }>('board:card');
    first.write({ title: 'First' });
    second.write({ title: 'Second' });
    const reopened = new RecoveryDraft<{ title: string }>('board:card');
    expect(reopened.read(valid)).toEqual({ title: 'Second' });
    first.write({ title: 'New first edit' });
    reopened.clear();
    expect(new RecoveryDraft('board:card').read(valid)).toEqual({ title: 'New first edit' });
  });
  it('preserves newer edits and damaged records when clearing or reading', () => {
    const first = new RecoveryDraft<{ title: string }>('board:card');
    first.write({ title: 'Old' });
    const reopened = new RecoveryDraft<{ title: string }>('board:card');
    reopened.read(valid);
    first.write({ title: 'New' });
    reopened.clear();
    expect(new RecoveryDraft('board:card').read(valid)).toEqual({ title: 'New' });
    const key = localStorage.key(0)!;
    localStorage.setItem(key, '{broken');
    expect(() => new RecoveryDraft('board:card').read(valid)).toThrow();
    expect(localStorage.getItem(key)).toBe('{broken');
  });
});
