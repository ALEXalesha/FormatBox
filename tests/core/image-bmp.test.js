import test from 'node:test';
import assert from 'node:assert/strict';
import { rng } from '../../web/core/rand.js';
import { encodeBmp, decodeBmp, decodeDib, isBmp } from '../../web/core/image/bmp.js';
import { encodeIco, decodeIco, decodeIcoLargest, isIco, ICO_SIZES } from '../../web/core/image/ico.js';
import { randomImage, solidImage, pixel } from './image-helpers.js';

// Сторонний сборщик DIB: values(x, y) -> индекс палитры или упакованное значение пикселя.
export function buildDib({ width, height, bpp, hsize = 40, compression = 0, palette = [], masks = null, topDown = false, icon = false, andMask = null, clrUsed = 0 }, values) {
  const stride = Math.ceil((width * bpp) / 32) * 4;
  const pix = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const r0 = (topDown ? y : height - 1 - y) * stride;
    for (let x = 0; x < width; x++) {
      const v = values(x, y);
      if (bpp <= 8) pix[r0 + ((x * bpp) >> 3)] |= v << (8 - bpp - ((x * bpp) & 7));
      else if (bpp === 16) pix.writeUInt16LE(v, r0 + x * 2);
      else if (bpp === 24) { pix[r0 + x * 3] = v & 255; pix[r0 + x * 3 + 1] = (v >> 8) & 255; pix[r0 + x * 3 + 2] = (v >> 16) & 255; }
      else pix.writeUInt32LE(v >>> 0, r0 + x * 4);
    }
  }
  const h = Buffer.alloc(hsize);
  h.writeUInt32LE(hsize, 0);
  const hh = (topDown ? -1 : 1) * height * (icon ? 2 : 1);
  if (hsize === 12) { h.writeUInt16LE(width, 4); h.writeInt16LE(hh, 6); h.writeUInt16LE(1, 8); h.writeUInt16LE(bpp, 10); }
  else {
    h.writeInt32LE(width, 4); h.writeInt32LE(hh, 8); h.writeUInt16LE(1, 12); h.writeUInt16LE(bpp, 14);
    h.writeUInt32LE(compression, 16); h.writeUInt32LE(clrUsed, 32);
    if (masks && hsize >= 52) masks.forEach((m, i) => { if (40 + i * 4 + 4 <= hsize) h.writeUInt32LE(m >>> 0, 40 + i * 4); });
  }
  const extra = masks && hsize < 52 ? Buffer.concat(masks.map((m) => { const b = Buffer.alloc(4); b.writeUInt32LE(m >>> 0); return b; })) : Buffer.alloc(0);
  const pal = Buffer.from(palette.flatMap(([r, g, b]) => (hsize === 12 ? [b, g, r] : [b, g, r, 0])));
  let mask = Buffer.alloc(0);
  if (icon) {
    const ms = Math.ceil(width / 32) * 4;
    mask = Buffer.alloc(ms * height);
    if (andMask) for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (andMask(x, y)) mask[(topDown ? y : height - 1 - y) * ms + (x >> 3)] |= 0x80 >> (x & 7);
  }
  return new Uint8Array(Buffer.concat([h, extra, pal, pix, mask]));
}

export function withFileHeader(dib, pixelOffset) {
  const f = Buffer.alloc(14);
  f.write('BM', 0, 'latin1');
  f.writeUInt32LE(14 + dib.length, 2);
  f.writeUInt32LE(14 + pixelOffset, 10);
  return new Uint8Array(Buffer.concat([f, dib]));
}

const scale = (v, mask) => {
  let s = 0;
  while (!((mask >>> s) & 1)) s++;
  const max = mask >>> s;
  return Math.round(((((v & mask) >>> 0) >>> s) * 255) / max);
};

test('закон: encodeBmp -> decodeBmp байт в байт (200 случаев)', () => {
  const r = rng(4001);
  for (let n = 0; n < 200; n++) {
    const img = randomImage(r, r.int(1, 30), r.int(1, 30));
    const before = Uint8Array.from(img.data);
    const bytes = encodeBmp(img);
    assert.ok(isBmp(bytes));
    const back = decodeBmp(bytes);
    assert.deepEqual([back.width, back.height], [img.width, img.height]);
    assert.deepEqual(Buffer.from(back.data), Buffer.from(img.data));
    assert.deepEqual(Uint8Array.from(img.data), before);
  }
});

