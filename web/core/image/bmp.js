// BMP: чтение (заголовки CORE/INFO/V2-V5, 1/4/8/16/24/32 бит, палитра, битовые маски, RLE4/RLE8,
// строки снизу вверх и сверху вниз) и запись (24 бита без прозрачности, иначе 32 бита с альфой).
// decodeDib читает и картинки внутри ICO (там высота удвоена и есть маска прозрачности AND).

const MAX_PIXELS = 1 << 28;

function reader(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const need = (o, n) => { if (o < 0 || o + n > bytes.length) throw new Error('BMP: file truncated'); };
  return {
    u8: (o) => { need(o, 1); return bytes[o]; },
    u16: (o) => { need(o, 2); return dv.getUint16(o, true); },
    i16: (o) => { need(o, 2); return dv.getInt16(o, true); },
    u32: (o) => { need(o, 4); return dv.getUint32(o, true); },
    i32: (o) => { need(o, 4); return dv.getInt32(o, true); },
  };
}

// Маска -> (сдвиг, максимум): канал = ((v & mask) >>> shift) * 255 / max.
function channel(mask) {
  if (!mask) return null;
  let shift = 0;
  while (!((mask >>> shift) & 1)) shift++;
  return { mask, shift, max: mask >>> shift };
}

const take = (v, c) => (!c ? 0 : c.max === 255 ? (v & c.mask) >>> c.shift : Math.round(((((v & c.mask) >>> 0) >>> c.shift) * 255) / c.max));

// RLE8/RLE4 -> индексы палитры (-1 - пиксель не задан и остаётся прозрачным).
function unrle(bytes, p, width, height, bits) {
  const idx = new Int16Array(width * height).fill(-1);
  let x = 0, y = 0;
  const put = (v) => { if (x < width && y < height) idx[y * width + x] = v; x++; };
  while (p + 1 < bytes.length && y < height) {
    const n = bytes[p], v = bytes[p + 1];
    p += 2;
    if (n > 0) {
      for (let i = 0; i < n; i++) put(bits === 8 ? v : i & 1 ? v & 15 : v >> 4);
    } else if (v === 0) { x = 0; y++; }
    else if (v === 1) break;
    else if (v === 2) { x += bytes[p] ?? 0; y += bytes[p + 1] ?? 0; p += 2; }
    else {
      for (let i = 0; i < v; i++) put(bits === 8 ? bytes[p + i] : i & 1 ? bytes[p + (i >> 1)] & 15 : bytes[p + (i >> 1)] >> 4);
      const used = bits === 8 ? v : (v + 1) >> 1;
      p += used + (used & 1);
    }
  }
  return idx;
}

