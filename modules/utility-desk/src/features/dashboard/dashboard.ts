import { icon } from '../../ui/icons';
import { h, badge, emptyState, button, input, toast, stateTone } from '../../ui/elements';
import { sideTitle } from '../../ui/layout';
import { PRESENTATION, GROUPS } from '../../ui/presentation';
import { hrefFor } from '../../application/router';
import { toolInfo } from '../../application/tools';
import { detectCapabilities } from '../../infrastructure/capabilities';
import { ACTIVITY_KEY, store } from '../../infrastructure/storage';

/** The Home screen: search, grouped utility cards, browser capabilities and recent activity. */
export function dashboard(root: HTMLElement) {
  const caps = detectCapabilities();
  const actList = h('ul', { class: 'activity' });
  const renderAct = () => {
    actList.replaceChildren();
    const a = store.getActivity();
    if (!a.length) actList.append(h('li', {}, emptyState('No recent activity', 'Completed, failed and cancelled operations appear here. Stored only in this browser.')));
    a.forEach((x) => {
      actList.append(h('li', {}, badge(x.status, x.status === 'done' ? 'success' : x.status === 'failed' ? 'danger' : 'warn'), ` ${x.tool}: ${x.message} `, h('time', { class: 'muted', datetime: new Date(x.ts).toISOString() }, new Date(x.ts).toLocaleString())));
    });
  };
  renderAct();
  const query = input('search', 'q', '', { placeholder: 'Find a utility, e.g. PDF or resize', id: 'utility-search' });
  const count = h('span', { id: 'utility-count', role: 'status' });
  const empty = h('div', { class: 'empty-note panel', hidden: true }, h('strong', {}, 'No utilities found.'), 'Try a task like convert, merge, or PDF.');
  const groups = GROUPS.map(([cat, ids], index) => {
    const cards = ids.map((id) => {
      const t = toolInfo(id)!;
      const p = PRESENTATION[id];
      const a = h('a', { class: 'utility-card', href: hrefFor(id) }, h('span', { class: 'utility-card-icon', 'aria-hidden': 'true' }, icon(t.icon)), h('h3', {}, t.title), h('p', {}, p.summary), h('span', { class: 'utility-card-arrow', 'aria-hidden': 'true' }, '→'));
      a.dataset.search = `${t.title} ${t.desc} ${t.sub} ${p.summary} ${cat}`.toLowerCase();
      return a;
    });
    const headingId = `home-group-${index}`;
    const section = h('section', { class: 'utility-section', 'aria-labelledby': headingId }, h('h2', { id: headingId, class: 'utility-section-heading' }, cat), h('div', { class: 'utility-grid' }, ...cards));
    return { cards, section };
  });
  const cards = groups.flatMap((group) => group.cards);
  const filter = () => {
    const q = query.value.trim().toLowerCase();
    let n = 0;
    cards.forEach((c) => {
      const show = !q || q.split(/\s+/).every((w) => c.dataset.search!.includes(w));
      c.hidden = !show;
      if (show) n++;
    });
    groups.forEach(({ cards, section }) => {
      section.hidden = cards.every((card) => card.hidden);
    });
    count.textContent = `${n} of ${cards.length} utilities`;
    empty.hidden = n > 0;
  };
  query.addEventListener('input', filter);
  const search = h(
    'div',
    { class: 'home-search' },
    h('label', { class: 'sr-only', for: 'utility-search' }, 'Find a utility'),
    query,
    button('Clear', () => {
      query.value = '';
      filter();
      query.focus();
    }),
  );
  root.append(
    h('div', { class: 'utility-heading' }, h('h1', { id: 'page-title', tabindex: -1 }, 'All utilities'), count),
    search,
    h('nav', { class: 'utility-sections', 'aria-label': 'All utilities' }, ...groups.map((group) => group.section)),
    empty,
    h(
      'div',
      { class: 'page-grid dash-grid' },
      h(
        'section',
        { class: 'panel' },
        sideTitle('Browser capabilities', 'FEATURE CHECK'),
        h('div', { class: 'dependency-list' }, ...caps.map((c) => h('div', { class: 'dependency', title: c.detail }, h('span', {}, h('code', {}, c.label), h('br'), h('small', { class: 'muted' }, c.detail)), badge(c.state, stateTone(c.state))))),
      ),
      h(
        'section',
        { class: 'panel' },
        sideTitle('Recent activity', 'THIS BROWSER'),
        h('div', { class: 'recent-list' }, actList),
        h(
          'div',
          { class: 'actions' },
          button('Clear activity', () => {
            store.clearActivity();
            renderAct();
            toast('Activity cleared', 'success');
          }),
        ),
      ),
    ),
  );
  filter();
  // Refresh just the history: another tab must not reset this page's search/focus.
  const changed = (event: StorageEvent) => {
    if (event.key === ACTIVITY_KEY || event.key === null) renderAct();
  };
  window.addEventListener('storage', changed);
  return () => window.removeEventListener('storage', changed);
}
