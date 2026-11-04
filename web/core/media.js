// Видео и звук: размеры кадра, битрейт под заданный размер файла, команды ffmpeg.
// Одни и те же команды выполняют ffmpeg.wasm в браузере и настоящий ffmpeg в Electron.

const even = (v) => Math.max(2, Math.floor(v / 2) * 2);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Размер кадра после обрезки, поворота и масштаба. Законы: w*h <= maxPixels, обе стороны чётные (yuv420p),
// соотношение сторон сохраняется (кроме stretch).
export function outputSize(info, opts = {}) {
  let w = info.width, h = info.height;
  if (opts.crop) { w = opts.crop.w; h = opts.crop.h; }
  if (opts.rotate === 90 || opts.rotate === 270) [w, h] = [h, w];
  const fit = opts.fit || 'contain';
  if (opts.percent) { w = (w * opts.percent) / 100; h = (h * opts.percent) / 100; }
  if (opts.width && opts.height) {
    if (fit === 'stretch' || fit === 'cover') { w = opts.width; h = opts.height; }
    else { const k = Math.min(opts.width / w, opts.height / h); w *= k; h *= k; }
  } else if (opts.width) { h = (h * opts.width) / w; w = opts.width; }
  else if (opts.height) { w = (w * opts.height) / h; h = opts.height; }
  if (opts.maxPixels && w * h > opts.maxPixels) {
    const k = Math.sqrt(opts.maxPixels / (w * h));
    w *= k; h *= k;
  }
  return { width: even(w), height: even(h) };
}

// Обрезка краёв в процентах -> прямоугольник в пикселях (чётные стороны, не меньше 2)
export function cropFromPercent(info, pct = {}) {
  const side = (v) => Math.min(95, Math.max(0, v || 0)) / 100;
  const x = Math.floor((info.width * side(pct.left)) / 2) * 2;
  const y = Math.floor((info.height * side(pct.top)) / 2) * 2;
  const w = even(info.width * (1 - side(pct.left) - side(pct.right)));
  const h = even(info.height * (1 - side(pct.top) - side(pct.bottom)));
  return { x, y, w: Math.min(w, info.width - x), h: Math.min(h, info.height - y) };
}

// Сколько секунд будет в результате
export function outputDuration(info, opts = {}) {
  const start = clamp(opts.trim?.start || 0, 0, info.duration);
  const end = clamp(opts.trim?.end ?? info.duration, start, info.duration);
  return (end - start) / (opts.speed || 1);
}

// Битрейт под размер: всё в кбит/с. Запас на контейнер - 3 % и 16 КБ.
export function bitrateForSize({ maxBytes, duration, hasVideo = true, hasAudio = true, audioKbps = 128 }) {
  const budget = Math.max(0, (maxBytes - 16 * 1024) * 0.97) * 8 / 1000 / Math.max(duration, 0.1);
  if (!hasVideo) return { videoKbps: 0, audioKbps: Math.floor(clamp(budget, 6, 320)), totalKbps: budget };
  let audio = hasAudio ? Math.min(audioKbps, Math.max(24, Math.floor(budget * 0.15))) : 0;
  let video = budget - audio;
  if (video < 30 && hasAudio) { audio = Math.max(6, Math.floor(budget * 0.25)); video = budget - audio; }
  return { videoKbps: Math.max(1, Math.floor(video)), audioKbps: audio, totalKbps: budget };
}

// При малом битрейте большой кадр превращается в кашу: ограничим пиксели (около 0.07 бита на пиксель кадра)
export function pixelsForBitrate(videoKbps, fps = 30) {
  return Math.max(160 * 90, Math.floor((videoKbps * 1000) / (fps * 0.07)));
}

const VIDEO_CODEC = {
  mp4: ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'medium', '-movflags', '+faststart'],
  mov: ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'medium', '-movflags', '+faststart'],
  mkv: ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'medium'],
  webm: ['-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4'],
  avi: ['-c:v', 'mpeg4', '-pix_fmt', 'yuv420p'],
  gif: [],
};
const VP8 = ['-c:v', 'libvpx', '-pix_fmt', 'yuv420p', '-deadline', 'good', '-cpu-used', '4'];
const AUDIO_IN_VIDEO = { mp4: 'aac', mov: 'aac', mkv: 'aac', webm: 'libopus', avi: 'libmp3lame' };
const AUDIO_CODEC = { mp3: 'libmp3lame', ogg: 'libvorbis', opus: 'libopus', m4a: 'aac', flac: 'flac', aiff: 'pcm_s16be' };
export const VIDEO_TARGETS = Object.keys(VIDEO_CODEC);
export const AUDIO_TARGETS = ['mp3', 'wav', 'flac', 'ogg', 'opus', 'm4a', 'aiff'];

