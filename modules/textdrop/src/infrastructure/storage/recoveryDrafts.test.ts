// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RecoveryDrafts } from './recoveryDrafts';
const page = { id: '00000000-0000-4000-8000-000000000001', code: 'a'.repeat(32), text: 'Shared', name: null, version: 1, updatedAt: '2026-10-18T00:00:00Z' };
beforeEach(() => localStorage.clear());
describe('recovery copy isolation', () => {
  it('retains another editor’s unsaved text when a recovered copy is accepted', () => {
    const first = new RecoveryDrafts();
    const second = new RecoveryDrafts();
    first.write(page, 'First draft');
    second.write(page, 'Second draft');
    const reopened = new RecoveryDrafts();
    expect(reopened.read(page)).toBe('Second draft');
    first.write(page, 'First editor typed again');
    reopened.clear(page);
    expect(new RecoveryDrafts().read(page)).toBe('First editor typed again');
  });
  it('does not remove a newer copy written after recovery was read', () => {
    const first = new RecoveryDrafts();
    first.write(page, 'Old draft');
    const reopened = new RecoveryDrafts();
    expect(reopened.read(page)).toBe('Old draft');
    first.write(page, 'Newer draft');
    reopened.clear(page);
    expect(new RecoveryDrafts().read(page)).toBe('Newer draft');
  });
  it('preserves an earlier copy if a new write fails', () => {
    const drafts = new RecoveryDrafts();
    drafts.write(page, 'Kept');
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Quota');
    });
    expect(() => drafts.write(page, 'Failed')).toThrow();
    write.mockRestore();
    expect(new RecoveryDrafts().read(page)).toBe('Kept');
  });
});
