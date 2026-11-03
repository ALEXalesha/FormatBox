// Диагностика и ремонт сетки под печать: сварка, мусорные грани, ориентация, дыры, мелкие оболочки, союз через manifold.
import earcut from '../../vendor/earcut.js';
import { bounds, triangleArea } from './measure.js';
import { buildEdges, faceShells, orientFlags, boundaryLoops, windingNumber, isWatertight } from './topology.js';
import { compact, makeTicker } from './common.js';

export { isWatertight };

const BIG = 67108864; // ключ неориентированного ребра: min * BIG + max

let manifoldPromise = null;
// manifold-3d (wasm) грузится один раз на всё приложение
export function loadManifold() {
  if (!manifoldPromise) {
    manifoldPromise = import('../../vendor/manifold.js').then(async (mod) => {
      const M = await mod.default();
      M.setup();
      return M;
    });
  }
  return manifoldPromise;
}

// Сварка вершин ближе tol (сетка-хэш по ячейкам tol). Порядок первых вхождений сохраняется.
export function weldVertices(mesh, tol) {
  const p = mesh.positions;
  const n = p.length / 3;
  const remap = new Uint32Array(n);
  const reps = [];
  const cells = new Map();
  const inv = tol > 0 ? 1 / tol : 0;
  const hash = (x, y, z) => ((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) | 0;
  for (let i = 0; i < n; i++) {
    const x = p[3 * i], y = p[3 * i + 1], z = p[3 * i + 2];
    const cx = Math.floor(x * inv), cy = Math.floor(y * inv), cz = Math.floor(z * inv);
    let found = -1;
    for (let dx = -1; dx <= 1 && found < 0; dx++) for (let dy = -1; dy <= 1 && found < 0; dy++) for (let dz = -1; dz <= 1 && found < 0; dz++) {
      const list = cells.get(hash(cx + dx, cy + dy, cz + dz));
      if (!list) continue;
      for (const j of list) {
        const r = reps[j];
        if (Math.abs(p[3 * r] - x) <= tol && Math.abs(p[3 * r + 1] - y) <= tol && Math.abs(p[3 * r + 2] - z) <= tol) { found = j; break; }
      }
    }
    if (found < 0) {
      found = reps.length;
      reps.push(i);
      const h = hash(cx, cy, cz);
      if (!cells.has(h)) cells.set(h, []);
      cells.get(h).push(found);
    }
    remap[i] = found;
  }
  const positions = new Float32Array(reps.length * 3);
  reps.forEach((r, j) => positions.set(p.subarray(3 * r, 3 * r + 3), 3 * j));
  const indices = new Uint32Array(mesh.indices.length);
  for (let i = 0; i < indices.length; i++) indices[i] = remap[mesh.indices[i]];
  return { positions, indices, merged: n - reps.length };
}

// Оболочки с объёмом, габаритом и глубиной вложенности (внутренняя полость - нечётная глубина)
function shellInfo(positions, indices, edges) {
  const nv = positions.length / 3;
  const { shellOf, count } = faceShells(indices, nv, edges);
  const shells = Array.from({ length: count }, () => ({ faces: [], volume: 0, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], depth: 0 }));
  for (let f = 0; f < shellOf.length; f++) {
    const s = shells[shellOf[f]];
    s.faces.push(f);
    for (let k = 0; k < 3; k++) {
      const v = 3 * indices[3 * f + k];
      for (let a = 0; a < 3; a++) { s.min[a] = Math.min(s.min[a], positions[v + a]); s.max[a] = Math.max(s.max[a], positions[v + a]); }
    }
  }
  for (const s of shells) {
    const c = s.min.map((m, a) => (m + s.max[a]) / 2);
    let v = 0;
    for (const f of s.faces) {
      const [a, b, d] = [0, 1, 2].map((k) => 3 * indices[3 * f + k]);
      const ax = positions[a] - c[0], ay = positions[a + 1] - c[1], az = positions[a + 2] - c[2];
      const bx = positions[b] - c[0], by = positions[b + 1] - c[1], bz = positions[b + 2] - c[2];
      const cx = positions[d] - c[0], cy = positions[d + 1] - c[1], cz = positions[d + 2] - c[2];
      v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
    }
    s.volume = v / 6;
  }
  // вложенность считаем только для разумного числа оболочек: иначе квадратичная работа
  if (shells.length > 1 && shells.length <= 200) {
    for (const a of shells) {
      const v = 3 * indices[3 * a.faces[0]];
      const [x, y, z] = [positions[v], positions[v + 1], positions[v + 2]];
      for (const b of shells) {
        if (a === b || !inside(b, a)) continue;
        if (Math.abs(windingNumber(positions, indices, b.faces, x, y, z)) > 0.5) a.depth += 1;
      }
    }
  }
  return shells;
}

