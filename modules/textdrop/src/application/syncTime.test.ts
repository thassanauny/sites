import { describe, expect, it, vi } from 'vitest';
import type { RemoteCloud } from './ports';
import { withSyncTime } from './syncTime';

describe('confirmed remote sync times', () => {
  it('timestamps unchanged polls, preserves the time after failure and unsubscribes', async () => {
    const remote = { pollPage: vi.fn().mockResolvedValue(null) } as unknown as RemoteCloud;
    const cloud = withSyncTime(remote);
    const listener = vi.fn();
    const stop = cloud.subscribeSync!(listener);
    expect(listener).not.toHaveBeenCalled();
    await cloud.pollPage('page', 1);
    expect(listener).toHaveBeenCalledOnce();
    const at = listener.mock.calls[0]![0];
    vi.mocked(remote.pollPage).mockRejectedValueOnce(new Error('Offline'));
    await expect(cloud.pollPage('page', 1)).rejects.toThrow('Offline');
    expect(listener).toHaveBeenCalledOnce();
    stop();
    await cloud.pollPage('page', 1);
    expect(listener).toHaveBeenCalledOnce();
    const next = vi.fn();
    cloud.subscribeSync!(next);
    expect(next.mock.calls[0]![0].getTime()).toBeGreaterThanOrEqual(at.getTime());
  });
  it('never advances after rejected remote requests or an empty names lookup', async () => {
    const remote = { pollPage: vi.fn().mockRejectedValue(new Error('Network unavailable')), listNames: vi.fn().mockResolvedValue([]) } as unknown as RemoteCloud;
    const cloud = withSyncTime(remote);
    const listener = vi.fn();
    cloud.subscribeSync!(listener);
    await expect(cloud.pollPage('page', 1)).rejects.toThrow('Network unavailable');
    await cloud.listNames!([]);
    expect(listener).not.toHaveBeenCalled();
    await cloud.listNames!(['code']);
    expect(listener).toHaveBeenCalledOnce();
  });
});
