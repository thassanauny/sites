import { h, type Child } from './elements';

export const sideTitle = (title: string, eyebrow: string) => h('div', { class: 'panel-heading' }, h('h2', {}, title), h('span', { class: 'eyebrow' }, eyebrow));

export function outputPanel(title: string, eyebrow: string, ...body: Child[]) {
  return h('section', { class: 'panel run-panel', 'aria-label': title }, sideTitle(title, eyebrow), h('div', { class: 'run-body' }, ...body));
}

export function group(title: string | null, ...body: Child[]) {
  return h('div', { class: 'options-group' }, title ? h('h3', {}, title) : null, ...body);
}
