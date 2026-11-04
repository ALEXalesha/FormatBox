// Упрощение сетки схлопыванием рёбер по квадрикам ошибки (Garland-Heckbert).
// Схлопывание запрещено, если оно ломает многообразие (условие связи), выворачивает грань или трогает «плохие» рёбра.
import { compact, makeTicker, checkAbort } from './common.js';

// Мини-куча по стоимости
function createHeap() {
  const items = [];
  const up = (i) => {
    const it = items[i];
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (items[p].c <= it.c) break;
      items[i] = items[p]; i = p;
    }
    items[i] = it;
  };
  const down = (i) => {
    const it = items[i];
    const n = items.length;
    for (;;) {
      let l = 2 * i + 1;
      if (l >= n) break;
      if (l + 1 < n && items[l + 1].c < items[l].c) l += 1;
      if (items[l].c >= it.c) break;
      items[i] = items[l]; i = l;
    }
    items[i] = it;
  };
  return {
    push(it) { items.push(it); up(items.length - 1); },
    pop() {
      const top = items[0];
      const last = items.pop();
      if (items.length) { items[0] = last; down(0); }
      return top;
    },
    get size() { return items.length; },
  };
}

function addPlane(Q, v, a, b, c, d, w) {
  const o = 10 * v;
  Q[o] += w * a * a; Q[o + 1] += w * a * b; Q[o + 2] += w * a * c; Q[o + 3] += w * a * d;
  Q[o + 4] += w * b * b; Q[o + 5] += w * b * c; Q[o + 6] += w * b * d;
  Q[o + 7] += w * c * c; Q[o + 8] += w * c * d; Q[o + 9] += w * d * d;
}

function qcost(q, x, y, z) {
  return q[0] * x * x + 2 * q[1] * x * y + 2 * q[2] * x * z + 2 * q[3] * x
    + q[4] * y * y + 2 * q[5] * y * z + 2 * q[6] * y + q[7] * z * z + 2 * q[8] * z + q[9];
}

