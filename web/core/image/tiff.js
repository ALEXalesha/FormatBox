// TIFF: чтение базового TIFF (без сжатия, PackBits, LZW, Deflate; полосы и плитки; предиктор 2;
// серый, RGB, палитра, CMYK; 1/2/4/8/16 бит; альфа) и простая запись (RGB/RGBA, 8 бит).
import { zlibSync, unzlibSync } from '../../vendor/fflate.js';

const MAX_PIXELS = 1 << 28;
const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 16: 8 };

export function isTiff(bytes) {
  return bytes.length >= 8 && ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 42 && bytes[3] === 0)
    || (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0 && bytes[3] === 42));
}

function fail(msg) { throw new Error(`TIFF: ${msg}`); }

export function unpackBits(src, size) {
  const out = new Uint8Array(size);
  let p = 0, o = 0;
  while (p < src.length && o < size) {
    const n = src[p++];
    if (n < 128) {
      const k = Math.min(n + 1, size - o, src.length - p);
      out.set(src.subarray(p, p + k), o);
      o += k; p += n + 1;
    } else if (n > 128) {
      const k = Math.min(257 - n, size - o);
      out.fill(src[p++], o, o + k);
      o += k;
    }
  }
  return out;
}

export function packBits(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    let run = 1;
    while (i + run < src.length && run < 128 && src[i + run] === src[i]) run++;
    if (run > 1) { out.push(257 - run, src[i]); i += run; continue; }
    let j = i + 1;
    while (j < src.length && j - i < 128 && !(j + 1 < src.length && src[j] === src[j + 1])) j++;
    out.push(j - i - 1);
    for (let k = i; k < j; k++) out.push(src[k]);
    i = j;
  }
  return Uint8Array.from(out);
}

// LZW из TIFF: коды 9-12 бит старшим битом вперёд, ширина растёт на одну запись раньше, чем в GIF.
export function unLzw(src, size) {
  const out = new Uint8Array(size);
  const prefix = new Int32Array(4096), suffix = new Uint8Array(4096), len = new Int32Array(4096), first = new Uint8Array(4096);
  for (let i = 0; i < 256; i++) { suffix[i] = first[i] = i; len[i] = 1; prefix[i] = -1; }
  let o = 0, bit = 0, width = 9, next = 258, prev = -1;
  const total = src.length * 8;
  const write = (code) => {
    const n = len[code];
    for (let k = n - 1, c = code; k >= 0; k--, c = prefix[c]) if (o + k < size) out[o + k] = suffix[c];
    o += n;
  };
  while (bit + width <= total && o < size) {
    let code = 0;
    for (let k = 0; k < width; k++, bit++) code = (code << 1) | ((src[bit >> 3] >> (7 - (bit & 7))) & 1);
    if (code === 256) { width = 9; next = 258; prev = -1; continue; }
    if (code === 257) break;
    if (prev < 0) {
      if (code > 255) fail('bad LZW data');
      write(code); prev = code; continue;
    }
    if (code > next) fail('bad LZW data');
    // Новая запись: строка prev + первый байт текущей (для code === next - первый байт prev).
    const head = code < next ? first[code] : first[prev];
    if (next < 4096) {
      prefix[next] = prev; suffix[next] = head; len[next] = len[prev] + 1; first[next] = first[prev];
      next++;
    }
    write(code);
    prev = code;
    if (next + 1 >= 1 << width && width < 12) width++;
  }
  return out;
}

function readIfd(bytes, le, off) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const need = (o, n) => { if (o < 0 || o + n > bytes.length) fail('file truncated'); };
  const u16 = (o) => { need(o, 2); return dv.getUint16(o, le); };
  const u32 = (o) => { need(o, 4); return dv.getUint32(o, le); };
  const n = u16(off);
  const tags = new Map();
  for (let i = 0; i < n; i++) {
    const e = off + 2 + i * 12;
    const tag = u16(e), type = u16(e + 2), count = u32(e + 4);
    const size = TYPE_SIZE[type] || 1;
    const at = size * count <= 4 ? e + 8 : u32(e + 8);
    const vals = [];
    for (let k = 0; k < count && k < 1 << 20; k++) {
      const o = at + k * size;
      vals.push(type === 3 ? u16(o) : type === 4 ? u32(o) : type === 16 ? u32(o + (le ? 0 : 4)) : (need(o, 1), bytes[o]));
    }
    tags.set(tag, vals);
  }
  return { tags, next: u32(off + 2 + n * 12) };
}

