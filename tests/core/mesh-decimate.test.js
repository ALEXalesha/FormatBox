import test from 'node:test';
import assert from 'node:assert/strict';
import { rng } from '../../web/core/rand.js';
import { decimate } from '../../web/core/mesh/decimate.js';
import { bounds, volume } from '../../web/core/mesh/measure.js';
import { isWatertight } from '../../web/core/mesh/topology.js';
import { sameMesh, copyMesh, sphere, torus, cylinder, box } from './mesh-helpers.js';
import { lithophane } from '../../web/core/mesh/litho.js';

function shape(r) {
  const k = r.pick(['sphere', 'torus', 'cylinder', 'litho']);
  if (k === 'sphere') return sphere(5 + r() * 20, r.int(30, 60), r.int(15, 30));
  if (k === 'torus') return torus(10 + r() * 10, 2 + r() * 3, r.int(30, 60), r.int(12, 24));
  if (k === 'cylinder') return cylinder(5 + r() * 10, 5 + r() * 30, r.int(40, 90));
  return lithophane({ width: 24, height: 18, data: r.bytes(24 * 18) }, { widthMm: 60 });
}

test('закон: треугольников не больше цели, замкнутость сохраняется, габариты почти те же (зерно 31, 16 случаев)', async () => {
  const r = rng(31);
  for (let n = 0; n < 16; n++) {
    const mesh = shape(r);
    const nf = mesh.indices.length / 3;
    const target = r() < 0.5 ? { ratio: 0.15 + r() * 0.6 } : { targetTriangles: Math.max(60, Math.floor(nf * (0.1 + r() * 0.5))) };
    const goal = target.targetTriangles ?? Math.floor(nf * target.ratio);
    const before = copyMesh(mesh);
    const out = await decimate(mesh, target);
    assert.ok(sameMesh(mesh, before), 'вход не тронут');
    const got = out.indices.length / 3;
    assert.ok(got <= goal, `#${n}: ${got} > ${goal}`);
    assert.ok(got >= goal * 0.8, `#${n}: слишком мало ${got} при цели ${goal}`);
    assert.ok(isWatertight(out), `#${n}: замкнутость`);
    const b0 = bounds(mesh), b1 = bounds(out);
    for (let k = 0; k < 3; k++) {
      assert.ok(Math.abs(b0.min[k] - b1.min[k]) < 0.04 * b0.diagonal && Math.abs(b0.max[k] - b1.max[k]) < 0.04 * b0.diagonal, `#${n}: габарит по оси ${k}`);
    }
    assert.ok(Math.abs(volume(out) - volume(mesh)) < 0.1 * volume(mesh), `#${n}: объём`);
  }
});

test('упрощение: открытая сетка держит край, цель больше числа граней - копия, отмена, прогресс', async () => {
  // открытая полусфера: край не должен разъехаться
  const s = sphere(10, 40, 20);
  const half = [];
  for (let i = 0; i < s.indices.length; i += 3) {
    if ([0, 1, 2].every((k) => s.positions[3 * s.indices[i + k] + 2] >= -1e-6)) half.push(s.indices[i], s.indices[i + 1], s.indices[i + 2]);
  }
  const open = { positions: s.positions, indices: Uint32Array.from(half) };
  const out = await decimate(open, { ratio: 0.3 });
  assert.ok(out.indices.length / 3 <= Math.floor(half.length / 3 * 0.3));
  const b = bounds(out);
  assert.ok(Math.abs(b.min[2]) < 1e-3, 'край на месте');
  assert.ok(Math.abs(b.size[0] - 20) < 0.5);
  const same = await decimate(box(1), { targetTriangles: 100 });
  assert.ok(sameMesh(same, box(1)));
  const ctl = new AbortController();
  ctl.abort();
  await assert.rejects(decimate(sphere(5, 30, 15), { ratio: 0.5 }, { signal: ctl.signal }), /canceled/);
  const seen = [];
  const big = sphere(10, 260, 130);
  await decimate(big, { ratio: 0.05 }, { progress: (p) => seen.push(p) });
  assert.ok(seen.length > 0 && seen.every((p) => p >= 0 && p <= 1));
});

test('упрощение: тетраэдр не схлопывается, плохие рёбра не трогаем, по умолчанию половина', async () => {
  const tet = { positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]), indices: Uint32Array.from([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]) };
  const t = await decimate(tet, { targetTriangles: 1 });
  assert.equal(t.indices.length / 3, 4);
  assert.ok(isWatertight(t));
  // три треугольника на одном ребре + вырожденная грань: работает, ничего не ломает
  const fan = { positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 2, 2, 2]), indices: Uint32Array.from([0, 1, 2, 0, 1, 3, 0, 1, 4, 5, 5, 5]) };
  const f = await decimate(fan, { targetTriangles: 0 });
  assert.ok(f.indices.length / 3 >= 3);
  const d = await decimate(sphere(5, 20, 10));
  assert.ok(d.indices.length / 3 <= (sphere(5, 20, 10).indices.length / 3) / 2);
});
