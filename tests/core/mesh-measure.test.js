import test from 'node:test';
import assert from 'node:assert/strict';
import { rng } from '../../web/core/rand.js';
import { bounds, volume, surfaceArea, meshStats, scaleMesh, convertUnits, printEstimate, MATERIALS } from '../../web/core/mesh/measure.js';
import { mergeMeshes, transformMesh, weldExact, compact, num, createBuilder, emptyMesh, triangleCount, makeTicker } from '../../web/core/mesh/common.js';
import { isWatertight } from '../../web/core/mesh/topology.js';
import { randomShape, sameMesh, copyMesh, box, sphere, torus, cylinder } from './mesh-helpers.js';

test('закон: дюймы -> мм -> дюймы тождество, а дюйм = 25.4 мм (зерно 41, 30 тел)', () => {
  const r = rng(41);
  for (let n = 0; n < 30; n++) {
    const { mesh } = randomShape(r);
    const before = copyMesh(mesh);
    const mm = convertUnits(mesh, 'in', 'mm');
    assert.ok(sameMesh(mesh, before));
    const back = convertUnits(mm, 'mm', 'in');
    mesh.positions.forEach((v, i) => {
      assert.ok(Math.abs(back.positions[i] - v) <= 1e-6 * Math.max(1, Math.abs(v)));
      assert.ok(Math.abs(mm.positions[i] - v * 25.4) <= 1e-5 * Math.max(1, Math.abs(v * 25.4)));
    });
    assert.ok(Math.abs(volume(mm) - volume(mesh) * 25.4 ** 3) < 1e-4 * Math.abs(volume(mm)));
  }
  assert.throws(() => convertUnits(box(1), 'mm', 'parsec'), /unknown unit: parsec/);
  assert.throws(() => convertUnits(box(1), 'cubit', 'mm'), /unknown unit: cubit/);
  assert.equal(bounds(convertUnits(box(1), 'cm', 'mm')).size[0], 10);
});

test('закон: вес растёт с заполнением, 100 % = объём * плотность (зерно 42, 30 тел)', () => {
  const r = rng(42);
  for (let n = 0; n < 30; n++) {
    const { mesh } = randomShape(r);
    const material = r.pick(Object.keys(MATERIALS));
    const wallMm = r() * 2;
    let prev = -1;
    for (let f = 0; f <= 10; f++) {
      const est = printEstimate(mesh, { material, infill: f / 10, wallMm, pricePerKg: 25 });
      assert.ok(est.grams >= prev - 1e-9, `${material} ${f}`);
      prev = est.grams;
    }
    const full = printEstimate(mesh, { material, infill: 1, wallMm });
    assert.ok(Math.abs(full.grams - (volume(mesh) / 1000) * MATERIALS[material].density) < 1e-6 * full.grams);
    assert.ok(Math.abs(full.price - (full.grams / 1000) * 20) < 1e-9);
    const len = full.usedMm3 / (Math.PI * 0.875 ** 2) / 1000;
    assert.ok(Math.abs(full.lengthM - len) < 1e-9);
  }
});

test('обмеры: объём и площадь простых тел, габариты, сводка', () => {
  const b = box(2, 3, 4);
  assert.equal(volume(b), 24);
  assert.equal(surfaceArea(b), 2 * (6 + 8 + 12));
  assert.deepEqual(bounds(b).size, [2, 3, 4]);
  assert.deepEqual(bounds(b).center, [1, 1.5, 2]);
  assert.equal(bounds(b).diagonal, Math.hypot(2, 3, 4));
  assert.deepEqual(bounds(emptyMesh()).size, [0, 0, 0]);
  assert.equal(volume(emptyMesh()), 0);
  const s = sphere(10, 64, 32);
  assert.ok(Math.abs(volume(s) - (4 / 3) * Math.PI * 1000) < 0.01 * 4189);
  const st = meshStats(b);
  assert.equal(st.triangles, 12);
  assert.equal(st.vertices, 8);
  // все примитивы замкнуты и смотрят наружу
  for (const m of [box(1), sphere(1), torus(), cylinder()]) {
    assert.ok(isWatertight(m));
    assert.ok(volume(m) > 0);
  }
  const t = torus(3, 1, 64, 32);
  assert.ok(Math.abs(volume(t) - 2 * Math.PI ** 2 * 3) < 0.02 * volume(t));
});

test('масштаб: числом и по осям, зеркало переворачивает грани', () => {
  const b = box(1);
  assert.equal(volume(scaleMesh(b, 2)), 8);
  assert.equal(volume(scaleMesh(b, [1, 2, 3])), 6);
  const mirror = scaleMesh(b, [-1, 1, 1]);
  assert.equal(volume(mirror), 1);
  assert.ok(isWatertight(mirror));
  const t = transformMesh(b, [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 0, 0, 1]);
  assert.equal(volume(t), 1);
  assert.deepEqual(bounds(t).min, [4, 0, 0]);
});

test('прикидка печати: материалы, ошибки, свои значения', () => {
  const b = box(10);
  const pla = printEstimate(b);
  assert.ok(pla.grams > 0 && pla.grams < 1.24);
  assert.equal(printEstimate(b, { material: 'petg', infill: 1 }).density, 1.27);
  assert.equal(printEstimate(b, { density: 2, infill: 1 }).grams, 2);
  assert.equal(printEstimate(b, { infill: 5, wallMm: 0 }).usedMm3, 1000);
  assert.equal(printEstimate(b, { infill: -1, wallMm: -3 }).usedMm3, 0);
  assert.equal(printEstimate(b, { infill: 0, wallMm: 100 }).usedMm3, 1000);
  assert.throws(() => printEstimate(b, { material: 'cheese' }), /unknown material/);
  const thick = printEstimate(b, { diameter: 2.85, infill: 1 });
  assert.ok(thick.lengthM < printEstimate(b, { infill: 1 }).lengthM);
});

test('общие кирпичики: склейка, слияние, сжатие, числа, тикер', async () => {
  const parts = mergeMeshes([box(1), box(2)]);
  assert.equal(triangleCount(parts), 24);
  assert.equal(parts.indices[12 * 3], 8 + parts.indices[0] - box(1).indices[0] + box(2).indices[0]);
  const soup = { positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1]), indices: Uint32Array.from([0, 1, 2, 3, 4, 5]) };
  const w = weldExact(soup);
  assert.equal(w.positions.length, 12);
  assert.deepEqual(Array.from(w.indices), [0, 1, 2, 0, 2, 3]);
  const c = compact(Float32Array.from([9, 9, 9, 0, 0, 0, 1, 1, 1]), Uint32Array.from([2, 1, 2]));
  assert.deepEqual(Array.from(c.positions), [0, 0, 0, 1, 1, 1]);
  assert.deepEqual(Array.from(c.indices), [1, 0, 1]);
  assert.equal(num(Math.fround(0.1)), '0.1');
  assert.equal(num(NaN), 'NaN');
  assert.equal(num(1e21), '1e+21');
  const bld = createBuilder();
  bld.quad(bld.vertex(0, 0, 0), bld.vertex(1, 0, 0), bld.vertex(1, 1, 0), bld.vertex(0, 1, 0));
  assert.equal(bld.vertexCount, 4);
  assert.deepEqual(Array.from(bld.build().indices), [0, 1, 2, 0, 2, 3]);
  const seen = [];
  const tick = makeTicker({ progress: (p) => seen.push(p) });
  const t0 = Date.now();
  while (Date.now() - t0 < 40) { /* ждём */ }
  await tick(2);
  assert.deepEqual(seen, [1]);
  await makeTicker()(0.5);
});
