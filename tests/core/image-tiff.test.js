import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { rng } from '../../web/core/rand.js';
import { decodeTiff, encodeTiff, isTiff, packBits, unpackBits, unLzw } from '../../web/core/image/tiff.js';
import { randomImage, pixel } from './image-helpers.js';

// Сторонний LZW-кодер TIFF (ширина растёт, когда следующий код кодера достигает 2^n).
function lzwEncode(data, clearEvery = 3000) {
  const bits = [];
  let width = 9;
  const emit = (code) => { for (let k = width - 1; k >= 0; k--) bits.push((code >> k) & 1); };
  let dict, next, emitted;
  const reset = () => { dict = new Map(); for (let i = 0; i < 256; i++) dict.set(String.fromCharCode(i), i); next = 258; width = 9; emitted = 0; };
  reset();
  emit(256);
  let w = '';
  for (const byte of data) {
    const c = String.fromCharCode(byte);
    if (dict.has(w + c)) { w += c; continue; }
    emit(dict.get(w));
    dict.set(w + c, next++);
    if (next >= 1 << width && width < 12) width++;
    w = c;
    if (next >= 4093 || ++emitted >= clearEvery) { emit(dict.get(w)); emit(256); reset(); w = ''; }
  }
  if (w) emit(dict.get(w));
  emit(257);
  const out = new Uint8Array(Math.ceil(bits.length / 8));
  bits.forEach((b, i) => { out[i >> 3] |= b << (7 - (i & 7)); });
  return out;
}

// Сторонний писатель TIFF: блоки (полосы/плитки) из готовых отсчётов.
function buildTiff(o, samples) {
  const { le = true, width, height, spp, bits, photo, compression = 1, predictor = 1, tile = null, rps = height, extra, map, planar, sampleFormat } = o;
  const bw = tile ? tile[0] : width, bh = tile ? tile[1] : rps;
  const blocks = [];
  const across = Math.ceil(width / bw), down = Math.ceil(height / bh);
  const rowBytes = Math.ceil((bw * spp * bits) / 8);
  for (let by = 0; by < down; by++) {
    for (let bx = 0; bx < across; bx++) {
      const rows = tile ? bh : Math.min(bh, height - by * bh);
      const raw = new Uint8Array(rows * rowBytes);
      for (let y = 0; y < rows; y++) {
        const vals = [];
        for (let x = 0; x < bw; x++) {
          const X = bx * bw + x, Y = by * bh + y;
          const s = X < width && Y < height ? samples(X, Y) : Array(spp).fill(0);
          vals.push(...s);
        }
        if (predictor === 2) for (let i = vals.length - 1; i >= spp; i--) vals[i] = (vals[i] - vals[i - spp] + 65536) % (bits === 16 ? 65536 : 256);
        let bit = 0;
        for (const v of vals) {
          const q = y * rowBytes + (bit >> 3);
          if (bits === 16) { raw[q] = le ? v & 255 : v >> 8; raw[q + 1] = le ? v >> 8 : v & 255; }
          else if (bits === 8) raw[q] = v;
          else raw[q] |= v << (8 - bits - (bit & 7));
          bit += bits;
        }
      }
      const enc = compression === 1 ? raw : compression === 5 ? lzwEncode(raw, 700) : compression === 32773 ? refPackBits(raw) : new Uint8Array(zlib.deflateSync(raw));
      blocks.push(enc);
    }
  }
  const tags = [[256, 3, [width]], [257, 4, [height]], [258, 3, Array(spp).fill(bits)], [259, 3, [compression]], [262, 3, [photo]], [277, 3, [spp]], [317, 3, [predictor]]];
  if (tile) tags.push([322, 3, [bw]], [323, 3, [bh]], [324, 4, blocks.map(() => 0)], [325, 4, blocks.map((b) => b.length)]);
  else tags.push([273, 4, blocks.map(() => 0)], [278, 4, [rps]], [279, 4, blocks.map((b) => b.length)]);
  if (extra !== undefined) tags.push([338, 3, [extra]]);
  if (map) tags.push([320, 3, map]);
  if (planar) tags.push([284, 3, [planar]]);
  if (sampleFormat) tags.push([339, 3, [sampleFormat]]);
  tags.sort((a, b) => a[0] - b[0]);
  const w16 = (v) => (le ? [v & 255, v >> 8] : [v >> 8, v & 255]);
  const w32 = (v) => (le ? [v & 255, (v >> 8) & 255, (v >> 16) & 255, v >>> 24] : [v >>> 24, (v >> 16) & 255, (v >> 8) & 255, v & 255]);
  const ifdLen = 2 + tags.length * 12 + 4;
  let extraOff = 8 + ifdLen;
  const extraBytes = [];
  const dataStart = extraOff + tags.reduce((n, [, t, v]) => n + (v.length * (t === 3 ? 2 : 4) > 4 ? v.length * (t === 3 ? 2 : 4) : 0), 0);
  let d = dataStart;
  const offs = tags.find((t) => t[0] === 273 || t[0] === 324)[2];
  blocks.forEach((b, i) => { offs[i] = d; d += b.length; });
  const ifd = [...w16(tags.length)];
  for (const [tag, type, vals] of tags) {
    const bytes = vals.flatMap((v) => (type === 3 ? w16(v) : w32(v)));
    ifd.push(...w16(tag), ...w16(type), ...w32(vals.length));
    if (bytes.length <= 4) ifd.push(...bytes, ...Array(4 - bytes.length).fill(0));
    else { ifd.push(...w32(extraOff)); extraOff += bytes.length; extraBytes.push(...bytes); }
  }
  ifd.push(0, 0, 0, 0);
  const head = le ? [0x49, 0x49, 42, 0, ...w32(8)] : [0x4d, 0x4d, 0, 42, ...w32(8)];
  return Uint8Array.from([...head, ...ifd, ...extraBytes, ...blocks.flatMap((b) => [...b])]);
}

