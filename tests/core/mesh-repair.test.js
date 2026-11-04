import test from 'node:test';
import assert from 'node:assert/strict';
import { rng } from '../../web/core/rand.js';
import { repairMesh, analyzeMesh, isWatertight, weldVertices } from '../../web/core/mesh/repair.js';
import { volume } from '../../web/core/mesh/measure.js';
import { boundaryLoops, orientFlags, windingNumber } from '../../web/core/mesh/topology.js';
import { randomShape, damage, flipAll, sameMesh, copyMesh, mergeMeshes, box, sphere } from './mesh-helpers.js';

test('закон: испорченная сетка после ремонта водонепроницаема, объём положителен и близок к целому (зерно 11, 60 случаев)', async () => {
  const r = rng(11);
  for (let n = 0; n < 60; n++) {
    const { kind, mesh } = randomShape(r);
    const bad = damage(r, mesh);
    const before = copyMesh(bad);
    const { mesh: fixed, report } = await repairMesh(bad);
    assert.ok(sameMesh(bad, before), 'вход не тронут');
    assert.ok(isWatertight(fixed), `${kind} #${n}: ${JSON.stringify(report.after)}`);
    assert.equal(report.watertight, true);
    const v0 = volume(mesh), v1 = volume(fixed);
    assert.ok(v1 > 0, `${kind} #${n}: объём ${v1}`);
    assert.ok(Math.abs(v1 - v0) < 0.15 * v0, `${kind} #${n}: объём ${v1} против ${v0}`);
    assert.equal(report.after.invertedFaces, 0);
    assert.equal(report.after.openEdges, 0);
  }
});

test('закон: целая сетка после ремонта та же самая (зерно 12, 40 случаев)', async () => {
  const r = rng(12);
  for (let n = 0; n < 40; n++) {
    const { mesh } = randomShape(r);
    const { mesh: out, report } = await repairMesh(mesh);
    assert.ok(sameMesh(mesh, out), `#${n}`);
    assert.equal(volume(out), volume(mesh));
    assert.equal(report.flipped + report.holesFilled + report.welded + report.removedShells, 0);
  }
});

test('закон: шум сварки убирается сваркой, а не заплатками (зерно 13, 30 случаев)', async () => {
  const r = rng(13);
  for (let n = 0; n < 30; n++) {
    const { mesh } = randomShape(r);
    const bad = damage(r, mesh, ['noise']);
    const { mesh: out, report } = await repairMesh(bad);
    assert.equal(out.positions.length, mesh.positions.length, `#${n}`);
    assert.equal(report.holesFilled, 0);
    assert.ok(isWatertight(out));
  }
});

test('закон: дубли граней у края дыры убираются, а не латаются (зерно 15, 40 случаев)', async () => {
  const r = rng(15);
  for (let n = 0; n < 40; n++) {
    const { mesh } = randomShape(r);
    const tris = [];
    for (let i = 0; i < mesh.indices.length; i += 3) tris.push([mesh.indices[i], mesh.indices[i + 1], mesh.indices[i + 2]]);
    const [gone] = tris.splice(r.int(0, tris.length - 1), 1);
    // соседи удалённой грани получают копии (в том же или обратном обходе)
    const near = tris.filter((t) => t.filter((v) => gone.includes(v)).length === 2);
    for (const t of near) tris.push(r() < 0.5 ? [...t] : [t[0], t[2], t[1]]);
    const bad = { positions: mesh.positions, indices: Uint32Array.from(tris.flat()) };
    const { mesh: out, report } = await repairMesh(bad);
    assert.ok(isWatertight(out), `#${n}`);
    assert.equal(report.removedDuplicates, near.length);
    assert.ok(Math.abs(volume(out) - volume(mesh)) < 1e-3 * volume(mesh));
  }
});

test('закон: isWatertight - да у целой, нет без грани, с дублем или с перевёрнутой гранью (зерно 14, 40 случаев)', () => {
  const r = rng(14);
  for (let n = 0; n < 40; n++) {
    const { mesh } = randomShape(r);
    assert.ok(isWatertight(mesh));
    const f = r.int(0, mesh.indices.length / 3 - 1);
    const idx = Array.from(mesh.indices);
    const cut = idx.slice(0, 3 * f).concat(idx.slice(3 * f + 3));
    assert.ok(!isWatertight({ positions: mesh.positions, indices: Uint32Array.from(cut) }));
    const flipped = idx.slice();
    [flipped[3 * f + 1], flipped[3 * f + 2]] = [flipped[3 * f + 2], flipped[3 * f + 1]];
    assert.ok(!isWatertight({ positions: mesh.positions, indices: Uint32Array.from(flipped) }));
    assert.ok(!isWatertight({ positions: mesh.positions, indices: Uint32Array.from([...idx, ...idx.slice(3 * f, 3 * f + 3)]) }));
  }
  assert.ok(!isWatertight({ positions: new Float32Array(0), indices: new Uint32Array(0) }));
  assert.ok(!isWatertight({ positions: new Float32Array(9), indices: Uint32Array.from([0, 0, 1]) }));
});

