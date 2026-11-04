// Поток ядра: всё тяжёлое, кроме ffmpeg (у него свой поток или процесс). Сообщение { id, op, args } -> { id, result }.
// Окно отменяет работу, убивая поток целиком.
const ops = {};
const post = (msg, transfer = []) => self.postMessage(msg, transfer);

self.onmessage = async ({ data: { id, op, args } }) => {
  const progress = (p) => post({ id, progress: p });
  try {
    if (!ops[op]) throw new Error(`unknown-op:${op}`);
    const result = await ops[op](args, { progress });
    const transfer = [];
    if (result?.bytes?.buffer) transfer.push(result.bytes.buffer);
    post({ id, result }, transfer);
  } catch (err) {
    post({ id, error: err?.message || String(err), detail: err?.stack });
  }
};

const lazy = (path) => { let m = null; return () => (m ||= import(path)); };
const Img = lazy('../core/image/index.js');
const Mesh = lazy('../core/mesh/index.js');
const Arch = lazy('../core/archive/index.js');
const Docs = lazy('../core/docs/index.js');
const Audio = lazy('../core/audio/index.js');

// ---------- картинки ----------
const MIME = { jpg: 'image/jpeg', webp: 'image/webp', avif: 'image/avif', png: 'image/png' };

async function decodeImage(bytes, ext) {
  const I = await Img();
  if (ext === 'bmp') return I.decodeBmp(bytes);
  if (ext === 'ico') return I.decodeIcoLargest(bytes);
  if (ext === 'tiff') return I.decodeTiff(bytes);
  const bmp = await createImageBitmap(new Blob([bytes]));
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { width: d.width, height: d.height, data: d.data };
}

async function canvasEncode(image, type, quality) {
  const canvas = new OffscreenCanvas(image.width, image.height);
  canvas.getContext('2d').putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
  const blob = await canvas.convertToBlob({ type, quality });
  if (blob.type !== type) throw new Error(`no-encoder:${type}`);
  return new Uint8Array(await blob.arrayBuffer());
}