function refPackBits(raw) {
  const out = [];
  for (let i = 0; i < raw.length;) {
    let n = 1;
    while (i + n < raw.length && n < 128 && raw[i + n] === raw[i]) n++;
    if (n >= 2) { out.push((256 - (n - 1)) & 255, raw[i]); i += n; }
    else { out.push(0, raw[i]); i += 1; }
  }
  return Uint8Array.from(out);
}

test('закон: encodeTiff -> decodeTiff байт в байт (без сжатия, PackBits, Deflate; 150 случаев)', () => {
  const r = rng(3001);
  for (let n = 0; n < 150; n++) {
    const img = randomImage(r, r.int(1, 40), r.int(1, r() < 0.1 ? 900 : 40));
    const before = Uint8Array.from(img.data);
    const bytes = encodeTiff(img, { compression: r.pick(['none', 'packbits', 'deflate']) });
    assert.ok(isTiff(bytes));
    const back = decodeTiff(bytes);
    assert.deepEqual([back.width, back.height], [img.width, img.height]);
    assert.deepEqual(Buffer.from(back.data), Buffer.from(img.data), `случай ${n}`);
    assert.deepEqual(Uint8Array.from(img.data), before);
  }
});

const VARIANTS = [['gray', 1], ['gray', 2], ['gray', 4], ['gray', 8], ['gray', 16], ['white', 8], ['white', 1], ['ga', 8], ['rgb', 8], ['rgb', 16],
  ['rgba', 8], ['rgba', 16], ['rgbaPre', 8], ['rgbx', 8], ['pal', 4], ['pal', 8], ['cmyk', 8]];

