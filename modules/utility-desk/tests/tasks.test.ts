import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { operationSlot, sourceSelection, taskControls } from '../src/application/tasks';
import { deferred, mainRoot } from './helpers';

let root: HTMLElement;
beforeEach(() => {
  localStorage.clear();
  root = mainRoot();
});
afterEach(() => {
  root.dispatchEvent(new Event('utility-desk:leave'));
  vi.restoreAllMocks();
});

const button = (task: ReturnType<typeof taskControls>, label: string) => [...task.el.querySelectorAll('button')].find((candidate) => candidate.textContent === label)!;
const toasts = () => [...document.querySelectorAll('.toast')];

describe('task controls and accessibility', () => {
  it('moves keyboard focus to Cancel for the run and back to the action afterwards', async () => {
    const finish = deferred<string>();
    const task = taskControls('crop-image', 'Work', () => finish.promise);
    root.append(task.el);
    const go = button(task, 'Work →');
    go.focus();
    go.click();
    expect(go.disabled).toBe(true);
    expect(document.activeElement).toBe(button(task, 'Cancel'));
    finish.resolve('Saved.');
    await vi.waitFor(() => expect(task.el.querySelector('.status')!.textContent).toBe('Done. Saved.'));
    expect(go.disabled).toBe(false);
    expect(document.activeElement).toBe(go);
  });

  it('does not take focus when the run was started from outside the page content, or when the user moved on', async () => {
    document.body.insertAdjacentHTML('beforeend', '<input id="elsewhere">');
    const elsewhere = document.getElementById('elsewhere')!;
    const finish = deferred<string>();
    const task = taskControls('crop-image', 'Work', () => finish.promise);
    root.append(task.el);
    elsewhere.focus();
    button(task, 'Work →').click();
    expect(document.activeElement).toBe(elsewhere);
    finish.resolve('Saved.');
    await vi.waitFor(() => expect(task.el.querySelector('.status')!.textContent).toBe('Done. Saved.'));
    expect(document.activeElement).toBe(elsewhere);

    const second = deferred<string>();
    const next = taskControls('crop-image', 'Again', () => second.promise);
    root.append(next.el);
    button(next, 'Again →').focus();
    button(next, 'Again →').click();
    elsewhere.focus();
    second.resolve('Saved.');
    await vi.waitFor(() => expect(next.el.querySelector('.status')!.textContent).toBe('Done. Saved.'));
    expect(document.activeElement).toBe(elsewhere);
  });

  it('keeps focus on a reachable control when the page is left during the run', async () => {
    const finish = deferred<string>();
    const task = taskControls('crop-image', 'Work', () => finish.promise);
    root.append(task.el);
    const go = button(task, 'Work →');
    go.focus();
    go.click();
    root.replaceChildren();
    finish.resolve('Saved.');
    await vi.waitFor(() => expect(task.el.querySelector('.status')!.textContent).toBe('Done. Saved.'));
    expect(document.activeElement === go).toBe(false);
  });

  it('announces the result once: a status line, a silent toast and a progress label that is not a live region', async () => {
    const task = taskControls('crop-image', 'Work', async ({ progress }) => {
      progress(0.5, 'Halfway');
      return 'Saved.';
    });
    root.append(task.el);
    button(task, 'Work →').click();
    await vi.waitFor(() => expect(task.el.querySelector('.status')!.textContent).toBe('Done. Saved.'));
    expect(task.el.querySelector('.status')!.getAttribute('role')).toBe('status');
    expect(task.el.querySelector('.status')!.hasAttribute('aria-live')).toBe(false);
    expect(task.el.querySelector('.progress [aria-live]')).toBeNull();
    expect(task.el.querySelector('progress')!.hasAttribute('aria-live')).toBe(false);
    expect(toasts().map((toast) => [toast.textContent, toast.getAttribute('aria-hidden')])).toEqual([['Done. Saved.', 'true']]);
  });

  it('keeps toasts for other messages readable by screen readers', async () => {
    const task = taskControls('crop-image', 'Work', async () => 'Saved.');
    root.append(task.el);
    const other = taskControls('crop-image', 'Other', () => new Promise<void>(() => {}));
    root.append(other.el);
    button(other, 'Other →').click();
    void task.run();
    await vi.waitFor(() => expect(toasts().map((toast) => toast.textContent)).toEqual(['An operation is already running. Cancel it before starting another.']));
    expect(toasts()[0].hasAttribute('aria-hidden')).toBe(false);
    button(other, 'Cancel').click();
  });

  it('makes the action the form submit button unless a task opts out', () => {
    const primary = taskControls('crop-image', 'Work', async () => {});
    const secondary = taskControls('crop-image', 'Preview', async () => {}, { submit: false });
    expect(button(primary, 'Work →').type).toBe('submit');
    expect(button(secondary, 'Preview →').type).toBe('button');
  });
});