function textStamp(text, size, color = 'rgba(255,255,255,1)') {
  const probe = new OffscreenCanvas(8, 8).getContext('2d');
  probe.font = `bold ${size}px sans-serif`;
  const w = Math.ceil(probe.measureText(text).width) + 8;
  const h = Math.ceil(size * 1.4);
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.font = `bold ${size}px sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.lineWidth = Math.max(1, size / 14);
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.strokeText(text, 4, h / 2);
  ctx.fillStyle = color;
  ctx.fillText(text, 4, h / 2);
  const d = ctx.getImageData(0, 0, w, h);
  return { width: w, height: h, data: d.data };
}

// Все правки картинки по opts, по порядку: края, поворот, отражение, размер, фон, водяной знак
async function editImage(image, opts, ctl) {
  const I = await Img();
  let img = image;
  const pct = opts.cropPct;
  if (pct && (pct.left || pct.top || pct.right || pct.bottom)) {
    const side = (v) => Math.min(95, Math.max(0, v || 0)) / 100;
    const x = Math.floor(img.width * side(pct.left)), y = Math.floor(img.height * side(pct.top));
    const width = Math.max(1, Math.floor(img.width * (1 - side(pct.left) - side(pct.right))));
    const height = Math.max(1, Math.floor(img.height * (1 - side(pct.top) - side(pct.bottom))));
    img = I.cropRect(img, { x, y, width: Math.min(width, img.width - x), height: Math.min(height, img.height - y) });
  }
  if (opts.rotate === 90) img = I.rotate90(img);
  else if (opts.rotate === 180) img = I.rotate180(img);
  else if (opts.rotate === 270) img = I.rotate270(img);
  if (opts.flipH) img = I.flipH(img);
  if (opts.flipV) img = I.flipV(img);
  if (opts.percent) img = I.scaleByPercent(img, opts.percent, ctl);
  if (opts.width && opts.height) img = I.fitInto(img, opts.width, opts.height, opts.fit || 'contain', ctl);
  else if (opts.width || opts.height) {
    const w = opts.width || Math.round((img.width * opts.height) / img.height);
    const h = opts.height || Math.round((img.height * opts.width) / img.width);
    img = I.resize(img, Math.max(1, w), Math.max(1, h), ctl);
  }
  if (opts.maxPixels && img.width * img.height > opts.maxPixels) {
    const s = I.fitToPixels(img.width, img.height, opts.maxPixels);
    img = I.resize(img, s.width, s.height, ctl);
  }
  if (opts.removeBg) img = I.removeBackground(img, { tolerance: opts.tolerance ?? 20 });
  if (opts.watermark?.text) {
    const size = Math.max(12, Math.round(Math.min(img.width, img.height) / 14));
    const stamp = textStamp(opts.watermark.text, size);
    img = I.overlay(img, stamp, { anchor: opts.watermark.tile ? 'center' : 'br', opacity: opts.watermark.opacity ?? 0.35, tile: Boolean(opts.watermark.tile), gap: size });
  }
  return img;
}

function hasEdits(o) {
  return Boolean(o.cropPct && Object.values(o.cropPct).some(Boolean)) || o.rotate || o.flipH || o.flipV || o.percent || o.width || o.height || o.maxPixels || o.removeBg || o.watermark?.text || o.maxBytes || o.quality != null;
}

async function encodeImage(img, to, opts, ctl) {
  const I = await Img();
  if (to === 'ico') return I.encodeIco(img, opts.icoSizes || I.ICO_SIZES);
  if (to === 'bmp') return I.encodeBmp(img);
  // в JPEG нет прозрачности: canvas сделал бы её чёрной, кладём на белый
  const encodeAt = (im, q) => (to === 'png' ? Promise.resolve(I.encodePng(im)) : canvasEncode(to === 'jpg' ? I.flatten(im) : im, MIME[to], q / 100));
  if (opts.maxBytes) {
    try {
      const res = await I.encodeToSize(img, opts.maxBytes, (im, q) => encodeAt(im, q), { allowDownscale: true, signal: ctl.signal });
      return res.bytes;
    } catch (err) {
      if (err.code === 'TOO_SMALL') throw new Error('size-unreachable');
      throw err;
    }
  }
  return encodeAt(img, opts.quality ?? 85);
}

ops.image = async ({ bytes, ext, to, opts }, ctl) => {
  const I = await Img();
  // только убрать сведения, без перекодирования: сжатые данные остаются байт в байт
  if (to === ext && opts.stripMeta !== false && !hasEdits(opts) && ['jpg', 'png', 'webp'].includes(ext)) {
    return { bytes: I.stripMetadata(bytes, { keepIcc: true }).bytes, width: 0, height: 0, lossless: true };
  }
  const img = await editImage(await decodeImage(bytes, ext), opts, ctl);
  ctl.progress(0.5);
  const out = await encodeImage(img, to, opts, ctl);
  return { bytes: out, width: img.width, height: img.height };
};

// предпросмотр: картинка поменьше, тот же путь правок и кодирования
ops.imagePreview = async ({ bytes, ext, to, opts }) => {
  const I = await Img();
  let img = await decodeImage(bytes, ext);
  const full = { width: img.width, height: img.height };
  const before = await canvasEncode(img.width * img.height > 1_500_000 ? I.resize(img, ...Object.values(I.fitToPixels(img.width, img.height, 1_500_000))) : img, 'image/png');
  img = await editImage(img, opts, {});
  const out = to === 'ico' || to === 'bmp' ? await canvasEncode(img, 'image/png') : await encodeImage(img, to, opts, {});
  const shown = to === 'avif' || to === 'jpg' || to === 'webp' || to === 'png' ? out : await canvasEncode(img, 'image/png');
  const realSize = to === 'ico' || to === 'bmp' ? (await encodeImage(img, to, opts, {})).length : out.length;
  return { before, after: shown, bytes: realSize, width: img.width, height: img.height, full };
};

// картинка -> серая карта для 3D
async function grayOf(bytes, ext, maxPixels = 600_000) {
  const I = await Img();
  let img = await decodeImage(bytes, ext);
  if (img.width * img.height > maxPixels) { const s = I.fitToPixels(img.width, img.height, maxPixels); img = I.resize(img, s.width, s.height); }
  const gray = new Uint8Array(img.width * img.height);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    const a = img.data[p + 3] / 255;
    gray[i] = Math.round((0.299 * img.data[p] + 0.587 * img.data[p + 1] + 0.114 * img.data[p + 2]) * a + 255 * (1 - a));
  }
  return { width: img.width, height: img.height, data: gray };
}

// ---------- 3D ----------
ops.to3d = async ({ bytes, ext, to, opts }, ctl) => {
  const M = await Mesh();
  const gray = await grayOf(bytes, ext);
  const kind = opts.to3d;
  const widthMm = opts.widthMm || 100;
  let mesh;
  if (['litho', 'curved', 'cylinder'].includes(kind)) {
    mesh = M.lithophane(gray, { shape: kind === 'litho' ? 'flat' : kind, widthMm, minMm: opts.minMm ?? 0.8, maxMm: opts.maxMm ?? 3, borderMm: 2 }, ctl);
  } else if (kind === 'relief') {
    mesh = M.relief(gray, { widthMm, baseMm: 1, heightMm: opts.heightMm ?? 3 }, ctl);
  } else {
    mesh = await M.extrudeSilhouette(gray, { mode: kind, widthMm, heightMm: opts.heightMm ?? 3 }, ctl);
  }
  const extra = {};
  if (opts.colors > 1) extra.heights = M.colorChangeHeights(mesh, { colors: opts.colors, layerHeight: 0.2 });
  return { bytes: M.writeMesh(mesh, to), triangles: mesh.indices.length / 3, ...extra };
};

ops.text3d = async ({ text, to, opts }) => {
  const M = await Mesh();
  const mesh = M.textToMesh(text, { heightMm: opts.heightMm || 10, depthMm: opts.depthMm || 3 });
  return { bytes: M.writeMesh(mesh, to), triangles: mesh.indices.length / 3 };
};

async function loadMesh(M, bytes, ext, opts) {
  let mesh = M.readMesh(bytes, ext);
  if (opts.units && opts.units !== 'mm') mesh = M.convertUnits(mesh, opts.units, 'mm');
  return mesh;
}

ops.mesh = async ({ bytes, ext, to, opts }, ctl) => {
  const M = await Mesh();
  let mesh = await loadMesh(M, bytes, ext, opts);
  let report = null;
  if (opts.repair) ({ mesh, report } = await M.repairMesh(mesh, { signal: ctl.signal }));
  ctl.progress(0.4);
  if (opts.decimate && opts.decimate < 100) mesh = await M.decimate(mesh, { ratio: opts.decimate / 100 }, { progress: (p) => ctl.progress(0.4 + p * 0.5) });
  return { bytes: M.writeMesh(mesh, to), triangles: mesh.indices.length / 3, report };
};

ops.meshInfo = async ({ bytes, ext, opts }) => {
  const M = await Mesh();
  const mesh = await loadMesh(M, bytes, ext, opts);
  const st = M.meshStats(mesh);
  const est = M.printEstimate(mesh, { material: opts.material || 'PLA', infill: (opts.infill ?? 20) / 100, pricePerKg: opts.pricePerKg ?? 1500 });
  const preview = M.renderPreview(mesh, { width: 360, height: 270, view: 'iso' });
  const b = st.bounds || M.bounds(mesh);
  const size = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]].map((v) => v.toFixed(1)).join(' × ') + ' мм';
  return {
    triangles: mesh.indices.length / 3, size, watertight: M.isWatertight(mesh),
    volumeCm3: est.volumeMm3 / 1000, weightG: est.grams, lengthM: est.lengthM, cost: est.price, preview,
  };
};

ops.gcode = async ({ bytes, opts }) => {
  const M = await Mesh();
  const text = new TextDecoder().decode(bytes);
  const out = M.insertColorChanges(text, opts.heights || [], { command: 'M600' });
  return { bytes: new TextEncoder().encode(out) };
};

// ---------- архивы ----------
ops.archiveList = async ({ bytes, name }) => {
  const A = await Arch();
  const entries = await A.list(bytes, name);
  return { entries: entries.map((e) => ({ path: e.path, dir: Boolean(e.dir), size: e.size ?? e.data?.length ?? 0 })), files: entries.filter((e) => !e.dir).length };
};
ops.archiveExtract = async ({ bytes, name }, ctl) => (await Arch()).extract(bytes, name, ctl).then((entries) => ({ entries }));
ops.archiveRepack = async ({ bytes, name, to }, ctl) => ({ bytes: await (await Arch()).repack(bytes, name, to, ctl) });

// ---------- документы ----------
let docLibs = null;
async function libs() {
  if (docLibs) return docLibs;
  const [pdfLib, fontkit, pdfjs, font] = await Promise.all([
    import('../vendor/pdf-lib.js'), import('../vendor/fontkit.js'), import('../vendor/pdf.mjs'),
    fetch(new URL('../fonts/DejaVuSans.ttf', import.meta.url)).then((r) => r.arrayBuffer()),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.mjs', import.meta.url).href;
  docLibs = { pdfLib, fontkit: fontkit.default, pdfjs, fontBytes: new Uint8Array(font) };
  return docLibs;
}
ops.doc = async ({ bytes, ext, to }) => ({ bytes: await (await Docs()).convertDoc(bytes, ext, to, await libs()) });

// ---------- звук (PCM) ----------
ops.audio = async ({ bytes, opts, previewSeconds }, ctl) => {
  const A = await Audio();
  let audio = A.decodeWav(bytes);
  if (previewSeconds) audio = { ...audio, channels: audio.channels.map((c) => c.subarray(0, Math.min(c.length, Math.round(audio.sampleRate * previewSeconds * 3)))) };
  if (opts.remix) {
    const score = await A.transcribe(audio, { channels: opts.remixParts || ['melody', 'bass', 'drums'] }, { signal: ctl.signal, progress: (p) => ctl.progress(p * 0.8) });
    audio = A.renderChip(score, { sampleRate: 44100, previewSeconds }, ctl);
  } else if (opts.chip) audio = A.chipify(audio, { preset: opts.chip }, { signal: ctl.signal });
  else if (previewSeconds) audio = { ...audio, channels: audio.channels.map((c) => c.subarray(0, Math.round(audio.sampleRate * previewSeconds))) };
  const a = opts.audio || {};
  if (a.bits || a.sampleRate || a.channels || (a.dither && a.dither !== 'none')) {
    const res = A.convertPcm(audio, { sampleRate: a.sampleRate || audio.sampleRate, bits: a.bits || 16, float: a.bits === 32, channels: a.channels || audio.channels.length, dither: a.dither || 'none' }, { signal: ctl.signal });
    return { bytes: res.bytes ?? res.wav };
  }
  return { bytes: A.encodeWav(audio, { bits: 16 }) };
};