// Качество 0..100 -> crf: 100 почти без потерь, 0 - сильнее всего
export function crfFor(to, quality = 70) {
  const q = clamp(quality, 0, 100) / 100;
  return to === 'webm' ? Math.round(52 - q * 34) : Math.round(40 - q * 24);
}

// Цепочка atempo: каждый шаг в пределах 0.5..2
export function atempoChain(speed) {
  const steps = [];
  let left = speed;
  while (left > 2) { steps.push(2); left /= 2; }
  while (left < 0.5) { steps.push(0.5); left /= 0.5; }
  steps.push(+left.toFixed(6));
  return steps.map((s) => `atempo=${s}`).join(',');
}

function pcmCodec(bits, float, big = false) {
  if (bits === 8) return 'pcm_u8';
  if (float || bits === 32) return big ? 'pcm_f32be' : 'pcm_f32le';
  return `pcm_s${bits}${big ? 'be' : 'le'}`;
}

// Качество 0..100 -> кбит/с для кодеков без шкалы качества (Opus, AAC)
export const kbpsForQuality = (q) => Math.round(32 + (clamp(q, 0, 100) / 100) * 224);

function audioArgs(to, o) {
  const a = o.audio || {};
  const out = [];
  const pcm = ['wav', 'aiff', 'flac'].includes(to);
  if (to === 'wav' || to === 'aiff') out.push('-c:a', pcmCodec(a.bits || 16, a.float, to === 'aiff'));
  else if (to === 'flac') out.push('-c:a', 'flac', '-sample_fmt', (a.bits || 16) > 16 ? 's32' : 's16', ...((a.bits || 16) === 24 ? ['-bits_per_raw_sample', '24'] : []));
  // видео-контейнер без картинки (mp4 только со звуком): кодек звука этого контейнера
  else out.push('-c:a', AUDIO_CODEC[to] || AUDIO_IN_VIDEO[to] || 'aac');
  if (o.audioKbps && !pcm) out.push('-b:a', `${o.audioKbps}k`);
  else if (!pcm && o.quality != null) {
    if (to === 'mp3') out.push('-q:a', String(Math.round(9 - (o.quality / 100) * 9)));
    else if (to === 'ogg') out.push('-q:a', String(Math.round((o.quality / 100) * 10)));
    else out.push('-b:a', `${kbpsForQuality(o.quality)}k`);
  }
  const rate = to === 'opus' || to === 'webm' ? 48000 : a.sampleRate;
  if (rate) out.push('-ar', String(rate));
  if (a.channels) out.push('-ac', String(a.channels));
  return out;
}

function audioFilters(o) {
  const list = [];
  if (o.speed && o.speed !== 1) list.push(atempoChain(o.speed));
  if (o.audio?.dither && o.audio.dither !== 'none') list.push(`aresample=dither_method=${o.audio.dither === 'shaped' ? 'shibata' : 'triangular'}`);
  if (o.volume && o.volume !== 1) list.push(`volume=${o.volume}`);
  return list;
}

export function videoFilters(info, o, size) {
  const list = [];
  if (o.crop) list.push(`crop=${o.crop.w}:${o.crop.h}:${o.crop.x}:${o.crop.y}`);
  if (o.rotate === 90) list.push('transpose=1');
  else if (o.rotate === 180) list.push('hflip,vflip');
  else if (o.rotate === 270) list.push('transpose=2');
  if (o.flipH) list.push('hflip');
  if (o.flipV) list.push('vflip');
  if (o.fit === 'cover' && o.width && o.height) {
    list.push(`scale=${size.width}:${size.height}:force_original_aspect_ratio=increase:flags=lanczos`, `crop=${size.width}:${size.height}`);
  } else list.push(`scale=${size.width}:${size.height}:flags=lanczos`);
  list.push('setsar=1');
  if (o.speed && o.speed !== 1) list.push(`setpts=PTS/${o.speed}`);
  if (o.fps) list.push(`fps=${o.fps}`);
  return list;
}