test('анализ: открытые, неманифолдные, вывернутые, вырожденные, дубли, оболочки', () => {
  const cube = box(2);
  assert.deepEqual(
    (({ openEdges, nonManifoldEdges, invertedFaces, degenerate, duplicates, shells, watertight }) => ({ openEdges, nonManifoldEdges, invertedFaces, degenerate, duplicates, shells, watertight }))(analyzeMesh(cube)),
    { openEdges: 0, nonManifoldEdges: 0, invertedFaces: 0, degenerate: 0, duplicates: 0, shells: 1, watertight: true },
  );
  const idx = Array.from(cube.indices);
  const open = analyzeMesh({ positions: cube.positions, indices: Uint32Array.from(idx.slice(3)) });
  assert.equal(open.openEdges, 3);
  const inv = analyzeMesh(flipAll(cube));
  assert.equal(inv.invertedFaces, 12);
  assert.ok(inv.volume > 0, 'объём считается по исправленной ориентации');
  const one = idx.slice();
  [one[1], one[2]] = [one[2], one[1]];
  assert.equal(analyzeMesh({ positions: cube.positions, indices: Uint32Array.from(one) }).invertedFaces, 1);
  const extra = analyzeMesh({ positions: cube.positions, indices: Uint32Array.from([...idx, 0, 1, 2, 0, 0, 1, idx[0], idx[2], idx[1]]) });
  assert.equal(extra.degenerate, 1);
  assert.equal(extra.duplicates, 1);
  assert.ok(extra.nonManifoldEdges >= 1);
  const two = mergeMeshes([box(1), sphere(1, 8, 4)]);
  assert.equal(analyzeMesh(two).shells, 2);
  const empty = analyzeMesh({ positions: new Float32Array(0), indices: new Uint32Array(0) });
  assert.equal(empty.shells, 0);
  assert.equal(empty.watertight, false);
});

test('ремонт: полость внутри остаётся полостью (объём = внешний - внутренний)', async () => {
  const outer = box(10);
  const inner = flipAll(box(4));
  const shifted = { positions: inner.positions.map((v) => v + 3), indices: inner.indices };
  const hollow = mergeMeshes([outer, shifted]);
  const { mesh, report } = await repairMesh(hollow);
  assert.ok(Math.abs(volume(mesh) - (1000 - 64)) < 1e-6);
  assert.equal(report.flipped, 0);
  // вывернутая целиком полая коробка тоже чинится правильно
  const { mesh: fixed } = await repairMesh(flipAll(hollow));
  assert.ok(Math.abs(volume(fixed) - 936) < 1e-6);
  assert.equal(analyzeMesh(hollow).invertedFaces, 0);
  assert.equal(analyzeMesh(hollow).volume, 936);
});

test('ремонт: мелкие оболочки по порогу граней, объёма и доли', async () => {
  const big = sphere(10, 12, 6);
  const small = { positions: box(1).positions.map((v) => v + 20), indices: box(1).indices };
  const both = mergeMeshes([big, small]);
  assert.equal((await repairMesh(both)).report.removedShells, 0);
  assert.equal((await repairMesh(both, { minShellFaces: 13 })).report.removedShells, 1);
  assert.equal((await repairMesh(both, { minShellVolume: 2 })).report.removedShells, 1);
  const { mesh, report } = await repairMesh(both, { minShellRatio: 0.01 });
  assert.equal(report.removedShells, 1);
  assert.equal(volume(mesh), volume(big));
});

test('ремонт: пересекающиеся оболочки сливаются через manifold, полость не мешает', async () => {
  const a = box(10);
  const b = { positions: box(10).positions.map((v) => v + 5), indices: box(10).indices };
  const { mesh, report } = await repairMesh(mergeMeshes([a, b]));
  assert.equal(report.manifold, 'union');
  assert.ok(Math.abs(volume(mesh) - (2000 - 125)) < 1e-3);
  assert.equal(analyzeMesh(mesh).shells, 1);
  assert.ok(isWatertight(mesh));
  // одна оболочка с явным manifold: true - проверка без союза
  const one = await repairMesh(sphere(5, 12, 6), { manifold: true });
  assert.equal(one.report.manifold, 'ok');
  assert.ok(Math.abs(volume(one.mesh) - volume(sphere(5, 12, 6))) < 1e-3);
  // manifold: false - пересечения остаются, но всё равно водонепроницаемо
  const off = await repairMesh(mergeMeshes([a, b]), { manifold: false });
  assert.equal(off.report.manifold, 'skipped');
  assert.equal(analyzeMesh(off.mesh).shells, 2);
  // полость внутри одной из пересекающихся оболочек едет вместе с ней
  const cavity = { positions: flipAll(box(2)).positions.map((v) => v + 1), indices: flipAll(box(2)).indices };
  const withCavity = await repairMesh(mergeMeshes([a, b, cavity]));
  assert.equal(withCavity.report.manifold, 'union');
  assert.ok(Math.abs(volume(withCavity.mesh) - (1875 - 8)) < 1e-3);
});

