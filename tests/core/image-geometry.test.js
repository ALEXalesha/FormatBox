import test from 'node:test';
import assert from 'node:assert/strict';
import { rng } from '../../web/core/rand.js';
import {
  resize, fitToPixels, scaleByPercent, cropRect, cropToAspect, containSize, fitInto,
  rotate90, rotate180, rotate270, flipH, flipV, applyOrientation,
} from '../../web/core/image/geometry.js';
import { randomImage, solidImage, pixel } from './image-helpers.js';

const METHODS = ['area', 'bilinear', 'bicubic', 'auto'];
const same = (a, b) => assert.deepEqual(Buffer.from(a.data), Buffer.from(b.data));

// Соотношение сторон сохранено с точностью до пикселя хотя бы по одной из сторон (вторая выводится из первой).
function aspectOk(w, h, nw, nh) {
  return Math.min(Math.abs(nh - (nw * h) / w), Math.abs(nw - (nh * w) / h)) <= 1 || nw === 1 || nh === 1;
}

test('закон: однотонная картинка остаётся той же после resize любым методом (200 случаев)', () => {
  const r = rng(8001);
  for (let n = 0; n < 200; n++) {
    const px = [r.int(0, 255), r.int(0, 255), r.int(0, 255), r.pick([0, 255, r.int(0, 255)])];
    const img = solidImage(r.int(1, 40), r.int(1, 40), px);
    const w = r.int(1, 60), h = r.int(1, 60);
    const out = resize(img, w, h, { method: r.pick(METHODS) });
    assert.equal(out.width, w);
    assert.equal(out.height, h);
    for (let i = 0; i < out.data.length; i += 4) assert.deepEqual([...out.data.subarray(i, i + 4)], px, `случай ${n}`);
  }
});

test('закон: уменьшение «площадью» - точный интеграл по площади каждого выходного пикселя (150 случаев)', () => {
  const r = rng(8002);
  const overlap = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
  for (let n = 0; n < 150; n++) {
    const W = r.int(1, 30), H = r.int(1, 30);
    // Иногда - ровно в целое число раз, иначе любой коэффициент.
    const f = r() < 0.3 ? r.int(1, 4) : 0;
    const w = f ? Math.max(1, Math.floor(W / f)) : r.int(1, W), h = f ? Math.max(1, Math.floor(H / f)) : r.int(1, H);
    const img = randomImage(r, W, H, 'opaque');
    const out = resize(img, w, h, { method: 'area' });
    const sx = W / w, sy = H / h;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const sum = [0, 0, 0];
        for (let j = Math.floor(y * sy); j < Math.min(H, Math.ceil((y + 1) * sy)); j++) {
          for (let i = Math.floor(x * sx); i < Math.min(W, Math.ceil((x + 1) * sx)); i++) {
            const k = overlap(x * sx, (x + 1) * sx, i, i + 1) * overlap(y * sy, (y + 1) * sy, j, j + 1);
            for (let c = 0; c < 3; c++) sum[c] += k * pixel(img, i, j)[c];
          }
        }
        for (let c = 0; c < 3; c++) assert.ok(Math.abs(pixel(out, x, y)[c] - sum[c] / (sx * sy)) <= 0.51, `случай ${n}: ${W}x${H} -> ${w}x${h}`);
      }
    }
  }
});

test('закон: уменьшение без «лесенки» - мелкая шахматка становится ровным серым любым методом', () => {
  const r = rng(8003);
  for (let n = 0; n < 60; n++) {
    const W = r.int(30, 90), H = r.int(30, 90);
    const img = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) img.data.set((x + y) % 2 ? [255, 255, 255, 255] : [0, 0, 0, 255], (y * W + x) * 4);
    const w = Math.max(1, Math.floor(W / r.int(3, 6))), h = Math.max(1, Math.floor(H / r.int(3, 6)));
    const out = resize(img, w, h, { method: r.pick(['area', 'bilinear', 'bicubic']) });
    for (let i = 0; i < out.data.length; i += 4) assert.ok(Math.abs(out.data[i] - 127.5) < 30, `случай ${n}: ${out.data[i]}`);
  }
});

