// Панель настроек выбранных файлов. Поля описаны таблицей: где показывать, как читать и писать opts.
// Изменение поля применяется ко всем выбранным файлам одного вида.
import { humanSize } from './i18n.js';
import { previewImage, previewAudio, inspectMesh, listArchive, extractArchive, MESH_TARGETS } from './run.js';

const MB = 1024 * 1024;
const AUDIO = ['mp3', 'wav', 'flac', 'ogg', 'opus', 'm4a', 'aiff'];
const VIDEO = ['mp4', 'webm', 'mkv', 'mov', 'avi', 'gif'];
const PCM = ['wav', 'aiff', 'flac'];
const num = (v) => (v === '' || v == null || Number.isNaN(+v) ? undefined : +v);

const isVideoOut = (j) => VIDEO.includes(j.to);
const isAudioOut = (j) => AUDIO.includes(j.to);
const isImageOut = (j) => j.kind === 'image' && !MESH_TARGETS.includes(j.to);
const to3d = (j) => j.kind === 'image' && MESH_TARGETS.includes(j.to);

// type: select | number | range | check | text; opts - [значение, ключ подписи]
const FIELDS = [
  { id: 'maxMb', label: 'opt.maxMb', type: 'number', step: 0.1, min: 0, show: (j) => isVideoOut(j) || (isAudioOut(j) && !PCM.includes(j.to)) || isImageOut(j),
    get: (o) => (o.maxBytes ? +(o.maxBytes / MB).toFixed(3) : ''), set: (o, v) => { o.maxBytes = num(v) > 0 ? Math.floor(num(v) * MB) : undefined; } },
  { id: 'maxPx', label: 'opt.maxPx', type: 'select', show: (j) => isVideoOut(j) || isImageOut(j),
    options: [['', 'opt.any'], ['230400', '640×360'], ['921600', '1280×720 (0.9 МП)'], ['2073600', '1920×1080 (2 МП)'], ['3686400', '2560×1440'], ['8294400', '3840×2160 (8 МП)'], ['custom', '…']],
    get: (o) => (!o.maxPixels ? '' : ['230400', '921600', '2073600', '3686400', '8294400'].includes(String(o.maxPixels)) ? String(o.maxPixels) : 'custom'),
    set: (o, v) => { if (v !== 'custom') o.maxPixels = num(v); else o.maxPixels = o.maxPixels || 1_000_000; } },
  { id: 'maxPxN', label: 'opt.maxPx', type: 'number', min: 4, step: 1000, show: (j) => (isVideoOut(j) || isImageOut(j)) && j.opts.maxPixels && !['230400', '921600', '2073600', '3686400', '8294400'].includes(String(j.opts.maxPixels)),
    get: (o) => o.maxPixels ?? '', set: (o, v) => { o.maxPixels = num(v); } },
  { id: 'resize', label: 'opt.resize', type: 'select', show: (j) => isVideoOut(j) || isImageOut(j),
    options: [['', 'resize.none'], ['percent', 'resize.percent'], ['box', 'resize.box']],
    get: (o) => (o.percent ? 'percent' : o.width || o.height ? 'box' : ''),
    set: (o, v) => { delete o.percent; delete o.width; delete o.height; if (v === 'percent') o.percent = 50; if (v === 'box') { o.width = 1280; o.height = 720; } } },
  { id: 'percent', label: 'opt.percent', type: 'number', min: 1, max: 1000, show: (j) => j.opts.percent, get: (o) => o.percent, set: (o, v) => { o.percent = num(v); } },
  { id: 'width', label: 'opt.width', type: 'number', min: 2, show: (j) => j.opts.width || j.opts.height, get: (o) => o.width ?? '', set: (o, v) => { o.width = num(v); } },
  { id: 'height', label: 'opt.height', type: 'number', min: 2, show: (j) => j.opts.width || j.opts.height, get: (o) => o.height ?? '', set: (o, v) => { o.height = num(v); } },
  { id: 'fit', label: 'opt.fit', type: 'select', show: (j) => j.opts.width && j.opts.height,
    options: [['contain', 'fit.contain'], ['cover', 'fit.cover'], ['stretch', 'fit.stretch']], get: (o) => o.fit || 'contain', set: (o, v) => { o.fit = v; } },
  ...['left', 'top', 'right', 'bottom'].map((side) => ({
    id: `crop-${side}`, label: `crop.${side}`, group: 'opt.crop', type: 'number', min: 0, max: 95, show: (j) => isVideoOut(j) || isImageOut(j),
    get: (o) => o.cropPct?.[side] ?? '', set: (o, v) => { o.cropPct = { ...(o.cropPct || {}), [side]: num(v) || 0 }; },
  })),
  { id: 'trimFrom', label: 'trim.from', group: 'opt.trim', type: 'number', min: 0, step: 0.1, show: (j) => j.kind === 'video' || j.kind === 'audio',
    get: (o) => o.trim?.start ?? '', set: (o, v) => { o.trim = { ...(o.trim || {}), start: num(v) || 0 }; } },
  { id: 'trimTo', label: 'trim.to', group: 'opt.trim', type: 'number', min: 0, step: 0.1, show: (j) => j.kind === 'video' || j.kind === 'audio',
    get: (o) => o.trim?.end ?? '', set: (o, v) => { o.trim = { ...(o.trim || {}), end: num(v) }; if (o.trim.end == null) delete o.trim.end; } },
  { id: 'rotate', label: 'opt.rotate', type: 'select', show: (j) => isVideoOut(j) || isImageOut(j),
    options: [['0', '0°'], ['90', '90°'], ['180', '180°'], ['270', '270°']], get: (o) => String(o.rotate || 0), set: (o, v) => { o.rotate = +v; } },
  { id: 'flipH', label: 'opt.flipH', type: 'check', show: (j) => isVideoOut(j) || isImageOut(j), get: (o) => o.flipH, set: (o, v) => { o.flipH = v; } },
  { id: 'flipV', label: 'opt.flipV', type: 'check', show: (j) => isVideoOut(j) || isImageOut(j), get: (o) => o.flipV, set: (o, v) => { o.flipV = v; } },
  { id: 'mute', label: 'opt.mute', type: 'check', show: (j) => isVideoOut(j) && j.to !== 'gif', get: (o) => o.mute, set: (o, v) => { o.mute = v; } },
  { id: 'speed', label: 'opt.speed', type: 'select', show: (j) => j.kind === 'video' || j.kind === 'audio',
    options: [['0.25', '×0.25'], ['0.5', '×0.5'], ['0.75', '×0.75'], ['1', '×1'], ['1.25', '×1.25'], ['1.5', '×1.5'], ['2', '×2'], ['4', '×4']],
    get: (o) => String(o.speed || 1), set: (o, v) => { o.speed = +v === 1 ? undefined : +v; } },
  { id: 'fps', label: 'opt.fps', type: 'select', show: isVideoOut, options: [['', 'opt.any'], ['10', '10'], ['15', '15'], ['24', '24'], ['25', '25'], ['30', '30'], ['60', '60']],
    get: (o) => String(o.fps || ''), set: (o, v) => { o.fps = num(v); } },
  { id: 'quality', label: 'opt.quality', type: 'range', min: 1, max: 100, show: (j) => !j.opts.maxBytes && (isVideoOut(j) || isImageOut(j) || (isAudioOut(j) && !PCM.includes(j.to))),
    get: (o) => o.quality ?? 75, set: (o, v) => { o.quality = +v; } },
  { id: 'audioKbps', label: 'opt.audioKbps', type: 'select', show: (j) => !j.opts.maxBytes && isAudioOut(j) && !PCM.includes(j.to),
    options: [['', 'opt.any'], ['64', '64'], ['96', '96'], ['128', '128'], ['192', '192'], ['256', '256'], ['320', '320']], get: (o) => String(o.audioKbps || ''), set: (o, v) => { o.audioKbps = num(v); } },
  { id: 'bits', label: 'opt.bits', type: 'select', show: (j) => ['wav', 'aiff', 'flac'].includes(j.to),
    options: [['', 'opt.any'], ['8', 'bits.8'], ['16', 'bits.16'], ['24', 'bits.24'], ['32', 'bits.32']],
    get: (o) => String(o.audio?.bits || ''), set: (o, v) => { o.audio = { ...(o.audio || {}), bits: num(v), float: num(v) === 32 }; } },
  { id: 'rate', label: 'opt.rate', type: 'select', show: isAudioOut,
    options: [['', 'opt.any'], ...[8000, 11025, 16000, 22050, 32000, 44100, 48000, 88200, 96000].map((r) => [String(r), `${r / 1000} кГц`])],
    get: (o) => String(o.audio?.sampleRate || ''), set: (o, v) => { o.audio = { ...(o.audio || {}), sampleRate: num(v) }; } },
  { id: 'channels', label: 'opt.channels', type: 'select', show: isAudioOut, options: [['', 'opt.any'], ['1', 'ch.mono'], ['2', 'ch.stereo']],
    get: (o) => String(o.audio?.channels || ''), set: (o, v) => { o.audio = { ...(o.audio || {}), channels: num(v) }; } },
  { id: 'dither', label: 'opt.dither', type: 'select', show: (j) => ['wav', 'aiff', 'flac'].includes(j.to), options: [['none', 'dither.none'], ['tpdf', 'dither.tpdf'], ['shaped', 'dither.shaped']],
    get: (o) => o.audio?.dither || 'none', set: (o, v) => { o.audio = { ...(o.audio || {}), dither: v }; } },
  { id: 'chip', label: 'opt.chip', type: 'select', show: isAudioOut, options: [['', 'chip.none'], ['nes', 'chip.nes'], ['gameboy', 'chip.gameboy'], ['16bit', 'chip.16bit']],
    get: (o) => o.chip || '', set: (o, v) => { o.chip = v || undefined; } },
  { id: 'remix', label: 'opt.remix', type: 'check', show: isAudioOut, hint: 'remix.hint', get: (o) => o.remix, set: (o, v) => { o.remix = v || undefined; } },
  ...['melody', 'bass', 'drums'].map((part) => ({
    id: `remix-${part}`, label: `remix.${part}`, type: 'check', show: (j) => isAudioOut(j) && j.opts.remix,
    get: (o) => (o.remixParts || ['melody', 'bass', 'drums']).includes(part),
    set: (o, v) => { const s = new Set(o.remixParts || ['melody', 'bass', 'drums']); if (v) s.add(part); else s.delete(part); o.remixParts = ['melody', 'bass', 'drums'].filter((p) => s.has(p)); },
  })),
  { id: 'stripMeta', label: 'opt.stripMeta', type: 'check', show: isImageOut, get: (o) => o.stripMeta !== false, set: (o, v) => { o.stripMeta = v; } },
  { id: 'removeBg', label: 'opt.removeBg', type: 'check', show: (j) => isImageOut(j) && ['png', 'webp', 'avif', 'ico'].includes(j.to), get: (o) => o.removeBg, set: (o, v) => { o.removeBg = v; } },
  { id: 'tolerance', label: 'opt.tolerance', type: 'range', min: 0, max: 100, show: (j) => isImageOut(j) && j.opts.removeBg, get: (o) => o.tolerance ?? 20, set: (o, v) => { o.tolerance = +v; } },
  { id: 'wmText', label: 'opt.wmText', group: 'opt.watermark', type: 'text', show: isImageOut, get: (o) => o.watermark?.text || '', set: (o, v) => { o.watermark = v ? { ...(o.watermark || { opacity: 0.35 }), text: v } : undefined; } },
  { id: 'wmOpacity', label: 'opt.wmOpacity', group: 'opt.watermark', type: 'range', min: 5, max: 100, show: (j) => isImageOut(j) && j.opts.watermark,
    get: (o) => Math.round((o.watermark?.opacity ?? 0.35) * 100), set: (o, v) => { o.watermark = { ...o.watermark, opacity: +v / 100 }; } },
  { id: 'wmTile', label: 'opt.wmTile', group: 'opt.watermark', type: 'check', show: (j) => isImageOut(j) && j.opts.watermark, get: (o) => o.watermark?.tile, set: (o, v) => { o.watermark = { ...o.watermark, tile: v }; } },
  ...[16, 24, 32, 48, 64, 128, 256].map((s) => ({
    id: `ico${s}`, label: `${s}`, group: 'opt.icoSizes', type: 'check', show: (j) => j.kind === 'image' && j.to === 'ico',
    get: (o) => (o.icoSizes || [16, 24, 32, 48, 64, 128, 256]).includes(s),
    set: (o, v) => { const set = new Set(o.icoSizes || [16, 24, 32, 48, 64, 128, 256]); if (v) set.add(s); else set.delete(s); o.icoSizes = [...set].sort((a, b) => a - b); },
  })),
  { id: 'to3d', label: 'opt.to3d', type: 'select', show: (j) => j.kind === 'image',
    options: [['', 'to3d.none'], ['litho', 'to3d.litho'], ['curved', 'to3d.curved'], ['cylinder', 'to3d.cylinder'], ['relief', 'to3d.relief'], ['plain', 'to3d.plain'], ['keychain', 'to3d.keychain'], ['sign', 'to3d.sign'], ['cookie', 'to3d.cookie'], ['stencil', 'to3d.stencil']],
    get: (o) => o.to3d || '', set: (o, v, j) => { o.to3d = v || undefined; j.to = v ? (MESH_TARGETS.includes(j.to) ? j.to : 'stl') : (MESH_TARGETS.includes(j.to) ? 'png' : j.to); } },
  { id: 'widthMm', label: 'opt.widthMm', type: 'number', min: 5, max: 500, show: to3d, get: (o) => o.widthMm ?? 100, set: (o, v) => { o.widthMm = num(v); } },
  { id: 'minMm', label: 'opt.minMm', type: 'number', min: 0.2, max: 10, step: 0.1, show: (j) => to3d(j) && ['litho', 'curved', 'cylinder'].includes(j.opts.to3d), get: (o) => o.minMm ?? 0.8, set: (o, v) => { o.minMm = num(v); } },
  { id: 'maxMm', label: 'opt.maxMm', type: 'number', min: 0.5, max: 20, step: 0.1, show: (j) => to3d(j) && ['litho', 'curved', 'cylinder'].includes(j.opts.to3d), get: (o) => o.maxMm ?? 3, set: (o, v) => { o.maxMm = num(v); } },
  { id: 'heightMm', label: 'opt.heightMm', type: 'number', min: 0.4, max: 100, step: 0.1, show: (j) => to3d(j) && !['litho', 'curved', 'cylinder'].includes(j.opts.to3d), get: (o) => o.heightMm ?? 3, set: (o, v) => { o.heightMm = num(v); } },
  { id: 'colors', label: 'opt.colors', type: 'select', show: (j) => to3d(j) && ['relief', 'sign', 'plain'].includes(j.opts.to3d), options: [['', '1'], ['2', '2'], ['3', '3'], ['4', '4']],
    get: (o) => String(o.colors || ''), set: (o, v) => { o.colors = num(v); } },
  { id: 'repair', label: 'opt.repair', type: 'check', show: (j) => j.kind === 'mesh', get: (o) => o.repair, set: (o, v) => { o.repair = v; } },
  { id: 'decimate', label: 'opt.decimate', type: 'number', min: 1, max: 100, show: (j) => j.kind === 'mesh', get: (o) => o.decimate ?? 100, set: (o, v) => { o.decimate = num(v) >= 100 ? undefined : num(v); } },
  { id: 'units', label: 'opt.units', type: 'select', show: (j) => j.kind === 'mesh', options: [['mm', 'units.mm'], ['in', 'units.in'], ['cm', 'units.cm']],
    get: (o) => o.units || 'mm', set: (o, v) => { o.units = v === 'mm' ? undefined : v; } },
  { id: 'material', label: 'opt.material', type: 'select', show: (j) => j.kind === 'mesh', options: ['PLA', 'PETG', 'ABS', 'ASA', 'TPU', 'Nylon'].map((m) => [m, m]),
    get: (o) => o.material || 'PLA', set: (o, v) => { o.material = v; } },
  { id: 'infill', label: 'opt.infill', type: 'number', min: 0, max: 100, show: (j) => j.kind === 'mesh', get: (o) => o.infill ?? 20, set: (o, v) => { o.infill = num(v); } },
  { id: 'price', label: 'opt.price', type: 'number', min: 0, step: 50, show: (j) => j.kind === 'mesh', get: (o) => o.pricePerKg ?? 1500, set: (o, v) => { o.pricePerKg = num(v); } },
  { id: 'm600', label: 'opt.m600', type: 'text', hint: 'm600.hint', show: (j) => j.kind === 'gcode', get: (o) => (o.heights || []).join(', '),
    set: (o, v) => { o.heights = String(v).split(/[,;\s]+/).map((s) => +s.replace(',', '.')).filter((x) => x > 0); } },
  { id: 'textHeight', label: 'opt.heightMm', type: 'number', min: 2, max: 300, show: (j) => j.kind === 'text3d', get: (o) => o.heightMm ?? 10, set: (o, v) => { o.heightMm = num(v); } },
];

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  e.append(...kids.filter(Boolean));
  return e;
}

