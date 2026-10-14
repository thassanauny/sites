import { afterEach, describe, expect, it, vi } from 'vitest';
import { unlockPdfInWorker } from '../src/domain/pdf/unlockClient';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  terminated = false;
  posted: unknown[] = [];
  failPost = false;
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(message: unknown) {
    if (this.failPost) throw new Error('clone failed');
    this.posted.push(message);
  }
  terminate() {
    this.terminated = true;
  }
  reply(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeWorker.instances = [];
});
const start = (signal = new AbortController().signal) => {
  vi.stubGlobal('Worker', FakeWorker);
  return unlockPdfInWorker(new Uint8Array([1, 2, 3]), 'secret', signal);
};

describe('unlockPdfInWorker', () => {
  it('sends the bytes and password, resolves with the result and terminates the worker', async () => {
    const promise = start();
    const worker = FakeWorker.instances[0];
    expect(worker.posted[0]).toMatchObject({ password: 'secret' });
    const result = { bytes: new Uint8Array([9]), pages: 1, alreadyUnlocked: false };
    worker.reply({ result });
    await expect(promise).resolves.toBe(result);
    expect(worker.terminated).toBe(true);
  });
  it('maps a worker error message, a crash and a failed hand-over to readable errors and terminates', async () => {
    const failed = start();
    FakeWorker.instances[0].reply({ error: 'Incorrect password.' });
    await expect(failed).rejects.toThrow('Incorrect password.');
    expect(FakeWorker.instances[0].terminated).toBe(true);
    const silent = start();
    FakeWorker.instances[1].reply({});
    await expect(silent).rejects.toThrow('Could not unlock this PDF.');
    const crashed = start();
    FakeWorker.instances[2].onerror?.();
    await expect(crashed).rejects.toThrow(/worker could not run/);
    expect(FakeWorker.instances[2].terminated).toBe(true);
  });
  it('terminates the worker and rejects with AbortError when cancelled, and ignores a late reply', async () => {
    const controller = new AbortController();
    const promise = start(controller.signal);
    const worker = FakeWorker.instances[0];
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(worker.terminated).toBe(true);
    worker.reply({ result: { bytes: new Uint8Array(), pages: 1, alreadyUnlocked: false } });
  });
  it('does not start a worker when already cancelled or when Workers are missing', () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal('Worker', FakeWorker);
    expect(() => unlockPdfInWorker(new Uint8Array(1), '', controller.signal)).toThrow();
    expect(FakeWorker.instances).toHaveLength(0);
    vi.stubGlobal('Worker', undefined);
    expect(() => unlockPdfInWorker(new Uint8Array(1), '', new AbortController().signal)).toThrow(/Web Workers/);
  });
});
