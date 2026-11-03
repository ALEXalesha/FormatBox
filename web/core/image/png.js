// PNG: свой декодер (все типы цвета, глубины 1/2/4/8/16, палитра + tRNS, все фильтры, Adam7)
// и кодер (фильтр выбирается для каждой строки, сжатие zlib из fflate). Картинка внутри -
// { width, height, data: Uint8ClampedArray RGBA }; 16-битные отсчёты при чтении сводятся к 8 битам.
import { zlibSync, unzlibSync } from '../../vendor/fflate.js';

const SIG = [137, 80, 78, 71, 13, 10, 26, 10];
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const DEPTHS = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
const ADAM7 = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];
const MAX_PIXELS = 1 << 28;

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

export function crc32(bytes, start = 0, end = bytes.length) {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function isPng(bytes) {
  return bytes.length >= 8 && SIG.every((b, i) => bytes[i] === b);
}

// Список чанков: { type, start (начало длины), dataStart, length, end (после CRC) }.
// Обрезанный хвост файла не роняет разбор - он просто заканчивается.
export function readChunks(bytes) {
  const list = [];
  let p = 8;
  while (p + 12 <= bytes.length) {
    const length = ((bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3]) >>> 0;
    const end = p + 12 + length;
    if (end > bytes.length) break;
    const type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
    list.push({ type, start: p, dataStart: p + 8, length, end });
    p = end;
    if (type === 'IEND') break;
  }
  return list;
}

export function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function unfilter(type, cur, prev, bpp) {
  const n = cur.length;
  if (type === 1) for (let i = bpp; i < n; i++) cur[i] = (cur[i] + cur[i - bpp]) & 255;
  else if (type === 2) for (let i = 0; i < n; i++) cur[i] = (cur[i] + prev[i]) & 255;
  else if (type === 3) {
    for (let i = 0; i < n; i++) cur[i] = (cur[i] + (((i >= bpp ? cur[i - bpp] : 0) + prev[i]) >> 1)) & 255;
  } else if (type === 4) {
    for (let i = 0; i < n; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, c = i >= bpp ? prev[i - bpp] : 0;
      cur[i] = (cur[i] + paeth(a, prev[i], c)) & 255;
    }
  } else if (type !== 0) throw new Error(`PNG: unknown filter ${type}`);
}

function sample(row, i, depth) {
  if (depth === 8) return row[i];
  if (depth === 16) return (row[2 * i] << 8) | row[2 * i + 1];
  const bit = i * depth;
  return (row[bit >> 3] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
}

const u16 = (d, i) => (d[i] << 8) | d[i + 1];

export function decodePng(bytes) {
  if (!isPng(bytes)) throw new Error('not a PNG file');
  let ihdr = null, palette = null, trns = null;
  const idat = [];
  for (const c of readChunks(bytes)) {
    const d = bytes.subarray(c.dataStart, c.dataStart + c.length);
    if (c.type === 'IHDR') ihdr = d;
    else if (c.type === 'PLTE') palette = d;
    else if (c.type === 'tRNS') trns = d;
    else if (c.type === 'IDAT') idat.push(d);
  }
  if (!ihdr || ihdr.length < 13) throw new Error('PNG: no IHDR');
  const width = ((ihdr[0] << 24) | (ihdr[1] << 16) | (ihdr[2] << 8) | ihdr[3]) >>> 0;
  const height = ((ihdr[4] << 24) | (ihdr[5] << 16) | (ihdr[6] << 8) | ihdr[7]) >>> 0;
  const depth = ihdr[8], ctype = ihdr[9], interlace = ihdr[12];
  const channels = CHANNELS[ctype];
  if (!channels || !DEPTHS[ctype].includes(depth)) throw new Error(`PNG: bad color type ${ctype}/${depth}`);
  if (!width || !height || width * height > MAX_PIXELS) throw new Error('PNG: bad size');
  if (ctype === 3 && !palette) throw new Error('PNG: no palette');
  if (!idat.length) throw new Error('PNG: no image data');
  const raw = unzlibSync(concat(idat));
  const out = new Uint8ClampedArray(width * height * 4);
  const bpp = Math.max(1, (channels * depth) >> 3);
  const scale = depth === 16 ? (v) => v >> 8 : depth === 8 ? (v) => v : (v) => (v * 255) / ((1 << depth) - 1);
  // Ключ прозрачности для серого и RGB сравнивается с исходным (не масштабированным) отсчётом.
  const key = trns && ctype === 0 && trns.length >= 2 ? [u16(trns, 0)]
    : trns && ctype === 2 && trns.length >= 6 ? [u16(trns, 0), u16(trns, 2), u16(trns, 4)] : null;
  let pos = 0;
  for (const [x0, y0, dx, dy] of interlace ? ADAM7 : [[0, 0, 1, 1]]) {
    const pw = Math.ceil((width - x0) / dx), ph = Math.ceil((height - y0) / dy);
    if (pw <= 0 || ph <= 0) continue;
    const stride = Math.ceil((pw * channels * depth) / 8);
    let prev = new Uint8Array(stride);
    for (let y = 0; y < ph; y++) {
      if (pos + 1 + stride > raw.length) throw new Error('PNG: image data truncated');
      const cur = raw.slice(pos + 1, pos + 1 + stride);
      unfilter(raw[pos], cur, prev, bpp);
      pos += 1 + stride;
      for (let x = 0; x < pw; x++) {
        const o = ((y0 + y * dy) * width + x0 + x * dx) * 4;
        const s = x * channels;
        if (ctype === 3) {
          const idx = sample(cur, s, depth), p = idx * 3;
          if (p + 2 < palette.length) { out[o] = palette[p]; out[o + 1] = palette[p + 1]; out[o + 2] = palette[p + 2]; }
          out[o + 3] = trns && idx < trns.length ? trns[idx] : 255;
        } else if (ctype === 0 || ctype === 4) {
          const v = sample(cur, s, depth);
          out[o] = out[o + 1] = out[o + 2] = scale(v);
          out[o + 3] = ctype === 4 ? scale(sample(cur, s + 1, depth)) : key && v === key[0] ? 0 : 255;
        } else {
          const r = sample(cur, s, depth), g = sample(cur, s + 1, depth), b = sample(cur, s + 2, depth);
          out[o] = scale(r); out[o + 1] = scale(g); out[o + 2] = scale(b);
          out[o + 3] = ctype === 6 ? scale(sample(cur, s + 3, depth)) : key && r === key[0] && g === key[1] && b === key[2] ? 0 : 255;
        }
      }
      prev = cur;
    }
  }
  return { width, height, data: out };
}

function concat(parts) {
  if (parts.length === 1) return parts[0];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// Как хранить: палитра (<= 256 цветов), серый, серый+альфа, RGB или RGBA - что короче.
function analyze(data, usePalette) {
  let opaque = true, gray = true;
  const colors = new Map();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] !== 255) opaque = false;
    if (data[i] !== data[i + 1] || data[i] !== data[i + 2]) gray = false;
    if (usePalette && colors.size <= 256) {
      const k = ((data[i] << 24) | (data[i + 1] << 16) | (data[i + 2] << 8) | data[i + 3]) >>> 0;
      if (!colors.has(k)) colors.set(k, colors.size);
    }
  }
  if (usePalette && colors.size <= 256 && !(gray && opaque && colors.size > 16)) {
    const n = colors.size;
    return { ctype: 3, depth: n <= 2 ? 1 : n <= 4 ? 2 : n <= 16 ? 4 : 8, colors };
  }
  if (gray) return { ctype: opaque ? 0 : 4, depth: 8 };
  return { ctype: opaque ? 2 : 6, depth: 8 };
}