function control(f, value, t, onSet) {
  const id = `opt-${f.id}`;
  if (f.type === 'select') {
    const s = el('select', { id });
    for (const [v, key] of f.options) s.append(el('option', { value: v, text: t(key) }));
    s.value = value;
    s.addEventListener('change', () => onSet(s.value, true));
    return s;
  }
  if (f.type === 'check') {
    const c = el('input', { id, type: 'checkbox' });
    c.checked = Boolean(value);
    c.addEventListener('change', () => onSet(c.checked, true));
    return c;
  }
  if (f.type === 'range') {
    const wrap = el('span', { class: 'pair' });
    const r = el('input', { id, type: 'range', min: f.min, max: f.max, value });
    const out = el('output', { for: id, text: String(value) });
    r.addEventListener('input', () => { out.textContent = r.value; onSet(r.value, false); });
    r.addEventListener('change', () => onSet(r.value, true));
    wrap.append(r, out);
    return wrap;
  }
  const i = el('input', { id, type: f.type === 'text' ? 'text' : 'number', min: f.min, max: f.max, step: f.step || 'any', value: value ?? '' });
  i.addEventListener('change', () => onSet(i.value, true));
  return i;
}

export function renderPanel(root, jobs, ctx) {
  const { t, rerender } = ctx;
  const job = jobs[0];
  const same = jobs.filter((j) => j.kind === job.kind);
  root.innerHTML = '';
  root.append(el('h3', { text: jobs.length > 1 ? `${job.name} +${jobs.length - 1}` : job.name }));

  // во что превратить
  const targets = job.kind === 'join' ? VIDEO.filter((v) => v !== 'gif') : job.kind === 'text3d' ? MESH_TARGETS : job.kind === 'gcode' ? ['gcode'] : ctx.targetsFor(job);
  const extraTargets = job.kind === 'image' && job.opts.to3d ? MESH_TARGETS : [];
  const list = job.opts.to3d ? extraTargets : targets;
  const toSel = el('select', { id: 'opt-to' });
  if (!list.length) toSel.append(el('option', { value: '', text: t('err.unknown') }));
  for (const x of list) toSel.append(el('option', { value: x, text: x.toUpperCase() }));
  toSel.value = job.to || '';
  toSel.addEventListener('change', () => { for (const j of same) { j.to = toSel.value; j.preset = undefined; reset(j); } rerender(); });
  root.append(el('div', { class: 'field' }, el('label', { for: 'opt-to', text: t('opt.to') }), toSel));

  const groups = new Map();
  const visible = FIELDS.filter((f) => f.show(job));
  for (const f of visible) {
    const value = f.get(job.opts, job);
    const onSet = (v, final) => {
      for (const j of same) { f.set(j.opts, v, j); j.preset = undefined; reset(j); }
      if (final) rerender(); else ctx.onLive?.();
      if (!final && f.id === 'quality') schedulePreview(root, job, ctx);
    };
    const row = el('div', { class: `field${f.type === 'check' ? ' check' : ''}` });
    if (f.type === 'check') row.append(el('label', {}, control(f, value, t, onSet), document.createTextNode(t(f.label))));
    else row.append(el('label', { for: `opt-${f.id}`, text: t(f.label) }), control(f, value, t, onSet));
    if (f.hint) row.append(el('span', { class: 'hint', text: t(f.hint) }));
    const g = f.group || '';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(row);
  }
  for (const [g, rows] of groups) {
    if (!g) { root.append(...rows); continue; }
    const fs = el('fieldset', {}, el('legend', { text: t(g) }));
    const line = el('div', { class: 'row' }, ...rows);
    fs.append(line);
    root.append(fs);
  }

  const actions = el('div', { class: 'row' });
  const ready = same.filter((j) => j.to && !['running', 'waiting'].includes(j.state));
  actions.append(el('button', { id: 'startSel', class: 'primary', text: t('start'), disabled: !ready.length || null, onclick: () => ctx.app.startSelected?.(ready) }));
  root.append(actions);
  const preview = el('div', { class: 'preview', id: 'preview' });
  root.append(preview);
  fillPreview(preview, job, ctx);
}

