import { formatBytes } from '../shared/util';

export type Child = Node | string | number | null | undefined | false;
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, any> = {}, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'for') (el as any).htmlFor = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in el && k !== 'list') (el as any)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

let uid = 0;
export const nextId = (p = 'f') => `${p}-${++uid}`;

export type Tone = 'neutral' | 'success' | 'warn' | 'danger' | 'info';
export const badge = (text: string, tone: Tone = 'neutral') => h('span', { class: `badge badge-${tone}` }, text);
/** Badge tone for a browser-capability state (Supported, Limited or Unavailable). */
export const stateTone = (state: string): Tone => (state === 'Supported' ? 'success' : state === 'Limited' ? 'warn' : 'danger');
export const notice = (tone: Tone, ...content: Child[]) => h('div', { class: `notice notice-${tone}`, role: tone === 'danger' ? 'alert' : 'note' }, ...content);

export function button(label: string, onClick: (e: Event) => void, opts: { variant?: 'primary' | 'secondary' | 'danger' | 'ghost'; disabled?: boolean; type?: string } = {}) {
  return h('button', { type: opts.type ?? 'button', class: `btn btn-${opts.variant ?? 'secondary'}`, disabled: opts.disabled, onclick: onClick }, label);
}

export function panel(title: string, desc: string | null, ...body: Child[]) {
  const id = nextId('panel');
  return h('section', { class: 'panel', 'aria-labelledby': id }, h('h2', { id, class: 'panel-title' }, title), desc ? h('p', { class: 'muted' }, desc) : null, ...body);
}

export function field<T extends HTMLElement>(label: string, control: T, hint?: string): HTMLElement {
  const id = control.id || nextId('in');
  control.id = id;
  const hintId = hint ? `${id}-hint` : '';
  if (hint) control.setAttribute('aria-describedby', hintId);
  return h('div', { class: 'field' }, h('label', { class: 'field-label', for: id }, label), control, hint ? h('p', { id: hintId, class: 'field-hint' }, hint) : null);
}
export const input = (type: string, name: string, value = '', extra: Record<string, any> = {}) => h('input', { type, name, value, ...extra });
export function select(name: string, options: [string, string][], value?: string) {
  const s = h(
    'select',
    { name },
    options.map(([v, l]) => h('option', { value: v }, l)),
  );
  if (value) s.value = value;
  return s;
}

export function option(title: string, detail: string, control: HTMLInputElement) {
  return h('label', { class: 'option' }, control, h('span', {}, h('strong', {}, title), h('small', {}, detail)));
}

/** Range slider with a live value readout and an optional footer line (scale or hint). */
export function rangeField(o: { id: string; name: string; label: string; value: string; min: number; max: number; step?: number; footer?: Child }) {
  const control = input('range', o.name, o.value, { id: o.id, min: o.min, max: o.max, step: o.step });
  const readout = h('output', {}, control.value);
  readout.htmlFor.add(o.id);
  const update = () => {
    readout.value = control.value;
  };
  control.addEventListener('input', update);
  control.addEventListener('change', update);
  const el = h('div', { class: 'field quality-slider' }, h('div', { class: 'quality-label' }, h('label', { class: 'field-label', for: o.id }, o.label), readout), control, o.footer);
  return { el, control, update };
}
/** The Low/High labels under an encoding-quality slider. */
export const qualityScale = () => h('div', { class: 'quality-scale', 'aria-hidden': 'true' }, h('span', {}, 'Low'), h('span', {}, 'High'));

export function emptyState(title: string, text: string) {
  return h('div', { class: 'empty' }, h('strong', {}, title), h('p', { class: 'muted' }, text));
}

export function progress() {
  const bar = h('progress', { max: 100, value: 0, 'aria-label': 'Progress' });
  const label = h('span', { class: 'muted' }, '');
  const el = h('div', { class: 'progress', hidden: true }, bar, label);
  return {
    el,
    set(pct: number | null, text = '') {
      el.hidden = false;
      if (pct === null) bar.removeAttribute('value');
      else bar.value = Math.round(pct);
      label.textContent = text || (pct === null ? 'Working…' : `${Math.round(pct)}%`);
    },
    hide() {
      el.hidden = true;
    },
  };
}

// ---- toasts ----
let region: HTMLElement | null = null;
/** `silent` hides a toast from screen readers when the same text is already announced elsewhere. */
export function toast(message: string, tone: Tone = 'info', opts: { silent?: boolean } = {}) {
  if (!region?.isConnected) region = document.body.appendChild(h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }));
  const t = h('div', { class: `toast toast-${tone}`, 'aria-hidden': opts.silent ? 'true' : undefined }, message);
  region.append(t);
  setTimeout(() => t.remove(), tone === 'danger' ? 7000 : 4000);
}