const VARIANTS = ['pal1', 'pal4', 'pal8', 'core8', 'b16', 'b16-565', 'b24', 'b32', 'b32-zero', 'b32-v5', 'b32-alphabf', 'b32-v4rgb'];

test('закон: чтение BMP стороннего сборщика - все глубины, маски, палитры, порядок строк (300 случаев)', () => {
  const r = rng(4002);
  for (let n = 0; n < 300; n++) {
    const v = r.pick(VARIANTS), width = r.int(1, 17), height = r.int(1, 17), topDown = r() < 0.4;
    const cfg = { width, height, topDown };
    let values, expect;
    if (v.startsWith('pal') || v === 'core8') {
      const bpp = v === 'core8' ? 8 : Number(v.slice(3));
      const count = r.int(1, 2 ** bpp);
      const palette = Array.from({ length: count }, () => [r.int(0, 255), r.int(0, 255), r.int(0, 255)]);
      Object.assign(cfg, { bpp, palette, hsize: v === 'core8' ? 12 : 40, clrUsed: v === 'core8' || count === 2 ** bpp ? 0 : count });
      if (v === 'core8') cfg.palette = Array.from({ length: 256 }, (_, i) => palette[i % count]);
      const idx = Array.from({ length: width * height }, () => r.int(0, count - 1));
      values = (x, y) => idx[y * width + x];
      expect = (x, y) => [...palette[idx[y * width + x]], 255];
    } else {
      const vals = Array.from({ length: width * height }, () => r.int(0, 2 ** 31) * 2 + r.int(0, 1));
      const bpp = Number(v.slice(1, 3));
      cfg.bpp = bpp;
      let m = null;
      if (v === 'b16') m = [0x7c00, 0x3e0, 0x1f, 0];
      if (v === 'b16-565') { m = [0xf800, 0x7e0, 0x1f]; cfg.compression = 3; cfg.masks = m; }
      if (v === 'b32-v5') { m = [0xff0000, 0xff00, 0xff, 0xff000000]; Object.assign(cfg, { compression: 3, masks: m, hsize: 124 }); }
      if (v === 'b32-alphabf') { m = [0xff, 0xff00, 0xff0000, 0xff000000]; Object.assign(cfg, { compression: 6, masks: m }); }
      if (v === 'b32-v4rgb') { m = [0xff0000, 0xff00, 0xff, 0xff000000]; Object.assign(cfg, { hsize: 108, masks: [0, 0, 0, 0xff000000] }); }
      const zero = v === 'b32-zero';
      values = (x, y) => {
        const val = vals[y * width + x];
        return bpp === 16 ? val & 0xffff : bpp === 24 ? val & 0xffffff : zero ? val & 0xffffff : val;
      };
      expect = (x, y) => {
        const val = values(x, y);
        if (m) return [scale(val, m[0]), scale(val, m[1]), scale(val, m[2]), m[3] ? scale(val, m[3]) : 255];
        return [(val >>> 16) & 255, (val >>> 8) & 255, val & 255, bpp === 32 && !zero ? val >>> 24 : 255];
      };
    }
    const dib = buildDib(cfg, values);
    const img = decodeBmp(withFileHeader(dib, dib.length - Math.ceil((width * cfg.bpp) / 32) * 4 * height));
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) assert.deepEqual(pixel(img, x, y), expect(x, y), `случай ${n} (${v}) ${x},${y}`);
  }
});