test('закон: чтение TIFF стороннего писателя - цвета, глубины, сжатия, плитки, предиктор, II/MM (300 случаев)', () => {
  const r = rng(3002);
  for (let n = 0; n < 300; n++) {
    const [kind, bits] = r.pick(VARIANTS);
    const width = r.int(1, 20), height = r.int(1, 20), max = 2 ** bits - 1;
    const spp = { gray: 1, white: 1, ga: 2, rgb: 3, rgba: 4, rgbaPre: 4, rgbx: 4, pal: 1, cmyk: 4 }[kind];
    const photo = { gray: 1, white: 0, ga: 1, rgb: 2, rgba: 2, rgbaPre: 2, rgbx: 2, pal: 3, cmyk: 5 }[kind];
    const pix = Array.from({ length: width * height }, () => Array.from({ length: spp }, () => r.int(0, max)));
    if (kind === 'rgbaPre') for (const p of pix) for (let c = 0; c < 3; c++) p[c] = Math.min(p[c], p[3]);
    const map = kind === 'pal' ? Array.from({ length: 3 << bits }, () => r.int(0, 65535)) : undefined;
    const extra = kind === 'rgbaPre' ? 1 : kind === 'rgbx' ? 0 : kind === 'ga' || kind === 'rgba' ? r.pick([2, undefined]) : undefined;
    const compression = r.pick([1, 5, 8, 32773]);
    const predictor = bits >= 8 && kind !== 'pal' && r() < 0.5 ? 2 : 1;
    const tile = r() < 0.3 ? [16, 16] : null;
    const bytes = buildTiff({ le: r() < 0.5, width, height, spp, bits, photo, compression, predictor, tile, rps: r.int(1, height), extra, map }, (x, y) => pix[y * width + x]);
    const img = decodeTiff(bytes);
    const s8 = (v) => (bits === 16 ? v >> 8 : Math.round((v * 255) / max));
    for (let i = 0; i < width * height; i++) {
      const p = pix[i];
      let want;
      if (kind === 'pal') want = [map[p[0]] >> 8, map[(1 << bits) + p[0]] >> 8, map[(2 << bits) + p[0]] >> 8, 255];
      else if (kind === 'cmyk') want = [0, 1, 2].map((c) => Math.round(((255 - p[c]) * (255 - p[3])) / 255)).concat(255);
      else if (kind === 'white') want = [255 - s8(p[0]), 255 - s8(p[0]), 255 - s8(p[0]), 255];
      else if (kind === 'gray') want = [s8(p[0]), s8(p[0]), s8(p[0]), 255];
      else if (kind === 'ga') want = [s8(p[0]), s8(p[0]), s8(p[0]), s8(p[1])];
      else if (kind === 'rgbx') want = [s8(p[0]), s8(p[1]), s8(p[2]), 255];
      else if (kind === 'rgbaPre') {
        const a = s8(p[3]);
        want = [0, 1, 2].map((c) => (a > 0 && a < 255 ? Math.min(255, Math.round((s8(p[c]) * 255) / a)) : s8(p[c]))).concat(a);
      } else want = spp === 3 ? [...p.map(s8), 255] : p.map(s8);
      const got = [...img.data.subarray(i * 4, i * 4 + 4)];
      const tol = kind === 'rgbaPre' || kind === 'white' ? 1 : 0;
      got.forEach((v, c) => assert.ok(Math.abs(v - want[c]) <= tol, `случай ${n} (${kind}/${bits}, сжатие ${compression}) пиксель ${i}: ${got} != ${want}`));
    }
  }
});

test('закон: PackBits и LZW - распаковка восстанавливает данные (300 случаев)', () => {
  const r = rng(3003);
  for (let n = 0; n < 300; n++) {
    const len = r.int(0, r() < 0.2 ? 20000 : 500);
    const data = new Uint8Array(len);
    for (let i = 0; i < len;) {
      const run = r.int(1, r() < 0.3 ? 200 : 4), v = r.int(0, r() < 0.5 ? 3 : 255);
      for (let k = 0; k < run && i < len; k++) data[i++] = r() < 0.5 ? v : r.int(0, 255);
    }
    assert.deepEqual(unpackBits(packBits(data), len), data);
    assert.deepEqual(unpackBits(refPackBits(data), len), data);
    assert.deepEqual(unLzw(lzwEncode(data, r.int(50, 5000)), len), data, `случай ${n}`);
  }
});