export function decodeTiff(bytes, { page = 0 } = {}) {
  if (!isTiff(bytes)) fail('not a TIFF file');
  const le = bytes[0] === 0x49;
  let off = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, le);
  let ifd = readIfd(bytes, le, off);
  for (let p = 0; p < page; p++) {
    if (!ifd.next) fail(`no page ${page}`);
    ifd = readIfd(bytes, le, ifd.next);
  }
  const t = ifd.tags;
  const one = (tag, def) => (t.has(tag) ? t.get(tag)[0] : def);
  const width = one(256, 0), height = one(257, 0);
  if (!(width > 0 && height > 0) || width * height > MAX_PIXELS) fail('bad size');
  const spp = one(277, 1), bits = one(258, 1), compression = one(259, 1), photo = one(262, 1);
  const predictor = one(317, 1), extra = t.get(338)?.[0];
  if (one(284, 1) !== 1) fail('separate color planes are not supported');
  if (one(339, 1) !== 1) fail('only integer samples are supported');
  if (![1, 2, 4, 8, 16].includes(bits)) fail(`unsupported bit depth ${bits}`);
  if (![1, 5, 8, 32946, 32773].includes(compression)) fail(`unsupported compression ${compression}`);
  const colorCh = photo === 2 ? 3 : photo === 5 ? 4 : 1;
  if (![0, 1, 2, 3, 5].includes(photo) || spp < colorCh || ((photo === 2 || photo === 5) && bits < 8)) fail(`unsupported color model ${photo}`);
  const map = t.get(320);
  if (photo === 3 && (!map || map.length < 3 << bits)) fail('no color map');
  // Альфа - первый дополнительный отсчёт, если он не помечен как «неизвестное» (0).
  const alphaMode = spp > colorCh && extra !== 0 ? (extra === 1 ? 'premultiplied' : 'straight') : null;
  const tiled = t.has(322);
  const bw = tiled ? one(322) : width, bh = tiled ? one(323) : Math.min(height, one(278, height));
  const offsets = t.get(tiled ? 324 : 273), counts = t.get(tiled ? 325 : 279);
  if (!offsets || !counts || !bw || !bh) fail('no image data');
  const across = Math.ceil(width / bw);
  const rowBytes = Math.ceil((bw * spp * bits) / 8);
  const max = (1 << bits) - 1;
  const s8 = bits === 16 ? (v) => v >> 8 : (v) => (v * 255) / max;
  const out = new Uint8ClampedArray(width * height * 4);
  for (let b = 0; b < offsets.length; b++) {
    const x0 = tiled ? (b % across) * bw : 0, y0 = tiled ? Math.floor(b / across) * bh : b * bh;
    if (y0 >= height) break;
    const rows = tiled ? bh : Math.min(bh, height - y0);
    const size = rowBytes * rows;
    const end = Math.min(bytes.length, offsets[b] + (counts[b] ?? 0));
    if (offsets[b] >= bytes.length) fail('strip outside the file');
    const src = bytes.subarray(offsets[b], end);
    let raw;
    if (compression === 1) { raw = new Uint8Array(size); raw.set(src.subarray(0, size)); }
    else if (compression === 32773) raw = unpackBits(src, size);
    else if (compression === 5) raw = unLzw(src, size);
    else { raw = new Uint8Array(size); raw.set(unzlibSync(src).subarray(0, size)); }
    const sample = (r, i) => {
      if (bits === 8) return raw[r + i];
      if (bits === 16) return le ? raw[r + 2 * i] | (raw[r + 2 * i + 1] << 8) : (raw[r + 2 * i] << 8) | raw[r + 2 * i + 1];
      const bit = i * bits;
      return (raw[r + (bit >> 3)] >> (8 - bits - (bit & 7))) & max;
    };
    if (predictor === 2 && bits >= 8) {
      for (let y = 0; y < rows; y++) {
        const r = y * rowBytes;
        for (let i = spp; i < bw * spp; i++) {
          if (bits === 8) raw[r + i] = (raw[r + i] + raw[r + i - spp]) & 255;
          else {
            const v = (sample(r, i) + sample(r, i - spp)) & 65535;
            const q = r + 2 * i;
            if (le) { raw[q] = v & 255; raw[q + 1] = v >> 8; } else { raw[q] = v >> 8; raw[q + 1] = v & 255; }
          }
        }
      }
    }
    for (let y = 0; y < rows && y0 + y < height; y++) {
      const r = y * rowBytes;
      for (let x = 0; x < bw && x0 + x < width; x++) {
        const o = ((y0 + y) * width + x0 + x) * 4, s = x * spp;
        let rgb;
        if (photo === 2) rgb = [s8(sample(r, s)), s8(sample(r, s + 1)), s8(sample(r, s + 2))];
        else if (photo === 3) {
          const i = sample(r, s), n = 1 << bits;
          rgb = [map[i] >> 8, map[n + i] >> 8, map[2 * n + i] >> 8];
        } else if (photo === 5) {
          const k = 255 - s8(sample(r, s + 3));
          rgb = [0, 1, 2].map((c) => ((255 - s8(sample(r, s + c))) * k) / 255);
        } else {
          const g = s8(sample(r, s));
          rgb = photo === 0 ? [255 - g, 255 - g, 255 - g] : [g, g, g];
        }
        const a = alphaMode ? s8(sample(r, s + colorCh)) : 255;
        if (alphaMode === 'premultiplied' && a > 0 && a < 255) rgb = rgb.map((v) => (v * 255) / a);
        out[o] = rgb[0]; out[o + 1] = rgb[1]; out[o + 2] = rgb[2]; out[o + 3] = a;
      }
    }
  }
  return { width, height, data: out };
}

