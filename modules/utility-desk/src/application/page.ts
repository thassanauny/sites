import { h, badge, stateTone, type Child } from '../ui/elements';
import { icon } from '../ui/icons';
import { sideTitle } from '../ui/layout';
import { PRESENTATION } from '../ui/presentation';
import { toolInfo, type ToolId } from './tools';
import { detectCapabilities } from '../infrastructure/capabilities';
import { store } from '../infrastructure/storage';

export function recentPanel(toolId: string) {
  const runs = store
    .getActivity()
    .filter((a) => a.tool === toolId)
    .slice(0, 6);
  return h(
    'section',
    { class: 'panel' },
    sideTitle('Recent activity', 'THIS BROWSER'),
    runs.length
      ? h(
          'div',
          { class: 'recent-list' },
          ...runs.map((r) =>
            h('div', { class: 'recent-run' }, h('span', {}, h('strong', {}, r.message), h('small', {}, new Date(r.ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))), badge(r.status, r.status === 'done' ? 'success' : r.status === 'failed' ? 'danger' : 'warn')),
          ),
        )
      : h('div', { class: 'empty-note' }, h('strong', {}, 'A fresh start.'), 'Your runs will appear here.'),
  );
}

/** Shared tool page: heading, configuration form with actions, side panels, optional output panel. */
export function toolPage(root: HTMLElement, id: ToolId, o: { config: Child[]; actions: Child[]; output?: HTMLElement[] }) {
  const p = PRESENTATION[id];
  const def = toolInfo(id)!;
  const caps = detectCapabilities().filter((c) => p.caps.includes(c.id));
  const worst = caps.some((c) => c.state === 'Unavailable') ? 'Unavailable' : caps.some((c) => c.state === 'Limited') ? 'Limited' : 'Supported';
  root.append(
    h('div', { class: 'page-heading' }, h('div', {}, h('span', { class: 'eyebrow' }, p.eyebrow), h('h1', { id: 'page-title', tabindex: -1 }, def.title), h('p', {}, def.desc)), h('div', { class: 'tool-mark', 'aria-hidden': 'true' }, icon(def.icon))),
    h(
      'div',
      { class: 'page-grid' },
      h('form', { class: 'panel', onsubmit: (e: Event) => e.preventDefault() }, sideTitle(p.intro, 'CONFIGURATION'), h('div', { class: 'form-content' }, ...o.config), h('div', { class: 'actions' }, ...o.actions)),
      h(
        'aside',
        { class: 'side-panels' },
        caps.length
          ? h(
              'section',
              { class: 'panel' },
              h('div', { class: 'panel-heading' }, h('h2', {}, 'Browser check'), badge(worst === 'Supported' ? 'Ready' : worst, stateTone(worst))),
              h('div', { class: 'dependency-list' }, ...caps.map((c) => h('div', { class: 'dependency' }, h('code', {}, c.label), h('span', { class: c.state === 'Supported' ? 'available' : 'missing' }, c.state === 'Supported' ? '✓ Supported' : c.state)))),
              h('div', { class: 'setup-note' }, 'Everything runs on this device. Files are never uploaded.'),
            )
          : null,
        recentPanel(id),
        h('section', { class: 'panel about' }, h('span', { class: 'eyebrow' }, 'ABOUT THIS TOOL'), h('h3', {}, p.about), h('p', {}, p.text), h('p', {}, p.note)),
      ),
    ),
    ...(o.output ?? []),
  );
}