test('несколько страниц, заглушки PackBits, обрезанные данные', () => {
  const a = encodeTiff(randomImage(rng(1), 3, 3, 'opaque'), { compression: 'none' });
  // Вторая страница: тот же IFD, ссылка на него из первого.
  const two = Uint8Array.from(a);
  const dv = new DataView(two.buffer);
  const n = dv.getUint16(8, true);
  dv.setUint32(10 + n * 12, 8, true);
  assert.equal(decodeTiff(two, { page: 1 }).width, 3);
  assert.throws(() => decodeTiff(a, { page: 1 }), /no page 1/);
  assert.deepEqual([...unpackBits(Uint8Array.from([128, 0, 7, 255, 9]), 4)], [7, 9, 9, 0]);
  assert.deepEqual([...unpackBits(Uint8Array.from([5, 1, 2]), 4)], [1, 2, 0, 0]);
  assert.throws(() => unLzw(Uint8Array.from([0x80, 0x40, 0x80]), 10), /bad LZW/);
  assert.throws(() => unLzw(Uint8Array.from([0x00, 0x4b, 0x00]), 10), /bad LZW/);
  const full = buildTiff({ width: 2, height: 1, spp: 3, bits: 8, photo: 2 }, () => [1, 2, 3]);
  const img = decodeTiff(full.subarray(0, full.length - 2));
  assert.deepEqual(pixel(img, 0, 0), [1, 2, 3, 255]);
  assert.deepEqual(pixel(img, 1, 0), [1, 0, 0, 255]);
});

test('ошибки TIFF', () => {
  const base = { width: 2, height: 2, spp: 1, bits: 8, photo: 1 };
  const px = () => [5];
  const bad = (o, re) => assert.throws(() => decodeTiff(buildTiff({ ...base, ...o }, px)), re);
  assert.throws(() => decodeTiff(new Uint8Array(10)), /not a TIFF/);
  bad({ width: 0 }, /bad size/);
  bad({ planar: 2 }, /separate color planes/);
  bad({ sampleFormat: 3 }, /integer/);
  bad({ photo: 6 }, /color model/);
  bad({ photo: 2 }, /color model/);
  bad({ photo: 3 }, /no color map/);
  assert.throws(() => decodeTiff(buildTiff({ ...base, bits: 4, photo: 2, spp: 3 }, () => [1, 1, 1])), /color model/);
  const b32 = buildTiff(base, px);
  const p258 = (b, v) => { const c = Uint8Array.from(b); c[10 + 2 * 12 + 8] = v; return c; };
  assert.throws(() => decodeTiff(p258(b32, 32)), /bit depth/);
  const cmp = Uint8Array.from(b32); cmp[10 + 3 * 12 + 8] = 7;
  assert.throws(() => decodeTiff(cmp), /compression/);
  const noData = Uint8Array.from(b32);
  noData[10 + 5 * 12] = 0x10; noData[10 + 5 * 12 + 1] = 0x10; // тег 273 -> неизвестный
  assert.throws(() => decodeTiff(noData), /no image data/);
  const far = Uint8Array.from(b32);
  new DataView(far.buffer).setUint32(10 + 5 * 12 + 8, 99999, true);
  assert.throws(() => decodeTiff(far), /outside/);
  assert.throws(() => decodeTiff(b32.subarray(0, 20)), /truncated/);
  assert.throws(() => encodeTiff({ width: 1, height: 1, data: new Uint8ClampedArray(4) }, { compression: 'jpeg' }), /unknown compression/);
  assert.throws(() => encodeTiff({ width: 1, height: 0, data: new Uint8ClampedArray(0) }), /bad image/);
  // Альфа в неассоциированном виде пишется и читается обратно.
  const rgba = randomImage(rng(2), 4, 4, 'noise');
  assert.deepEqual(pixel(decodeTiff(encodeTiff(rgba)), 1, 1), pixel(rgba, 1, 1));
});