// ---- file picking ----
export function filePicker(opts: { label: string; accept?: string; multiple?: boolean; directory?: boolean; hint?: string; onFiles: (f: File[]) => void }) {
  const inp = h('input', { type: 'file', accept: opts.accept, multiple: !!opts.multiple, class: 'file-input' });
  const message = h('div');
  const acceptedTypes =
    opts.accept
      ?.toLowerCase()
      .split(',')
      .map((type) => type.trim())
      .filter(Boolean) ?? [];
  const selectFiles = (files: File[]) => {
    if (inp.matches(':disabled')) return;
    const accepted = files.filter(
      (file) =>
        !acceptedTypes.length ||
        acceptedTypes.some((type) => {
          if (type.startsWith('.')) return file.name.toLowerCase().endsWith(type);
          if (type.endsWith('/*')) return file.type.toLowerCase().startsWith(type.slice(0, -1));
          return file.type.toLowerCase() === type;
        }),
    );
    const single = !(opts.multiple || opts.directory);
    message.replaceChildren();
    if (accepted.length !== files.length) message.append(notice('warn', 'Unsupported files were skipped. Choose a file type listed by this picker.'));
    if (single && accepted.length > 1) message.append(notice('warn', `Only the first file was used (${accepted[0].name}). This picker takes one file at a time.`));
    if (accepted.length) opts.onFiles(single ? accepted.slice(0, 1) : accepted);
  };
  if (opts.directory) {
    inp.setAttribute('webkitdirectory', '');
    inp.multiple = true;
  }
  inp.addEventListener('change', () => {
    selectFiles([...(inp.files ?? [])]);
    inp.value = '';
  });
  const wrap = field(opts.label, inp, opts.hint ?? 'Files stay on your device and are never uploaded.');
  wrap.append(message);
  if (!opts.directory) {
    wrap.classList.add('dropzone');
    wrap.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (!inp.matches(':disabled')) wrap.classList.add('drag');
    });
    wrap.addEventListener('dragleave', () => wrap.classList.remove('drag'));
    wrap.addEventListener('drop', (e) => {
      e.preventDefault();
      wrap.classList.remove('drag');
      selectFiles([...(e.dataTransfer?.files ?? [])]);
    });
  }
  return wrap;
}

/** A file dropped outside a drop zone would make the browser open it and discard the page's work, so ignore those drops. */
export function guardFileDrops(target: EventTarget = window) {
  const carriesFiles = (e: Event) => Array.from((e as DragEvent).dataTransfer?.types ?? []).includes('Files');
  const outsideZone = (e: Event) => !(e.target instanceof Element && e.target.closest('.dropzone'));
  const over = (e: Event) => {
    if (!carriesFiles(e) || !outsideZone(e)) return;
    e.preventDefault();
    const transfer = (e as DragEvent).dataTransfer;
    if (transfer) transfer.dropEffect = 'none';
  };
  const drop = (e: Event) => {
    if (carriesFiles(e) && outsideZone(e)) e.preventDefault();
  };
  target.addEventListener('dragover', over);
  target.addEventListener('drop', drop);
  return () => {
    target.removeEventListener('dragover', over);
    target.removeEventListener('drop', drop);
  };
}

/** Reorderable file list. Keyboard accessible via Up/Down buttons. */
export function fileList<T extends { name: string; size?: number }>(items: T[], onChange: () => void, extra?: (item: T) => Child) {
  const ul = h('ul', { class: 'file-list' });
  const render = () => {
    ul.replaceChildren();
    if (!items.length) {
      ul.append(h('li', {}, emptyState('No files yet', 'Add files above to get started.')));
      return;
    }
    items.forEach((it, i) => {
      const move = (d: number) => {
        const j = i + d;
        if (j < 0 || j >= items.length) return;
        [items[i], items[j]] = [items[j], items[i]];
        render();
        onChange();
      };
      ul.append(
        h(
          'li',
          { class: 'file-row' },
          h('span', { class: 'file-name' }, `${i + 1}. ${it.name}`, it.size !== undefined ? h('small', { class: 'muted' }, ` ${formatBytes(it.size)}`) : null),
          extra?.(it),
          h('button', { class: 'btn btn-ghost', type: 'button', disabled: i === 0, 'aria-label': `Move ${it.name} up`, onclick: () => move(-1) }, '↑'),
          h('button', { class: 'btn btn-ghost', type: 'button', disabled: i === items.length - 1, 'aria-label': `Move ${it.name} down`, onclick: () => move(1) }, '↓'),
          h(
            'button',
            {
              class: 'btn btn-ghost',
              type: 'button',
              'aria-label': `Remove ${it.name}`,
              onclick: () => {
                items.splice(i, 1);
                render();
                onChange();
              },
            },
            '✕',
          ),
        ),
      );
    });
  };
  render();
  return { el: ul, refresh: render };
}

export function pageHeader(title: string, desc: string, ...badges: Child[]) {
  return h('header', { class: 'page-header' }, h('h1', { tabindex: -1, id: 'page-title' }, title), h('p', { class: 'muted' }, desc), badges.length ? h('div', { class: 'row' }, ...badges) : null);
}
