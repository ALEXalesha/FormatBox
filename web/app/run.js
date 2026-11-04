// Выполнение одного задания: кто его делает (ffmpeg, поток ядра, LibreOffice) и куда кладётся результат.
import { callWorker } from './worker-client.js';
import { targetsFor } from '../core/formats.js';
import { officeRoute } from '../core/docroute.js';

export const MESH_TARGETS = ['stl', '3mf', 'obj', 'ply', 'glb'];
const AUDIO = ['mp3', 'wav', 'flac', 'ogg', 'opus', 'm4a', 'aiff'];
const WEB_LIMIT = 1.8 * 1024 * 1024 * 1024;

export function defaultTarget(job, platform) {
  const list = targetsFor(job.ext, { desktop: platform.desktop });
  const pick = (...prefs) => prefs.find((p) => list.includes(p)) || list[0] || null;
  switch (job.kind) {
    case 'video': return pick('mp4', 'webm');
    case 'audio': return pick('mp3', 'wav');
    case 'image': return pick(job.ext === 'png' ? 'webp' : 'png', 'jpg');
    case 'doc': return pick(job.ext === 'pdf' ? 'docx' : 'pdf', 'txt');
    case 'archive': return pick('zip', '7z');
    case 'mesh': return pick('stl', '3mf');
    case 'gcode': return 'gcode';
    default: return null;
  }
}

async function bytesOf(job, platform) {
  if (!platform.desktop && job.size > WEB_LIMIT) throw new Error('too-big');
  if (!job.view.bytes || job.view.bytesFor !== job.src) {
    job.view.bytes = await platform.read(job);
    job.view.bytesFor = job.src;
  }
  return job.view.bytes;
}

// Звук для обработки ядром: WAV как есть, остальное - через ffmpeg в WAV float
async function pcmOf(job, platform, ctl, seconds) {
  if (job.ext === 'wav' && !job.opts.trim && !job.opts.speed) return bytesOf(job, platform);
  const opts = { trim: seconds ? { start: job.opts.trim?.start || 0, end: (job.opts.trim?.start || 0) + seconds * 3 } : job.opts.trim, speed: job.opts.speed, audio: { bits: 32, float: true } };
  if (platform.desktop) return platform.decode(job, opts, ctl);
  const { ffmpegConvert } = await import('./ffmpeg-web.js');
  const res = await ffmpegConvert({ bytes: await bytesOf(job, platform), ext: job.ext, to: 'wav', opts }, ctl);
  return res.bytes;
}

export async function runJob(job, ctl) {
  const { platform } = ctl;
  if (!job.to) throw new Error('no-target');
  if (job.kind === 'video' || job.kind === 'audio') {
    if (AUDIO.includes(job.to) && (job.opts.chip || job.opts.remix || (job.ext === 'wav' && job.to === 'wav'))) {
      const wav = await pcmOf(job, platform, { ...ctl, progress: (p) => ctl.progress(p * 0.3) });
      const res = await callWorker('audio', { bytes: wav, opts: job.opts }, { signal: ctl.signal, progress: (p) => ctl.progress(0.3 + p * 0.5) });
      if (job.to === 'wav') return platform.save(job, res.bytes, 'wav', job.opts.chip || (job.opts.remix ? 'chip' : ''));
      return platform.ffmpegBytes(job, res.bytes, 'wav', { ...ctl, tag: job.opts.chip || 'chip' });
    }
    const bytes = platform.desktop ? null : await bytesOf(job, platform);
    return platform.ffmpeg(job, bytes, ctl);
  }
  if (job.kind === 'doc' && platform.desktop && platform.info.soffice !== undefined) {
    const route = officeRoute(job.ext, job.to, { soffice: platform.info.soffice, pandoc: platform.info.pandoc });
    if (route && route !== 'builtin') return platform.office(job, ctl);
  }
  let bytes = await bytesOf(job, platform);
  let ext = job.ext;
  if (job.kind === 'image' && ['heic', 'svg'].includes(job.ext)) ({ bytes, ext } = await rasterize(bytes, job.ext));
  const worker = (op, args) => callWorker(op, args, { signal: ctl.signal, progress: ctl.progress });
  let res;
  if (job.kind === 'image' && MESH_TARGETS.includes(job.to)) res = await worker('to3d', { bytes, ext, to: job.to, opts: job.opts });
  else if (job.kind === 'image') res = await worker('image', { bytes, ext, to: job.to, opts: job.opts });
  else if (job.kind === 'mesh') res = await worker('mesh', { bytes, ext: job.ext, to: job.to, opts: job.opts });
  else if (job.kind === 'doc') res = await worker('doc', { bytes, ext: job.ext, to: job.to });
  else if (job.kind === 'archive') res = await worker('archiveRepack', { bytes, name: job.name, to: job.to });
  else if (job.kind === 'gcode') res = await worker('gcode', { bytes, opts: job.opts });
  else throw new Error('unknown');
  const saved = await platform.save(job, res.bytes, job.to, job.kind === 'gcode' ? 'm600' : '');
  return { ...saved, heights: res.heights, report: res.report };
}