function filterRow(type, cur, prev, bpp, out, o) {
  out[o] = type;
  for (let i = 0; i < cur.length; i++) {
    const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
    const pred = type === 0 ? 0 : type === 1 ? a : type === 2 ? b : type === 3 ? (a + b) >> 1 : paeth(a, b, c);
    out[o + 1 + i] = (cur[i] - pred) & 255;
  }
}

// Эвристика из спецификации: минимальная сумма модулей (байты как знаковые).
function rowCost(buf, o, n) {
  let s = 0;
  for (let i = o + 1; i <= o + n; i++) s += buf[i] < 128 ? buf[i] : 256 - buf[i];
  return s;
}

export function encodePng(image, { level = 6, palette = true, filter = 'auto' } = {}) {
  const { width, height, data } = image;
  if (!(width >= 1 && height >= 1) || data.length !== width * height * 4) throw new Error('PNG: bad image');
  const { ctype, depth, colors } = analyze(data, palette);
  const channels = CHANNELS[ctype];
  const stride = Math.ceil((width * channels * depth) / 8);
  const bpp = Math.max(1, (channels * depth) >> 3);
  const filtered = new Uint8Array((stride + 1) * height);
  const trial = new Uint8Array(stride + 1);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const cur = new Uint8Array(stride);
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (ctype === 3) {
        const k = ((data[i] << 24) | (data[i + 1] << 16) | (data[i + 2] << 8) | data[i + 3]) >>> 0;
        const bit = x * depth;
        cur[bit >> 3] |= colors.get(k) << (8 - depth - (bit & 7));
      } else if (ctype === 0) cur[x] = data[i];
      else if (ctype === 4) { cur[2 * x] = data[i]; cur[2 * x + 1] = data[i + 3]; }
      else for (let c = 0; c < channels; c++) cur[x * channels + c] = data[i + c];
    }
    const o = y * (stride + 1);
    // Для палитры фильтр «нет» - так советует спецификация (индексы не гладкие).
    if (filter !== 'auto') filterRow(filter, cur, prev, bpp, filtered, o);
    else if (ctype === 3) filterRow(0, cur, prev, bpp, filtered, o);
    else {
      let best = Infinity;
      for (let t = 0; t < 5; t++) {
        filterRow(t, cur, prev, bpp, trial, 0);
        const cost = rowCost(trial, 0, stride);
        if (cost < best) { best = cost; filtered.set(trial, o); }
      }
    }
    prev = cur;
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width); dv.setUint32(4, height);
  ihdr[8] = depth; ihdr[9] = ctype;
  const parts = [Uint8Array.from(SIG), chunk('IHDR', ihdr)];
  if (ctype === 3) {
    const plte = new Uint8Array(colors.size * 3), alpha = new Uint8Array(colors.size);
    let lastAlpha = 0;
    for (const [k, idx] of colors) {
      plte[idx * 3] = k >>> 24; plte[idx * 3 + 1] = (k >>> 16) & 255; plte[idx * 3 + 2] = (k >>> 8) & 255;
      alpha[idx] = k & 255;
      if (alpha[idx] !== 255) lastAlpha = idx + 1;
    }
    parts.push(chunk('PLTE', plte));
    if (lastAlpha) parts.push(chunk('tRNS', alpha.subarray(0, lastAlpha)));
  }
  parts.push(chunk('IDAT', zlibSync(filtered, { level })), chunk('IEND', new Uint8Array(0)));
  return concat(parts);
}

export function chunk(type, data) {
  const out = new Uint8Array(data.length + 12);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}
