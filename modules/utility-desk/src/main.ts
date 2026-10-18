import './style.css';
import { parseHash, hrefFor } from './application/router';
import { TOOLS } from './application/registry';
import { shell } from './application/shell';
import { dashboard } from './features/dashboard/dashboard';
import { h, pageHeader, notice, guardFileDrops } from './ui/elements';

const app = document.getElementById('app')!;
let cleanup: void | (() => void);
let renderRevision = 0;

async function render() {
  const currentRender = ++renderRevision;
  document.getElementById('main')!.dispatchEvent(new Event('utility-desk:leave'));
  cleanup?.();
  cleanup = undefined;
  const id = parseHash(location.hash);
  const root = document.getElementById('main')!;
  root.replaceChildren();
  app.classList.toggle('home-view', id === 'dashboard');
  document.querySelector('.workspace')!.classList.toggle('home-workspace', id === 'dashboard');
  document.querySelectorAll('.sidebar nav a').forEach((a) => {
    if (id !== 'notfound' && a.getAttribute('href') === hrefFor(id)) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const breadcrumb = document.getElementById('breadcrumb')!;
  if (id === 'dashboard') {
    dashboard(root);
    document.title = 'Utility Desk';
    breadcrumb.textContent = 'All utilities';
  } else if (id === 'notfound') {
    document.title = 'Page not found · Utility Desk';
    breadcrumb.textContent = 'Page not found';
    root.append(pageHeader('Page not found', 'That route does not exist.'), h('a', { href: '#/', class: 'btn btn-primary' }, 'Back to dashboard'));
  } else {
    const def = TOOLS.find((t) => t.id === id)!;
    document.title = `${def.title} · Utility Desk`;
    breadcrumb.textContent = def.title;
    root.append(h('p', { class: 'muted' }, 'Loading…'));
    try {
      const m = await def.load();
      if (currentRender !== renderRevision) return;
      root.replaceChildren();
      cleanup = m.mount(root);
    } catch (e) {
      if (currentRender !== renderRevision) return;
      root.replaceChildren(notice('danger', `Could not load this tool: ${(e as Error).message}`));
    }
  }
  (document.getElementById('page-title') as HTMLElement | null)?.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

shell(app);
guardFileDrops();
document.querySelector('.skip')!.addEventListener('click', (e) => {
  e.preventDefault();
  const main = document.getElementById('main')!;
  main.focus();
  main.scrollIntoView();
});
window.addEventListener('hashchange', render);
void render();