test('ремонт: manifold не принял сетку - честно в отчёте, сетка наша', async () => {
  const bad = box(1);
  bad.positions[0] = NaN;
  const res = await repairMesh(bad, { manifold: true });
  assert.match(res.report.manifold, /^rejected: /);
  assert.equal(res.mesh.indices.length, bad.indices.length);
});

test('ремонт: сварка с допуском, вырожденные, неманифолдные рёбра, дыры плоские и нет', async () => {
  const w = weldVertices({ positions: Float32Array.from([0, 0, 0, 0.001, 0, 0, 5, 0, 0]), indices: Uint32Array.from([0, 1, 2]) }, 0.01);
  assert.equal(w.merged, 1);
  assert.deepEqual(Array.from(w.indices), [0, 0, 1]);
  const exact = weldVertices({ positions: Float32Array.from([1, 1, 1, 1, 1, 1]), indices: Uint32Array.from([0, 1]) }, 0);
  assert.equal(exact.merged, 1);
  // куб без верхней грани (2 треугольника): плоская дыра закрывается earcut без новых вершин
  const cube = box(3);
  const noTop = { positions: cube.positions, indices: cube.indices.slice(0).filter((_, i) => i < 6 || i >= 12) };
  const flat = await repairMesh(noTop);
  assert.equal(flat.mesh.positions.length, cube.positions.length);
  assert.ok(Math.abs(volume(flat.mesh) - 27) < 1e-4);
  // без заплаток - дыра остаётся
  const open = await repairMesh(noTop, { fillHoles: false });
  assert.equal(open.report.watertight, false);
  // шар без шапки: неплоская дыра - веер от новой вершины
  const ball = sphere(5, 16, 8);
  const mid = 1 + 3 * 16; // вершина в середине бока: её окрестность не плоская
  const tris = [];
  for (let i = 0; i < ball.indices.length; i += 3) if (![0, 1, 2].some((k) => ball.indices[i + k] === mid)) tris.push(ball.indices[i], ball.indices[i + 1], ball.indices[i + 2]);
  const cap = { positions: ball.positions, indices: Uint32Array.from(tris) };
  const fan = await repairMesh(cap);
  assert.ok(fan.report.watertight);
  assert.equal(fan.mesh.positions.length / 3, ball.positions.length / 3);
  // вырожденная по индексам грань и третья грань на ребре
  const idx = Array.from(cube.indices);
  const junk = await repairMesh({ positions: cube.positions, indices: Uint32Array.from([...idx, 0, 0, 1, 0, 1, 7]) });
  assert.equal(junk.report.removedDegenerate, 1);
  assert.ok(junk.report.removedNonManifold >= 1);
  assert.ok(junk.report.watertight);
});

test('ремонт: отмена и прогресс', async () => {
  const ctl = new AbortController();
  ctl.abort();
  await assert.rejects(repairMesh(box(1), { signal: ctl.signal }), /canceled/);
  const seen = [];
  const big = sphere(10, 200, 100);
  const idx = Array.from(big.indices);
  for (let k = 0; k < 400; k++) idx.splice(k * 300, 3);
  await repairMesh({ positions: big.positions, indices: Uint32Array.from(idx) }, { progress: (p) => seen.push(p) });
  assert.ok(seen.length > 0 && seen.every((p) => p >= 0 && p <= 1));
});

test('топология: контуры дыр, обмотка, конфликты ориентации', () => {
  const cube = box(2);
  assert.equal(boundaryLoops(cube.indices, 8).loops.length, 0);
  const loops = boundaryLoops(cube.indices.slice(6), 8);
  assert.equal(loops.loops.length, 1);
  assert.equal(loops.openEdges, 4);
  const faces = [...Array(12).keys()];
  assert.ok(Math.abs(windingNumber(cube.positions, cube.indices, faces, 1, 1, 1) - 1) < 1e-9);
  assert.ok(Math.abs(windingNumber(cube.positions, cube.indices, faces, 5, 1, 1)) < 1e-9);
  // лента Мёбиуса из треугольников неориентируема: конфликт, незамкнутые цепочки края не латаются
  const n = 8;
  const pos = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n, t = a / 2;
    for (const s of [-1, 1]) pos.push((3 + s * Math.cos(t)) * Math.cos(a), (3 + s * Math.cos(t)) * Math.sin(a), s * Math.sin(t));
  }
  const idx = [];
  for (let i = 0; i < n; i++) {
    const a0 = 2 * i, a1 = 2 * i + 1;
    const [b0, b1] = i + 1 < n ? [2 * i + 2, 2 * i + 3] : [1, 0];
    idx.push(a0, b0, b1, a0, b1, a1);
  }
  const { conflicts } = orientFlags(Uint32Array.from(idx), pos.length / 3);
  assert.ok(conflicts >= 1);
  assert.ok(boundaryLoops(Uint32Array.from(idx), pos.length / 3).loops.length <= 1);
});