test('RLE8 и RLE4: повторы, абсолютный режим, конец строки, сдвиг, конец картинки', () => {
  const pal = [[0, 0, 0], [255, 0, 0], [0, 255, 0], [0, 0, 255]];
  const rle8 = [3, 1, 0, 3, 2, 3, 2, 0, 0, 0, 0, 0, 0, 2, 1, 0, 1, 2, 0, 1];
  const dib = buildDib({ width: 6, height: 3, bpp: 8, compression: 1, palette: pal, clrUsed: 4 }, () => 0);
  const head = dib.subarray(0, 40 + 16);
  const img = decodeDib(Uint8Array.from([...head, ...rle8]), 0);
  // Нижняя строка (y = 2): 1 1 1 2 3 2 ; средняя пустая; верхняя: сдвиг на x = 1, затем 2.
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((x) => pixel(img, x, 2)[0] + pixel(img, x, 2)[1] * 2 + pixel(img, x, 2)[2] * 3), [255, 255, 255, 510, 765, 510]);
  assert.equal(pixel(img, 0, 1)[3], 0);
  assert.deepEqual(pixel(img, 1, 0), [0, 255, 0, 255]);
  assert.equal(pixel(img, 0, 0)[3], 0);
  const rle4 = [5, 0x12, 0, 3, 0x30, 0x10, 0, 1];
  const head4 = buildDib({ width: 8, height: 1, bpp: 4, compression: 2, palette: pal, clrUsed: 4 }, () => 0).subarray(0, 40 + 16);
  const img4 = decodeDib(Uint8Array.from([...head4, ...rle4]), 0);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map((x) => pixel(img4, x, 0)), [
    [255, 0, 0, 255], [0, 255, 0, 255], [255, 0, 0, 255], [0, 255, 0, 255], [255, 0, 0, 255],
    [0, 0, 255, 255], [0, 0, 0, 255], [255, 0, 0, 255]]);
  // Повтор длиннее строки обрезается, данные без маркера конца тоже читаются.
  const over = decodeDib(Uint8Array.from([...head4, 20, 0x11]), 0);
  assert.deepEqual(pixel(over, 7, 0), [255, 0, 0, 255]);
});

test('ошибки BMP', () => {
  const ok = encodeBmp(solidImage(2, 2, [1, 2, 3, 255]));
  const patch = (o, v, bits = 32) => { const b = Uint8Array.from(ok); const dv = new DataView(b.buffer); bits === 32 ? dv.setUint32(o, v, true) : dv.setUint16(o, v, true); return b; };
  assert.throws(() => decodeBmp(new Uint8Array(30)), /not a BMP/);
  assert.throws(() => decodeBmp(patch(14, 20)), /header size/);
  assert.throws(() => decodeBmp(patch(28, 7, 16)), /bit depth/);
  assert.throws(() => decodeBmp(patch(30, 4)), /compression/);
  assert.throws(() => decodeBmp(patch(18, 0)), /bad size/);
  assert.throws(() => decodeBmp(ok.subarray(0, ok.length - 3)), /truncated/);
  assert.throws(() => decodeBmp(ok.subarray(0, 30)), /truncated/);
  assert.throws(() => encodeBmp({ width: 1, height: 1, data: new Uint8ClampedArray(3) }), /bad image/);
  assert.throws(() => encodeBmp({ width: 0, height: 1, data: new Uint8ClampedArray(0) }), /bad image/);
});

test('закон: ICO туда-обратно - число записей и размеры как заданы, пиксели те же (60 случаев)', () => {
  const r = rng(4003);
  for (let n = 0; n < 60; n++) {
    const sizes = [...new Set(Array.from({ length: r.int(1, 5) }, () => r.pick([1, 7, 16, 24, 32, 48, 64, 100])))];
    const images = sizes.map((s) => randomImage(r, s, s));
    const back = decodeIco(encodeIco(images, sizes));
    assert.deepEqual(back.map((e) => e.width), sizes);
    assert.deepEqual(back.map((e) => e.height), sizes);
    back.forEach((e, i) => assert.deepEqual(Buffer.from(e.image.data), Buffer.from(images[i].data)));
  }
});

test('закон: ICO из одной картинки - записи ровно заданных размеров, вход не меняется (40 случаев)', () => {
  const r = rng(4004);
  for (let n = 0; n < 40; n++) {
    const img = randomImage(r, r.int(1, 300), r.int(1, 300));
    const before = Uint8Array.from(img.data);
    const sizes = r() < 0.2 ? undefined : [...new Set(Array.from({ length: r.int(1, 4) }, () => r.int(1, 256)))];
    const bytes = encodeIco(img, sizes);
    assert.ok(isIco(bytes));
    const want = sizes ?? ICO_SIZES;
    const back = decodeIco(bytes);
    assert.deepEqual(back.map((e) => [e.width, e.height]), want.map((s) => [s, s]));
    for (let i = 0; i < want.length; i++) assert.equal(bytes[6 + i * 16], want[i] & 255);
    assert.deepEqual(Uint8Array.from(img.data), before);
  }
});