function inside(outer, inner) {
  for (let k = 0; k < 3; k++) if (inner.min[k] < outer.min[k] || inner.max[k] > outer.max[k]) return false;
  return true;
}

function overlaps(a, b) {
  for (let k = 0; k < 3; k++) if (a.max[k] < b.min[k] || b.max[k] < a.min[k]) return false;
  return true;
}

function faceKey(a, b, c) {
  const [x, y, z] = [a, b, c].sort((p, q) => p - q);
  return `${x},${y},${z}`;
}

// Отчёт о состоянии сетки без изменений
export function analyzeMesh(mesh) {
  const { positions, indices } = mesh;
  const nv = positions.length / 3;
  const nf = indices.length / 3;
  const diag = bounds(mesh).diagonal;
  const eps = (diag * 1e-9) ** 2;
  let degenerate = 0, duplicates = 0;
  const keys = new Set();
  for (let f = 0; f < nf; f++) {
    const a = indices[3 * f], b = indices[3 * f + 1], c = indices[3 * f + 2];
    if (a === b || b === c || a === c || triangleArea(positions, a, b, c) <= eps) degenerate += 1;
    const key = faceKey(a, b, c);
    if (keys.has(key)) duplicates += 1;
    keys.add(key);
  }
  const edges = buildEdges(indices, nv);
  let openEdges = 0, nonManifoldEdges = 0;
  for (let e = 0; e < edges.edgeCount; e++) {
    if (edges.count[e] === 1) openEdges += 1;
    else if (edges.count[e] > 2) nonManifoldEdges += 1;
  }
  const { flip } = orientFlags(indices, nv, edges);
  const oriented = applyFlips(indices, flip);
  const shells = shellInfo(positions, oriented, edges);
  let invertedFaces = 0, volume = 0;
  for (const s of shells) {
    // оболочка смотрит наружу, если знак объёма совпадает с чётностью вложенности
    const whole = (s.volume < 0) !== (s.depth % 2 === 1);
    for (const f of s.faces) if (flip[f] !== (whole ? 1 : 0)) invertedFaces += 1;
    volume += Math.abs(s.volume) * (s.depth % 2 ? -1 : 1);
  }
  return {
    triangles: nf, vertices: nv, openEdges, nonManifoldEdges, invertedFaces, degenerate, duplicates,
    shells: shells.length, watertight: isWatertight(mesh), volume,
  };
}

function applyFlips(indices, flip) {
  const out = indices.slice();
  for (let f = 0; f < flip.length; f++) if (flip[f]) { out[3 * f + 1] = indices[3 * f + 2]; out[3 * f + 2] = indices[3 * f + 1]; }
  return out;
}

