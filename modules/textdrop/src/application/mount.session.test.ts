// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost/textdrop/#/"}
import { describe, expect, it, vi } from 'vitest';
import { useMountHarness, first, cloud, element, flush, join, start } from '../../tests/mountHarness';
import { SessionDamagedError } from '../domain/snippets/model';

useMountHarness();

const damaged = () => new SessionDamagedError('Your saved TextDrop session in this browser is damaged.');

describe('TextDrop damaged saved session', () => {
  it('offers Start a new session in the Open dialog, repairs, and lets the person try again', async () => {
    vi.mocked(cloud.joinPage).mockRejectedValueOnce(damaged());
    await start();
    await join(first.code);
    expect(element('dialog-error').textContent).toContain('damaged');
    expect(element('dialog-new-session').hidden).toBe(false);
    element('dialog-new-session').click();
    await flush();
    expect(cloud.startNewSession).toHaveBeenCalledTimes(1);
    expect(element('dialog-error').hidden).toBe(true);
    expect(element('dialog-new-session').hidden).toBe(true);
    await join(first.code);
    expect(cloud.joinPage).toHaveBeenCalledTimes(2);
    expect(element('workspace').hidden).toBe(false);
  });

  it('offers it in the notice when a poll finds the session damaged, and not for other errors', async () => {
    await start(`#/p/${first.code}`);
    vi.mocked(cloud.pollPage).mockRejectedValueOnce(new Error('Poll failed'));
    await vi.advanceTimersByTimeAsync(3000);
    expect(element('notice-message').textContent).toBe('Poll failed');
    expect(element('new-session').hidden).toBe(true);
    vi.mocked(cloud.pollPage).mockRejectedValueOnce(damaged());
    await vi.advanceTimersByTimeAsync(6000);
    expect(element('notice-message').textContent).toContain('damaged');
    expect(element('new-session').hidden).toBe(false);
    element('new-session').click();
    await flush();
    expect(cloud.startNewSession).toHaveBeenCalledTimes(1);
    expect(element('notice').hidden).toBe(true);
    expect(element('new-session').hidden).toBe(true);
  });

  it('keeps the action visible with the reason when starting a new session fails', async () => {
    vi.mocked(cloud.joinPage).mockRejectedValueOnce(damaged());
    vi.mocked(cloud.startNewSession).mockRejectedValueOnce(new Error('Could not start a new TextDrop session.'));
    await start();
    await join(first.code);
    element('dialog-new-session').click();
    await flush();
    expect(element('dialog-error').textContent).toBe('Could not start a new TextDrop session.');
    expect(element('dialog-new-session').hidden).toBe(false);
  });
});
