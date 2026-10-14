import { toolPage } from '../../application/page';
import { taskControls, persistForm, sourceSelection } from '../../application/tasks';
import { group } from '../../ui/layout';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import coreUrl from '@ffmpeg/core?url';
import wasmUrl from '@ffmpeg/core/wasm?url';
import { h, field, input, select, pageHeader, filePicker, notice, badge, button } from '../../ui/elements';
import { detectCapabilities } from '../../infrastructure/capabilities';
import { FORMATS, mediaArgs } from '../../domain/media/ffmpeg';
import { LIMITS } from '../../shared/limits';
import { downloadBlob, baseName, sanitizeFilename, formatBytes, bytesToBlob, suggestOutputName } from '../../shared/util';

const MEDIA_ACCEPT = 'video/*,audio/*,.mp4,.m4v,.mkv,.mov,.avi,.webm,.mpg,.mpeg,.ogv,.3gp,.flv,.wmv,.mp3,.wav,.flac,.aac,.m4a,.aif,.aiff,.opus,.ogg,.wma,.gif';
export function mount(root: HTMLElement) {
  const cap = detectCapabilities().find((c) => c.id === 'ffmpeg')!;
  if (cap.state === 'Unavailable') {
    root.append(pageHeader('Media converter', 'FFmpeg WebAssembly runs locally.', badge('Unavailable', 'danger')), notice('danger', `This browser cannot run the converter: ${cap.detail} Try a current Chrome, Edge, Firefox or Safari.`));
    return;
  }
  let file: File | null = null;
  let ff: FFmpeg | null = null;
  const info = h('div'),
    preview = h('video', { controls: true, hidden: true, class: 'preview-img', 'aria-label': 'Source preview' });
  let previewUrl = '';
  const fmt = select(
    'format',
    Object.entries(FORMATS).map(([k, v]) => [k, v.label] as [string, string]),
    'mp4',
  );
  const quality = select(
    'quality',
    [
      ['high', 'High quality'],
      ['balanced', 'Balanced'],
      ['small', 'Smaller file'],
    ],
    'balanced',
  );
  const height = select('height', [
    ['', 'Original size'],
    ['1080', '1080p'],
    ['720', '720p'],
    ['480', '480p'],
  ]);
  const bitrate = select(
    'bitrate',
    [
      ['128', '128 kbps'],
      ['192', '192 kbps'],
      ['320', '320 kbps'],
    ],
    '192',
  );
  const outputName = input('text', 'outputName', '', { placeholder: 'Use the source filename' });
  const suggestName = suggestOutputName(outputName, 'converted');
  const start = input('text', 'start', '', { placeholder: '0 or 00:00:05' }),
    end = input('text', 'end', '', { placeholder: 'Full length or 00:00:15' });
  const plan = h('pre', { class: 'report', hidden: true });
  const sync = () => {
    const video = ['mp4', 'mkv', 'webm'].includes(fmt.value);
    quality.disabled = height.disabled = !video;
    bitrate.disabled = ['wav', 'gif'].includes(fmt.value);
    plan.hidden = true;
  };
  fmt.addEventListener('change', sync);
  sync();
  preview.addEventListener('loadedmetadata', () => {
    end.placeholder = Number.isFinite(preview.duration) ? `Full length (${Math.round(preview.duration * 1000) / 1000} s)` : 'Full length or 00:00:15';
  });
  const picked = sourceSelection(suggestName, () => task.reset());
  const picker = filePicker({
    label: 'Audio or video file',
    accept: MEDIA_ACCEPT,
    onFiles: ([f]) => {
      const sameSource = picked.begin(f);
      info.replaceChildren();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = '';
      preview.hidden = true;
      file = null;
      end.placeholder = 'Full length or 00:00:15';
      if (f.size > LIMITS.mediaBytes) {
        picked.reject();
        info.append(notice('warn', `${f.name} is ${formatBytes(f.size)}. The browser limit is ${formatBytes(LIMITS.mediaBytes)} (WebAssembly memory).`));
        return;
      }
      file = f;
      picked.accept(f, sameSource);
      previewUrl = URL.createObjectURL(f);
      preview.src = previewUrl;
      preview.hidden = false;
      info.append(notice('info', `${f.name} · ${formatBytes(f.size)}. Conversion is single-threaded and can be slow for large files.`));
    },
  });
  const args = () => mediaArgs(fmt.value, quality.value, height.value, bitrate.value, start.value, end.value);
  const validation = () => {
    if (!file) return 'Choose a file first.';
    try {
      args();
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  };

  const task = taskControls(
    'media-converter',
    'Convert media',
    async ({ signal, progress }) => {
      const source = file!;
      const spec = FORMATS[fmt.value];
      const command = args();
      const name = `${sanitizeFilename(outputName.value.trim() || baseName(source.name), 'media')}.${spec.ext}`;
      ff = new FFmpeg();
      const onAbort = () => {
        ff?.terminate();
      };
      signal.addEventListener('abort', onAbort);
      try {
        ff.on('progress', ({ progress: p }) => progress(Math.min(0.99, Math.max(0, p)), `Converting ${Math.round(Math.min(1, Math.max(0, p)) * 100)}%`));
        progress(0, 'Loading FFmpeg (~30 MB, local)…');
        await ff.load({ coreURL: new URL(coreUrl, location.href).href, wasmURL: new URL(wasmUrl, location.href).href });
        const inName = `input.${source.name.split('.').pop()?.replace(/[^\w]/g, '') || 'bin'}`;
        const outName = `output.${spec.ext}`;
        await ff.writeFile(inName, new Uint8Array(await source.arrayBuffer()));
        const code = await ff.exec(command.map((arg) => (arg === 'INPUT' ? inName : arg)));
        if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        if (code !== 0) throw new Error('FFmpeg could not convert this file (unsupported codec or invalid options).');
        const data = (await ff.readFile(outName)) as Uint8Array;
        downloadBlob(bytesToBlob(data, spec.mime), name);
        return `${name} (${formatBytes(data.length)})`;
      } catch (e) {
        if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        throw e;
      } finally {
        signal.removeEventListener('abort', onAbort);
        ff?.terminate();
        ff = null;
      }
    },
    { validate: validation },
  );
  const previewPlan = button('Preview conversion', () => {
    const err = validation();
    plan.hidden = false;
    plan.textContent = err ?? `Source: ${file!.name}\nOutput: ${outputName.value.trim() || baseName(file!.name)}.${FORMATS[fmt.value].ext}\nFFmpeg options: ${args().join(' ')}\nNo output has been created.`;
  });

  toolPage(root, 'media-converter', {
    config: [
      notice('info', `No special server headers needed. Limit: ${formatBytes(LIMITS.mediaBytes)} per file. FFmpeg (~30 MB, bundled) loads only when you start a conversion. Cancel stops it by terminating the worker.`),
      ...(cap.state === 'Limited' ? [notice('warn', cap.detail)] : []),
      group(null, picker, info, preview),
      group('Output', field('Output format', fmt), h('div', { class: 'option-grid' }, field('Video quality', quality), field('Maximum video height', height), field('Audio bitrate', bitrate), field('Output filename (without extension)', outputName))),
      group(
        'Trim time range',
        h('div', { class: 'option-grid' }, field('From', start, 'Seconds, M:SS, or H:MM:SS. Blank = beginning.'), field('To', end, 'Blank = media’s end.')),
        button('Use media’s end time', () => {
          end.value = Number.isFinite(preview.duration) ? String(preview.duration) : '';
        }),
      ),
      plan,
    ],
    actions: [previewPlan, task.el],
  });
  persistForm('media-converter', root, ['start', 'end']);
  sync();
  return () => {
    ff?.terminate();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  };
}
