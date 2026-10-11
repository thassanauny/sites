(() => {
  const form = document.getElementById('support-form');
  if (!form) return;
  const status = document.getElementById('support-status');
  const summary = form.elements.namedItem('summary');
  const details = form.elements.namedItem('details');
  const dialog = document.getElementById('support-dialog');
  const link = document.getElementById('support-link');
  const close = document.getElementById('support-close');

  if (dialog && link && close && typeof dialog.showModal === 'function') {
    link.addEventListener('click', event => {
      event.preventDefault();
      if (!dialog.open) dialog.showModal();
    });
    close.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => link.focus());
    const isBackdrop = event => {
      if (event.target !== dialog) return false;
      const bounds = dialog.getBoundingClientRect();
      return event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom;
    };
    let startedOnBackdrop = false;
    dialog.addEventListener('pointerdown', event => {
      startedOnBackdrop = isBackdrop(event);
    });
    dialog.addEventListener('click', event => {
      const closeFromBackdrop = startedOnBackdrop && isBackdrop(event);
      startedOnBackdrop = false;
      if (closeFromBackdrop) dialog.close();
    });
  }

  for (const field of [summary, details]) {
    field.addEventListener('input', () => {
      field.setCustomValidity(field.value && !field.value.trim() ? 'Please enter more than spaces.' : '');
      status.textContent = '';
    });
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    for (const field of [summary, details]) {
      field.setCustomValidity(field.value.trim() ? '' : 'Please enter more than spaces.');
    }
    if (!form.reportValidity()) return;

    const app = form.elements.namedItem('app').value;
    const kind = form.elements.namedItem('kind').value;
    const subject = `[${app}] ${summary.value.trim().replace(/\s+/g, ' ')}`;
    const body = [
      `App: ${app}`,
      `Topic: ${kind}`,
      '',
      details.value.trim().replace(/\r\n?|\n/g, '\r\n'),
    ].join('\r\n');
    const draft = `${form.getAttribute('action')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    status.textContent = 'Review the draft in your email app and send it to submit your request. If no draft opens, use the email link above. Your details stay here.';
    window.location.href = draft;
  });

  form.querySelector('button[type="submit"]').disabled = false;
})();