// Запись: RGB (или RGBA с неассоциированной альфой), 8 бит, порядок II, полосы ~64 КБ.
export function encodeTiff(image, { compression = 'deflate' } = {}) {
  const { width, height, data } = image;
  if (!(width >= 1 && height >= 1) || data.length !== width * height * 4) fail('bad image');
  const code = { none: 1, packbits: 32773, deflate: 8 }[compression];
  if (!code) fail(`unknown compression ${compression}`);
  let alpha = false;
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) { alpha = true; break; }
  const spp = alpha ? 4 : 3, rowBytes = width * spp;
  const rps = Math.max(1, Math.min(height, Math.floor(65536 / rowBytes)));
  const strips = [];
  for (let y0 = 0; y0 < height; y0 += rps) {
    const rows = Math.min(rps, height - y0);
    const raw = new Uint8Array(rows * rowBytes);
    for (let i = 0, p = y0 * width * 4; i < raw.length; p += 4) {
      raw[i++] = data[p]; raw[i++] = data[p + 1]; raw[i++] = data[p + 2];
      if (alpha) raw[i++] = data[p + 3];
    }
    strips.push(code === 1 ? raw : code === 8 ? zlibSync(raw, { level: 6 }) : packBits(raw));
  }
  const entries = [
    [256, 4, [width]], [257, 4, [height]], [258, 3, Array(spp).fill(8)], [259, 3, [code]], [262, 3, [2]],
    [273, 4, strips.map(() => 0)], [277, 3, [spp]], [278, 4, [rps]], [279, 4, strips.map((s) => s.length)], [284, 3, [1]],
  ];
  if (alpha) entries.push([338, 3, [2]]);
  const ifdSize = 2 + entries.length * 12 + 4;
  // Значения длиннее 4 байт - сразу за IFD, затем данные полос.
  let extraOff = 8 + ifdSize;
  const extraLen = entries.reduce((n, [, type, v]) => n + (v.length * (type === 3 ? 2 : 4) > 4 ? v.length * (type === 3 ? 2 : 4) : 0), 0);
  let dataOff = extraOff + extraLen;
  const offsets = entries.find((e) => e[0] === 273)[2];
  strips.forEach((s, i) => { offsets[i] = dataOff; dataOff += s.length; });
  const out = new Uint8Array(dataOff);
  const dv = new DataView(out.buffer);
  out.set([0x49, 0x49, 42, 0, 8, 0, 0, 0]);
  dv.setUint16(8, entries.length, true);
  entries.forEach(([tag, type, vals], i) => {
    const e = 10 + i * 12, size = type === 3 ? 2 : 4;
    dv.setUint16(e, tag, true); dv.setUint16(e + 2, type, true); dv.setUint32(e + 4, vals.length, true);
    let at = e + 8;
    if (vals.length * size > 4) { dv.setUint32(e + 8, extraOff, true); at = extraOff; extraOff += vals.length * size; }
    vals.forEach((v, k) => (size === 2 ? dv.setUint16(at + k * 2, v, true) : dv.setUint32(at + k * 4, v, true)));
  });
  strips.forEach((s, i) => out.set(s, offsets[i]));
  return out;
}
