import { version } from '../../package.json';
import { icon } from '../ui/icons';
import { h } from '../ui/elements';
import { GROUPS } from '../ui/presentation';
import { hrefFor } from './router';
import { toolInfo } from './tools';

/** Sidebar, top bar, main region and footer around the routed content. */
export function shell(app: HTMLElement) {
  const topbarActions = h('div', { class: 'topbar-actions' }, h('span', { class: 'local-pill' }, h('span', { class: 'status-dot' }), 'Local workspace'));
  const nav = h(
    'nav',
    { id: 'utility-navigation', 'aria-label': 'Utilities' },
    ...GROUPS.map(([cat, ids], index) => {
      const headingId = `nav-group-${index}`;
      return h(
        'div',
        { class: 'nav-section', role: 'group', 'aria-labelledby': headingId },
        h('h2', { id: headingId, class: 'nav-section-heading' }, cat),
        h(
          'div',
          { class: 'nav-section-links' },
          ...ids.map((id) => {
            const t = toolInfo(id)!;
            return h('a', { href: hrefFor(t.id) }, h('span', { class: 'nav-icon', 'aria-hidden': 'true' }, icon(t.icon)), h('span', {}, t.title, h('small', {}, t.sub)));
          }),
        ),
      );
    }),
  );
  const aside = h(
    'aside',
    { class: 'sidebar' },
    h(
      'div',
      { class: 'sidebar-header' },
      h('a', { class: 'brand', href: '#/' }, h('img', { class: 'brand-mark', src: './logo.svg', alt: '', width: '38', height: '38' }), h('span', {}, 'Utility Desk', h('small', {}, 'Your everyday toolkit'))),
      h(
        'button',
        {
          type: 'button',
          class: 'btn nav-toggle',
          'aria-expanded': 'false',
          'aria-controls': 'utility-navigation',
          onclick: (e: Event) => {
            const o = aside.classList.toggle('nav-open');
            (e.currentTarget as HTMLElement).setAttribute('aria-expanded', String(o));
          },
        },
        'Tools',
        h('span', { 'aria-hidden': 'true' }, '☰'),
      ),
    ),
    nav,
  );
  nav.addEventListener('click', () => {
    aside.classList.remove('nav-open');
    aside.querySelector('.nav-toggle')!.setAttribute('aria-expanded', 'false');
  });
  app.append(
    aside,
    h(
      'div',
      { class: 'workspace' },
      h('header', { class: 'topbar' }, h('div', { class: 'privacy-note' }, h('span', { class: 'privacy-icon', 'aria-hidden': 'true' }, icon('privacy')), h('div', { class: 'privacy-copy' }, h('span', { class: 'eyebrow' }, 'PRIVATE BY DESIGN'), h('strong', {}, 'Nothing leaves this tab.'))), topbarActions),
      h('main', { id: 'main', tabindex: -1 }),
    ),
    h('footer', { class: 'app-footer' }, h('span', {}, `Utility Desk · ${version}`)),
  );
}
