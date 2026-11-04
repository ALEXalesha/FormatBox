import test from 'node:test';
import assert from 'node:assert/strict';
import { rng } from '../../web/core/rand.js';
import { extrudeSilhouette, extrudeMask, imageToMask, despeckle } from '../../web/core/mesh/silhouette.js';
import { traceRings, ringArea, simplifyRing, distanceSquared, groupRings, triangulatePolygon, pointInRing } from '../../web/core/mesh/contours.js';
import { bounds, volume } from '../../web/core/mesh/measure.js';
import { isWatertight, windingNumber } from '../../web/core/mesh/topology.js';
import { analyzeMesh } from '../../web/core/mesh/repair.js';
import { blobMask, maskArea } from './mesh-helpers.js';

const MODES = ['plain', 'keychain', 'sign', 'cookie', 'stencil'];

test('закон: во всех режимах тело водонепроницаемо, стоит на z = 0 и высотой ровно heightMm (зерно 71, 30 масок x 5 режимов)', () => {
  const r = rng(71);
  for (let n = 0; n < 30; n++) {
    const mask = blobMask(r);
    const before = mask.data.slice();
    for (const mode of MODES) {
      const heightMm = mode === 'cookie' ? 8 + r() * 10 : 2 + r() * 4;
      const simplify = r() < 0.3 ? r() * 2 : undefined;
      const mesh = extrudeMask(mask, { mode, widthMm: 20 + r() * 40, heightMm, baseMm: 1 + r(), wallMm: 0.8 + r(), holeMm: 3 + r() * 2, simplify });
      const where = `#${n} ${mode}`;
      assert.ok(isWatertight(mesh), where);
      assert.ok(volume(mesh) > 0, where);
      const b = bounds(mesh);
      assert.equal(b.min[2], 0, where);
      assert.ok(Math.abs(b.max[2] - heightMm) < 1e-5, `${where}: высота ${b.max[2]}`);
      assert.deepEqual([b.min[0], b.min[1]], [0, 0]);
    }
    assert.deepEqual(mask.data, before, 'маска не тронута');
  }
});

test('закон: plain - площадь основания близка к площади маски, ширина = widthMm (зерно 72, 40 масок)', () => {
  const r = rng(72);
  for (let n = 0; n < 40; n++) {
    const mask = despeckle(blobMask(r, r.int(30, 90), r.int(30, 90)), 3);
    let x0 = Infinity, x1 = -1;
    mask.data.forEach((v, i) => { if (v) { x0 = Math.min(x0, i % mask.width); x1 = Math.max(x1, i % mask.width); } });
    const widthMm = 10 + r() * 50, heightMm = 1 + r() * 3;
    const pxMm = widthMm / (x1 - x0 + 1);
    const mesh = extrudeMask(mask, { widthMm, heightMm });
    const area = volume(mesh) / heightMm;
    const want = maskArea(mask) * pxMm * pxMm;
    assert.ok(Math.abs(area - want) < 0.05 * want, `#${n}: площадь ${area} против ${want}`);
    assert.ok(Math.abs(bounds(mesh).size[0] - widthMm) <= pxMm, `#${n}: ширина ${bounds(mesh).size[0]}`);
  }
});

test('закон: расстояние до фигуры совпадает с перебором (зерно 73, 40 масок)', () => {
  const r = rng(73);
  for (let n = 0; n < 40; n++) {
    const w = r.int(1, 14), h = r.int(1, 14);
    const mask = { width: w, height: h, data: Uint8Array.from({ length: w * h }, () => (r() < 0.15 ? 1 : 0)) };
    const d = distanceSquared(mask);
    for (let i = 0; i < w * h; i++) {
      let best = Infinity;
      for (let j = 0; j < w * h; j++) if (mask.data[j]) best = Math.min(best, ((i % w) - (j % w)) ** 2 + (Math.floor(i / w) - Math.floor(j / w)) ** 2);
      if (best === Infinity) assert.ok(d[i] > 1e19);
      else assert.equal(d[i], best, `#${n} пиксель ${i}`);
    }
  }
});