export async function runJoin(job, ctl) {
  return ctl.platform.concat(job.parts, job.to, job.opts, ctl);
}

export async function runText3d(job, ctl) {
  const res = await callWorker('text3d', { text: job.text, to: job.to, opts: job.opts }, { signal: ctl.signal, progress: ctl.progress });
  return ctl.platform.save({ ...job, name: `${job.text.slice(0, 40).replace(/[^\p{L}\p{N} _-]+/gu, '_') || 'text'}.txt` }, res.bytes, job.to, '');
}

// HEIC (модулем heic2any) и SVG (через <img>) превращаются в PNG в окне: в Worker нет для них декодеров
async function rasterize(bytes, ext) {
  if (ext === 'heic') {
    const heic2any = (await import('../vendor/heic2any.js')).default;
    const blob = await heic2any({ blob: new Blob([bytes], { type: 'image/heic' }), toType: 'image/png' });
    return { bytes: new Uint8Array(await (Array.isArray(blob) ? blob[0] : blob).arrayBuffer()), ext: 'png' };
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const w = img.naturalWidth || 1024, h = img.naturalHeight || 1024;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
    return { bytes: new Uint8Array(await blob.arrayBuffer()), ext: 'png' };
  } finally { URL.revokeObjectURL(url); }
}

// ---------- предпросмотры для панели ----------
const urls = new WeakMap();
function blobUrl(job, key, bytes, type) {
  const map = urls.get(job) || {};
  if (map[key]) URL.revokeObjectURL(map[key]);
  map[key] = URL.createObjectURL(new Blob([bytes], { type }));
  urls.set(job, map);
  return map[key];
}

export async function previewImage(job, platform) {
  let bytes = await bytesOf(job, platform);
  let ext = job.ext;
  if (['heic', 'svg'].includes(ext)) ({ bytes, ext } = await rasterize(bytes, ext));
  const res = await callWorker('imagePreview', { bytes, ext, to: job.to, opts: job.opts });
  const type = { jpg: 'image/jpeg', webp: 'image/webp', avif: 'image/avif' }[job.to] || 'image/png';
  return { beforeUrl: blobUrl(job, 'before', res.before, 'image/png'), afterUrl: blobUrl(job, 'after', res.after, type), bytes: res.bytes, width: res.width, height: res.height };
}

export async function previewAudio(job, platform) {
  const wav = await pcmOf(job, platform, {}, 10);
  const res = await callWorker('audio', { bytes: wav, opts: job.opts, previewSeconds: 10 });
  return blobUrl(job, 'audio', res.bytes, 'audio/wav');
}

export async function inspectMesh(job, platform) {
  const bytes = await bytesOf(job, platform);
  return callWorker('meshInfo', { bytes, ext: job.ext, opts: job.opts });
}

export async function listArchive(job, platform) {
  const bytes = await bytesOf(job, platform);
  return callWorker('archiveList', { bytes, name: job.name });
}

export async function extractArchive(job, platform) {
  const bytes = await bytesOf(job, platform);
  const { entries } = await callWorker('archiveExtract', { bytes, name: job.name });
  const res = await platform.extract(job, entries);
  if (res) return res;
  // браузер без выбора папки: архив перепаковывается в zip для скачивания
  const zip = await callWorker('archiveRepack', { bytes, name: job.name, to: 'zip' });
  const saved = await platform.save(job, zip.bytes, 'zip', 'files');
  const a = document.createElement('a');
  a.href = saved.url; a.download = saved.name; a.click();
  return { name: saved.name, files: entries.filter((e) => !e.dir).length };
}
