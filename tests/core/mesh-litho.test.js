import test from 'node:test';
import assert from 'node:assert/strict';
import { rng } from '../../web/core/rand.js';
import { lithophane, relief, toGray, downsample } from '../../web/core/mesh/litho.js';
import { bounds, volume } from '../../web/core/mesh/measure.js';
import { isWatertight } from '../../web/core/mesh/topology.js';

function randomImage(r, w = r.int(2, 40), h = r.int(2, 40)) {
  return { width: w, height: h, data: r.bytes(w * h) };
}

// Толщина в каждой вершине: для плоского - высота z, для изогнутых - расстояние до оси минус внутренний радиус
function thicknessOk(mesh, shape, opts) {
  const p = mesh.positions;
  for (let i = 0; i < p.length; i += 3) {
    let t;
    if (shape === 'flat') t = p[i + 2];
    else if (shape === 'cylinder') t = Math.hypot(p[i], p[i + 1]) - (opts.widthMm / 2 - opts.maxMm);
    else t = Math.hypot(p[i], p[i + 1] + opts.widthMm / ((opts.arcDeg * Math.PI) / 180)) - opts.widthMm / ((opts.arcDeg * Math.PI) / 180);
    if (t < 1e-3) continue; // задняя сторона (на изгибе - хорды чуть внутри дуги)
    if (t < opts.minMm - 1e-3 || t > opts.maxMm + 1e-3) return false;
  }
  return true;
}

test('закон: литофан водонепроницаем, ширина = widthMm, толщина в [min, max], вершин ~ пикселей (зерно 61, 45 картинок)', () => {
  const r = rng(61);
  for (let n = 0; n < 45; n++) {
    const shape = ['flat', 'curved', 'cylinder'][n % 3];
    const img = randomImage(r);
    const before = img.data.slice();
    const opts = {
      shape, widthMm: 40 + r() * 100, minMm: 0.4 + r(), maxMm: 2 + r() * 3, borderMm: r() < 0.5 ? 0 : 1 + r() * 3,
      arcDeg: 60 + r() * 200, invert: r() < 0.3, baseMm: shape === 'cylinder' && r() < 0.5 ? 3 : 0,
    };
    const mesh = lithophane(img, opts);
    assert.deepEqual(img.data, before, 'картинка не тронута');
    assert.ok(isWatertight(mesh), `#${n} ${shape}`);
    assert.ok(volume(mesh) > 0);
    assert.ok(thicknessOk(mesh, shape, opts), `#${n} ${shape}: толщина`);
    // верх - по вершине на пиксель (+ два ряда рамки с каждой стороны), низ - только по краю
    const W = Math.max(2, img.width), H = Math.max(2, img.height);
    const nv = mesh.positions.length / 3;
    assert.ok(nv >= W * H && nv <= (W + 4) * (H + 4) + 2 * (W + H + 8) + 4, `#${n}: вершин ${nv} на ${W * H} пикселей`);
    const b = bounds(mesh);
    if (shape === 'flat') assert.ok(Math.abs(b.size[0] - opts.widthMm) <= 0.005 * opts.widthMm, `#${n}: ширина ${b.size[0]}`);
  }
});

test('закон: ширина цилиндра-ночника = widthMm, и картинка уменьшается до maxPixels (зерно 62, 10 картинок)', () => {
  const r = rng(62);
  for (let n = 0; n < 10; n++) {
    const img = randomImage(r, 2 * r.int(60, 120), r.int(40, 100));
    const widthMm = 50 + r() * 60;
    const maxPixels = r.int(500, 3000);
    const mesh = lithophane(img, { shape: 'cylinder', widthMm, borderMm: 2, maxPixels });
    const b = bounds(mesh);
    assert.ok(Math.abs(b.size[0] - widthMm) <= 0.005 * widthMm, `#${n}: ${b.size[0]} против ${widthMm}`);
    const nv = mesh.positions.length / 3;
    assert.ok(nv <= maxPixels * 1.6 + 200, `#${n}: вершин ${nv} при maxPixels ${maxPixels}`);
    assert.ok(isWatertight(mesh));
  }
});