test('закон: контуры - внешние против дыр по знаку, сумма площадей = пиксели минус срезанные углы (зерно 74, 60 масок)', () => {
  const r = rng(74);
  for (let n = 0; n < 60; n++) {
    const mask = blobMask(r, r.int(3, 30), r.int(3, 30));
    const rings = traceRings(mask);
    const total = rings.reduce((s, ring) => s + ringArea(ring), 0);
    const px = maskArea(mask);
    // каждый угол контура срезан на 1/8 пикселя (выпуклый убавляет, вогнутый прибавляет)
    const corners = rings.reduce((s, ring) => s + ring.length / 2, 0);
    assert.ok(Math.abs(total - px) <= corners / 8 + 1e-9, `#${n}: ${total} при ${px}`);
    for (const ring of rings) {
      // каждая вершина контура на середине стороны между пикселями
      for (let i = 0; i < ring.length; i += 2) assert.ok((ring[i] * 2 + ring[i + 1] * 2) % 2 !== 0);
    }
    const polys = groupRings(rings.map((pts) => ({ pts })));
    const holes = rings.filter((x) => ringArea(x) < 0).length;
    assert.equal(polys.reduce((s, p) => s + p.holes.length, 0), holes, 'каждая дыра нашла свой контур');
    for (const p of polys) assert.ok(triangulatePolygon(p), `#${n}: триангуляция`);
  }
});

test('режимы: брелок с дыркой, табличка шире фигуры, формочка полая, трафарет с вырезом', () => {
  const sq = { width: 20, height: 20, data: new Uint8Array(400) };
  for (let y = 4; y < 16; y++) for (let x = 4; x < 16; x++) sq.data[y * 20 + x] = 1;
  const plain = extrudeMask(sq, { widthMm: 12, heightMm: 2 });
  assert.ok(Math.abs(volume(plain) - 12 * 12 * 2) < 2);
  const key = extrudeMask(sq, { mode: 'keychain', widthMm: 12, heightMm: 2, holeMm: 4, wallMm: 2 });
  const kb = bounds(key);
  assert.ok(kb.size[1] > 12 + 4, 'ушко сверху');
  assert.equal(analyzeMesh(key).shells, 1);
  const sign = extrudeMask(sq, { mode: 'sign', widthMm: 12, heightMm: 4, baseMm: 2, marginMm: 3 });
  assert.ok(Math.abs(bounds(sign).size[0] - 18) < 0.6);
  assert.ok(Math.abs(volume(sign) - (18 * 18 * 2 + 144 * 2)) < 15);
  const cookie = extrudeMask(sq, { mode: 'cookie', widthMm: 12, heightMm: 10, baseMm: 1.5, wallMm: 1, flangeMm: 3 });
  const cb = bounds(cookie);
  const all = [...Array(cookie.indices.length / 3).keys()];
  assert.ok(Math.abs(windingNumber(cookie.positions, cookie.indices, all, cb.center[0], cb.center[1], 5)) < 1e-6, 'внутри пусто');
  assert.ok(Math.abs(windingNumber(cookie.positions, cookie.indices, all, cb.center[0], cb.min[1] + 4 - 0.5, 5) - 1) < 1e-6, 'стенка');
  assert.ok(Math.abs(cb.size[0] - (12 + 2 * 4)) < 1.2);
  const stencil = extrudeMask(sq, { mode: 'stencil', widthMm: 12, heightMm: 1, marginMm: 3 });
  assert.ok(Math.abs(volume(stencil) - (18 * 18 - 144)) < 6);
  // табличка-брелок: пластина по контуру и ушко
  const tag = extrudeMask(sq, { mode: 'sign', plate: 'outline', ring: true, widthMm: 12, heightMm: 4, baseMm: 2 });
  assert.ok(isWatertight(tag));
  assert.equal(analyzeMesh(tag).shells, 1);
  assert.throws(() => extrudeMask(sq, { mode: 'sign', heightMm: 1, baseMm: 2 }), /heightMm/);
  assert.throws(() => extrudeMask(sq, { mode: 'cookie', heightMm: 1, baseMm: 2 }), /heightMm/);
  assert.throws(() => extrudeMask(sq, { mode: 'vase' }), /unknown mode/);
  assert.equal(extrudeMask({ width: 3, height: 3, data: new Uint8Array(9) }).indices.length, 0);
  const ctl = new AbortController();
  ctl.abort();
  assert.throws(() => extrudeMask(sq, { signal: ctl.signal }), /canceled/);
  const seen = [];
  extrudeMask(sq, { progress: (p) => seen.push(p) });
  assert.deepEqual(seen, [0.4, 1]);
  // по умолчанию: ширина 50 мм, высота 3
  assert.ok(Math.abs(bounds(extrudeMask(sq)).size[0] - 50) < 1e-3);
  assert.ok(isWatertight(extrudeMask(sq, { pxMm: 0.5, simplify: 0 })));
});