test('закон: fitToPixels - пикселей не больше заданных, соотношение сохранено (2000 случаев)', () => {
  const r = rng(8004);
  for (let n = 0; n < 2000; n++) {
    const w = r.int(1, r() < 0.2 ? 20 : 5000), h = r.int(1, r() < 0.2 ? 20 : 5000);
    const max = r.int(1, w * h * 2);
    const s = fitToPixels(w, h, max);
    assert.ok(s.width * s.height <= max, `${w}x${h} -> ${s.width}x${s.height} > ${max}`);
    assert.ok(s.width >= 1 && s.height >= 1 && s.width <= w && s.height <= h);
    if (w * h <= max) assert.deepEqual(s, { width: w, height: h });
    else if (Math.max(w, h) / Math.min(w, h) <= max) assert.ok(aspectOk(w, h, s.width, s.height), `${w}x${h} -> ${s.width}x${s.height}`);
  }
});

test('закон: fitInto - stretch ровно W×H, contain внутри с соотношением, cover и pad ровно W×H (300 случаев)', () => {
  const r = rng(8005);
  for (let n = 0; n < 300; n++) {
    const img = randomImage(r, r.int(1, 30), r.int(1, 30));
    const before = Uint8Array.from(img.data);
    const W = r.int(1, 40), H = r.int(1, 40), mode = r.pick(['contain', 'cover', 'stretch', 'pad']);
    const out = fitInto(img, W, H, mode);
    if (mode === 'contain') {
      assert.ok(out.width <= W && out.height <= H && (out.width === W || out.height === H));
      assert.ok(aspectOk(img.width, img.height, out.width, out.height), `${img.width}x${img.height} -> ${out.width}x${out.height}`);
    } else {
      assert.deepEqual([out.width, out.height], [W, H]);
    }
    assert.deepEqual(Uint8Array.from(img.data), before);
  }
});

test('закон: повороты и отражения - перестановка пикселей по определению (100 случаев)', () => {
  const r = rng(8006);
  for (let n = 0; n < 100; n++) {
    const img = randomImage(r, r.int(1, 9), r.int(1, 9), 'noise');
    const { width: w, height: h } = img;
    const maps = {
      1: [w, h, (x, y) => [x, y]], 2: [w, h, (x, y) => [w - 1 - x, y]], 3: [w, h, (x, y) => [w - 1 - x, h - 1 - y]],
      4: [w, h, (x, y) => [x, h - 1 - y]], 5: [h, w, (x, y) => [y, x]], 6: [h, w, (x, y) => [h - 1 - y, x]],
      7: [h, w, (x, y) => [h - 1 - y, w - 1 - x]], 8: [h, w, (x, y) => [y, w - 1 - x]],
    };
    for (const [o, [nw, nh, f]] of Object.entries(maps)) {
      const out = applyOrientation(img, Number(o));
      assert.deepEqual([out.width, out.height], [nw, nh]);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const [X, Y] = f(x, y);
        assert.deepEqual(pixel(out, X, Y), pixel(img, x, y), `ориентация ${o}`);
      }
    }
    same(rotate90(rotate90(rotate90(rotate90(img)))), img);
    same(rotate270(img), rotate90(rotate180(img)));
    same(flipH(flipH(img)), img);
    same(flipV(img), rotate180(flipH(img)));
  }
});

test('прозрачный пиксель не красит соседа (взвешивание альфой)', () => {
  const img = { width: 2, height: 1, data: new Uint8ClampedArray([255, 0, 0, 0, 0, 0, 255, 255]) };
  for (const method of ['area', 'bilinear', 'bicubic']) {
    const out = resize(img, 1, 1, { method });
    assert.deepEqual(pixel(out, 0, 0).slice(0, 3), [0, 0, 255], method);
    assert.ok(Math.abs(out.data[3] - 128) <= 1);
  }
});