// Задание -> проходы ffmpeg. info - из ffprobe (duration, width, height, hasAudio, hasVideo, fps).
// Возвращает { passes: [[args]], size, duration, videoKbps, audioKbps }
export function buildFfmpeg({ input, output, to, info, opts = {} }) {
  const o = { ...opts };
  if (o.cropPct && !o.crop && info.width) {
    const c = cropFromPercent(info, o.cropPct);
    if (c.w < info.width || c.h < info.height) o.crop = c;
  }
  const isAudioOut = AUDIO_TARGETS.includes(to);
  const hasVideo = info.hasVideo !== false && !isAudioOut;
  const hasAudio = info.hasAudio !== false && !o.mute && to !== 'gif';
  const duration = outputDuration(info, o);
  const inArgs = ['-hide_banner', '-y'];
  if (o.trim?.start) inArgs.push('-ss', String(o.trim.start));
  if (o.trim?.end != null) inArgs.push('-t', String(Math.max(0.01, o.trim.end - (o.trim.start || 0))));
  inArgs.push('-i', input);

  let videoKbps = 0, audioKbps = o.audioKbps || 0;
  if (o.maxBytes) {
    if (!hasVideo && ['wav', 'aiff', 'flac'].includes(to)) return { error: 'size-needs-compressed-audio' };
    if (to === 'gif') return { error: 'size-not-for-gif' };
    const r = bitrateForSize({ maxBytes: o.maxBytes, duration, hasVideo, hasAudio, audioKbps: o.audioKbps || 128 });
    videoKbps = r.videoKbps; audioKbps = r.audioKbps;
  }
  if (o.forceVideoKbps) videoKbps = o.forceVideoKbps;
  const sized = videoKbps > 0;
  if (sized && hasVideo) o.maxPixels = Math.min(o.maxPixels || Infinity, pixelsForBitrate(videoKbps, info.fps || 30));
  const meta = o.keepMetadata ? [] : ['-map_metadata', '-1'];

  if (!hasVideo) {
    const af = audioFilters(o);
    const args = [...inArgs, '-vn', ...(af.length ? ['-af', af.join(',')] : []), ...audioArgs(to, { ...o, audioKbps }), ...meta, output];
    return { passes: [args], duration, videoKbps: 0, audioKbps, size: null };
  }

  const size = outputSize(info, o);
  const vf = videoFilters(info, o, size);
  if (to === 'gif') {
    const fps = o.fps || Math.min(15, info.fps || 15);
    const chain = vf.filter((f) => !f.startsWith('fps=')).concat(`fps=${fps}`).join(',');
    const graph = `[0:v]${chain},split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`;
    return { passes: [[...inArgs, '-filter_complex', graph, '-an', ...meta, output]], size, duration, videoKbps: 0, audioKbps: 0 };
  }
  const af = hasAudio ? audioFilters(o) : [];
  const aArgs = hasAudio
    ? ['-c:a', AUDIO_IN_VIDEO[to], '-b:a', `${audioKbps || 128}k`, ...(to === 'webm' ? ['-ar', '48000'] : []), ...(af.length ? ['-af', af.join(',')] : [])]
    : ['-an'];
  // ffmpeg.wasm падает на VP9 - в браузере WebM кодируется VP8
  const vp8 = o.wasm && to === 'webm';
  const vArgs = [...(vp8 ? VP8 : VIDEO_CODEC[to]), '-vf', vf.join(',')];
  if (!sized && vp8) {
    const q = ['-crf', String(Math.round(50 - (clamp(o.quality ?? 70, 0, 100) / 100) * 40)), '-b:v', '20M'];
    return { passes: [[...inArgs, ...vArgs, ...q, ...aArgs, ...meta, output]], size, duration, videoKbps: 0, audioKbps };
  }
  if (!sized) {
    const q = to === 'avi' ? ['-q:v', String(Math.round(31 - (clamp(o.quality ?? 70, 0, 100) / 100) * 29))] : ['-crf', String(crfFor(to, o.quality ?? 70)), ...(to === 'webm' ? ['-b:v', '0'] : [])];
    return { passes: [[...inArgs, ...vArgs, ...q, ...aArgs, ...meta, output]], size, duration, videoKbps: 0, audioKbps };
  }
  // Два прохода: первый только считает статистику
  const rate = ['-b:v', `${videoKbps}k`, '-maxrate', `${Math.floor(videoKbps * 1.3)}k`, '-bufsize', `${videoKbps * 2}k`];
  const log = ['-passlogfile', o.passlog || 'fb2pass'];
  const first = [...inArgs, ...vArgs, ...rate, '-pass', '1', ...log, '-an', '-f', to === 'webm' ? 'webm' : 'null', o.nullOutput || '-'];
  const second = [...inArgs, ...vArgs, ...rate, '-pass', '2', ...log, ...aArgs, ...meta, output];
  return { passes: [first, second], size, duration, videoKbps, audioKbps };
}

