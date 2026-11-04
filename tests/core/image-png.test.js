import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { rng } from '../../web/core/rand.js';
import { decodePng, encodePng, readChunks, isPng, crc32, chunk } from '../../web/core/image/png.js';
import { randomImage } from './image-helpers.js';

// Независимый от ядра сборщик PNG: свои фильтры, node:zlib, crc32 из Node.
const ADAM7 = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];
const CH = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(zlib.crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function refPaeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

// samples(x, y) -> массив отсчётов пикселя (исходной глубины); filterOf(row) -> 0..4.
export function buildPng({ width, height, ctype, depth, interlace = 0, plte, trns, filterOf = () => 0, idatParts = 1 }, samples) {
  const ch = CH[ctype], bpp = Math.max(1, (ch * depth) >> 3);
  const rows = [];
  let rowNo = 0;
  for (const [x0, y0, dx, dy] of interlace ? ADAM7 : [[0, 0, 1, 1]]) {
    const pw = Math.ceil((width - x0) / dx), ph = Math.ceil((height - y0) / dy);
    if (pw <= 0 || ph <= 0) continue;
    const stride = Math.ceil((pw * ch * depth) / 8);
    let prev = new Uint8Array(stride);
    for (let y = 0; y < ph; y++) {
      const cur = new Uint8Array(stride);
      let bit = 0;
      for (let x = 0; x < pw; x++) {
        for (const v of samples(x0 + x * dx, y0 + y * dy)) {
          if (depth === 16) { cur[bit >> 3] = v >> 8; cur[(bit >> 3) + 1] = v & 255; }
          else cur[bit >> 3] |= v << (8 - depth - (bit & 7));
          bit += depth;
        }
      }
      const f = filterOf(rowNo++);
      const line = [f];
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
        const pred = [0, a, b, Math.floor((a + b) / 2), refPaeth(a, b, c)][f];
        line.push((cur[i] - pred + 256) % 256);
      }
      rows.push(...line);
      prev = cur;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = depth; ihdr[9] = ctype; ihdr[12] = interlace;
  const z = zlib.deflateSync(Buffer.from(rows));
  const parts = [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', ihdr)];
  if (plte) parts.push(pngChunk('PLTE', plte));
  if (trns) parts.push(pngChunk('tRNS', trns));
  parts.push(pngChunk('tEXt', Buffer.from('Comment\0hello')));
  const step = Math.ceil(z.length / idatParts);
  for (let i = 0; i < z.length; i += step) parts.push(pngChunk('IDAT', z.subarray(i, i + step)));
  parts.push(pngChunk('IEND', []));
  return new Uint8Array(Buffer.concat(parts));
}

const TYPES = [[0, 1], [0, 2], [0, 4], [0, 8], [0, 16], [2, 8], [2, 16], [3, 1], [3, 2], [3, 4], [3, 8], [4, 8], [4, 16], [6, 8], [6, 16]];

test('закон: encode -> decode байт в байт на случайных картинках (300 случаев)', () => {
  const r = rng(7001);
  for (let n = 0; n < 300; n++) {
    const img = randomImage(r, r.int(1, 33), r.int(1, 33));
    const before = Uint8Array.from(img.data);
    const opts = { level: r.int(0, 9), palette: r() < 0.8 };
    if (r() < 0.3) opts.filter = r.int(0, 4);
    const bytes = encodePng(img, opts);
    assert.ok(isPng(bytes));
    const back = decodePng(bytes);
    assert.equal(back.width, img.width);
    assert.equal(back.height, img.height);
    assert.deepEqual(Buffer.from(back.data), Buffer.from(img.data), `случай ${n}`);
    assert.deepEqual(Uint8Array.from(img.data), before, 'вход изменился');
  }
});

test('закон: чтение PNG стороннего сборщика - все типы, глубины, фильтры, Adam7 (400 случаев)', () => {
  const r = rng(7002);
  for (let n = 0; n < 400; n++) {
    const [ctype, depth] = r.pick(TYPES);
    const width = r.int(1, 19), height = r.int(1, 19), max = 2 ** depth - 1;
    const ch = CH[ctype];
    const plteSize = ctype === 3 ? r.int(1, 2 ** depth) : 0;
    const plte = ctype === 3 ? r.bytes(plteSize * 3) : null;
    const pix = Array.from({ length: width * height }, () =>
      Array.from({ length: ch }, () => (ctype === 3 ? r.int(0, plteSize - 1) : r() < 0.2 ? 0 : r.int(0, max))));
    let trns = null, key = null;
    if (r() < 0.5) {
      if (ctype === 3) trns = r.bytes(r.int(1, plteSize));
      if (ctype === 0 || ctype === 2) {
        key = Array.from({ length: ch }, () => (r() < 0.5 ? 0 : r.int(0, max)));
        trns = Buffer.alloc(ch * 2);
        key.forEach((v, i) => trns.writeUInt16BE(v, i * 2));
      }
    }
    const bytes = buildPng({ width, height, ctype, depth, interlace: r.int(0, 1), plte, trns, filterOf: () => r.int(0, 4), idatParts: r.int(1, 3) },
      (x, y) => pix[y * width + x]);
    const img = decodePng(bytes);
    const to8 = (v) => (depth === 16 ? v >> 8 : Math.round((v * 255) / max));
    for (let i = 0; i < width * height; i++) {
      const s = pix[i];
      let want;
      if (ctype === 3) want = [plte[s[0] * 3], plte[s[0] * 3 + 1], plte[s[0] * 3 + 2], trns && s[0] < trns.length ? trns[s[0]] : 255];
      else if (ctype === 0) want = [to8(s[0]), to8(s[0]), to8(s[0]), key && s[0] === key[0] ? 0 : 255];
      else if (ctype === 4) want = [to8(s[0]), to8(s[0]), to8(s[0]), to8(s[1])];
      else if (ctype === 2) want = [...s.map(to8), key && s.every((v, k) => v === key[k]) ? 0 : 255];
      else want = s.map(to8);
      assert.deepEqual([...img.data.subarray(i * 4, i * 4 + 4)], want, `случай ${n}: тип ${ctype}/${depth}, пиксель ${i}`);
    }
  }
});

test('кодер выбирает компактный тип цвета', () => {
  const type = (img) => encodePng(img)[25];
  const solid = (w, h, px) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4).map((_, i) => px[i % 4]) });
  assert.equal(type(solid(4, 4, [10, 10, 10, 255])), 3); // мало цветов - палитра
  const grad = { width: 64, height: 1, data: new Uint8ClampedArray(256).map((_, i) => (i % 4 === 3 ? 255 : i >> 2)) };
  assert.equal(type(grad), 0); // серый, больше 16 оттенков
  const r = rng(5);
  const noise = { width: 20, height: 20, data: new Uint8ClampedArray(r.bytes(1600)) };
  assert.equal(type(noise), 6);
  const opaque = { width: 20, height: 20, data: noise.data.map((v, i) => (i % 4 === 3 ? 255 : v)) };
  assert.equal(type(opaque), 2);
  const grayAlpha = { width: 20, height: 20, data: noise.data.map((v, i) => (i % 4 === 3 ? v : noise.data[i - (i % 4)])) };
  assert.equal(type(grayAlpha), 4);
  assert.equal(encodePng(solid(4, 4, [1, 2, 3, 255]), { palette: false })[25], 2);
});