test('ICO: несколько источников, прямоугольные записи, BMP-записи с маской AND', () => {
  const small = solidImage(16, 16, [255, 0, 0, 255]), big = solidImage(64, 64, [0, 0, 255, 255]);
  const back = decodeIco(encodeIco([big, small], [16, 32, { width: 20, height: 10 }]));
  assert.deepEqual(pixel(back[0].image, 5, 5), [255, 0, 0, 255]); // точный размер - своя картинка
  assert.deepEqual(pixel(back[1].image, 5, 5), [0, 0, 255, 255]); // уменьшено из большой
  assert.deepEqual([back[2].width, back[2].height], [20, 10]);
  assert.deepEqual(pixel(back[2].image, 0, 5), [0, 0, 0, 0]); // поля pad прозрачны
  assert.deepEqual(decodeIcoLargest(encodeIco(small, [16, 48, 24])).width, 48);
  // Записи BMP: 8 бит с маской, 32 бита с альфой, 32 бита с нулевой альфой (тогда маска).
  const pal = [[10, 20, 30], [40, 50, 60]];
  const e8 = buildDib({ width: 4, height: 2, bpp: 8, palette: pal, clrUsed: 2, icon: true, andMask: (x) => x === 0 }, (x) => x & 1);
  const e32 = buildDib({ width: 3, height: 2, bpp: 32, icon: true, topDown: true }, (x) => (x === 1 ? 0x80112233 : 0xff445566));
  const e32z = buildDib({ width: 3, height: 1, bpp: 32, icon: true, andMask: (x) => x === 2 }, () => 0x00010203);
  const entries = [e8, e32, e32z];
  const head = Buffer.alloc(6 + 16 * entries.length);
  head.writeUInt16LE(1, 2); head.writeUInt16LE(entries.length, 4);
  let off = head.length;
  entries.forEach((e, i) => { head[6 + i * 16] = [4, 3, 3][i]; head.writeUInt32LE(e.length, 6 + i * 16 + 8); head.writeUInt32LE(off, 6 + i * 16 + 12); off += e.length; });
  const ico = new Uint8Array(Buffer.concat([head, ...entries]));
  const d = decodeIco(ico);
  assert.deepEqual(pixel(d[0].image, 0, 0), [10, 20, 30, 0]);
  assert.deepEqual(pixel(d[0].image, 1, 1), [40, 50, 60, 255]);
  assert.equal(d[0].bpp, 8);
  assert.deepEqual(pixel(d[1].image, 1, 0), [0x11, 0x22, 0x33, 0x80]);
  assert.deepEqual(pixel(d[2].image, 0, 0), [1, 2, 3, 255]);
  assert.deepEqual(pixel(d[2].image, 2, 0), [1, 2, 3, 0]);
  // Маска обрезана - недостающие биты считаются непрозрачными.
  const cut = decodeDib(e8.subarray(0, e8.length - 4), 0, { icon: true });
  assert.equal(pixel(cut, 0, 0)[3], 255);
});

test('ошибки ICO', () => {
  const img = solidImage(4, 4, [1, 1, 1, 255]);
  assert.throws(() => decodeIco(new Uint8Array(8)), /not an ICO/);
  assert.throws(() => decodeIco(Uint8Array.from([0, 0, 1, 0, 5, 0])), /truncated/);
  const ico = encodeIco(img, [4]);
  const bad = Uint8Array.from(ico);
  new DataView(bad.buffer).setUint32(6 + 12, 99999, true);
  assert.throws(() => decodeIco(bad), /outside/);
  assert.throws(() => encodeIco(img, [300]), /1\.\.256/);
  assert.throws(() => encodeIco(img, [0]), /1\.\.256/);
  assert.throws(() => encodeIco(img, [2.5]), /1\.\.256/);
  assert.throws(() => encodeIco([], [16]), /no images/);
  assert.throws(() => encodeIco(img, []), /no sizes/);
});
