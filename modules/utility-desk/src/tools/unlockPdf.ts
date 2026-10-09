import { toolPage, group, outputPanel } from '../page';
import { h, field, input, filePicker, taskControls, notice, button, emptyState } from '../ui';
import { unlockPdfInWorker } from '../lib/pdfUnlockClient';
import { readFileBytes, downloadBlob, bytesToBlob, baseName, sanitizeFilename, MAX_FILE_BYTES, formatBytes, throwIfAborted } from '../lib/util';

export function mount(root: HTMLElement) {
  let file: File | null = null;
  const info = h('div', {}, emptyState('No PDF selected', 'Choose the PDF you want to unlock.'));
  const results = h('div', { 'aria-live': 'polite' });
  const password = input('password', 'password', '', { autocomplete: 'off', spellcheck: false });
  const name = input('text', 'outName', 'unlocked.pdf');
  const picker = filePicker({ label: 'PDF file', accept: '.pdf,application/pdf', onFiles: ([selected]) => {
    file = null; password.value = ''; results.replaceChildren();
    if (selected.size > MAX_FILE_BYTES) { info.replaceChildren(notice('warn', `File exceeds ${formatBytes(MAX_FILE_BYTES)}.`)); return; }
    file = selected; name.value = sanitizeFilename(`${baseName(selected.name)}-unlocked.pdf`);
    info.replaceChildren(notice('info', `${selected.name} · ${formatBytes(selected.size)}. The source stays untouched.`));
  } });
  password.addEventListener('input', () => results.replaceChildren());
  const task = taskControls('unlock-pdf', 'Unlock PDF', async ({ signal, progress }) => {
    const source = file!, filename = sanitizeFilename(name.value, 'unlocked.pdf').replace(/(?:\.pdf)?$/i, '.pdf');
    results.replaceChildren(); progress(0.1, 'Reading PDF…');
    const bytes = await readFileBytes(source, signal);
    progress(0.3, 'Unlocking PDF…');
    const result = await unlockPdfInWorker(bytes, password.value, signal);
    throwIfAborted(signal); password.value = '';
    const message = result.alreadyUnlocked ? 'This PDF already opens without a password. A copy is ready.' : 'Password removed. Your unlocked PDF is ready.';
    results.append(notice('success', message), h('p', {}, `${result.pages} pages · ${formatBytes(result.bytes.length)}`), button('Download PDF', () => downloadBlob(bytesToBlob(result.bytes, 'application/pdf'), filename), { variant: 'primary' }));
    return message;
  }, { validate: () => file ? name.value.trim() ? null : 'Enter an output filename.' : 'Choose a PDF first.' });
  toolPage(root, 'unlock-pdf', { config: [group(null, picker, info), group(null, field('PDF password', password, 'Enter the document’s opening or owner password. Leave blank for a PDF that opens without a password. Passwords are never saved.'), field('Output filename', name))], actions: [task.el], output: [outputPanel('Unlocked PDF', 'DOWNLOAD', results)] });
  return () => { file = null; password.value = ''; results.replaceChildren(); };
}