test('палитра с прозрачностью пишет tRNS, сжатие уменьшает размер', () => {
  const img = { width: 2, height: 1, data: new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 0]) };
  const types = readChunks(encodePng(img)).map((c) => c.type);
  assert.deepEqual(types, ['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND']);
  const big = { width: 100, height: 100, data: new Uint8ClampedArray(40000).fill(200) };
  assert.ok(encodePng(big, { level: 9 }).length < encodePng(big, { level: 0 }).length);
});

test('ошибки и порченые файлы', () => {
  assert.throws(() => decodePng(new Uint8Array(10)), /not a PNG/);
  const sig = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  assert.throws(() => decodePng(sig), /no IHDR/);
  const ok = buildPng({ width: 3, height: 3, ctype: 2, depth: 8 }, () => [1, 2, 3]);
  const withIhdr = (patch) => {
    const b = Uint8Array.from(ok);
    patch(b);
    return b;
  };
  assert.throws(() => decodePng(withIhdr((b) => { b[25] = 5; })), /bad color type/);
  assert.throws(() => decodePng(withIhdr((b) => { b[24] = 3; })), /bad color type/);
  assert.throws(() => decodePng(withIhdr((b) => { b[19] = 0; })), /bad size/);
  assert.throws(() => decodePng(withIhdr((b) => { b[25] = 3; })), /no palette/);
  const noData = Uint8Array.from([...sig, ...chunk('IHDR', ok.subarray(16, 29)), ...chunk('IEND', new Uint8Array(0))]);
  assert.throws(() => decodePng(noData), /no image data/);
  const short = Uint8Array.from([...sig, ...chunk('IHDR', ok.subarray(16, 29)), ...chunk('IDAT', zlib.deflateSync(Buffer.alloc(5))), ...chunk('IEND', new Uint8Array(0))]);
  assert.throws(() => decodePng(short), /truncated/);
  const badFilter = Uint8Array.from([...sig, ...chunk('IHDR', ok.subarray(16, 29)), ...chunk('IDAT', zlib.deflateSync(Buffer.alloc(30, 9))), ...chunk('IEND', new Uint8Array(0))]);
  assert.throws(() => decodePng(badFilter), /unknown filter/);
  assert.throws(() => encodePng({ width: 2, height: 2, data: new Uint8ClampedArray(3) }), /bad image/);
  assert.throws(() => encodePng({ width: 0, height: 2, data: new Uint8ClampedArray(0) }), /bad image/);
  // Обрезанный файл: разбор чанков останавливается, без исключения.
  assert.deepEqual(readChunks(ok.subarray(0, 40)).map((c) => c.type), ['IHDR']);
});

test('индекс за пределами палитры даёт чёрный, crc32 совпадает с Node', () => {
  const bytes = buildPng({ width: 2, height: 1, ctype: 3, depth: 8, plte: [9, 9, 9] }, (x) => [x * 5]);
  assert.deepEqual([...decodePng(bytes).data], [9, 9, 9, 255, 0, 0, 0, 255]);
  const r = rng(3);
  for (let n = 0; n < 20; n++) {
    const b = r.bytes(r.int(0, 300));
    assert.equal(crc32(b), zlib.crc32(b));
  }
});

test('отмена кодирования и чтения', () => {
  const ctl = new AbortController();
  ctl.abort();
  const img = { width: 4, height: 4, data: new Uint8ClampedArray(64).fill(7) };
  assert.throws(() => encodePng(img, { signal: ctl.signal }), /canceled/);
  assert.throws(() => decodePng(encodePng(img), { signal: ctl.signal }), /canceled/);
});