test('картинка -> маска: порог, инверсия, прозрачность, крошки', () => {
  const rgba = { width: 2, height: 2, data: Uint8Array.from([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 0, 100, 100, 100, 255]) };
  assert.deepEqual(Array.from(imageToMask(rgba).data), [1, 0, 0, 1]);
  assert.deepEqual(Array.from(imageToMask(rgba, { invert: true }).data), [0, 1, 1, 0]);
  assert.deepEqual(Array.from(imageToMask(rgba, { threshold: 50 }).data), [1, 0, 0, 0]);
  const gray = { width: 30, height: 30, data: new Uint8Array(900).fill(255) };
  for (let y = 5; y < 25; y++) for (let x = 5; x < 25; x++) gray.data[y * 30 + x] = 0;
  gray.data[0] = 0; // крошка
  gray.data[15 * 30 + 15] = 255; // дырочка в один пиксель
  const m = extrudeSilhouette(gray, { widthMm: 20, heightMm: 2 });
  assert.equal(analyzeMesh(m).shells, 1);
  assert.ok(Math.abs(volume(m) - 800) < 8);
  const keep = despeckle({ width: 3, height: 1, data: Uint8Array.from([1, 0, 1]) }, 1);
  assert.deepEqual(Array.from(keep.data), [1, 0, 1]);
  const big = imageToMask({ width: 100, height: 100, data: new Uint8Array(10000) }, { maxPixels: 100 });
  assert.equal(big.width, 10);
});

test('контуры: седло разделяет, упрощение держит углы, плохая триангуляция - null', () => {
  const saddle = { width: 2, height: 2, data: Uint8Array.from([1, 0, 0, 1]) };
  assert.equal(traceRings(saddle).length, 2);
  const square = [0, 0, 1, 0, 2, 0, 3, 0, 3, 1, 3, 2, 3, 3, 2, 3, 1, 3, 0, 3, 0, 2, 0, 1];
  assert.deepEqual(simplifyRing(square, 0.1), [0, 0, 3, 0, 3, 3, 0, 3]);
  assert.deepEqual(simplifyRing([0, 0, 1, 0, 0, 1], 5), [0, 0, 1, 0, 0, 1]);
  assert.equal(simplifyRing([0, 0, 0, 0, 0, 0, 0, 0], 1).length, 4);
  assert.ok(pointInRing(square, 1, 1));
  assert.ok(!pointInRing(square, 4, 1));
  // бантик (самопересечение) - earcut не покрывает все рёбра
  const bow = { outer: { pts: [0, 0, 2, 2, 2, 0, 0, 2] }, holes: [] };
  assert.equal(triangulatePolygon(bow), null);
  // дыра без внешнего контура не попадает ни в один многоугольник
  const orphan = groupRings([{ pts: [0, 0, 0, 1, 1, 1, 1, 0] }]);
  assert.equal(orphan.length, 0);
});