// Ремонт. opts: tolerance (мм, сварка; по умолчанию 1e-5 диагонали), fillHoles, minShellFaces, minShellVolume (мм³),
// minShellRatio (доля от самой большой оболочки), manifold: 'auto' | true | false, signal, progress.
export async function repairMesh(mesh, opts = {}) {
  const tick = makeTicker(opts);
  const before = analyzeMesh(mesh);
  await tick(0.05);
  const diag = bounds(mesh).diagonal || 1;
  const report = { before, welded: 0, removedDegenerate: 0, removedDuplicates: 0, removedNonManifold: 0, flipped: 0, holesFilled: 0, removedShells: 0, manifold: 'skipped' };

  const welded = weldVertices(mesh, opts.tolerance ?? diag * 1e-5);
  report.welded = welded.merged;
  let positions = welded.positions;
  const src = welded.indices;

  // мусор: вырожденные по индексам, дубли (в любом порядке обхода), третьи и дальше грани на ребре
  const keep = [];
  const keys = new Set();
  const edgeUse = new Map();
  for (let f = 0; f < src.length / 3; f++) {
    const a = src[3 * f], b = src[3 * f + 1], c = src[3 * f + 2];
    if (a === b || b === c || a === c) { report.removedDegenerate += 1; continue; }
    const key = faceKey(a, b, c);
    if (keys.has(key)) { report.removedDuplicates += 1; continue; }
    const ek = [ekey(a, b), ekey(b, c), ekey(c, a)];
    if (ek.some((k) => (edgeUse.get(k) ?? 0) >= 2)) { report.removedNonManifold += 1; continue; }
    keys.add(key);
    for (const k of ek) edgeUse.set(k, (edgeUse.get(k) ?? 0) + 1);
    keep.push(a, b, c);
  }
  let indices = Uint32Array.from(keep);
  await tick(0.2);

  // согласованная ориентация внутри оболочек
  const nv0 = positions.length / 3;
  const { flip } = orientFlags(indices, nv0);
  indices = applyFlips(indices, flip);
  await tick(0.35);

  // заплатки
  if (opts.fillHoles !== false) {
    const { loops } = boundaryLoops(indices, nv0);
    if (loops.length) {
      const pos = Array.from(positions);
      const tris = Array.from(indices);
      for (const loop of loops) {
        fillLoop(loop, pos, tris, edgeUse, opts);
        report.holesFilled += 1;
        await tick(0.35 + (0.25 * report.holesFilled) / loops.length);
      }
      positions = Float32Array.from(pos);
      indices = Uint32Array.from(tris);
    }
  }

  // оболочки: мелкие долой, каждую наружу с учётом вложенности
  let shells = shellInfo(positions, indices, buildEdges(indices, positions.length / 3));
  await tick(0.7);
  const maxVol = Math.max(0, ...shells.map((s) => Math.abs(s.volume)));
  const minFaces = opts.minShellFaces ?? 4;
  const minVol = Math.max(opts.minShellVolume ?? 0, diag ** 3 * 1e-12, maxVol * (opts.minShellRatio ?? 0));
  const out = [];
  const kept = [];
  for (const s of shells) {
    if (s.faces.length < minFaces || Math.abs(s.volume) <= minVol) { report.removedShells += 1; continue; }
    const turn = (s.volume < 0) !== (s.depth % 2 === 1);
    for (const f of s.faces) {
      const a = indices[3 * f], b = indices[3 * f + 1], c = indices[3 * f + 2];
      if (turn) out.push(a, c, b); else out.push(a, b, c);
    }
    for (const f of s.faces) if (f < flip.length && (flip[f] === 1) !== turn) report.flipped += 1;
    kept.push(s);
  }
  let result = compact(positions, Uint32Array.from(out));
  shells = kept;
  await tick(0.8);

  // пересекающиеся оболочки сливаем союзом manifold; полости едут вместе со своей внешней оболочкой
  const tops = shells.filter((s) => s.depth === 0);
  const crossing = tops.some((a, i) => tops.some((b, j) => j > i && overlaps(a, b)));
  const mode = opts.manifold ?? 'auto';
  if (mode === true || (mode === 'auto' && crossing)) {
    report.manifold = await manifoldUnion(result, opts);
  }
  if (report.manifold.mesh) { result = report.manifold.mesh; report.manifold = report.manifold.status; }
  await tick(0.95);
  report.after = analyzeMesh(result);
  report.watertight = report.after.watertight;
  return { mesh: result, report };
}

function ekey(a, b) {
  return a < b ? a * BIG + b : b * BIG + a;
}

// Дыра: плоскую триангулируем ушами (earcut), остальное - веером от центра (новая вершина не даёт повторных рёбер)
function fillLoop(loop, pos, tris, edgeUse, opts) {
  const n = loop.length;
  if (n === 3) {
    tris.push(loop[0], loop[1], loop[2]);
    return;
  }
  const flat = new Set(loop).size === n && planarTriangles(loop, pos, edgeUse, opts.planarTolerance ?? 1e-3);
  if (flat) {
    tris.push(...flat);
    for (let i = 0; i < flat.length; i += 3) for (let k = 0; k < 3; k++) edgeUse.set(ekey(flat[i + k], flat[i + ((k + 1) % 3)]), 2);
    return;
  }
  let cx = 0, cy = 0, cz = 0;
  for (const v of loop) { cx += pos[3 * v]; cy += pos[3 * v + 1]; cz += pos[3 * v + 2]; }
  const c = pos.length / 3;
  pos.push(cx / n, cy / n, cz / n);
  for (let i = 0; i < n; i++) tris.push(loop[i], loop[(i + 1) % n], c);
}

