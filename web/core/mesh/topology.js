// Связность сетки: рёбра, оболочки, согласование ориентации, контуры дыр.

// Каждое ребро должно быть ровно у двух граней и обходиться ими в противоположные стороны.
export function isWatertight(mesh) {
  const idx = mesh.indices;
  const n = mesh.positions.length / 3;
  if (!idx.length) return false;
  const seen = new Set();
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i], b = idx[i + 1], c = idx[i + 2];
    if (a === b || b === c || a === c) return false;
    for (const key of [a * n + b, b * n + c, c * n + a]) {
      if (seen.has(key)) return false;
      seen.add(key);
    }
  }
  for (const key of seen) {
    const u = Math.floor(key / n), v = key - u * n;
    if (!seen.has(v * n + u)) return false;
  }
  return true;
}

// Неориентированные рёбра: у каждого первые две грани и направление обхода в них (1 - от меньшей вершины к большей).
export function buildEdges(indices, nv) {
  const nf = indices.length / 3;
  const map = new Map();
  const faceEdges = new Int32Array(nf * 3);
  const f1 = [], f2 = [], d1 = [], d2 = [], count = [];
  for (let f = 0; f < nf; f++) {
    for (let k = 0; k < 3; k++) {
      const u = indices[3 * f + k], v = indices[3 * f + ((k + 1) % 3)];
      const key = u < v ? u * nv + v : v * nv + u;
      const dir = u < v ? 1 : 0;
      let e = map.get(key);
      if (e === undefined) {
        e = count.length;
        map.set(key, e);
        f1.push(f); d1.push(dir); f2.push(-1); d2.push(0); count.push(1);
      } else {
        if (count[e] === 1) { f2[e] = f; d2[e] = dir; }
        count[e] += 1;
      }
      faceEdges[3 * f + k] = e;
    }
  }
  return { faceEdges, f1, f2, d1, d2, count, edgeCount: count.length };
}

// Оболочки: грани, связанные общими рёбрами
export function faceShells(indices, nv, edges = buildEdges(indices, nv)) {
  const nf = indices.length / 3;
  const parent = new Int32Array(nf).map((_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const { faceEdges, f1 } = edges;
  for (let f = 0; f < nf; f++) {
    for (let k = 0; k < 3; k++) {
      const a = find(f), b = find(f1[faceEdges[3 * f + k]]);
      if (a !== b) parent[a] = b;
    }
  }
  const label = new Map();
  const shellOf = new Int32Array(nf);
  for (let f = 0; f < nf; f++) {
    const r = find(f);
    if (!label.has(r)) label.set(r, label.size);
    shellOf[f] = label.get(r);
  }
  return { shellOf, count: label.size };
}

// Обход в ширину по рёбрам с двумя гранями: соседняя грань должна идти по ребру навстречу.
// Возвращает флаги переворота для каждой грани (оболочка целиком потом может перевернуться по знаку объёма).
export function orientFlags(indices, nv, edges = buildEdges(indices, nv)) {
  const nf = indices.length / 3;
  const flip = new Uint8Array(nf);
  const seen = new Uint8Array(nf);
  const { faceEdges, f1, f2, d1, d2, count } = edges;
  const queue = new Int32Array(nf);
  let conflicts = 0;
  for (let s = 0; s < nf; s++) {
    if (seen[s]) continue;
    seen[s] = 1;
    let head = 0, tail = 0;
    queue[tail++] = s;
    while (head < tail) {
      const f = queue[head++];
      for (let k = 0; k < 3; k++) {
        const e = faceEdges[3 * f + k];
        if (count[e] !== 2) continue;
        const [g, dg, df] = f1[e] === f ? [f2[e], d2[e], d1[e]] : [f1[e], d1[e], d2[e]];
        if (g === f) continue;
        const want = dg ^ df ^ flip[f] ^ 1;
        if (!seen[g]) { seen[g] = 1; flip[g] = want; queue[tail++] = g; }
        else if (flip[g] !== want) conflicts += 1;
      }
    }
  }
  return { flip, conflicts: conflicts / 2 };
}

// Контуры дыр: рёбра без пары, развёрнутые так, как их должна обойти заплатка.
export function boundaryLoops(indices, nv) {
  const directed = new Set();
  for (let i = 0; i < indices.length; i += 3) {
    for (let k = 0; k < 3; k++) directed.add(indices[i + k] * nv + indices[i + ((k + 1) % 3)]);
  }
  const out = new Map();
  let total = 0;
  for (const key of directed) {
    const u = Math.floor(key / nv), v = key - u * nv;
    if (directed.has(v * nv + u)) continue;
    // ребро грани u->v без пары: заплатка пройдёт его как v->u
    if (!out.has(v)) out.set(v, []);
    out.get(v).push(u);
    total += 1;
  }
  const loops = [];
  for (const [start, list] of out) {
    while (list.length) {
      const loop = [start];
      let cur = list.pop();
      while (cur !== start && cur !== undefined) {
        loop.push(cur);
        cur = out.get(cur)?.pop();
      }
      // незамкнутая цепочка бывает только у неориентируемой сетки - такую не латаем
      if (cur === start) loops.push(loop);
    }
  }
  return { loops, openEdges: total };
}

// Обобщённое число обмотки замкнутой оболочки в точке (1 внутри, 0 снаружи)
export function windingNumber(positions, indices, faces, x, y, z) {
  let sum = 0;
  for (const f of faces) {
    const a = 3 * indices[3 * f], b = 3 * indices[3 * f + 1], c = 3 * indices[3 * f + 2];
    const ax = positions[a] - x, ay = positions[a + 1] - y, az = positions[a + 2] - z;
    const bx = positions[b] - x, by = positions[b + 1] - y, bz = positions[b + 2] - z;
    const cx = positions[c] - x, cy = positions[c + 1] - y, cz = positions[c + 2] - z;
    const la = Math.hypot(ax, ay, az), lb = Math.hypot(bx, by, bz), lc = Math.hypot(cx, cy, cz);
    const det = ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
    const div = la * lb * lc + (ax * bx + ay * by + az * bz) * lc + (bx * cx + by * cy + bz * cz) * la + (cx * ax + cy * ay + cz * az) * lb;
    sum += 2 * Math.atan2(det, div);
  }
  return sum / (4 * Math.PI);
}