export function decodeDib(bytes, at, { pixelOffset, icon = false } = {}) {
  const rd = reader(bytes);
  const hsize = rd.u32(at);
  let width, height, bpp, compression = 0, colors = 0;
  if (hsize === 12) {
    width = rd.u16(at + 4); height = rd.i16(at + 6); bpp = rd.u16(at + 10);
  } else if (hsize >= 40) {
    width = rd.i32(at + 4); height = rd.i32(at + 8); bpp = rd.u16(at + 14);
    compression = rd.u32(at + 16); colors = rd.u32(at + 32);
  } else throw new Error(`BMP: unknown header size ${hsize}`);
  const topDown = height < 0;
  height = Math.abs(height);
  if (icon) height >>= 1;
  if (!(width > 0 && height > 0) || width * height > MAX_PIXELS) throw new Error('BMP: bad size');
  if (![1, 4, 8, 16, 24, 32].includes(bpp)) throw new Error(`BMP: unsupported bit depth ${bpp}`);
  if (![0, 1, 2, 3, 6].includes(compression)) throw new Error(`BMP: unsupported compression ${compression}`);
  let p = at + hsize;
  // Маски: в заголовке V2+ или сразу после INFO-заголовка (BI_BITFIELDS / BI_ALPHABITFIELDS).
  let masks = null;
  if (compression === 3 || compression === 6) {
    const mo = hsize >= 52 ? at + 40 : p;
    masks = [rd.u32(mo), rd.u32(mo + 4), rd.u32(mo + 8), hsize >= 56 || compression === 6 ? rd.u32(mo + 12) : 0];
    if (hsize < 52) p += compression === 6 ? 16 : 12;
  } else if (hsize >= 56 && bpp >= 16) {
    // V3+ без масок сжатия: альфа-маска всё равно может быть задана (32 бита).
    masks = bpp === 32 ? [0xff0000, 0xff00, 0xff, rd.u32(at + 52)] : null;
  }
  if (!masks && bpp === 16) masks = [0x7c00, 0x3e0, 0x1f, 0];
  const palette = [];
  if (bpp <= 8) {
    const n = colors || 1 << bpp, step = hsize === 12 ? 3 : 4;
    for (let i = 0; i < n && p + step <= bytes.length; i++, p += step) palette.push([bytes[p + 2], bytes[p + 1], bytes[p]]);
  }
  const data = pixelOffset ?? p;
  const out = new Uint8ClampedArray(width * height * 4);
  const stride = Math.ceil((width * bpp) / 32) * 4;
  const row = (y) => data + (topDown ? y : height - 1 - y) * stride;
  const setIdx = (o, i) => {
    const c = palette[i];
    if (c) { out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; }
    out[o + 3] = 255;
  };
  if (compression === 1 || compression === 2) {
    const idx = unrle(bytes, data, width, height, compression === 1 ? 8 : 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const v = idx[(height - 1 - y) * width + x];
        if (v >= 0) setIdx((y * width + x) * 4, v);
      }
    }
    return { width, height, data: out };
  }
  if (data + stride * (height - 1) + Math.ceil((width * bpp) / 8) > bytes.length) throw new Error('BMP: file truncated');
  const ch = masks?.map(channel);
  let anyAlpha = false;
  for (let y = 0; y < height; y++) {
    const r0 = row(y);
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (bpp <= 8) {
        const bit = x * bpp;
        setIdx(o, (bytes[r0 + (bit >> 3)] >> (8 - bpp - (bit & 7))) & ((1 << bpp) - 1));
      } else if (bpp === 24) {
        const q = r0 + x * 3;
        out[o] = bytes[q + 2]; out[o + 1] = bytes[q + 1]; out[o + 2] = bytes[q]; out[o + 3] = 255;
      } else {
        const v = bpp === 16 ? rd.u16(r0 + x * 2) : rd.u32(r0 + x * 4);
        if (ch) {
          out[o] = take(v, ch[0]); out[o + 1] = take(v, ch[1]); out[o + 2] = take(v, ch[2]);
          out[o + 3] = ch[3] ? take(v, ch[3]) : 255;
        } else {
          out[o] = (v >>> 16) & 255; out[o + 1] = (v >>> 8) & 255; out[o + 2] = v & 255; out[o + 3] = v >>> 24;
        }
        if (out[o + 3]) anyAlpha = true;
      }
    }
  }
  // 32 бита без маски: четвёртый байт - альфа, только если он где-то не ноль (иначе это «резерв»).
  const plain32 = bpp === 32 && !ch;
  if (plain32 && !anyAlpha && !icon) for (let i = 3; i < out.length; i += 4) out[i] = 255;
  // ICO: маска AND (1 = прозрачно) после цветных строк; у 32-битных значок прозрачен по альфе.
  if (icon && !(bpp === 32 && anyAlpha)) {
    const mstride = Math.ceil(width / 32) * 4, m0 = data + stride * height;
    for (let y = 0; y < height; y++) {
      const mr = m0 + (topDown ? y : height - 1 - y) * mstride;
      for (let x = 0; x < width; x++) {
        const bit = mr + (x >> 3) < bytes.length ? (bytes[mr + (x >> 3)] >> (7 - (x & 7))) & 1 : 0;
        out[(y * width + x) * 4 + 3] = bit ? 0 : 255;
      }
    }
  }
  return { width, height, data: out, bpp };
}

export function isBmp(bytes) {
  return bytes.length >= 26 && bytes[0] === 0x42 && bytes[1] === 0x4d;
}

export function decodeBmp(bytes) {
  if (!isBmp(bytes)) throw new Error('not a BMP file');
  const off = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(10, true);
  const { width, height, data } = decodeDib(bytes, 14, { pixelOffset: off });
  return { width, height, data };
}

// Без прозрачности - 24 бита (BITMAPINFOHEADER), иначе 32 бита с маской альфы (BITMAPV4HEADER).
export function encodeBmp(image) {
  const { width, height, data } = image;
  if (!(width >= 1 && height >= 1) || data.length !== width * height * 4) throw new Error('BMP: bad image');
  let alpha = false;
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) { alpha = true; break; }
  const bpp = alpha ? 32 : 24, hsize = alpha ? 108 : 40;
  const stride = Math.ceil((width * bpp) / 32) * 4;
  const off = 14 + hsize, size = off + stride * height;
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  out[0] = 0x42; out[1] = 0x4d;
  dv.setUint32(2, size, true);
  dv.setUint32(10, off, true);
  dv.setUint32(14, hsize, true);
  dv.setInt32(18, width, true);
  dv.setInt32(22, height, true);
  dv.setUint16(26, 1, true);
  dv.setUint16(28, bpp, true);
  dv.setUint32(30, alpha ? 3 : 0, true);
  dv.setUint32(34, stride * height, true);
  dv.setUint32(38, 2835, true); // 72 dpi
  dv.setUint32(42, 2835, true);
  if (alpha) {
    [0xff0000, 0xff00, 0xff, 0xff000000].forEach((m, i) => dv.setUint32(54 + i * 4, m, true));
    dv.setUint32(70, 0x73524742, true); // 'sRGB'
  }
  for (let y = 0; y < height; y++) {
    let o = off + (height - 1 - y) * stride;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      out[o++] = data[i + 2]; out[o++] = data[i + 1]; out[o++] = data[i];
      if (alpha) out[o++] = data[i + 3];
    }
  }
  return out;
}
