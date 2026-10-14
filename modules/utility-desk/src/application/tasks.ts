import { store, type Activity } from '../infrastructure/storage';
import { h, button, progress, toast } from '../ui/elements';
import { fileSourceKey } from '../shared/util';
import { toolInfo } from './tools';

export interface TaskCtx {
  signal: AbortSignal;
  progress: (pct: number, label?: string) => void;
}

let activeTask: AbortController | null = null;

/**
 * The primary action with Cancel and Retry, a progress bar and a status line. One task runs at a time: the page's
 * controls are disabled for the run (keyboard focus moves to Cancel and returns afterwards) and leaving the page cancels it.
 * Enter in a field clicks the form's first submit button, so only a page's main action is one (`submit: false` for others).
 */
export function taskControls(toolId: string, label: string, run: (ctx: TaskCtx) => Promise<string | void>, opts: { validate?: () => string | null; submit?: boolean } = {}) {
  const status = h('p', { class: 'status', role: 'status' }, 'Ready.');
  const prog = progress();
  const fileTask = toolInfo(toolId)?.kind === 'file';
  let ac: AbortController | null = null;
  const go = button(`${label} →`, () => start(), { variant: 'primary', type: opts.submit === false ? 'button' : 'submit' });
  const cancel = button('Cancel', () => ac?.abort(), { variant: 'danger' });
  cancel.hidden = true;
  const retry = button('Retry', () => start());
  retry.hidden = true;
  const log = (statusV: Activity['status'], message: string) => {
    store.addActivity({ tool: toolId, status: statusV, message });
  };
  async function start() {
    if (activeTask) {
      toast('An operation is already running. Cancel it before starting another.', 'warn');
      return;
    }
    const err = opts.validate?.();
    if (err) {
      status.textContent = err;
      status.className = 'status status-danger';
      prog.hide();
      return;
    }
    ac = new AbortController();
    const controller = ac;
    activeTask = controller;
    const root = go.closest('main');
    const abort = () => controller.abort();
    root?.addEventListener('utility-desk:leave', abort, { once: true });
    const controls = [...(root?.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('input, select, textarea, button') ?? [])].filter((el) => el !== cancel && !el.disabled);
    const hadFocus = !!root?.contains(document.activeElement);
    controls.forEach((el) => {
      el.disabled = true;
    });
    go.disabled = true;
    cancel.hidden = false;
    retry.hidden = true;
    if (hadFocus) cancel.focus();
    status.className = 'status';
    status.textContent = 'Working…';
    prog.set(null, 'Starting…');
    try {
      const msg = await run({ signal: ac.signal, progress: (p, l) => prog.set(p * 100, l) });
      if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      status.textContent = `Done. ${msg ?? ''}`.trim();
      status.className = 'status status-success';
      if (fileTask) prog.set(100, 'Completed.');
      toast(status.textContent, 'success', { silent: true });
      log('done', msg || label);
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        status.textContent = 'Cancelled.';
        status.className = 'status status-warn';
        log('cancelled', `${label} cancelled`);
      } else {
        const m = (e as Error).message || 'Unknown error';
        status.textContent = `Failed: ${m}`;
        status.className = 'status status-danger';
        log('failed', m);
      }
      retry.hidden = false;
    } finally {
      const active = document.activeElement,
        refocus = hadFocus && (active === cancel || !active || active === document.body);
      controls.forEach((el) => {
        el.disabled = false;
      });
      root?.removeEventListener('utility-desk:leave', abort);
      go.disabled = false;
      cancel.hidden = true;
      if (!fileTask || status.className !== 'status status-success') prog.hide();
      ac = null;
      activeTask = null;
      if (refocus && go.isConnected) go.focus();
    }
  }
  const reset = () => {
    if (ac) return;
    status.textContent = 'Ready.';
    status.className = 'status';
    prog.hide();
    retry.hidden = true;
  };
  return { el: h('div', { class: 'task' }, h('div', { class: 'action-buttons' }, go, cancel, retry), prog.el, status), run: start, reset };
}

/** Keep page-session preferences, excluding files, passwords, and source-dependent fields. */
export function persistForm(toolId: string, root: HTMLElement, sourceFields: string[] = []) {
  const draft = store.getDraft(toolId);
  const excluded = new Set(['outputName', 'outName', ...sourceFields]);
  const controls = [...root.querySelectorAll<HTMLInputElement>('[name]')].filter((e) => e.type !== 'file' && e.type !== 'password' && !excluded.has(e.name));
  controls.forEach((e) => {
    const v = draft[e.name];
    if (v !== undefined) {
      if (e.type === 'checkbox') e.checked = v === '1';
      else if (e.tagName !== 'SELECT' || [...(e as unknown as HTMLSelectElement).options].some((o) => o.value === v)) e.value = v;
      e.dispatchEvent(new Event('change'));
    }
  });
  let t: ReturnType<typeof setTimeout>;
  const flush = () => {
    clearTimeout(t);
    store.setDraft(toolId, Object.fromEntries(controls.map((e) => [e.name, e.type === 'checkbox' ? (e.checked ? '1' : '0') : e.value])));
  };
  const save = () => {
    clearTimeout(t);
    t = setTimeout(flush, 300);
  };
  const leave = () => {
    flush();
    root.removeEventListener('input', save);
    root.removeEventListener('change', save);
  };
  root.addEventListener('input', save);
  root.addEventListener('change', save);
  root.addEventListener('utility-desk:leave', leave, { once: true });
}

/**
 * Ties a tool's output name and task status to the file it works on. Choosing the same file again keeps both;
 * any other file, or one that fails a check, clears the suggested name and resets the status.
 */
export function sourceSelection(suggestName: (source?: string) => void, reset: () => void) {
  let key = '';
  return {
    /** Start a selection. Returns true when `file` is the source that was accepted last time. */
    begin(file: File) {
      const same = key === fileSourceKey(file);
      if (!same) {
        suggestName();
        reset();
      }
      return same;
    },
    /** The file passed every check: remember it and suggest an output name unless it is unchanged. */
    accept(file: File, same: boolean) {
      key = fileSourceKey(file);
      if (!same) suggestName(file.name);
    },
    /** The file failed a check or could not be read: forget the source. */
    reject() {
      key = '';
      suggestName();
      reset();
    },
  };
}

/** One abortable operation at a time. Its signal also aborts when the task's signal does (Cancel, or leaving the page). */
export function operationSlot() {
  let current: AbortController | null = null;
  return {
    get active() {
      return current !== null;
    },
    abort() {
      current?.abort();
    },
    async run<T>(taskSignal: AbortSignal, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
      const operation = new AbortController();
      current = operation;
      const forward = () => operation.abort();
      taskSignal.addEventListener('abort', forward, { once: true });
      if (taskSignal.aborted) operation.abort();
      try {
        return await work(operation.signal);
      } finally {
        taskSignal.removeEventListener('abort', forward);
        if (current === operation) current = null;
      }
    },
  };
}
