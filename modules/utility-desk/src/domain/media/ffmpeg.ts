/** Output formats and FFmpeg command-line planning for the media converter. */
export const FORMATS: Record<string, { label: string; ext: string; mime: string; args: string[] }> = {
  mp4: { label: 'MP4 (H.264/AAC)', ext: 'mp4', mime: 'video/mp4', args: ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28', '-c:a', 'aac', '-movflags', '+faststart'] },
  mkv: { label: 'MKV (H.264/AAC)', ext: 'mkv', mime: 'video/x-matroska', args: ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-c:a', 'aac'] },
  webm: { label: 'WebM (VP9/Opus)', ext: 'webm', mime: 'video/webm', args: ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '32', '-c:a', 'libopus'] },
  mp3: { label: 'MP3 audio', ext: 'mp3', mime: 'audio/mpeg', args: ['-vn', '-c:a', 'libmp3lame', '-q:a', '4'] },
  wav: { label: 'WAV audio', ext: 'wav', mime: 'audio/wav', args: ['-vn', '-c:a', 'pcm_s16le'] },
  m4a: { label: 'M4A (AAC)', ext: 'm4a', mime: 'audio/mp4', args: ['-vn', '-c:a', 'aac'] },
  opus: { label: 'Opus audio', ext: 'opus', mime: 'audio/ogg', args: ['-vn', '-c:a', 'libopus'] },
  ogg: { label: 'OGG audio', ext: 'ogg', mime: 'audio/ogg', args: ['-vn', '-c:a', 'libvorbis', '-q:a', '4'] },
  gif: { label: 'Animated GIF', ext: 'gif', mime: 'image/gif', args: ['-vf', 'fps=10,scale=480:-1:flags=lanczos', '-an'] },
};

export function mediaSeconds(value: string): number | null {
  if (!value.trim()) return null;
  if (!/^(\d+(\.\d+)?|\d+:\d{2}(:\d{2})?(\.\d+)?)$/.test(value)) throw new Error('Use seconds, M:SS, or H:MM:SS for trim times.');
  const parts = value.split(':').map(Number);
  if (parts.slice(1).some((n) => n >= 60)) throw new Error('Minutes and seconds after a colon must be below 60.');
  const seconds = parts.reduce((n, v) => n * 60 + v, 0);
  if (!Number.isFinite(seconds)) throw new Error('Enter a finite trim time.');
  return seconds;
}

export function mediaArgs(format: string, quality: string, height: string, bitrate: string, start: string, end: string): string[] {
  const spec = FORMATS[format];
  if (!spec) throw new Error('Choose an output format.');
  const from = mediaSeconds(start) ?? 0,
    to = mediaSeconds(end);
  if (to !== null && to <= from) throw new Error('The end time must be after the start.');
  const args = [...spec.args];
  if (['mp4', 'mkv', 'webm'].includes(format)) {
    const crf = format === 'webm' ? ({ high: '25', balanced: '32', small: '40' } as Record<string, string>)[quality] : ({ high: '18', balanced: '23', small: '28' } as Record<string, string>)[quality];
    const idx = args.indexOf('-crf');
    if (idx >= 0) args[idx + 1] = crf;
    if (height) args.push('-vf', `scale=-2:trunc(min(ih\\,${height})/2)*2`);
    args.push('-b:a', `${bitrate}k`);
  } else if (format !== 'wav' && format !== 'gif') {
    const idx = args.indexOf('-q:a');
    if (idx >= 0) args.splice(idx, 2);
    args.push('-b:a', `${bitrate}k`);
  }
  return [...(from ? ['-ss', String(from)] : []), '-i', 'INPUT', ...(to !== null ? ['-t', String(to - from)] : []), ...args, `output.${spec.ext}`];
}
