import { toolPage } from '../../application/page';
import { taskControls, sourceSelection } from '../../application/tasks';
import { group } from '../../ui/layout';
import { h, field, input, filePicker, notice, emptyState } from '../../ui/elements';
import { unlockPdfInWorker } from '../../domain/pdf/unlockClient';
import { LIMITS } from '../../shared/limits';
import { readFileBytes, downloadBlob, bytesToBlob, sanitizeFilename, formatBytes, throwIfAborted, suggestOutputName } from '../../shared/util';

export function mount(root: HTMLElement) {
  let file: File | null = null;
  const info = h('div', {}, emptyState('No PDF selected', 'Choose the PDF you want to unlock.'));
  const password = input('password', 'password', '', { autocomplete: 'off', spellcheck: false });
  const name = input('text', 'outName', '', { placeholder: 'Choose a file to suggest a name' });
  const suggestName = suggestOutputName(name, 'unlocked');
  const picked = sourceSelection(suggestName, () => task.reset());
  const picker = filePicker({
    label: 'PDF file',
    accept: '.pdf,application/pdf',
    onFiles: ([selected]) => {
      const sameSource = picked.begin(selected);
      file = null;
      password.value = '';
      if (selected.size > LIMITS.fileBytes) {
        picked.reject();
        info.replaceChildren(notice('warn', `File exceeds ${formatBytes(LIMITS.fileBytes)}.`));
        return;
      }
      file = selected;
      picked.accept(selected, sameSource);
      info.replaceChildren(notice('info', `${selected.name} · ${formatBytes(selected.size)}. The source stays untouched.`));
    },
  });
  const task = taskControls(
    'unlock-pdf',
    'Unlock PDF',
    async ({ signal, progress }) => {
      const source = file!,
        filename = sanitizeFilename(name.value, 'unlocked.pdf').replace(/(?:\.pdf)?$/i, '.pdf');
      progress(0.1, 'Reading PDF…');
      const bytes = await readFileBytes(source, signal);
      progress(0.3, 'Unlocking PDF…');
      const result = await unlockPdfInWorker(bytes, password.value, signal);
      throwIfAborted(signal);
      password.value = '';
      const message = result.alreadyUnlocked ? 'This PDF already opens without a password. Copy downloaded.' : 'Password removed. Unlocked PDF downloaded.';
      downloadBlob(bytesToBlob(result.bytes, 'application/pdf'), filename);
      return message;
    },
    { validate: () => (file ? (name.value.trim() ? null : 'Enter an output filename.') : 'Choose a PDF first.') },
  );
  toolPage(root, 'unlock-pdf', {
    config: [group(null, picker, info), group(null, field('PDF password', password, 'Enter the document’s opening or owner password. Leave blank for a PDF that opens without a password. Passwords are never saved.'), field('Output filename (without extension)', name))],
    actions: [task.el],
  });
  return () => {
    file = null;
    password.value = '';
  };
}
