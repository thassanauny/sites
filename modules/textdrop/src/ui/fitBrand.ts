/** Keep the full-size wordmark until the first header row runs out of room. */
export function fitBrand(header: HTMLElement): () => void {
  if (typeof ResizeObserver === 'undefined') return () => {};
  const brand = header.querySelector<HTMLElement>('.brand')!;
  const label = brand.querySelector<HTMLElement>(':scope > span:last-child')!;
  const mark = brand.firstElementChild as HTMLElement;
  const actions = header.querySelector<HTMLElement>('.header-actions')!;
  let stopped = false;
  const update = () => {
    if (stopped) return;
    const workspace = header.querySelector('.header-board-title, .snippet-header-actions:not([hidden])');
    const style = getComputedStyle(header);
    const title = header.querySelector<HTMLElement>('.header-board-title');
    const titleSpace = title && getComputedStyle(title).order !== '3' ? 200 : 0;
    const gap = Number.parseFloat(style.columnGap) || 8;
    const available = header.clientWidth - (Number.parseFloat(style.paddingLeft) || 0) - (Number.parseFloat(style.paddingRight) || 0) - actions.getBoundingClientRect().width - gap - titleSpace;
    const needed = mark.getBoundingClientRect().width + label.getBoundingClientRect().width + (Number.parseFloat(getComputedStyle(brand).columnGap) || 0);
    header.toggleAttribute('data-icon-only', Boolean(workspace) && needed > available);
  };
  const observer = new ResizeObserver(update);
  for (const element of [header, actions, label]) observer.observe(element);
  void document.fonts?.ready.then(update);
  update();
  return () => {
    stopped = true;
    observer.disconnect();
  };
}
