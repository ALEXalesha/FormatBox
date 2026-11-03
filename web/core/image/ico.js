// ICO: запись (внутри каждой записи - PNG, размеры подгоняются сами) и чтение (PNG и BMP-записи).
import { encodePng, decodePng, isPng } from './png.js';
import { decodeDib } from './bmp.js';
import { fitInto } from './geometry.js';

export const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

export function isIco(bytes) {
  return bytes.length >= 6 && bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0 && (bytes[4] | bytes[5]) > 0;
}

// Источник для размера s: самая маленькая картинка, у которой обе стороны >= s (меньше теряется
// при уменьшении), иначе самая большая.
function pickSource(images, s) {
  const area = (im) => im.width * im.height;
  const fits = images.filter((im) => im.width >= s && im.height >= s).sort((a, b) => area(a) - area(b));
  return fits[0] ?? [...images].sort((a, b) => area(b) - area(a))[0];
}

export function encodeIco(input, sizes = ICO_SIZES, { signal } = {}) {
  const images = Array.isArray(input) ? input : [input];
  if (!images.length) throw new Error('ICO: no images');
  if (!sizes.length) throw new Error('ICO: no sizes');
  const list = sizes.map((s) => (typeof s === 'number' ? { width: s, height: s } : s));
  for (const { width, height } of list) {
    if (!(Number.isInteger(width) && Number.isInteger(height) && width >= 1 && height >= 1 && width <= 256 && height <= 256)) {
      throw new Error(`ICO: size must be 1..256, got ${width}x${height}`);
    }
  }
  const pngs = list.map(({ width, height }) => {
    const src = pickSource(images, Math.max(width, height));
    const img = src.width === width && src.height === height ? src : fitInto(src, width, height, 'pad', { signal });
    return encodePng(img, { level: 9 });
  });
  const total = 6 + 16 * list.length + pngs.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint16(2, 1, true);
  dv.setUint16(4, list.length, true);
  let off = 6 + 16 * list.length;
  list.forEach(({ width, height }, i) => {
    const e = 6 + i * 16;
    out[e] = width & 255; // 256 записывается как 0
    out[e + 1] = height & 255;
    dv.setUint16(e + 4, 1, true);
    dv.setUint16(e + 6, 32, true);
    dv.setUint32(e + 8, pngs[i].length, true);
    dv.setUint32(e + 12, off, true);
    out.set(pngs[i], off);
    off += pngs[i].length;
  });
  return out;
}

// Все записи: [{ width, height, bpp, image }] в порядке файла.
export function decodeIco(bytes) {
  if (!isIco(bytes)) throw new Error('not an ICO file');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = dv.getUint16(4, true);
  if (6 + count * 16 > bytes.length) throw new Error('ICO: directory truncated');
  const out = [];
  for (let i = 0; i < count; i++) {
    const e = 6 + i * 16;
    const size = dv.getUint32(e + 8, true), off = dv.getUint32(e + 12, true);
    if (off + Math.min(size, 16) > bytes.length) throw new Error('ICO: entry outside the file');
    const part = bytes.subarray(off, Math.min(bytes.length, off + size));
    const image = isPng(part) ? decodePng(part) : decodeDib(part, 0, { icon: true });
    out.push({ width: image.width, height: image.height, bpp: dv.getUint16(e + 6, true) || image.bpp || 32, image: { width: image.width, height: image.height, data: image.data } });
  }
  return out;
}

// Самая крупная запись - для показа и конвертации ICO в другие форматы.
export function decodeIcoLargest(bytes) {
  return decodeIco(bytes).reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a)).image;
}