function reset(j) {
  if (['done', 'failed', 'canceled'].includes(j.state)) { j.state = 'idle'; j.error = null; }
}

let previewTimer = null;
function schedulePreview(root, job, ctx) {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => { const box = root.querySelector('#preview'); if (box) fillPreview(box, job, ctx); }, 250);
}

let previewToken = 0;
async function fillPreview(box, job, ctx) {
  const { t, app } = ctx;
  const token = ++previewToken;
  const stale = () => token !== previewToken;
  try {
    if (job.kind === 'image' && !job.opts.to3d && job.to) {
      const res = await previewImage(job, app.platform);
      if (stale() || !res) return;
      box.innerHTML = '';
      const before = el('img', { src: res.beforeUrl, alt: 'before', id: 'imgBefore' });
      const after = el('img', { src: res.afterUrl, alt: 'after', id: 'imgAfter' });
      const sizeText = t('size.result', { size: humanSize(res.bytes), orig: humanSize(job.size) });
      box.append(el('div', { class: 'row' }, el('b', { text: t('preview') }), el('span', { id: 'previewSize', class: 'dim', text: `${res.width}×${res.height} · ${sizeText}` })), after, el('details', {}, el('summary', { text: 'до / before' }), before));
    } else if ((job.kind === 'audio' || job.kind === 'video') && (job.opts.chip || job.opts.remix)) {
      box.innerHTML = '';
      const audio = el('audio', { controls: true, id: 'audioPreview' });
      const btn = el('button', { id: 'preview10', text: t('preview10'), onclick: async () => {
        btn.disabled = true; btn.textContent = t('working');
        try { audio.src = await previewAudio(job, app.platform); audio.play().catch(() => {}); }
        catch (e) { ctx.toast(t(`err.${e.message}`)); }
        finally { btn.disabled = false; btn.textContent = t('preview10'); }
      } });
      box.append(el('div', { class: 'row' }, btn), audio);
    } else if (job.kind === 'mesh') {
      const info = await inspectMesh(job, app.platform);
      if (stale() || !info) return;
      box.innerHTML = '';
      const canvas = el('canvas', { id: 'meshPreview', width: info.preview.width, height: info.preview.height });
      canvas.getContext('2d').putImageData(new ImageData(info.preview.data, info.preview.width, info.preview.height), 0, 0);
      const stats = el('div', { class: 'stats', id: 'meshStats' });
      const add = (k, v) => stats.append(el('span', { class: 'dim', text: t(k) }), el('span', { text: v }));
      add('est.size', info.size);
      add('est.tris', String(info.triangles));
      add('est.volume', `${info.volumeCm3.toFixed(2)} см³`);
      add('est.weight', `${info.weightG.toFixed(1)} г`);
      add('est.length', `${info.lengthM.toFixed(2)} м`);
      add('est.cost', info.cost.toFixed(2));
      stats.append(el('span', { class: 'dim', text: t(info.watertight ? 'est.watertight' : 'est.open') }), el('span', { text: info.watertight ? '✓' : '!' }));
      box.append(canvas, stats);
    } else if (job.kind === 'archive') {
      const res = await listArchive(job, app.platform);
      if (stale() || !res) return;
      box.innerHTML = '';
      const listBox = el('div', { class: 'list', id: 'archiveList' });
      for (const e of res.entries.slice(0, 500)) {
        const row = el('div', {}, el('span', { text: e.path, title: e.path }), el('span', { class: 'dim', text: e.dir ? '/' : humanSize(e.size) }));
        listBox.append(row);
      }
      const extract = el('button', { id: 'extractAll', text: t('archive.extract'), onclick: async () => {
        extract.disabled = true;
        try { const r = await extractArchive(job, app.platform); if (r) ctx.toast(t('saved', { name: `${r.name} (${r.files})` })); }
        catch (e) { ctx.toast(e.message); }
        finally { extract.disabled = false; }
      } });
      box.append(el('div', { class: 'row' }, el('b', { text: t('archive.list') }), el('span', { class: 'dim', text: t('archive.files', { n: res.files }) }), extract), listBox);
    } else if (job.kind === 'doc' && app.platform.desktop) {
      box.innerHTML = '';
      const has = Boolean(app.platform.info.soffice);
      box.append(el('div', { class: 'row' }, el('span', { id: 'officeState', text: t('doc.office', { state: t(has ? 'office.yes' : 'office.no') }) }),
        !has && el('button', { text: t('office.get'), onclick: () => app.platform.getOffice() }),
        !has && el('button', { text: t('office.recheck'), onclick: async () => { await app.platform.recheck(); ctx.rerender(); } })));
    } else if (job.kind === 'video' && job.src.file && !app.platform.desktop) {
      box.innerHTML = '';
      if (!job.view.url) job.view.url = URL.createObjectURL(job.src.file);
      box.append(el('video', { src: job.view.url, controls: true, preload: 'metadata', id: 'videoPreview' }));
    } else box.innerHTML = '';
  } catch (e) {
    if (!stale()) box.textContent = t(`err.${e.message}`) === `err.${e.message}` ? e.message : t(`err.${e.message}`);
  }
}