function planarTriangles(loop, pos, edgeUse, tolerance) {
  const n = loop.length;
  const P = (i, k) => pos[3 * loop[i] + k];
  let nx = 0, ny = 0, nz = 0, cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    nx += (P(i, 1) - P(j, 1)) * (P(i, 2) + P(j, 2));
    ny += (P(i, 2) - P(j, 2)) * (P(i, 0) + P(j, 0));
    nz += (P(i, 0) - P(j, 0)) * (P(i, 1) + P(j, 1));
    cx += P(i, 0); cy += P(i, 1); cz += P(i, 2);
  }
  const len = Math.hypot(nx, ny, nz);
  if (!(len > 0)) return null;
  nx /= len; ny /= len; nz /= len;
  cx /= n; cy /= n; cz /= n;
  let size = 0, off = 0;
  for (let i = 0; i < n; i++) {
    const dx = P(i, 0) - cx, dy = P(i, 1) - cy, dz = P(i, 2) - cz;
    size = Math.max(size, Math.hypot(dx, dy, dz));
    off = Math.max(off, Math.abs(dx * nx + dy * ny + dz * nz));
  }
  if (off > tolerance * size) return null;
  // базис плоскости: u - любой перпендикуляр к нормали, v = n x u; обход дыры тогда против часовой
  const [ux, uy, uz] = Math.abs(nx) < 0.9 ? norm(0, nz, -ny) : norm(-nz, 0, nx);
  const vx = ny * uz - nz * uy, vy = nz * ux - nx * uz, vz = nx * uy - ny * ux;
  const flat2 = [];
  for (let i = 0; i < n; i++) {
    const dx = P(i, 0) - cx, dy = P(i, 1) - cy, dz = P(i, 2) - cz;
    flat2.push(dx * ux + dy * uy + dz * uz, dx * vx + dy * vy + dz * vz);
  }
  const t = earcut(flat2);
  if (t.length !== 3 * (n - 2)) return null;
  const out = [];
  const directed = new Map();
  for (let i = 0; i < t.length; i += 3) {
    let [a, b, c] = [t[i], t[i + 1], t[i + 2]];
    const area = (flat2[2 * b] - flat2[2 * a]) * (flat2[2 * c + 1] - flat2[2 * a + 1]) - (flat2[2 * c] - flat2[2 * a]) * (flat2[2 * b + 1] - flat2[2 * a + 1]);
    if (area < 0) [b, c] = [c, b];
    for (const [p, q] of [[a, b], [b, c], [c, a]]) directed.set(p * n + q, (directed.get(p * n + q) ?? 0) + 1);
    out.push(loop[a], loop[b], loop[c]);
  }
  // проверка: край заплатки - ровно контур дыры, диагонали новые и парные
  for (const [key, cnt] of directed) {
    const p = Math.floor(key / n), q = key % n;
    if (cnt !== 1) return null;
    if (q === (p + 1) % n) continue;
    if (directed.get(q * n + p) !== 1 || edgeUse.has(ekey(loop[p], loop[q]))) return null;
  }
  for (let i = 0; i < n; i++) if (!directed.has(i * n + ((i + 1) % n))) return null;
  return out;
}

function norm(x, y, z) {
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}

async function manifoldUnion(mesh, opts) {
  const M = await loadManifold();
  if (opts.signal?.aborted) throw new Error('canceled');
  const nv = mesh.positions.length / 3;
  const shells = shellInfo(mesh.positions, mesh.indices, buildEdges(mesh.indices, nv));
  // группа = внешняя оболочка + её полости
  const groups = shells.filter((s) => s.depth === 0).map((s) => [s]);
  for (const s of shells) {
    if (s.depth === 0) continue;
    const owner = groups.find((g) => inside(g[0], s));
    if (owner) owner.push(s);
  }
  const parts = [];
  try {
    for (const g of groups) {
      const idx = [];
      for (const s of g) for (const f of s.faces) idx.push(mesh.indices[3 * f], mesh.indices[3 * f + 1], mesh.indices[3 * f + 2]);
      const sub = compact(mesh.positions, Uint32Array.from(idx));
      const m = new M.Mesh({ numProp: 3, vertProperties: sub.positions, triVerts: sub.indices });
      parts.push(new M.Manifold(m));
    }
    const all = parts.length === 1 ? parts[0] : M.Manifold.union(parts);
    const got = all.getMesh();
    const np = got.numProp;
    const positions = new Float32Array((got.vertProperties.length / np) * 3);
    for (let i = 0, j = 0; i < got.vertProperties.length; i += np, j += 3) positions.set(got.vertProperties.subarray(i, i + 3), j);
    const result = { positions, indices: Uint32Array.from(got.triVerts) };
    if (all !== parts[0]) all.delete();
    return { status: parts.length > 1 ? 'union' : 'ok', mesh: result };
  } catch (e) {
    return `rejected: ${e.message || e}`;
  } finally {
    for (const p of parts) p.delete();
  }
}