test('увеличение плавное, auto выбирает метод, тот же размер - копия', () => {
  const img = { width: 2, height: 1, data: new Uint8ClampedArray([0, 0, 0, 255, 200, 200, 200, 255]) };
  const big = resize(img, 8, 1, { method: 'bilinear' });
  const row = [0, 1, 2, 3, 4, 5, 6, 7].map((x) => pixel(big, x, 0)[0]);
  for (let i = 1; i < 8; i++) assert.ok(row[i] >= row[i - 1]);
  assert.ok(row[0] < 30 && row[7] > 170);
  same(resize(img, 8, 1), resize(img, 8, 1, { method: 'bicubic' }));
  const copy = resize(img, 2, 1);
  same(copy, img);
  assert.notEqual(copy.data, img.data);
  const sp = scaleByPercent(randomImage(rng(1), 10, 20), 50);
  assert.deepEqual([sp.width, sp.height], [5, 10]);
});

test('обрезка: прямоугольник, соотношение по центру, pad с фоном', () => {
  const img = randomImage(rng(2), 10, 6, 'noise');
  const c = cropRect(img, { x: 2, y: 1, width: 3, height: 2 });
  assert.deepEqual([c.width, c.height], [3, 2]);
  assert.deepEqual(pixel(c, 0, 0), pixel(img, 2, 1));
  assert.deepEqual(pixel(c, 2, 1), pixel(img, 4, 2));
  const clipped = cropRect(img, { x: -5, y: 4, width: 100, height: 100 });
  assert.deepEqual([clipped.width, clipped.height], [10, 2]);
  const sq = cropToAspect(img, 1, 1);
  assert.deepEqual([sq.width, sq.height], [6, 6]);
  assert.deepEqual(pixel(sq, 0, 0), pixel(img, 2, 0));
  const tall = cropToAspect(img, 1, 3);
  assert.deepEqual([tall.width, tall.height], [2, 6]);
  const wide = cropToAspect(img, 5, 1);
  assert.deepEqual([wide.width, wide.height], [10, 2]);
  assert.deepEqual(pixel(wide, 0, 0), pixel(img, 0, 2));
  const pad = fitInto(solidImage(4, 2, [9, 9, 9, 255]), 6, 6, 'pad', { background: [1, 2, 3, 4] });
  assert.deepEqual(pixel(pad, 0, 0), [1, 2, 3, 4]);
  assert.deepEqual(pixel(pad, 3, 3), [9, 9, 9, 255]);
  assert.deepEqual(pixel(pad, 3, 5), [1, 2, 3, 4]);
  assert.deepEqual(containSize(100, 10, 50, 50), { width: 50, height: 5 });
  assert.deepEqual(containSize(10, 100, 50, 50), { width: 5, height: 50 });
  assert.deepEqual(fitToPixels(1000, 1, 10), { width: 10, height: 1 });
});

test('ошибки, отмена и ход работы', () => {
  const img = solidImage(100, 100, [1, 2, 3, 255]);
  assert.throws(() => resize(img, 0, 5), /bad size/);
  assert.throws(() => resize(img, 5, 5, { method: 'nearest' }), /unknown method/);
  assert.throws(() => cropRect(img, { x: 200, y: 0, width: 5, height: 5 }), /empty/);
  assert.throws(() => cropToAspect(img, 0, 1), /bad aspect/);
  assert.throws(() => fitInto(img, 5, 5, 'zoom'), /unknown mode/);
  assert.throws(() => fitInto(img, 0, 5), /bad size/);
  assert.throws(() => fitToPixels(5, 5, 0), /maxPixels/);
  assert.throws(() => scaleByPercent(img, 0), /percent/);
  const ctl = new AbortController();
  ctl.abort();
  assert.throws(() => resize(img, 50, 50, { signal: ctl.signal }), /canceled/);
  const seen = [];
  resize(img, 30, 70, { progress: (p) => seen.push(p) });
  assert.equal(seen.at(-1), 1);
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i] >= seen[i - 1]);
});