describe('sourceSelection', () => {
  const file = (name: string, size = 1) => new File(['x'.repeat(size)], name, { lastModified: 1 });

  it('keeps the output name and status for the same file and clears them for another or a rejected one', () => {
    const suggest = vi.fn(),
      reset = vi.fn();
    const picked = sourceSelection(suggest, reset);
    const first = file('a.pdf');
    expect(picked.begin(first)).toBe(false);
    expect(suggest).toHaveBeenCalledWith();
    expect(reset).toHaveBeenCalledTimes(1);
    picked.accept(first, false);
    expect(suggest).toHaveBeenLastCalledWith('a.pdf');

    suggest.mockClear();
    reset.mockClear();
    const again = file('a.pdf');
    expect(picked.begin(again)).toBe(true);
    picked.accept(again, true);
    expect(suggest).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();

    expect(picked.begin(file('b.pdf', 2))).toBe(false);
    expect(reset).toHaveBeenCalledTimes(1);
    picked.reject();
    expect(suggest).toHaveBeenLastCalledWith();
    expect(reset).toHaveBeenCalledTimes(2);
    expect(picked.begin(first)).toBe(false);
  });
});

describe('operationSlot', () => {
  it('is active only while the work runs and passes its result on', async () => {
    const slot = operationSlot();
    const work = deferred<string>();
    expect(slot.active).toBe(false);
    const run = slot.run(new AbortController().signal, () => work.promise);
    expect(slot.active).toBe(true);
    work.resolve('done');
    await expect(run).resolves.toBe('done');
    expect(slot.active).toBe(false);
  });

  it('aborts the work when the task is cancelled, also when it already was', async () => {
    const slot = operationSlot(),
      task = new AbortController();
    let seen!: AbortSignal;
    const work = deferred<void>();
    const run = slot.run(task.signal, (signal) => {
      seen = signal;
      return work.promise;
    });
    expect(seen.aborted).toBe(false);
    task.abort();
    expect(seen.aborted).toBe(true);
    work.resolve();
    await run;

    const cancelled = new AbortController();
    cancelled.abort();
    await slot.run(cancelled.signal, async (signal) => {
      expect(signal.aborted).toBe(true);
    });
  });

  it('abort() stops the running work and a newer run keeps the slot when an older one finishes late', async () => {
    const slot = operationSlot();
    const older = deferred<void>(),
      newer = deferred<void>();
    let olderSignal!: AbortSignal;
    const first = slot.run(new AbortController().signal, (signal) => {
      olderSignal = signal;
      return older.promise;
    });
    slot.abort();
    expect(olderSignal.aborted).toBe(true);
    const second = slot.run(new AbortController().signal, () => newer.promise);
    older.resolve();
    await first;
    expect(slot.active).toBe(true);
    newer.resolve();
    await second;
    expect(slot.active).toBe(false);
  });

  it('clears the slot and rethrows when the work fails', async () => {
    const slot = operationSlot();
    await expect(
      slot.run(new AbortController().signal, async () => {
        throw new Error('Broken');
      }),
    ).rejects.toThrow('Broken');
    expect(slot.active).toBe(false);
  });
});