// Склейка: все входы приводятся к размеру первого, звук - тишиной, если его нет
export function buildConcat({ inputs, infos, output, to, opts = {} }) {
  const size = outputSize(infos[0], { maxPixels: opts.maxPixels });
  const args = ['-hide_banner', '-y'];
  inputs.forEach((name) => args.push('-i', name));
  const parts = [];
  const silent = [];
  infos.forEach((info, i) => {
    parts.push(`[${i}:v]scale=${size.width}:${size.height}:force_original_aspect_ratio=decrease,pad=${size.width}:${size.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${opts.fps || 30}[v${i}]`);
    if (info.hasAudio === false) silent.push(i);
  });
  silent.forEach((i, k) => {
    args.push('-f', 'lavfi', '-t', String(infos[i].duration), '-i', 'anullsrc=r=48000:cl=stereo');
    parts.push(`[${inputs.length + k}:a]anull[a${i}]`);
  });
  infos.forEach((info, i) => { if (info.hasAudio !== false) parts.push(`[${i}:a]aresample=48000,aformat=channel_layouts=stereo[a${i}]`); });
  const chain = infos.map((_, i) => `[v${i}][a${i}]`).join('');
  parts.push(`${chain}concat=n=${infos.length}:v=1:a=1[v][a]`);
  const vp8 = opts.wasm && to === 'webm';
  const duration = infos.reduce((s, x) => s + x.duration, 0);
  args.push('-filter_complex', parts.join(';'), '-map', '[v]', '-map', '[a]', ...(vp8 ? VP8 : VIDEO_CODEC[to]));
  // до N МБ: битрейт от общей длительности (один проход, подгонку повторами делает runConcatJob)
  let videoKbps = opts.forceVideoKbps || 0, audioKbps = opts.audioKbps || 128;
  if (opts.maxBytes && !videoKbps) ({ videoKbps, audioKbps } = bitrateForSize({ maxBytes: opts.maxBytes, duration }));
  if (videoKbps) args.push('-b:v', `${videoKbps}k`, '-maxrate', `${Math.floor(videoKbps * 1.2)}k`, '-bufsize', `${videoKbps * 2}k`);
  else {
    args.push('-crf', String(crfFor(to, opts.quality ?? 70)));
    if (to === 'webm') args.push('-b:v', vp8 ? '20M' : '0');
  }
  args.push('-c:a', AUDIO_IN_VIDEO[to], '-b:a', `${audioKbps}k`, output);
  return { passes: [args], size, duration, videoKbps, audioKbps };
}

// Подгонка под размер: если после двух проходов файл всё же больше, снижаем битрейт пропорционально.
// encode(videoKbps, audioKbps) -> Promise<число байт>. Закон: возвращённый размер <= maxBytes или ошибка.
export async function fitToSize({ maxBytes, first, encode, tries = 4, signal }) {
  let { videoKbps, audioKbps } = first;
  let best = null;
  for (let i = 0; i < tries; i++) {
    if (signal?.aborted) throw new Error('canceled');
    const bytes = await encode(videoKbps, audioKbps, i);
    if (bytes <= maxBytes) { best = { bytes, videoKbps, audioKbps, tries: i + 1 }; break; }
    const k = (maxBytes / bytes) * 0.95;
    // уменьшаем оба потока: если картинка уже на пределе, лишнее съедает звук
    if (videoKbps > 0) videoKbps = Math.max(1, Math.floor(videoKbps * k));
    if (audioKbps > 0) audioKbps = Math.max(6, Math.floor(audioKbps * k));
    if (videoKbps <= 1 && audioKbps <= 6 && i > 0) break;
  }
  if (!best) throw new Error('size-unreachable');
  return best;
}

// Разбор вывода ffmpeg -i (в браузере ffprobe нет): длительность, кадр, есть ли звук
export function parseProbe(text) {
  const d = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text);
  const v = /Stream #[^\n]*Video:[^\n]*?(\d{2,5})x(\d{2,5})/.exec(text);
  const fps = /(\d+(?:\.\d+)?)\s*fps/.exec(text);
  const rot = /rotate\s*:\s*(-?\d+)|rotation of (-?\d+(?:\.\d+)?)/.exec(text);
  let width = v ? +v[1] : 0, height = v ? +v[2] : 0;
  const angle = rot ? Math.abs(Math.round(+(rot[1] ?? rot[2]))) % 360 : 0;
  if (angle === 90 || angle === 270) [width, height] = [height, width];
  return {
    duration: d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : 0,
    width, height,
    fps: fps ? +fps[1] : 0,
    hasVideo: Boolean(v),
    hasAudio: /Stream #[^\n]*Audio:/.test(text),
  };
}

// Ход работы по строке ffmpeg «time=00:00:12.34»
export function parseProgress(line, duration) {
  const m = /time=\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(line);
  if (!m || !duration) return null;
  return clamp((+m[1] * 3600 + +m[2] * 60 + +m[3]) / duration, 0, 1);
}
