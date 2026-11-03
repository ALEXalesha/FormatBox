// Готовые наборы: одна кнопка - формат и настройки. kinds - к каким файлам набор подходит.
const MB = 1024 * 1024;

export const PRESETS = [
  { id: 'phone', kinds: ['video'], to: 'mp4', opts: { maxPixels: 1280 * 720, quality: 65, audioKbps: 128 } },
  { id: 'discord10', kinds: ['video'], to: 'mp4', opts: { maxBytes: 10 * MB } },
  { id: 'email20', kinds: ['video'], to: 'mp4', opts: { maxBytes: 20 * MB } },
  { id: 'audioFromVideo', kinds: ['video'], to: 'mp3', opts: { quality: 80 } },
  { id: 'gif', kinds: ['video'], to: 'gif', opts: { maxPixels: 480 * 270, fps: 12 } },
  { id: 'mp3', kinds: ['audio'], to: 'mp3', opts: { audioKbps: 192 } },
  { id: 'cd', kinds: ['audio', 'video'], to: 'wav', opts: { audio: { bits: 16, sampleRate: 44100, channels: 2, dither: 'tpdf' } } },
  { id: 'nes', kinds: ['audio', 'video'], to: 'wav', opts: { chip: 'nes' } },
  { id: 'gameboy', kinds: ['audio', 'video'], to: 'wav', opts: { chip: 'gameboy' } },
  { id: 'web', kinds: ['image'], to: 'webp', opts: { maxPixels: 1920 * 1080, quality: 80, stripMeta: true } },
  { id: 'image1mb', kinds: ['image'], to: 'jpg', opts: { maxBytes: 1 * MB, stripMeta: true } },
  { id: 'icon', kinds: ['image'], to: 'ico', opts: { icoSizes: [16, 24, 32, 48, 64, 128, 256] } },
  { id: 'pdf', kinds: ['doc'], to: 'pdf', opts: {} },
  { id: 'zip', kinds: ['archive'], to: 'zip', opts: {} },
  { id: 'stl', kinds: ['mesh'], to: 'stl', opts: { repair: true } },
];

export function presetsFor(kind) {
  return PRESETS.filter((p) => p.kinds.includes(kind));
}

export function presetById(id) {
  return PRESETS.find((p) => p.id === id) || null;
}

// Набор поверх настроек пользователя: набор задаёт формат и свои поля, остальное остаётся
export function applyPreset(job, id) {
  const p = presetById(id);
  if (!p || !p.kinds.includes(job.kind)) return job;
  return { ...job, to: p.to, preset: id, opts: { ...job.opts, ...structuredClone(p.opts) } };
}