// target: { ratio } (доля треугольников) или { targetTriangles }; ctl: { signal, progress }
export async function decimate(mesh, target = {}, ctl = {}) {
  const tick = makeTicker(ctl);
  checkAbort(ctl.signal);
  const nf = mesh.indices.length / 3;
  const goal = Math.max(0, Math.floor(target.targetTriangles ?? nf * (target.ratio ?? 0.5)));
  if (nf <= goal) return { positions: mesh.positions.slice(), indices: mesh.indices.slice() };
  const nv = mesh.positions.length / 3;
  const pos = Float64Array.from(mesh.positions);
  const F = Int32Array.from(mesh.indices);
  const faceAlive = new Uint8Array(nf).fill(1);
  const vertAlive = new Uint8Array(nv).fill(1);
  const ver = new Uint32Array(nv);
  const vfaces = Array.from({ length: nv }, () => []);
  for (let f = 0; f < nf; f++) for (let k = 0; k < 3; k++) vfaces[F[3 * f + k]].push(f);

  // рёбра: граница (1 грань) и «плохие» (>2 граней) - вершины на плохих рёбрах не трогаем
  const edgeFaces = new Map();
  for (let f = 0; f < nf; f++) {
    for (let k = 0; k < 3; k++) {
      const a = F[3 * f + k], b = F[3 * f + ((k + 1) % 3)];
      const key = a < b ? a * nv + b : b * nv + a;
      const list = edgeFaces.get(key);
      if (list) list.push(f); else edgeFaces.set(key, [f]);
    }
  }
  const Q = new Float64Array(nv * 10);
  const boundary = new Uint8Array(nv);
  const locked = new Uint8Array(nv);
  for (let f = 0; f < nf; f++) {
    const n = faceNormal(pos, F[3 * f], F[3 * f + 1], F[3 * f + 2]);
    const len = Math.hypot(n[0], n[1], n[2]);
    if (!(len > 0)) continue;
    const [a, b, c] = [n[0] / len, n[1] / len, n[2] / len];
    const p0 = 3 * F[3 * f];
    const d = -(a * pos[p0] + b * pos[p0 + 1] + c * pos[p0 + 2]);
    for (let k = 0; k < 3; k++) addPlane(Q, F[3 * f + k], a, b, c, d, len / 2);
  }
  for (const [key, list] of edgeFaces) {
    const u = Math.floor(key / nv), v = key - u * nv;
    if (list.length > 2) { locked[u] = 1; locked[v] = 1; continue; }
    if (list.length !== 1) continue;
    boundary[u] = 1; boundary[v] = 1;
    // край держим плоскостью, перпендикулярной грани через ребро, с большим весом
    const f = list[0];
    const n = faceNormal(pos, F[3 * f], F[3 * f + 1], F[3 * f + 2]);
    const ex = pos[3 * v] - pos[3 * u], ey = pos[3 * v + 1] - pos[3 * u + 1], ez = pos[3 * v + 2] - pos[3 * u + 2];
    let px = ey * n[2] - ez * n[1], py = ez * n[0] - ex * n[2], pz = ex * n[1] - ey * n[0];
    const pl = Math.hypot(px, py, pz);
    if (!(pl > 0)) continue;
    px /= pl; py /= pl; pz /= pl;
    const d = -(px * pos[3 * u] + py * pos[3 * u + 1] + pz * pos[3 * u + 2]);
    const w = 100 * (ex * ex + ey * ey + ez * ez);
    addPlane(Q, u, px, py, pz, d, w);
    addPlane(Q, v, px, py, pz, d, w);
  }

  const q = new Float64Array(10);
  const plan = (u, v) => {
    for (let i = 0; i < 10; i++) q[i] = Q[10 * u + i] + Q[10 * v + i];
    const ux = pos[3 * u], uy = pos[3 * u + 1], uz = pos[3 * u + 2];
    const vx = pos[3 * v], vy = pos[3 * v + 1], vz = pos[3 * v + 2];
    const cand = [[ux, uy, uz], [vx, vy, vz], [(ux + vx) / 2, (uy + vy) / 2, (uz + vz) / 2]];
    const opt = solve(q);
    const elen = Math.hypot(vx - ux, vy - uy, vz - uz);
    if (opt && Math.hypot(opt[0] - cand[2][0], opt[1] - cand[2][1], opt[2] - cand[2][2]) <= elen) cand.push(opt);
    let best = null, bestCost = Infinity;
    for (const p of cand) {
      const c = qcost(q, p[0], p[1], p[2]);
      if (c < bestCost) { bestCost = c; best = p; }
    }
    return { c: Math.max(0, bestCost), p: best };
  };
  const heap = createHeap();
  const pushEdge = (u, v) => {
    if (locked[u] || locked[v]) return;
    heap.push({ c: plan(u, v).c, u, v, su: ver[u], sv: ver[v] });
  };
  const neighbors = (u) => {
    const out = new Set();
    for (const f of vfaces[u]) if (faceAlive[f]) for (let k = 0; k < 3; k++) if (F[3 * f + k] !== u) out.add(F[3 * f + k]);
    return out;
  };
  const fillHeap = () => {
    for (let u = 0; u < nv; u++) {
      if (!vertAlive[u]) continue;
      for (const v of neighbors(u)) if (u < v) pushEdge(u, v);
    }
  };

  let alive = nf;
  const canCollapse = (u, v, p) => {
    const nu = neighbors(u), nvv = neighbors(v);
    let shared = 0;
    for (const f of vfaces[u]) if (faceAlive[f] && hasVertex(F, f, v)) shared += 1;
    let common = 0;
    for (const w of nu) if (nvv.has(w)) common += 1;
    if (common !== shared) return false;
    if (boundary[u] && boundary[v] && shared !== 1) return false;
    const union = new Set([...nu, ...nvv]);
    if (union.size - 2 < (boundary[u] || boundary[v] ? 2 : 3)) return false;
    // ни одна оставшаяся грань не должна развернуться или выродиться
    for (const [a, b] of [[u, v], [v, u]]) {
      for (const f of vfaces[a]) {
        if (!faceAlive[f] || hasVertex(F, f, b)) continue;
        const old = faceNormal(pos, F[3 * f], F[3 * f + 1], F[3 * f + 2]);
        const ids = [F[3 * f], F[3 * f + 1], F[3 * f + 2]];
        const pts = ids.map((i) => (i === a ? p : [pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]]));
        const nn = cross3(pts[0], pts[1], pts[2]);
        const lo = Math.hypot(...old), ln = Math.hypot(...nn);
        if (!(ln > 1e-12 * lo) || (nn[0] * old[0] + nn[1] * old[1] + nn[2] * old[2]) < 0.2 * lo * ln) return false;
      }
    }
    return true;
  };

  for (let pass = 0; pass < 3 && alive > goal; pass++) {
    fillHeap();
    const startAlive = alive;
    let steps = 0;
    while (alive > goal && heap.size) {
      const e = heap.pop();
      const { u, v } = e;
      if (!vertAlive[u] || !vertAlive[v] || ver[u] !== e.su || ver[v] !== e.sv) continue;
      const { p } = plan(u, v);
      if (!canCollapse(u, v, p)) continue;
      // v вливается в u
      pos[3 * u] = p[0]; pos[3 * u + 1] = p[1]; pos[3 * u + 2] = p[2];
      for (let i = 0; i < 10; i++) Q[10 * u + i] += Q[10 * v + i];
      for (const f of vfaces[v]) {
        if (!faceAlive[f]) continue;
        if (hasVertex(F, f, u)) { faceAlive[f] = 0; alive -= 1; continue; }
        for (let k = 0; k < 3; k++) if (F[3 * f + k] === v) F[3 * f + k] = u;
        vfaces[u].push(f);
      }
      vfaces[u] = vfaces[u].filter((f) => faceAlive[f]);
      vfaces[v] = [];
      vertAlive[v] = 0;
      boundary[u] |= boundary[v];
      ver[u] += 1;
      for (const w of neighbors(u)) pushEdge(u, w);
      if (++steps % 256 === 0) await tick((nf - alive) / (nf - goal));
    }
    if (alive === startAlive) break;
    while (heap.size) heap.pop();
  }

  const out = [];
  for (let f = 0; f < nf; f++) if (faceAlive[f]) out.push(F[3 * f], F[3 * f + 1], F[3 * f + 2]);
  return compact(Float32Array.from(pos), Uint32Array.from(out));
}