test('литофан: тёмное толще, invert наоборот, рамка во всю толщину', () => {
  const img = { width: 2, height: 2, data: Uint8Array.from([0, 255, 0, 255]) };
  const m = lithophane(img, { widthMm: 10, minMm: 1, maxMm: 3 });
  const zAt = (mesh, x, y) => {
    let best = -1;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      if (Math.abs(mesh.positions[i] - x) < 1e-6 && (y === undefined || Math.abs(mesh.positions[i + 1] - y) < 1e-6)) best = Math.max(best, mesh.positions[i + 2]);
    }
    return best;
  };
  assert.equal(zAt(m, 0), 3);
  assert.equal(zAt(m, 10), 1);
  const inv = lithophane(img, { widthMm: 10, minMm: 1, maxMm: 3, invert: true });
  assert.equal(zAt(inv, 0), 1);
  const framed = lithophane({ width: 2, height: 2, data: new Uint8Array(4).fill(255) }, { widthMm: 10, minMm: 1, maxMm: 3, borderMm: 2 });
  assert.equal(zAt(framed, 0), 3);
  assert.equal(zAt(framed, 2), 3);
  assert.equal(zAt(framed, 3.5, 3.5), 1);
  assert.equal(zAt(framed, 3.5, 0), 3);
  assert.throws(() => lithophane(img, { minMm: 3, maxMm: 1 }), /minMm/);
  assert.throws(() => lithophane(img, { widthMm: 10, borderMm: 5 }), /border/);
  assert.throws(() => lithophane(img, { shape: 'cylinder', widthMm: 4, maxMm: 3 }), /small/);
  const ctl = new AbortController();
  ctl.abort();
  assert.throws(() => lithophane(img, { signal: ctl.signal }), /canceled/);
  const seen = [];
  lithophane({ width: 4, height: 200, data: new Uint8Array(800) }, { progress: (p) => seen.push(p) });
  assert.ok(seen.length >= 3 && seen.at(-1) === 1 && seen.every((p, i) => !i || p >= seen[i - 1]));
  // картинка в одну точку и дуга за пределами - всё равно тело
  assert.ok(isWatertight(lithophane({ width: 1, height: 1, data: Uint8Array.from([7]) }, { shape: 'curved', arcDeg: 720 })));
});

test('закон: рельеф водонепроницаем, светлое выше, высота = base + height (зерно 63, 20 карт)', () => {
  const r = rng(63);
  for (let n = 0; n < 20; n++) {
    const img = randomImage(r);
    const baseMm = 0.5 + r() * 2, heightMm = r() * 10, widthMm = 20 + r() * 80;
    const m = relief(img, { widthMm, baseMm, heightMm, invert: n % 4 === 0 });
    assert.ok(isWatertight(m));
    const b = bounds(m);
    assert.ok(Math.abs(b.size[0] - widthMm) < 1e-3 * widthMm);
    assert.ok(b.max[2] <= baseMm + heightMm + 1e-4 && b.min[2] === 0);
  }
  const white = relief({ width: 2, height: 2, data: Uint8Array.from([255, 255, 255, 255]) }, { baseMm: 1, heightMm: 4 });
  assert.equal(bounds(white).max[2], 5);
  assert.throws(() => relief({ width: 2, height: 2, data: new Uint8Array(4) }, { baseMm: 0 }), /baseMm/);
});

test('картинки: RGB, RGBA с прозрачностью, неверный размер, уменьшение', () => {
  const rgba = toGray({ width: 2, height: 1, data: Uint8Array.from([255, 0, 0, 255, 0, 0, 0, 0]) });
  assert.deepEqual(Array.from(rgba.data), [76, 255]);
  const rgb = toGray({ width: 1, height: 1, data: Uint8Array.from([0, 0, 255]) });
  assert.deepEqual(Array.from(rgb.data), [29]);
  assert.throws(() => toGray({ width: 2, height: 2, data: new Uint8Array(5) }), /size/);
  const big = { width: 10, height: 10, data: Uint8Array.from({ length: 100 }, (_, i) => (i % 10 < 5 ? 0 : 200)) };
  const small = downsample(big, 25);
  assert.equal(small.width, 5);
  assert.equal(small.data[0], 0);
  assert.equal(small.data[4], 200);
  assert.equal(downsample(big, 0), big);
});