function hasVertex(F, f, v) {
  return F[3 * f] === v || F[3 * f + 1] === v || F[3 * f + 2] === v;
}

function faceNormal(pos, a, b, c) {
  return cross3([pos[3 * a], pos[3 * a + 1], pos[3 * a + 2]], [pos[3 * b], pos[3 * b + 1], pos[3 * b + 2]], [pos[3 * c], pos[3 * c + 1], pos[3 * c + 2]]);
}

function cross3(a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
}

// Точка минимума квадрики: A x = -b, где A - верхний левый 3x3
function solve(q) {
  const a = q[0], b = q[1], c = q[2], d = q[4], e = q[5], f = q[7];
  const det = a * (d * f - e * e) - b * (b * f - e * c) + c * (b * e - d * c);
  const scale = Math.max(Math.abs(a), Math.abs(d), Math.abs(f));
  if (!(Math.abs(det) > 1e-10 * scale * scale * scale)) return null;
  const r0 = -q[3], r1 = -q[6], r2 = -q[8];
  const x = (r0 * (d * f - e * e) - b * (r1 * f - e * r2) + c * (r1 * e - d * r2)) / det;
  const y = (a * (r1 * f - e * r2) - r0 * (b * f - e * c) + c * (b * r2 - r1 * c)) / det;
  const z = (a * (d * r2 - r1 * e) - b * (b * r2 - r1 * c) + r0 * (b * e - d * c)) / det;
  return [x, y, z];
}
